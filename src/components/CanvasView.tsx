import { useCallback, useEffect, useRef } from "react";
import type { MapView } from "../core/types";
import { useAppStore } from "../state/store";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
const MARKER_RADIUS = 6;
const HIT_RADIUS = 12;
const DEFAULT_VIEW: MapView = { centerX: 0, centerY: 0, zoom: 1 };

interface DragState {
  mode: "pan" | "marker";
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  entityId?: string;
  grabDX?: number;
  grabDY?: number;
  liveX?: number;
  liveY?: number;
}

export default function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapView>({ ...DEFAULT_VIEW });
  const dragRef = useRef<DragState | null>(null);
  const spaceRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafPending = useRef(false);

  const activeMapId = useAppStore((s) => s.activeMapId);
  const selectedEntityId = useAppStore((s) => s.selectedEntityId);
  const tool = useAppStore((s) => s.tool);
  const project = useAppStore((s) => s.project);

  const size = useCallback(() => {
    const canvas = canvasRef.current;
    return { w: canvas?.clientWidth ?? 0, h: canvas?.clientHeight ?? 0 };
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const { w, h } = size();
    const view = viewRef.current;
    return {
      x: (sx - w / 2) / view.zoom + view.centerX,
      y: (sy - h / 2) / view.zoom + view.centerY,
    };
  }, [size]);

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
        const sx = (gx - view.centerX) * view.zoom + w / 2;
        const sy = (gy - view.centerY) * view.zoom + h / 2;
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
      }
    }

    const drag = dragRef.current;
    if (map) {
      for (const e of map.entities) {
        const isDragged = drag?.mode === "marker" && drag.entityId === e.id;
        const ex = isDragged ? (drag.liveX ?? e.x) : e.x;
        const ey = isDragged ? (drag.liveY ?? e.y) : e.y;
        const sx = (ex - view.centerX) * view.zoom + w / 2;
        const sy = (ey - view.centerY) * view.zoom + h / 2;
        if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = e.id === state.selectedEntityId ? "#f0a13c" : "#4f8cff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#0d0e12";
        ctx.stroke();

        ctx.font = "12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#d7d9e0";
        ctx.fillText(e.label, sx, sy - MARKER_RADIUS - 6);
      }

      if (map.entities.length === 0) {
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(215, 217, 224, 0.35)";
        ctx.fillText(
          state.tool === "add-location"
            ? "Кликните, чтобы поставить локацию"
            : "Нажмите «Добавить локацию», чтобы создать первую локацию",
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

  const hitTest = useCallback((sx: number, sy: number) => {
    const state = useAppStore.getState();
    const map = state.project.maps[state.activeMapId];
    if (!map) return null;
    const { w, h } = size();
    const view = viewRef.current;
    for (let i = map.entities.length - 1; i >= 0; i -= 1) {
      const e = map.entities[i];
      const ex = (e.x - view.centerX) * view.zoom + w / 2;
      const ey = (e.y - view.centerY) * view.zoom + h / 2;
      if (Math.hypot(ex - sx, ey - sy) <= HIT_RADIUS) return e;
    }
    return null;
  }, [size]);

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
  }, [project, selectedEntityId, tool, draw]);

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

      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        dragRef.current = {
          mode: "pan",
          pointerId: e.pointerId,
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

      if (state.tool === "add-location") {
        const world = screenToWorld(pos.x, pos.y);
        state.addLocationAt(world.x, world.y);
        draw();
        return;
      }

      const hit = hitTest(pos.x, pos.y);
      if (hit) {
        state.selectEntity(hit.id);
        const world = screenToWorld(pos.x, pos.y);
        dragRef.current = {
          mode: "marker",
          pointerId: e.pointerId,
          lastX: pos.x,
          lastY: pos.y,
          moved: false,
          entityId: hit.id,
          // Смещение точки захвата относительно центра маркера —
          // чтобы маркер не «прыгал» к курсору при старте перетаскивания.
          grabDX: hit.x - world.x,
          grabDY: hit.y - world.y,
          liveX: hit.x,
          liveY: hit.y,
        };
        canvas.setPointerCapture(e.pointerId);
      } else {
        state.selectEntity(null);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const pos = localPos(e);
      const drag = dragRef.current;

      if (!drag) {
        if (!rafPending.current) {
          rafPending.current = true;
          requestAnimationFrame(() => {
            rafPending.current = false;
            const world = screenToWorld(pos.x, pos.y);
            useAppStore.getState().setCursor({ x: world.x, y: world.y });
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
      } else {
        const world = screenToWorld(pos.x, pos.y);
        drag.liveX = world.x + (drag.grabDX ?? 0);
        drag.liveY = world.y + (drag.grabDY ?? 0);
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
      if (drag.mode === "pan") schedulePersistView();
    };

    const onDblClick = (e: MouseEvent) => {
      const pos = localPos(e);
      const hit = hitTest(pos.x, pos.y);
      if (hit) {
        useAppStore.getState().openMap(hit.targetMapId);
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
  }, [draw, hitTest, screenToWorld, schedulePersistView, size]);

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

  const wrapperClass = `canvas-wrap${tool === "add-location" ? " tool-add" : ""}`;

  return (
    <div ref={wrapRef} className={wrapperClass}>
      <canvas ref={canvasRef} />
    </div>
  );
}
