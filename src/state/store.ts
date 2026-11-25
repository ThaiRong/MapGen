import { create } from "zustand";
import {
  addLocation,
  createProject,
  deleteMap,
  deleteMarker,
  moveMarker,
  renameMap,
  renameMarker,
  renameProject,
  restoreMarker,
  setMapScale,
  setMapView,
  ValidationError,
} from "../core/project";
import { commit, emptyHistory, redo, undo, type History } from "../core/history";
import type { EntityId, LocationLinkEntity, MapId, MapScale, MapView, Project } from "../core/types";
import { UserCancelledError } from "../storage/interface";
import { createStorage } from "../storage/tauri";

export type Tool = "select" | "add-location";

const storage = createStorage();

function sanitize(project: Project, activeMapId: MapId, selectedEntityId: EntityId | null) {
  const active = project.maps[activeMapId] ? activeMapId : project.rootMapId;
  let selected = selectedEntityId;
  if (selected) {
    const map = project.maps[active];
    if (!map || !map.entities.some((e) => e.id === selected)) selected = null;
  }
  return { activeMapId: active, selectedEntityId: selected };
}

export interface AppState {
  project: Project;
  projectPath: string | null;
  activeMapId: MapId;
  selectedEntityId: EntityId | null;
  tool: Tool;
  history: History;
  status: string;
  cursor: { x: number; y: number } | null;
  viewZoom: number;

  setStatus: (status: string) => void;
  setCursor: (cursor: { x: number; y: number } | null) => void;
  setViewZoom: (zoom: number) => void;
  setTool: (tool: Tool) => void;
  selectEntity: (id: EntityId | null) => void;
  openMap: (id: MapId) => void;
  openParent: () => void;
  newProject: () => void;
  addLocationAt: (x: number, y: number) => void;
  moveMarker: (entityId: EntityId, x: number, y: number) => void;
  renameMapById: (mapId: MapId, name: string) => void;
  renameSelectedMarker: (label: string) => void;
  deleteSelectedMarker: () => void;
  restoreArchivedMarker: (archivedEntityId: EntityId) => void;
  deleteMapById: (mapId: MapId) => void;
  setScale: (mapId: MapId, scale: MapScale | undefined) => void;
  setView: (mapId: MapId, view: MapView) => void;
  renameProjectTitle: (title: string) => void;
  undoChange: () => void;
  redoChange: () => void;
  saveProjectAs: () => Promise<void>;
  saveProject: () => Promise<void>;
  openProject: () => Promise<void>;
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Применяет новую версию проекта с записью в историю отмен. */
  const apply = (next: Project, status?: string) => {
    const { project, activeMapId, selectedEntityId, history } = get();
    if (next === project) return;
    const clean = sanitize(next, activeMapId, selectedEntityId);
    set({
      project: next,
      history: commit(history, project),
      ...clean,
      ...(status !== undefined ? { status } : null),
    });
  };

  const initialProject = createProject();

