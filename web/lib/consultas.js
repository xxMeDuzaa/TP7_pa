// Consultas de lectura sobre las vistas que escriben el proyector y la analítica.
import { getDb, plano } from './mongo';
import { ETAPAS_PUBLICAS, textoPublico } from './formato';

export async function datosTorre() {
  const db = await getDb();
  const [conteos, alertas, ultimos, reloj, total] = await Promise.all([
    db.collection('envios').aggregate([{ $group: { _id: '$situacion', n: { $sum: 1 } } }]).toArray(),
    db.collection('alertas').find({ estado: 'ABIERTA' }).sort({ prioridadOrden: 1, abiertaEn: 1 }).limit(40).toArray(),
    db
      .collection('envios')
      .find({ 'ultimoEvento.recibidoEn': { $ne: null } }, { projection: { shipmentId: 1, situacion: 1, zonaId: 1, hubId: 1, ultimoEvento: 1, alertasAbiertas: 1 } })
      .sort({ 'ultimoEvento.recibidoEn': -1 })
      .limit(15)
      .toArray(),
    db.collection('monitor_sla_meta').findOne({ _id: 'reloj' }),
    db.collection('envios').estimatedDocumentCount(),
  ]);
  const totalAlertas = await db.collection('alertas').countDocuments({ estado: 'ABIERTA' });
  return plano({
    contadores: Object.fromEntries(conteos.map((c) => [c._id ?? 'SIN_DATOS', c.n])),
    alertas,
    totalAlertas,
    ultimos,
    relojSimulado: reloj?.marcaDeAgua ? new Date(reloj.marcaDeAgua) : null,
    total,
  });
}

export async function datosEnvio(shipmentId) {
  const db = await getDb();
  const [envio, alertas, notificaciones] = await Promise.all([
    db.collection('envios').findOne({ shipmentId }),
    db.collection('alertas').find({ shipmentId }).sort({ abiertaEn: 1 }).toArray(),
    db.collection('notificaciones').find({ shipmentId }).sort({ enviadaEn: 1 }).toArray(),
  ]);
  if (!envio) return null;
  return plano({ envio, alertas, notificaciones });
}

/** Vista pública: solo estado, fecha estimada y etapas. Sin hub, zona, repartidor ni alertas. */
export function vistaPublica(envio) {
  if (!envio) return null;
  const tipos = new Set((envio.historial ?? []).map((h) => h.tipo));
  const indice = ETAPAS_PUBLICAS.findIndex(([t]) => t === envio.estado);
  return plano({
    shipmentId: envio.shipmentId,
    situacion: envio.situacion,
    titulo: textoPublico(envio.situacion),
    fechaEstimada: envio.situacion === 'ENTREGADO' ? null : envio.fechaEstimada ?? null,
    entregadoEn: envio.entregadoEn ?? null,
    etapas: ETAPAS_PUBLICAS.map(([t, texto], i) => ({ texto, hecha: tipos.has(t) || (indice >= 0 && i <= indice) })),
    historial: (envio.historial ?? []).map((h) => ({ texto: textoPublico(h.tipo), ocurridoEn: h.ocurridoEn })),
    actualizado: envio.ultimaActualizacion ?? null,
  });
}

export async function datosTracking(shipmentId) {
  const db = await getDb();
  return vistaPublica(await db.collection('envios').findOne({ shipmentId }));
}

// ------------------------------------------------------------------ analítica

function filtro({ zona, hub, desde, hasta }) {
  const f = {};
  if (zona) f.zonaId = zona;
  if (hub) f.hubId = hub;
  if (desde || hasta) f.fecha = { ...(desde ? { $gte: desde } : {}), ...(hasta ? { $lte: hasta } : {}) };
  return f;
}

export async function datosAnalitica(params) {
  const db = await getDb();
  const m = db.collection('metricas_diarias');
  const f = filtro(params);
  const [porZonaFranja, porDia, motivos, sla, opciones, tiempoHub] = await Promise.all([
    m
      .aggregate([
        { $match: f },
        { $group: { _id: { zona: '$zonaId', franja: '$franja' }, hub: { $first: '$hubId' }, total: { $sum: '$primerIntento.total' }, exitos: { $sum: '$primerIntento.exitos' } } },
        { $sort: { '_id.zona': 1, '_id.franja': 1 } },
      ])
      .toArray(),
    m
      .aggregate([
        { $match: f },
        { $group: { _id: '$fecha', total: { $sum: '$primerIntento.total' }, exitos: { $sum: '$primerIntento.exitos' } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    m
      .aggregate([
        { $match: f },
        {
          $group: {
            _id: '$zonaId',
            AUSENTE: { $sum: '$motivos.AUSENTE' },
            DIRECCION_INCORRECTA: { $sum: '$motivos.DIRECCION_INCORRECTA' },
            RECHAZADO: { $sum: '$motivos.RECHAZADO' },
            ZONA_INACCESIBLE: { $sum: '$motivos.ZONA_INACCESIBLE' },
            fallos: { $sum: '$fallos' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    m
      .aggregate([
        { $match: { ...f } },
        { $group: { _id: { hub: '$hubId', fecha: '$fecha' }, enPlazo: { $sum: '$sla.enPlazo' }, fuera: { $sum: '$sla.fueraDePlazo' } } },
        { $sort: { '_id.fecha': 1, '_id.hub': 1 } },
      ])
      .toArray(),
    m.aggregate([{ $group: { _id: null, zonas: { $addToSet: '$zonaId' }, hubs: { $addToSet: '$hubId' }, fechas: { $addToSet: '$fecha' } } }]).toArray(),
    db
      .collection('metricas_tiempo_hub')
      .aggregate([
        { $match: { ...(params.hub ? { hubId: params.hub } : {}), ...(f.fecha ? { fecha: f.fecha } : {}) } },
        { $group: { _id: { hub: '$hubId', fecha: '$fecha' }, suma: { $sum: '$sumaMinutos' }, cantidad: { $sum: '$cantidad' } } },
        { $sort: { '_id.fecha': 1, '_id.hub': 1 } },
      ])
      .toArray(),
  ]);
  const o = opciones[0] ?? { zonas: [], hubs: [], fechas: [] };
  return plano({
    porZonaFranja,
    porDia,
    motivos,
    sla,
    tiempoHub,
    opciones: { zonas: o.zonas.filter(Boolean).sort(), hubs: o.hubs.filter(Boolean).sort(), fechas: o.fechas.sort() },
  });
}
