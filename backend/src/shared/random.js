// Generador pseudoaleatorio con semilla (mulberry32): misma semilla => misma corrida.
export function crearRng(semilla) {
  let a = (Number(semilla) >>> 0) || 1;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    siguiente,
    uniforme: (min, max) => min + (max - min) * siguiente(),
    entero: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),
    probabilidad: (p) => siguiente() < p,
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)],
    /** items: [[valor, peso], ...] */
    ponderado: (items) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = siguiente() * total;
      for (const [v, w] of items) {
        if ((r -= w) < 0) return v;
      }
      return items[items.length - 1][0];
    },
    hex: (n) => Array.from({ length: n }, () => Math.floor(siguiente() * 16).toString(16)).join(''),
  };
  return rng;
}
