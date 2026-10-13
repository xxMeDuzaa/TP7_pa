import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarEstado, aplicarPromesa, aplicarReprogramacion, aplicarAlerta, aplicarNotificacion } from '../src/servicios/proyector/proyeccion.js';
import { estadoInicial, aplicarEvento, evaluarYEmitir } from '../src/servicios/monitor-sla/reglas-sla.js';
import { incrementosDeEstado, incrementoSla } from '../src/servicios/analitica/metricas.js';
import { incrementoTiempoHub } from '../src/servicios/analitica-tiempo-hub/tiempo-hub.js';
import { avisoPara } from '../src/servicios/notificaciones/avisos.js';
import { eventoReprogramacion } from '../src/servicios/reprogramacion/evento.js';
import { validar } from '../src/shared/esquemas.js';
import { TOPICS } from '../src/shared/topics.js';
import { HORA } from '../src/shared/tiempo.js';

const T0 = Date.parse('2026-10-05T09:00:00-03:00');
const at = (h) => new Date(T0 + h * HORA).toISOString();
let n = 0;
const est = (tipo, secuencia, h, extra = {}) => ({
  eventId: `e${++n}`, shipmentId: 'S1', tipo, secuencia, ocurridoEn: at(h), hubId: 'HUB-SUR', zonaId: 'Z-S1', repartidorId: null, version: 1, ...extra,
});

// ------------------------------------------------------------------ proyector

test('proyector: aplica estados, descarta fuera de orden y no duplica historial', () => {
  let doc = aplicarEstado(null, est('CREADO', 1, 0)).doc;
  doc = aplicarEstado(doc, est('CLASIFICADO', 3, 2)).doc;
  const viejo = aplicarEstado(doc, est('INGRESADO_HUB', 2, 1));
  assert.match(viejo.descartado, /fuera de orden/);
  const dup = aplicarEstado(doc, { ...est('CLASIFICADO', 3, 2), eventId: doc.historial.at(-1).eventId });
  assert.ok(dup.descartado);
  assert.equal(doc.estado, 'CLASIFICADO');
  assert.equal(doc.historial.length, 2);
});

test('proyector: fallo + reprogramación => situación REPROGRAMADO, en cualquier orden', () => {
  const fallo = est('ENTREGA_FALLIDA', 5, 6, { motivo: 'AUSENTE', intento: 1 });
  const reprog = eventoReprogramacion(fallo);
  const a = aplicarReprogramacion(aplicarEstado(null, fallo).doc, reprog).doc;
  const b = aplicarEstado(aplicarReprogramacion(null, reprog).doc, fallo).doc;
  assert.equal(a.situacion, 'REPROGRAMADO');
  assert.deepEqual(a, b);
  assert.equal(a.fechaEstimada.toISOString(), reprog.nuevaFecha);
});

test('proyector: el resultado final no depende del intercalado entre topics', () => {
  const promesa = { eventId: 'p1', shipmentId: 'S1', tipo: 'PROMESA_CREADA', ocurridoEn: at(0), venceEn: at(30), hubId: 'HUB-SUR', zonaId: 'Z-S1', version: 1 };
  const alerta = { eventId: 'a1', alertaId: 'S1:SIN_SALIDA', shipmentId: 'S1', tipo: 'ALERTA_ABIERTA', regla: 'SIN_SALIDA', prioridad: 'ALTA', ocurridoEn: at(27), hubId: 'HUB-SUR', zonaId: 'Z-S1', version: 1 };
  const notif = avisoPara(alerta);
  const estados = [est('CREADO', 1, 0), est('INGRESADO_HUB', 2, 1)];
  // Dentro de un topic el orden se conserva (misma clave => misma partición); entre topics no.
  const otros = [
    (d) => aplicarPromesa(d, promesa).doc,
    (d) => aplicarAlerta(d, null, alerta).doc,
    (d) => aplicarNotificacion(d, notif).doc,
  ];
  const deEstados = estados.map((e) => (d) => aplicarEstado(d, e, { timestamp: 1000 + e.secuencia }).doc);
  const doc1 = [...otros, ...deEstados].reduce((d, f) => f(d), null);
  const doc2 = [deEstados[0], ...[...otros].reverse(), deEstados[1]].reduce((d, f) => f(d), null);
  assert.deepEqual(doc1, doc2);
  assert.equal(doc1.alertasAbiertas, 1);
  assert.equal(doc1.notificaciones, 1);
});

