/**
 * Детерминированный генератор псевдослучайных чисел.
 * Один seed — одна и та же последовательность на любой машине и в любой момент.
 * Никакого Math.random внутри генерации.
 */

/** Стабильный строковый хэш (FNV-1a, 32 бита) — одинаков везде. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

/** mulberry32 — компактный seeded PRNG, возвращает [0, 1). */
export function createRng(seed: string): Rng {
  let a = hashSeed(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целое в [min, max] включительно. */
export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
