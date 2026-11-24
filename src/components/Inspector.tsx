import { useEffect, useRef, useState } from "react";
import { countChildren } from "../core/project";
import type { MapScale } from "../core/types";
import { useAppStore, useSelectedMarker } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

export default function Inspector() {
  const marker = useSelectedMarker();
  return (
    <div className="inspector">
      {marker ? <MarkerInspector key={marker.id} /> : <MapInspector />}
    </div>
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
        Удаление маркера не удаляет связанную карту — она останется в дереве проекта.
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить маркер?"
        message={`Маркер «${marker.label}» будет удалён с карты. Связанная карта «${target?.name ?? ""}» останется в дереве проекта. Действие можно отменить через Ctrl+Z.`}
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
