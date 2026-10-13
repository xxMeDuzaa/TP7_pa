// Catálogo de topics (ver "Catálogo de eventos" en la especificación).
// La clave de partición es SIEMPRE el shipmentId.
const DIA_MS = 24 * 60 * 60 * 1000;

export const TOPICS = {
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ: 'envios.estados.dlq',
};

const PARTICIONES = 3;

export const DEFINICION_TOPICS = [
  { topic: TOPICS.ESTADOS, numPartitions: PARTICIONES, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
  {
    topic: TOPICS.PROMESAS,
    numPartitions: PARTICIONES,
    configEntries: [
      { name: 'cleanup.policy', value: 'compact' },
      // Segmentos chicos para que la compactación sea observable en la demo.
      { name: 'segment.ms', value: String(60 * 60 * 1000) },
      { name: 'min.cleanable.dirty.ratio', value: '0.1' },
    ],
  },
  { topic: TOPICS.REPROGRAMACIONES, numPartitions: PARTICIONES, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
  { topic: TOPICS.ALERTAS, numPartitions: PARTICIONES, configEntries: [{ name: 'retention.ms', value: String(7 * DIA_MS) }] },
  { topic: TOPICS.NOTIFICACIONES, numPartitions: PARTICIONES, configEntries: [{ name: 'retention.ms', value: String(7 * DIA_MS) }] },
  { topic: TOPICS.DLQ, numPartitions: PARTICIONES, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
];

// Grupos de consumidores y los topics que lee cada uno (lo usan los scripts de lag y reprocesamiento).
export const GRUPOS = {
  proyector: [TOPICS.ESTADOS, TOPICS.PROMESAS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES],
  notificaciones: [TOPICS.ESTADOS, TOPICS.ALERTAS],
  reprogramacion: [TOPICS.ESTADOS],
  'monitor-sla': [TOPICS.ESTADOS, TOPICS.PROMESAS],
  analitica: [TOPICS.ESTADOS, TOPICS.PROMESAS],
  'analitica-tiempo-hub': [TOPICS.ESTADOS],
};
