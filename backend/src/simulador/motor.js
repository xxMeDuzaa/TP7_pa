// Motor del simulador: simulación de eventos discretos sobre un reloj SIMULADO.
//
// Es puro y determinístico: no conoce Kafka ni el reloj de la máquina. Recibe "avanzá hasta t"
// y devuelve los mensajes a publicar en orden. Con la misma semilla y los mismos parámetros
// produce exactamente la misma secuencia de mensajes (los escenarios a pedido usan otro generador
// aleatorio para no alterar el flujo continuo).
import { crearRng } from '../shared/random.js';
import { TOPICS } from '../shared/topics.js';
import { ZONAS, repartidoresDeZona, VERSION_ESQUEMA } from '../shared/dominio.js';
import { decidirReprogramacion } from '../shared/reglas-reprogramacion.js';
import { HORA, MINUTO, iso, aMs, siguienteDiaHabil, franjaDe, proximaSalida } from '../shared/tiempo.js';

export const PARAMETROS_POR_DEFECTO = {
  semilla: 42,
  corrida: 'A',
  reinicio: 0,
  enviosPorMinuto: 20, // envíos por minuto REAL
  factor: 120, // 1 hora simulada = 30 segundos reales
  inicioSim: '2026-10-05T09:00:00-03:00', // lunes
  probDemora: 0.1,
  probDuplicado: 0.02,
  probFueraDeOrden: 0.02,
  probMalformado: 0.01,
  // La ausencia es más frecuente a la mañana (la gente trabaja): eso es lo que la analítica debe mostrar.
  multiplicadorFranja: { MANANA: 1.4, TARDE: 0.6 },
  motivos: [
    ['AUSENTE', 60],
    ['DIRECCION_INCORRECTA', 20],
    ['RECHAZADO', 15],
    ['ZONA_INACCESIBLE', 5],
  ],
  maxEnvios: 0, // 0 = sin límite
};

export const ESCENARIOS = ['feliz', 'ausente', 'demorado', 'tercer-fallo', 'rafaga', 'malformado'];

