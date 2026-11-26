import { useEffect } from "react";
import { useAppStore } from "./state/store";
import Toolbar from "./components/Toolbar";
import Breadcrumbs from "./components/Breadcrumbs";
import TreePanel from "./components/TreePanel";
import LegendPanel from "./components/LegendPanel";
import CanvasView from "./components/CanvasView";
import HistoryPanel from "./components/HistoryPanel";
import Inspector from "./components/Inspector";
import GenerationPanel from "./components/GenerationPanel";
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
          target.tagName === "SELECT" ||
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
      if (typing) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const s = useAppStore.getState();
        if (s.selectedPrimitiveIds.length === 1) {
          e.preventDefault();
          s.copySelectedPrimitive();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        useAppStore.getState().pastePrimitive();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        const s = useAppStore.getState();
        if (s.selectedPrimitiveIds.length === 1) {
          e.preventDefault();
          s.duplicateSelectedPrimitive();
        }
        return;
      }

      if (!e.ctrlKey && !e.metaKey && (e.key === "+" || e.key === "=")) {
        const s = useAppStore.getState();
        if (s.selectedPrimitiveIds.length === 1) {
          const map = s.project.maps[s.activeMapId];
          const p = map?.primitives.find((x) => x.id === s.selectedPrimitiveIds[0]);
          if (p?.kind === "label") {
            e.preventDefault();
            s.adjustLabelFontSize(p.id, 2);
          }
        }
        return;
      }
      if (!e.ctrlKey && !e.metaKey && (e.key === "-" || e.key === "_")) {
        const s = useAppStore.getState();
        if (s.selectedPrimitiveIds.length === 1) {
          const map = s.project.maps[s.activeMapId];
          const p = map?.primitives.find((x) => x.id === s.selectedPrimitiveIds[0]);
          if (p?.kind === "label") {
            e.preventDefault();
            s.adjustLabelFontSize(p.id, -2);
          }
        }
        return;
      }

      if (e.key === "Enter") {
        const s = useAppStore.getState();
        if (s.drawingDraft) {
          e.preventDefault();
          s.finishDrawing();
        }
        return;
      }
      if (e.key === "Escape") {
        const s = useAppStore.getState();
        if (s.generationBoundsPick) {
          e.preventDefault();
          s.cancelGenerationBoundsPick();
          return;
        }
        if (s.labelDraft) {
          e.preventDefault();
          s.cancelLabelDraft();
          return;
        }
        if (s.drawingDraft) {
          e.preventDefault();
          s.cancelDrawing();
          return;
        }
        if (s.selectedTypeId) {
          e.preventDefault();
          s.selectLegendType(null);
          return;
        }
        if (s.selectedEntityId || s.selectedPrimitiveIds.length > 0) {
          e.preventDefault();
          s.clearSelection();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const s = useAppStore.getState();
        if (s.selectedPrimitiveIds.length > 0) {
          e.preventDefault();
          s.deleteSelectedPrimitives();
          return;
        }
        if (s.selectedEntityId) {
          e.preventDefault();
          s.deleteSelectedMarker();
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
        <div className="left-column">
          <TreePanel />
          <LegendPanel />
        </div>
        <CanvasView />
        <HistoryPanel />
        <Inspector />
        <GenerationPanel />
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
