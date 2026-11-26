import { useEffect, useRef, useState } from "react";
import { countChildren, legendTypeById } from "../core/project";
import type { LegendShape, MapScale } from "../core/types";
import {
  useAppStore,
  useSelectedMarker,
  useSelectedPrimitive,
  useSelectedPrimitives,
} from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

const SHAPE_NAME: Record<LegendShape, string> = {
  point: "точка",
  line: "линия",
  area: "область",
  label: "подпись",
};

export default function Inspector() {
  const marker = useSelectedMarker();
  const primitives = useSelectedPrimitives();
  if (marker) {
    return (
      <div className="inspector">
        <MarkerInspector key={marker.id} />
      </div>
    );
  }
  if (primitives.length > 1) {
    return (
      <div className="inspector">
        <MultiPrimitiveInspector />
      </div>
    );
  }
  if (primitives.length === 1) {
    return (
      <div className="inspector">
        <PrimitiveInspector key={primitives[0].id} />
      </div>
    );
  }
  return (
    <div className="inspector">
      <MapInspector />
    </div>
  );
}

function MultiPrimitiveInspector() {
  const primitives = useSelectedPrimitives();
  const clearSelection = useAppStore((s) => s.clearSelection);
  const deleteSelectedPrimitives = useAppStore((s) => s.deleteSelectedPrimitives);
  const moveSelectedPrimitives = useAppStore((s) => s.moveSelectedPrimitives);
  const lockedCount = primitives.filter((p) => p.locked).length;

  return (
    <>
      <h2>Выбрано примитивов: {primitives.length}</h2>
      <div className="field">
        <div className="value">
          {primitives.map((p) => (
            <div key={p.id}>
              {SHAPE_NAME[p.kind]} «{p.kind === "label" && p.text.trim() ? p.text.trim() : p.name}»
              {p.locked ? " (заблокирован)" : ""}
            </div>
          ))}
        </div>
      </div>
      <div className="buttons">
        <button
          onClick={() => moveSelectedPrimitives(10, 0)}
          title="Сдвинуть всю группу на 10 единиц вправо"
        >
          Сдвинуть группу →
        </button>
        <button onClick={deleteSelectedPrimitives}>
          Удалить выбранные{lockedCount > 0 ? ` (${lockedCount} заблокированы — будут пропущены)` : ""}
        </button>
        <button onClick={clearSelection}>Снять выделение</button>
      </div>
      <div className="hint">
        Группу можно перетаскивать на холсте за любой выбранный примитив. Добавление к
        выделению — Shift+клик или рамка.
      </div>
    </>
  );
}

