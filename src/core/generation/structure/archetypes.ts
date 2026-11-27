/**
 * Архетипы структур: рекурсивное разбиение, оси и ответвления,
 * лучи и кольца, кластеры, разреженное размещение, детерминированная
 * комбинация. Только геометрия — смысл придаёт пользователь легендой.
 */

import type { Rect, StructureArchetype, StructureSpec, Vec2 } from "../../types";
import {
  dist,
  insetRect,
  partitionCells,
  pickFraction,
  polygonArea,
  polygonCentroid,
  rectCenter,
  rectPolygon,
  scaleRect,
} from "./partition";
import type { Rng } from "./rng";

export interface StructureContext {
  spec: StructureSpec;
  rng: Rng;
  /** bounds с учётом margin */
  bounds: Rect;
  minSize: number;
  charSize: number;
}

export interface StructureGeometry {
  areas: Vec2[][];
  lines: Vec2[][];
  points: Vec2[];
  nested: Vec2[];
}

const EMPTY: StructureGeometry = { areas: [], lines: [], points: [], nested: [] };

/** Позиции вложенных локаций: внутри крупнейших элементов, не в пустотах. */
function placeNested(ctx: StructureContext, geo: StructureGeometry, count: number): Vec2[] {
  if (count <= 0) return [];
  const areaCenters = geo.areas
    .map((pts) => ({ pts, c: polygonCentroid(pts), area: polygonArea(pts) }))
    .sort((a, b) => b.area - a.area)
    .map((e) => e.c);
  const candidates = areaCenters.length > 0 ? areaCenters : ctx.bounds
    ? [rectCenter(ctx.bounds)]
    : [];
  if (candidates.length === 0) return [];
  const chosen: Vec2[] = [];
  const minDist = Math.max(ctx.minSize * 0.5, ctx.charSize * 0.4);
  // Равномерный проход по крупнейшим элементам — детерминированно.
  const step = Math.max(1, Math.floor(candidates.length / count));
  for (let i = 0; i < candidates.length && chosen.length < count; i += step) {
    const c = candidates[i];
    if (chosen.every((p) => dist(p, c) >= minDist)) chosen.push({ x: Math.round(c.x), y: Math.round(c.y) });
  }
  for (let i = 0; i < candidates.length && chosen.length < count; i += 1) {
    const c = candidates[i];
    if (chosen.every((p) => dist(p, c) >= minDist)) chosen.push({ x: Math.round(c.x), y: Math.round(c.y) });
  }
  return chosen;
}

