// Recuento manual de los tres indicadores de CU4, leyendo Kafka directamente (sin pasar por la
// analítica), y comparación con lo que hay en metricas_diarias.
//
// Pausá el simulador y esperá a que el lag de 'analitica' sea 0 antes de correrlo:
//   docker compose run --rm herramientas node src/scripts/recuento.js
import { crearKafka } from '../shared/kafka.js';
import { conectarMongo } from '../shared/mongo.js';
import { TOPICS } from '../shared/topics.js';
import { validar } from '../shared/esquemas.js';
import { leerHistorico } from './leer-historico.js';

const vistos = new Set();
const promesas = new Map();
const entregas = new Map();
const manual = { primerTotal: 0, primerExitos: 0, entregados: 0, fallos: 0, motivos: {}, enPlazo: 0, fueraDePlazo: 0 };
const porZona = {};
let invalidos = 0;
let duplicados = 0;

await leerHistorico(crearKafka('recuento'), [TOPICS.ESTADOS, TOPICS.PROMESAS], ({ topic, message }) => {
  const v = validar(topic, message.value?.toString() ?? '');
  if (!v.ok) return invalidos++;
  const ev = v.evento;
  if (vistos.has(ev.eventId)) return duplicados++;
  vistos.add(ev.eventId);
  if (ev.tipo === 'PROMESA_CREADA') return promesas.set(ev.shipmentId, Date.parse(ev.venceEn));
  const z = (porZona[ev.zonaId] ??= { primerTotal: 0, primerExitos: 0, fallos: 0 });
  if (ev.tipo === 'ENTREGADO') {
    manual.entregados++;
    entregas.set(ev.shipmentId, Date.parse(ev.ocurridoEn));
    if (ev.intento === 1) {
      manual.primerTotal++;
      manual.primerExitos++;
      z.primerTotal++;
      z.primerExitos++;
    }
  } else if (ev.tipo === 'ENTREGA_FALLIDA') {
    manual.fallos++;
    z.fallos++;
    manual.motivos[ev.motivo] = (manual.motivos[ev.motivo] || 0) + 1;
    if (ev.intento === 1) {
      manual.primerTotal++;
      z.primerTotal++;
    }
  }
});
for (const [sid, entregadoEn] of entregas) {
  if (!promesas.has(sid)) continue;
  if (entregadoEn <= promesas.get(sid)) manual.enPlazo++;
  else manual.fueraDePlazo++;
}

const { client, db } = await conectarMongo();
const [agg] = await db
  .collection('metricas_diarias')
  .aggregate([
    {
      $group: {
        _id: null,
        primerTotal: { $sum: '$primerIntento.total' },
        primerExitos: { $sum: '$primerIntento.exitos' },
        entregados: { $sum: '$entregados' },
        fallos: { $sum: '$fallos' },
        AUSENTE: { $sum: '$motivos.AUSENTE' },
        DIRECCION_INCORRECTA: { $sum: '$motivos.DIRECCION_INCORRECTA' },
        RECHAZADO: { $sum: '$motivos.RECHAZADO' },
        ZONA_INACCESIBLE: { $sum: '$motivos.ZONA_INACCESIBLE' },
        enPlazo: { $sum: '$sla.enPlazo' },
        fueraDePlazo: { $sum: '$sla.fueraDePlazo' },
      },
    },
  ])
  .toArray();
const zonasMongo = await db
  .collection('metricas_diarias')
  .aggregate([{ $group: { _id: '$zonaId', primerTotal: { $sum: '$primerIntento.total' }, primerExitos: { $sum: '$primerIntento.exitos' }, fallos: { $sum: '$fallos' } } }])
  .toArray();
await client.close();

const m = agg ?? {};
const filas = [
  ['Primer intento: total', manual.primerTotal, m.primerTotal ?? 0],
  ['Primer intento: éxitos', manual.primerExitos, m.primerExitos ?? 0],
  ['Entregados', manual.entregados, m.entregados ?? 0],
  ['Fallos', manual.fallos, m.fallos ?? 0],
  ...['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'].map((k) => [`Motivo ${k}`, manual.motivos[k] ?? 0, m[k] ?? 0]),
  ['SLA en plazo', manual.enPlazo, m.enPlazo ?? 0],
  ['SLA fuera de plazo', manual.fueraDePlazo, m.fueraDePlazo ?? 0],
];
for (const z of zonasMongo.sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
  const mz = porZona[z._id] ?? { primerTotal: 0, primerExitos: 0, fallos: 0 };
  filas.push([`${z._id} primer intento total`, mz.primerTotal, z.primerTotal]);
  filas.push([`${z._id} primer intento éxitos`, mz.primerExitos, z.primerExitos]);
  filas.push([`${z._id} fallos`, mz.fallos, z.fallos]);
}

console.log(`Eventos leídos: ${vistos.size} únicos, ${duplicados} duplicados descartados, ${invalidos} inválidos (DLQ).\n`);
console.table(filas.map(([indicador, recuento, mongo]) => ({ indicador, recuento, metricas_diarias: mongo, resultado: recuento === mongo ? 'OK' : 'DIFERENCIA' })));
const tasa = (e, t) => (t ? `${((100 * e) / t).toFixed(1)} %` : '-');
console.log(`Tasa de entrega en primer intento: ${tasa(manual.primerExitos, manual.primerTotal)}`);
console.log(`Cumplimiento de SLA: ${tasa(manual.enPlazo, manual.enPlazo + manual.fueraDePlazo)}`);
const ok = filas.every(([, a, b]) => a === b);
console.log(ok ? '\nTodos los indicadores coinciden con el recuento manual.' : '\nHay diferencias: ¿el simulador está pausado y el lag de analitica en 0?');
process.exit(ok ? 0 : 2);
