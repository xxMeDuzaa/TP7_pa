// Proyector (CU1): mantiene envios, alertas y notificaciones en MongoDB a partir de los eventos.
// MongoDB es una vista derivada: se puede borrar y reconstruir releyendo Kafka (ver scripts/reprocesar.js).
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { TOPICS, GRUPOS } from '../../shared/topics.js';
import { aplicarEstado, aplicarPromesa, aplicarReprogramacion, aplicarAlerta, aplicarNotificacion } from './proyeccion.js';

const GRUPO = 'proyector';

await iniciarConsumidor({
  servicio: 'proyector',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  manejar: async (ev, meta, ctx) => {
    const envios = ctx.db.collection('envios');
    let resultado = {};

    await ctx.transaccion(async (session) => {
      const actual = await envios.findOne({ shipmentId: ev.shipmentId }, { session });
      let r;
      switch (meta.topic) {
        case TOPICS.ESTADOS:
          r = aplicarEstado(actual, ev, meta);
          break;
        case TOPICS.PROMESAS:
          r = aplicarPromesa(actual, ev);
          break;
        case TOPICS.REPROGRAMACIONES:
          r = aplicarReprogramacion(actual, ev);
          break;
        case TOPICS.ALERTAS: {
          const alertas = ctx.db.collection('alertas');
          const alertaActual = await alertas.findOne({ alertaId: ev.alertaId }, { session });
          r = aplicarAlerta(actual, alertaActual, ev);
          await alertas.replaceOne({ alertaId: ev.alertaId }, r.alerta, { upsert: true, session });
          break;
        }
        case TOPICS.NOTIFICACIONES:
          r = aplicarNotificacion(actual, ev);
          await ctx.db.collection('notificaciones').replaceOne({ eventId: ev.eventId }, r.notificacion, { upsert: true, session });
          break;
        default:
          r = { descartado: `topic no manejado: ${meta.topic}` };
      }
      if (r.descartado) {
        resultado = { descartado: r.descartado };
        return; // igual se registra en eventos_procesados
      }
      await envios.replaceOne({ shipmentId: ev.shipmentId }, r.doc, { upsert: true, session });
      resultado = { situacion: r.doc.situacion };
    });
    return resultado;
  },
});