/** Точки пересечения луча из центра с границами прямоугольника. */
function rayEdgePoints(center: Vec2, angle: number, b: Rect): Vec2[] {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const hits: Vec2[] = [];
  const push = (t: number): void => {
    const x = center.x + dx * t;
    const y = center.y + dy * t;
    if (x >= b.x - 1e-9 && x <= b.x + b.width + 1e-9 && y >= b.y - 1e-9 && y <= b.y + b.height + 1e-9) {
      hits.push({ x, y });
    }
  };
  if (Math.abs(dx) > 1e-9) {
    push((b.x - center.x) / dx);
    push((b.x + b.width - center.x) / dx);
  }
  if (Math.abs(dy) > 1e-9) {
    push((b.y - center.y) / dy);
    push((b.y + b.height - center.y) / dy);
  }
  // дедупликация и сортировка по расстоянию — детерминизм
  const uniq: Vec2[] = [];
  for (const h of hits) {
    if (!uniq.some((u) => Math.abs(u.x - h.x) < 1e-6 && Math.abs(u.y - h.y) < 1e-6)) uniq.push(h);
  }
  uniq.sort((a, c) => dist(center, a) - dist(center, c));
  return uniq;
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/* ---------- Ячеистая ---------- */

function cellular(ctx: StructureContext, preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize, charSize } = ctx;
  const depth = Math.max(
    2,
    Math.min(6, 2 + Math.round(spec.density * 3) + Math.round((1 - spec.cellScale) * 2) - (preview ? 1 : 0)),
  );
  const cells = partitionCells(bounds, rng, depth, spec.irregularity, minSize);
  const kept = pickFraction(cells, spec.density, rng);
  const areas: Vec2[][] = [];
  const keptRects: Rect[] = [];
  for (const cell of kept) {
    const f = 1 + (rng() - 0.5) * 2 * spec.sizeVariance * 0.35;
    const scaled = scaleRect(cell, Math.max(0.4, f), bounds);
    if (scaled.width < minSize * 0.6 || scaled.height < minSize * 0.6) continue;
    keptRects.push(scaled);
    areas.push(rectPolygon(scaled, rng, spec.irregularity));
  }
  // Связи между соседями: близкие рёбра + connectivity.
  const lines: Vec2[][] = [];
  const centers = keptRects.map(rectCenter);
  for (let i = 0; i < keptRects.length; i += 1) {
    for (let j = i + 1; j < keptRects.length; j += 1) {
      const a = keptRects[i];
      const b = keptRects[j];
      const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
      const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
      const near = Math.max(gapX, gapY) < charSize * 0.4 && Math.min(gapX, gapY) === 0;
      if (near && rng() < 0.15 + spec.connectivity * 0.65) {
        lines.push([centers[i], centers[j]]);
      }
    }
  }
  const points = pickFraction(centers, spec.pointDensity, rng).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  return { areas, lines, points, nested: [] };
}

/* ---------- Линейная ---------- */

function linear(ctx: StructureContext, preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize, charSize } = ctx;
  const angle = rng() * Math.PI;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -dir.y, y: dir.x };
  const center = rectCenter(bounds);
  const edgeHits = rayEdgePoints(center, angle, bounds);
  if (edgeHits.length < 2) return EMPTY;
  const entry = edgeHits[0];
  const exit = edgeHits[edgeHits.length - 1];
  const span = dist(entry, exit);
  const kinks: Vec2[] = [entry];
  const kinkCount = 1 + Math.round(spec.irregularity * 4);
  for (let i = 1; i <= kinkCount; i += 1) {
    const t = Math.min(0.9, Math.max(0.1, i / (kinkCount + 1) + (rng() - 0.5) * spec.irregularity * 0.2));
    const off = (rng() - 0.5) * spec.irregularity * span * 0.35;
    const p = lerp(entry, exit, t);
    kinks.push({
      x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, p.x + normal.x * off)),
      y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, p.y + normal.y * off)),
    });
  }
  kinks.push(exit);
  const axisSample = (t: number): Vec2 => {
    // Кусочно-линейная интерполяция по оси.
    const target = t * span;
    let acc = 0;
    for (let i = 1; i < kinks.length; i += 1) {
      const seg = dist(kinks[i - 1], kinks[i]);
      if (acc + seg >= target) {
        return lerp(kinks[i - 1], kinks[i], (target - acc) / seg);
      }
      acc += seg;
    }
    return kinks[kinks.length - 1];
  };
  const lines: Vec2[][] = [kinks];
  const areas: Vec2[][] = [];
  const junctions: Vec2[] = [entry, exit];
  const areaCount = Math.max(1, Math.round(spec.density * (preview ? 6 : 9)));
  for (let i = 0; i < areaCount; i += 1) {
    const t = (i + 0.5) / areaCount + (rng() - 0.5) * 0.4 / areaCount;
    const p = axisSample(Math.min(0.95, Math.max(0.05, t)));
    const size = charSize * (0.5 + rng() * 0.7) * (1 + (rng() - 0.5) * spec.sizeVariance);
    const rect: Rect = {
      x: p.x - size / 2,
      y: p.y - size * 0.4,
      width: size,
      height: size * 0.8,
    };
    if (rect.width >= minSize * 0.5) areas.push(rectPolygon(rect, rng, spec.irregularity));
  }
  const branchCount = Math.round(spec.density * spec.connectivity * (preview ? 6 : 10));
  for (let j = 0; j < branchCount; j += 1) {
    const t = (j + 1) / (branchCount + 1);
    const start = axisSample(t);
    const side = rng() < 0.5 ? 1 : -1;
    const bAngle = angle + (side * Math.PI) / 2 + (rng() - 0.5) * spec.irregularity * 0.8;
    const hits = rayEdgePoints(start, bAngle, bounds);
    const end = hits.length > 0 ? hits[hits.length - 1] : start;
    const mid = spec.irregularity > 0.35
      ? [lerp(start, end, 0.5 + (rng() - 0.5) * 0.2)]
      : [];
    lines.push([start, ...mid, end]);
    junctions.push(start);
    if (rng() < spec.density * 0.5) {
      const size = charSize * (0.4 + rng() * 0.5);
      const rect: Rect = { x: end.x - size / 2, y: end.y - size / 2, width: size, height: size };
      if (rect.width >= minSize * 0.5) areas.push(rectPolygon(rect, rng, spec.irregularity));
    }
  }
  const points = pickFraction(junctions, spec.pointDensity, rng).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  return { areas, lines, points, nested: [] };
}

