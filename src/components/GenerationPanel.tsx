import { useEffect, useRef, useState } from "react";
import { countReplaceableGenerated } from "../core/project";
import { generate } from "../core/generation/generate";
import type { GenerationSpec, LegendShape } from "../core/types";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

interface Params {
  seed: string;
  relief: number;
  moisture: number;
  temperature: number;
  fluidLevel: number;
  areaDensity: number;
  lineDensity: number;
  pointDensity: number;
  detail: number;
  fieldScale: number;
  labelsEnabled: boolean;
  typeArea: string;
  typeLine: string;
  typePoint: string;
  typeLabel: string;
  boundsMode: "whole" | "view" | "rect";
}

const DEFAULTS: Params = {
  seed: "зерно-1",
  relief: 0.5,
  moisture: 0.5,
  temperature: 0,
  fluidLevel: 0.42,
  areaDensity: 0.4,
  lineDensity: 0.35,
  pointDensity: 0.3,
  detail: 0.5,
  fieldScale: 1,
  labelsEnabled: false,
  typeArea: "",
  typeLine: "",
  typePoint: "",
  typeLabel: "",
  boundsMode: "view",
};

const PREVIEW_DEBOUNCE_MS = 150;

function randomSeed(): string {
  // Вне ядра генерации Math.random допустим: это просто способ
  // предложить пользователю новое зерно.
  return `зерно-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Постоянно видимая панель параметров генерации с живым предпросмотром.
 * Все изменения применяются к предпросмотру сразу (debounce), без кнопки
 * «обновить»; в проект и историю ничего не пишется до «Применить».
 */
export default function GenerationPanel() {
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const mapGeneration = useAppStore((s) => s.project.maps[s.activeMapId]?.generation ?? null);
  const viewport = useAppStore((s) => s.generationViewport);
  const boundsRect = useAppStore((s) => s.generationBoundsRect);
  const preview = useAppStore((s) => s.generationPreview);
  const calculating = useAppStore((s) => s.generationCalculating);
  const applyGeneration = useAppStore((s) => s.applyGeneration);
  const startBoundsPick = useAppStore((s) => s.startGenerationBoundsPick);
  const setStatus = useAppStore((s) => s.setStatus);

  const [params, setParams] = useState<Params>(DEFAULTS);
  const [confirmApply, setConfirmApply] = useState<{
    spec: GenerationSpec;
    replace: number;
    isRegen: boolean;
  } | null>(null);
  const tokenRef = useRef(0);

  const patch = (p: Partial<Params>) => setParams((prev) => ({ ...prev, ...p }));

  const typeFor = (shape: LegendShape): string => {
    const chosen =
      shape === "area"
        ? params.typeArea
        : shape === "line"
          ? params.typeLine
          : shape === "point"
            ? params.typePoint
            : params.typeLabel;
    return chosen || project.legend.find((t) => t.shape === shape)?.id || "";
  };

  /** Собирает спеку; null — рамка ещё не задана. */
  const buildSpec = (): GenerationSpec | null => {
    let b: { x: number; y: number; width: number; height: number };
    if (params.boundsMode === "rect") {
      if (!boundsRect) return null;
      b = boundsRect;
    } else if (viewport) {
      const vw = viewport.w / viewport.zoom;
      const vh = viewport.h / viewport.zoom;
      const expand = params.boundsMode === "whole" ? 1.6 : 1;
      b = {
        x: viewport.centerX - (vw / 2) * expand,
        y: viewport.centerY - (vh / 2) * expand,
        width: vw * expand,
        height: vh * expand,
      };
    } else {
      b = { x: -600, y: -450, width: 1200, height: 900 };
    }
    const bounds = {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.max(50, Math.round(b.width)),
      height: Math.max(50, Math.round(b.height)),
    };
    return {
      seed: params.seed || "зерно",
      relief: params.relief,
      moisture: params.moisture,
      temperature: params.temperature,
      fluidLevel: params.fluidLevel,
      areaDensity: params.areaDensity,
      lineDensity: params.lineDensity,
      pointDensity: params.pointDensity,
      detail: params.detail,
      fieldScale: params.fieldScale,
      bounds,
      typeMapping: {
        area: typeFor("area"),
        line: typeFor("line"),
        point: typeFor("point"),
        label: typeFor("label"),
      },
      labels: { enabled: params.labelsEnabled },
    };
  };

  /* Живой предпросмотр: debounce, устаревшие расчёты отбрасываются токеном. */
  useEffect(() => {
    const store = useAppStore.getState();
    const spec = buildSpec();
    if (!spec) {
      store.setGenerationPreview(null);
      return;
    }
    const token = ++tokenRef.current;
    store.setGenerationCalculating(true);
    const timer = setTimeout(() => {
      const result = generate(spec, { preview: true });
      if (token !== tokenRef.current) return;
      store.setGenerationPreview({
        primitives: result.primitives,
        stats: result.stats,
        warnings: result.warnings,
      });
      store.setGenerationCalculating(false);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, viewport, boundsRect, project.legend]);

  const requestApply = (isRegen: boolean, spec?: GenerationSpec) => {
    const finalSpec = spec ?? buildSpec();
    if (!finalSpec) {
      setStatus("Сначала задайте рамку области генерации на холсте");
      return;
    }
    const replace = countReplaceableGenerated(project, activeMapId);
    if (replace > 0) {
      setConfirmApply({ spec: finalSpec, replace, isRegen });
    } else {
      applyGeneration(finalSpec);
    }
  };

  const shapeTypes = (shape: LegendShape) => project.legend.filter((t) => t.shape === shape);

  return (
    <div className="gen-panel">
      <div className="gen-title">Генерация</div>

      <div className="gen-body">
        <div className="field">
          <label>Зерно (одно зерно — один результат)</label>
          <div className="row">
            <input
              type="text"
              key={params.seed}
              defaultValue={params.seed}
              onBlur={(e) => patch({ seed: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <button title="Случайное зерно" onClick={() => patch({ seed: randomSeed() })}>
              🎲
            </button>
          </div>
        </div>

        <Slider label="Рельеф" value={params.relief} onChange={(v) => patch({ relief: v })} />
        <Slider label="Влажность" value={params.moisture} onChange={(v) => patch({ moisture: v })} />
        <Slider
          label="Температура"
          value={params.temperature}
          min={-1}
          max={1}
          onChange={(v) => patch({ temperature: v })}
        />
        <Slider label="Уровень жидкости" value={params.fluidLevel} onChange={(v) => patch({ fluidLevel: v })} />
        <Slider label="Плотность областей" value={params.areaDensity} onChange={(v) => patch({ areaDensity: v })} />
        <Slider label="Плотность линий" value={params.lineDensity} onChange={(v) => patch({ lineDensity: v })} />
        <Slider label="Плотность точек" value={params.pointDensity} onChange={(v) => patch({ pointDensity: v })} />
        <Slider label="Детализация" value={params.detail} onChange={(v) => patch({ detail: v })} />
        <Slider
          label="Масштаб поля"
          value={params.fieldScale}
          min={0.5}
          max={3}
          onChange={(v) => patch({ fieldScale: v })}
        />

        <div className="field">
          <label>Тип для областей</label>
          <TypeSelect value={typeFor("area")} types={shapeTypes("area")} onChange={(id) => patch({ typeArea: id })} />
        </div>
        <div className="field">
          <label>Тип для линий</label>
          <TypeSelect value={typeFor("line")} types={shapeTypes("line")} onChange={(id) => patch({ typeLine: id })} />
        </div>
        <div className="field">
          <label>Тип для точек</label>
          <TypeSelect value={typeFor("point")} types={shapeTypes("point")} onChange={(id) => patch({ typePoint: id })} />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={params.labelsEnabled}
              onChange={(e) => patch({ labelsEnabled: e.target.checked })}
            />{" "}
            Подписи уровней
          </label>
        </div>

        <div className="field">
          <label>Область генерации</label>
          <select
            className="select"
            value={params.boundsMode}
            onChange={(e) => patch({ boundsMode: e.target.value as Params["boundsMode"] })}
          >
            <option value="whole">Вся карта (область вокруг вида)</option>
            <option value="view">Видимая область</option>
            <option value="rect">Выделенный прямоугольник</option>
          </select>
          {params.boundsMode === "rect" && (
            <button className="gen-bounds-btn" onClick={startBoundsPick}>
              {boundsRect
                ? `Рамка: ${boundsRect.width}×${boundsRect.height} — задать заново`
                : "Задать рамкой на холсте"}
            </button>
          )}
        </div>

        <div className="gen-stats">
          {calculating ? (
            <span>Расчёт…</span>
          ) : preview ? (
            <span>
              Областей: {preview.stats.areas} · Линий: {preview.stats.lines} · Точек: {preview.stats.points}
              {preview.stats.labels > 0 ? ` · Подписей: ${preview.stats.labels}` : ""} · Вершин:{" "}
              {preview.stats.vertices}
            </span>
          ) : params.boundsMode === "rect" && !boundsRect ? (
            <span>Задайте рамку области — предпросмотр появится автоматически</span>
          ) : (
            <span>Предпросмотр пуст: плотности в ноль?</span>
          )}
        </div>
        {preview && preview.warnings.length > 0 && (
          <div className="gen-warnings">
            {preview.warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <div className="gen-buttons">
          <button className="active" onClick={() => requestApply(false)}>
            Применить к карте
          </button>
          <button
            disabled={!mapGeneration}
            title={mapGeneration ? "Заново применить сохранённую спеку этой карты" : "На этой карте генерация ещё не применялась"}
            onClick={() => requestApply(true, mapGeneration?.spec)}
          >
            Перегенерировать
          </button>
          <button onClick={() => setParams({ ...DEFAULTS })}>Сбросить параметры</button>
        </div>
        <div className="hint">
          Применение — одна запись в журнале; ручные примитивы и заблокированные генерация не
          трогает. Результат — обычные редактируемые примитивы.
        </div>
      </div>

      <ConfirmDialog
        open={confirmApply !== null}
        title={confirmApply?.isRegen ? "Перегенерировать?" : "Заменить сгенерированные примитивы?"}
        message={
          confirmApply === null
            ? ""
            : `Будет заменено ${confirmApply.replace} ранее сгенерированных примитивов на этой карте. Ручные примитивы (origin=manual) и заблокированные не изменятся. Продолжить?`
        }
        confirmLabel="Заменить и применить"
        danger
        onConfirm={() => {
          if (confirmApply) applyGeneration(confirmApply.spec);
          setConfirmApply(null);
        }}
        onCancel={() => setConfirmApply(null)}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>
        {label}: {Math.round(value * 100) / 100}
      </label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function TypeSelect({
  value,
  types,
  onChange,
}: {
  value: string;
  types: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  if (types.length === 0) {
    return <div className="value">Нет типов этой формы — создайте в панели легенды</div>;
  }
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {types.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
