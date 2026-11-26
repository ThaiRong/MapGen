import { useCallback, useEffect, useRef } from "react";
import { legendTypeById, primitiveCenter } from "../core/project";
import type { MapView, Primitive, Vec2 } from "../core/types";
import { useAppStore } from "../state/store";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const MARKER_RADIUS = 6;
const HIT_RADIUS = 12;
const VERTEX_HIT_RADIUS = 8;
const HANDLE_OFFSET = 26;
const DEFAULT_VIEW: MapView = { centerX: 0, centerY: 0, zoom: 1 };
const KIND_RENDER_ORDER: Primitive["kind"][] = ["area", "line", "point", "label"];
const SELECTION_COLOR = "#f0a13c";

type DragState =
  | {
      mode: "pan" | "pen";
      pointerId: number;
      lastX: number;
      lastY: number;
      moved: boolean;
    }
  | {
      mode: "marker";
      pointerId: number;
      startWorldX: number;
      startWorldY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      entityId: string;
      grabDX: number;
      grabDY: number;
      liveX: number;
      liveY: number;
    }
  | {
      mode: "primitive";
      pointerId: number;
      startWorldX: number;
      startWorldY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      primitiveIds: string[];
      liveX: number;
      liveY: number;
    }
  | {
      mode: "band";
      pointerId: number;
      startX: number;
      startY: number;
      curX: number;
      curY: number;
    }
  | {
      mode: "genbounds";
      pointerId: number;
      startX: number;
      startY: number;
      curX: number;
      curY: number;
    }
  | {
      mode: "rotate";
      pointerId: number;
      primitiveId: string;
      center: Vec2;
      startAngle: number;
      liveAngle: number;
      moved: boolean;
    }
  | {
      mode: "vertex";
      pointerId: number;
      primitiveId: string;
      vertexIndex: number;
      liveX: number;
      liveY: number;
      moved: boolean;
    };

type HitResult =
  | { type: "marker"; entityId: string }
  | { type: "primitive"; primitive: Primitive }
  | null;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolyline(p: Vec2, points: Vec2[], closed: boolean): number {
  let min = Infinity;
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    min = Math.min(min, distToSegment(p.x, p.y, a.x, a.y, b.x, b.y));
  }
  return min;
}

/** Индекс ближайшего сегмента и расстояние до него. */
function nearestSegment(p: Vec2, points: Vec2[], closed: boolean): { index: number; dist: number } {
  let best = { index: -1, dist: Infinity };
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const d = distToSegment(p.x, p.y, a.x, a.y, b.x, b.y);
    if (d < best.dist) best = { index: i, dist: d };
  }
  return best;
}

function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function rotatePoint(pt: Vec2, center: Vec2, angleRad: number): Vec2 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: center.x + (pt.x - center.x) * cos - (pt.y - center.y) * sin,
    y: center.y + (pt.x - center.x) * sin + (pt.y - center.y) * cos,
  };
}

