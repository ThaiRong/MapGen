import { create } from "zustand";
import {
  addLocation,
  createProject,
  deleteMap,
  deleteMarker,
  moveMarker,
  NEW_LOCATION_NAME,
  renameMap,
  renameMarker,
  renameProject,
  restoreMarker,
  restoreMarkerEntity,
  setMapScale,
  setMapView,
  ValidationError,
} from "../core/project";
import {
  createHistory,
  jumpTo,
  makeEntry,
  record,
  redo,
  undo,
  type EntryInput,
  type ProjectHistory,
} from "../core/history";
import type { EntityId, LocationLinkEntity, MapId, MapScale, MapView, Project } from "../core/types";
import { UserCancelledError } from "../storage/interface";
import { createStorage } from "../storage/tauri";

export type Tool = "select" | "add-location";

const storage = createStorage();

function sanitize(
  project: Project,
  activeMapId: MapId,
  selectedEntityId: EntityId | null,
) {
  const active = project.maps[activeMapId] ? activeMapId : project.rootMapId;
  let selected = selectedEntityId;
  if (selected) {
    const map = project.maps[active];
    if (!map || !map.entities.some((e) => e.id === selected)) selected = null;
  }
  return { activeMapId: active, selectedEntityId: selected };
}

function positionDescription(history: ProjectHistory): string {
  if (history.position < 0) return "начало проекта";
  return history.entries[history.position]?.description ?? "";
}

export interface AppState {
  project: Project;
  projectPath: string | null;
  activeMapId: MapId;
  selectedEntityId: EntityId | null;
  tool: Tool;
  history: ProjectHistory;
  /** Панель журнала изменений (1.5.2). */
  historyPanelOpen: boolean;
  /** Открытый диалог подтверждения перезаписи отменённой ветви. */
  branchConfirm: { futureCount: number } | null;
  /** Действие, ожидающее подтверждения перезаписи ветви истории. */
  pendingMutation: (() => void) | null;
  status: string;
  cursor: { x: number; y: number } | null;
  viewZoom: number;

  setStatus: (status: string) => void;
  setCursor: (cursor: { x: number; y: number } | null) => void;
  setViewZoom: (zoom: number) => void;
  toggleHistoryPanel: () => void;
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
  restoreMarkerFromHistory: (entryId: string) => void;
  deleteMapById: (mapId: MapId) => void;
  setScale: (mapId: MapId, scale: MapScale | undefined) => void;
  setView: (mapId: MapId, view: MapView) => void;
  renameProjectTitle: (title: string) => void;
  undoChange: () => void;
  redoChange: () => void;
  jumpToHistory: (index: number) => void;
  resolveBranchOverwrite: (accept: boolean) => void;
  saveProjectAs: () => Promise<void>;
  saveProject: () => Promise<void>;
  openProject: () => Promise<void>;
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Применяет новое состояние проекта и пишет запись в журнал. */
  const applyNow = (next: Project, meta: EntryInput, status?: string) => {
    const { project, activeMapId, selectedEntityId, history } = get();
    if (next === project) return;
    const entry = makeEntry(meta, next);
    const newHistory = record(history, entry);
    set({
      project: next,
      history: newHistory,
      ...sanitize(next, activeMapId, selectedEntityId),
      ...(status !== undefined ? { status } : null),
    });
  };

  /**
   * Действие, не меняющее проект, но значимое для журнала
   * (сохранение проекта). Запись получает снимок текущего состояния.
   */
  const recordOnly = (meta: EntryInput, status?: string) => {
    const { project, history } = get();
    const entry = makeEntry(meta, project);
    set({
      history: record(history, entry),
      ...(status !== undefined ? { status } : null),
    });
  };

  /**
   * Если пользователь вернулся назад по истории, будущая ветвь ещё
   * существует — новое действие перезапишет её. Спрашиваем подтверждение,
   * чтобы не терять отменённые изменения молча.
   */
  const withBranchGuard = (action: () => void) => {
    const { history } = get();
    const futureCount = history.entries.length - 1 - history.position;
    if (futureCount <= 0) {
      action();
      return;
    }
    set({
      branchConfirm: { futureCount },
      pendingMutation: action,
    });
  };

  const apply = (next: Project, meta: EntryInput, status?: string) => {
    if (next === get().project) return;
    withBranchGuard(() => applyNow(next, meta, status));
  };

  const initialProject = createProject();
  const initialHistory = record(
    createHistory(initialProject),
    makeEntry(
      { operationType: "project.created", description: `Проект «${initialProject.title}» создан` },
      initialProject,
    ),
  );