// ------------------------------------------------------------------ reprogramación y notificaciones

test('reprogramación y aviso: un fallo produce exactamente un evento de cada uno, determinístico y válido', () => {
  const fallo = est('ENTREGA_FALLIDA', 5, 6, { motivo: 'AUSENTE', intento: 1 });
  assert.deepEqual(eventoReprogramacion(fallo), eventoReprogramacion(fallo));
  assert.equal(validar(TOPICS.REPROGRAMACIONES, JSON.stringify(eventoReprogramacion(fallo))).ok, true);
  const aviso = avisoPara(fallo);
  assert.equal(aviso.eventId, `notif-${fallo.eventId}`);
  assert.equal(validar(TOPICS.NOTIFICACIONES, JSON.stringify(aviso)).ok, true);
  assert.equal(avisoPara(est('EN_REPARTO', 4, 5, { intento: 1 })), null);
  const tercero = eventoReprogramacion(est('ENTREGA_FALLIDA', 9, 30, { motivo: 'AUSENTE', intento: 3 }));
  assert.equal(tercero.tipo, 'DEVOLUCION');
});

// ------------------------------------------------------------------ monitor de SLA

const promesaEn = (h) => ({ tipo: 'PROMESA_CREADA', shipmentId: 'S1', venceEn: at(h), ocurridoEn: at(0), hubId: 'HUB-SUR', zonaId: 'Z-S1' });
const ms = (h) => T0 + h * HORA;

test('SLA: SIN_INGRESO (media) y SIN_SALIDA (alta) por paso del tiempo, sin repetirse', () => {
  const st = estadoInicial('S1');
  aplicarEvento(st, est('CREADO', 1, 0));
  aplicarEvento(st, promesaEn(20));
  assert.deepEqual(evaluarYEmitir(st, ms(5)), []); // faltan 15 h
  const a = evaluarYEmitir(st, ms(11)); // faltan 9 h y no ingresó
  assert.deepEqual(a.map((e) => [e.regla, e.prioridad]), [['SIN_INGRESO', 'MEDIA']]);
  assert.deepEqual(evaluarYEmitir(st, ms(12)), []); // sin repetición
  aplicarEvento(st, est('INGRESADO_HUB', 2, 12));
  const b = evaluarYEmitir(st, ms(17)); // faltan 3 h y no salió
  assert.deepEqual(b.map((e) => [e.regla, e.prioridad]), [['SIN_SALIDA', 'ALTA']]);
  for (const e of [...a, ...b]) assert.equal(validar(TOPICS.ALERTAS, JSON.stringify(e)).ok, true);
});

test('SLA: VENCIDO (crítica) y cierre de todas las alertas al entregar', () => {
  const st = estadoInicial('S1');
  aplicarEvento(st, promesaEn(20));
  aplicarEvento(st, est('CREADO', 1, 0));
  aplicarEvento(st, est('INGRESADO_HUB', 2, 1));
  const v = evaluarYEmitir(st, ms(21));
  assert.deepEqual(v.map((e) => e.regla), ['VENCIDO']);
  assert.equal(v[0].prioridad, 'CRITICA');
  aplicarEvento(st, est('ENTREGADO', 3, 22, { intento: 1 }));
  const c = evaluarYEmitir(st, ms(22));
  assert.deepEqual(c.map((e) => [e.tipo, e.regla]), [['ALERTA_CERRADA', 'VENCIDO']]);
  assert.deepEqual(evaluarYEmitir(st, ms(23)), []);
});

