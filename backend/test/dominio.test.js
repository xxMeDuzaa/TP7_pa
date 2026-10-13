import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fechaLocal, franjaDe, siguienteDiaHabil, inicioFranja, proximaSalida, iso, HORA } from '../src/shared/tiempo.js';
import { decidirReprogramacion } from '../src/shared/reglas-reprogramacion.js';
import { validar } from '../src/shared/esquemas.js';
import { TOPICS } from '../src/shared/topics.js';

const ms = (s) => Date.parse(s);

test('tiempo: fecha y franja en hora local (UTC-3)', () => {
  assert.equal(fechaLocal('2026-10-06T02:00:00Z'), '2026-10-05'); // 23:00 del lunes en Argentina
  assert.equal(franjaDe('2026-10-05T13:59:00-03:00'), 'MANANA');
  assert.equal(franjaDe('2026-10-05T14:00:00-03:00'), 'TARDE');
});

test('tiempo: día hábil siguiente saltea el fin de semana', () => {
  const viernes = ms('2026-10-09T15:00:00-03:00');
  assert.equal(iso(siguienteDiaHabil(viernes)), iso(ms('2026-10-12T00:00:00-03:00')));
  assert.equal(iso(inicioFranja(siguienteDiaHabil(viernes), 'TARDE')), iso(ms('2026-10-12T14:00:00-03:00')));
});

test('tiempo: próxima salida de reparto', () => {
  assert.equal(iso(proximaSalida(ms('2026-10-05T09:00:00-03:00'))), iso(ms('2026-10-05T14:00:00-03:00')));
  assert.equal(iso(proximaSalida(ms('2026-10-05T15:00:00-03:00'))), iso(ms('2026-10-06T08:00:00-03:00')));
  assert.equal(iso(proximaSalida(ms('2026-10-10T10:00:00-03:00'))), iso(ms('2026-10-12T08:00:00-03:00'))); // sábado -> lunes
});

test('reprogramación: AUSENTE va al día hábil siguiente en la franja opuesta', () => {
  const d = decidirReprogramacion({ motivo: 'AUSENTE', intento: 1, ocurridoEn: '2026-10-05T10:30:00-03:00' });
  assert.equal(d.decision, 'REPROGRAMADO');
  assert.equal(d.franja, 'TARDE');
  assert.equal(d.nuevaFecha, iso(ms('2026-10-06T14:00:00-03:00')));
  const v = decidirReprogramacion({ motivo: 'AUSENTE', intento: 2, ocurridoEn: '2026-10-09T16:00:00-03:00' }); // viernes tarde
  assert.equal(v.franja, 'MANANA');
  assert.equal(v.nuevaFecha, iso(ms('2026-10-12T08:00:00-03:00')));
});

test('reprogramación: cada motivo aplica su regla y el tercer fallo devuelve', () => {
  const t = '2026-10-05T10:00:00-03:00';
  assert.equal(decidirReprogramacion({ motivo: 'DIRECCION_INCORRECTA', intento: 1, ocurridoEn: t }).decision, 'RETENIDO');
  assert.equal(decidirReprogramacion({ motivo: 'RECHAZADO', intento: 1, ocurridoEn: t }).decision, 'DEVOLUCION');
  assert.equal(decidirReprogramacion({ motivo: 'ZONA_INACCESIBLE', intento: 1, ocurridoEn: t }).decision, 'REPROGRAMADO');
  for (const motivo of ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE']) {
    assert.equal(decidirReprogramacion({ motivo, intento: 3, ocurridoEn: t }).decision, 'DEVOLUCION');
  }
});

test('esquemas: eventos válidos e inválidos', () => {
  const ok = {
    eventId: 'e1', shipmentId: 's1', tipo: 'ENTREGA_FALLIDA', ocurridoEn: '2026-10-05T10:00:00Z',
    secuencia: 5, hubId: 'HUB-SUR', zonaId: 'Z-S1', repartidorId: 'R-001', version: 1, motivo: 'AUSENTE', intento: 1,
  };
  assert.equal(validar(TOPICS.ESTADOS, JSON.stringify(ok)).ok, true);
  assert.match(validar(TOPICS.ESTADOS, '{"eventId":').motivo, /JSON inválido/);
  assert.match(validar(TOPICS.ESTADOS, JSON.stringify({ ...ok, motivo: undefined })).motivo, /motivo/);
  assert.match(validar(TOPICS.ESTADOS, JSON.stringify({ ...ok, tipo: 'X' })).motivo, /tipo/);
  assert.match(validar(TOPICS.ESTADOS, JSON.stringify({ ...ok, secuencia: 'tres' })).motivo, /secuencia/);
  assert.match(validar(TOPICS.ESTADOS, JSON.stringify({ ...ok, ocurridoEn: undefined })).motivo, /ocurridoEn/);
});

test('horas', () => assert.equal(HORA, 3600000));
