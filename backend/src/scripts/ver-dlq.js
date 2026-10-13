// Lista los mensajes de la DLQ (envios.estados.dlq) para revisión manual.
//   docker compose run --rm herramientas node src/scripts/ver-dlq.js [--ultimos 20]
import { crearKafka } from '../shared/kafka.js';
import { TOPICS } from '../shared/topics.js';

const i = process.argv.indexOf('--ultimos');
const ultimos = i > 0 ? Number(process.argv[i + 1]) : 20;

const kafka = crearKafka('ver-dlq');
const admin = kafka.admin();
await admin.connect();
const fin = await admin.fetchTopicOffsets(TOPICS.DLQ);
await admin.disconnect();
const pendientes = new Map(fin.filter((p) => Number(p.high) > Number(p.low)).map((p) => [p.partition, Number(p.high)]));

const mensajes = [];
if (pendientes.size) {
  // Grupo efímero: no confirma offsets, así que no deja rastro.
  const consumer = kafka.consumer({ groupId: `ver-dlq-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.DLQ, fromBeginning: true });
  await new Promise((resolver) => {
    consumer.run({
      autoCommit: false,
      eachMessage: async ({ partition, message }) => {
        try {
          mensajes.push(JSON.parse(message.value.toString()));
        } catch {
          mensajes.push({ crudo: message.value.toString() });
        }
        if (Number(message.offset) + 1 >= pendientes.get(partition)) pendientes.delete(partition);
        if (!pendientes.size) resolver();
      },
    });
    setTimeout(resolver, 15000);
  });
  await consumer.disconnect();
}

mensajes.sort((a, b) => String(a.ocurridoEn).localeCompare(String(b.ocurridoEn)));
console.log(`DLQ: ${mensajes.length} mensajes. Últimos ${Math.min(ultimos, mensajes.length)}:`);
console.table(
  mensajes.slice(-ultimos).map((m) => ({
    detectadoEn: m.ocurridoEn,
    consumidor: m.consumidor,
    shipmentId: m.shipmentId,
    origen: `${m.topicOrigen}[${m.particion}]@${m.offset}`,
    motivo: m.motivo,
  })),
);
process.exit(0);
