import { canRedo, canUndo, HISTORY_LIMIT } from "../core/history";
import { useAppStore } from "../state/store";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("ru-RU", { hour12: false });
}

/**
 * Панель журнала изменений (в стиле History в Photoshop):
 * список действий, текущая запись выделена, клик возвращает проект
 * к соответствующему состоянию, для удалённых маркеров доступно
 * восстановление прямо из записи.
 */
export default function HistoryPanel() {
  const open = useAppStore((s) => s.historyPanelOpen);
  const history = useAppStore((s) => s.history);
  const maps = useAppStore((s) => s.project.maps);
  const jumpToHistory = useAppStore((s) => s.jumpToHistory);
  const undoChange = useAppStore((s) => s.undoChange);
  const redoChange = useAppStore((s) => s.redoChange);
  const restoreFromHistory = useAppStore((s) => s.restoreMarkerFromHistory);

  if (!open) return null;

  const undoAvailable = canUndo(history);
  const redoAvailable = canRedo(history);
  const futureCount = history.entries.length - 1 - history.position;

  return (
    <div className="history-panel">
      <div className="history-buttons">
        <button disabled={!undoAvailable} onClick={undoChange} title="Отменить (Ctrl+Z)">
          ← Отменить
        </button>
        <button disabled={!redoAvailable} onClick={redoChange} title="Повторить (Ctrl+Y)">
          Вернуть →
        </button>
      </div>

      {futureCount > 0 && (
        <div className="history-branch-note">
          Отменённые действия: {futureCount}. Новое действие перезапишет их.
        </div>
      )}

      <ul className="history-list">
        <li
          className={`history-row${history.position === -1 ? " current" : ""}`}
          onClick={() => jumpToHistory(-1)}
        >
          <span className="history-time">--:--:--</span>
          <span className="history-desc">Начало проекта</span>
        </li>
        {history.entries.map((entry, index) => {
          const isCurrent = index === history.position;
          const isFuture = index > history.position;
          const info = entry.restoreInfo;
          const sourceOk = info ? !!maps[info.sourceMapId] : false;
          const targetOk = info ? !!maps[info.entity.targetMapId] : false;
          const alreadyLive = info
            ? !!maps[info.sourceMapId]?.entities.some((e) => e.id === info.entity.id)
            : false;
          const canRestore =
            entry.operationType === "marker.deleted" && !!info && sourceOk && targetOk && !alreadyLive;
          const restoreReason = !info
            ? null
            : alreadyLive
              ? "Маркер уже восстановлен"
              : !sourceOk
                ? "Карта, на которой стоял маркер, удалена"
                : !targetOk
                  ? "Связанная карта удалена из проекта"
                  : "Вернуть маркер на карту";
          return (
            <li
              key={entry.id}
              className={`history-row${isCurrent ? " current" : ""}${isFuture ? " future" : ""}`}
              onClick={() => jumpToHistory(index)}
              title={entry.operationType}
            >
              <span className="history-time">{formatTime(entry.timestamp)}</span>
              <span className="history-desc">{entry.description}</span>
              {entry.operationType === "marker.deleted" && info && (
                <button
                  className="history-restore"
                  disabled={!canRestore}
                  title={restoreReason ?? ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreFromHistory(entry.id);
                  }}
                >
                  Восстановить маркер
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="history-footer">
        Хранится до {HISTORY_LIMIT} последних действий.
      </div>
    </div>
  );
}
