import { useCallback, useEffect, useRef } from "react";
import { legendTypeById } from "../core/project";
import type { MapView, Primitive, Vec2 } from "../core/types";
import { useAppStore } from "../state/store";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const MARKER_RADIUS = 6;
const HIT_RADIUS = 12;
const DEFAULT_VIEW: MapView = { centerX: 0, centerY: 0, zoom: 1 };
const KIND_RENDER_ORDER: Primitive["kind"][] = ["area", "line", "point", "label"];
const SELECTION_COLOR = "#f0a13c";

interface DragState {
  mode: "pan" | "marker" | "primitive";
  pointerId: number;
  startWorldX: number;
  startWorldY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  entityId?: string;
  primitiveId?: string;
  grabDX?: number;
  grabDY?: number;
  liveX?: number;
  liveY?: number;
}

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
  const selectedPrimitiveId = useAppStore((s) => s.selectedPrimitiveId);
  const drawingDraft = useAppStore((s) => s.drawingDraft);
  const labelDraft = useAppStore((s) => s.labelDraft);
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
      // Маркеры-локации имеют приоритет.
      for (let i = map.entities.length - 1; i >= 0; i -= 1) {
        const e = map.entities[i];
        const ex = (e.x - view.centerX) * view.zoom + w / 2;
        const ey = (e.y - view.centerY) * view.zoom + h / 2;
        const sx = (world.x - view.centerX) * view.zoom + w / 2;
        const sy = (world.y - view.centerY) * view.zoom + h / 2;
        if (Math.hypot(ex - sx, ey - sy) <= HIT_RADIUS) {
          return { type: "marker", entityId: e.id };
        }
      }
      const tolWorld = HIT_RADIUS / view.zoom;
      const byKind = (kind: Primitive["kind"]) =>
        map.primitives.filter((p) => p.kind === kind);
      const visibleType = (p: Primitive) => {
        const type = legendTypeById(state.project, p.typeId);
        return !!type && type.visible && p.visible;
      };
      // Порядок выбора — обратный порядку отрисовки: подписи, точки, линии, области.
      for (const p of [...byKind("label")].reverse()) {
        if (!visibleType(p)) continue;
        if (p.kind === "label" && Math.hypot(p.x - world.x, p.y - world.y) <= tolWorld) {
          return { type: "primitive", primitive: p };
        }
      }
      for (const p of [...byKind("point")].reverse()) {
        if (!visibleType(p)) continue;
        if (p.kind === "point" && Math.hypot(p.x - world.x, p.y - world.y) <= tolWorld) {
          return { type: "primitive", primitive: p };
        }
      }
      for (const p of [...byKind("line")].reverse()) {
        if (!visibleType(p)) continue;
        if (p.kind !== "line") continue;
        const type = legendTypeById(state.project, p.typeId);
        const tol = Math.max(tolWorld, (type?.strokeWidth ?? 2) / 2 / view.zoom);
        if (distToPolyline(world, p.points, false) <= tol) return { type: "primitive", primitive: p };
      }
      for (const p of [...byKind("area")].reverse()) {
        if (!visibleType(p)) continue;
        if (p.kind !== "area") continue;
        const type = legendTypeById(state.project, p.typeId);
        const tol = Math.max(tolWorld, (type?.strokeWidth ?? 2) / 2 / view.zoom);
        if (
          pointInPolygon(world, p.points) ||
          distToPolyline(world, p.points, true) <= tol
        ) {
          return { type: "primitive", primitive: p };
        }
      }
      return null;
    },
    [size],
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

    // --- Примитивы: фиксированный порядок отрисовки ---
    if (map) {
      const offsetFor = (p: Primitive): Vec2 => {
        if (drag?.mode === "primitive" && drag.primitiveId === p.id && drag.moved) {
          return {
            x: (drag.liveX ?? drag.startWorldX) - drag.startWorldX,
            y: (drag.liveY ?? drag.startWorldY) - drag.startWorldY,
          };
        }
        return { x: 0, y: 0 };
      };
      const shifted = (p: Primitive, offset: Vec2): Vec2[] | Vec2 => {
        if (p.kind === "point" || p.kind === "label") {
          return { x: p.x + offset.x, y: p.y + offset.y };
        }
        return p.points.map((pt) => ({ x: pt.x + offset.x, y: pt.y + offset.y }));
      };

      const ordered = [...map.primitives].sort(
        (a, b) => KIND_RENDER_ORDER.indexOf(a.kind) - KIND_RENDER_ORDER.indexOf(b.kind),
      );
      for (const p of ordered) {
        const type = legendTypeById(state.project, p.typeId);
        if (!type || !type.visible || !p.visible) continue;
        const isSelected = p.id === state.selectedPrimitiveId;
        const offset = offsetFor(p);
        const geom = shifted(p, offset);

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
          if (p.kind === "area" || p.kind === "line") {
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

      // --- Маркеры-локации ---
      for (const e of map.entities) {
        const isDragged = drag?.mode === "marker" && drag.entityId === e.id;
        const center = isDragged ? { x: drag.liveX ?? e.x, y: drag.liveY ?? e.y } : { x: e.x, y: e.y };
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

      // --- Предпросмотр черновика линии/области ---
      const draft = state.drawingDraft;
      if (draft && draft.points.length > 0) {
        const cursor = cursorWorldRef.current;
        const pts = cursor ? [...draft.points, cursor] : [...draft.points];
        const screenPts = pts.map(toS);
        ctx.save();
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.fillStyle = SELECTION_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        if (screenPts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(screenPts[0].x, screenPts[0].y);
          for (let i = 1; i < screenPts.length; i += 1) {
            ctx.lineTo(screenPts[i].x, screenPts[i].y);
          }
          if (draft.kind === "area" && screenPts.length >= 3) ctx.closePath();
          if (draft.kind === "area" && screenPts.length >= 3) {
            ctx.globalAlpha = 0.15;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const s of screenPts) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
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
  }, [size]);

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
  }, [project, selectedEntityId, selectedPrimitiveId, drawingDraft, tool, draw]);

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

    const onPointerDown = (e: PointerEvent) => {
      const state = useAppStore.getState();
      const pos = localPos(e);
      const world = screenToWorld(pos.x, pos.y);
      cursorWorldRef.current = world;

      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        dragRef.current = {
          mode: "pan",
          pointerId: e.pointerId,
          startWorldX: world.x,
          startWorldY: world.y,
          lastX: pos.x,
          lastY: pos.y,
          moved: false,
        };
        canvas.setPointerCapture(e.pointerId);
        wrap.classList.add("panning");
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      switch (state.tool) {
        case "add-location":
          state.addLocationAt(world.x, world.y);
          draw();
          return;
        case "point":
          state.addPointPrimitiveAt(world.x, world.y);
          return;
        case "label":
          // Важно: отменяем действие по умолчанию, иначе браузер по
          // завершении этого клика перенесёт фокус на canvas и только что
          // открытое поле подписи тут же получит blur и закроется.
          e.preventDefault();
          state.startLabelDraft(world.x, world.y);
          return;
        case "line":
          state.drawingAddPoint(world.x, world.y);
          return;
        case "area": {
          const draft = state.drawingDraft;
          // Клик рядом с первой вершиной (при ≥3) замыкает область.
          if (
            draft &&
            draft.kind === "area" &&
            draft.points.length >= 3 &&
            state.tool === "area"
          ) {
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
            state.selectPrimitive(hit.primitive.id);
            if (!hit.primitive.locked) {
              dragRef.current = {
                mode: "primitive",
                pointerId: e.pointerId,
                startWorldX: world.x,
                startWorldY: world.y,
                lastX: pos.x,
                lastY: pos.y,
                moved: false,
                primitiveId: hit.primitive.id,
                liveX: world.x,
                liveY: world.y,
              };
              canvas.setPointerCapture(e.pointerId);
            }
          } else {
            state.clearSelection();
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
            if (useAppStore.getState().drawingDraft) draw();
          });
        }
        return;
      }
      if (drag.pointerId !== e.pointerId) return;

      const dx = pos.x - drag.lastX;
      const dy = pos.y - drag.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;

      if (drag.mode === "pan") {
        const view = viewRef.current;
        view.centerX -= dx / view.zoom;
        view.centerY -= dy / view.zoom;
        drag.lastX = pos.x;
        drag.lastY = pos.y;
        draw();
        schedulePersistView();
      } else if (drag.mode === "marker") {
        drag.liveX = world.x + (drag.grabDX ?? 0);
        drag.liveY = world.y + (drag.grabDY ?? 0);
        draw();
      } else {
        drag.liveX = world.x;
        drag.liveY = world.y;
        draw();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      wrap.classList.remove("panning");
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

      if (drag.mode === "marker" && drag.moved && drag.entityId !== undefined) {
        useAppStore
          .getState()
          .moveMarker(drag.entityId, Math.round(drag.liveX ?? 0), Math.round(drag.liveY ?? 0));
      }
      if (drag.mode === "primitive" && drag.moved && drag.primitiveId !== undefined) {
        useAppStore
          .getState()
          .movePrimitiveBy(
            drag.primitiveId,
            (drag.liveX ?? drag.startWorldX) - drag.startWorldX,
            (drag.liveY ?? drag.startWorldY) - drag.startWorldY,
          );
      }
      if (drag.mode === "pan") schedulePersistView();
    };

    const onDblClick = (e: MouseEvent) => {
      const state = useAppStore.getState();
      const pos = localPos(e);
      const world = screenToWorld(pos.x, pos.y);

      if (state.tool === "line" || state.tool === "area") {
        // Двойной клик завершает рисование; его собственный клик добавил
        // вершину рядом с предыдущей — убираем дубль.
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
  }, [draw, hitTest, screenToWorld, worldToScreen, schedulePersistView, size]);

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
