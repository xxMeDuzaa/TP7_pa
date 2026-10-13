// Crea los 6 topics con sus particiones y retención. Es idempotente: si ya existen, no hace nada.
import { crearKafka } from '../shared/kafka.js';
import { DEFINICION_TOPICS } from '../shared/topics.js';
import { crearLogger } from '../shared/log.js';

const log = crearLogger('crear-topics');
const admin = crearKafka('crear-topics').admin();

for (let intento = 1; ; intento++) {
  try {
    await admin.connect();
    break;
  } catch (e) {
    if (intento >= 30) throw e;
    log.warn('Kafka no disponible, reintentando', { intento });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const existentes = new Set(await admin.listTopics());
const nuevos = DEFINICION_TOPICS.filter((t) => !existentes.has(t.topic));
if (nuevos.length) {
  await admin.createTopics({ topics: nuevos.map((t) => ({ ...t, replicationFactor: 1 })), waitForLeaders: true });
}
log.info('topics listos', { creados: nuevos.map((t) => t.topic), existentes: [...existentes].filter((t) => !t.startsWith('__')) });
await admin.disconnect();
