// Utilidades de tiempo. Toda la simulación usa hora local de Argentina (UTC-3, sin horario de verano).
// Los instantes se manejan como milisegundos epoch; en los eventos viajan como ISO-8601 (UTC).

export const MINUTO = 60 * 1000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;
const DESFASE = -3 * HORA; // UTC-3

const aLocal = (ms) => new Date(ms + DESFASE); // leer con getUTC*

export const aMs = (v) => (typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(v));
export const iso = (ms) => new Date(ms).toISOString();

/** 'YYYY-MM-DD' en hora local. */
export function fechaLocal(ms) {
  return aLocal(aMs(ms)).toISOString().slice(0, 10);
}

/** Hora local con decimales (ej. 14.5 = 14:30). */
export function horaLocal(ms) {
  const d = aLocal(aMs(ms));
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

/** Día de la semana local: 0 = domingo ... 6 = sábado. */
export function diaSemana(ms) {
  return aLocal(aMs(ms)).getUTCDay();
}

/** Instante de las 00:00 locales del día que contiene a `ms`. */
export function inicioDiaLocal(ms) {
  const m = aMs(ms);
  const local = m + DESFASE;
  return local - (((local % DIA) + DIA) % DIA) - DESFASE;
}

export const esDiaHabil = (ms) => {
  const d = diaSemana(ms);
  return d >= 1 && d <= 5;
};

/** 00:00 local del primer día hábil POSTERIOR al día de `ms`. */
export function siguienteDiaHabil(ms) {
  let dia = inicioDiaLocal(ms) + DIA;
  while (!esDiaHabil(dia)) dia += DIA;
  return dia;
}

// Franjas horarias de reparto: mañana 08–14 h, tarde 14–20 h.
export const FRANJAS = { MANANA: { inicio: 8, fin: 14 }, TARDE: { inicio: 14, fin: 20 } };

export function franjaDe(ms) {
  return horaLocal(ms) < 14 ? 'MANANA' : 'TARDE';
}

export const franjaOpuesta = (f) => (f === 'MANANA' ? 'TARDE' : 'MANANA');

/** Instante de inicio de la franja en el día (00:00 local) dado. */
export function inicioFranja(diaMs, franja) {
  return inicioDiaLocal(diaMs) + FRANJAS[franja].inicio * HORA;
}

/** Próxima salida de reparto (08:00 o 14:00 de un día hábil) en o después de `ms`. */
export function proximaSalida(ms) {
  let dia = inicioDiaLocal(ms);
  for (let i = 0; i < 14; i++) {
    if (esDiaHabil(dia)) {
      for (const f of ['MANANA', 'TARDE']) {
        const t = inicioFranja(dia, f);
        if (t >= ms) return t;
      }
    }
    dia += DIA;
  }
  throw new Error('No se encontró una salida de reparto');
}
