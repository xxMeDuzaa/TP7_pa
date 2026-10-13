'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fechaHora } from '@/lib/formato';

const ESCENARIOS = [
  ['feliz', 'Envío feliz', 'Recorre todos los estados sin incidentes. Seguilo en el tracking público hasta ENTREGADO.'],
  ['ausente', 'Ausente', 'Falla por ausencia: aparecen la notificación, la reprogramación y el incremento en analítica.'],
  ['demorado', 'Demorado', 'Queda detenido en el hub. ~3 min reales después aparece la alerta ALTA, antes del vencimiento.'],
  ['tercer-fallo', 'Tercer fallo', 'Agota los tres intentos (tiempos comprimidos) y pasa a devolución al comercio.'],
  ['rafaga', 'Ráfaga', '500 envíos en pocos segundos: mirá la acumulación (lag) y cómo se recupera.'],
  ['malformado', 'Evento inválido', 'Inyecta un evento malformado: termina en la DLQ y el flujo no se detiene.'],
];

const PASOS = [
  ['5 · Caída de un servicio', 'docker compose stop notificaciones\ndocker compose run --rm herramientas node src/scripts/lag.js\ndocker compose start notificaciones'],
  ['6 · Ver la DLQ', 'docker compose run --rm herramientas node src/scripts/ver-dlq.js'],
  ['8 · Reprocesamiento (4.º indicador)', 'docker compose --profile reproceso up -d analitica-tiempo-hub'],
  [
    'Reconstrucción de envios',
    'docker compose run --rm herramientas node src/scripts/snapshot.js envios\ndocker compose stop proyector\ndocker compose run --rm herramientas node src/scripts/reprocesar.js proyector --solo-envios\ndocker compose start proyector\ndocker compose run --rm herramientas node src/scripts/snapshot.js envios',
  ],
  ['Recuento manual de indicadores', 'docker compose run --rm herramientas node src/scripts/recuento.js'],
];

export default function PanelDemo() {
  const [estado, setEstado] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [resultados, setResultados] = useState([]);

  const cargarEstado = async () => {
    try {
      const r = await fetch('/api/demo/estado', { cache: 'no-store' });
      setEstado(await r.json());
    } catch {
      setEstado({ error: 'Sin conexión con el servidor' });
    }
  };
  useEffect(() => {
    cargarEstado();
    const t = setInterval(cargarEstado, 2000);
    return () => clearInterval(t);
  }, []);

  const disparar = async (accion, nombre) => {
    setOcupado(accion);
    try {
      const r = await fetch(`/api/demo/${accion}`, { method: 'POST' });
      const d = await r.json();
      if (accion === 'pausa' || accion === 'reanudar') setEstado(d);
      else setResultados((prev) => [{ nombre, ...d, cuando: new Date().toLocaleTimeString('es-AR') }, ...prev].slice(0, 12));
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Panel de demo</h1>
          <p>Dispara los escenarios del simulador. No forma parte del producto: es la vista auxiliar para presentar.</p>
        </div>
        <div className="chips">
          {estado?.error ? (
            <span className="chip"><span className="punto caido" /> {estado.error}</span>
          ) : estado ? (
            <>
              <span className="chip"><span className={`punto ${estado.pausado ? '' : 'vivo'}`} /> {estado.pausado ? 'Pausado' : 'Corriendo'}</span>
              <span className="chip">Reloj simulado: {fechaHora(estado.simAhora)}</span>
              <span className="chip">×{estado.factor} · {estado.enviosPorMinuto} envíos/min</span>
              <span className="chip">Corrida {estado.corrida} · semilla {estado.semilla}</span>
            </>
          ) : null}
          {estado && !estado.error && (
            <button className="secundario" disabled={!!ocupado} onClick={() => disparar(estado.pausado ? 'reanudar' : 'pausa')}>
              {estado.pausado ? 'Reanudar flujo' : 'Pausar flujo'}
            </button>
          )}
        </div>
      </div>

      {estado?.estadisticas && (
        <div className="contadores">
          {[
            ['creados', 'Envíos del flujo'],
            ['creadosEscenario', 'Envíos de escenarios'],
            ['eventos', 'Mensajes publicados'],
            ['duplicados', 'Duplicados inyectados'],
            ['fueraDeOrden', 'Fuera de orden'],
            ['malformados', 'Malformados'],
          ].map(([k, n]) => (
            <div className="contador" key={k}>
              <div className="valor">{estado.estadisticas[k]}</div>
              <div className="nombre">{n}</div>
            </div>
          ))}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <h2>Escenarios</h2>
        <div className="escenarios">
          {ESCENARIOS.map(([accion, nombre, texto]) => (
            <div className="panel escenario" key={accion}>
              <div>
                <strong>{nombre}</strong>
                <p>{texto}</p>
              </div>
              <button disabled={!!ocupado} onClick={() => disparar(accion, nombre)}>
                {ocupado === accion ? 'Disparando…' : 'Disparar'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="grilla mitades">
        <section className="panel">
          <h2>Disparados</h2>
          {resultados.length === 0 ? (
            <p className="vacio">Todavía no disparaste escenarios.</p>
          ) : (
            <table>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.cuando}</td>
                    <td>{r.nombre}</td>
                    <td>
                      {r.error ? (
                        <span className="insignia tono-mal">{r.error}</span>
                      ) : r.cantidad > 1 ? (
                        `${r.cantidad} envíos`
                      ) : (
                        <>
                          <Link className="mono" href={`/envios/${r.shipmentIds[0]}`}>{r.shipmentIds[0]}</Link>
                          {' · '}
                          <Link href={`/tracking/${r.shipmentIds[0]}`}>tracking</Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Pasos que se hacen desde la terminal</h2>
          {PASOS.map(([t, cmd]) => (
            <div key={t} style={{ marginBottom: 12 }}>
              <strong>{t}</strong>
              <pre className="comando">{cmd}</pre>
            </div>
          ))}
          <p className="pie">
            Kafka UI (lag por grupo, mensajes de la DLQ): <a href="http://localhost:8080" target="_blank" rel="noreferrer">localhost:8080</a>
          </p>
        </section>
      </div>
    </>
  );
}
