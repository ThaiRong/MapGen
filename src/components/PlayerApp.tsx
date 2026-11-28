import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PlayerFeedPayload } from "../core/playerFeed";
import { PLAYER_FEED_EVENT } from "../core/playerFeed";
import type { LegendType, Vec2 } from "../core/types";

/**
 * Окно игрока (итерация 8): только просмотр отфильтрованной проекции.
 * Свой pan/zoom, режим «следовать за камерой мастера», счётчик видимых
 * объектов, фильтруемая легенда. Никаких инструментов, дерева карт,
 * инспектора и заметок мастера — их данные сюда не передаются вовсе.
 */
export default function PlayerApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [feed, setFeed] = useState<PlayerFeedPayload | null>(null);
  const [follow, setFollow] = useState(true);
  const viewRef = useRef({ centerX: 0, centerY: 0, zoom: 1 });
  const followRef = useRef(true);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  followRef.current = follow;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<PlayerFeedPayload>(PLAYER_FEED_EVENT, (event) => {
      setFeed(event.payload);
      if (followRef.current) {
        viewRef.current = { ...event.payload.camera };
      }
      draw();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = viewRef.current;
    const toS = (pt: Vec2): Vec2 => ({
      x: (pt.x - view.centerX) * view.zoom + w / 2,
      y: (pt.y - view.centerY) * view.zoom + h / 2,
    });

    ctx.fillStyle = "#101116";
    ctx.fillRect(0, 0, w, h);
    const current = feedRef.current;
    if (!current) {
      ctx.fillStyle = "rgba(215, 217, 224, 0.4)";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Ожидание данных от мастера…", w / 2, h / 2);
      return;
    }
    const typeOf = (id: string): LegendType | undefined => current.legend.find((t) => t.id === id);

    for (const p of current.projection.primitives) {
      const type = typeOf(p.typeId);
      if (!type || !type.visible) continue;
      ctx.save();
      ctx.globalAlpha = type.opacity;
      ctx.strokeStyle = type.color;
      ctx.fillStyle = type.color;
      ctx.lineWidth = Math.max(1, type.strokeWidth);
      ctx.setLineDash(type.strokeStyle === "dashed" ? [10, 6] : []);
      if (p.kind === "area" && p.points.length >= 3) {
        ctx.beginPath();
        const s0 = toS(p.points[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < p.points.length; i += 1) {
          const s = toS(p.points[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.globalAlpha = type.opacity * 0.35;
        ctx.fill();
        ctx.globalAlpha = type.opacity;
        ctx.stroke();
      } else if (p.kind === "line" && p.points.length >= 2) {
        ctx.beginPath();
        const s0 = toS(p.points[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < p.points.length; i += 1) {
          const s = toS(p.points[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      } else if (p.kind === "point") {
        const c = toS({ x: p.x, y: p.y });
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "label") {
        const c = toS({ x: p.x, y: p.y });
        ctx.font = `${p.fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.text, c.x, c.y);
      }
      ctx.restore();
    }
    for (const m of current.projection.markers) {
      const s = toS({ x: m.x, y: m.y });
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#4f8cff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0d0e12";
      ctx.stroke();
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#d7d9e0";
      ctx.fillText(m.label, s.x, s.y - 12);
    }
  };

  const feedRef = useRef<PlayerFeedPayload | null>(null);
  feedRef.current = feed;

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setFollow(false);
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const view = viewRef.current;
      const before = {
        x: (mx - canvas.clientWidth / 2) / view.zoom + view.centerX,
        y: (my - canvas.clientHeight / 2) / view.zoom + view.centerY,
      };
      view.zoom = Math.min(20, Math.max(0.05, view.zoom * Math.exp(-e.deltaY * 0.0012)));
      view.centerX = before.x - (mx - canvas.clientWidth / 2) / view.zoom;
      view.centerY = before.y - (my - canvas.clientHeight / 2) / view.zoom;
      draw();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      setFollow(false);
      dragRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const view = viewRef.current;
      view.centerX -= (e.clientX - drag.x) / view.zoom;
      view.centerY -= (e.clientY - drag.y) / view.zoom;
      drag.x = e.clientX;
      drag.y = e.clientY;
      draw();
    };
    const onPointerUp = (e: PointerEvent) => {
      dragRef.current = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCount = feed
    ? feed.projection.primitives.length + feed.projection.markers.length
    : 0;
  // Фильтруемая легенда: только типы, у которых есть видимые объекты.
  const usedTypes = feed
    ? feed.legend.filter((t) => feed.projection.primitives.some((p) => p.typeId === t.id))
    : [];

  return (
    <div className="player-app">
      <div className="player-toolbar">
        <span className="player-map-name">{feed?.mapName ?? "Карта не выбрана"}</span>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked);
              if (e.target.checked && feed) {
                viewRef.current = { ...feed.camera };
                draw();
              }
            }}
          />{" "}
          Следовать за камерой мастера
        </label>
        <span className="player-counter">Видимых объектов: {visibleCount}</span>
      </div>
      <div ref={wrapRef} className="player-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      {usedTypes.length > 0 && (
        <div className="player-legend">
          {usedTypes.map((t) => (
            <span key={t.id} className="player-legend-item">
              <span className="legend-swatch" style={{ background: t.color }} />
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
