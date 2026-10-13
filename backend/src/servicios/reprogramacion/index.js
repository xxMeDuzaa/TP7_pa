// Servicio de reprogramación (CU2): ante cada ENTREGA_FALLIDA decide el próximo paso
// y lo publica en envios.reprogramaciones. Es sin estado: el número de intento viaja en el evento.
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { TOPICS, GRUPOS } from '../../shared/topics.js';
import { eventoReprogramacion } from './evento.js';

const GRUPO = 'reprogramacion';

await iniciarConsumidor({
  servicio: 'reprogramacion',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  manejar: async (ev, meta, ctx) => {
    if (ev.tipo !== 'ENTREGA_FALLIDA') return { ignorado: true };
    const salida = eventoReprogramacion(ev);
    await ctx.publicar(TOPICS.REPROGRAMACIONES, [salida]);
    return { decision: salida.tipo, intento: ev.intento, nuevaFecha: salida.nuevaFecha };
  },
});
