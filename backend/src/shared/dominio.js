// Vocabulario del dominio compartido por todos los procesos.

export const ESTADOS = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];
export const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];
export const DECISIONES = ['REPROGRAMADO', 'RETENIDO', 'DEVOLUCION'];
export const TIPOS_ALERTA = ['ALERTA_ABIERTA', 'ALERTA_CERRADA'];
export const PRIORIDADES = ['MEDIA', 'ALTA', 'CRITICA'];
export const ORDEN_PRIORIDAD = { CRITICA: 1, ALTA: 2, MEDIA: 3 };

export const REGLAS_SLA = {
  SIN_INGRESO: { prioridad: 'MEDIA', descripcion: 'Faltan menos de 10 h para el vencimiento y no ingresó al hub' },
  SIN_SALIDA: { prioridad: 'ALTA', descripcion: 'Faltan menos de 4 h para el vencimiento y no está en reparto' },
  FALLO_DIA_LIMITE: { prioridad: 'ALTA', descripcion: 'Entrega fallida el mismo día en que vence la promesa' },
  VENCIDO: { prioridad: 'CRITICA', descripcion: 'Pasó el vencimiento sin ENTREGADO' },
};

export const VERSION_ESQUEMA = 1;

// Mapa de la operación (cifras del caso, no de una empresa real).
// Cada zona pertenece a un único hub. La tasa de fallo varía entre 5 % y 30 %.
export const HUBS = ['HUB-NORTE', 'HUB-CENTRO', 'HUB-SUR'];
export const ZONAS = [
  { zonaId: 'Z-N1', hubId: 'HUB-NORTE', tasaFallo: 0.05 },
  { zonaId: 'Z-N2', hubId: 'HUB-NORTE', tasaFallo: 0.12 },
  { zonaId: 'Z-C1', hubId: 'HUB-CENTRO', tasaFallo: 0.08 },
  { zonaId: 'Z-C2', hubId: 'HUB-CENTRO', tasaFallo: 0.15 },
  { zonaId: 'Z-C3', hubId: 'HUB-CENTRO', tasaFallo: 0.3 },
  { zonaId: 'Z-S1', hubId: 'HUB-SUR', tasaFallo: 0.1 },
  { zonaId: 'Z-S2', hubId: 'HUB-SUR', tasaFallo: 0.22 },
  { zonaId: 'Z-S3', hubId: 'HUB-SUR', tasaFallo: 0.18 },
];
// 120 repartidores: 15 por zona.
export const REPARTIDORES_POR_ZONA = 15;
export const repartidoresDeZona = (zonaId) => {
  const i = ZONAS.findIndex((z) => z.zonaId === zonaId);
  return Array.from({ length: REPARTIDORES_POR_ZONA }, (_, k) => `R-${String(i * REPARTIDORES_POR_ZONA + k + 1).padStart(3, '0')}`);
};
