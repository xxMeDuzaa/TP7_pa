// Esqueleto común de los servicios consumidores.
//
// Garantía: al menos una vez + consumidores idempotentes.
//   1. Se valida el esquema. Si falla -> envios.estados.dlq con el motivo, se confirma el offset y se sigue.
//   2. Si el eventId ya está en eventos_procesados para este consumidor -> se descarta (duplicado).
//   3. El manejador publica sus eventos derivados (con eventId determinístico, así un reintento
//      genera exactamente el mismo evento y los consumidores de abajo lo descartan).
//   4. En UNA transacción de MongoDB se registra el eventId en eventos_procesados y se aplican los efectos.
//   5. Recién después se confirma el offset (confirmación manual).
// Si el proceso muere entre 3 y 5, Kafka vuelve a entregar el mensaje y los pasos 2/4 evitan efectos dobles.
import { crearKafka, crearProductor, publicar } from './kafka.js';
import { conectarMongo, asegurarIndices } from './mongo.js';
import { validar } from './esquemas.js';
import { TOPICS } from './topics.js';
import { VERSION_ESQUEMA } from './dominio.js';
import { crearLogger } from './log.js';

export async function iniciarConsumidor({ servicio, grupo, topics, manejar, alIniciar, alDetener }) {
  const log = crearLogger(servicio);
  const kafka = crearKafka(servicio);
  const { client, db } = await conectarMongo(log);
  await asegurarIndices(db);
  const productor = await crearProductor(kafka);
  const procesados = db.collection('eventos_procesados');

  const ctxBase = {
    db,
    client,
    log,
    publicar: (topic, eventos) => publicar(productor, topic, eventos),
    /** Ejecuta fn(session) dentro de una transacción con reintentos automáticos. */
    transaccion: async (fn) => {
      const session = client.startSession();
      try {
        await session.withTransaction(() => fn(session));
      } finally {
        await session.endSession();
      }
    },
  };

  if (alIniciar) await alIniciar(ctxBase);

  const consumer = kafka.consumer({ groupId: grupo, sessionTimeout: 30000, heartbeatInterval: 3000 });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: true });

  consumer.on(consumer.events.GROUP_JOIN, (e) =>
    log.info('unido al grupo', { grupo, asignacion: e.payload.memberAssignment }),
  );
  consumer.on(consumer.events.CRASH, (e) => {
    log.error('el consumidor falló', { error: e.payload.error?.message, reinicia: e.payload.restart });
    if (!e.payload.restart) process.exit(1);
  });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const offset = message.offset;
      const confirmar = () =>
        consumer.commitOffsets([{ topic, partition, offset: (BigInt(offset) + 1n).toString() }]);
      const crudo = message.value ? message.value.toString() : '';
      const clave = message.key ? message.key.toString() : null;
      const v = validar(topic, crudo);

      if (!v.ok) {
        const dlq = {
          eventId: `dlq-${grupo}-${topic}-${partition}-${offset}`,
          shipmentId: clave || 'desconocido',
          tipo: 'EVENTO_INVALIDO',
          ocurridoEn: new Date().toISOString(),
          version: VERSION_ESQUEMA,
          consumidor: grupo,
          topicOrigen: topic,
          particion: partition,
          offset,
          motivo: v.motivo,
          contenido: crudo.slice(0, 2000),
        };
        await publicar(productor, TOPICS.DLQ, [dlq]);
        await confirmar();
        log.warn('evento inválido enviado a la DLQ', { topic, partition, offset, motivo: v.motivo });
        return;
      }

      const evento = v.evento;
      const meta = { topic, partition, offset, timestamp: Number(message.timestamp) };
      const ref = { eventId: evento.eventId, shipmentId: evento.shipmentId, tipo: evento.tipo, topic, partition, offset };

      if (await procesados.findOne({ consumidor: grupo, eventId: evento.eventId }, { projection: { _id: 1 } })) {
        await confirmar();
        log.info('duplicado descartado', ref);
        return;
      }

      let registrado = false;
      let duplicado = false;
      const ctx = {
        ...ctxBase,
        /** Transacción que además registra el eventId como procesado. */
        transaccion: async (fn) => {
          try {
            await ctxBase.transaccion(async (session) => {
              await procesados.insertOne(
                { consumidor: grupo, eventId: evento.eventId, topic, particion: partition, offset, procesadoEn: new Date() },
                { session },
              );
              await fn(session);
            });
            registrado = true;
          } catch (e) {
            if (e?.code === 11000 && e?.keyPattern?.consumidor) {
              registrado = true;
              duplicado = true;
              return;
            }
            throw e;
          }
        },
      };

      const resultado = await manejar(evento, meta, ctx);
      if (!registrado) await ctx.transaccion(async () => {});
      await confirmar();
      log.info(duplicado ? 'duplicado descartado' : 'procesado', { ...ref, ...(resultado || {}) });
    },
  });

  const detener = async (senal) => {
    log.info('deteniendo', { senal });
    try {
      if (alDetener) await alDetener(ctxBase);
      await consumer.disconnect();
      await productor.disconnect();
      await client.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => detener('SIGTERM'));
  process.on('SIGINT', () => detener('SIGINT'));

  log.info('consumidor iniciado', { grupo, topics });
  return { ...ctxBase, consumer };
}
