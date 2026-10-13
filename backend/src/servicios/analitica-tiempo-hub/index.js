// Cuarto indicador (demostración de reprocesamiento, CU4):
// tiempo medio entre INGRESADO_HUB y la primera salida EN_REPARTO, por hub y día.
//
// Es un grupo de consumidores NUEVO ('analitica-tiempo-hub'). Al no tener offsets confirmados,
// arranca desde el principio del topic (fromBeginning) y completa el histórico sin tocar
// ningún otro servicio. Se levanta a pedido: docker compose --profile reproceso up -d analitica-tiempo-hub
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { GRUPOS } from '../../shared/topics.js';
import { incrementoTiempoHub } from './tiempo-hub.js';

const GRUPO = 'analitica-tiempo-hub';

await iniciarConsumidor({
  servicio: 'analitica-tiempo-hub',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  manejar: async (ev, meta, ctx) => {
    if (ev.tipo !== 'INGRESADO_HUB' && !(ev.tipo === 'EN_REPARTO' && ev.intento === 1)) return { ignorado: true };
    const { db } = ctx;
    let resultado = {};
    await ctx.transaccion(async (session) => {
      const col = db.collection('tiempo_hub_envios');
      const campo = ev.tipo === 'INGRESADO_HUB' ? 'ingresoEn' : 'salidaEn';
      const st = await col.findOneAndUpdate(
        { shipmentId: ev.shipmentId },
        { $set: { [campo]: new Date(ev.ocurridoEn), hubId: ev.hubId } },
        { upsert: true, returnDocument: 'after', session },
      );
      const inc = incrementoTiempoHub(st);
      if (inc) {
        await db.collection('metricas_tiempo_hub').updateOne(inc.clave, { $inc: inc.inc }, { upsert: true, session });
        await col.updateOne({ shipmentId: ev.shipmentId }, { $set: { contado: true } }, { session });
        resultado = { minutos: inc.inc.sumaMinutos };
      }
    });
    return resultado;
  },
});
