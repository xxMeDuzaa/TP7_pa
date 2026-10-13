// Lógica pura del proyector (CU1): cómo cada evento modifica el documento del envío.
// No toca MongoDB ni Kafka, así se puede probar con tests unitarios.
//
// El resultado final de un envío no depende del orden en que se intercalan los distintos topics:
// historial ordenado por secuencia, resolución del intento más alto, alertas por regla, etc.
// Eso es lo que permite borrar la colección, reprocesar y obtener el mismo documento.
import { ORDEN_PRIORIDAD } from '../../shared/dominio.js';

const fecha = (iso) => (iso ? new Date(iso) : null);
const maxFecha = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

function base(doc, shipmentId) {
  if (doc) {
    const { _id, ...resto } = doc;
    return { ...resto };
  }
  return {
    shipmentId,
    estado: null,
    situacion: 'SIN_DATOS',
    secuencia: 0,
    intentos: 0,
    historial: [],
    alertas: [],
    alertasAbiertas: 0,
    notificaciones: 0,
    resolucion: null,
    promesa: null,
  };
}

/**
 * Situación visible: el estado del último evento, salvo que tras una ENTREGA_FALLIDA ya se conozca
 * la decisión de reprogramación de ese mismo intento (REPROGRAMADO / RETENIDO / DEVOLUCION).
 */
export function calcularSituacion(doc) {
  if (!doc.estado) return 'SIN_DATOS';
  if (doc.estado === 'ENTREGA_FALLIDA' && doc.resolucion && doc.resolucion.intento === doc.intentos) {
    return doc.resolucion.decision;
  }
  return doc.estado;
}

function terminar(doc) {
  doc.situacion = calcularSituacion(doc);
  doc.alertasAbiertas = doc.alertas.filter((a) => a.estado === 'ABIERTA').length;
  doc.fechaEstimada =
    doc.situacion === 'REPROGRAMADO' && doc.resolucion?.nuevaFecha ? doc.resolucion.nuevaFecha : doc.promesa?.venceEn ?? null;
  return doc;
}

/**
 * Evento de envios.estados.
 * Regla de orden: si la secuencia es <= a la ya aplicada, se descarta.
 * @returns {{doc: object} | {descartado: string}}
 */
export function aplicarEstado(docActual, ev, meta = {}) {
  if (docActual && docActual.secuencia >= ev.secuencia) {
    return { descartado: `fuera de orden: secuencia ${ev.secuencia} <= ${docActual.secuencia} ya aplicada` };
  }
  const doc = base(docActual, ev.shipmentId);
  const ocurrido = fecha(ev.ocurridoEn);
  const recibido = meta.timestamp ? new Date(meta.timestamp) : null;

  doc.estado = ev.tipo;
  doc.secuencia = ev.secuencia;
  doc.hubId = ev.hubId;
  doc.zonaId = ev.zonaId;
  if (ev.repartidorId) doc.repartidorId = ev.repartidorId;
  if (ev.intento && ['EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'].includes(ev.tipo)) {
    doc.intentos = Math.max(doc.intentos || 0, ev.intento);
  }
  if (ev.tipo === 'CREADO') doc.creadoEn = ocurrido;
  if (ev.tipo === 'ENTREGA_FALLIDA') doc.ultimoMotivo = ev.motivo;
  if (ev.tipo === 'ENTREGADO') doc.entregadoEn = ocurrido;

  doc.historial = [
    ...doc.historial.filter((h) => h.eventId !== ev.eventId),
    {
      eventId: ev.eventId,
      tipo: ev.tipo,
      secuencia: ev.secuencia,
      ocurridoEn: ocurrido,
      recibidoEn: recibido,
      ...(ev.motivo ? { motivo: ev.motivo } : {}),
      ...(ev.intento ? { intento: ev.intento } : {}),
      ...(ev.repartidorId ? { repartidorId: ev.repartidorId } : {}),
    },
  ].sort((a, b) => a.secuencia - b.secuencia);

  doc.ultimoEvento = { tipo: ev.tipo, ocurridoEn: ocurrido, recibidoEn: recibido };
  doc.ultimaActualizacion = maxFecha(doc.ultimaActualizacion, ocurrido);
  return { doc: terminar(doc) };
}

