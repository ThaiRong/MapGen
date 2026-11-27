import { useEffect, useRef, useState } from "react";
import { analyzeStructureRegen, countReplaceableGenerated } from "../core/project";
import { generate } from "../core/generation/generate";
import { generateStructure } from "../core/generation/structure/generateStructure";
import type {
  GenerationSpec,
  LegendShape,
  StructureArchetype,
  StructureSpec,
} from "../core/types";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

const PREVIEW_DEBOUNCE_MS = 150;

function randomSeed(): string {
  // Вне ядра генерации Math.random допустим: это просто способ
  // предложить пользователю новое зерно.
  return `зерно-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Постоянно видимая панель генерации с явным переключением режимов:
 * «Местность» (итерация 3) и «Локация» (итерация 4). Активна только
 * одна вкладка, обе пишут в общий предпросмотр, в проект и историю —
 * только по кнопке «Применить».
 */
export default function GenerationPanel() {
  const mode = useAppStore((s) => s.generationMode);
  const setGenerationMode = useAppStore((s) => s.setGenerationMode);

  return (
    <div className="gen-panel">
      <div className="gen-tabs">
        <button
          className={mode === "terrain" ? "active" : undefined}
          onClick={() => setGenerationMode("terrain")}
        >
          Местность
        </button>
        <button
          className={mode === "structure" ? "active" : undefined}
          onClick={() => setGenerationMode("structure")}
        >
          Локация
        </button>
      </div>
      {mode === "terrain" ? <TerrainSection /> : <StructureSection />}
    </div>
  );
}

/* ================= Местность (итерация 3) ================= */

interface TerrainParams {
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

const TERRAIN_DEFAULTS: TerrainParams = {
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

function TerrainSection() {
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

  const [params, setParams] = useState<TerrainParams>(TERRAIN_DEFAULTS);
  const [confirmApply, setConfirmApply] = useState<{ spec: GenerationSpec; replace: number } | null>(null);
  const tokenRef = useRef(0);

  const patch = (p: Partial<TerrainParams>) => setParams((prev) => ({ ...prev, ...p }));

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

  const requestApply = () => {
    const spec = buildSpec();
    if (!spec) {
      setStatus("Сначала задайте рамку области генерации на холсте");
      return;
    }
    const replace = countReplaceableGenerated(project, activeMapId);
    if (replace > 0) setConfirmApply({ spec, replace });
    else applyGeneration(spec);
  };

  const shapeTypes = (shape: LegendShape) => project.legend.filter((t) => t.shape === shape);

  return (
    <div className="gen-body">
      <SeedRow seed={params.seed} onChange={(seed) => patch({ seed })} />
      <Slider label="Рельеф" value={params.relief} onChange={(v) => patch({ relief: v })} />
      <Slider label="Влажность" value={params.moisture} onChange={(v) => patch({ moisture: v })} />
      <Slider label="Температура" value={params.temperature} min={-1} max={1} onChange={(v) => patch({ temperature: v })} />
      <Slider label="Уровень жидкости" value={params.fluidLevel} onChange={(v) => patch({ fluidLevel: v })} />
      <Slider label="Плотность областей" value={params.areaDensity} onChange={(v) => patch({ areaDensity: v })} />
      <Slider label="Плотность линий" value={params.lineDensity} onChange={(v) => patch({ lineDensity: v })} />
      <Slider label="Плотность точек" value={params.pointDensity} onChange={(v) => patch({ pointDensity: v })} />
      <Slider label="Детализация" value={params.detail} onChange={(v) => patch({ detail: v })} />
      <Slider label="Масштаб поля" value={params.fieldScale} min={0.5} max={3} onChange={(v) => patch({ fieldScale: v })} />

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
      <Toggle label="Подписи уровней" checked={params.labelsEnabled} onChange={(v) => patch({ labelsEnabled: v })} />

      <div className="field">
        <label>Область генерации</label>
        <select
          className="select"
          value={params.boundsMode}
          onChange={(e) => patch({ boundsMode: e.target.value as TerrainParams["boundsMode"] })}
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

      <PreviewStats preview={preview} calculating={calculating} />

      <div className="gen-buttons">
        <button className="active" onClick={requestApply}>
          Применить к карте
        </button>
        <RegenButton mapGeneration={mapGeneration} />
        <button onClick={() => setParams({ ...TERRAIN_DEFAULTS })}>Сбросить параметры</button>
      </div>
      <div className="hint">
        Применение — одна запись в журнале; ручные примитивы и заблокированные генерация не
        трогает. Результат — обычные редактируемые примитивы.
      </div>

      <ConfirmDialog
        open={confirmApply !== null}
        title="Заменить сгенерированные примитивы?"
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

/* ================= Локация (итерация 4) ================= */

interface StructureParams {
  seed: string;
  archetype: StructureArchetype;
  density: number;
  cellScale: number;
  irregularity: number;
  connectivity: number;
  sizeVariance: number;
  pointDensity: number;
  nestedCount: number;
  margin: number;
  detail: number;
  labelsEnabled: boolean;
  typeArea: string;
  typeLine: string;
  typePoint: string;
  typeLabel: string;
}

const STRUCTURE_DEFAULTS: StructureParams = {
  seed: "зерно-1",
  archetype: "cellular",
  density: 0.5,
  cellScale: 0.5,
  irregularity: 0.35,
  connectivity: 0.5,
  sizeVariance: 0.4,
  pointDensity: 0.4,
  nestedCount: 0,
  margin: 0.3,
  detail: 0.6,
  labelsEnabled: false,
  typeArea: "",
  typeLine: "",
  typePoint: "",
  typeLabel: "",
};

const ARCHETYPES: { value: StructureArchetype; label: string }[] = [
  { value: "cellular", label: "Ячеистая" },
  { value: "linear", label: "Линейная" },
  { value: "radial", label: "Радиальная" },
  { value: "cluster", label: "Кластерная" },
  { value: "open", label: "Открытая" },
  { value: "mixed", label: "Смешанная" },
];

function StructureSection() {
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const mapGeneration = useAppStore((s) => s.project.maps[s.activeMapId]?.generation ?? null);
  const viewport = useAppStore((s) => s.generationViewport);
  const preview = useAppStore((s) => s.generationPreview);
  const calculating = useAppStore((s) => s.generationCalculating);
  const applyStructure = useAppStore((s) => s.applyStructure);
  const seedPreset = useAppStore((s) => s.structureSeedPreset);

  const [params, setParams] = useState<StructureParams>(STRUCTURE_DEFAULTS);
  const [confirmApply, setConfirmApply] = useState<{
    spec: StructureSpec;
    primitives: number;
    mapsRemoved: number;
    mapsKept: number;
  } | null>(null);
  const tokenRef = useRef(0);

  const patch = (p: Partial<StructureParams>) => setParams((prev) => ({ ...prev, ...p }));

  // Деривация зерна из инспектора маркера предзаполняет поле зерна.
  useEffect(() => {
    if (seedPreset) {
      patch({ seed: seedPreset });
      useAppStore.setState({ structureSeedPreset: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPreset]);

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

  const buildSpec = (): StructureSpec => {
    const vw = viewport ? viewport.w / viewport.zoom : 1200;
    const vh = viewport ? viewport.h / viewport.zoom : 800;
    const cx = viewport?.centerX ?? 0;
    const cy = viewport?.centerY ?? 0;
    return {
      seed: params.seed || "зерно",
      archetype: params.archetype,
      density: params.density,
      cellScale: params.cellScale,
      irregularity: params.irregularity,
      connectivity: params.connectivity,
      sizeVariance: params.sizeVariance,
      pointDensity: params.pointDensity,
      nestedCount: Math.round(Math.min(8, Math.max(0, params.nestedCount))),
      margin: params.margin,
      detail: params.detail,
      bounds: {
        x: Math.round(cx - vw * 0.6),
        y: Math.round(cy - vh * 0.6),
        width: Math.round(vw * 1.2),
        height: Math.round(vh * 1.2),
      },
      typeMapping: {
        area: typeFor("area"),
        line: typeFor("line"),
        point: typeFor("point"),
        label: typeFor("label"),
      },
      labels: { enabled: params.labelsEnabled },
    };
  };

  useEffect(() => {
    const store = useAppStore.getState();
    const spec = buildSpec();
    const token = ++tokenRef.current;
    store.setGenerationCalculating(true);
    const timer = setTimeout(() => {
      const result = generateStructure(spec, { preview: true });
      if (token !== tokenRef.current) return;
      store.setGenerationPreview({
        primitives: result.primitives,
        stats: result.stats,
        warnings: result.warnings,
        nested: result.nested,
      });
      store.setGenerationCalculating(false);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, viewport, project.legend]);

  const requestApply = () => {
    const spec = buildSpec();
    const analysis = analyzeStructureRegen(project, activeMapId);
    if (analysis.primitives + analysis.mapsRemoved + analysis.mapsKept > 0) {
      setConfirmApply({ spec, ...analysis });
    } else {
      applyStructure(spec);
    }
  };

  const shapeTypes = (shape: LegendShape) => project.legend.filter((t) => t.shape === shape);
  const structureApplied = mapGeneration?.kind === "structure";

  return (
    <div className="gen-body">
      <div className="field">
        <label>Архетип (структурное имя, без сеттинга)</label>
        <select
          className="select"
          value={params.archetype}
          onChange={(e) => patch({ archetype: e.target.value as StructureArchetype })}
        >
          {ARCHETYPES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <SeedRow seed={params.seed} onChange={(seed) => patch({ seed })} />
      <Slider label="Плотность" value={params.density} onChange={(v) => patch({ density: v })} />
      <Slider label="Размер элементов" value={params.cellScale} onChange={(v) => patch({ cellScale: v })} />
      <Slider label="Нерегулярность" value={params.irregularity} onChange={(v) => patch({ irregularity: v })} />
      <Slider label="Связность" value={params.connectivity} onChange={(v) => patch({ connectivity: v })} />
      <Slider label="Разброс размеров" value={params.sizeVariance} onChange={(v) => patch({ sizeVariance: v })} />
      <Slider label="Плотность узлов" value={params.pointDensity} onChange={(v) => patch({ pointDensity: v })} />

      <div className="field">
        <label>Вложенные локации (0–8)</label>
        <div className="row">
          <button
            disabled={params.nestedCount <= 0}
            onClick={() => patch({ nestedCount: Math.max(0, params.nestedCount - 1) })}
          >
            −
          </button>
          <input type="number" min={0} max={8} value={params.nestedCount} readOnly />
          <button
            disabled={params.nestedCount >= 8}
            onClick={() => patch({ nestedCount: Math.min(8, params.nestedCount + 1) })}
          >
            +
          </button>
        </div>
      </div>

      <Slider label="Отступ от границ" value={params.margin} onChange={(v) => patch({ margin: v })} />
      <Slider label="Детализация" value={params.detail} onChange={(v) => patch({ detail: v })} />

      <div className="field">
        <label>Тип для областей</label>
        <TypeSelect value={typeFor("area")} types={shapeTypes("area")} onChange={(id) => patch({ typeArea: id })} />
      </div>
      <div className="field">
        <label>Тип для линий (связей)</label>
        <TypeSelect value={typeFor("line")} types={shapeTypes("line")} onChange={(id) => patch({ typeLine: id })} />
      </div>
      <div className="field">
        <label>Тип для точек (узлов)</label>
        <TypeSelect value={typeFor("point")} types={shapeTypes("point")} onChange={(id) => patch({ typePoint: id })} />
      </div>
      <Toggle label="Подписи" checked={params.labelsEnabled} onChange={(v) => patch({ labelsEnabled: v })} />

      <PreviewStats preview={preview} calculating={calculating} nested />

      <div className="gen-buttons">
        <button className="active" onClick={requestApply}>
          Применить к карте
        </button>
        <RegenButton mapGeneration={mapGeneration} />
        <button onClick={() => setParams({ ...STRUCTURE_DEFAULTS })}>Сбросить параметры</button>
      </div>
      <div className="hint">
        Вложенные маркеры создаются с пустыми дочерними картами; генерация в них не
        запускается. Перегенерация удалит пустые вложенные карты и сохранит те, где есть
        ваша работа. Один уровень вложенности — рекурсии нет.
      </div>

      <ConfirmDialog
        open={confirmApply !== null}
        title="Заменить результаты прежней генерации?"
        message={
          confirmApply === null
            ? ""
            : `Будет заменено примитивов: ${confirmApply.primitives}. Вложенных карт будет удалено (пустых): ${confirmApply.mapsRemoved}; сохранено (с вашей работой): ${confirmApply.mapsKept}. Ручные примитивы и заблокированные не изменятся. Продолжить?`
        }
        confirmLabel="Заменить и применить"
        danger
        onConfirm={() => {
          if (confirmApply) applyStructure(confirmApply.spec);
          setConfirmApply(null);
        }}
        onCancel={() => setConfirmApply(null)}
      />
      {structureApplied === false && mapGeneration !== null && (
        <div className="hint">
          На карте применена генерация местности — применение локации заменит её сгенерированные
          примитивы (ручные и заблокированные сохранятся).
        </div>
      )}
    </div>
  );
}

/* ================= Общие элементы ================= */

function RegenButton({ mapGeneration }: { mapGeneration: { kind?: string } | null }) {
  const regenerateGeneration = useAppStore((s) => s.regenerateGeneration);
  const kindLabel = mapGeneration?.kind === "structure" ? "локации" : "местности";
  return (
    <button
      disabled={!mapGeneration}
      title={
        mapGeneration
          ? `Заново применить сохранённую спеку ${kindLabel} этой карты`
          : "На этой карте генерация ещё не применялась"
      }
      onClick={() => regenerateGeneration()}
    >
      Перегенерировать
    </button>
  );
}

function SeedRow({ seed, onChange }: { seed: string; onChange: (seed: string) => void }) {
  return (
    <div className="field">
      <label>Зерно (одно зерно — один результат)</label>
      <div className="row">
        <input
          type="text"
          key={seed}
          defaultValue={seed}
          onBlur={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <button title="Случайное зерно" onClick={() => onChange(randomSeed())}>
          🎲
        </button>
      </div>
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="field">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
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

function PreviewStats({
  preview,
  calculating,
  nested = false,
}: {
  preview: ReturnType<typeof useAppStore.getState>["generationPreview"];
  calculating: boolean;
  nested?: boolean;
}) {
  return (
    <div className="gen-stats">
      {calculating ? (
        <span>Расчёт…</span>
      ) : preview ? (
        <span>
          Областей: {preview.stats.areas} · Линий: {preview.stats.lines} · Точек: {preview.stats.points}
          {nested && preview.stats.nested !== undefined ? ` · Вложенных: ${preview.stats.nested}` : ""}
          {preview.stats.labels > 0 ? ` · Подписей: ${preview.stats.labels}` : ""} · Вершин: {preview.stats.vertices}
        </span>
      ) : (
        <span>Предпросмотр пуст: плотности в ноль?</span>
      )}
    </div>
  );
}
