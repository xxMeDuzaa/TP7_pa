import { datosEnvio } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const datos = await datosEnvio(decodeURIComponent(params.id));
  if (!datos) return Response.json({ error: 'envío inexistente' }, { status: 404 });
  return Response.json(datos);
}
