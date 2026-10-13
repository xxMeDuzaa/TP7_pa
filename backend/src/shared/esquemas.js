// Validación de esquema de los eventos (JSON). Cada consumidor valida lo que lee:
// si un mensaje no cumple, va a envios.estados.dlq con el motivo y el consumo continúa.
//
// Los esquemas son declarativos (campo -> regla) y el validador es mínimo a propósito:
// sin dependencias extra y con mensajes de error legibles para la DLQ.
import { ESTADOS, MOTIVOS, DECISIONES, TIPOS_ALERTA, PRIORIDADES, REGLAS_SLA, VERSION_ESQUEMA } from './dominio.js';
import { TOPICS } from './topics.js';

const texto = { tipo: 'string' };
const textoOpcional = { tipo: 'string', opcional: true, nulo: true };
const fecha = { tipo: 'fecha' };
const entero = (min = 0) => ({ tipo: 'entero', min });
const uno = (valores) => ({ tipo: 'string', en: valores });

const COMUNES = {
  eventId: texto,
  shipmentId: texto,
  ocurridoEn: fecha,
  version: { tipo: 'entero', en: [VERSION_ESQUEMA] },
  hubId: textoOpcional,
  zonaId: textoOpcional,
  repartidorId: textoOpcional,
};

export const ESQUEMAS = {
  [TOPICS.ESTADOS]: {
    campos: { ...COMUNES, tipo: uno(ESTADOS), secuencia: entero(1), hubId: texto, zonaId: texto, intento: { ...entero(1), opcional: true } },
    porTipo: {
      ENTREGA_FALLIDA: { motivo: uno(MOTIVOS), intento: entero(1) },
      ENTREGADO: { intento: entero(1) },
      EN_REPARTO: { intento: entero(1) },
    },
  },
  [TOPICS.PROMESAS]: {
    campos: { ...COMUNES, tipo: uno(['PROMESA_CREADA']), venceEn: fecha },
  },
  [TOPICS.REPROGRAMACIONES]: {
    campos: { ...COMUNES, tipo: uno(DECISIONES), intento: entero(1), motivo: uno(MOTIVOS), origenEventId: texto },
    porTipo: { REPROGRAMADO: { nuevaFecha: fecha, franja: uno(['MANANA', 'TARDE']) } },
  },
  [TOPICS.ALERTAS]: {
    campos: { ...COMUNES, tipo: uno(TIPOS_ALERTA), regla: uno(Object.keys(REGLAS_SLA)), prioridad: uno(PRIORIDADES), alertaId: texto },
  },
  [TOPICS.NOTIFICACIONES]: {
    campos: { ...COMUNES, tipo: uno(['NOTIFICACION']), canal: uno(['EMAIL', 'SMS']), mensaje: texto, origenEventId: texto, causa: texto },
  },
  [TOPICS.DLQ]: {
    campos: { eventId: texto, tipo: uno(['EVENTO_INVALIDO']), motivo: texto },
  },
};

function validarCampo(nombre, regla, valor, errores) {
  if (valor === undefined || valor === null) {
    if (regla.opcional || (valor === null && regla.nulo)) return;
    errores.push(`falta el campo '${nombre}'`);
    return;
  }
  switch (regla.tipo) {
    case 'string':
      if (typeof valor !== 'string' || valor.length === 0) return errores.push(`'${nombre}' debe ser texto no vacío`);
      break;
    case 'entero':
      if (!Number.isInteger(valor)) return errores.push(`'${nombre}' debe ser entero`);
      if (regla.min !== undefined && valor < regla.min) return errores.push(`'${nombre}' debe ser >= ${regla.min}`);
      break;
    case 'fecha':
      if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) return errores.push(`'${nombre}' debe ser fecha ISO-8601`);
      break;
    default:
      errores.push(`regla desconocida para '${nombre}'`);
  }
  if (regla.en && !regla.en.includes(valor)) errores.push(`'${nombre}' = ${JSON.stringify(valor)} no es un valor permitido`);
}

/**
 * Valida el contenido crudo de un mensaje de `topic`.
 * @returns {{ok: true, evento: object} | {ok: false, motivo: string}}
 */
export function validar(topic, crudo) {
  const esquema = ESQUEMAS[topic];
  if (!esquema) return { ok: false, motivo: `topic sin esquema: ${topic}` };
  let evento;
  try {
    evento = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
  } catch (e) {
    return { ok: false, motivo: `JSON inválido: ${e.message}` };
  }
  if (!evento || typeof evento !== 'object' || Array.isArray(evento)) return { ok: false, motivo: 'el evento no es un objeto JSON' };
  const errores = [];
  for (const [nombre, regla] of Object.entries(esquema.campos)) validarCampo(nombre, regla, evento[nombre], errores);
  const extra = esquema.porTipo?.[evento.tipo];
  if (extra) for (const [nombre, regla] of Object.entries(extra)) validarCampo(nombre, regla, evento[nombre], errores);
  if (errores.length) return { ok: false, motivo: errores.join('; ') };
  return { ok: true, evento };
}
