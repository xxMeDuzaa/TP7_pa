import { Kafka, Partitioners, logLevel } from 'kafkajs';
import { config } from './config.js';

export function crearKafka(clientId) {
  return new Kafka({
    clientId,
    brokers: config.kafkaBrokers,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 15 },
  });
}

/** Productor con acks=all. La clave de partición es siempre el shipmentId. */
export async function crearProductor(kafka) {
  const productor = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner, // murmur2, compatible con el cliente Java
    allowAutoTopicCreation: false,
  });
  await productor.connect();
  return productor;
}

/** Publica eventos (objetos) en un topic, usando shipmentId como clave. */
export async function publicar(productor, topic, eventos) {
  if (!eventos.length) return;
  await productor.send({
    topic,
    acks: -1,
    messages: eventos.map((e) => ({ key: e.shipmentId, value: JSON.stringify(e) })),
  });
}
