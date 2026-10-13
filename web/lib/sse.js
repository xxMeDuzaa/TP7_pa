// Server-Sent Events a partir de un change stream de MongoDB.
// Flujo de un solo sentido (servidor -> navegador), sin infraestructura adicional.
// Requiere que MongoDB corra como replica set (aunque sea de un nodo).
import { getDb } from './mongo';

export function respuestaSSE(request, { pipeline, transformar }) {
  const codificador = new TextEncoder();
  let cambios = null;
  let latido = null;
  let cerrado = false;

  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (evento, datos) => {
        if (cerrado) return;
        try {
          controller.enqueue(codificador.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
        } catch {
          cerrar();
        }
      };
      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        clearInterval(latido);
        cambios?.close().catch(() => {});
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener('abort', cerrar);

      try {
        const db = await getDb();
        cambios = db.watch(pipeline, { fullDocument: 'updateLookup' });
        cambios.on('change', (cambio) => {
          const datos = transformar(cambio);
          if (datos !== undefined) enviar('cambio', datos);
        });
        cambios.on('error', (e) => {
          enviar('error', { mensaje: e.message });
          cerrar();
        });
        enviar('listo', { ok: true });
        latido = setInterval(() => {
          if (!cerrado) controller.enqueue(codificador.encode(': latido\n\n'));
        }, 15000);
      } catch (e) {
        enviar('error', { mensaje: e.message });
        cerrar();
      }
    },
    cancel() {
      cerrado = true;
      clearInterval(latido);
      cambios?.close().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
