'use client';
import { useState } from 'react';
import { useEventos, EstadoConexion } from './useEventos';
import { fechaHora } from '@/lib/formato';

export default function TrackingEnVivo({ inicial, shipmentId }) {
  const [vista, setVista] = useState(inicial);
  // El servidor ya manda la vista pública filtrada: se aplica tal cual llega.
  const conectado = useEventos(`/api/tracking/${encodeURIComponent(shipmentId)}/stream`, (v) => v && setVista(v));

  if (!vista) {
    return (
      <section className="panel tracking">
        <h1 className="mono">{shipmentId}</h1>
        <p className="vacio">Todavía no tenemos información de este envío. Esta página se actualiza sola.</p>
        <EstadoConexion conectado={conectado} />
      </section>
    );
  }

  return (
    <section className="panel tracking">
      <div className="chips" style={{ justifyContent: 'space-between' }}>
        <span className="mono">Envío {vista.shipmentId}</span>
        <EstadoConexion conectado={conectado} />
      </div>
      <div className="estado-grande">{vista.titulo}</div>
      {vista.situacion === 'ENTREGADO' ? (
        <p>Entregado el {fechaHora(vista.entregadoEn)}.</p>
      ) : vista.fechaEstimada ? (
        <p>
          Fecha estimada de entrega: <strong>{fechaHora(vista.fechaEstimada)}</strong>
        </p>
      ) : null}

      <div className="pasos">
        {vista.etapas.map((e) => (
          <div key={e.texto} className={`paso ${e.hecha ? 'hecho' : ''}`} />
        ))}
      </div>
      <div className="pasos-texto">
        {vista.etapas.map((e) => (
          <span key={e.texto}>{e.texto}</span>
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>Movimientos</h2>
      <ol className="linea">
        {[...vista.historial].reverse().map((h, i) => (
          <li key={i}>
            {h.texto}
            <div className="cuando">{fechaHora(h.ocurridoEn)}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
