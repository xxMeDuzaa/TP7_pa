// Lógica pura del monitor de SLA (CU3).
//
// Estado interno por envío (construido desde envios.estados y envios.promesas):
//   { shipmentId, estado, secuencia, venceEn, hubId, zonaId, ultimoFalloEn, alertas: {REGLA: 'ABIERTA'|'CERRADA'}, cerrado, cierre }
// Un envío se cierra al ENTREGADO (o al pasar a devolución); al cerrarse se cierran sus alertas abiertas.
//
// El "ahora" NO es el reloj de la máquina: es el reloj simulado que viaja en los eventos
// (la marca de agua = mayor ocurridoEn visto), menos una tolerancia para eventos que llegan tarde.
import { REGLAS_SLA, VERSION_ESQUEMA } from '../../shared/dominio.js';
import { HORA, aMs, iso, fechaLocal } from '../../shared/tiempo.js';
import { decidirReprogramacion } from '../../shared/reglas-reprogramacion.js';

export const UMBRAL_SIN_INGRESO = 10 * HORA;
export const UMBRAL_SIN_SALIDA = 4 * HORA;

export function estadoInicial(shipmentId) {
  return { shipmentId, estado: null, secuencia: 0, venceEn: null, hubId: null, zonaId: null, ultimoFalloEn: null, alertas: {}, cerrado: false, cierre: null };
}

/** Aplica un evento al estado (muta `st`). Devuelve true si cambió algo. */
export function aplicarEvento(st, ev) {
  st.hubId ??= ev.hubId ?? null;
  st.zonaId ??= ev.zonaId ?? null;
  if (ev.tipo === 'PROMESA_CREADA') {
    const v = aMs(ev.venceEn);
    if (st.venceEn === v) return false;
    st.venceEn = v;
    return true;
  }
  if (ev.secuencia <= st.secuencia) return false; // fuera de orden o duplicado
  st.estado = ev.tipo;
  st.secuencia = ev.secuencia;
  if (ev.tipo === 'ENTREGA_FALLIDA') {
    st.ultimoFalloEn = aMs(ev.ocurridoEn);
    // Un envío que vuelve al comercio sale del circuito: ya no tiene sentido vigilar su promesa.
    // Se aplica la misma política compartida que usa el servicio de reprogramación.
    if (decidirReprogramacion(ev).decision === 'DEVOLUCION') {
      st.cerrado = true;
      st.cierre = 'DEVOLUCION';
    }
  }
  if (ev.tipo === 'ENTREGADO') {
    st.cerrado = true;
    st.cierre = 'ENTREGADO';
  }
  return true;
}

const ANTES_DE_INGRESO = [null, 'CREADO'];
const FUERA_DE_REPARTO = [null, 'CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'ENTREGA_FALLIDA'];

/** Reglas cuya condición se cumple ahora (sin mirar si ya se alertaron). */
export function reglasQueSeCumplen(st, ahora) {
  if (st.cerrado || st.venceEn == null) return [];
  const restante = st.venceEn - ahora;
  const r = [];
  if (restante > 0 && restante < UMBRAL_SIN_INGRESO && ANTES_DE_INGRESO.includes(st.estado)) r.push('SIN_INGRESO');
  if (restante > 0 && restante < UMBRAL_SIN_SALIDA && FUERA_DE_REPARTO.includes(st.estado)) r.push('SIN_SALIDA');
  if (st.estado === 'ENTREGA_FALLIDA' && st.ultimoFalloEn != null && fechaLocal(st.ultimoFalloEn) === fechaLocal(st.venceEn)) {
    r.push('FALLO_DIA_LIMITE');
  }
  if (restante <= 0) r.push('VENCIDO');
  return r;
}

/**
 * Decide qué alertas abrir y cuáles cerrar. Sin repetición: una regla ya alertada sobre
 * el mismo envío no vuelve a alertar.
 */
export function evaluar(st, ahora) {
  if (st.cerrado) {
    return { abrir: [], cerrar: Object.keys(st.alertas).filter((k) => st.alertas[k] === 'ABIERTA') };
  }
  return { abrir: reglasQueSeCumplen(st, ahora).filter((k) => !st.alertas[k]), cerrar: [] };
}

export function eventoAlerta(st, regla, tipo, momento) {
  const abierta = tipo === 'ALERTA_ABIERTA';
  return {
    eventId: `alerta-${st.shipmentId}-${regla}-${abierta ? 'abierta' : 'cerrada'}`,
    alertaId: `${st.shipmentId}:${regla}`,
    shipmentId: st.shipmentId,
    tipo,
    regla,
    prioridad: REGLAS_SLA[regla].prioridad,
    causa: REGLAS_SLA[regla].descripcion,
    ocurridoEn: iso(momento),
    venceEn: st.venceEn != null ? iso(st.venceEn) : null,
    hubId: st.hubId,
    zonaId: st.zonaId,
    repartidorId: null,
    version: VERSION_ESQUEMA,
  };
}

/** Evalúa y devuelve los eventos a publicar, marcando las alertas en el estado. */
export function evaluarYEmitir(st, ahora, momentoCierre = ahora) {
  const { abrir, cerrar } = evaluar(st, ahora);
  const eventos = [];
  for (const regla of abrir) {
    st.alertas[regla] = 'ABIERTA';
    eventos.push(eventoAlerta(st, regla, 'ALERTA_ABIERTA', ahora));
  }
  for (const regla of cerrar) {
    st.alertas[regla] = 'CERRADA';
    eventos.push(eventoAlerta(st, regla, 'ALERTA_CERRADA', momentoCierre));
  }
  return eventos;
}
