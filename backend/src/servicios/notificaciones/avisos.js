// Lógica pura del servicio de notificaciones: qué aviso recibe el destinatario.
// El eventId es determinístico (deriva del evento de origen): si el servicio reprocesa el mismo
// evento, publica exactamente el mismo aviso y el proyector lo descarta como duplicado.
import { VERSION_ESQUEMA } from '../../shared/dominio.js';

const TEXTO_MOTIVO = {
  AUSENTE: 'no había nadie para recibirlo',
  DIRECCION_INCORRECTA: 'la dirección no es correcta',
  RECHAZADO: 'el paquete fue rechazado',
  ZONA_INACCESIBLE: 'no pudimos acceder a la zona',
};

const TEXTO_REGLA = {
  SIN_INGRESO: 'Tu envío todavía no llegó a nuestro centro de distribución y podría demorarse.',
  SIN_SALIDA: 'Tu envío podría no llegar a tiempo. Estamos priorizándolo.',
  FALLO_DIA_LIMITE: 'No pudimos entregar tu envío y hoy vence el plazo prometido. Te contactaremos.',
  VENCIDO: 'Tu envío está demorado. Disculpá las molestias: lo estamos resolviendo.',
};

/** Canal simulado, estable por envío. */
export function canalPara(shipmentId) {
  let h = 0;
  for (const c of shipmentId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? 'EMAIL' : 'SMS';
}

/** @returns {object|null} evento de notificaciones.enviadas, o null si no corresponde avisar. */
export function avisoPara(ev) {
  const comunes = {
    eventId: `notif-${ev.eventId}`,
    shipmentId: ev.shipmentId,
    tipo: 'NOTIFICACION',
    ocurridoEn: ev.ocurridoEn,
    hubId: ev.hubId ?? null,
    zonaId: ev.zonaId ?? null,
    repartidorId: null,
    version: VERSION_ESQUEMA,
    canal: canalPara(ev.shipmentId),
    origenEventId: ev.eventId,
  };
  if (ev.tipo === 'ENTREGA_FALLIDA') {
    return {
      ...comunes,
      causa: `ENTREGA_FALLIDA:${ev.motivo}`,
      mensaje: `Intentamos entregar tu envío ${ev.shipmentId} pero ${TEXTO_MOTIVO[ev.motivo]}. Elegí cómo seguimos.`,
      opciones: ['Reprogramar la visita', 'Retirar en sucursal', 'Corregir la dirección'],
    };
  }
  if (ev.tipo === 'ALERTA_ABIERTA') {
    return { ...comunes, causa: `ALERTA:${ev.regla}`, mensaje: TEXTO_REGLA[ev.regla], opciones: [] };
  }
  return null;
}
