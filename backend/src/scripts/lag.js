// Muestra el lag de cada grupo de consumidores por topic y partición.
//   docker compose run --rm herramientas node src/scripts/lag.js            (una vez)
//   docker compose run --rm herramientas node src/scripts/lag.js --seguir   (cada 2 s)
import { crearKafka } from '../shared/kafka.js';
import { GRUPOS } from '../shared/topics.js';

const admin = crearKafka('lag').admin();
await admin.connect();

async function medir() {
  const filas = [];
  const finales = new Map();
  for (const [grupo, topics] of Object.entries(GRUPOS)) {
    const desc = await admin.describeGroups([grupo]);
    const estado = desc.groups[0]?.state ?? 'desconocido';
    const miembros = desc.groups[0]?.members?.length ?? 0;
    const offsets = await admin.fetchOffsets({ groupId: grupo, topics });
    for (const { topic, partitions } of offsets) {
      if (!finales.has(topic)) finales.set(topic, await admin.fetchTopicOffsets(topic));
      const fin = finales.get(topic);
      let lag = 0;
      const detalle = [];
      for (const p of partitions) {
        const alto = Number(fin.find((f) => f.partition === p.partition)?.high ?? 0);
        const confirmado = Number(p.offset) < 0 ? 0 : Number(p.offset);
        const l = Math.max(0, alto - confirmado);
        lag += l;
        detalle.push(`p${p.partition}:${l}`);
      }
      filas.push({ grupo, estado, miembros, topic, lag, porParticion: detalle.join(' ') });
    }
  }
  return filas;
}

const seguir = process.argv.includes('--seguir');
do {
  const filas = await medir();
  if (seguir) console.clear();
  console.log(new Date().toLocaleTimeString('es-AR'));
  console.table(filas);
  if (seguir) await new Promise((r) => setTimeout(r, 2000));
} while (seguir);
await admin.disconnect();
