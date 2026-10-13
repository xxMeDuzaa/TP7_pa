// Servicio de analítica (CU4): mantiene los agregados de metricas_diarias con incrementos atómicos.
// El incremento y el registro del eventId van en la misma transacción: un reintento no cuenta dos veces.
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { TOPICS, GRUPOS } from '../../shared/topics.js';
import { incrementosDeEstado, incrementoSla } from './metricas.js';

const GRUPO = 'analitica';

async function incrementar(db, session, { clave, hubId, inc }) {
  await db.collection('metricas_diarias').updateOne(clave, { $inc: inc, $set: { hubId } }, { upsert: true, session });
}

await iniciarConsumidor({
  servicio: 'analitica',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  manejar: async (ev, meta, ctx) => {
    const { db } = ctx;
    const directo = meta.topic === TOPICS.ESTADOS ? incrementosDeEstado(ev) : null;
    const tocaSla = ev.tipo === 'PROMESA_CREADA' || ev.tipo === 'ENTREGADO';
    if (!directo && !tocaSla) return { ignorado: true };

    const aplicados = [];
    await ctx.transaccion(async (session) => {
      aplicados.length = 0;
      if (directo) {
        await incrementar(db, session, directo);
        aplicados.push(...Object.keys(directo.inc));
      }
      if (tocaSla) {
        const col = db.collection('analitica_envios');
        const cambios =
          ev.tipo === 'PROMESA_CREADA'
            ? { venceEn: new Date(ev.venceEn) }
            : { entregadoEn: new Date(ev.ocurridoEn), zonaId: ev.zonaId, hubId: ev.hubId };
        const st = await col.findOneAndUpdate(
          { shipmentId: ev.shipmentId },
          { $set: cambios },
          { upsert: true, returnDocument: 'after', session },
        );
        const sla = incrementoSla(st);
        if (sla) {
          await incrementar(db, session, sla);
          await col.updateOne({ shipmentId: ev.shipmentId }, { $set: { slaContado: true } }, { session });
          aplicados.push(...Object.keys(sla.inc));
        }
      }
    });
    return { incrementos: aplicados };
  },
});
