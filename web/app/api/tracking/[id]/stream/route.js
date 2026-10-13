// Tracking público en vivo: se envía solo la vista pública ya filtrada (sin datos internos).
import { respuestaSSE } from '@/lib/sse';
import { vistaPublica } from '@/lib/consultas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(request, { params }) {
  const shipmentId = decodeURIComponent(params.id);
  return respuestaSSE(request, {
    pipeline: [
      {
        $match: {
          'ns.coll': 'envios',
          operationType: { $in: ['insert', 'update', 'replace'] },
          'fullDocument.shipmentId': shipmentId,
        },
      },
    ],
    transformar: (c) => vistaPublica(c.fullDocument),
  });
}
