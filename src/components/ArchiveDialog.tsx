import { useState } from "react";
import { useAppStore } from "../state/store";
import ConfirmDialog from "./ConfirmDialog";

interface ArchiveDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Архив удалённых маркеров. Восстановление возвращает маркер
 * на прежние координаты и вновь связывает с целевой картой.
 * Записи можно удалять по одной или очистить архив целиком —
 * маркер при этом не возвращается на карту.
 */
export default function ArchiveDialog({ open, onClose }: ArchiveDialogProps) {
  const archive = useAppStore((s) => s.project.markerArchive);
  const maps = useAppStore((s) => s.project.maps);
  const restore = useAppStore((s) => s.restoreArchivedMarker);
  const deleteEntry = useAppStore((s) => s.deleteArchivedMarkerById);
  const clearArchive = useAppStore((s) => s.clearArchive);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (!open) return null;

  const deleteCandidate = archive.find((a) => a.entity.id === confirmDeleteId) ?? null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Архив удалённых маркеров</h3>
        {archive.length === 0 ? (
          <p>
            Архив пуст. Удалённые маркеры сохраняются здесь: их можно вернуть на прежнее
            место со связью на прежнюю карту.
          </p>
        ) : (
          <ul className="archive-list">
            {archive.map((entry) => {
              const sourceName = maps[entry.sourceMapId]?.name;
              const targetName = maps[entry.entity.targetMapId]?.name;
              const sourceOk = sourceName !== undefined;
              const targetOk = targetName !== undefined;
              const reason = !sourceOk
                ? "Карта, на которой стоял маркер, удалена"
                : !targetOk
                  ? "Связанная карта удалена из проекта"
                  : null;
              return (
                <li key={entry.entity.id}>
                  <div className="archive-info">
                    <span className="archive-label">{entry.entity.label}</span>
                    <span className="archive-meta">
                      с «{sourceName ?? "удалённой карты"}» → в «{targetName ?? "удалённую карту"}»
                      · координаты ({Math.round(entry.entity.x)}, {Math.round(entry.entity.y)})
                    </span>
                    {reason && <span className="archive-warn">{reason}</span>}
                  </div>
                  <div className="archive-actions">
                    <button
                      disabled={reason !== null}
                      title={reason ?? "Вернуть маркер на прежнее место"}
                      onClick={() => restore(entry.entity.id)}
                    >
                      Восстановить
                    </button>
                    <button
                      className="danger"
                      title="Удалить запись из архива (маркер на карту не вернётся)"
                      onClick={() => setConfirmDeleteId(entry.entity.id)}
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-buttons">
          {archive.length > 0 && (
            <button className="danger" onClick={() => setConfirmClear(true)}>
              Очистить архив
            </button>
          )}
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Удалить запись из архива?"
        message={`Запись «${deleteCandidate?.entity.label ?? ""}» будет удалена без восстановления маркера. Если этот маркер удалялся недавно, его всё ещё можно вернуть через панель «История». Действие можно отменить через Ctrl+Z.`}
        confirmLabel="Удалить запись"
        danger
        onConfirm={() => {
          if (deleteCandidate) deleteEntry(deleteCandidate.entity.id);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Очистить архив?"
        message={`Все ${archive.length} записей архива будут удалены без восстановления маркеров. Действие можно отменить через Ctrl+Z.`}
        confirmLabel="Очистить архив"
        danger
        onConfirm={() => {
          setConfirmClear(false);
          clearArchive();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