/* ---------- Радиальная ---------- */

function radial(ctx: StructureContext, _preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize, charSize } = ctx;
  const b = bounds;
  const center: Vec2 = {
    x: b.x + b.width / 2 + (rng() - 0.5) * spec.irregularity * charSize,
    y: b.y + b.height / 2 + (rng() - 0.5) * spec.irregularity * charSize,
  };
  const maxR = Math.min(b.width, b.height) / 2;
  const rayCount = Math.max(3, 3 + Math.round(spec.density * 5));
  const ringCount = Math.round(spec.density * 3);
  const angles: number[] = [];
  for (let j = 0; j < rayCount; j += 1) {
    angles.push((j / rayCount) * Math.PI * 2 + (rng() - 0.5) * spec.irregularity * 0.5);
  }
  const radii: number[] = [];
  for (let i = 1; i <= ringCount; i += 1) {
    radii.push(
      Math.min(
        maxR * 0.95,
        maxR * (0.2 + spec.cellScale * 0.4) * (i / Math.max(1, ringCount)) * (1 + (rng() - 0.5) * spec.irregularity * 0.5),
      ),
    );
  }
  const lines: Vec2[][] = [];
  const intersections: Vec2[] = [center];
  for (const a of angles) {
    const hits = rayEdgePoints(center, a, b);
    const end = hits.length > 0 ? hits[hits.length - 1] : center;
    const wobble =
      spec.irregularity > 0.35
        ? [
            lerp(center, end, 0.5 + (rng() - 0.5) * 0.2),
          ]
        : [];
    lines.push([center, ...wobble, end]);
    for (const r of radii) {
      intersections.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
    }
  }
  for (const r of radii) {
    const ring: Vec2[] = [];
    const steps = 24;
    for (let s = 0; s < steps; s += 1) {
      const a = (s / steps) * Math.PI * 2;
      const rr = r * (1 + (rng() - 0.5) * spec.irregularity * 0.12);
      ring.push({ x: center.x + Math.cos(a) * rr, y: center.y + Math.sin(a) * rr });
    }
    lines.push(ring);
  }
  // Секторы между лучами и кольцами — области.
  const areas: Vec2[][] = [];
  const ringBounds = [0, ...radii];
  for (let i = 0; i < ringBounds.length; i += 1) {
    const r0 = ringBounds[i];
    const r1 = i + 1 < ringBounds.length ? ringBounds[i + 1] : maxR * (0.9 + spec.cellScale * 0.1);
    if (r1 - r0 < minSize * 0.4) continue;
    for (let j = 0; j < angles.length; j += 1) {
      const a0 = angles[j];
      const a1 = angles[(j + 1) % angles.length] + (j + 1 === angles.length ? Math.PI * 2 : 0);
      const pts: Vec2[] = [];
      for (const [r, a] of [
        [r0, a0],
        [r1, a0],
        [r1, a1],
        [r0, a1],
      ] as const) {
        // Без джиттера вершин: соседние секторы делят рёбра точно,
        // и стык не считается наложением (допуск обеспечивается
        // фильтрацией polygonsOverlap).
        const rr = Math.max(minSize * 0.2, r);
        pts.push({ x: center.x + Math.cos(a) * rr, y: center.y + Math.sin(a) * rr });
      }
      if (polygonArea(pts) >= minSize * minSize * 0.4) areas.push(pts);
    }
  }
  const keptAreas = pickFraction(areas, 0.3 + spec.density * 0.7, rng);
  const points = pickFraction(intersections, spec.pointDensity, rng).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  return { areas: keptAreas, lines, points, nested: [] };
}

