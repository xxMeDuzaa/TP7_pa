// Formatos y etiquetas compartidos por servidor y cliente.
const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';

export function fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { timeZone: ZONA_HORARIA, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function hora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-AR', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit' });
}

export function horaReal(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-AR', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');

// Situaciones internas (torre de control) en el orden del flujo.
export const SITUACIONES = [
  ['CREADO', 'Creado'],
  ['INGRESADO_HUB', 'En el hub'],
  ['CLASIFICADO', 'Clasificado'],
  ['EN_REPARTO', 'En reparto'],
  ['ENTREGADO', 'Entregado'],
  ['ENTREGA_FALLIDA', 'Entrega fallida'],
  ['REPROGRAMADO', 'Reprogramado'],
  ['RETENIDO', 'Retenido'],
  ['DEVOLUCION', 'Devolución'],
];
export const etiquetaSituacion = (s) => Object.fromEntries(SITUACIONES)[s] ?? s ?? '—';

// Tono visual de cada situación (ver clases .tono-* en globals.css).
export const tonoSituacion = (s) =>
  ({
    ENTREGADO: 'ok',
    ENTREGA_FALLIDA: 'mal',
    REPROGRAMADO: 'aviso',
    RETENIDO: 'aviso',
    DEVOLUCION: 'mal',
    EN_REPARTO: 'info',
  })[s] ?? 'neutro';

export const tonoPrioridad = (p) => ({ CRITICA: 'critica', ALTA: 'mal', MEDIA: 'aviso' })[p] ?? 'neutro';

export const etiquetaRegla = (r) =>
  ({
    SIN_INGRESO: 'Sin ingreso al hub',
    SIN_SALIDA: 'Sin salida a reparto',
    FALLO_DIA_LIMITE: 'Fallo en el día límite',
    VENCIDO: 'Promesa vencida',
  })[r] ?? r;

export const etiquetaMotivo = (m) =>
  ({ AUSENTE: 'Ausente', DIRECCION_INCORRECTA: 'Dirección incorrecta', RECHAZADO: 'Rechazado', ZONA_INACCESIBLE: 'Zona inaccesible' })[m] ?? m;

export const etiquetaFranja = (f) => ({ MANANA: 'Mañana (8–14)', TARDE: 'Tarde (14–20)' })[f] ?? f;

// Vista pública (tracking): lenguaje para el destinatario, sin datos internos.
export const ETAPAS_PUBLICAS = [
  ['CREADO', 'Recibimos tu pedido'],
  ['INGRESADO_HUB', 'En el centro de distribución'],
  ['CLASIFICADO', 'Preparando la entrega'],
  ['EN_REPARTO', 'En camino'],
  ['ENTREGADO', 'Entregado'],
];
export const textoPublico = (s) =>
  ({
    CREADO: 'Recibimos tu pedido',
    INGRESADO_HUB: 'Tu paquete está en nuestro centro de distribución',
    CLASIFICADO: 'Estamos preparando la entrega',
    EN_REPARTO: '¡Tu paquete está en camino!',
    ENTREGADO: 'Entregado',
    ENTREGA_FALLIDA: 'No pudimos entregar tu paquete',
    REPROGRAMADO: 'Programamos una nueva visita',
    RETENIDO: 'Necesitamos confirmar tu dirección',
    DEVOLUCION: 'El paquete vuelve al comercio',
  })[s] ?? 'Sin información todavía';
