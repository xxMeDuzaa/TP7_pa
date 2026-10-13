// Cambios en envios y alertas para la torre de control.
import { respuestaSSE } from '@/lib/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request) {
  return respuestaSSE(request, {
    pipeline: [{ $match: { 'ns.coll': { $in: ['envios', 'alertas'] }, operationType: { $in: ['insert', 'update', 'replace'] } } }],
    transformar: (c) => ({
      coleccion: c.ns.coll,
      shipmentId: c.fullDocument?.shipmentId,
      // Momento en que el evento llegó a Kafka: permite medir la latencia evento -> pantalla.
      recibidoEn: c.ns.coll === 'envios' ? c.fullDocument?.ultimoEvento?.recibidoEn ?? null : null,
    }),
  });
}
