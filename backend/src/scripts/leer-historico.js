// Lee topics completos desde el principio hasta el final ACTUAL (offsets altos al momento de empezar)
// con un grupo efímero que no confirma offsets. Lo usan los scripts de verificación.
export async function leerHistorico(kafka, topics, alMensaje, { tiempoMaximoMs = 120000 } = {}) {
  const admin = kafka.admin();
  await admin.connect();
  const pendientes = new Map();
  for (const topic of topics) {
    for (const p of await admin.fetchTopicOffsets(topic)) {
      if (Number(p.high) > Number(p.low)) pendientes.set(`${topic}:${p.partition}`, Number(p.high));
    }
  }
  await admin.disconnect();
  if (!pendientes.size) return;

  const consumer = kafka.consumer({ groupId: `verificacion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: true });
  await new Promise((resolver, rechazar) => {
    const limite = setTimeout(() => rechazar(new Error('tiempo máximo de lectura agotado')), tiempoMaximoMs);
    consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const k = `${topic}:${partition}`;
        const alto = pendientes.get(k);
        if (alto === undefined || Number(message.offset) >= alto) return; // llegó después de empezar
        alMensaje({ topic, partition, message });
        if (Number(message.offset) + 1 >= alto) pendientes.delete(k);
        if (!pendientes.size) {
          clearTimeout(limite);
          resolver();
        }
      },
    });
  });
  await consumer.disconnect();
}
