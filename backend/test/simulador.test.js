import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotorSimulacion } from '../src/simulador/motor.js';
import { validar } from '../src/shared/esquemas.js';
import { TOPICS } from '../src/shared/topics.js';
import { HORA, DIA } from '../src/shared/tiempo.js';

const correr = (params, duracion = 2 * DIA) => {
  const m = new MotorSimulacion(params);
  return { m, salida: m.avanzarHasta(m.ahora + duracion) };
};

test('misma semilla => exactamente la misma corrida', () => {
  const a = correr({ semilla: 7 }).salida;
  const b = correr({ semilla: 7 }).salida;
  assert.deepEqual(a, b);
  const c = correr({ semilla: 8 }).salida;
  assert.notDeepEqual(a, c);
});

test('avanzar en pasos chicos o de una vez produce lo mismo', () => {
  const de_una = correr({ semilla: 3 }, DIA).salida;
  const m = new MotorSimulacion({ semilla: 3 });
  const t0 = m.ahora;
  const pasos = [];
  for (let t = t0; t <= t0 + DIA; t += 7 * 60 * 1000) pasos.push(...m.avanzarHasta(t));
  pasos.push(...m.avanzarHasta(t0 + DIA));
  assert.deepEqual(pasos, de_una);
});

test('volumen: 20 envíos por minuto real con 1 h simulada = 30 s', () => {
  const { m } = correr({ semilla: 1 }, 24 * HORA); // 24 h simuladas = 12 min reales => ~240 envíos
  assert.ok(m.stats.creados > 200 && m.stats.creados < 280, `creados=${m.stats.creados}`);
});

test('anomalías: hay duplicados, fuera de orden y malformados, y los malformados no validan', () => {
  const { m, salida } = correr({ semilla: 42 }, 4 * DIA);
  assert.ok(m.stats.duplicados > 0 && m.stats.fueraDeOrden > 0 && m.stats.malformados > 0);
  const invalidos = salida.filter((x) => !validar(x.topic, x.value).ok).length;
  assert.equal(invalidos, m.stats.malformados);
});

test('cada envío recorre estados con secuencia creciente y termina en un final válido', () => {
  const { salida } = correr({ semilla: 5, probDuplicado: 0, probFueraDeOrden: 0, probMalformado: 0 }, 6 * DIA);
  const porEnvio = new Map();
  for (const x of salida) {
    if (x.topic !== TOPICS.ESTADOS) continue;
    const e = JSON.parse(x.value);
    if (!porEnvio.has(e.shipmentId)) porEnvio.set(e.shipmentId, []);
    porEnvio.get(e.shipmentId).push(e);
  }
  let finalizados = 0;
  for (const evs of porEnvio.values()) {
    evs.forEach((e, i) => assert.equal(e.secuencia, i + 1));
    assert.equal(evs[0].tipo, 'CREADO');
    const ultimo = evs[evs.length - 1];
    if (ultimo.tipo === 'ENTREGADO' || ultimo.tipo === 'ENTREGA_FALLIDA') finalizados++;
    assert.ok(evs.filter((e) => e.tipo === 'EN_REPARTO').length <= 3, 'nunca más de 3 intentos');
  }
  assert.ok(finalizados > porEnvio.size * 0.6);
});

test('el fallo varía por zona y franja (más ausencias a la mañana)', () => {
  const { salida } = correr({ semilla: 11, probMalformado: 0 }, 10 * DIA);
  const r = { MANANA: [0, 0], TARDE: [0, 0] };
  for (const x of salida) {
    const e = JSON.parse(x.value);
    if (e.tipo !== 'ENTREGADO' && e.tipo !== 'ENTREGA_FALLIDA') continue;
    const h = (new Date(e.ocurridoEn).getUTCHours() + 21) % 24;
    const f = h < 14 ? 'MANANA' : 'TARDE';
    r[f][0] += e.tipo === 'ENTREGA_FALLIDA' ? 1 : 0;
    r[f][1]++;
  }
  assert.ok(r.MANANA[0] / r.MANANA[1] > r.TARDE[0] / r.TARDE[1]);
});

test('escenarios', () => {
  const m = new MotorSimulacion({ semilla: 1, enviosPorMinuto: 0.0001 });
  const tipos = (id, salida) => salida.filter((x) => x.key === id && x.topic === TOPICS.ESTADOS).map((x) => JSON.parse(x.value));

  const feliz = m.escenario('feliz');
  const out1 = [...feliz.salida, ...m.avanzarHasta(m.ahora + 4 * HORA)];
  assert.deepEqual(tipos(feliz.shipmentIds[0], out1).map((e) => e.tipo), ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO']);

  const tf = m.escenario('tercer-fallo');
  const out2 = [...tf.salida, ...m.avanzarHasta(m.ahora + 10 * HORA)];
  const fallos = tipos(tf.shipmentIds[0], out2).filter((e) => e.tipo === 'ENTREGA_FALLIDA');
  assert.deepEqual(fallos.map((e) => e.intento), [1, 2, 3]);

  const aus = m.escenario('ausente');
  const out3 = [...aus.salida, ...m.avanzarHasta(m.ahora + 4 * DIA)];
  const ev3 = tipos(aus.shipmentIds[0], out3);
  assert.equal(ev3.find((e) => e.tipo === 'ENTREGA_FALLIDA').motivo, 'AUSENTE');
  assert.equal(ev3.at(-1).tipo, 'ENTREGADO');
  assert.equal(ev3.at(-1).intento, 2);

  const r = m.escenario('rafaga');
  assert.equal(r.shipmentIds.length, 500);
  const mal = m.escenario('malformado');
  assert.equal(validar(TOPICS.ESTADOS, mal.salida[0].value).ok, false);
  assert.throws(() => m.escenario('inexistente'));
});