function MapInspector() {
  const map = useAppStore((s) => s.project.maps[s.activeMapId]);
  const project = useAppStore((s) => s.project);
  const renameMapById = useAppStore((s) => s.renameMapById);
  const setScale = useAppStore((s) => s.setScale);

  const [scaleEnabled, setScaleEnabled] = useState(false);
  const [units, setUnits] = useState("");
  const [unitLabel, setUnitLabel] = useState("");

  useEffect(() => {
    setScaleEnabled(map?.scale?.enabled ?? false);
    setUnits(
      map?.scale?.unitsPerWorldUnit !== undefined ? String(map.scale.unitsPerWorldUnit) : "",
    );
    setUnitLabel(map?.scale?.unitLabel ?? "");
  }, [map?.id, map?.scale]);

  if (!map) return null;

  const parent = map.parentId ? project.maps[map.parentId] : null;

  const commitScale = (enabled: boolean, unitsValue: string, labelValue: string) => {
    if (!enabled) {
      setScale(map.id, undefined);
      return;
    }
    const n = Number(unitsValue);
    const scale: MapScale = {
      enabled: true,
      unitsPerWorldUnit: Number.isFinite(n) && n > 0 ? n : undefined,
      unitLabel: labelValue.trim() || undefined,
    };
    setScale(map.id, scale);
  };

  return (
    <>
      <h2>Карта</h2>
      <div className="field">
        <label>Название</label>
        <input
          key={`${map.id}:${map.name}`}
          type="text"
          defaultValue={map.name}
          onBlur={(e) => renameMapById(map.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="field">
        <label>ID</label>
        <div className="value">{map.id}</div>
      </div>
      <div className="field">
        <label>Родительская карта</label>
        <div className="value">{parent ? parent.name : "— (корневая)"}</div>
      </div>
      <div className="field">
        <label>Дочерние карты</label>
        <div className="value">{countChildren(project, map.id)}</div>
      </div>
      <div className="field">
        <label>Сущностей на карте</label>
        <div className="value">{map.entities.length}</div>
      </div>

      <h2>Масштаб</h2>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={scaleEnabled}
            onChange={(e) => {
              setScaleEnabled(e.target.checked);
              commitScale(e.target.checked, units, unitLabel);
            }}
          />{" "}
          Задать масштаб
        </label>
      </div>
      {scaleEnabled && (
        <>
          <div className="field">
            <label>Единиц на условную единицу холста</label>
            <input
              type="number"
              min={0}
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              onBlur={() => commitScale(true, units, unitLabel)}
            />
          </div>
          <div className="field">
            <label>Подпись единиц (км, м, мили, сектора…)</label>
            <input
              type="text"
              value={unitLabel}
              placeholder="км"
              onChange={(e) => setUnitLabel(e.target.value)}
              onBlur={() => commitScale(true, units, unitLabel)}
            />
          </div>
        </>
      )}
      <div className="hint">
        Чтобы создать локацию, включите инструмент «Добавить локацию» и кликните по холсту.
      </div>
    </>
  );
}

function MarkerInspector() {
  const marker = useSelectedMarker();
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const renameSelectedMarker = useAppStore((s) => s.renameSelectedMarker);
  const moveMarker = useAppStore((s) => s.moveMarker);
  const openMap = useAppStore((s) => s.openMap);
  const deleteSelectedMarker = useAppStore((s) => s.deleteSelectedMarker);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  if (!marker) return null;
  const target = project.maps[marker.targetMapId];

  return (
    <>
      <h2>Маркер локации</h2>
      <div className="field">
        <label>Название</label>
        <input
          ref={labelRef}
          key={`${marker.id}:${marker.label}`}
          type="text"
          defaultValue={marker.label}
          onBlur={(e) => renameSelectedMarker(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <div className="field">
        <label>Связанная карта</label>
        <div className="value">{target ? target.name : "— (карта не найдена)"}</div>
      </div>
      <div className="field">
        <label>ID маркера</label>
        <div className="value">{marker.id}</div>
      </div>
      <div className="field">
        <label>Координаты на карте «{project.maps[activeMapId]?.name ?? ""}»</label>
        <div className="row">
          <input
            key={`${marker.id}:x:${marker.x}`}
            type="number"
            defaultValue={Math.round(marker.x)}
            title="X"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== marker.x) moveMarker(marker.id, v, marker.y);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <input
            key={`${marker.id}:y:${marker.y}`}
            type="number"
            defaultValue={Math.round(marker.y)}
            title="Y"
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v !== marker.y) moveMarker(marker.id, marker.x, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      </div>

      <div className="buttons">
        <button
          disabled={!target}
          onClick={() => {
            if (target) openMap(target.id);
          }}
        >
          Открыть локацию
        </button>
        <button onClick={() => labelRef.current?.focus()}>Переименовать</button>
        <button className="danger" onClick={() => setConfirmDelete(true)}>
          Удалить маркер
        </button>
      </div>
      <div className="hint">
        Удаление перенесёт маркер в архив: связанная карта останется в дереве, а маркер можно
        будет восстановить на прежнем месте через кнопку «Архив» в тулбаре.
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить маркер?"
        message={`Маркер «${marker.label}» будет перенесён в архив. Связанная карта «${target?.name ?? ""}» останется в дереве проекта. Восстановить маркер можно через кнопку «Архив» или отменой Ctrl+Z.`}
        confirmLabel="Удалить маркер"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          deleteSelectedMarker();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function PrimitiveInspector() {
  const primitive = useSelectedPrimitive();
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const updatePrimitiveProps = useAppStore((s) => s.updatePrimitiveProps);
  const deletePrimitiveById = useAppStore((s) => s.deletePrimitiveById);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const adjustLabelFontSize = useAppStore((s) => s.adjustLabelFontSize);
  const rotatePrimitiveBy = useAppStore((s) => s.rotatePrimitiveBy);
  const copySelectedPrimitive = useAppStore((s) => s.copySelectedPrimitive);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!primitive) return null;
  const suitableTypes = project.legend.filter((t) => t.shape === primitive.kind);
  const type = legendTypeById(project, primitive.typeId);
  const mapName = project.maps[activeMapId]?.name ?? "";
  const kindName = SHAPE_NAME[primitive.kind];

  const geometry =
    primitive.kind === "line"
      ? `Точек: ${primitive.points.length}`
      : primitive.kind === "area"
        ? `Вершин: ${primitive.points.length}`
        : `x: ${Math.round(primitive.x)}, y: ${Math.round(primitive.y)}`;

  return (
    <>
      <h2>Примитив ({kindName})</h2>
      <div className="field">
        <label>Название</label>
        <input
          key={`${primitive.id}:${primitive.name}`}
          type="text"
          defaultValue={primitive.name}
          onBlur={(e) => updatePrimitiveProps(activeMapId, primitive.id, { name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>

      <div className="field">
        <label>Тип легенды (форма «{kindName}»)</label>
        {suitableTypes.length === 0 ? (
          <div className="value">Нет типов формы «{kindName}» — создайте тип в панели легенды.</div>
        ) : (
          <select
            className="select"
            value={primitive.typeId}
            onChange={(e) => updatePrimitiveProps(activeMapId, primitive.id, { typeId: e.target.value })}
          >
            {suitableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.visible ? "" : " (скрыт)"}
              </option>
            ))}
          </select>
        )}
        {type && (
          <div className="hint">
            Стиль: {type.color}, прозрачность {Math.round(type.opacity * 100)}%, толщина {type.strokeWidth}
            {type.strokeStyle === "dashed" ? ", пунктир" : ""}.
          </div>
        )}
      </div>

      {primitive.kind === "label" && (
        <>
          <div className="field">
            <label>Текст подписи</label>
            <input
              key={`${primitive.id}:text:${primitive.text}`}
              type="text"
              defaultValue={primitive.text}
              onBlur={(e) => updatePrimitiveProps(activeMapId, primitive.id, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <div className="field">
            <label>Размер шрифта (8–72)</label>
            <div className="row">
              <button
                title="Уменьшить (−)"
                disabled={primitive.fontSize <= 8}
                onClick={() => adjustLabelFontSize(primitive.id, -2)}
              >
                −
              </button>
              <input
                key={`${primitive.id}:font:${primitive.fontSize}`}
                type="number"
                min={8}
                max={72}
                defaultValue={primitive.fontSize}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    updatePrimitiveProps(activeMapId, primitive.id, { fontSize: v });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
              <button
                title="Увеличить (+)"
                disabled={primitive.fontSize >= 72}
                onClick={() => adjustLabelFontSize(primitive.id, 2)}
              >
                +
              </button>
            </div>
            <div className="hint">Или выберите подпись и жмите + / −.</div>
          </div>
        </>
      )}

      <div className="field">
        <label>Геометрия на карте «{mapName}»</label>
        <div className="value">{geometry}</div>
      </div>

      {(primitive.kind === "line" || primitive.kind === "area") && (
        <div className="field">
          <label>Поворот вокруг центра (ручка над фигурой на холсте)</label>
          <div className="row">
            <button title="−45°" onClick={() => rotatePrimitiveBy(primitive.id, (-45 * Math.PI) / 180)}>
              −45°
            </button>
            <button title="−15°" onClick={() => rotatePrimitiveBy(primitive.id, (-15 * Math.PI) / 180)}>
              −15°
            </button>
            <button title="+15°" onClick={() => rotatePrimitiveBy(primitive.id, (15 * Math.PI) / 180)}>
              +15°
            </button>
            <button title="+45°" onClick={() => rotatePrimitiveBy(primitive.id, (45 * Math.PI) / 180)}>
              +45°
            </button>
          </div>
          <div className="hint">Вершины фигуры можно таскать; двойной клик по ребру добавляет вершину.</div>
        </div>
      )}

      <div className="field">
        <label>Заметка</label>
        <textarea
          key={`${primitive.id}:note:${primitive.note}`}
          className="textarea"
          rows={3}
          defaultValue={primitive.note}
          placeholder="Произвольная заметка мастера"
          onBlur={(e) => updatePrimitiveProps(activeMapId, primitive.id, { note: e.target.value })}
        />
      </div>

      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={primitive.visible}
            onChange={(e) => updatePrimitiveProps(activeMapId, primitive.id, { visible: e.target.checked })}
          />{" "}
          Видимый
        </label>
        <label>
          <input
            type="checkbox"
            checked={primitive.locked}
            onChange={(e) => updatePrimitiveProps(activeMapId, primitive.id, { locked: e.target.checked })}
          />{" "}
          Заблокирован (нельзя двигать и удалять)
        </label>
      </div>

      <div className="buttons">
        <button onClick={copySelectedPrimitive} title="Ctrl+C — копировать, Ctrl+V — вставить">
          Копировать
        </button>
        <button disabled={primitive.locked} onClick={() => setConfirmDelete(true)}>
          Удалить примитив
        </button>
        <button onClick={clearSelection}>Снять выделение</button>
      </div>
      <div className="hint">
        Удаление восстанавливается через журнал: Ctrl+Z или кнопка в панели «История».
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить примитив?"
        message={`${kindName[0].toUpperCase() + kindName.slice(1)} «${primitive.name}» будет удалена с карты «${mapName}». Восстановить её можно через панель «История» или Ctrl+Z.`}
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          deletePrimitiveById(activeMapId, primitive.id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
