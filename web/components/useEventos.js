'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Se suscribe a un endpoint SSE. Devuelve si la conexión está viva.
 * EventSource reconecta solo si el servidor se cae.
 */
export function useEventos(url, alCambio) {
  const [conectado, setConectado] = useState(false);
  const ref = useRef(alCambio);
  ref.current = alCambio;

  useEffect(() => {
    const es = new EventSource(url);
    es.addEventListener('listo', () => setConectado(true));
    es.addEventListener('cambio', (e) => ref.current(JSON.parse(e.data)));
    es.onerror = () => setConectado(false);
    return () => es.close();
  }, [url]);

  return conectado;
}

/** Ejecuta fn como mucho una vez cada `ms` (agrupa ráfagas de cambios). */
export function useAgrupado(fn, ms = 250) {
  const t = useRef(null);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  return () => {
    if (t.current) return;
    t.current = setTimeout(() => {
      t.current = null;
      ref.current();
    }, ms);
  };
}

export function EstadoConexion({ conectado }) {
  return (
    <span className="chip">
      <span className={`punto ${conectado ? 'vivo' : 'caido'}`} /> {conectado ? 'En vivo' : 'Reconectando…'}
    </span>
  );
}
