export const dynamic = 'force-dynamic';

const SIMULADOR = process.env.SIMULADOR_URL || 'http://localhost:4000';

export async function GET() {
  try {
    const r = await fetch(`${SIMULADOR}/estado`, { cache: 'no-store' });
    return Response.json(await r.json());
  } catch (e) {
    return Response.json({ error: `El simulador no responde (${e.message})` }, { status: 502 });
  }
}