  return {
    project: initialProject,
    projectPath: null,
    activeMapId: initialProject.rootMapId,
    selectedEntityId: null,
    tool: "select",
    history: initialHistory,
    historyPanelOpen: false,
    branchConfirm: null,
    pendingMutation: null,
    status: "Готов к работе",
    cursor: null,
    viewZoom: 1,

    setStatus: (status) => set({ status }),
    setCursor: (cursor) => set({ cursor }),
    setViewZoom: (zoom) => {
      if (get().viewZoom !== zoom) set({ viewZoom: zoom });
    },
    toggleHistoryPanel: () => set({ historyPanelOpen: !get().historyPanelOpen }),

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
      const history = record(
        createHistory(project),
        makeEntry(
          { operationType: "project.created", description: `Проект «${project.title}» создан` },
          project,
        ),
      );
      set({
        project,
        projectPath: null,
        activeMapId: project.rootMapId,
        selectedEntityId: null,
        tool: "select",
        history,
        branchConfirm: null,
        status: "Создан новый проект",
      });
    },

    addLocationAt: (x, y) => {
      const { project, activeMapId } = get();
      const result = addLocation(project, activeMapId, x, y);
      if (result.project === project) return;
      withBranchGuard(() => {
        applyNow(
          result.project,
          {
            operationType: "marker.created",
            description: `Создана локация «${NEW_LOCATION_NAME}»`,
            mapId: activeMapId,
            entityId: result.entityId,
          },
          "Локация создана. Двойной клик по маркеру — вход внутрь",
        );
        set({ selectedEntityId: result.entityId, tool: "select" });
      });
    },

    moveMarker: (entityId, x, y) => {
      const { project, activeMapId } = get();
      const map = project.maps[activeMapId];
      const entity = map?.entities.find((e) => e.id === entityId);
      if (!entity) return;
      apply(
        moveMarker(project, activeMapId, entityId, x, y),
        {
          operationType: "marker.moved",
          description: `Маркер «${entity.label}» перемещён`,
          mapId: activeMapId,
          entityId,
        },
      );
    },

    renameMapById: (mapId, name) => {
      const { project } = get();
      const map = project.maps[mapId];
      if (!map) return;
      apply(
        renameMap(project, mapId, name),
        {
          operationType: "map.renamed",
          description: `Карта «${map.name}» переименована в «${name.trim() || map.name}»`,
          mapId,
        },
        "Карта переименована",
      );
    },

    renameSelectedMarker: (label) => {
      const { project, activeMapId, selectedEntityId } = get();
      if (!selectedEntityId) return;
      const map = project.maps[activeMapId];
      const entity = map?.entities.find((e) => e.id === selectedEntityId);
      if (!entity) return;
      apply(
        renameMarker(project, activeMapId, selectedEntityId, label),
        {
          operationType: "marker.renamed",
          description: `Маркер «${entity.label}» переименован в «${label.trim() || entity.label}»`,
          mapId: activeMapId,
          entityId: selectedEntityId,
        },
      );
    },

    deleteSelectedMarker: () => {
      const { project, activeMapId, selectedEntityId } = get();
      if (!selectedEntityId) return;
      const map = project.maps[activeMapId];
      const entity = map?.entities.find((e) => e.id === selectedEntityId);
      if (!entity) return;
      set({ selectedEntityId: null });
      apply(
        deleteMarker(project, activeMapId, selectedEntityId),
        {
          operationType: "marker.deleted",
          description: `Маркер «${entity.label}» удалён`,
          mapId: activeMapId,
          entityId: selectedEntityId,
          restoreInfo: { sourceMapId: activeMapId, entity: { ...entity } },
        },
        "Маркер удалён в архив. Карта осталась в дереве; восстановление — кнопка «Архив»",
      );
    },

    restoreArchivedMarker: (archivedEntityId) => {
      const { project, activeMapId } = get();
      try {
        const archived = project.markerArchive.find((a) => a.entity.id === archivedEntityId);
        const result = restoreMarker(project, archivedEntityId);
        const label = archived?.entity.label ?? "";
        const mapId = result.mapId;
        const entityId = result.entityId;
        withBranchGuard(() => {
          applyNow(
            result.project,
            {
              operationType: "marker.restored",
              description: `Маркер «${label}» восстановлен`,
              mapId,
              entityId,
            },
            "Маркер восстановлен на прежнем месте",
          );
          if (mapId === activeMapId) set({ selectedEntityId: entityId });
        });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось восстановить маркер" });
      }
    },

    restoreMarkerFromHistory: (entryId) => {
      const { project, activeMapId, history } = get();
      const entry = history.entries.find((e) => e.id === entryId);
      const info = entry?.restoreInfo;
      if (!info) {
        set({ status: "Запись не позволяет восстановить маркер" });
        return;
      }
      try {
        const result = restoreMarkerEntity(project, info.sourceMapId, info.entity);
        const mapId = info.sourceMapId;
        const entityId = info.entity.id;
        const label = info.entity.label;
        withBranchGuard(() => {
          applyNow(
            result.project,
            {
              operationType: "marker.restored",
              description: `Маркер «${label}» восстановлен`,
              mapId,
              entityId,
            },
            `Маркер «${label}» восстановлен из истории`,
          );
          if (mapId === activeMapId) set({ selectedEntityId: entityId });
        });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось восстановить маркер" });
      }
    },

