import { legendTypeById } from "../core/project";
import type { Primitive } from "../core/types";
import { useAppStore } from "../state/store";

const KIND_NAME: Record<Primitive["kind"], string> = {
  point: "Точка",
  line: "Линия",
  area: "Область",
  label: "Подпись",
};

interface PrimitivesDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Список примитивов активной карты. Клик по строке выбирает примитив
 * на холсте; чекбокс переключает видимость (через журнал, отменяется
 * Ctrl+Z). Порядок строк — порядок отрисовки.
 */
export default function PrimitivesDialog({ open, onClose }: PrimitivesDialogProps) {
  const map = useAppStore((s) => s.project.maps[s.activeMapId]);
  const project = useAppStore((s) => s.project);
  const activeMapId = useAppStore((s) => s.activeMapId);
  const mapName = useAppStore((s) => s.project.maps[s.activeMapId]?.name ?? "");
  const selectedIds = useAppStore((s) => s.selectedPrimitiveIds);
  const selectPrimitive = useAppStore((s) => s.selectPrimitive);
  const updatePrimitiveProps = useAppStore((s) => s.updatePrimitiveProps);
  const deleteSelectedPrimitives = useAppStore((s) => s.deleteSelectedPrimitives);
  const clearSelection = useAppStore((s) => s.clearSelection);

  if (!open || !map) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Примитивы карты «{mapName}»</h3>
        {map.primitives.length === 0 ? (
          <p>На этой карте пока нет примитивов — нарисуйте их инструментами на панели сверху.</p>
        ) : (
          <ul className="primitive-list">
            {[...map.primitives].reverse().map((p) => {
              const type = legendTypeById(project, p.typeId);
              return (
                <li
                  key={p.id}
                  className={`primitive-row${selectedIds.includes(p.id) ? " active" : ""}`}
                  onClick={() => {
                    selectPrimitive(p.id);
                    onClose();
                  }}
                  title="Выбрать на холсте"
                >
                  <input
                    type="checkbox"
                    checked={p.visible}
                    title={p.visible ? "Скрыть примитив" : "Показать примитив"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updatePrimitiveProps(activeMapId, p.id, { visible: e.target.checked })
                    }
                  />
                  <span className="legend-swatch" style={{ background: type?.color ?? "#666" }} />
                  <span className="primitive-kind">{KIND_NAME[p.kind]}</span>
                  <span className="primitive-name">
                    {p.kind === "label" && p.text.trim() ? p.text.trim() : p.name}
                  </span>
                  {p.locked && <span className="legend-hidden">заблокирован</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-buttons">
          {selectedIds.length > 0 && (
            <>
              <button className="danger" onClick={deleteSelectedPrimitives}>
                Удалить выбранные ({selectedIds.length})
              </button>
              <button onClick={clearSelection}>Снять выделение</button>
            </>
          )}
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
