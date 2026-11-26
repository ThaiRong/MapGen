/**
 * Value noise и fBm, реализованные с нуля.
 * Решётка хэшируется целочисленной смешивающей функцией — результат
 * не зависит от платформы и порядка вычислений.
 */

/** Целочисленный хэш 2D-координат решётки (xorshift-финализация). */
function latticeHash(ix: number, iy: number, seedOffset: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seedOffset, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise в диапазоне [0, 1]. */
export function valueNoise2(x: number, y: number, seedOffset: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = latticeHash(x0, y0, seedOffset);
  const v10 = latticeHash(x0 + 1, y0, seedOffset);
  const v01 = latticeHash(x0, y0 + 1, seedOffset);
  const v11 = latticeHash(x0 + 1, y0 + 1, seedOffset);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Фрактальный шум (fBm), нормализованный примерно в [0, 1].
 * Число октав задаёт вызывающий код (зависит от detail).
 */
export function fbm2(x: number, y: number, seedOffset: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * valueNoise2(x * frequency, y * frequency, seedOffset + i * 1013);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}
