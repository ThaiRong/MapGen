import { countLegendTypeUsage } from "../core/project";
import type { LegendShape } from "../core/types";
import { useAppStore, type Tool } from "../state/store";

const SHAPE_OPTIONS: { value: LegendShape; label: string }[] = [
  { value: "point", label: "Точка" },
  { value: "line", label: "Линия" },
  { value: "area", label: "Область" },
  { value: "label", label: "Подпись" },
];

const TOOL_SHAPE: Partial<Record<Tool, LegendShape>> = {
  point: "point",
  line: "line",
  area: "area",
  label: "label",
};

/**
 * Панель легенды: нейтральные типы, задающие стиль примитивов.
 * Выбранный тип используется инструментами рисования (если форма
 * совпадает с инструментом). Базовые типы нельзя удалить, если это
 * сломает покрытие формы; используемые типы нельзя удалить вообще.
 */
export default function LegendPanel() {
  const project = useAppStore((s) => s.project);
  const legend = project.legend;
  const selectedTypeId = useAppStore((s) => s.selectedTypeId);
  const tool = useAppStore((s) => s.tool);
  const selectLegendType = useAppStore((s) => s.selectLegendType);
  const addLegendTypeFor = useAppStore((s) => s.addLegendTypeFor);

  const selected = legend.find((t) => t.id === selectedTypeId) ?? null;

  return (
    <div className="legend-panel">
      <div className="legend-header">
        <span className="legend-title">Легенда</span>
        <button
          className="mini"
          title="Создать тип легенды (форма — по текущему инструменту)"
          onClick={() => addLegendTypeFor(TOOL_SHAPE[tool] ?? "point")}
        >
          + Тип
        </button>
      </div>

      <ul className="legend-list">
        {legend.map((type) => (
          <li
            key={type.id}
            className={`legend-row${type.id === selectedTypeId ? " active" : ""}`}
            onClick={() => selectLegendType(type.id === selectedTypeId ? null : type.id)}
            title={type.isBuiltin ? "Базовый тип" : "Пользовательский тип"}
          >
            <span className="legend-swatch" style={{ background: type.color }} />
            <span className="legend-name">
              {type.name}
              {type.category ? <span className="legend-cat"> · {type.category}</span> : null}
            </span>
            <span className="legend-shape">{SHAPE_OPTIONS.find((s) => s.value === type.shape)?.label}</span>
            {!type.visible && <span className="legend-hidden">скрыт</span>}
          </li>
        ))}
        {legend.length === 0 && <li className="legend-empty">Типов нет — создайте первый кнопкой «+ Тип».</li>}
      </ul>

      {selected && (
        <LegendTypeEditor
          key={selected.id}
          typeId={selected.id}
          usage={countLegendTypeUsage(project, selected.id)}
          sameShapeCount={legend.filter((t) => t.shape === selected.shape).length}
        />
      )}
    </div>
  );
}

function LegendTypeEditor({
  typeId,
  usage,
  sameShapeCount,
}: {
  typeId: string;
  usage: number;
  sameShapeCount: number;
}) {
  const type = useAppStore((s) => s.project.legend.find((t) => t.id === typeId));
  const updateLegendTypeProps = useAppStore((s) => s.updateLegendTypeProps);
  const deleteLegendTypeById = useAppStore((s) => s.deleteLegendTypeById);
  if (!type) return null;

  const deleteReason =
    usage > 0
      ? `Тип используется ${usage} примитивами — сначала переназначьте их`
      : type.isBuiltin && sameShapeCount <= 1
        ? "Это единственный базовый тип такой формы — удаление сломает проект"
        : null;

  return (
    <div className="legend-editor">
      <div className="field">
        <label>Название</label>
        <input
          type="text"
          key={`${type.id}:${type.name}`}
          defaultValue={type.name}
          onBlur={(e) => updateLegendTypeProps(type.id, { name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="field">
        <label>Категория (создаётся пользователем)</label>
        <input
          type="text"
          key={`${type.id}:${type.category}`}
          defaultValue={type.category}
          placeholder="например: Стены, Вода, Маршруты"
          onBlur={(e) => updateLegendTypeProps(type.id, { category: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="field">
        <label>Форма</label>
        <select
          className="select"
          value={type.shape}
          disabled={type.isBuiltin}
          title={type.isBuiltin ? "Форму базового типа менять нельзя" : undefined}
          onChange={(e) => updateLegendTypeProps(type.id, { shape: e.target.value as LegendShape })}
        >
          {SHAPE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Цвет</label>
          <input
            type="color"
            value={type.color}
            onChange={(e) => updateLegendTypeProps(type.id, { color: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Прозрачность: {Math.round(type.opacity * 100)}%</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={type.opacity}
            onChange={(e) => updateLegendTypeProps(type.id, { opacity: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Толщина линии</label>
          <input
            type="number"
            min={1}
            max={20}
            key={`${type.id}:sw:${type.strokeWidth}`}
            defaultValue={type.strokeWidth}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) updateLegendTypeProps(type.id, { strokeWidth: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
        <div className="field">
          <label>Стиль линии</label>
          <select
            className="select"
            value={type.strokeStyle}
            onChange={(e) =>
              updateLegendTypeProps(type.id, { strokeStyle: e.target.value as "solid" | "dashed" })
            }
          >
            <option value="solid">Сплошная</option>
            <option value="dashed">Пунктир</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={type.visible}
            onChange={(e) => updateLegendTypeProps(type.id, { visible: e.target.checked })}
          />{" "}
          Тип видим на картах
        </label>
      </div>
      <div className="buttons">
        <button
          className="danger"
          disabled={deleteReason !== null}
          title={deleteReason ?? "Удалить тип"}
          onClick={() => deleteLegendTypeById(type.id)}
        >
          Удалить тип
        </button>
      </div>
    </div>
  );
}