class ColaPrioridad {
  constructor() {
    this.items = [];
  }
  get tamano() {
    return this.items.length;
  }
  menor(a, b) {
    return a.t < b.t || (a.t === b.t && a.seq < b.seq);
  }
  push(item) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.menor(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  peek() {
    return this.items[0];
  }
  pop() {
    const h = this.items;
    const tope = h[0];
    const ultimo = h.pop();
    if (h.length) {
      h[0] = ultimo;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.menor(h[l], h[m])) m = l;
        if (r < h.length && this.menor(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return tope;
  }
}

export class MotorSimulacion {
  constructor(parametros = {}) {
    this.p = { ...PARAMETROS_POR_DEFECTO, ...parametros };
    const semilla = Number(this.p.semilla) + Number(this.p.reinicio) * 7919;
    this.rng = crearRng(semilla);
    this.rngEscenarios = crearRng(semilla ^ 0x5eed);
    this.cola = new ColaPrioridad();
    this.seq = 0;
    this.envios = new Map();
    this.ahora = aMs(this.p.inicioMs ?? this.p.inicioSim);
    this.contadorEventos = 0;
    this.contadorEnvios = this.p.contadorEnvios ?? 0;
    this.contadorDemo = this.p.contadorDemo ?? 0;
    this.stats = { creados: 0, creadosEscenario: 0, eventos: 0, duplicados: 0, fueraDeOrden: 0, malformados: 0 };
    this.programar(this.ahora, { accion: 'GENERAR' });
  }

  get intervaloSim() {
    return (60000 / this.p.enviosPorMinuto) * this.p.factor;
  }

  programar(t, item) {
    this.cola.push({ t, seq: this.seq++, ...item });
  }

  /** Procesa todo lo programado hasta el instante simulado `t` (inclusive). */
  avanzarHasta(t) {
    const salida = [];
    while (this.cola.tamano && this.cola.peek().t <= t) {
      const item = this.cola.pop();
      this.ahora = Math.max(this.ahora, item.t);
      this.ejecutar(item, salida);
    }
    this.ahora = Math.max(this.ahora, t);
    return salida;
  }

  ejecutar(item, salida) {
    if (item.accion === 'GENERAR') {
      if (this.p.maxEnvios && this.stats.creados >= this.p.maxEnvios) return;
      this.crearEnvio(item.t, { rng: this.rng, perfil: 'normal', anomalias: true }, salida);
      this.stats.creados++;
      this.programar(item.t + this.intervaloSim * this.rng.uniforme(0.5, 1.5), { accion: 'GENERAR' });
      return;
    }
    const s = this.envios.get(item.shipmentId);
    if (!s) return;
    this[item.accion](s, item.t, salida);
  }

  // ---------------------------------------------------------------- ciclo de vida

  crearEnvio(t, { rng, perfil, anomalias, id }, salida) {
    const zona = rng.elegir(ZONAS);
    const shipmentId = id ?? `RS-${this.p.corrida}-${String(++this.contadorEnvios).padStart(6, '0')}`;
    const s = {
      shipmentId,
      zonaId: zona.zonaId,
      hubId: zona.hubId,
      tasaFallo: zona.tasaFallo,
      repartidorId: null,
      secuencia: 0,
      intento: 0,
      rng,
      perfil,
      anomalias,
      retenido: null,
      demora: null,
    };
    this.envios.set(shipmentId, s);

    const prf = PERFILES[perfil];
    s.venceEn = prf.venceEn(t, s);
    if (perfil === 'normal' && rng.probabilidad(this.p.probDemora)) s.demora = rng.probabilidad(0.5) ? 'ANTES_HUB' : 'EN_HUB';

    this.emitirEstado(s, 'CREADO', t, {}, salida);
    salida.push(this.mensaje(TOPICS.PROMESAS, s.shipmentId, {
      eventId: this.nuevoEventId(),
      shipmentId: s.shipmentId,
      tipo: 'PROMESA_CREADA',
      ocurridoEn: iso(t),
      venceEn: iso(s.venceEn),
      hubId: s.hubId,
      zonaId: s.zonaId,
      repartidorId: null,
      version: VERSION_ESQUEMA,
    }));
    this.programar(prf.tIngreso(t, s), { accion: 'ingresar', shipmentId });
    return s;
  }

  ingresar(s, t, salida) {
    this.emitirEstado(s, 'INGRESADO_HUB', t, {}, salida);
    this.programar(PERFILES[s.perfil].tClasificar(t, s), { accion: 'clasificar', shipmentId: s.shipmentId });
  }

  clasificar(s, t, salida) {
    s.repartidorId = s.rng.elegir(repartidoresDeZona(s.zonaId));
    this.emitirEstado(s, 'CLASIFICADO', t, { intento: s.intento + 1 }, salida);
    this.programar(PERFILES[s.perfil].tSalida(t, s), { accion: 'salir', shipmentId: s.shipmentId });
  }

  salir(s, t, salida) {
    s.intento++;
    this.emitirEstado(s, 'EN_REPARTO', t, { intento: s.intento }, salida);
    this.programar(PERFILES[s.perfil].tResultado(t, s), { accion: 'resolver', shipmentId: s.shipmentId });
  }

  resolver(s, t, salida) {
    const prf = PERFILES[s.perfil];
    const resultado = prf.resultado(s, t, this.p);
    if (resultado.entregado) {
      this.emitirEstado(s, 'ENTREGADO', t, { intento: s.intento }, salida, true);
      this.envios.delete(s.shipmentId);
      return;
    }
    const motivo = resultado.motivo;
    const dec = decidirReprogramacion({ motivo, intento: s.intento, ocurridoEn: t });
    const final = dec.decision !== 'REPROGRAMADO';
    this.emitirEstado(s, 'ENTREGA_FALLIDA', t, { motivo, intento: s.intento }, salida, true);
    if (final) {
      this.envios.delete(s.shipmentId); // retenido o devuelto: sale del circuito
      return;
    }
    // El depósito ejecuta la reprogramación: se vuelve a clasificar antes de la nueva franja.
    this.programar(prf.tReintento(t, s, aMs(dec.nuevaFecha)), { accion: 'clasificar', shipmentId: s.shipmentId });
  }

  // ---------------------------------------------------------------- emisión y anomalías

  nuevoEventId() {
    return `E-${this.p.corrida}-${this.p.reinicio}-${++this.contadorEventos}`;
  }

  mensaje(topic, key, valor) {
    this.stats.eventos++;
    return { topic, key, value: typeof valor === 'string' ? valor : JSON.stringify(valor) };
  }

  emitirEstado(s, tipo, t, extra, salida, final = false) {
    const evento = {
      eventId: this.nuevoEventId(),
      shipmentId: s.shipmentId,
      tipo,
      ocurridoEn: iso(t),
      secuencia: ++s.secuencia,
      hubId: s.hubId,
      zonaId: s.zonaId,
      repartidorId: s.repartidorId,
      version: VERSION_ESQUEMA,
      ...extra,
    };
    const msg = this.mensaje(TOPICS.ESTADOS, s.shipmentId, evento);
    const rng = s.rng;

    if (s.anomalias && rng.probabilidad(this.p.probMalformado)) {
      salida.push(this.malformar(evento, rng));
    }
    // Fuera de orden: se retiene este evento y se publica DESPUÉS del siguiente del mismo envío.
    // Solo se retienen estados intermedios, nunca el resultado de un intento.
    if (s.anomalias && !final && !s.retenido && rng.probabilidad(this.p.probFueraDeOrden)) {
      s.retenido = msg;
      this.stats.fueraDeOrden++;
      return evento;
    }
    salida.push(msg);
    if (s.anomalias && rng.probabilidad(this.p.probDuplicado)) {
      salida.push({ ...msg });
      this.stats.duplicados++;
    }
    if (s.retenido) {
      salida.push(s.retenido);
      s.retenido = null;
    }
    return evento;
  }

  /** Copia corrupta adicional del evento (el original igual se publica). */
  malformar(evento, rng) {
    this.stats.malformados++;
    const copia = { ...evento };
    switch (rng.entero(0, 3)) {
      case 0:
        return this.mensaje(TOPICS.ESTADOS, evento.shipmentId, JSON.stringify(copia).slice(0, -9)); // JSON cortado
      case 1:
        delete copia.ocurridoEn;
        break;
      case 2:
        copia.tipo = 'ESTADO_DESCONOCIDO';
        break;
      default:
        copia.secuencia = 'tres';
    }
    return this.mensaje(TOPICS.ESTADOS, evento.shipmentId, copia);
  }

  // ---------------------------------------------------------------- escenarios a pedido

  escenario(nombre, t = this.ahora) {
    const salida = [];
    const id = () => `RS-${this.p.corrida}-D${String(++this.contadorDemo).padStart(5, '0')}`;
    const crear = (perfil) => {
      const s = this.crearEnvio(t, { rng: this.rngEscenarios, perfil, anomalias: false, id: id() }, salida);
      this.stats.creadosEscenario++;
      return s.shipmentId;
    };
    let shipmentIds = [];
    switch (nombre) {
      case 'feliz':
      case 'ausente':
      case 'demorado':
      case 'tercer-fallo':
        shipmentIds = [crear(nombre)];
        break;
      case 'rafaga':
        for (let i = 0; i < 500; i++) {
          const s = this.crearEnvio(t, { rng: this.rngEscenarios, perfil: 'normal', anomalias: true }, salida);
          this.stats.creadosEscenario++;
          shipmentIds.push(s.shipmentId);
        }
        break;
      case 'malformado': {
        const sid = `RS-${this.p.corrida}-MAL${String(++this.contadorDemo).padStart(4, '0')}`;
        const falso = {
          eventId: this.nuevoEventId(),
          shipmentId: sid,
          tipo: 'ENTREGADO',
          ocurridoEn: iso(t),
          secuencia: 'uno', // inválido: debe ser entero
          version: VERSION_ESQUEMA,
        };
        salida.push(this.mensaje(TOPICS.ESTADOS, sid, falso));
        this.stats.malformados++;
        shipmentIds = [sid];
        break;
      }
      default:
        throw new Error(`Escenario desconocido: ${nombre}. Opciones: ${ESCENARIOS.join(', ')}`);
    }
    return { shipmentIds, salida };
  }
}

// ---------------------------------------------------------------- perfiles de tiempos

const u = (s, a, b) => s.rng.uniforme(a, b);

const NORMAL = {
  // Promesa: 20:00 del día hábil siguiente a la creación.
  venceEn: (t) => siguienteDiaHabil(t) + 20 * HORA,
  tIngreso: (t, s) => t + (s.demora === 'ANTES_HUB' ? u(s, 26, 34) : u(s, 1, 4)) * HORA,
  tClasificar: (t, s) => t + u(s, 0.5, 2) * HORA,
  tSalida: (t, s) => {
    // Demora en hub: el paquete no sale hasta después del vencimiento (dispara SIN_SALIDA y VENCIDO).
    if (s.demora === 'EN_HUB' && s.intento === 0) return proximaSalida(Math.max(t + 15 * MINUTO, s.venceEn));
    return proximaSalida(t + 15 * MINUTO);
  },
  tResultado: (t, s) => t + u(s, 0.5, 5.5) * HORA,
  resultado: (s, t, p) => {
    const prob = Math.min(0.95, s.tasaFallo * p.multiplicadorFranja[franjaDe(t)]);
    if (!s.rng.probabilidad(prob)) return { entregado: true };
    return { motivo: s.rng.ponderado(p.motivos) };
  },
  tReintento: (t, s, nuevaFecha) => nuevaFecha - u(s, 1, 2) * HORA,
};

// Escenarios de demo: tiempos cortos (con el factor por defecto, 30 min simulados = 15 s reales).
const rapido = (min) => (t) => t + min * MINUTO;

export const PERFILES = {
  normal: NORMAL,
  feliz: {
    venceEn: (t) => t + 24 * HORA,
    tIngreso: rapido(30),
    tClasificar: rapido(30),
    tSalida: rapido(30),
    tResultado: rapido(60),
    resultado: () => ({ entregado: true }),
    tReintento: () => {
      throw new Error('el envío feliz no se reprograma');
    },
  },
  ausente: {
    venceEn: (t) => siguienteDiaHabil(t) + 20 * HORA,
    tIngreso: rapido(30),
    tClasificar: rapido(30),
    tSalida: (t, s) => (s.intento === 0 ? t + 30 * MINUTO : proximaSalida(t + 15 * MINUTO)),
    tResultado: rapido(60),
    resultado: (s) => (s.intento === 1 ? { motivo: 'AUSENTE' } : { entregado: true }),
    tReintento: (t, s, nuevaFecha) => nuevaFecha - HORA, // respeta la regla: día hábil siguiente, franja opuesta
  },
  demorado: {
    // Vence en 10,5 h: ingresa al hub enseguida (no dispara SIN_INGRESO, cuyo umbral es 10 h)
    // y después queda detenido. SIN_SALIDA se dispara a las 6,5 h simuladas (~3 min reales).
    venceEn: (t) => t + 10.5 * HORA,
    tIngreso: rapido(5),
    tClasificar: rapido(10),
    tSalida: (t, s) => s.venceEn - HORA, // queda detenido: SIN_SALIDA se dispara a venceEn - 4 h
    tResultado: rapido(45),
    resultado: () => ({ entregado: true }), // se entrega antes del vencimiento: la alerta se cierra
    tReintento: () => {
      throw new Error('el envío demorado no se reprograma');
    },
  },
  'tercer-fallo': {
    venceEn: (t) => siguienteDiaHabil(t) + 20 * HORA,
    tIngreso: rapido(20),
    tClasificar: rapido(20),
    tSalida: rapido(20),
    tResultado: rapido(30),
    resultado: () => ({ motivo: 'AUSENTE' }),
    tReintento: rapido(20), // comprimido para la demo
  },
};
