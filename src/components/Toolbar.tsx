import { useState } from "react";
import { useAppStore } from "../state/store";
import ArchiveDialog from "./ArchiveDialog";
import ConfirmDialog from "./ConfirmDialog";

export default function Toolbar() {
  const projectTitle = useAppStore((s) => s.project.title);
  const canUndo = useAppStore((s) => s.history.position >= 0);
  const canRedo = useAppStore(
    (s) => s.history.position < s.history.entries.length - 1,
  );
  const archiveCount = useAppStore((s) => s.project.markerArchive.length);
  const historyPanelOpen = useAppStore((s) => s.historyPanelOpen);
  const tool = useAppStore((s) => s.tool);
  const [confirmNew, setConfirmNew] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const store = useAppStore.getState();

  return (
    <div className="toolbar">
      <button
        onClick={() => {
          const s = useAppStore.getState();
          if (s.projectPath || s.history.entries.length > 0) setConfirmNew(true);
          else s.newProject();
        }}
      >
        Новый проект
      </button>
      <button onClick={() => void store.openProject()}>Открыть…</button>
      <button onClick={() => void store.saveProject()}>Сохранить</button>
      <button onClick={() => void store.saveProjectAs()}>Сохранить как…</button>

      <div className="sep" />
      <button disabled={!canUndo} onClick={() => store.undoChange()} title="Отменить (Ctrl+Z)">
        ↶ Отмена
      </button>
      <button disabled={!canRedo} onClick={() => store.redoChange()} title="Повторить (Ctrl+Y)">
        ↷ Повтор
      </button>
      <button
        onClick={() => setArchiveOpen(true)}
        disabled={archiveCount === 0}
        title="Архив удалённых маркеров: просмотр и восстановление"
      >
        Архив ({archiveCount})
      </button>
      <button
        className={historyPanelOpen ? "active" : undefined}
        onClick={() => store.toggleHistoryPanel()}
        title="Журнал изменений проекта"
      >
        История
      </button>

      <div className="sep" />
      <button
        className={tool === "select" ? "active" : undefined}
        onClick={() => store.setTool("select")}
      >
        Выбор
      </button>
      <button
        className={tool === "add-location" ? "active" : undefined}
        onClick={() => store.setTool("add-location")}
      >
        + Добавить локацию
      </button>

      <input
        className="project-title"
        type="text"
        defaultValue={projectTitle}
        key={projectTitle}
        title="Название проекта"
        onBlur={(e) => store.renameProjectTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />

      <ConfirmDialog
        open={confirmNew}
        title="Новый проект"
        message="Текущий проект будет закрыт. Если он не сохранён, изменения останутся только в автосохранении. Продолжить?"
        confirmLabel="Создать новый"
        danger
        onConfirm={() => {
          setConfirmNew(false);
          store.newProject();
        }}
        onCancel={() => setConfirmNew(false)}
      />
      <ArchiveDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} />
    </div>
  );
}