/** Evento de envios.promesas. */
export function aplicarPromesa(docActual, ev) {
  const doc = base(docActual, ev.shipmentId);
  doc.promesa = { venceEn: fecha(ev.venceEn), creadaEn: fecha(ev.ocurridoEn) };
  doc.hubId ??= ev.hubId;
  doc.zonaId ??= ev.zonaId;
  return { doc: terminar(doc) };
}

/** Evento de envios.reprogramaciones: gana la decisión del intento más alto. */
export function aplicarReprogramacion(docActual, ev) {
  const doc = base(docActual, ev.shipmentId);
  if (doc.resolucion && doc.resolucion.intento > ev.intento) {
    return { descartado: `reprogramación del intento ${ev.intento} anterior a la ya aplicada (${doc.resolucion.intento})` };
  }
  doc.resolucion = {
    decision: ev.tipo,
    intento: ev.intento,
    motivo: ev.motivo,
    causa: ev.causa ?? null,
    nuevaFecha: fecha(ev.nuevaFecha),
    franja: ev.franja ?? null,
    decididaEn: fecha(ev.ocurridoEn),
    eventId: ev.eventId,
  };
  doc.ultimaActualizacion = maxFecha(doc.ultimaActualizacion, fecha(ev.ocurridoEn));
  return { doc: terminar(doc) };
}

/** Evento de alertas.sla: devuelve el documento del envío y el de la colección alertas. */
export function aplicarAlerta(docActual, alertaActual, ev) {
  const doc = base(docActual, ev.shipmentId);
  const abierta = ev.tipo === 'ALERTA_ABIERTA';
  const momento = fecha(ev.ocurridoEn);

  const alerta = alertaActual
    ? (({ _id, ...a }) => ({ ...a }))(alertaActual)
    : {
        alertaId: ev.alertaId,
        shipmentId: ev.shipmentId,
        regla: ev.regla,
        prioridad: ev.prioridad,
        prioridadOrden: ORDEN_PRIORIDAD[ev.prioridad],
        causa: ev.causa ?? null,
        hubId: ev.hubId ?? doc.hubId ?? null,
        zonaId: ev.zonaId ?? doc.zonaId ?? null,
        venceEn: fecha(ev.venceEn),
        estado: 'ABIERTA',
        abiertaEn: abierta ? momento : null,
        cerradaEn: null,
      };
  if (abierta) {
    alerta.abiertaEn ??= momento;
  } else {
    alerta.estado = 'CERRADA';
    alerta.cerradaEn = momento;
  }

  const resumen = { regla: alerta.regla, prioridad: alerta.prioridad, estado: alerta.estado, abiertaEn: alerta.abiertaEn, cerradaEn: alerta.cerradaEn };
  doc.alertas = [...doc.alertas.filter((a) => a.regla !== alerta.regla), resumen].sort(
    (a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || a.regla.localeCompare(b.regla),
  );
  return { doc: terminar(doc), alerta };
}

/** Evento de notificaciones.enviadas. */
export function aplicarNotificacion(docActual, ev) {
  const doc = base(docActual, ev.shipmentId);
  doc.notificaciones = (doc.notificaciones || 0) + 1;
  const notificacion = {
    eventId: ev.eventId,
    shipmentId: ev.shipmentId,
    canal: ev.canal,
    causa: ev.causa,
    mensaje: ev.mensaje,
    opciones: ev.opciones ?? [],
    origenEventId: ev.origenEventId,
    enviadaEn: fecha(ev.ocurridoEn),
  };
  return { doc: terminar(doc), notificacion };
}
