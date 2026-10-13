// Conexión única a MongoDB para todo el servidor de Next.js.
// La interfaz SOLO lee de MongoDB: nunca consume Kafka.
import { MongoClient } from 'mongodb';

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/?directConnection=true';
const nombreDb = process.env.MONGO_DB || 'rutasur';

// Conexión perezosa: no se intenta conectar durante `next build` (cuando MongoDB no existe).
export async function getDb() {
  const g = globalThis;
  if (!g.__rutasurMongo) {
    g.__rutasurMongo = new MongoClient(url, { serverSelectionTimeoutMS: 5000 }).connect().catch((e) => {
      g.__rutasurMongo = null; // permite reintentar en la próxima solicitud
      throw e;
    });
  }
  const client = await g.__rutasurMongo;
  return client.db(nombreDb);
}

/** Documentos de Mongo -> JSON plano (fechas como ISO) para pasarlos a componentes cliente. */
export const plano = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === '_id' ? undefined : x)));
