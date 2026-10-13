// Configuración común a todos los procesos. Todo se puede sobreescribir por variables de entorno.
export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9094').split(',').map((s) => s.trim()),
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/?directConnection=true',
  mongoDb: process.env.MONGO_DB || 'rutasur',
};

export function numeroEnv(nombre, porDefecto) {
  const v = process.env[nombre];
  if (v === undefined || v === '') return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}
