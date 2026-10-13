import { MongoClient } from 'mongodb';
import { config } from './config.js';

export async function conectarMongo(log) {
  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  for (let intento = 1; ; intento++) {
    try {
      await client.connect();
      break;
    } catch (e) {
      if (intento >= 30) throw e;
      log?.warn('MongoDB no disponible, reintentando', { intento, error: e.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return { client, db: client.db(config.mongoDb) };
}

/**
 * Índices de todas las colecciones (ver "Modelo de datos en MongoDB").
 * Cada servicio llama a esta función al arrancar; createIndex es idempotente.
 */
const INDICES = [
  ['envios', { shipmentId: 1 }, { unique: true }],
  ['envios', { estado: 1, zonaId: 1 }],
  ['envios', { situacion: 1 }],
  ['envios', { 'promesa.venceEn': 1 }],
  ['envios', { 'ultimoEvento.recibidoEn': -1 }],
  ['alertas', { estado: 1, prioridadOrden: 1 }],
  ['alertas', { shipmentId: 1 }],
  ['alertas', { alertaId: 1 }, { unique: true }],
  ['notificaciones', { shipmentId: 1 }],
  ['notificaciones', { eventId: 1 }, { unique: true }],
  ['metricas_diarias', { fecha: 1, zonaId: 1, franja: 1 }, { unique: true }],
  ['metricas_tiempo_hub', { fecha: 1, hubId: 1 }, { unique: true }],
  ['eventos_procesados', { consumidor: 1, eventId: 1 }, { unique: true }],
  ['eventos_procesados', { procesadoEn: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }],
  ['monitor_sla_estado', { shipmentId: 1 }, { unique: true }],
  ['analitica_envios', { shipmentId: 1 }, { unique: true }],
  ['tiempo_hub_envios', { shipmentId: 1 }, { unique: true }],
];

export async function asegurarIndices(db) {
  // Secuencial y con reintento: varios servicios arrancan a la vez y pueden competir creando la colección.
  for (const [coleccion, claves, opciones = {}] of INDICES) {
    for (let intento = 1; ; intento++) {
      try {
        await db.collection(coleccion).createIndex(claves, opciones);
        break;
      } catch (e) {
        if (intento >= 5) throw e;
        await new Promise((r) => setTimeout(r, 300 * intento));
      }
    }
  }
}