/* ---------- Кластерная ---------- */

function cluster(ctx: StructureContext, preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize, charSize } = ctx;
  const clusterCount = 1 + Math.round(spec.density * 4);
  const centers: Vec2[] = [];
  let attempts = 0;
  while (centers.length < clusterCount && attempts < 200) {
    attempts += 1;
    const p: Vec2 = {
      x: bounds.x + rng() * bounds.width,
      y: bounds.y + rng() * bounds.height,
    };
    if (centers.every((c) => dist(c, p) >= ctx.charSize * 1.4)) centers.push(p);
  }
  const areas: Vec2[][] = [];
  const blobCenters: Vec2[] = [];
  for (const c of centers) {
    const blobs = 1 + Math.round(spec.density * 3 + spec.sizeVariance * 2) - (preview ? 1 : 0);
    for (let i = 0; i < Math.max(1, blobs); i += 1) {
      const p: Vec2 = {
        x: c.x + (rng() - 0.5) * charSize * 1.6,
        y: c.y + (rng() - 0.5) * charSize * 1.6,
      };
      const radius =
        charSize *
        (0.35 + rng() * 0.55) *
        (1 + (rng() - 0.5) * spec.sizeVariance * 0.8);
      if (radius < minSize * 0.35) continue;
      const pts: Vec2[] = [];
      const n = 8;
      for (let k = 0; k < n; k += 1) {
        const a = (k / n) * Math.PI * 2;
        const rr = radius * (1 + (rng() - 0.5) * spec.irregularity * 0.5);
        pts.push({ x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr });
      }
      areas.push(pts);
      blobCenters.push(p);
    }
  }
  const lines: Vec2[][] = [];
  const sorted = [...centers].sort((a, b) => Math.atan2(a.y - bounds.y, a.x - bounds.x) - Math.atan2(b.y - bounds.y, b.x - bounds.x));
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    lines.push([a, b]);
    if (spec.connectivity > 0.3 && rng() < spec.connectivity * 0.5 && i + 2 < sorted.length) {
      lines.push([a, sorted[i + 2]]);
    }
  }
  const points = pickFraction([...centers, ...blobCenters], spec.pointDensity, rng).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  return { areas, lines, points, nested: [] };
}

/* ---------- Открытая ---------- */

