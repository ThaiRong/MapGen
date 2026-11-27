/**
 * Детерминированная процедурная генерация примитивов.
 *
 * Генератор не знает, что он рисует: только скалярные поля, пороги,
 * плотности и детализация. Сеттинг придаёт пользователь через легенду.
 * Один seed + один spec = побайтово идентичный результат.
 * Чистая функция: без DOM, состояния приложения и файловой системы.
 */

import type { GenerationSpec, Primitive, PrimitiveKind, Vec2 } from "../types";
import { chainClosedContours, douglasPeucker, marchingSquares } from "./contours";
import { buildFieldGrid, sampleField } from "./field";
import { createRng, type Rng } from "./rng";

export interface GenerationStats {
  areas: number;
  lines: number;
  points: number;
  labels: number;
  vertices: number;
}

export interface GenerationResult {
  primitives: Primitive[];
  stats: GenerationStats;
  warnings: string[];
}

/* ---------- Лимиты производительности ---------- */
export const MAX_FIELD_RES = 160;
export const MAX_AREAS = 96;
export const MAX_LINES = 160;
export const MAX_POINTS = 400;
export const MAX_TOTAL_PRIMITIVES = 800;
export const MAX_VERTICES_PER_PRIMITIVE = 400;

const FIXED_TS = "1970-01-01T00:00:00.000Z";
const MAX_LINE_STEPS = 380;

interface FieldOpts {
  seed: string;
  fieldScale: number;
  octaves: number;
  relief: number;
  moisture: number;
  temperature: number;
}

function heightAt(wx: number, wy: number, worldScale: number, o: FieldOpts): number {
  const k = 4 / worldScale;
  return sampleField(wx * k, wy * k, {
    seed: o.seed,
    kind: "height",
    fieldScale: o.fieldScale,
    octaves: o.octaves,
    relief: o.relief,
    bias: 0.5,
  });
}

function makePrimitive(kind: PrimitiveKind, name: string, typeId: string, id: string): Primitive {
  const base = {
    id,
    kind,
    name,
    typeId,
    origin: "generated" as const,
    generationId: "",
    note: "",
    visible: true,
    locked: false,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
  if (kind === "line") return { ...base, kind, points: [] as Vec2[] };
  if (kind === "area") return { ...base, kind, points: [] as Vec2[] };
  if (kind === "point") return { ...base, kind, x: 0, y: 0 };
  return { ...base, kind, x: 0, y: 0, text: "", fontSize: 14 };
}

function polygonArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(sum / 2);
}