test('SLA: FALLO_DIA_LIMITE cuando el fallo ocurre el día del vencimiento', () => {
  const st = estadoInicial('S1');
  aplicarEvento(st, promesaEn(11)); // lunes 20:00
  aplicarEvento(st, est('EN_REPARTO', 4, 5, { intento: 1 }));
  aplicarEvento(st, est('ENTREGA_FALLIDA', 5, 6, { motivo: 'AUSENTE', intento: 1 })); // lunes 15:00
  const r = evaluarYEmitir(st, ms(6));
  assert.ok(r.some((e) => e.regla === 'FALLO_DIA_LIMITE' && e.prioridad === 'ALTA'));
});

test('SLA: la devolución al comercio cierra el envío y sus alertas', () => {
  const st = estadoInicial('S1');
  aplicarEvento(st, promesaEn(20));
  aplicarEvento(st, est('ENTREGA_FALLIDA', 5, 2, { motivo: 'AUSENTE', intento: 1 }));
  assert.deepEqual(evaluarYEmitir(st, ms(17)).map((e) => e.regla), ['SIN_SALIDA']);
  aplicarEvento(st, est('ENTREGA_FALLIDA', 9, 18, { motivo: 'RECHAZADO', intento: 2 }));
  assert.equal(st.cierre, 'DEVOLUCION');
  assert.deepEqual(evaluarYEmitir(st, ms(25)).map((e) => [e.tipo, e.regla]), [['ALERTA_CERRADA', 'SIN_SALIDA']]);
});

test('SLA: los eventos fuera de orden no hacen retroceder el estado del monitor', () => {
  const st = estadoInicial('S1');
  aplicarEvento(st, est('EN_REPARTO', 4, 5, { intento: 1 }));
  assert.equal(aplicarEvento(st, est('CREADO', 1, 0)), false);
  assert.equal(st.estado, 'EN_REPARTO');
});

// ------------------------------------------------------------------ analítica

test('analítica: incrementos por evento y SLA en cualquier orden', () => {
  const ok = incrementosDeEstado(est('ENTREGADO', 5, 5, { intento: 1 }));
  assert.deepEqual(ok.inc, { entregados: 1, 'primerIntento.total': 1, 'primerIntento.exitos': 1 });
  assert.deepEqual(ok.clave, { fecha: '2026-10-05', zonaId: 'Z-S1', franja: 'TARDE' });
  const f = incrementosDeEstado(est('ENTREGA_FALLIDA', 5, 1, { motivo: 'RECHAZADO', intento: 1 }));
  assert.deepEqual(f.inc, { fallos: 1, 'motivos.RECHAZADO': 1, 'primerIntento.total': 1 });
  assert.equal(f.clave.franja, 'MANANA');
  assert.equal(incrementosDeEstado(est('CREADO', 1, 0)), null);

  assert.equal(incrementoSla({ venceEn: at(10) }), null);
  assert.deepEqual(incrementoSla({ venceEn: at(10), entregadoEn: at(5), zonaId: 'Z-S1', hubId: 'HUB-SUR' }).inc, { 'sla.enPlazo': 1 });
  assert.deepEqual(incrementoSla({ venceEn: at(10), entregadoEn: at(12), zonaId: 'Z-S1' }).inc, { 'sla.fueraDePlazo': 1 });
  assert.equal(incrementoSla({ venceEn: at(10), entregadoEn: at(5), slaContado: true }), null);
});

test('cuarto indicador: minutos entre ingreso al hub y primera salida', () => {
  assert.equal(incrementoTiempoHub({ ingresoEn: at(1) }), null);
  const r = incrementoTiempoHub({ ingresoEn: at(1), salidaEn: at(3.5), hubId: 'HUB-SUR' });
  assert.deepEqual(r, { clave: { fecha: '2026-10-05', hubId: 'HUB-SUR' }, inc: { sumaMinutos: 150, cantidad: 1 } });
});
