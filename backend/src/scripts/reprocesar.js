// Reconstrucción de vistas: borra lo que escribe un consumidor y lleva sus offsets al principio.
// Al volver a arrancar el servicio, relee todo Kafka y reconstruye exactamente las mismas vistas.
//
//   docker compose stop proyector
//   docker compose run --rm herramientas node src/scripts/reprocesar.js proyector
//   docker compose start proyector
//
// Opcional: --solo-envios (para proyector) borra únicamente la colección envios.
import { crearKafka } from '../shared/kafka.js';
import { conectarMongo } from '../shared/mongo.js';
import { GRUPOS } from '../shared/topics.js';

const COLECCIONES = {
  proyector: ['envios', 'alertas', 'notificaciones'],
  'monitor-sla': ['monitor_sla_estado', 'monitor_sla_meta'],
  analitica: ['metricas_diarias', 'analitica_envios'],
  'analitica-tiempo-hub': ['metricas_tiempo_hub', 'tiempo_hub_envios'],
  notificaciones: [],
  reprogramacion: [],
};

const grupo = process.argv[2];
if (!GRUPOS[grupo]) {
  console.error(`Uso: node src/scripts/reprocesar.js <grupo>\nGrupos: ${Object.keys(GRUPOS).join(', ')}`);
  process.exit(1);
}
let colecciones = COLECCIONES[grupo];
if (grupo === 'proyector' && process.argv.includes('--solo-envios')) colecciones = ['envios'];

const admin = crearKafka('reprocesar').admin();
await admin.connect();
const { groups } = await admin.describeGroups([grupo]);
const estado = groups[0]?.state;
if (estado && !['Empty', 'Dead'].includes(estado)) {
  console.error(`El grupo '${grupo}' está activo (estado ${estado}). Detené el servicio primero:\n  docker compose stop ${grupo}`);
  await admin.disconnect();
  process.exit(1);
}

const { client, db } = await conectarMongo();
for (const c of colecciones) {
  const r = await db.collection(c).deleteMany({});
  console.log(`- ${c}: ${r.deletedCount} documentos borrados`);
}
const r = await db.collection('eventos_procesados').deleteMany({ consumidor: grupo });
console.log(`- eventos_procesados (${grupo}): ${r.deletedCount} registros borrados`);

for (const topic of GRUPOS[grupo]) {
  await admin.resetOffsets({ groupId: grupo, topic, earliest: true });
  console.log(`- offsets de '${grupo}' en ${topic} -> principio`);
}
await admin.disconnect();
await client.close();
console.log(`\nListo. Ahora: docker compose start ${grupo}`);
