'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useEventos, useAgrupado, EstadoConexion } from './useEventos';
import { SITUACIONES, tonoSituacion, tonoPrioridad, etiquetaRegla, etiquetaSituacion, fechaHora, horaReal } from '@/lib/formato';

export default function TorreEnVivo({ inicial }) {
  const [datos, setDatos] = useState(inicial);
  const [latencia, setLatencia] = useState(null);
  const vistos = useRef(new Set(inicial.ultimos.map((u) => u.shipmentId + u.ultimoEvento?.recibidoEn)));
  const [nuevos, setNuevos] = useState(new Set());

  const refrescar = useAgrupado(async () => {
    const r = await fetch('/api/torre', { cache: 'no-store' });
    if (!r.ok) return;
    const d = await r.json();
    const claves = d.ultimos.map((u) => u.shipmentId + u.ultimoEvento?.recibidoEn);
    setNuevos(new Set(claves.filter((k) => !vistos.current.has(k))));
    vistos.current = new Set(claves);
    setDatos(d);
  }, 250);

  const ultimoPorEnvio = useRef(new Map());
  const conectado = useEventos('/api/torre/stream', (cambio) => {
    // Latencia evento -> pantalla: desde que el simulador publicó el estado en Kafka hasta que el cambio
    // llega acá. Solo se mide cuando cambió el último estado (no por alertas o notificaciones).
    if (cambio.recibidoEn && ultimoPorEnvio.current.get(cambio.shipmentId) !== cambio.recibidoEn) {
      ultimoPorEnvio.current.set(cambio.shipmentId, cambio.recibidoEn);
      if (ultimoPorEnvio.current.size > 5000) ultimoPorEnvio.current.clear();
      setLatencia(Date.now() - new Date(cambio.recibidoEn).getTime());
    }
    refrescar();
  });

  const c = datos.contadores;
  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Torre de control</h1>
          <p>Estado de la operación en tiempo real. Reloj simulado: {fechaHora(datos.relojSimulado)}</p>
        </div>
        <div className="chips">
          <span className="chip">{datos.total} envíos</span>
          <span className="chip" title="Desde que el evento llegó a Kafka hasta que se vio en esta pantalla">
            Latencia: {latencia == null ? '—' : `${latencia} ms`}
          </span>
          <EstadoConexion conectado={conectado} />
        </div>
      </div>

      <div className="contadores">
        {SITUACIONES.map(([clave, nombre]) => (
          <div key={clave} className={`contador tono-${tonoSituacion(clave)}`}>
            <div className="valor">{c[clave] ?? 0}</div>
            <div className="nombre">{nombre}</div>
          </div>
        ))}
      </div>

      <div className="grilla dos">
        <section className="panel">
          <h2>Cola de alertas de SLA ({datos.totalAlertas})</h2>
          {datos.alertas.length === 0 ? (
            <p className="vacio">No hay alertas abiertas.</p>
          ) : (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Prioridad</th>
                    <th>Regla</th>
                    <th>Envío</th>
                    <th>Zona</th>
                    <th>Abierta</th>
                    <th>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.alertas.map((a) => (
                    <tr key={a.alertaId}>
                      <td>
                        <span className={`insignia tono-${tonoPrioridad(a.prioridad)}`}>{a.prioridad}</span>
                      </td>
                      <td>{etiquetaRegla(a.regla)}</td>
                      <td>
                        <Link href={`/envios/${a.shipmentId}`} className="mono">
                          {a.shipmentId}
                        </Link>
                      </td>
                      <td>{a.zonaId}</td>
                      <td>{fechaHora(a.abiertaEn)}</td>
                      <td>{fechaHora(a.venceEn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>Últimos eventos</h2>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Llegó</th>
                  <th>Envío</th>
                  <th>Situación</th>
                  <th>Zona</th>
                </tr>
              </thead>
              <tbody>
                {datos.ultimos.map((u) => (
                  <tr key={u.shipmentId} className={nuevos.has(u.shipmentId + u.ultimoEvento?.recibidoEn) ? 'nuevo' : ''}>
                    <td className="mono">{horaReal(u.ultimoEvento?.recibidoEn)}</td>
                    <td>
                      <Link href={`/envios/${u.shipmentId}`} className="mono">
                        {u.shipmentId}
                      </Link>
                    </td>
                    <td>
                      <span className={`insignia tono-${tonoSituacion(u.situacion)}`}>{etiquetaSituacion(u.situacion)}</span>
                    </td>
                    <td>{u.zonaId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
