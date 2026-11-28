import { useState } from "react";
import type { FogCategory } from "../core/types";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

const CATEGORY_LABELS: { id: FogCategory; label: string }[] = [
  { id: "landscape", label: "Ландшафт (области)" },
  { id: "topography", label: "Топография (линии, точки, подписи)" },
  { id: "objects", label: "Интерактивные (маркеры)" },
];

/**
 * Панель кисти тумана: радиус, режим, категории, оверлей мастера,
 * массовые операции с подтверждением и точными числами.
 */
export default function FogControls() {
  const radius = useAppStore((s) => s.fogRadius);
  const reveal = useAppStore((s) => s.fogReveal);
  const categories = useAppStore((s) => s.fogCategories);
  const overlayVisible = useAppStore((s) => s.fogOverlayVisible);
  const setFogRadius = useAppStore((s) => s.setFogRadius);
  const setFogReveal = useAppStore((s) => s.setFogReveal);
  const toggleFogCategory = useAppStore((s) => s.toggleFogCategory);
  const toggleFogOverlay = useAppStore((s) => s.toggleFogOverlay);
  const fogSetAll = useAppStore((s) => s.fogSetAll);
  const fogInvert = useAppStore((s) => s.fogInvert);
  const hiddenCount = useAppStore((s) => s.fogHiddenCountForConfirm);

  const [pending, setPending] = useState<"reveal" | "hide" | "invert" | null>(null);

  const countText =
    pending === "reveal"
      ? `Будет раскрыто скрытых тайлов: ${hiddenCount(true)} (в текущем виде).`
      : pending === "hide"
        ? `Будет скрыто видимых тайлов: ${hiddenCount(false)} (в текущем виде).`
        : pending === "invert"
          ? `Скрыто станет раскрытым и наоборот: скрыто сейчас ${hiddenCount(true)}, раскрыто ${hiddenCount(false)} (в текущем виде).`
          : "";

  return (
    <div className="fog-controls" onPointerDown={(e) => e.stopPropagation()}>
      <div className="fog-title">Туман войны</div>
      <div className="field">
        <label>Радиус кисти: {radius}</label>
        <input
          type="range"
          min={32}
          max={600}
          step={8}
          value={radius}
          onChange={(e) => setFogRadius(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <button className={reveal ? "active" : undefined} onClick={() => setFogReveal(true)}>
          Раскрыть
        </button>
        <button className={!reveal ? "active" : undefined} onClick={() => setFogReveal(false)}>
          Скрыть
        </button>
      </div>
      <div className="fog-categories">
        {CATEGORY_LABELS.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={categories.includes(c.id)}
              onChange={() => toggleFogCategory(c.id)}
            />{" "}
            {c.label}
          </label>
        ))}
      </div>
      <label className="fog-overlay-toggle">
        <input type="checkbox" checked={overlayVisible} onChange={toggleFogOverlay} /> Показывать
        скрытое мастеру (оверлей)
      </label>
      <div className="row fog-mass">
        <button onClick={() => setPending("reveal")}>Раскрыть всё</button>
        <button onClick={() => setPending("hide")}>Скрыть всё</button>
        <button onClick={() => setPending("invert")}>Инвертировать</button>
      </div>
      <div className="hint">
        Клик по маркеру или примитиву — операция над сущностью целиком. Alt — обратный режим
        кисти. Один штрих — одна запись в журнале.
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === "reveal"
            ? "Раскрыть туман полностью?"
            : pending === "hide"
              ? "Скрыть туман полностью?"
              : "Инвертировать туман?"
        }
        message={`${countText} Действие по выбранным категориям (${categories.length}). Отменяется через Ctrl+Z. Продолжить?`}
        confirmLabel="Выполнить"
        danger={pending !== "reveal"}
        onConfirm={() => {
          if (pending === "reveal") fogSetAll(true);
          else if (pending === "hide") fogSetAll(false);
          else if (pending === "invert") fogInvert();
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