function normalizeAngle(a: number): number {
  let angle = a;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function bboxOfPoints(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  return { minX, minY, maxX, maxY };
}

function isLineOrArea(p: Primitive): p is Extract<Primitive, { kind: "line" | "area" }> {
  return p.kind === "line" || p.kind === "area";
}

export default function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapView>({ ...DEFAULT_VIEW });
  const dragRef = useRef<DragState | null>(null);
  const spaceRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafPending = useRef(false);
  const cursorWorldRef = useRef<Vec2 | null>(null);

  const activeMapId = useAppStore((s) => s.activeMapId);
  const selectedEntityId = useAppStore((s) => s.selectedEntityId);
  const selectedPrimitiveIds = useAppStore((s) => s.selectedPrimitiveIds);
  const drawingDraft = useAppStore((s) => s.drawingDraft);
  const labelDraft = useAppStore((s) => s.labelDraft);
  const generationPreview = useAppStore((s) => s.generationPreview);
  const generationBoundsRect = useAppStore((s) => s.generationBoundsRect);
  const tool = useAppStore((s) => s.tool);
  const project = useAppStore((s) => s.project);

  const size = useCallback(() => {
    const canvas = canvasRef.current;
    return { w: canvas?.clientWidth ?? 0, h: canvas?.clientHeight ?? 0 };
  }, []);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const { w, h } = size();
      const view = viewRef.current;
      return {
        x: (sx - w / 2) / view.zoom + view.centerX,
        y: (sy - h / 2) / view.zoom + view.centerY,
      };
    },
    [size],
  );

  const worldToScreen = useCallback(
    (pt: Vec2) => {
      const { w, h } = size();
      const view = viewRef.current;
      return {
        x: (pt.x - view.centerX) * view.zoom + w / 2,
        y: (pt.y - view.centerY) * view.zoom + h / 2,
      };
    },
    [size],
  );

  const hitTest = useCallback(
    (world: Vec2): HitResult => {
      const state = useAppStore.getState();
      const map = state.project.maps[state.activeMapId];
      if (!map) return null;
      const view = viewRef.current;
      const { w, h } = size();
      const clickScreen = {
        x: (world.x - view.centerX) * view.zoom + w / 2,
        y: (world.y - view.centerY) * view.zoom + h / 2,
      };
      // Маркеры-локации имеют приоритет.
      for (let i = map.entities.length - 1; i >= 0; i -= 1) {
        const e = map.entities[i];
        const ex = (e.x - view.centerX) * view.zoom + w / 2;
        const ey = (e.y - view.centerY) * view.zoom + h / 2;
        if (Math.hypot(ex - clickScreen.x, ey - clickScreen.y) <= HIT_RADIUS) {
          return { type: "marker", entityId: e.id };
        }
      }
      const tolWorld = HIT_RADIUS / view.zoom;
      const visibleType = (p: Primitive) => {
        const type = legendTypeById(state.project, p.typeId);
        return !!type && type.visible && p.visible;
      };
      const byKind = (kind: Primitive["kind"]) => map.primitives.filter((p) => p.kind === kind);
      // Порядок выбора — обратный порядку отрисовки: подписи, точки, линии, области.
      for (const p of [...byKind("label")].reverse()) {
        if (!visibleType(p) || p.kind !== "label") continue;
        const anchor = worldToScreen({ x: p.x, y: p.y });
        const halfW = Math.max(HIT_RADIUS, p.text.length * p.fontSize * 0.3);
        const halfH = Math.max(HIT_RADIUS, p.fontSize * 0.7);
        if (
          Math.abs(clickScreen.x - anchor.x) <= halfW &&
          Math.abs(clickScreen.y - anchor.y) <= halfH
        ) {
          return { type: "primitive", primitive: p };
        }
      }
      for (const p of [...byKind("point")].reverse()) {
        if (!visibleType(p) || p.kind !== "point") continue;
        if (Math.hypot(p.x - world.x, p.y - world.y) <= tolWorld) {
          return { type: "primitive", primitive: p };
        }
      }
      for (const p of [...byKind("line")].reverse()) {
        if (!visibleType(p) || p.kind !== "line") continue;
        const type = legendTypeById(state.project, p.typeId);
        const tol = Math.max(tolWorld, (type?.strokeWidth ?? 2) / 2 / view.zoom);
        if (distToPolyline(world, p.points, false) <= tol) return { type: "primitive", primitive: p };
      }
      for (const p of [...byKind("area")].reverse()) {
        if (!visibleType(p) || p.kind !== "area") continue;
        const type = legendTypeById(state.project, p.typeId);
        const tol = Math.max(tolWorld, (type?.strokeWidth ?? 2) / 2 / view.zoom);
        if (pointInPolygon(world, p.points) || distToPolyline(world, p.points, true) <= tol) {
          return { type: "primitive", primitive: p };
        }
      }
      return null;
    },
    [size, worldToScreen],
  );

  /** Позиция ручки поворота (экранные координаты) для линии/области. */
  const rotationHandlePos = useCallback(
    (p: Extract<Primitive, { kind: "line" | "area" }>): Vec2 | null => {
      const box = bboxOfPoints(p.points);
      const topCenter = worldToScreen({ x: (box.minX + box.maxX) / 2, y: box.minY });
      return { x: topCenter.x, y: topCenter.y - HANDLE_OFFSET };
    },
    [worldToScreen],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    if (w === 0 || h === 0) return;
    const pxW = Math.round(w * dpr);
    const pxH = Math.round(h * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const state = useAppStore.getState();
    const map = state.project.maps[state.activeMapId];
    const view = viewRef.current;
    const toS = (pt: Vec2): Vec2 => ({
      x: (pt.x - view.centerX) * view.zoom + w / 2,
      y: (pt.y - view.centerY) * view.zoom + h / 2,
    });

    ctx.fillStyle = "#16171c";
    ctx.fillRect(0, 0, w, h);

    // Адаптивная сетка из точек — ориентир на пустом холсте.
    let step = 50;
    while (step * view.zoom < 40) step *= 2;
    while (step * view.zoom > 200) step /= 2;
    const left = view.centerX - w / 2 / view.zoom;
    const right = view.centerX + w / 2 / view.zoom;
    const top = view.centerY - h / 2 / view.zoom;
    const bottom = view.centerY + h / 2 / view.zoom;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    for (let gx = Math.ceil(left / step) * step; gx <= right; gx += step) {
      for (let gy = Math.ceil(top / step) * step; gy <= bottom; gy += step) {
        const s = toS({ x: gx, y: gy });
        ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
      }
    }

    const drag = dragRef.current;
    const selectedSet = new Set(state.selectedPrimitiveIds);
    const singleSelected =
      state.selectedPrimitiveIds.length === 1
        ? (map?.primitives.find((p) => p.id === state.selectedPrimitiveIds[0]) ?? null)
        : null;

    // --- Примитивы: фиксированный порядок отрисовки ---
    if (map) {
      const geomFor = (p: Primitive): Vec2[] | Vec2 => {
        let base: Vec2[] | Vec2;
        if (p.kind === "point" || p.kind === "label") {
          base = { x: p.x, y: p.y };
        } else {
          base = p.points;
        }
        // Перетаскивание группы/одного примитива.
        if (drag?.mode === "primitive" && drag.moved && drag.primitiveIds.includes(p.id)) {
          const prim = map.primitives.find((x) => x.id === p.id);
          if (prim && !prim.locked) {
            const dx = drag.liveX - drag.startWorldX;
            const dy = drag.liveY - drag.startWorldY;
            if (p.kind === "point" || p.kind === "label") {
              return { x: (base as Vec2).x + dx, y: (base as Vec2).y + dy };
            }
            return (base as Vec2[]).map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
          }
        }
        // Поворот ручкой.
        if (drag?.mode === "rotate" && drag.primitiveId === p.id && isLineOrArea(p)) {
          return (base as Vec2[]).map((pt) => rotatePoint(pt, drag.center, drag.liveAngle));
        }
        // Перетаскивание вершины.
        if (drag?.mode === "vertex" && drag.primitiveId === p.id && isLineOrArea(p)) {
          return (base as Vec2[]).map((pt, i) =>
            i === drag.vertexIndex ? { x: drag.liveX, y: drag.liveY } : pt,
          );
        }
        return base;
      };

      const ordered = [...map.primitives].sort(
        (a, b) => KIND_RENDER_ORDER.indexOf(a.kind) - KIND_RENDER_ORDER.indexOf(b.kind),
      );
      for (const p of ordered) {
        const type = legendTypeById(state.project, p.typeId);
        if (!type || !type.visible || !p.visible) continue;
        const isSelected = selectedSet.has(p.id);
        const geom = geomFor(p);

        ctx.save();
        ctx.globalAlpha = type.opacity;
        ctx.strokeStyle = type.color;
        ctx.fillStyle = type.color;
        ctx.lineWidth = Math.max(1, type.strokeWidth);
        ctx.setLineDash(type.strokeStyle === "dashed" ? [10, 6] : []);

        if (p.kind === "area") {
          const pts = geom as Vec2[];
          if (pts.length >= 3) {
            ctx.beginPath();
            const s0 = toS(pts[0]);
            ctx.moveTo(s0.x, s0.y);
            for (let i = 1; i < pts.length; i += 1) {
              const s = toS(pts[i]);
              ctx.lineTo(s.x, s.y);
            }
            ctx.closePath();
            ctx.globalAlpha = type.opacity * 0.35;
            ctx.fill();
            ctx.globalAlpha = type.opacity;
            ctx.stroke();
          }
        } else if (p.kind === "line") {
          const pts = geom as Vec2[];
          if (pts.length >= 2) {
            ctx.beginPath();
            const s0 = toS(pts[0]);
            ctx.moveTo(s0.x, s0.y);
            for (let i = 1; i < pts.length; i += 1) {
              const s = toS(pts[i]);
              ctx.lineTo(s.x, s.y);
            }
            ctx.stroke();
          }
        } else if (p.kind === "point") {
          const c = toS(geom as Vec2);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#0d0e12";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (p.kind === "label") {
          const c = toS(geom as Vec2);
          ctx.globalAlpha = type.opacity;
          ctx.font = `${p.fontSize}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(p.text, c.x, c.y);
        }
        ctx.restore();

        if (isSelected) {
          ctx.save();
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.fillStyle = SELECTION_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          if (isLineOrArea(p)) {
            const pts = (geom as Vec2[]).map(toS);
            if (pts.length >= 2) {
              ctx.beginPath();
              ctx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
              if (p.kind === "area") ctx.closePath();
              ctx.stroke();
            }
            ctx.setLineDash([]);
            for (const s of pts) ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
          } else {
            const c = toS(geom as Vec2);
            ctx.beginPath();
            ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Ручка поворота — единичный выбор линии/области, инструмент «Выбор».
      if (
        state.tool === "select" &&
        singleSelected &&
        isLineOrArea(singleSelected) &&
        !singleSelected.locked &&
        !(drag && drag.mode !== "band")
      ) {
        const handle = rotationHandlePos(singleSelected);
        if (handle) {
          const edgeTop = worldToScreen({
            x: (bboxOfPoints(singleSelected.points).minX + bboxOfPoints(singleSelected.points).maxX) / 2,
            y: bboxOfPoints(singleSelected.points).minY,
          });
          ctx.save();
          ctx.strokeStyle = SELECTION_COLOR;
          ctx.fillStyle = "#16171c";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(edgeTop.x, edgeTop.y);
          ctx.lineTo(handle.x, handle.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // --- Маркеры-локации ---
      for (const e of map.entities) {
        const isDragged = drag?.mode === "marker" && drag.entityId === e.id;
        const center = isDragged ? { x: drag.liveX, y: drag.liveY } : { x: e.x, y: e.y };
        const s = toS(center);
        if (s.x < -80 || s.x > w + 80 || s.y < -40 || s.y > h + 40) continue;

        ctx.beginPath();
        ctx.arc(s.x, s.y, MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = e.id === state.selectedEntityId ? "#f0a13c" : "#4f8cff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0d0e12";
        ctx.stroke();

        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#d7d9e0";
        ctx.fillText(e.label, s.x, s.y - MARKER_RADIUS - 6);
      }

      // --- Предпросмотр черновика (линия/область/перо) ---
      const draft = state.drawingDraft;
      if (draft && draft.points.length > 0) {
        const cursor = cursorWorldRef.current;
        const pts = (cursor && draft.kind !== "pen" ? [...draft.points, cursor] : draft.points).map(toS);
        ctx.save();
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.fillStyle = SELECTION_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash(draft.kind === "pen" ? [] : [6, 4]);
        if (pts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i += 1) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          if (draft.kind === "area" && pts.length >= 3) {
            ctx.closePath();
            ctx.globalAlpha = 0.15;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (draft.kind !== "pen") {
          for (const s of pts) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Рамка мультивыделения.
      if (drag?.mode === "band" || drag?.mode === "genbounds") {
        const x = Math.min(drag.startX, drag.curX);
        const y = Math.min(drag.startY, drag.curY);
        const bw = Math.abs(drag.curX - drag.startX);
        const bh = Math.abs(drag.curY - drag.startY);
        ctx.save();
        ctx.strokeStyle = drag.mode === "genbounds" ? "#4f8cff" : SELECTION_COLOR;
        ctx.fillStyle = drag.mode === "genbounds" ? "rgba(79, 140, 255, 0.08)" : "rgba(240, 161, 60, 0.08)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeRect(x, y, bw, bh);
        ctx.restore();
      }

      // Предпросмотр генерации — поверх карты, полупрозрачно.
      const preview = state.generationPreview;
      if (preview) {
        ctx.save();
        for (const p of preview.primitives) {
          const type = legendTypeById(state.project, p.typeId);
          if (!type) continue;
          ctx.globalAlpha = type.opacity * 0.55;
          ctx.strokeStyle = type.color;
          ctx.fillStyle = type.color;
          ctx.lineWidth = Math.max(1, type.strokeWidth);
          ctx.setLineDash(type.strokeStyle === "dashed" ? [10, 6] : []);
          if (p.kind === "area") {
            if (p.points.length >= 3) {
              ctx.beginPath();
              const s0 = toS(p.points[0]);
              ctx.moveTo(s0.x, s0.y);
              for (let i = 1; i < p.points.length; i += 1) {
                const s = toS(p.points[i]);
                ctx.lineTo(s.x, s.y);
              }
              ctx.closePath();
              ctx.globalAlpha = type.opacity * 0.55 * 0.35;
              ctx.fill();
              ctx.globalAlpha = type.opacity * 0.55;
              ctx.stroke();
            }
          } else if (p.kind === "line") {
            if (p.points.length >= 2) {
              ctx.beginPath();
              const s0 = toS(p.points[0]);
              ctx.moveTo(s0.x, s0.y);
              for (let i = 1; i < p.points.length; i += 1) {
                const s = toS(p.points[i]);
                ctx.lineTo(s.x, s.y);
              }
              ctx.stroke();
            }
          } else if (p.kind === "point") {
            const c = toS({ x: p.x, y: p.y });
            ctx.beginPath();
            ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.kind === "label") {
            const c = toS({ x: p.x, y: p.y });
            ctx.font = `${p.fontSize}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText(p.text, c.x, c.y);
          }
        }
        ctx.restore();
      }

      // Заданная рамка области генерации (пока панель ждёт применения).
      if (generationBoundsRect && state.generationPreview) {
        const r = generationBoundsRect;
        const a = toS({ x: r.x, y: r.y });
        const b = toS({ x: r.x + r.width, y: r.y + r.height });
        ctx.save();
        ctx.strokeStyle = "#4f8cff";
        ctx.setLineDash([8, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.restore();
      }

      if (map.entities.length === 0 && map.primitives.length === 0) {
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(215, 217, 224, 0.35)";
        ctx.fillText(
          state.tool === "add-location"
            ? "Кликните, чтобы поставить локацию"
            : "Нарисуйте карту: точки, линии, области, подписи — инструменты на панели сверху",
          w / 2,
          h / 2,
        );
      }
    }

    if (Math.abs(state.viewZoom - view.zoom) > 0.001) {
      state.setViewZoom(view.zoom);
    }
    state.setGenerationViewport({ centerX: view.centerX, centerY: view.centerY, zoom: view.zoom, w, h });
  }, [size, worldToScreen, rotationHandlePos]);

  const schedulePersistView = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const state = useAppStore.getState();
      state.setView(state.activeMapId, { ...viewRef.current });
    }, 400);
  }, []);

  // Смена карты: поднимаем сохранённый вид, при уходе — сохраняем текущий.
  useEffect(() => {
    const map = useAppStore.getState().project.maps[activeMapId];
    viewRef.current = map?.view ? { ...map.view } : { ...DEFAULT_VIEW };
    draw();
    return () => {
      const state = useAppStore.getState();
      if (state.project.maps[activeMapId]) {
        state.setView(activeMapId, { ...viewRef.current });
      }
    };
  }, [activeMapId, draw]);

  useEffect(() => {
    draw();
  }, [project, selectedEntityId, selectedPrimitiveIds, drawingDraft, generationPreview, generationBoundsRect, tool, draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const before = screenToWorld(mx, my);
      const view = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
      const { w, h } = size();
      view.centerX = before.x - (mx - w / 2) / view.zoom;
      view.centerY = before.y - (my - h / 2) / view.zoom;
      draw();
      schedulePersistView();
    };

    const localPos = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /** Вершина выбранной линии/области под курсором. */
    const vertexAt = (screen: Vec2): { index: number } | null => {
      const state = useAppStore.getState();
      if (state.selectedPrimitiveIds.length !== 1) return null;
      const map = state.project.maps[state.activeMapId];
      const p = map?.primitives.find((x) => x.id === state.selectedPrimitiveIds[0]);
      if (!p || !isLineOrArea(p) || p.locked) return null;
      for (let i = 0; i < p.points.length; i += 1) {
        const s = worldToScreen(p.points[i]);
        if (Math.hypot(s.x - screen.x, s.y - screen.y) <= VERTEX_HIT_RADIUS) {
          return { index: i };
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      const state = useAppStore.getState();
      const pos = localPos(e);
      const world = screenToWorld(pos.x, pos.y);
      cursorWorldRef.current = world;

      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        dragRef.current = { mode: "pan", pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, moved: false };
        canvas.setPointerCapture(e.pointerId);
        wrap.classList.add("panning");
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      // Одноразовое задание рамки области генерации — в любом инструменте.
      if (state.generationBoundsPick) {
        dragRef.current = {
          mode: "genbounds",
          pointerId: e.pointerId,
          startX: pos.x,
          startY: pos.y,
          curX: pos.x,
          curY: pos.y,
        };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      switch (state.tool) {
        case "add-location":
          state.addLocationAt(world.x, world.y);
          draw();
          return;
        case "point":
          state.addPointPrimitiveAt(world.x, world.y);
          return;
        case "label":
          e.preventDefault();
          state.startLabelDraft(world.x, world.y);
          return;
        case "line":
          state.drawingAddPoint(world.x, world.y);
          return;
        case "area": {
          const draft = state.drawingDraft;
          if (draft && draft.kind === "area" && draft.points.length >= 3) {
            const first = draft.points[0];
            const fs = worldToScreen(first);
            const ws = worldToScreen(world);
            if (Math.hypot(fs.x - ws.x, fs.y - ws.y) <= HIT_RADIUS) {
              state.finishDrawing();
              return;
            }
          }
          state.drawingAddPoint(world.x, world.y);
          return;
        }
        case "pen":
          state.startPenStroke(world.x, world.y);
          dragRef.current = { mode: "pen", pointerId: e.pointerId, lastX: pos.x, lastY: pos.y, moved: false };
          canvas.setPointerCapture(e.pointerId);
          return;
        case "delete": {
          const hit = hitTest(world);
          if (hit?.type === "marker") {
            state.deleteMarkerAt(state.activeMapId, hit.entityId);
          } else if (hit?.type === "primitive") {
            state.deletePrimitiveById(state.activeMapId, hit.primitive.id);
          } else {
            state.clearSelection();
          }
          return;
        }
        case "select":
        default: {
          // 1. Ручка поворота.
          if (state.selectedPrimitiveIds.length === 1) {
            const map = state.project.maps[state.activeMapId];
            const sel = map?.primitives.find((x) => x.id === state.selectedPrimitiveIds[0]);
            if (sel && isLineOrArea(sel) && !sel.locked) {
              const handle = rotationHandlePos(sel);
              if (handle && Math.hypot(handle.x - pos.x, handle.y - pos.y) <= 10) {
                const center = primitiveCenter(sel);
                if (center) {
                  dragRef.current = {
                    mode: "rotate",
                    pointerId: e.pointerId,
                    primitiveId: sel.id,
                    center,
                    startAngle: Math.atan2(world.y - center.y, world.x - center.x),
                    liveAngle: 0,
                    moved: false,
                  };
                  canvas.setPointerCapture(e.pointerId);
                  return;
                }
              }
              // 2. Вершина.
              const vhit = vertexAt(pos);
              if (vhit) {
                dragRef.current = {
                  mode: "vertex",
                  pointerId: e.pointerId,
                  primitiveId: sel.id,
                  vertexIndex: vhit.index,
                  liveX: world.x,
                  liveY: world.y,
                  moved: false,
                };
                canvas.setPointerCapture(e.pointerId);
                return;
              }
            }
          }

          // 3. Объекты.
          const hit = hitTest(world);
          if (hit?.type === "marker") {
            const entity = state.project.maps[state.activeMapId]?.entities.find(
              (en) => en.id === hit.entityId,
            );
            if (!entity) return;
            state.selectEntity(entity.id);
            dragRef.current = {
              mode: "marker",
              pointerId: e.pointerId,
              startWorldX: world.x,
              startWorldY: world.y,
              lastX: pos.x,
              lastY: pos.y,
              moved: false,
              entityId: entity.id,
              grabDX: entity.x - world.x,
              grabDY: entity.y - world.y,
              liveX: entity.x,
              liveY: entity.y,
            };
            canvas.setPointerCapture(e.pointerId);
          } else if (hit?.type === "primitive") {
            if (e.shiftKey) {
              state.togglePrimitiveSelection(hit.primitive.id);
              return;
            }
            const already = state.selectedPrimitiveIds.includes(hit.primitive.id);
            if (!already) {
              state.selectPrimitive(hit.primitive.id);
            }
            if (!hit.primitive.locked) {
              dragRef.current = {
                mode: "primitive",
                pointerId: e.pointerId,
                startWorldX: world.x,
                startWorldY: world.y,
                lastX: pos.x,
                lastY: pos.y,
                moved: false,
                primitiveIds: already
                  ? [...state.selectedPrimitiveIds]
                  : [hit.primitive.id],
                liveX: world.x,
                liveY: world.y,
              };
              canvas.setPointerCapture(e.pointerId);
            }
          } else {
            // 4. Пустое место — рамка мультивыделения.
            state.clearSelection();
            dragRef.current = {
              mode: "band",
              pointerId: e.pointerId,
              startX: pos.x,
              startY: pos.y,
              curX: pos.x,
              curY: pos.y,
            };
            canvas.setPointerCapture(e.pointerId);
          }
          return;
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const pos = localPos(e);
      const world = screenToWorld(pos.x, pos.y);
      cursorWorldRef.current = world;
      const drag = dragRef.current;

      if (!drag) {
        if (!rafPending.current) {
          rafPending.current = true;
          requestAnimationFrame(() => {
            rafPending.current = false;
            useAppStore.getState().setCursor({ x: world.x, y: world.y });
            const s = useAppStore.getState();
            if (s.drawingDraft && s.drawingDraft.kind !== "pen") draw();
          });
        }
        return;
      }
      if (drag.pointerId !== e.pointerId) return;

      if (drag.mode === "pan") {
        const view = viewRef.current;
        view.centerX -= (pos.x - drag.lastX) / view.zoom;
        view.centerY -= (pos.y - drag.lastY) / view.zoom;
        drag.lastX = pos.x;
        drag.lastY = pos.y;
        drag.moved = true;
        draw();
        schedulePersistView();
      } else if (drag.mode === "pen") {
        useAppStore.getState().penAddPoint(world.x, world.y);
        drag.moved = true;
        draw();
      } else if (drag.mode === "marker") {
        drag.liveX = world.x + drag.grabDX;
        drag.liveY = world.y + drag.grabDY;
        drag.moved = true;
        draw();
      } else if (drag.mode === "primitive") {
        drag.liveX = world.x;
        drag.liveY = world.y;
        drag.moved = true;
        draw();
      } else if (drag.mode === "band" || drag.mode === "genbounds") {
        drag.curX = pos.x;
        drag.curY = pos.y;
        draw();
      } else if (drag.mode === "rotate") {
        const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
        drag.liveAngle = normalizeAngle(angle - drag.startAngle);
        drag.moved = true;
        draw();
      } else if (drag.mode === "vertex") {
        drag.liveX = world.x;
        drag.liveY = world.y;
        drag.moved = true;
        draw();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pos = localPos(e);
      dragRef.current = null;
      wrap.classList.remove("panning");
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      // Перерисовка нужна даже когда ничего не закоммичено: признаки
      // выбора (ручка поворота, вершины) рисуются только при drag === null,
      // а без изменения проекта события перерисовки не было бы.
      draw();
      const state = useAppStore.getState();

      if (drag.mode === "marker" && drag.moved) {
        state.moveMarker(drag.entityId, Math.round(drag.liveX), Math.round(drag.liveY));
      }
      if (drag.mode === "primitive" && drag.moved) {
        state.moveSelectedPrimitives(
          drag.liveX - drag.startWorldX,
          drag.liveY - drag.startWorldY,
        );
      }
      if (drag.mode === "rotate" && drag.moved) {
        state.rotatePrimitiveBy(drag.primitiveId, drag.liveAngle);
      }
      if (drag.mode === "vertex" && drag.moved) {
        state.movePrimitiveVertexBy(drag.primitiveId, drag.vertexIndex, drag.liveX, drag.liveY);
      }
      if (drag.mode === "pen") {
        state.finishDrawing();
      }
      if (drag.mode === "genbounds") {
        const x1 = Math.min(drag.startX, pos.x);
        const y1 = Math.min(drag.startY, pos.y);
        const x2 = Math.max(drag.startX, pos.x);
        const y2 = Math.max(drag.startY, pos.y);
        if (x2 - x1 >= 8 && y2 - y1 >= 8) {
          const wa = screenToWorld(x1, y1);
          const wb = screenToWorld(x2, y2);
          state.setGenerationBoundsRect({
            x: Math.round(Math.min(wa.x, wb.x)),
            y: Math.round(Math.min(wa.y, wb.y)),
            width: Math.round(Math.abs(wb.x - wa.x)),
            height: Math.round(Math.abs(wb.y - wa.y)),
          });
          state.setStatus("Рамка области генерации задана");
        } else {
          state.cancelGenerationBoundsPick();
        }
      }
      if (drag.mode === "band") {
        const x1 = Math.min(drag.startX, pos.x);
        const y1 = Math.min(drag.startY, pos.y);
        const x2 = Math.max(drag.startX, pos.x);
        const y2 = Math.max(drag.startY, pos.y);
        if (x2 - x1 < 4 && y2 - y1 < 4) return; // просто клик, выделение уже снято
        const wa = screenToWorld(x1, y1);
        const wb = screenToWorld(x2, y2);
        const rect = {
          minX: Math.min(wa.x, wb.x),
          minY: Math.min(wa.y, wb.y),
          maxX: Math.max(wa.x, wb.x),
          maxY: Math.max(wa.y, wb.y),
        };
        const map = state.project.maps[state.activeMapId];
        if (!map) return;
        const hits: string[] = [];
        for (const p of map.primitives) {
          const type = legendTypeById(state.project, p.typeId);
          if (!type || !type.visible || !p.visible) continue;
          if (p.kind === "point" || p.kind === "label") {
            if (p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY) {
              hits.push(p.id);
            }
          } else {
            const box = bboxOfPoints(p.points);
            if (
              box.maxX >= rect.minX &&
              box.minX <= rect.maxX &&
              box.maxY >= rect.minY &&
              box.minY <= rect.maxY
            ) {
              hits.push(p.id);
            }
          }
        }
        state.selectPrimitives(hits);
        if (hits.length > 0) {
          state.setStatus(`Выбрано примитивов: ${hits.length}`);
        }
      }
      if (drag.mode === "pan") schedulePersistView();
    };

    const onDblClick = (e: MouseEvent) => {
      const state = useAppStore.getState();
      const pos = localPos(e);
      const world = screenToWorld(pos.x, pos.y);

      if (state.tool === "line" || state.tool === "area") {
        const draft = state.drawingDraft;
        if (draft && draft.points.length >= 2) {
          const pts = [...draft.points];
          const last = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          if (Math.hypot(last.x - prev.x, last.y - prev.y) * viewRef.current.zoom < 6) {
            pts.pop();
          }
          useAppStore.setState({ drawingDraft: { ...draft, points: pts } });
        }
        state.finishDrawing();
        return;
      }

      if (state.tool !== "select") return;

      // Двойной клик по ребру выбранной линии/области — вставка вершины.
      if (state.selectedPrimitiveIds.length === 1) {
        const map = state.project.maps[state.activeMapId];
        const sel = map?.primitives.find((x) => x.id === state.selectedPrimitiveIds[0]);
        if (sel && isLineOrArea(sel) && !sel.locked) {
          const vhit = vertexAt(pos);
          if (!vhit) {
            const near = nearestSegment(world, sel.points, sel.kind === "area");
            const tol = VERTEX_HIT_RADIUS / viewRef.current.zoom;
            if (near.index >= 0 && near.dist <= Math.max(tol, 6 / viewRef.current.zoom)) {
              state.insertVertexInto(sel.id, near.index, world);
              return;
            }
          }
        }
      }

      const hit = hitTest(world);
      if (hit?.type === "marker") {
        const entity = state.project.maps[state.activeMapId]?.entities.find(
          (en) => en.id === hit.entityId,
        );
        if (entity) state.openMap(entity.targetMapId);
      }
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
    };
  }, [draw, hitTest, screenToWorld, worldToScreen, rotationHandlePos, schedulePersistView, size]);

  // Пробел для панорамирования.
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping()) {
        spaceRef.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const wrapperClass = `canvas-wrap tool-${tool}`;

  return (
    <div ref={wrapRef} className={wrapperClass}>
      <canvas ref={canvasRef} />
      {labelDraft && <LabelDraftInput x={labelDraft.x} y={labelDraft.y} worldToScreen={worldToScreen} />}
    </div>
  );
}

/** Inline-поле ввода текста подписи (вместо window.prompt). */
function LabelDraftInput({
  x,
  y,
  worldToScreen,
}: {
  x: number;
  y: number;
  worldToScreen: (pt: Vec2) => Vec2;
}) {
  const confirmLabelDraft = useAppStore((s) => s.confirmLabelDraft);
  const cancelLabelDraft = useAppStore((s) => s.cancelLabelDraft);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const screen = worldToScreen({ x, y });

  useEffect(() => {
    // Надёжнее autoFocus в WebView2: фокус ставим явно после монтирования.
    inputRef.current?.focus();
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const value = inputRef.current?.value ?? "";
    if (commit) confirmLabelDraft(value);
    else cancelLabelDraft();
  };

  return (
    <div className="label-draft" style={{ left: screen.x, top: screen.y }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Текст подписи"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(false)}
      />
    </div>
  );
}
