// Lógica pura de la analítica (CU4). Traduce eventos en incrementos atómicos sobre metricas_diarias.
//
// Documento de metricas_diarias (clave única fecha + zonaId + franja):
//   { fecha, zonaId, franja, hubId,
//     primerIntento: { total, exitos },          -> tasa de entrega en primer intento
//     entregados, fallos, motivos: { AUSENTE, ... } -> distribución de motivos de fallo
//     sla: { enPlazo, fueraDePlazo } }           -> cumplimiento de SLA (por hub y día, sumando zonas)
//
// Fecha y franja salen del tiempo del evento (ocurridoEn), no de cuándo se procesó.
import { fechaLocal, franjaDe, aMs } from '../../shared/tiempo.js';

export const claveDe = (ev, momento = ev.ocurridoEn) => ({ fecha: fechaLocal(momento), zonaId: ev.zonaId, franja: franjaDe(momento) });

/** Incrementos directos de un evento de envios.estados. */
export function incrementosDeEstado(ev) {
  const inc = {};
  if (ev.tipo === 'ENTREGADO') {
    inc.entregados = 1;
    if (ev.intento === 1) {
      inc['primerIntento.total'] = 1;
      inc['primerIntento.exitos'] = 1;
    }
  } else if (ev.tipo === 'ENTREGA_FALLIDA') {
    inc.fallos = 1;
    inc[`motivos.${ev.motivo}`] = 1;
    if (ev.intento === 1) inc['primerIntento.total'] = 1;
  } else {
    return null;
  }
  return { clave: claveDe(ev), hubId: ev.hubId, inc };
}

/**
 * Cumplimiento de SLA: necesita cruzar la entrega con la promesa, que llegan por topics distintos
 * y en cualquier orden. Se guarda un estado mínimo por envío (analitica_envios) y se cuenta
 * una sola vez, cuando están las dos partes.
 * @param {object} st  { shipmentId, venceEn?, entregadoEn?, zonaId?, hubId?, slaContado? }
 * @returns {{clave, hubId, inc} | null}
 */
export function incrementoSla(st) {
  if (st.slaContado || st.venceEn == null || st.entregadoEn == null) return null;
  const enPlazo = aMs(st.entregadoEn) <= aMs(st.venceEn);
  return {
    clave: claveDe({ zonaId: st.zonaId }, st.entregadoEn),
    hubId: st.hubId,
    inc: { [enPlazo ? 'sla.enPlazo' : 'sla.fueraDePlazo']: 1 },
  };
}
