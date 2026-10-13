// Reglas de reprogramación (CU2). Función pura: la usa el servicio de reprogramación para decidir
// y el simulador (que representa al depósito) para ejecutar el nuevo intento según la política.
import { aMs, iso, siguienteDiaHabil, franjaDe, franjaOpuesta, inicioFranja } from './tiempo.js';

export const MAX_INTENTOS = 3;

/**
 * @param {{motivo: string, intento: number, ocurridoEn: string|number}} fallo
 * @returns {{decision: 'REPROGRAMADO'|'RETENIDO'|'DEVOLUCION', causa: string, nuevaFecha?: string, franja?: string}}
 */
export function decidirReprogramacion({ motivo, intento, ocurridoEn }) {
  if (intento >= MAX_INTENTOS) {
    return { decision: 'DEVOLUCION', causa: `Tercer intento fallido (${motivo}): devolución al comercio` };
  }
  const ms = aMs(ocurridoEn);
  switch (motivo) {
    case 'AUSENTE': {
      const franja = franjaOpuesta(franjaDe(ms));
      const nueva = inicioFranja(siguienteDiaHabil(ms), franja);
      return { decision: 'REPROGRAMADO', causa: 'Destinatario ausente: nuevo intento al día hábil siguiente en la franja opuesta', nuevaFecha: iso(nueva), franja };
    }
    case 'ZONA_INACCESIBLE': {
      // Supuesto propio (la especificación no lo define): reintento al día hábil siguiente en la misma franja.
      const franja = franjaDe(ms);
      const nueva = inicioFranja(siguienteDiaHabil(ms), franja);
      return { decision: 'REPROGRAMADO', causa: 'Zona inaccesible: nuevo intento al día hábil siguiente en la misma franja', nuevaFecha: iso(nueva), franja };
    }
    case 'DIRECCION_INCORRECTA':
      return { decision: 'RETENIDO', causa: 'Dirección incorrecta: retenido en el hub hasta que se corrija' };
    case 'RECHAZADO':
      return { decision: 'DEVOLUCION', causa: 'Rechazado por el destinatario: devolución al comercio' };
    default:
      throw new Error(`Motivo desconocido: ${motivo}`);
  }
}
