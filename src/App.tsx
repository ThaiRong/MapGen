import { useEffect } from "react";
import { useAppStore } from "./state/store";
import Toolbar from "./components/Toolbar";
import Breadcrumbs from "./components/Breadcrumbs";
import TreePanel from "./components/TreePanel";
import CanvasView from "./components/CanvasView";
import HistoryPanel from "./components/HistoryPanel";
import Inspector from "./components/Inspector";
import StatusBar from "./components/StatusBar";
import ConfirmDialog from "./components/ConfirmDialog";

export default function App() {
  const branchConfirm = useAppStore((s) => s.branchConfirm);
  const resolveBranchOverwrite = useAppStore((s) => s.resolveBranchOverwrite);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useAppStore.getState().redoChange();
        else useAppStore.getState().undoChange();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useAppStore.getState().redoChange();
        return;
      }
      if (!typing && (e.key === "Delete" || e.key === "Backspace")) {
        const { selectedEntityId, deleteSelectedMarker } = useAppStore.getState();
        if (selectedEntityId) {
          e.preventDefault();
          deleteSelectedMarker();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <Toolbar />
        <Breadcrumbs />
      </header>
      <div className="app-body">
        <TreePanel />
        <CanvasView />
        <HistoryPanel />
        <Inspector />
      </div>
      <StatusBar />
      <ConfirmDialog
        open={branchConfirm !== null}
        title="Перезаписать отменённые действия?"
        message={
          branchConfirm === null
            ? ""
            : `Вы вернулись к более раннему состоянию. Выполнение действия перезапишет отменённую ветвь истории (${branchConfirm.futureCount} ${plural(branchConfirm.futureCount)}). Это нельзя будет отменить. Продолжить?`
        }
        confirmLabel="Перезаписать и выполнить"
        danger
        onConfirm={() => resolveBranchOverwrite(true)}
        onCancel={() => resolveBranchOverwrite(false)}
      />
    </div>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "действие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "действия";
  return "действий";
}
