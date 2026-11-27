/**
 * Геометрические примитивы генерации структур: разбиение области,
 * прямоугольники с искажёнными контурами, фильтры размеров.
 * Только геометрия — никакой семантики.
 */

import type { Rect, Vec2 } from "../../types";
import type { Rng } from "./rng";

/** Отступ от границ области. */
export function insetRect(r: Rect, m: number): Rect {
  const x = r.x + m;
  const y = r.y + m;
  const width = Math.max(1, r.width - m * 2);
  const height = Math.max(1, r.height - m * 2);
  return { x, y, width, height };
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectArea(r: Rect): number {
  return r.width * r.height;
}

/**
 * Прямоугольник как замкнутый полигон с искажением: углы смещены
 * на irregularity, при высокой нерегулярности добавляются смещённые
 * середины рёбер. Минимум 4 вершины.
 */
export function rectPolygon(r: Rect, rng: Rng, irregularity: number): Vec2[] {
  const j = (amt: number): number => (rng() - 0.5) * 2 * amt;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const jx = irregularity * Math.min(r.width, r.height) * 0.18;
  const corners: Vec2[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  // Нерегулярность смещает углы вокруг центра и слегка масштабирует.
  const scale = 1 + j(irregularity * 0.2);
  let pts = corners.map((p) => ({
    x: cx + (p.x - cx + j(jx)) * scale,
    y: cy + (p.y - cy + j(jx)) * scale,
  }));
  if (irregularity > 0.45) {
    const withMid: Vec2[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      withMid.push(a);
      const mx = (a.x + b.x) / 2 + j(jx * 0.8);
      const my = (a.y + b.y) / 2 + j(jx * 0.8);
      // середина ребра не должна уходить далеко за хорду
      const bx = (a.x + b.x) / 2;
      const by = (a.y + b.y) / 2;
      withMid.push({ x: mx * 0.4 + bx * 0.6, y: my * 0.4 + by * 0.6 });
    }
    pts = withMid;
  }
  return pts;
}

/**
 * Рекурсивное разбиение области на ячейки (BSP). Глубина зависит от
 * density и cellScale; позиция разреза смещается нерегулярностью.
 */
export function partitionCells(
  bounds: Rect,
  rng: Rng,
  targetDepth: number,
  irregularity: number,
  minSize: number,
  depth = 0,
): Rect[] {
  const tooSmall = bounds.width < minSize * 2 || bounds.height < minSize * 2;
  if (depth >= targetDepth || tooSmall) return [bounds];
  const horizontal = depth % 2 === 0 ? bounds.width >= bounds.height : bounds.height > bounds.width;
  const t = 0.35 + rng() * 0.3 + (rng() - 0.5) * irregularity * 0.25;
  const cut = Math.min(0.8, Math.max(0.2, t));
  const a: Rect = horizontal
    ? { x: bounds.x, y: bounds.y, width: bounds.width * cut, height: bounds.height }
    : { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height * cut };
  const b: Rect = horizontal
    ? {
        x: bounds.x + bounds.width * cut,
        y: bounds.y,
        width: bounds.width * (1 - cut),
        height: bounds.height,
      }
    : {
        x: bounds.x,
        y: bounds.y + bounds.height * cut,
        width: bounds.width,
        height: bounds.height * (1 - cut),
      };
  return [
    ...partitionCells(a, rng, targetDepth, irregularity, minSize, depth + 1),
    ...partitionCells(b, rng, targetDepth, irregularity, minSize, depth + 1),
  ];
}

/** Масштабирование прямоугольника вокруг центра с ограничением внутри внешнего. */
export function scaleRect(r: Rect, factor: number, within: Rect): Rect {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const w = r.width * factor;
  const h = r.height * factor;
  const x = Math.min(Math.max(cx - w / 2, within.x), within.x + within.width - w);
  const y = Math.min(Math.max(cy - h / 2, within.y), within.y + within.height - h);
  return { x, y, width: w, height: h };
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function polygonArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(sum / 2);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Детерминированная выборка доли элементов (rng перемешивает копию индексов). */
export function pickFraction<T>(items: T[], fraction: number, rng: Rng): T[] {
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const keep = Math.round(items.length * Math.min(1, Math.max(0, fraction)));
  return idx.slice(0, keep).sort((a, b) => a - b).map((i) => items[i]);
}
