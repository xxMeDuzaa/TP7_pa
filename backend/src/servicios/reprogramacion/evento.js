// Lógica pura: arma el evento de envios.reprogramaciones a partir de una ENTREGA_FALLIDA.
import { decidirReprogramacion } from '../../shared/reglas-reprogramacion.js';
import { VERSION_ESQUEMA } from '../../shared/dominio.js';

export function eventoReprogramacion(ev) {
  const d = decidirReprogramacion(ev);
  return {
    eventId: `reprog-${ev.eventId}`, // determinístico: un reintento produce el mismo evento
    shipmentId: ev.shipmentId,
    tipo: d.decision,
    ocurridoEn: ev.ocurridoEn,
    hubId: ev.hubId,
    zonaId: ev.zonaId,
    repartidorId: null,
    version: VERSION_ESQUEMA,
    intento: ev.intento,
    motivo: ev.motivo,
    causa: d.causa,
    origenEventId: ev.eventId,
    ...(d.nuevaFecha ? { nuevaFecha: d.nuevaFecha, franja: d.franja } : {}),
  };
}
