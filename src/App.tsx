import { useEffect } from "react";
import { useAppStore } from "./state/store";
import Toolbar from "./components/Toolbar";
import Breadcrumbs from "./components/Breadcrumbs";
import TreePanel from "./components/TreePanel";
import CanvasView from "./components/CanvasView";
import Inspector from "./components/Inspector";
import StatusBar from "./components/StatusBar";

export default function App() {
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
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}
