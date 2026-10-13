// Huella (SHA-256) del contenido de una colección, independiente de _id y del orden de inserción.
// Sirve para verificar que borrar + reprocesar deja exactamente el mismo resultado.
//   docker compose run --rm herramientas node src/scripts/snapshot.js envios
import crypto from 'node:crypto';
import { conectarMongo } from '../shared/mongo.js';

const CLAVES = {
  envios: 'shipmentId',
  alertas: 'alertaId',
  notificaciones: 'eventId',
  metricas_diarias: null,
  metricas_tiempo_hub: null,
};

/** JSON con claves ordenadas (para que el hash no dependa del orden de los campos). */
function estable(v) {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => k !== '_id')
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estable(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const colecciones = process.argv.slice(2).length ? process.argv.slice(2) : ['envios', 'alertas', 'notificaciones'];
const { client, db } = await conectarMongo();
const filas = [];
for (const c of colecciones) {
  const docs = await db.collection(c).find({}, { projection: { _id: 0 } }).toArray();
  const lineas = docs.map(estable).sort();
  const hash = crypto.createHash('sha256').update(lineas.join('\n')).digest('hex').slice(0, 16);
  filas.push({ coleccion: c, documentos: docs.length, huella: hash, clave: CLAVES[c] ?? '-' });
}
console.table(filas);
await client.close();
