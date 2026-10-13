// Proxy hacia la API del simulador (vista auxiliar para la demo; no toca Kafka ni MongoDB).
export const dynamic = 'force-dynamic';

const SIMULADOR = process.env.SIMULADOR_URL || 'http://localhost:4000';
const PERMITIDAS = ['feliz', 'ausente', 'demorado', 'tercer-fallo', 'rafaga', 'malformado', 'pausa', 'reanudar'];

export async function POST(_req, { params }) {
  const accion = params.accion;
  if (!PERMITIDAS.includes(accion)) return Response.json({ error: 'acción desconocida' }, { status: 400 });
  const ruta = accion === 'pausa' || accion === 'reanudar' ? `/${accion}` : `/escenarios/${accion}`;
  try {
    const r = await fetch(`${SIMULADOR}${ruta}`, { method: 'POST', cache: 'no-store' });
    return Response.json(await r.json(), { status: r.status });
  } catch (e) {
    return Response.json({ error: `El simulador no responde (${e.message})` }, { status: 502 });
  }
}