    deleteMapById: (mapId) => {
      const { project } = get();
      const map = project.maps[mapId];
      if (!map) return;
      try {
        apply(
          deleteMap(project, mapId),
          { operationType: "map.deleted", description: `Карта «${map.name}» удалена`, mapId },
          "Карта удалена",
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось удалить карту" });
      }
    },

    setScale: (mapId, scale) => {
      const { project } = get();
      const map = project.maps[mapId];
      if (!map) return;
      apply(
        setMapScale(project, mapId, scale),
        {
          operationType: "map.scale",
          description: `Масштаб карты «${map.name}» обновлён`,
          mapId,
        },
        "Масштаб обновлён",
      );
    },

    // Вид — навигация: в журнал не пишем.
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
      const step = undo(history);
      if (!step) {
        set({ status: "Отменять нечего" });
        return;
      }
      if (step.project === project) return;
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId),
        status: `Отменено. Текущая запись: ${positionDescription(step.history)}`,
      });
    },

    redoChange: () => {
      const { project, history, activeMapId, selectedEntityId } = get();
      const step = redo(history);
      if (!step) {
        set({ status: "Повторять нечего" });
        return;
      }
      if (step.project === project) return;
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId),
        status: `Повторено. Текущая запись: ${positionDescription(step.history)}`,
      });
    },

    jumpToHistory: (index) => {
      const { project, history, activeMapId, selectedEntityId } = get();
      if (index === history.position) return;
      const step = jumpTo(history, index);
      if (step.project === project) {
        set({ history: step.history });
        return;
      }
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId),
        status: `Текущая запись: ${positionDescription(step.history)}`,
      });
    },

    resolveBranchOverwrite: (accept) => {
      const pending = get().pendingMutation;
      set({ branchConfirm: null, pendingMutation: null });
      if (accept && pending) {
        pending();
      } else if (!accept) {
        set({ status: "Действие отменено — отменённая ветвь истории сохранена" });
      }
    },

    saveProjectAs: async () => {
      const { project, history } = get();
      try {
        const path = await storage.saveToFile(project, history);
        set({ projectPath: path });
        withBranchGuard(() => {
          recordOnly(
            { operationType: "project.saved", description: `Проект «${project.title}» сохранён` },
            `Сохранено: ${path}`,
          );
        });
      } catch (e) {
        if (e instanceof UserCancelledError) return;
        set({ status: e instanceof Error ? `Ошибка сохранения: ${e.message}` : "Ошибка сохранения" });
      }
    },

    saveProject: async () => {
      const { project, projectPath, history } = get();
      try {
        const path = await storage.saveToFile(project, history, projectPath ?? undefined);
        set({ projectPath: path });
        withBranchGuard(() => {
          recordOnly(
            { operationType: "project.saved", description: `Проект «${project.title}» сохранён` },
            `Сохранено: ${path}`,
          );
        });
      } catch (e) {
        if (e instanceof UserCancelledError) return;
        set({ status: e instanceof Error ? `Ошибка сохранения: ${e.message}` : "Ошибка сохранения" });
      }
    },

    openProject: async () => {
      try {
        const { project, history: loadedHistory, path } = await storage.loadFromFile();
        const history = loadedHistory ?? (() => {
          const h = createHistory(project);
          return record(
            h,
            makeEntry(
              { operationType: "project.loaded", description: `Проект «${project.title}» загружен` },
              project,
            ),
          );
        })();
        const clean = sanitize(project, project.rootMapId, null);
        set({
          project,
          projectPath: path,
          history,
          ...clean,
          selectedEntityId: null,
          tool: "select",
          branchConfirm: null,
          status: loadedHistory
            ? `Проект загружен: ${path}`
            : `Проект загружен: ${path} (журнал начат заново)`,
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
      const { project, history: loadedHistory } = saved;
      const { activeMapId } = useAppStore.getState();
      const history = loadedHistory ?? (() => {
        const h = createHistory(project);
        return record(
          h,
          makeEntry(
            { operationType: "project.loaded", description: "Восстановлено автосохранение" },
            project,
          ),
        );
      })();
      useAppStore.setState({
        project,
        history,
        activeMapId: project.maps[activeMapId] ? activeMapId : project.rootMapId,
        status: loadedHistory
          ? `Восстановлено автосохранение: «${project.title}»`
          : `Восстановлено автосохранение: «${project.title}» (журнал начат заново)`,
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
    const { project, history } = useAppStore.getState();
    storage.saveAutosave(project, history).catch(() => {
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
