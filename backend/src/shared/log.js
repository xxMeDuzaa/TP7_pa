// Logs en una línea JSON: fáciles de filtrar con `docker compose logs <servicio> | findstr eventId`.
export function crearLogger(servicio) {
  const emitir = (nivel, mensaje, extra = {}) => {
    const linea = { ts: new Date().toISOString(), nivel, servicio, mensaje, ...extra };
    const salida = nivel === 'error' ? console.error : console.log;
    salida(JSON.stringify(linea));
  };
  return {
    info: (m, e) => emitir('info', m, e),
    warn: (m, e) => emitir('warn', m, e),
    error: (m, e) => emitir('error', m, e),
  };
}
