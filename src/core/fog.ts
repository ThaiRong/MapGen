/**
 * Туман войны (итерация 7): три независимые маски на карту.
 *
 * Мир бесконечен, поэтому маска — разреженное множество скрытых
 * тайлов плюс флаг инверсии: скрыто = inverted XOR (тайл в множестве).
 * «Скрыть всё» = inverted=true с пустым множеством; «раскрыть всё» =
 * inverted=false с пустым множеством; инверсия — переключение флага.
 * Компактно: отсортированный массив чисел, сериализуется в .mapkg.
 * Чистые функции, без состояния приложения.
 */

import type { FogCategory, FogMask, FogState, Vec2 } from "./types";

export const FOG_TILE_SIZE = 64;
export const FOG_CATEGORIES: FogCategory[] = ["landscape", "topography", "objects"];

/** Упаковка координат тайла в число (диапазон ±32768 тайлов). */
export function tileKey(tx: number, ty: number): number {
  return ((tx + 32768) & 0xffff) | (((ty + 32768) & 0xffff) << 16);
}

export function tileKeyToCoords(key: number): { tx: number; ty: number } {
  return { tx: (key & 0xffff) - 32768, ty: ((key >>> 16) & 0xffff) - 32768 };
}

export function tileOf(x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / FOG_TILE_SIZE), ty: Math.floor(y / FOG_TILE_SIZE) };
}

export function emptyMask(): FogMask {
  return { inverted: false, tiles: [] };
}

export function emptyFog(): FogState {
  return { landscape: emptyMask(), topography: emptyMask(), objects: emptyMask() };
}

function hasTile(mask: FogMask, key: number): boolean {
  // Бинарный поиск по отсортированному массиву.
  let lo = 0;
  let hi = mask.tiles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (mask.tiles[mid] === key) return true;
    if (mask.tiles[mid] < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

/** Скрыт ли тайл в маске (XOR-семантика). */
export function maskHidesTile(mask: FogMask, key: number): boolean {
  return mask.inverted !== hasTile(mask, key);
}

/** Скрыта ли точка мира в категории тумана. */
export function fogHidesPoint(fog: FogState | undefined, category: FogCategory, x: number, y: number): boolean {
  if (!fog) return false; // миграция: нет тумана — всё раскрыто
  const { tx, ty } = tileOf(x, y);
  return maskHidesTile(fog[category], tileKey(tx, ty));
}

function withTiles(mask: FogMask, keys: number[], add: boolean): FogMask {
  const set = new Set(mask.tiles);
  for (const key of keys) {
    if (add) set.add(key);
    else set.delete(key);
  }
  const tiles = [...set].sort((a, b) => a - b);
  if (tiles.length === mask.tiles.length && tiles.every((t, i) => t === mask.tiles[i])) {
    return mask;
  }
  return { ...mask, tiles };
}

/**
 * Круговой штрих кисти: тайлы, чьи центры попадают в круг радиуса
 * radius вокруг (cx, cy). reveal=true — раскрыть, false — скрыть.
 * В инвертированной маске добавление/удаление зеркальны.
 */
export function paintFogCircle(
  mask: FogMask,
  cx: number,
  cy: number,
  radius: number,
  reveal: boolean,
): FogMask {
  const r = Math.max(FOG_TILE_SIZE / 2, radius);
  const min = tileOf(cx - r, cy - r);
  const max = tileOf(cx + r, cy + r);
  const keys: number[] = [];
  for (let ty = min.ty; ty <= max.ty; ty += 1) {
    for (let tx = min.tx; tx <= max.tx; tx += 1) {
      const centerX = (tx + 0.5) * FOG_TILE_SIZE;
      const centerY = (ty + 0.5) * FOG_TILE_SIZE;
      if (Math.hypot(centerX - cx, centerY - cy) <= r + FOG_TILE_SIZE / 2) {
        keys.push(tileKey(tx, ty));
      }
    }
  }
  // В обычной маске «скрыть» = добавить тайлы; в инвертированной — наоборот.
  const add = reveal === mask.inverted;
  return withTiles(mask, keys, add);
}

/** Тайлы, покрывающие произвольный многоугольник (по bbox + центры внутри). */
export function maskForPolygon(mask: FogMask, points: Vec2[], reveal: boolean): FogMask {
  if (points.length === 0) return mask;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const min = tileOf(minX, minY);
  const max = tileOf(maxX, maxY);
  const keys: number[] = [];
  for (let ty = min.ty; ty <= max.ty; ty += 1) {
    for (let tx = min.tx; tx <= max.tx; tx += 1) {
      const centerX = (tx + 0.5) * FOG_TILE_SIZE;
      const centerY = (ty + 0.5) * FOG_TILE_SIZE;
      if (pointInPolygon({ x: centerX, y: centerY }, points) || boxOverlaps(points, tx, ty)) {
        keys.push(tileKey(tx, ty));
      }
    }
  }
  const add = reveal === mask.inverted;
  return withTiles(mask, keys, add);
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function boxOverlaps(points: Vec2[], tx: number, ty: number): boolean {
  const x0 = tx * FOG_TILE_SIZE;
  const y0 = ty * FOG_TILE_SIZE;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return maxX >= x0 && minX <= x0 + FOG_TILE_SIZE && maxY >= y0 && minY <= y0 + FOG_TILE_SIZE;
}

/** Раскрыть всё в категории. */
export function revealAllMask(): FogMask {
  return emptyMask();
}

/** Скрыть всё в категории. */
export function hideAllMask(): FogMask {
  return { inverted: true, tiles: [] };
}

/** Инверсия категории: скрытое становится раскрытым и наоборот. */
export function invertMask(mask: FogMask): FogMask {
  return { ...mask, inverted: !mask.inverted };
}

/** Число скрытых тайлов категории в заданной области (для подтверждений). */
export function countHiddenTiles(mask: FogMask, bounds: { x: number; y: number; width: number; height: number }): number {
  const min = tileOf(bounds.x, bounds.y);
  const max = tileOf(bounds.x + bounds.width, bounds.y + bounds.height);
  let count = 0;
  for (let ty = min.ty; ty <= max.ty; ty += 1) {
    for (let tx = min.tx; tx <= max.tx; tx += 1) {
      if (maskHidesTile(mask, tileKey(tx, ty))) count += 1;
    }
  }
  return count;
}

/** Применяет функцию к выбранным категориям тумана. */
export function mapFogCategories(
  fog: FogState,
  categories: FogCategory[],
  fn: (mask: FogMask) => FogMask,
): FogState {
  const next: FogState = { ...fog };
  for (const category of categories) {
    next[category] = fn(fog[category]);
  }
  return next;
}
