'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useEventos, useAgrupado, EstadoConexion } from './useEventos';
import {
  fechaHora, horaReal, etiquetaSituacion, tonoSituacion, tonoPrioridad, etiquetaRegla, etiquetaMotivo, etiquetaFranja,
} from '@/lib/formato';

export default function DetalleEnVivo({ inicial }) {
  const [datos, setDatos] = useState(inicial);
  const id = inicial.envio.shipmentId;

  const refrescar = useAgrupado(async () => {
    const r = await fetch(`/api/envios/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (r.ok) setDatos(await r.json());
  }, 150);
  const conectado = useEventos(`/api/envios/${encodeURIComponent(id)}/stream`, refrescar);

  const { envio, alertas, notificaciones } = datos;
  const r = envio.resolucion;
  return (
    <>
      <div className="encabezado">
        <div>
          <h1 className="mono">{envio.shipmentId}</h1>
          <p>
            <span className={`insignia tono-${tonoSituacion(envio.situacion)}`}>{etiquetaSituacion(envio.situacion)}</span>{' '}
            · <Link href={`/tracking/${envio.shipmentId}`}>ver tracking público</Link>
          </p>
        </div>
        <EstadoConexion conectado={conectado} />
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <dl className="datos">
          <div><dt>Hub</dt><dd>{envio.hubId ?? '—'}</dd></div>
          <div><dt>Zona</dt><dd>{envio.zonaId ?? '—'}</dd></div>
          <div><dt>Repartidor</dt><dd>{envio.repartidorId ?? '—'}</dd></div>
          <div><dt>Intentos</dt><dd>{envio.intentos}</dd></div>
          <div><dt>Promesa vence</dt><dd>{fechaHora(envio.promesa?.venceEn)}</dd></div>
          <div><dt>Fecha estimada</dt><dd>{fechaHora(envio.fechaEstimada)}</dd></div>
          <div><dt>Última secuencia</dt><dd>{envio.secuencia}</dd></div>
          <div><dt>Notificaciones</dt><dd>{envio.notificaciones}</dd></div>
        </dl>
        {r && (
          <p className="destacado" style={{ marginTop: 16, marginBottom: 0 }}>
            <strong>{etiquetaSituacion(r.decision)}</strong> tras el intento {r.intento} ({etiquetaMotivo(r.motivo)}). {r.causa}
            {r.nuevaFecha && <> Nueva visita: {fechaHora(r.nuevaFecha)} ({etiquetaFranja(r.franja)}).</>}
          </p>
        )}
      </section>

      <div className="grilla mitades">
        <section className="panel">
          <h2>Línea de tiempo</h2>
          {envio.historial.length === 0 ? (
            <p className="vacio">Todavía no llegaron eventos de estado.</p>
          ) : (
            <ol className="linea">
              {envio.historial.map((h) => (
                <li key={h.eventId} className={h.tipo === 'ENTREGA_FALLIDA' ? 'mal' : h.tipo === 'ENTREGADO' ? 'ok' : ''}>
                  <strong>{etiquetaSituacion(h.tipo)}</strong>
                  {h.intento ? ` · intento ${h.intento}` : ''}
                  {h.motivo ? ` · ${etiquetaMotivo(h.motivo)}` : ''}
                  <div className="cuando">
                    {fechaHora(h.ocurridoEn)} · seq {h.secuencia} · llegó {horaReal(h.recibidoEn)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="grilla" style={{ alignContent: 'start' }}>
          <section className="panel">
            <h2>Alertas de SLA</h2>
            {alertas.length === 0 ? (
              <p className="vacio">Sin alertas.</p>
            ) : (
              <table>
                <tbody>
                  {alertas.map((a) => (
                    <tr key={a.alertaId}>
                      <td><span className={`insignia tono-${tonoPrioridad(a.prioridad)}`}>{a.prioridad}</span></td>
                      <td>{etiquetaRegla(a.regla)}</td>
                      <td>{a.estado === 'ABIERTA' ? 'Abierta' : `Cerrada ${fechaHora(a.cerradaEn)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <h2>Notificaciones al destinatario</h2>
            {notificaciones.length === 0 ? (
              <p className="vacio">Sin notificaciones.</p>
            ) : (
              <ol className="linea">
                {notificaciones.map((n) => (
                  <li key={n.eventId}>
                    <strong>{n.canal}</strong> · {n.mensaje}
                    {n.opciones?.length > 0 && <div className="cuando">Opciones: {n.opciones.join(' · ')}</div>}
                    <div className="cuando">{fechaHora(n.enviadaEn)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
