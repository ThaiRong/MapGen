/**
 * RNG для генерации структур — переиспользует ядро итерации 3,
 * второй PRNG не создаётся.
 */

import { createRng, hashSeed, type Rng } from "../rng";

export { createRng, hashSeed };
export type { Rng };

/**
 * Деривация зерна вложенной локации: hash(зерно родительской карты + id
 * маркера). Спека с таким зерном самодостаточна — после записи результат
 * не зависит от родителя.
 */
export function deriveSeed(parentSeed: string, markerId: string): string {
  return `s-${hashSeed(`${parentSeed}::${markerId}`).toString(36)}`;
}
