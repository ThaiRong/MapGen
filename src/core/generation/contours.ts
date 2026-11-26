/**
 * Изолинии сетки методом marching squares и упрощение
 * Дугласа — Пекера. Только замкнутые контуры — будущие области.
 */

import type { Vec2 } from "../types";

interface Segment {
  a: Vec2;
  b: Vec2;
}

/**
 * Сегменты изолинии level для сетки grid (row-major, (res+1)²),
 * покрывающей bounds. Линейная интерполяция по рёбрам ячеек.
 */
export function marchingSquares(
  grid: Float32Array,
  res: number,
  bounds: { x: number; y: number; width: number; height: number },
  level: number,
): Segment[] {
  const size = res + 1;
  const segments: Segment[] = [];
  const pointAt = (i: number, j: number): Vec2 => ({
    x: bounds.x + (i / res) * bounds.width,
    y: bounds.y + (j / res) * bounds.height,
  });
  const lerpT = (v0: number, v1: number): number => {
    const d = v1 - v0;
    if (Math.abs(d) < 1e-12) return 0.5;
    const t = (level - v0) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };

  for (let j = 0; j < res; j += 1) {
    for (let i = 0; i < res; i += 1) {
      const v00 = grid[j * size + i];
      const v10 = grid[j * size + i + 1];
      const v01 = grid[(j + 1) * size + i];
      const v11 = grid[(j + 1) * size + i + 1];
      let caseIndex = 0;
      if (v00 > level) caseIndex |= 1;
      if (v10 > level) caseIndex |= 2;
      if (v11 > level) caseIndex |= 4;
      if (v01 > level) caseIndex |= 8;
      if (caseIndex === 0 || caseIndex === 15) continue;

      // Точки на рёбрах ячейки.
      const pTop: Vec2 = { x: pointAt(i, j).x + lerpT(v00, v10) * (bounds.width / res), y: pointAt(i, j).y };
      const pRight: Vec2 = {
        x: pointAt(i + 1, j).x,
        y: pointAt(i + 1, j).y + lerpT(v10, v11) * (bounds.height / res),
      };
      const pBottom: Vec2 = {
        x: pointAt(i, j + 1).x + lerpT(v01, v11) * (bounds.width / res),
        y: pointAt(i, j + 1).y,
      };
      const pLeft: Vec2 = {
        x: pointAt(i, j).x,
        y: pointAt(i, j).y + lerpT(v00, v01) * (bounds.height / res),
      };

      const push = (a: Vec2, b: Vec2) => {
        segments.push({ a, b });
      };
      switch (caseIndex) {
        case 1:
        case 14:
          push(pLeft, pTop);
          break;
        case 2:
        case 13:
          push(pTop, pRight);
          break;
        case 3:
        case 12:
          push(pLeft, pRight);
          break;
        case 4:
        case 11:
          push(pRight, pBottom);
          break;
        case 6:
        case 9:
          push(pTop, pBottom);
          break;
        case 7:
        case 8:
          push(pLeft, pBottom);
          break;
        case 5:
          push(pLeft, pTop);
          push(pRight, pBottom);
          break;
        case 10:
          push(pTop, pRight);
          push(pLeft, pBottom);
          break;
        default:
          break;
      }
    }
  }
  return segments;
}

/**
 * Соединяет сегменты в контуры. Возвращает только замкнутые
 * (первая точка совпадает с последней); незамкнутые (уходящие
 * за границу сетки) отбрасываются.
 */
export function chainClosedContours(segments: Segment[]): Vec2[][] {
  // Индекс точек с округлением — соединяем совпадающие концы.
  const key = (p: Vec2): string => `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;
  const byStart = new Map<string, { seg: Segment; used: boolean }[]>();
  for (const seg of segments) {
    const k = key(seg.a);
    const list = byStart.get(k) ?? [];
    list.push({ seg, used: false });
    byStart.set(k, list);
  }

  const loops: Vec2[][] = [];
  for (const entry of segments.map((seg) => ({ seg, used: false }))) {
    if (entry.used) continue;
    entry.used = true;
    const loop: Vec2[] = [entry.seg.a, entry.seg.b];
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 100000) break;
      const tail = loop[loop.length - 1];
      if (key(tail) === key(loop[0])) break; // замкнулся
      const candidates = byStart.get(key(tail));
      const next = candidates?.find((c) => !c.used);
      if (!next) break;
      next.used = true;
      loop.push(next.seg.b);
    }
    if (loop.length >= 4 && key(loop[loop.length - 1]) === key(loop[0])) {
      loop.pop(); // последняя точка дублирует первую
      loops.push(loop);
    }
  }
  return loops;
}

/**
 * Упрощение Дугласа — Пекера. epsilon в тех же единицах, что координаты.
 */
export function douglasPeucker(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    for (let i = first + 1; i < last; i += 1) {
      const p = points[i];
      let dist: number;
      if (len < 1e-12) {
        dist = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      }
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
