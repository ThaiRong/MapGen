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
  const restorePrimitiveFromHistory = useAppStore((s) => s.restorePrimitiveFromHistory);

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
          const isMarkerRestore = entry.operationType === "marker.deleted" && info?.kind === "marker";
          const markerInfo = isMarkerRestore && info.kind === "marker" ? info : null;
          const sourceOk = markerInfo ? !!maps[markerInfo.sourceMapId] : false;
          const targetOk = markerInfo ? !!maps[markerInfo.entity.targetMapId] : false;
          const alreadyLive = markerInfo
            ? !!maps[markerInfo.sourceMapId]?.entities.some((e) => e.id === markerInfo.entity.id)
            : false;
          const canRestore = isMarkerRestore && sourceOk && targetOk && !alreadyLive;
          const restoreReason = !markerInfo
            ? null
            : alreadyLive
              ? "Маркер уже восстановлен"
              : !sourceOk
                ? "Карта, на которой стоял маркер, удалена"
                : !targetOk
                  ? "Связанная карта удалена из проекта"
                  : "Вернуть маркер на карту";
          const primInfo =
            entry.operationType === "primitive.deleted" && info?.kind === "primitive" ? info : null;
          const primLive = primInfo
            ? !!maps[primInfo.mapId]?.primitives.some((p) => p.id === primInfo.primitive.id)
            : false;
          const primMapOk = primInfo ? !!maps[primInfo.mapId] : false;
          const primCanRestore = primInfo !== null && primMapOk && !primLive;
          const primReason = !primInfo
            ? null
            : primLive
              ? "Примитив уже восстановлен"
              : !primMapOk
                ? "Карта, на которой был примитив, удалена"
                : "Вернуть примитив на карту";
          return (
            <li
              key={entry.id}
              className={`history-row${isCurrent ? " current" : ""}${isFuture ? " future" : ""}`}
              onClick={() => jumpToHistory(index)}
              title={entry.operationType}
            >
              <span className="history-time">{formatTime(entry.timestamp)}</span>
              <span className="history-desc">{entry.description}</span>
              {markerInfo && (
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
              {primInfo && (
                <button
                  className="history-restore"
                  disabled={!primCanRestore}
                  title={primReason ?? ""}
                  onClick={(e) => {
                    e.stopPropagation();
                    restorePrimitiveFromHistory(entry.id);
                  }}
                >
                  Восстановить примитив
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