  return {
    project: initialProject,
    projectPath: null,
    activeMapId: initialProject.rootMapId,
    selectedEntityId: null,
    tool: "select",
    history: emptyHistory(),
    status: "Готов к работе",
    cursor: null,
    viewZoom: 1,

    setStatus: (status) => set({ status }),
    setCursor: (cursor) => set({ cursor }),
    setViewZoom: (zoom) => {
      if (get().viewZoom !== zoom) set({ viewZoom: zoom });
    },

    setTool: (tool) => {
      set({ tool });
      set({ status: tool === "add-location" ? "Кликните по холсту, чтобы поставить локацию" : "Режим выбора" });
    },

    selectEntity: (id) => set({ selectedEntityId: id }),

    openMap: (id) => {
      const { project } = get();
      if (!project.maps[id]) return;
      set({ activeMapId: id, selectedEntityId: null, status: `Открыта карта «${project.maps[id].name}»` });
    },

    openParent: () => {
      const { project, activeMapId } = get();
      const parent = project.maps[activeMapId]?.parentId;
      if (parent) get().openMap(parent);
    },

    newProject: () => {
      const project = createProject();
      set({
        project,
        projectPath: null,
        activeMapId: project.rootMapId,
        selectedEntityId: null,
        tool: "select",
        history: emptyHistory(),
        status: "Создан новый проект",
      });
    },

    addLocationAt: (x, y) => {
      const { project, activeMapId } = get();
      const result = addLocation(project, activeMapId, x, y);
      const { history } = get();
      set({
        project: result.project,
        history: commit(history, project),
        selectedEntityId: result.entityId,
        tool: "select",
        status: "Локация создана. Двойной клик по маркеру — вход внутрь",
      });
    },

    moveMarker: (entityId, x, y) => {
      const { project, activeMapId } = get();
      apply(moveMarker(project, activeMapId, entityId, x, y));
    },

    renameMapById: (mapId, name) => {
      const { project } = get();
      apply(renameMap(project, mapId, name), "Карта переименована");
    },

    renameSelectedMarker: (label) => {
      const { project, activeMapId, selectedEntityId } = get();
      if (!selectedEntityId) return;
      apply(renameMarker(project, activeMapId, selectedEntityId, label));
    },

    deleteSelectedMarker: () => {
      const { project, activeMapId, selectedEntityId } = get();
      if (!selectedEntityId) return;
      set({ selectedEntityId: null });
      apply(
        deleteMarker(project, activeMapId, selectedEntityId),
        "Маркер удалён в архив. Карта осталась в дереве; восстановление — кнопка «Архив»",
      );
    },

    restoreArchivedMarker: (archivedEntityId) => {
      const { project, activeMapId } = get();
      try {
        const result = restoreMarker(project, archivedEntityId);
        apply(result.project, "Маркер восстановлен на прежнем месте");
        if (result.mapId === activeMapId) set({ selectedEntityId: result.entityId });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось восстановить маркер" });
      }
    },

    deleteMapById: (mapId) => {
      const { project } = get();
      try {
        apply(deleteMap(project, mapId), "Карта удалена");
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось удалить карту" });
      }
    },

    setScale: (mapId, scale) => {
      const { project } = get();
      apply(setMapScale(project, mapId, scale), "Масштаб обновлён");
    },

    // Вид — навигация: в историю не пишем.
    setView: (mapId, view) => {
      const { project } = get();
      const next = setMapView(project, mapId, view);
      if (next !== project) set({ project: next });
    },

    renameProjectTitle: (title) => {
      const { project } = get();
      const next = renameProject(project, title);
      if (next !== project) {
        set({ project: next, status: "Проект переименован" });
      }
    },

    undoChange: () => {
      const { project, history, activeMapId, selectedEntityId } = get();
      const step = undo(history, project);
      if (!step.project) {
        set({ status: "Отменять нечего" });
        return;
      }
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId),
        status: "Отменено",
      });
    },

    redoChange: () => {
      const { project, history, activeMapId, selectedEntityId } = get();
      const step = redo(history, project);
      if (!step.project) {
        set({ status: "Повторять нечего" });
        return;
      }
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId),
        status: "Повторено",
      });
    },

    saveProjectAs: async () => {
      const { project } = get();
      try {
        const path = await storage.saveToFile(project);
        set({ projectPath: path, status: `Сохранено: ${path}` });
      } catch (e) {
        if (e instanceof UserCancelledError) return;
        set({ status: e instanceof Error ? `Ошибка сохранения: ${e.message}` : "Ошибка сохранения" });
      }
    },

    saveProject: async () => {
      const { project, projectPath } = get();
      try {
        const path = await storage.saveToFile(project, projectPath ?? undefined);
        set({ projectPath: path, status: `Сохранено: ${path}` });
      } catch (e) {
        if (e instanceof UserCancelledError) return;
        set({ status: e instanceof Error ? `Ошибка сохранения: ${e.message}` : "Ошибка сохранения" });
      }
    },

    openProject: async () => {
      try {
        const { project, path } = await storage.loadFromFile();
        const clean = sanitize(project, project.rootMapId, null);
        set({
          project,
          projectPath: path,
          ...clean,
          selectedEntityId: null,
          tool: "select",
          history: emptyHistory(),
          status: `Проект загружен: ${path}`,
        });
      } catch (e) {
        if (e instanceof UserCancelledError) return;
        const message =
          e instanceof ValidationError
            ? e.message
            : e instanceof Error
              ? `Не удалось открыть проект: ${e.message}`
              : "Не удалось открыть проект";
        set({ status: message });
      }
    },
  };
});

/** Инициализация: пробуем поднять автосохранение, иначе — новый проект. */
export async function initApp(): Promise<void> {
  try {
    const saved = await storage.loadAutosave();
    if (saved) {
      const { activeMapId } = useAppStore.getState();
      const root = saved.maps[saved.rootMapId];
      useAppStore.setState({
        project: saved,
        activeMapId: saved.maps[activeMapId] ? activeMapId : saved.rootMapId,
        status: root ? `Восстановлено автосохранение: «${saved.title}»` : "Готов к работе",
      });
      return;
    }
  } catch {
    // Повреждённое автосохранение не должно мешать запуску.
  }
  useAppStore.getState().newProject();
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

useAppStore.subscribe((state, prev) => {
  if (state.project === prev.project) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const { project } = useAppStore.getState();
    storage.saveAutosave(project).catch(() => {
      useAppStore.setState({ status: "Ошибка автосохранения" });
    });
  }, 800);
});

export function useSelectedMarker(): LocationLinkEntity | null {
  return useAppStore((s) => {
    if (!s.selectedEntityId) return null;
    const map = s.project.maps[s.activeMapId];
    if (!map) return null;
    const entity = map.entities.find((e) => e.id === s.selectedEntityId);
    return entity && entity.kind === "location-link" ? entity : null;
  });
}
