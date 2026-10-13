// Lógica pura del cuarto indicador. Cuenta cada envío una sola vez, cuando conoce ingreso y primera salida
// (que pueden llegar en cualquier orden si hubo un evento fuera de orden).
import { fechaLocal, aMs, MINUTO } from '../../shared/tiempo.js';

export function incrementoTiempoHub(st) {
  if (!st || st.contado || st.ingresoEn == null || st.salidaEn == null) return null;
  const minutos = Math.max(0, (aMs(st.salidaEn) - aMs(st.ingresoEn)) / MINUTO);
  return {
    clave: { fecha: fechaLocal(st.ingresoEn), hubId: st.hubId },
    inc: { sumaMinutos: Math.round(minutos * 100) / 100, cantidad: 1 },
  };
}