function centroid(points: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Упрощение до лимита вершин; при неудаче — жёсткое обрезание. */
function capVertices(points: Vec2[], epsilon: number, warnings: string[]): Vec2[] {
  let pts = points;
  let guard = 0;
  while (pts.length > MAX_VERTICES_PER_PRIMITIVE && guard < 8) {
    guard += 1;
    const simplified = douglasPeucker(pts, epsilon * 1.7 ** guard);
    if (simplified.length >= pts.length) break;
    pts = simplified;
  }
  if (pts.length > MAX_VERTICES_PER_PRIMITIVE) {
    warnings.push(
      `Один из примитивов превысил лимит ${MAX_VERTICES_PER_PRIMITIVE} вершин — геометрия упрощена принудительно`,
    );
    pts = pts.slice(0, MAX_VERTICES_PER_PRIMITIVE);
  }
  return pts;
}

export function generate(spec: GenerationSpec, opts?: { preview?: boolean }): GenerationResult {
  const warnings: string[] = [];
  const rng: Rng = createRng(spec.seed);
  const bounds = spec.bounds;
  const worldScale = Math.max(bounds.width, bounds.height) || 1;

  // Разрешение сетки зависит от detail и ограничено сверху;
  // предпросмотр считается в пониженном разрешении.
  let res = 28 + Math.round(spec.detail * (MAX_FIELD_RES - 28));
  if (opts?.preview) res = Math.max(24, Math.floor(res / 2));
  res = Math.min(MAX_FIELD_RES, Math.max(24, res));
  const octaves = 2 + Math.round(spec.detail * 4); // 2..6
  const cellW = bounds.width / res;
  const cellH = bounds.height / res;
  const cellSize = Math.max(cellW, cellH);

  const fieldOpts: FieldOpts = {
    seed: spec.seed,
    fieldScale: spec.fieldScale,
    octaves,
    relief: spec.relief,
    moisture: spec.moisture,
    temperature: spec.temperature,
  };

  const heightGrid = buildFieldGrid(bounds, res, {
    seed: spec.seed,
    kind: "height",
    fieldScale: spec.fieldScale,
    octaves,
    relief: spec.relief,
    bias: 0.5,
  });
  const moistureGrid = buildFieldGrid(bounds, res, {
    seed: spec.seed,
    kind: "moisture",
    fieldScale: spec.fieldScale * 0.8,
    octaves,
    relief: spec.relief * 0.6,
    bias: spec.moisture,
  });
  const temperatureGrid = buildFieldGrid(bounds, res, {
    seed: spec.seed,
    kind: "temperature",
    fieldScale: spec.fieldScale * 0.6,
    octaves,
    relief: 0.3,
    bias: (spec.temperature + 1) / 2,
  });

  const primitives: Primitive[] = [];
  let idCounter = 0;
  const nextId = () => {
    idCounter += 1;
    return `gen-${idCounter}`;
  };
  // Упрощение — умеренное и зависящее от детализации слабо: низкая
  // детализация не должна «съедать» мелкие замкнутые контуры.
  const simplifyEpsilon = cellSize * (0.35 + (1 - spec.detail) * 0.5);

  /* ---------- Области: изолинии полей ---------- */
  // Уровни нормированы к фактическому диапазону поля высот: при гладком
  // поле (малый масштаб/детализация) абсолютные значения часто лежали бы
  // вне диапазона и не давали бы ни одного контура.
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const v of heightGrid) {
    if (v < hMin) hMin = v;
    if (v > hMax) hMax = v;
  }
  const hRange = Math.max(1e-6, hMax - hMin);
  const levelOf = (t: number) => hMin + Math.min(0.97, Math.max(0.03, t)) * hRange;

  // Число уровней полностью управляется areaDensity: при нуле — ни одной
  // изолинии и ни одного мусорного примитива.
  const areaLevels: { t: number; source: "height" | "moisture" }[] = [];
  const above = Math.round(spec.areaDensity * 4); // 0..4 уровня выше порога
  for (let k = 1; k <= above; k += 1) {
    areaLevels.push({ t: spec.fluidLevel + (1 - spec.fluidLevel) * (k / (above + 1)), source: "height" });
  }
  const below = Math.round(spec.areaDensity * 2); // 0..2 ниже порога
  for (let k = 1; k <= below; k += 1) {
    areaLevels.push({ t: spec.fluidLevel * (k / (below + 1)), source: "height" });
  }
  if (spec.areaDensity > 0.4) {
    areaLevels.push({ t: 0.5, source: "moisture" });
  }

  const areaPolygons: { points: Vec2[]; source: "height" | "moisture"; level: number }[] = [];
  for (const { t, source } of areaLevels) {
    const grid = source === "height" ? heightGrid : moistureGrid;
    const level = source === "height" ? levelOf(t) : t;
    const segments = marchingSquares(grid, res, bounds, level);
    const loops = chainClosedContours(segments);
    for (const loop of loops) {
      const simplified = douglasPeucker(loop, simplifyEpsilon);
      // Защита от коллапса: упрощение не должно «съесть» контур
      // целиком — тогда берём исходную замкнутую цепочку.
      const finalPoints = simplified.length >= 3 ? simplified : loop;
      if (finalPoints.length < 3) continue;
      areaPolygons.push({ points: capVertices(finalPoints, simplifyEpsilon, warnings), source, level: t });
    }
  }
  areaPolygons.sort((a, b) => polygonArea(b.points) - polygonArea(a.points));
  if (spec.areaDensity > 0 && areaPolygons.length === 0) {
    warnings.push(
      "Замкнутых контуров не найдено: при таком масштабе поля структуры касаются границы области. Увеличьте «Масштаб поля» или «Плотность областей».",
    );
  }
  let droppedAreas = 0;
  for (const poly of areaPolygons) {
    if (primitives.filter((p) => p.kind === "area").length >= MAX_AREAS) {
      droppedAreas += 1;
      continue;
    }
    const primitive = makePrimitive("area", "Область", spec.typeMapping.area, nextId());
    if (primitive.kind === "area") primitive.points = poly.points;
    primitives.push(primitive);
  }
  if (droppedAreas > 0) {
    warnings.push(`Слишком много областей — ${droppedAreas} мелких отброшено (лимит ${MAX_AREAS})`);
  }

  /* ---------- Линии: спуск по градиенту от локальных максимумов ---------- */
  const lineCount = Math.round(spec.lineDensity * MAX_LINES);
  if (lineCount > 0) {
    const size = res + 1;
    const maxima: { i: number; j: number; value: number }[] = [];
    for (let j = 1; j < res; j += 1) {
      for (let i = 1; i < res; i += 1) {
        const v = heightGrid[j * size + i];
        const neighbors = [
          heightGrid[j * size + i - 1],
          heightGrid[j * size + i + 1],
          heightGrid[(j - 1) * size + i],
          heightGrid[(j + 1) * size + i],
        ];
        if (neighbors.every((n) => v > n) && v > 0.55 + spec.relief * 0.15) {
          maxima.push({ i, j, value: v });
        }
      }
    }
    maxima.sort((a, b) => b.value - a.value);
    // Набор семян: сначала локальные максимумы с просторным spacing,
    // при нехватке — проходы с ослабленным spacing; если максимумов
    // не хватило вообще, добираем детерминированными случайными точками
    // на достаточно высоких участках поля.
    const seeds: Vec2[] = [];
    let droppedLines = 0;
    for (const spacingFactor of [6, 2, 0]) {
      if (seeds.length >= lineCount) break;
      const minSpacing = cellSize * spacingFactor;
      for (const m of maxima) {
        if (seeds.length >= lineCount) break;
        const w: Vec2 = {
          x: bounds.x + (m.i / res) * bounds.width,
          y: bounds.y + (m.j / res) * bounds.height,
        };
        if (seeds.some((s) => Math.hypot(s.x - w.x, s.y - w.y) < minSpacing)) continue;
        seeds.push(w);
      }
    }
    let attempts = 0;
    while (seeds.length < lineCount && attempts < lineCount * 30) {
      attempts += 1;
      const w: Vec2 = {
        x: bounds.x + rng() * bounds.width,
        y: bounds.y + rng() * bounds.height,
      };
      if (heightAt(w.x, w.y, worldScale, fieldOpts) < 0.45) continue;
      if (seeds.some((s) => Math.hypot(s.x - w.x, s.y - w.y) < cellSize * 2)) continue;
      seeds.push(w);
    }

    const gradientStep = cellSize;
    for (const seed of seeds) {
      const pts: Vec2[] = [{ x: seed.x, y: seed.y }];
      let px = seed.x;
      let py = seed.y;
      for (let step = 0; step < MAX_LINE_STEPS; step += 1) {
        const gx =
          (heightAt(px + gradientStep, py, worldScale, fieldOpts) -
            heightAt(px - gradientStep, py, worldScale, fieldOpts)) /
          (2 * gradientStep);
        const gy =
          (heightAt(px, py + gradientStep, worldScale, fieldOpts) -
            heightAt(px, py - gradientStep, worldScale, fieldOpts)) /
          (2 * gradientStep);
        const mag = Math.hypot(gx, gy);
        if (mag < 1e-6) break; // впадина — стоячая вода
        let dirX = -gx / mag;
        let dirY = -gy / mag;
        // Детерминированное меандрирование.
        const meander = (rng() - 0.5) * 0.6;
        const cos = Math.cos(meander);
        const sin = Math.sin(meander);
        const rx = dirX * cos - dirY * sin;
        const ry = dirX * sin + dirY * cos;
        dirX = rx;
        dirY = ry;
        px += dirX * cellSize * 0.8;
        py += dirY * cellSize * 0.8;
        if (px < bounds.x || px > bounds.x + bounds.width || py < bounds.y || py > bounds.y + bounds.height) {
          break;
        }
        pts.push({ x: px, y: py });
      }
      const simplified = douglasPeucker(pts, simplifyEpsilon * 1.2);
      if (simplified.length < 2) {
        droppedLines += 1;
        continue;
      }
      const primitive = makePrimitive("line", "Линия", spec.typeMapping.line, nextId());
      if (primitive.kind === "line") {
        primitive.points = capVertices(simplified, simplifyEpsilon, warnings);
      }
      primitives.push(primitive);
    }
    if (droppedLines > 0) {
      warnings.push(`${droppedLines} коротких линий отброшено (меньше 2 точек после упрощения)`);
    }
  }

  /* ---------- Точки: стратифицированная сетка с джиттером ---------- */
  const pointCount = Math.round(spec.pointDensity * MAX_POINTS);
  if (pointCount > 0) {
    const gridN = Math.max(1, Math.ceil(Math.sqrt(pointCount)));
    const cw = bounds.width / gridN;
    const ch = bounds.height / gridN;
    const size = res + 1;
    let placed = 0;
    for (let j = 0; j < gridN && placed < pointCount; j += 1) {
      for (let i = 0; i < gridN && placed < pointCount; i += 1) {
        const cx = bounds.x + (i + 0.5) * cw;
        const cy = bounds.y + (j + 0.5) * ch;
        const x = cx + (rng() - 0.5) * cw * 0.8;
        const y = cy + (rng() - 0.5) * ch * 0.8;
        // Температурное поле влияет на вероятность размещения
        // (без семантики — просто детерминированный множитель).
        const ti = Math.min(res, Math.max(0, Math.round(((y - bounds.y) / bounds.height) * res)));
        const tj = Math.min(res, Math.max(0, Math.round(((x - bounds.x) / bounds.width) * res)));
        const t = temperatureGrid[ti * size + tj] ?? 0.5;
        const acceptP = 0.45 + Math.abs(t - 0.5);
        if (rng() > acceptP) continue;
        const primitive = makePrimitive("point", "Точка", spec.typeMapping.point, nextId());
        if (primitive.kind === "point") {
          primitive.x = Math.round(x);
          primitive.y = Math.round(y);
        }
        primitives.push(primitive);
        placed += 1;
      }
    }
  }

  /* ---------- Подписи уровней (по умолчанию выключены) ---------- */
  if (spec.labels.enabled) {
    const byLevel = new Map<string, Vec2[]>();
    for (const poly of areaPolygons) {
      if (poly.source !== "height") continue;
      const key = poly.level.toFixed(4);
      if (!byLevel.has(key)) byLevel.set(key, poly.points);
    }
    let labelCount = 0;
    for (const [key, points] of byLevel) {
      if (labelCount >= 6) break;
      const level = Number(key);
      const c = centroid(points);
      const primitive = makePrimitive("label", "Подпись", spec.typeMapping.label, nextId());
      if (primitive.kind === "label") {
        primitive.x = Math.round(c.x);
        primitive.y = Math.round(c.y);
        primitive.text = `Уровень ${level.toFixed(2)}`;
      }
      primitives.push(primitive);
      labelCount += 1;
    }
  }

  /* ---------- Общий лимит примитивов ---------- */
  if (primitives.length > MAX_TOTAL_PRIMITIVES) {
    const cut = primitives.length - MAX_TOTAL_PRIMITIVES;
    primitives.length = MAX_TOTAL_PRIMITIVES;
    warnings.push(
      `Превышен общий лимит ${MAX_TOTAL_PRIMITIVES} примитивов — ${cut} мелких объектов отброшено`,
    );
  }

  const stats: GenerationStats = {
    areas: primitives.filter((p) => p.kind === "area").length,
    lines: primitives.filter((p) => p.kind === "line").length,
    points: primitives.filter((p) => p.kind === "point").length,
    labels: primitives.filter((p) => p.kind === "label").length,
    vertices: primitives.reduce(
      (sum, p) => sum + (p.kind === "line" || p.kind === "area" ? p.points.length : 1),
      0,
    ),
  };
  return { primitives, stats, warnings };
}
