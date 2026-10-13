// Proceso del simulador: avanza el motor según el reloj acelerado, publica en Kafka
// y expone una pequeña API HTTP para disparar escenarios durante la demo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MotorSimulacion, PARAMETROS_POR_DEFECTO, ESCENARIOS } from './motor.js';
import { crearKafka, crearProductor } from '../shared/kafka.js';
import { numeroEnv } from '../shared/config.js';
import { crearLogger } from '../shared/log.js';
import { iso } from '../shared/tiempo.js';

const log = crearLogger('simulador');
const PUERTO = numeroEnv('SIM_PUERTO', 4000);
const TICK_MS = 200;
const DIR_DATOS = process.env.SIM_DATOS_DIR || path.resolve('data');
const ARCHIVO_ESTADO = path.join(DIR_DATOS, 'simulador.json');

// --- Estado persistido: permite reiniciar el simulador sin que el reloj simulado vuelva atrás
//     ni se repitan identificadores de envíos o eventos.
function leerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, 'utf8'));
  } catch {
    return null;
  }
}
function guardarEstado(e) {
  try {
    fs.mkdirSync(DIR_DATOS, { recursive: true });
    fs.writeFileSync(ARCHIVO_ESTADO + '.tmp', JSON.stringify(e));
    fs.renameSync(ARCHIVO_ESTADO + '.tmp', ARCHIVO_ESTADO);
  } catch (err) {
    log.warn('no se pudo guardar el estado del simulador', { error: err.message });
  }
}

const previo = leerEstado();
const parametros = {
  semilla: numeroEnv('SIM_SEMILLA', PARAMETROS_POR_DEFECTO.semilla),
  enviosPorMinuto: numeroEnv('SIM_ENVIOS_POR_MINUTO', PARAMETROS_POR_DEFECTO.enviosPorMinuto),
  factor: numeroEnv('SIM_FACTOR', PARAMETROS_POR_DEFECTO.factor),
  inicioSim: process.env.SIM_INICIO || PARAMETROS_POR_DEFECTO.inicioSim,
  probDemora: numeroEnv('SIM_PROB_DEMORA', PARAMETROS_POR_DEFECTO.probDemora),
  probDuplicado: numeroEnv('SIM_PROB_DUPLICADO', PARAMETROS_POR_DEFECTO.probDuplicado),
  probFueraDeOrden: numeroEnv('SIM_PROB_FUERA_DE_ORDEN', PARAMETROS_POR_DEFECTO.probFueraDeOrden),
  probMalformado: numeroEnv('SIM_PROB_MALFORMADO', PARAMETROS_POR_DEFECTO.probMalformado),
  maxEnvios: numeroEnv('SIM_MAX_ENVIOS', 0),
  corrida: previo?.corrida || process.env.SIM_CORRIDA || Date.now().toString(36).slice(-4).toUpperCase(),
  reinicio: previo ? previo.reinicio + 1 : 0,
  inicioMs: previo?.simAhora,
  contadorEnvios: previo?.contadorEnvios,
  contadorDemo: previo?.contadorDemo,
};
const motor = new MotorSimulacion(parametros);

// --- Reloj acelerado: tiempo simulado = base + (real transcurrido) * factor
let simBase = motor.ahora;
let realBase = Date.now();
let pausado = process.env.SIM_PAUSADO === 'true';
const simAhora = () => (pausado ? simBase : simBase + (Date.now() - realBase) * motor.p.factor);
const pausar = () => {
  if (!pausado) {
    simBase = simAhora();
    pausado = true;
  }
};
const reanudar = () => {
  if (pausado) {
    realBase = Date.now();
    pausado = false;
  }
};

const kafka = crearKafka('simulador');
const productor = await crearProductor(kafka);
let pendientes = [];

async function enviar(mensajes) {
  if (!mensajes.length) return;
  // Agrupa por topic conservando el orden (el orden importa dentro de cada partición).
  const porTopic = new Map();
  for (const m of mensajes) {
    if (!porTopic.has(m.topic)) porTopic.set(m.topic, []);
    porTopic.get(m.topic).push({ key: m.key, value: m.value });
  }
  await productor.sendBatch({
    acks: -1,
    topicMessages: [...porTopic].map(([topic, messages]) => ({ topic, messages })),
  });
}

let ultimoLog = 0;
async function ciclo() {
  let mensajes = [];
  try {
    mensajes = pendientes;
    pendientes = [];
    if (!pausado) mensajes.push(...motor.avanzarHasta(simAhora()));
    try {
      await enviar(mensajes);
    } catch (e) {
      pendientes = mensajes.concat(pendientes); // no se pierden: se reintenta en el próximo ciclo
      throw e;
    }
    if (Date.now() - ultimoLog > 10000) {
      ultimoLog = Date.now();
      log.info('avance', { simAhora: iso(simAhora()), enCurso: motor.envios.size, ...motor.stats });
    }
    guardarEstado({
      corrida: motor.p.corrida,
      reinicio: motor.p.reinicio,
      simAhora: Math.max(motor.ahora, simAhora()),
      contadorEnvios: motor.contadorEnvios,
      contadorDemo: motor.contadorDemo,
    });
  } catch (e) {
    log.error('error publicando', { error: e.message });
  } finally {
    setTimeout(ciclo, TICK_MS);
  }
}

// --- API HTTP para el panel de demo
function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const estado = () => ({
    simAhora: iso(simAhora()),
    pausado,
    enCurso: motor.envios.size,
    corrida: motor.p.corrida,
    reinicio: motor.p.reinicio,
    semilla: motor.p.semilla,
    factor: motor.p.factor,
    enviosPorMinuto: motor.p.enviosPorMinuto,
    estadisticas: motor.stats,
    escenarios: ESCENARIOS,
  });
  try {
    if (req.method === 'GET' && (url.pathname === '/estado' || url.pathname === '/')) return responder(res, 200, estado());
    if (req.method === 'POST' && url.pathname === '/pausa') {
      pausar();
      log.info('simulador pausado');
      return responder(res, 200, estado());
    }
    if (req.method === 'POST' && url.pathname === '/reanudar') {
      reanudar();
      log.info('simulador reanudado');
      return responder(res, 200, estado());
    }
    const m = url.pathname.match(/^\/escenarios\/([a-z-]+)$/);
    if (req.method === 'POST' && m) {
      const { shipmentIds, salida } = motor.escenario(m[1], simAhora());
      pendientes.push(...salida);
      log.info('escenario disparado', { escenario: m[1], cantidad: shipmentIds.length, primero: shipmentIds[0] });
      return responder(res, 200, { ok: true, escenario: m[1], shipmentIds: shipmentIds.slice(0, 20), cantidad: shipmentIds.length });
    }
    responder(res, 404, { error: 'ruta inexistente' });
  } catch (e) {
    responder(res, 400, { error: e.message });
  }
});

servidor.listen(PUERTO, () =>
  log.info('simulador iniciado', { puerto: PUERTO, simAhora: iso(simAhora()), corrida: motor.p.corrida, reinicio: motor.p.reinicio, pausado }),
);
ciclo();

const detener = async () => {
  guardarEstado({ corrida: motor.p.corrida, reinicio: motor.p.reinicio, simAhora: simAhora(), contadorEnvios: motor.contadorEnvios, contadorDemo: motor.contadorDemo });
  await productor.disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', detener);
process.on('SIGINT', detener);
