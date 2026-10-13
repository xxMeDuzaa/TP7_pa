import { datosTorre } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await datosTorre());
}
