// Cambios de un envío (documento, sus alertas y sus notificaciones).
import { respuestaSSE } from '@/lib/sse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request, { params }) {
  const shipmentId = decodeURIComponent(params.id);
  return respuestaSSE(request, {
    pipeline: [
      {
        $match: {
          'ns.coll': { $in: ['envios', 'alertas', 'notificaciones'] },
          operationType: { $in: ['insert', 'update', 'replace'] },
          'fullDocument.shipmentId': shipmentId,
        },
      },
    ],
    transformar: (c) => ({ coleccion: c.ns.coll }),
  });
}
