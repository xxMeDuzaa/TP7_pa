// Monitor de SLA (CU3): consumidor con estado en memoria y respaldo en MongoDB.
//
// - Cruza dos streams: envios.estados (último estado) y envios.promesas (vencimiento).
// - Evalúa al recibir cada evento y, además, periódicamente para todos los envíos abiertos:
//   la alerta puede nacer de la AUSENCIA de un evento, no solo de su llegada.
// - Usa el reloj simulado de los eventos (marca de agua), no el de la máquina.
// - Tolerancia a reinicios: el estado y la marca de agua se respaldan en MongoDB; las alertas tienen
//   eventId determinístico, así que si se re-emite alguna, los consumidores la descartan.
// - No se pierden alertas: cada evaluación trabaja sobre una COPIA del estado. La copia reemplaza al
//   estado en memoria recién después de publicar las alertas en Kafka. Si la publicación falla, el
//   estado queda como estaba y la alerta se vuelve a evaluar (el evento se reentrega o el ciclo
//   periódico la detecta de nuevo).
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { TOPICS, GRUPOS } from '../../shared/topics.js';
import { numeroEnv } from '../../shared/config.js';
import { MINUTO, aMs, iso } from '../../shared/tiempo.js';
import { estadoInicial, aplicarEvento, evaluarYEmitir } from './reglas-sla.js';

const GRUPO = 'monitor-sla';
const INTERVALO_MS = numeroEnv('MONITOR_INTERVALO_MS', 1000); // 1 s real ≈ 2 min simulados con el factor por defecto
const GRACIA = numeroEnv('MONITOR_GRACIA_MIN', 10) * MINUTO; // tolerancia a eventos tardíos (tiempo simulado)

const estados = new Map(); // shipmentId -> estado (solo envíos abiertos)
let marcaDeAgua = 0;

// Exclusión mutua simple: el procesamiento por evento y la evaluación periódica no se intercalan.
let cadena = Promise.resolve();
const exclusivo = (fn) => {
  const r = cadena.then(fn);
  cadena = r.catch(() => {});
  return r;
};

const ahoraCon = (marca) => marca - GRACIA;
const sinId = ({ _id, ...resto }) => resto;

async function obtener(db, shipmentId) {
  const st = estados.get(shipmentId);
  if (st) return st;
  const guardado = await db.collection('monitor_sla_estado').findOne({ shipmentId });
  return guardado ? sinId(guardado) : estadoInicial(shipmentId);
}

/** Confirma en memoria un estado ya publicado y persistido. */
function confirmarEnMemoria(st) {
  if (st.cerrado) estados.delete(st.shipmentId);
  else estados.set(st.shipmentId, st);
}

async function persistir(db, sts) {
  if (!sts.length) return;
  await db.collection('monitor_sla_estado').bulkWrite(
    sts.map((st) => ({ replaceOne: { filter: { shipmentId: st.shipmentId }, replacement: st, upsert: true } })),
    { ordered: false },
  );
}

const ctx = await iniciarConsumidor({
  servicio: 'monitor-sla',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  alIniciar: async ({ db, log }) => {
    const meta = await db.collection('monitor_sla_meta').findOne({ _id: 'reloj' });
    marcaDeAgua = meta?.marcaDeAgua ?? 0;
    const abiertos = await db.collection('monitor_sla_estado').find({ cerrado: false }).toArray();
    for (const st of abiertos) estados.set(st.shipmentId, sinId(st));
    log.info('estado restaurado desde MongoDB', { enviosAbiertos: estados.size, marcaDeAgua: marcaDeAgua ? iso(marcaDeAgua) : null });
  },
  manejar: (ev, meta, ctx) =>
    exclusivo(async () => {
      const { db } = ctx;
      const st = structuredClone(await obtener(db, ev.shipmentId)); // copia: el original no se toca hasta publicar
      const cambio = aplicarEvento(st, ev);
      const nuevaMarca = Math.max(marcaDeAgua, aMs(ev.ocurridoEn));
      const alertas = evaluarYEmitir(st, ahoraCon(nuevaMarca), aMs(ev.ocurridoEn));
      if (alertas.length) await ctx.publicar(TOPICS.ALERTAS, alertas); // si falla, el estado en memoria queda intacto
      await ctx.transaccion(async (session) => {
        if (cambio || alertas.length) {
          await db.collection('monitor_sla_estado').replaceOne({ shipmentId: st.shipmentId }, st, { upsert: true, session });
        }
        await db.collection('monitor_sla_meta').updateOne({ _id: 'reloj' }, { $max: { marcaDeAgua: nuevaMarca } }, { upsert: true, session });
      });
      marcaDeAgua = nuevaMarca;
      confirmarEnMemoria(st);
      return { alertas: alertas.map((a) => `${a.tipo}:${a.regla}`), relojSimulado: iso(marcaDeAgua) };
    }),
});

// Evaluación periódica: detecta envíos que se quedaron quietos mientras el tiempo pasa.
async function evaluarTodos() {
  if (!marcaDeAgua) return;
  const t = ahoraCon(marcaDeAgua);
  const eventos = [];
  const cambiados = [];
  for (const original of estados.values()) {
    const st = structuredClone(original);
    const e = evaluarYEmitir(st, t);
    if (e.length) {
      eventos.push(...e);
      cambiados.push(st);
    }
  }
  if (!eventos.length) return;
  await ctx.publicar(TOPICS.ALERTAS, eventos); // si falla, nada cambió en memoria: se reintenta en el próximo ciclo
  await persistir(ctx.db, cambiados);
  for (const st of cambiados) confirmarEnMemoria(st);
  ctx.log.info('evaluación periódica', { relojSimulado: iso(t), alertas: eventos.map((a) => `${a.shipmentId}:${a.regla}`) });
}

setInterval(() => {
  exclusivo(evaluarTodos).catch((e) => ctx.log.error('falló la evaluación periódica', { error: e.message }));
}, INTERVALO_MS);
