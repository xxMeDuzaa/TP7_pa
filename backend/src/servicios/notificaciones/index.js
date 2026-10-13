// Servicio de notificaciones (CU2 y CU3): registra un aviso simulado al destinatario
// ante cada entrega fallida y cada alerta de SLA abierta. No envía correos ni SMS reales.
import { iniciarConsumidor } from '../../shared/consumidor.js';
import { TOPICS, GRUPOS } from '../../shared/topics.js';
import { avisoPara } from './avisos.js';

const GRUPO = 'notificaciones';

await iniciarConsumidor({
  servicio: 'notificaciones',
  grupo: GRUPO,
  topics: GRUPOS[GRUPO],
  manejar: async (ev, meta, ctx) => {
    const aviso = avisoPara(ev);
    if (!aviso) return { ignorado: true };
    await ctx.publicar(TOPICS.NOTIFICACIONES, [aviso]);
    return { aviso: aviso.eventId, canal: aviso.canal };
  },
});
