/**
 * Генерация структуры локации: архетип → нейтральные примитивы
 * и позиции вложенных локаций. Чистая функция, детерминированная.
 * Карты и маркеры создаёт ядро приложения, не генератор.
 */

import type {
  Primitive,
  PrimitiveKind,
  StructureNested,
  StructureResult,
  StructureSpec,
  Vec2,
} from "../../types";
import { generateArchetype, insetRect, type StructureContext } from "./archetypes";
import { createRng } from "./rng";

export const MAX_S_AREAS = 120;
export const MAX_S_LINES = 160;
export const MAX_S_POINTS = 200;
export const MAX_VERTICES_PER_POLY = 64;
export const MAX_PARTITION_DEPTH = 6;

const FIXED_TS = "1970-01-01T00:00:00.000Z";

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

function roundPoints(points: Vec2[]): Vec2[] {
  return points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

export function generateStructure(spec: StructureSpec, opts?: { preview?: boolean }): StructureResult {
  const warnings: string[] = [];
  const rng = createRng(spec.seed);

  // Геометрия строго внутри bounds с учётом margin.
  const marginUnits = Math.min(spec.bounds.width, spec.bounds.height) * 0.08 * spec.margin;
  const bounds = insetRect(spec.bounds, marginUnits);
  if (bounds.width < 40 || bounds.height < 40) {
    warnings.push("Область генерации слишком мала после отступа — уменьшите «Отступ от границ»");
    return {
      primitives: [],
      nested: [],
      stats: { areas: 0, lines: 0, points: 0, labels: 0, nested: 0, vertices: 0 },
      warnings,
    };
  }
  const minSize = Math.max(10, Math.min(bounds.width, bounds.height) * 0.03);
  const charSize = Math.min(bounds.width, bounds.height) * (0.14 + spec.cellScale * 0.22);
  const ctx: StructureContext = { spec, rng, bounds, minSize, charSize };

  const geo = generateArchetype(ctx, opts?.preview === true);

  const primitives: Primitive[] = [];
  let idCounter = 0;
  const nextId = () => {
    idCounter += 1;
    return `st-${idCounter}`;
  };

  const capPoly = (points: Vec2[]): Vec2[] => {
    let pts = roundPoints(points).map((p) => ({
      // Геометрия строго внутри bounds: кинки осей и искажённые углы
      // нерегулярности не должны вылезать за край области.
      x: Math.round(Math.min(spec.bounds.x + spec.bounds.width, Math.max(spec.bounds.x, p.x))),
      y: Math.round(Math.min(spec.bounds.y + spec.bounds.height, Math.max(spec.bounds.y, p.y))),
    }));
    if (pts.length > MAX_VERTICES_PER_POLY) {
      warnings.push(`Контур упрощён до лимита ${MAX_VERTICES_PER_POLY} вершин`);
      pts = pts.slice(0, MAX_VERTICES_PER_POLY);
    }
    return pts;
  };

  for (const pts of geo.areas) {
    if (primitives.filter((p) => p.kind === "area").length >= MAX_S_AREAS) {
      warnings.push(`Превышен лимит ${MAX_S_AREAS} областей — лишние отброшены`);
      break;
    }
    const finalPoints = capPoly(pts);
    if (finalPoints.length < 3) continue;
    const primitive = makePrimitive("area", "Область", spec.typeMapping.area, nextId());
    if (primitive.kind === "area") primitive.points = finalPoints;
    primitives.push(primitive);
  }
  for (const pts of geo.lines) {
    if (primitives.filter((p) => p.kind === "line").length >= MAX_S_LINES) {
      warnings.push(`Превышен лимит ${MAX_S_LINES} линий — лишние отброшены`);
      break;
    }
    const finalPoints = capPoly(pts);
    if (finalPoints.length < 2) continue;
    const primitive = makePrimitive("line", "Связь", spec.typeMapping.line, nextId());
    if (primitive.kind === "line") primitive.points = finalPoints;
    primitives.push(primitive);
  }
  for (const p of geo.points) {
    if (primitives.filter((q) => q.kind === "point").length >= MAX_S_POINTS) {
      warnings.push(`Превышен лимит ${MAX_S_POINTS} точек — лишние отброшены`);
      break;
    }
    const primitive = makePrimitive("point", "Узел", spec.typeMapping.point, nextId());
    if (primitive.kind === "point") {
      primitive.x = Math.round(p.x);
      primitive.y = Math.round(p.y);
    }
    primitives.push(primitive);
  }

  if (spec.labels.enabled) {
    const centroids = geo.areas
      .slice(0, 3)
      .map((pts) => {
        let x = 0;
        let y = 0;
        for (const p of pts) {
          x += p.x;
          y += p.y;
        }
        return { x: Math.round(x / pts.length), y: Math.round(y / pts.length) };
      });
    const targets = centroids.length > 0 ? centroids : [{ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }];
    targets.forEach((p, i) => {
      const primitive = makePrimitive("label", "Подпись", spec.typeMapping.label, nextId());
      if (primitive.kind === "label") {
        primitive.x = p.x;
        primitive.y = p.y;
        primitive.text = `Узел ${i + 1}`;
      }
      primitives.push(primitive);
    });
  }

  const nested: StructureNested[] = geo.nested.map((p, i) => ({
    x: p.x,
    y: p.y,
    label: `Локация ${i + 1}`,
  }));

  const stats: StructureResult["stats"] = {
    areas: primitives.filter((p) => p.kind === "area").length,
    lines: primitives.filter((p) => p.kind === "line").length,
    points: primitives.filter((p) => p.kind === "point").length,
    labels: primitives.filter((p) => p.kind === "label").length,
    nested: nested.length,
    vertices: primitives.reduce(
      (sum, p) => sum + (p.kind === "line" || p.kind === "area" ? p.points.length : 1),
      0,
    ),
  };
  return { primitives, nested, stats, warnings };
}
