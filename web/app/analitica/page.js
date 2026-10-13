import { datosAnalitica } from '@/lib/consultas';
import { etiquetaFranja, etiquetaMotivo, pct } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];
const COLOR_MOTIVO = { AUSENTE: '#c0533f', DIRECCION_INCORRECTA: '#d39a2c', RECHAZADO: '#5b6fb0', ZONA_INACCESIBLE: '#6f8b78' };
const MUESTRA_MINIMA = 5;

/** Color de una tasa (0..1): de rojo (baja) a verde (alta). */
function colorTasa(t) {
  if (t == null) return 'transparent';
  const x = Math.max(0, Math.min(1, (t - 0.6) / 0.4));
  const hue = Math.round(5 + x * 135);
  return `hsla(${hue}, 60%, 45%, 0.22)`;
}

export default async function Analitica({ searchParams }) {
  const filtros = { zona: searchParams.zona || '', hub: searchParams.hub || '', desde: searchParams.desde || '', hasta: searchParams.hasta || '' };
  const d = await datosAnalitica(filtros);

  // Tabla zona x franja
  const zonas = [...new Set(d.porZonaFranja.map((x) => x._id.zona))].sort();
  const celda = (zona, franja) => d.porZonaFranja.find((x) => x._id.zona === zona && x._id.franja === franja);
  const peor = d.porZonaFranja
    .filter((x) => x.total >= MUESTRA_MINIMA)
    .map((x) => ({ ...x, tasa: x.exitos / x.total }))
    .sort((a, b) => a.tasa - b.tasa)[0];
  const motivosPeor = peor && d.motivos.find((m) => m._id === peor._id.zona);
  const motivoDominante = motivosPeor && MOTIVOS.reduce((a, b) => (motivosPeor[b] > motivosPeor[a] ? b : a), MOTIVOS[0]);

  const totalPrimer = d.porDia.reduce((a, x) => [a[0] + x.exitos, a[1] + x.total], [0, 0]);
  const totalSla = d.sla.reduce((a, x) => [a[0] + x.enPlazo, a[1] + x.enPlazo + x.fuera], [0, 0]);
  const totalFallos = d.motivos.reduce((a, x) => a + x.fallos, 0);
  const maxFallos = Math.max(1, ...d.motivos.map((m) => m.fallos));
  const hubsSla = [...new Set(d.sla.map((x) => x._id.hub))].filter(Boolean).sort();
  const fechasSla = [...new Set(d.sla.map((x) => x._id.fecha))].sort();
  const hubsTiempo = [...new Set(d.tiempoHub.map((x) => x._id.hub))].sort();

  return (
    <>
      <div className="encabezado">
        <div>
          <h1>Analítica de mejora</h1>
          <p>Agregados precalculados en metricas_diarias por la analítica (incrementos atómicos). Se actualiza al cargar.</p>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <form className="filtros">
          <label>
            Zona
            <select name="zona" defaultValue={filtros.zona}>
              <option value="">Todas</option>
              {d.opciones.zonas.map((z) => <option key={z}>{z}</option>)}
            </select>
          </label>
          <label>
            Hub
            <select name="hub" defaultValue={filtros.hub}>
              <option value="">Todos</option>
              {d.opciones.hubs.map((h) => <option key={h}>{h}</option>)}
            </select>
          </label>
          <label>
            Desde
            <select name="desde" defaultValue={filtros.desde}>
              <option value="">—</option>
              {d.opciones.fechas.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>
            Hasta
            <select name="hasta" defaultValue={filtros.hasta}>
              <option value="">—</option>
              {d.opciones.fechas.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <button type="submit">Filtrar</button>
          <a className="boton secundario" href="/analitica">Limpiar</a>
        </form>
      </section>

      {peor && (
        <div className="destacado">
          <strong>Dónde fallamos más:</strong> {peor._id.zona}, franja {etiquetaFranja(peor._id.franja)}, con {pct(peor.exitos, peor.total)} de
          entregas en primer intento ({peor.total} intentos). Motivo principal en la zona: {etiquetaMotivo(motivoDominante)}.
          {peor._id.franja === 'MANANA' && motivoDominante === 'AUSENTE' && (
            <> Mejora sugerida: <strong>ofrecer la franja vespertina en {peor._id.zona}</strong>.</>
          )}
        </div>
      )}

      <div className="contadores">
        <div className="contador tono-info"><div className="valor">{pct(totalPrimer[0], totalPrimer[1])}</div><div className="nombre">Entrega en primer intento</div></div>
        <div className="contador tono-ok"><div className="valor">{pct(totalSla[0], totalSla[1])}</div><div className="nombre">Cumplimiento de SLA</div></div>
        <div className="contador tono-mal"><div className="valor">{totalFallos}</div><div className="nombre">Entregas fallidas</div></div>
        <div className="contador"><div className="valor">{totalPrimer[1]}</div><div className="nombre">Primeros intentos</div></div>
      </div>

      <div className="grilla mitades">
        <section className="panel">
          <h2>1 · Tasa de entrega en primer intento</h2>
          <p className="pie" style={{ marginTop: -6 }}>¿Dónde y cuándo fallamos más? Zona × franja horaria.</p>
          {zonas.length === 0 ? (
            <p className="vacio">Sin datos todavía.</p>
          ) : (
            <div className="tabla-scroll">
              <table className="calor">
                <thead>
                  <tr>
                    <th>Zona</th>
                    <th className="num">{etiquetaFranja('MANANA')}</th>
                    <th className="num">{etiquetaFranja('TARDE')}</th>
                  </tr>
                </thead>
                <tbody>
                  {zonas.map((z) => (
                    <tr key={z}>
                      <td>{z}</td>
                      {['MANANA', 'TARDE'].map((f) => {
                        const c = celda(z, f);
                        const t = c && c.total ? c.exitos / c.total : null;
                        return (
                          <td key={f} className="celda" style={{ background: colorTasa(t) }} title={c ? `${c.exitos}/${c.total}` : ''}>
                            {c ? pct(c.exitos, c.total) : '—'} <span className="pie">({c?.total ?? 0})</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.porDia.length > 0 && (
            <>
              <h2 style={{ marginTop: 20 }}>Por día</h2>
              <div className="barras">
                {d.porDia.map((x) => (
                  <div className="barra-fila" key={x._id}>
                    <span className="mono">{x._id.slice(5)}</span>
                    <div className="barra-pista">
                      <span style={{ width: `${x.total ? (100 * x.exitos) / x.total : 0}%`, background: 'var(--acento)' }} />
                    </div>
                    <span className="num">{pct(x.exitos, x.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>2 · Distribución de motivos de fallo</h2>
          <p className="pie" style={{ marginTop: -6 }}>¿Por qué fallamos? Por zona.</p>
          {d.motivos.length === 0 ? (
            <p className="vacio">Sin fallos registrados.</p>
          ) : (
            <>
              <div className="barras">
                {d.motivos.map((m) => (
                  <div className="barra-fila" key={m._id}>
                    <span>{m._id}</span>
                    <div className="barra-pista" title={MOTIVOS.map((k) => `${etiquetaMotivo(k)}: ${m[k]}`).join(' · ')}>
                      {MOTIVOS.map((k) => (
                        <span key={k} style={{ width: `${(100 * m[k]) / maxFallos}%`, background: COLOR_MOTIVO[k] }} />
                      ))}
                    </div>
                    <span className="num">{m.fallos}</span>
                  </div>
                ))}
              </div>
              <div className="leyenda">
                {MOTIVOS.map((k) => (
                  <span key={k}>
                    <i style={{ background: COLOR_MOTIVO[k] }} />
                    {etiquetaMotivo(k)} ({d.motivos.reduce((a, m) => a + m[k], 0)})
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2>3 · Cumplimiento de SLA</h2>
          <p className="pie" style={{ marginTop: -6 }}>¿Qué hub llega tarde? Entregados dentro de la promesa, por hub y día.</p>
          {hubsSla.length === 0 ? (
            <p className="vacio">Sin entregas todavía.</p>
          ) : (
            <div className="tabla-scroll">
              <table className="calor">
                <thead>
                  <tr>
                    <th>Día</th>
                    {hubsSla.map((h) => <th key={h} className="num">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {fechasSla.map((f) => (
                    <tr key={f}>
                      <td className="mono">{f}</td>
                      {hubsSla.map((h) => {
                        const x = d.sla.find((s) => s._id.fecha === f && s._id.hub === h);
                        const tot = x ? x.enPlazo + x.fuera : 0;
                        return (
                          <td key={h} className="celda" style={{ background: colorTasa(tot ? x.enPlazo / tot : null) }} title={x ? `${x.enPlazo}/${tot}` : ''}>
                            {tot ? pct(x.enPlazo, tot) : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2>4 · Tiempo medio en hub (reprocesamiento)</h2>
          <p className="pie" style={{ marginTop: -6 }}>
            Minutos entre INGRESADO_HUB y la primera salida EN_REPARTO, por hub. Lo calcula un grupo de consumidores nuevo que lee el histórico.
          </p>
          {hubsTiempo.length === 0 ? (
            <div className="vacio">
              Indicador no activado. Levantalo con
              <pre className="comando">docker compose --profile reproceso up -d analitica-tiempo-hub</pre>
            </div>
          ) : (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    {hubsTiempo.map((h) => <th key={h} className="num">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(d.tiempoHub.map((x) => x._id.fecha))].sort().map((f) => (
                    <tr key={f}>
                      <td className="mono">{f}</td>
                      {hubsTiempo.map((h) => {
                        const x = d.tiempoHub.find((t) => t._id.fecha === f && t._id.hub === h);
                        return <td key={h} className="num">{x?.cantidad ? `${Math.round(x.suma / x.cantidad)} min (${x.cantidad})` : '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
