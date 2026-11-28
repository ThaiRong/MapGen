import { useState } from "react";
import { useAppStore, type Tool } from "../state/store";
import ArchiveDialog from "./ArchiveDialog";
import PrimitivesDialog from "./PrimitivesDialog";
import ProfilesDialog from "./ProfilesDialog";
import ConfirmDialog from "./ConfirmDialog";

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: "select", label: "Выбор", title: "Выбор и перемещение объектов; рамка — мультивыделение; Shift+клик — добавить к выбору; Esc — снять выделение" },
  { id: "point", label: "Точка", title: "Клик по холсту ставит точку" },
  { id: "line", label: "Линия", title: "Клики ставят точки линии; Enter, двойной клик или Esc" },
  { id: "area", label: "Область", title: "Клики ставят вершины полигона; Enter, двойной клик, клик по первой вершине или Esc" },
  { id: "pen", label: "Перо", title: "Свободное рисование линии (как в Paint): зажмите и ведите; Esc — отменить" },
  { id: "label", label: "Подпись", title: "Клик по холсту открывает поле текста подписи" },
  { id: "add-location", label: "Локация", title: "Клик по холсту создаёт маркер и дочернюю карту" },
  { id: "fog", label: "Туман", title: "Кисть тумана войны: раскрыть/скрыть области карты по категориям" },
  { id: "delete", label: "Удаление", title: "Клик по объекту удаляет его" },
];

export default function Toolbar() {
  const projectTitle = useAppStore((s) => s.project.title);
  const canUndo = useAppStore((s) => s.history.position >= 0);
  const canRedo = useAppStore(
    (s) => s.history.position < s.history.entries.length - 1,
  );
  const archiveCount = useAppStore((s) => s.project.markerArchive.length);
  const primitiveCount = useAppStore(
    (s) => s.project.maps[s.activeMapId]?.primitives.length ?? 0,
  );
  const canPaste = useAppStore((s) => s.clipboard !== null);
  const historyPanelOpen = useAppStore((s) => s.historyPanelOpen);
  const tool = useAppStore((s) => s.tool);
  const [confirmNew, setConfirmNew] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [primitivesOpen, setPrimitivesOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);

  const store = useAppStore.getState();

  return (
    <div className="toolbar">
      <div className="toolbar-row">
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
          onClick={() => setPrimitivesOpen(true)}
          disabled={primitiveCount === 0}
          title="Список примитивов активной карты: выбор и видимость"
        >
          Примитивы ({primitiveCount})
        </button>
        <button
          onClick={() => store.pastePrimitive()}
          disabled={!canPaste}
          title="Вставить копию примитива (Ctrl+V)"
        >
          Вставить
        </button>
        <button
          className={historyPanelOpen ? "active" : undefined}
          onClick={() => store.toggleHistoryPanel()}
          title="Журнал изменений проекта"
        >
          История
        </button>
        <button onClick={() => setProfilesOpen(true)} title="Библиотека и редактор профилей сеттинга">
          Профили
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
      </div>

      <div className="toolbar-row">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? "active" : undefined}
            title={t.title}
            onClick={() => store.setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
      <PrimitivesDialog open={primitivesOpen} onClose={() => setPrimitivesOpen(false)} />
      <ProfilesDialog open={profilesOpen} onClose={() => setProfilesOpen(false)} />
    </div>
  );
}