function open(ctx: StructureContext, preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize } = ctx;
  const g = Math.max(2, Math.ceil(Math.sqrt(2 + spec.density * (preview ? 30 : 60))));
  const cw = bounds.width / g;
  const ch = bounds.height / g;
  const areas: Vec2[][] = [];
  const points: Vec2[] = [];
  const centers: Vec2[] = [];
  for (let j = 0; j < g; j += 1) {
    for (let i = 0; i < g; i += 1) {
      const r = rng();
      const cx = bounds.x + (i + 0.5) * cw + (rng() - 0.5) * cw * 0.5;
      const cy = bounds.y + (j + 0.5) * ch + (rng() - 0.5) * ch * 0.5;
      if (r < spec.density * 0.6) {
        const size =
          Math.min(cw, ch) *
          (0.35 + rng() * 0.45) *
          (1 + (rng() - 0.5) * spec.sizeVariance * 0.7);
        if (size < minSize * 0.4) continue;
        if (centers.some((c) => dist(c, { x: cx, y: cy }) < (size + minSize) * 0.55)) continue;
        const rect: Rect = { x: cx - size / 2, y: cy - size / 2, width: size, height: size };
        areas.push(rectPolygon(rect, rng, spec.irregularity));
        centers.push({ x: cx, y: cy });
      } else if (r < spec.density * 0.6 + spec.pointDensity * 0.5) {
        if (centers.every((c) => dist(c, { x: cx, y: cy }) >= minSize * 0.5)) {
          points.push({ x: Math.round(cx), y: Math.round(cy) });
          centers.push({ x: cx, y: cy });
        }
      }
    }
  }
  const lines: Vec2[][] = [];
  for (let i = 0; i < centers.length; i += 1) {
    if (rng() < spec.connectivity * 0.2) {
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < centers.length; j += 1) {
        if (j === i) continue;
        const d = dist(centers[i], centers[j]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best >= 0) lines.push([centers[i], centers[best]]);
    }
  }
  return { areas, lines, points, nested: [] };
}

/* ---------- Смешанная ---------- */

const MIXABLE: StructureArchetype[] = ["cellular", "linear", "radial", "cluster", "open"];

function mixed(ctx: StructureContext, preview: boolean): StructureGeometry {
  const { spec, rng, bounds, minSize } = ctx;
  const shuffled = [...MIXABLE];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const zoneCount = 2 + (rng() < 0.5 ? 1 : 0);
  const chosen = shuffled.slice(0, zoneCount);
  let zones: Rect[] = [];
  const depth = Math.max(1, Math.ceil(Math.log2(zoneCount)));
  zones = partitionCells(bounds, rng, depth, 0.3, minSize * 1.5).slice(0, zoneCount);
  while (zones.length < zoneCount) {
    zones.push(bounds);
  }
  const geo: StructureGeometry = { areas: [], lines: [], points: [], nested: [] };
  const zoneCenters: Vec2[] = [];
  for (let i = 0; i < zoneCount; i += 1) {
    const zoneSpec: StructureSpec = { ...spec, archetype: chosen[i] };
    const sub: StructureContext = {
      ...ctx,
      spec: zoneSpec,
      bounds: zones[i],
      charSize: Math.min(zones[i].width, zones[i].height) * (0.2 + spec.cellScale * 0.25),
    };
    // Без placeNested: вложенные ставятся один раз на объединённой геометрии.
    const part = generateArchetypeRaw(sub, preview);
    geo.areas.push(...part.areas);
    geo.lines.push(...part.lines);
    geo.points.push(...part.points);
    geo.nested.push(...part.nested);
    zoneCenters.push(rectCenter(zones[i]));
  }
  // Сшивка зон связями.
  const links = 1 + Math.round(spec.connectivity * 2);
  for (let i = 0; i < links && zoneCenters.length > 1; i += 1) {
    const a = zoneCenters[i % zoneCenters.length];
    const b = zoneCenters[(i + 1) % zoneCenters.length];
    geo.lines.push([a, b]);
  }
  return geo;
}

function generateArchetypeRaw(ctx: StructureContext, preview: boolean): StructureGeometry {
  switch (ctx.spec.archetype) {
    case "cellular":
      return cellular(ctx, preview);
    case "linear":
      return linear(ctx, preview);
    case "radial":
      return radial(ctx, preview);
    case "cluster":
      return cluster(ctx, preview);
    case "open":
      return open(ctx, preview);
    case "mixed":
      return mixed(ctx, preview);
    default:
      return EMPTY;
  }
}

export function generateArchetype(ctx: StructureContext, preview: boolean): StructureGeometry {
  const geo = generateArchetypeRaw(ctx, preview);
  geo.nested = placeNested(ctx, geo, ctx.spec.nestedCount);
  return geo;
}

export { insetRect };
