import { useAppStore } from "../state/store";

interface ArchiveDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Архив удалённых маркеров. Восстановление возвращает маркер
 * на прежние координаты и вновь связывает с целевой картой.
 * Записи с удалённой целевой или исходной картой помечаются
 * и не восстанавливаются — с причиной, понятной пользователю.
 */
export default function ArchiveDialog({ open, onClose }: ArchiveDialogProps) {
  const archive = useAppStore((s) => s.project.markerArchive);
  const maps = useAppStore((s) => s.project.maps);
  const restore = useAppStore((s) => s.restoreArchivedMarker);

  if (!open) return null;

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
                  <button
                    disabled={reason !== null}
                    title={reason ?? "Вернуть маркер на прежнее место"}
                    onClick={() => restore(entry.entity.id)}
                  >
                    Восстановить
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="modal-buttons">
          <button onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
