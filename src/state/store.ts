import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  addLegendType,
  addLocation,
  addPrimitive,
  applyGenerationToMap,
  clearMarkerArchive,
  createAreaPrimitive,
  createLabelPrimitive,
  createLinePrimitive,
  createPointPrimitive,
  createProject,
  deleteArchivedMarker,
  deleteLegendType,
  deleteMap,
  deleteMarker,
  deletePrimitive,
  deletePrimitives,
  fallbackTypeForKind,
  findPrimitive,
  insertPrimitiveCopy,
  legendTypeById,
  moveMarker,
  movePrimitive,
  movePrimitives,
  movePrimitiveVertex,
  insertPrimitiveVertex,
  NEW_LOCATION_NAME,
  renameMap,
  renameMarker,
  renameProject,
  restoreMarker,
  restoreMarkerFromRecord,
  restorePrimitiveToMap,
  rotatePrimitive,
  setMapScale,
  setMapView,
  updateLegendType,
  updatePrimitive,
  ValidationError,
  type LegendTypePatch,
  type PrimitivePatch,
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
import type {
  EntityId,
  GenerationSpec,
  LegendShape,
  LocationLinkEntity,
  MapId,
  MapScale,
  MapView,
  Primitive,
  Project,
  Vec2,
} from "../core/types";
import { UserCancelledError } from "../storage/interface";
import { createStorage } from "../storage/tauri";

export type Tool =
  | "select"
  | "add-location"
  | "point"
  | "line"
  | "area"
  | "pen"
  | "label"
  | "delete";

export interface DrawingDraft {
  kind: "line" | "area" | "pen";
  points: Vec2[];
}

export interface LabelDraft {
  x: number;
  y: number;
}

const storage = createStorage();

function sanitize(
  project: Project,
  activeMapId: MapId,
  selectedEntityId: EntityId | null,
  selectedPrimitiveIds: EntityId[],
) {
  const active = project.maps[activeMapId] ? activeMapId : project.rootMapId;
  let selected = selectedEntityId;
  if (selected) {
    const map = project.maps[active];
    if (!map || !map.entities.some((e) => e.id === selected)) selected = null;
  }
  let selectedPrimitives = selectedPrimitiveIds;
  if (selectedPrimitives.length > 0) {
    const map = project.maps[active];
    if (!map) {
      selectedPrimitives = [];
    } else {
      selectedPrimitives = selectedPrimitives.filter((id) =>
        map.primitives.some((p) => p.id === id),
      );
    }
  }
  return { activeMapId: active, selectedEntityId: selected, selectedPrimitiveIds: selectedPrimitives };
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
  /** Выбранные примитивы (мультивыделение рамкой или shift+клик). */
  selectedPrimitiveIds: EntityId[];
  /** Копия примитива в сессионном буфере (Ctrl+C / Ctrl+V). */
  clipboard: Primitive | null;
  /** Счётчик вставок: каждая следующая копия смещается дальше. */
  pasteCount: number;
  /** Живой предпросмотр генерации (не пишется в проект и историю). */
  generationPreview: {
    primitives: Primitive[];
    stats: { areas: number; lines: number; points: number; labels: number; vertices: number };
    warnings: string[];
  } | null;
  generationCalculating: boolean;
  /** Текущий вид холста — для области генерации «Видимая область». */
  generationViewport: { centerX: number; centerY: number; zoom: number; w: number; h: number } | null;
  /** Режим одноразового задания рамки области генерации на холсте. */
  generationBoundsPick: boolean;
  /** Рамка области генерации, заданная на холсте (режим «Выделенный прямоугольник»). */
  generationBoundsRect: { x: number; y: number; width: number; height: number } | null;
  tool: Tool;
  /** Черновик рисуемой линии/области (ветвь, предпросмотр на холсте). */
  drawingDraft: DrawingDraft | null;
  /** Позиция inline-поля ввода подписи. */
  labelDraft: LabelDraft | null;
  /** Выбранный в легенде тип — используется инструментами рисования. */
  selectedTypeId: string | null;
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
  selectPrimitive: (id: EntityId | null) => void;
  selectPrimitives: (ids: EntityId[]) => void;
  togglePrimitiveSelection: (id: EntityId) => void;
  clearSelection: () => void;
  copySelectedPrimitive: () => void;
  pastePrimitive: () => void;
  duplicateSelectedPrimitive: () => void;
  setGenerationPreview: (preview: AppState["generationPreview"]) => void;
  setGenerationCalculating: (v: boolean) => void;
  setGenerationViewport: (v: NonNullable<AppState["generationViewport"]>) => void;
  startGenerationBoundsPick: () => void;
  cancelGenerationBoundsPick: () => void;
  setGenerationBoundsRect: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  applyGeneration: (spec: GenerationSpec) => void;
  regenerateGeneration: () => void;
  openMap: (id: MapId) => void;
  openParent: () => void;
  newProject: () => void;
  addLocationAt: (x: number, y: number) => void;
  addPointPrimitiveAt: (x: number, y: number) => void;
  startLabelDraft: (x: number, y: number) => void;
  cancelLabelDraft: () => void;
  confirmLabelDraft: (text: string) => void;
  drawingAddPoint: (x: number, y: number) => void;
  startPenStroke: (x: number, y: number) => void;
  penAddPoint: (x: number, y: number) => void;
  finishDrawing: () => void;
  cancelDrawing: () => void;
  movePrimitiveVertexBy: (primitiveId: EntityId, vertexIndex: number, x: number, y: number) => void;
  insertVertexInto: (primitiveId: EntityId, segmentIndex: number, point: Vec2) => void;
  movePrimitiveBy: (primitiveId: EntityId, dx: number, dy: number) => void;
  moveSelectedPrimitives: (dx: number, dy: number) => void;
  rotatePrimitiveBy: (primitiveId: EntityId, angleRad: number) => void;
  adjustLabelFontSize: (primitiveId: EntityId, delta: number) => void;
  updatePrimitiveProps: (mapId: MapId, primitiveId: EntityId, patch: PrimitivePatch) => void;
  deletePrimitiveById: (mapId: MapId, primitiveId: EntityId) => void;
  deleteSelectedPrimitives: () => void;
  restorePrimitiveFromHistory: (entryId: string) => void;
  addLegendTypeFor: (shape: LegendShape) => void;
  updateLegendTypeProps: (typeId: string, patch: LegendTypePatch) => void;
  deleteLegendTypeById: (typeId: string) => void;
  selectLegendType: (typeId: string | null) => void;
  moveMarker: (entityId: EntityId, x: number, y: number) => void;
  renameMapById: (mapId: MapId, name: string) => void;
  renameSelectedMarker: (label: string) => void;
  deleteSelectedMarker: () => void;
  deleteMarkerAt: (mapId: MapId, entityId: EntityId) => void;
  restoreArchivedMarker: (archivedEntityId: EntityId) => void;
  deleteArchivedMarkerById: (archivedEntityId: EntityId) => void;
  clearArchive: () => void;
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
    const { project, activeMapId, selectedEntityId, selectedPrimitiveIds, history } = get();
    if (next === project) return;
    const entry = makeEntry(meta, next);
    const newHistory = record(history, entry);
    set({
      project: next,
      history: newHistory,
      ...sanitize(next, activeMapId, selectedEntityId, selectedPrimitiveIds),
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

  /** Тип легенды для рисования: выбранный, если форма совпадает, иначе фолбэк. */
  const activeTypeForShape = (shape: LegendShape) => {
    const { project, selectedTypeId } = get();
    const selected = selectedTypeId ? legendTypeById(project, selectedTypeId) : undefined;
    return selected && selected.shape === shape
      ? selected
      : fallbackTypeForKind(project, shape);
  };

  const PRIMITIVE_KIND_NOUN: Record<string, string> = {
    point: "точка",
    line: "линия",
    area: "область",
    label: "подпись",
  };

  function displayNameOf(p: Primitive): string {
    return p.kind === "label" && p.text.trim() ? p.text.trim() : p.name;
  }

  /** Удаление маркера с записью в журнал и архив (общий путь). */
  const deleteMarkerWithHistory = (mapId: MapId, entityId: EntityId) => {
    const { project } = get();
    const map = project.maps[mapId];
    const entity = map?.entities.find((e) => e.id === entityId);
    if (!entity) return;
    const snapshot = { ...entity };
    withBranchGuard(() => {
      applyNow(
        deleteMarker(project, mapId, entityId),
        {
          operationType: "marker.deleted",
          description: `Маркер «${entity.label}» удалён`,
          mapId,
          entityId,
          restoreInfo: { kind: "marker", sourceMapId: mapId, entity: snapshot },
        },
        "Маркер удалён в архив. Карта осталась в дереве; восстановление — кнопка «Архив»",
      );
      set({ selectedEntityId: null });
    });
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
    selectedPrimitiveIds: [],
    clipboard: null,
    pasteCount: 0,
    generationPreview: null,
    generationCalculating: false,
    generationViewport: null,
    generationBoundsPick: false,
    generationBoundsRect: null,
    tool: "select",
    drawingDraft: null,
    labelDraft: null,
    selectedTypeId: null,
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
      set({ tool, labelDraft: null });
      set({ status: tool === "add-location" ? "Кликните по холсту, чтобы поставить локацию" : "Режим выбора" });
    },

    selectEntity: (id) => set({ selectedEntityId: id, selectedPrimitiveIds: [] }),

    selectPrimitive: (id) => set({ selectedPrimitiveIds: id ? [id] : [], selectedEntityId: null }),

    selectPrimitives: (ids) => set({ selectedPrimitiveIds: ids, selectedEntityId: null }),

    togglePrimitiveSelection: (id) => {
      const current = get().selectedPrimitiveIds;
      set({
        selectedPrimitiveIds: current.includes(id)
          ? current.filter((x) => x !== id)
          : [...current, id],
        selectedEntityId: null,
      });
    },

    clearSelection: () => set({ selectedEntityId: null, selectedPrimitiveIds: [] }),

    copySelectedPrimitive: () => {
      const { project, activeMapId, selectedPrimitiveIds } = get();
      if (selectedPrimitiveIds.length !== 1) return;
      const primitive = findPrimitive(project, activeMapId, selectedPrimitiveIds[0]);
      if (!primitive) return;
      set({
        clipboard: JSON.parse(JSON.stringify(primitive)) as Primitive,
        pasteCount: 0,
        status: `Скопировано: ${PRIMITIVE_KIND_NOUN[primitive.kind]} «${displayNameOf(primitive)}» (Ctrl+V — вставить)`,
      });
    },

    pastePrimitive: () => {
      const { project, activeMapId, clipboard, pasteCount } = get();
      if (!clipboard) {
        set({ status: "Буфер пуст: скопируйте примитив (Ctrl+C)" });
        return;
      }
      const step = 20;
      const offset = { x: step * (pasteCount + 1), y: step * (pasteCount + 1) };
      try {
        const result = insertPrimitiveCopy(project, activeMapId, clipboard, offset);
        const name = result.project.maps[activeMapId]?.primitives.find(
          (p) => p.id === result.primitiveId,
        )?.name;
        set({ pasteCount: pasteCount + 1 });
        withBranchGuard(() => {
          applyNow(
            result.project,
            {
              operationType: "primitive.created",
              description: `Создана копия: ${PRIMITIVE_KIND_NOUN[clipboard.kind]} «${name ?? clipboard.name}»`,
              mapId: activeMapId,
              entityId: result.primitiveId,
            },
            `Вставлено: ${PRIMITIVE_KIND_NOUN[clipboard.kind]} «${name ?? clipboard.name}»`,
          );
          set({ selectedPrimitiveIds: [result.primitiveId] });
        });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось вставить примитив" });
      }
    },

    duplicateSelectedPrimitive: () => {
      get().copySelectedPrimitive();
      get().pastePrimitive();
    },

    setGenerationPreview: (preview) => set({ generationPreview: preview }),
    setGenerationCalculating: (v) => set({ generationCalculating: v }),
    setGenerationViewport: (v) => {
      const prev = get().generationViewport;
      if (
        prev &&
        Math.abs(prev.centerX - v.centerX) < 1 &&
        Math.abs(prev.centerY - v.centerY) < 1 &&
        Math.abs(prev.zoom - v.zoom) < 0.001 &&
        prev.w === v.w &&
        prev.h === v.h
      ) {
        return;
      }
      set({ generationViewport: v });
    },
    startGenerationBoundsPick: () =>
      set({ generationBoundsPick: true, status: "Обведите на холсте прямоугольник области генерации" }),
    cancelGenerationBoundsPick: () => set({ generationBoundsPick: false }),
    setGenerationBoundsRect: (rect) => set({ generationBoundsPick: false, generationBoundsRect: rect }),

    applyGeneration: (spec) => {
      const { project, activeMapId } = get();
      try {
        const result = applyGenerationToMap(project, activeMapId, spec);
        const warnText = result.warnings.length > 0 ? ` Предупреждения: ${result.warnings.join("; ")}` : "";
        withBranchGuard(() => {
          applyNow(
            result.project,
            {
              operationType: "map.generated",
              description: `Сгенерирована местность: ${result.stats.areas} областей, ${result.stats.lines} линий, ${result.stats.points} точек`,
              mapId: activeMapId,
            },
            `Генерация применена: добавлено ${result.added}, заменено ${result.removed}.${warnText}`,
          );
          set({ generationPreview: null, selectedPrimitiveIds: [] });
        });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось применить генерацию" });
      }
    },

    regenerateGeneration: () => {
      const { project, activeMapId } = get();
      const gen = project.maps[activeMapId]?.generation;
      if (!gen) {
        set({ status: "На этой карте генерация ещё не применялась — сначала нажмите «Применить к карте»" });
        return;
      }
      get().applyGeneration(gen.spec);
    },

    openMap: (id) => {
      const { project } = get();
      if (!project.maps[id]) return;
      set({
        activeMapId: id,
        selectedEntityId: null,
        selectedPrimitiveIds: [],
        labelDraft: null,
        // Предпросмотр принадлежит конкретной карте — не тащим его на другую.
        generationPreview: null,
        generationBoundsRect: null,
        status: `Открыта карта «${project.maps[id].name}»`,
      });
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
        selectedPrimitiveIds: [],
        drawingDraft: null,
        labelDraft: null,
        selectedTypeId: null,
        generationPreview: null,
        generationBoundsRect: null,
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
        set({ selectedEntityId: result.entityId, selectedPrimitiveIds: [], tool: "select" });
      });
    },

    addPointPrimitiveAt: (x, y) => {
      const { project, activeMapId } = get();
      const map = project.maps[activeMapId];
      if (!map) return;
      const type = activeTypeForShape("point");
      if (!type) {
        set({ status: "Нет типа легенды формы «точка» — создайте его в панели легенды" });
        return;
      }
      const primitive = createPointPrimitive(map, type.id, x, y);
      withBranchGuard(() => {
        applyNow(
          addPrimitive(project, activeMapId, primitive),
          {
            operationType: "primitive.created",
            description: `Создана точка «${primitive.name}»`,
            mapId: activeMapId,
            entityId: primitive.id,
          },
          `Создана точка «${primitive.name}»`,
        );
        set({ selectedPrimitiveIds: [primitive.id], selectedEntityId: null });
      });
    },

    startLabelDraft: (x, y) => set({ labelDraft: { x, y } }),

    cancelLabelDraft: () => set({ labelDraft: null }),

    confirmLabelDraft: (text) => {
      const { project, activeMapId, labelDraft } = get();
      if (!labelDraft) return;
      const trimmed = text.trim();
      set({ labelDraft: null });
      if (!trimmed) {
        set({ status: "Пустая подпись не создана" });
        return;
      }
      const map = project.maps[activeMapId];
      if (!map) return;
      const type = activeTypeForShape("label");
      if (!type) {
        set({ status: "Нет типа легенды формы «подпись» — создайте его в панели легенды" });
        return;
      }
      const primitive = createLabelPrimitive(map, type.id, labelDraft.x, labelDraft.y, trimmed);
      withBranchGuard(() => {
        applyNow(
          addPrimitive(project, activeMapId, primitive),
          {
            operationType: "primitive.created",
            description: `Создана подпись «${trimmed}»`,
            mapId: activeMapId,
            entityId: primitive.id,
          },
          `Создана подпись «${trimmed}»`,
        );
        set({ selectedPrimitiveIds: [primitive.id], selectedEntityId: null });
      });
    },

    drawingAddPoint: (x, y) => {
      const { drawingDraft, tool } = get();
      if (!drawingDraft) {
        const kind = tool === "area" ? "area" : "line";
        set({ drawingDraft: { kind, points: [{ x, y }] } });
      } else {
        set({ drawingDraft: { ...drawingDraft, points: [...drawingDraft.points, { x, y }] } });
      }
    },

    startPenStroke: (x, y) => {
      set({ drawingDraft: { kind: "pen", points: [{ x, y }] } });
    },

    penAddPoint: (x, y) => {
      const { drawingDraft } = get();
      if (!drawingDraft || drawingDraft.kind !== "pen") return;
      const last = drawingDraft.points[drawingDraft.points.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < 1) return;
      set({ drawingDraft: { ...drawingDraft, points: [...drawingDraft.points, { x, y }] } });
    },

    finishDrawing: () => {
      const { project, activeMapId, drawingDraft } = get();
      if (!drawingDraft) return;
      const kind = drawingDraft.kind;
      const points = drawingDraft.points;
      const min = kind === "area" ? 3 : 2;
      if (points.length < min) {
        set({
          drawingDraft: null,
          status:
            kind === "area"
              ? "Черновик области отброшен: меньше 3 вершин"
              : "Черновик линии отброшен: меньше 2 точек",
        });
        return;
      }
      const map = project.maps[activeMapId];
      if (!map) return;
      // Перо рисует линию — тип берём формы line.
      const shape = kind === "area" ? "area" : "line";
      const type = activeTypeForShape(shape);
      if (!type) {
        set({
          drawingDraft: null,
          status: `Нет типа легенды формы «${shape}» — создайте его в панели легенды`,
        });
        return;
      }
      const primitive: Primitive =
        kind === "area"
          ? createAreaPrimitive(map, type.id, points)
          : createLinePrimitive(map, type.id, points);
      const name = primitive.name;
      const noun =
        kind === "pen" ? "Свободная линия" : PRIMITIVE_KIND_NOUN[kind][0].toUpperCase() + PRIMITIVE_KIND_NOUN[kind].slice(1);
      withBranchGuard(() => {
        applyNow(
          addPrimitive(project, activeMapId, primitive),
          {
            operationType: "primitive.created",
            description: `${noun} «${name}» создана`,
            mapId: activeMapId,
            entityId: primitive.id,
          },
          `${noun} «${name}» создана. Esc — выйти из инструмента`,
        );
        set({ selectedPrimitiveIds: [primitive.id], selectedEntityId: null, drawingDraft: null });
      });
    },

    cancelDrawing: () => {
      if (!get().drawingDraft) return;
      set({ drawingDraft: null, status: "Черновик отменён" });
    },

    movePrimitiveVertexBy: (primitiveId, vertexIndex, x, y) => {
      const { project, activeMapId } = get();
      const primitive = findPrimitive(project, activeMapId, primitiveId);
      if (!primitive || primitive.locked) return;
      const noun = PRIMITIVE_KIND_NOUN[primitive.kind];
      try {
        apply(
          movePrimitiveVertex(project, activeMapId, primitiveId, vertexIndex, x, y),
          {
            operationType: "primitive.updated",
            description: `${noun[0].toUpperCase() + noun.slice(1)} «${displayNameOf(primitive)}»: вершина ${vertexIndex + 1} перемещена`,
            mapId: activeMapId,
            entityId: primitiveId,
          },
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось переместить вершину" });
      }
    },

    insertVertexInto: (primitiveId, segmentIndex, point) => {
      const { project, activeMapId } = get();
      const primitive = findPrimitive(project, activeMapId, primitiveId);
      if (!primitive || primitive.locked) return;
      const noun = PRIMITIVE_KIND_NOUN[primitive.kind];
      try {
        apply(
          insertPrimitiveVertex(project, activeMapId, primitiveId, segmentIndex, point),
          {
            operationType: "primitive.updated",
            description: `${noun[0].toUpperCase() + noun.slice(1)} «${displayNameOf(primitive)}»: добавлена вершина`,
            mapId: activeMapId,
            entityId: primitiveId,
          },
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось добавить вершину" });
      }
    },

    movePrimitiveBy: (primitiveId, dx, dy) => {
      if (dx === 0 && dy === 0) return;
      const { project, activeMapId, selectedPrimitiveIds } = get();
      const primitive = findPrimitive(project, activeMapId, primitiveId);
      if (!primitive) return;
      // Если примитив входит в мультивыделение — двигаем всю группу.
      if (selectedPrimitiveIds.includes(primitiveId) && selectedPrimitiveIds.length > 1) {
        get().moveSelectedPrimitives(dx, dy);
        return;
      }
      apply(
        movePrimitive(project, activeMapId, primitiveId, dx, dy),
        {
          operationType: "primitive.moved",
          description: `${PRIMITIVE_KIND_NOUN[primitive.kind]} «${displayNameOf(primitive)}» перемещена`,
          mapId: activeMapId,
          entityId: primitiveId,
        },
      );
    },

    moveSelectedPrimitives: (dx, dy) => {
      if (dx === 0 && dy === 0) return;
      const { project, activeMapId, selectedPrimitiveIds } = get();
      const map = project.maps[activeMapId];
      if (!map || selectedPrimitiveIds.length === 0) return;
      const movable = selectedPrimitiveIds.filter((id) => {
        const p = map.primitives.find((x) => x.id === id);
        return !!p && !p.locked;
      });
      if (movable.length === 0) return;
      const first = map.primitives.find((x) => x.id === movable[0]);
      apply(
        movePrimitives(project, activeMapId, movable, dx, dy),
        {
          operationType: "primitive.moved",
          description:
            movable.length === 1 && first
              ? `${PRIMITIVE_KIND_NOUN[first.kind]} «${displayNameOf(first)}» перемещена`
              : `Перемещено примитивов: ${movable.length}`,
          mapId: activeMapId,
          entityId: movable[0],
        },
      );
    },

    rotatePrimitiveBy: (primitiveId, angleRad) => {
      const { project, activeMapId } = get();
      const primitive = findPrimitive(project, activeMapId, primitiveId);
      if (!primitive) return;
      const deg = Math.round((angleRad * 180) / Math.PI);
      if (deg === 0) return;
      const noun = PRIMITIVE_KIND_NOUN[primitive.kind];
      try {
        apply(
          rotatePrimitive(project, activeMapId, primitiveId, angleRad),
          {
            operationType: "primitive.updated",
            description: `${noun[0].toUpperCase() + noun.slice(1)} «${displayNameOf(primitive)}» повёрнута на ${deg}°`,
            mapId: activeMapId,
            entityId: primitiveId,
            coalesceKey: `rotate:${primitiveId}`,
          },
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось повернуть примитив" });
      }
    },

    adjustLabelFontSize: (primitiveId, delta) => {
      const { project, activeMapId } = get();
      const primitive = findPrimitive(project, activeMapId, primitiveId);
      if (!primitive || primitive.kind !== "label") return;
      const next = Math.max(8, Math.min(72, primitive.fontSize + delta));
      if (next === primitive.fontSize) return;
      apply(
        updatePrimitive(project, activeMapId, primitiveId, { fontSize: next }),
        {
          operationType: "primitive.updated",
          description: `Подпись «${displayNameOf(primitive)}»: размер шрифта ${next}px`,
          mapId: activeMapId,
          entityId: primitiveId,
          coalesceKey: `label-fontsize:${primitiveId}`,
        },
      );
    },

    updatePrimitiveProps: (mapId, primitiveId, patch) => {
      const { project } = get();
      const current = findPrimitive(project, mapId, primitiveId);
      if (!current) return;
      const changed = (Object.keys(patch) as (keyof PrimitivePatch)[]).some(
        (key) => patch[key] !== (current as unknown as Record<string, unknown>)[key],
      );
      if (!changed) return;
      let description: string;
      if (patch.typeId !== undefined) {
        const typeName = legendTypeById(project, patch.typeId)?.name ?? "—";
        description = `Примитив «${current.name}»: тип изменён на «${typeName}»`;
      } else if (patch.name !== undefined) {
        description = `Примитив «${current.name}» переименован в «${patch.name.trim() || current.name}»`;
      } else if (patch.visible !== undefined) {
        description = `Примитив «${current.name}» ${patch.visible ? "показан" : "скрыт"}`;
      } else if (patch.locked !== undefined) {
        description = `Примитив «${current.name}» ${patch.locked ? "заблокирован" : "разблокирован"}`;
      } else if (patch.text !== undefined) {
        description = `Подпись «${displayNameOf(current)}»: текст изменён`;
      } else {
        description = `Примитив «${current.name}» обновлён`;
      }
      try {
        apply(
          updatePrimitive(project, mapId, primitiveId, patch),
          {
            operationType: "primitive.updated",
            description,
            mapId,
            entityId: primitiveId,
          },
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось обновить примитив" });
      }
    },

    deletePrimitiveById: (mapId, primitiveId) => {
      const { project } = get();
      const primitive = findPrimitive(project, mapId, primitiveId);
      if (!primitive) return;
      if (primitive.locked) {
        set({ status: `«${displayNameOf(primitive)}» заблокирован: разблокируйте перед удалением` });
        return;
      }
      const name = displayNameOf(primitive);
      withBranchGuard(() => {
        applyNow(
          deletePrimitive(project, mapId, primitiveId),
          {
            operationType: "primitive.deleted",
            description: `Удалена ${PRIMITIVE_KIND_NOUN[primitive.kind]} «${name}»`,
            mapId,
            entityId: primitiveId,
            restoreInfo: { kind: "primitive", mapId, primitive: { ...primitive } },
          },
          `«${name}» удалена. Восстановить: Ctrl+Z или кнопка в панели «История»`,
        );
        set({ selectedPrimitiveIds: [] });
      });
    },

    deleteSelectedPrimitives: () => {
      const { project, activeMapId, selectedPrimitiveIds } = get();
      const map = project.maps[activeMapId];
      if (!map || selectedPrimitiveIds.length === 0) return;
      const deletable: EntityId[] = [];
      let lockedCount = 0;
      for (const id of selectedPrimitiveIds) {
        const p = map.primitives.find((x) => x.id === id);
        if (!p) continue;
        if (p.locked) lockedCount += 1;
        else deletable.push(id);
      }
      if (deletable.length === 0) {
        set({
          status:
            lockedCount > 0
              ? "Выбранные примитивы заблокированы: разблокируйте перед удалением"
              : "Нечего удалять",
        });
        return;
      }
      const first = map.primitives.find((x) => x.id === deletable[0]);
      withBranchGuard(() => {
        applyNow(
          deletePrimitives(project, activeMapId, deletable),
          {
            operationType: "primitive.deleted",
            description:
              deletable.length === 1 && first
                ? `Удалена ${PRIMITIVE_KIND_NOUN[first.kind]} «${displayNameOf(first)}»`
                : `Удалено примитивов: ${deletable.length}`,
            mapId: activeMapId,
            entityId: deletable[0],
            restoreInfo:
              deletable.length === 1 && first
                ? { kind: "primitive", mapId: activeMapId, primitive: { ...first } }
                : undefined,
          },
          `Удалено примитивов: ${deletable.length}${
            lockedCount > 0 ? ` (заблокированные пропущены: ${lockedCount})` : ""
          }. Восстановить: Ctrl+Z или панель «История»`,
        );
        set({ selectedPrimitiveIds: [] });
      });
    },

    restorePrimitiveFromHistory: (entryId) => {
      const { project, activeMapId, history } = get();
      const entry = history.entries.find((e) => e.id === entryId);
      const info = entry?.restoreInfo;
      if (!info || info.kind !== "primitive") {
        set({ status: "Запись не позволяет восстановить примитив" });
        return;
      }
      try {
        const result = restorePrimitiveToMap(project, info.mapId, info.primitive);
        const mapId = info.mapId;
        const primitiveId = info.primitive.id;
        const name = displayNameOf(info.primitive);
        withBranchGuard(() => {
          applyNow(
            result,
            {
              operationType: "primitive.restored",
              description: `Восстановлена ${PRIMITIVE_KIND_NOUN[info.primitive.kind]} «${name}»`,
              mapId,
              entityId: primitiveId,
            },
            `Примитив «${name}» восстановлен`,
          );
          if (mapId === activeMapId) set({ selectedPrimitiveIds: [primitiveId] });
        });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось восстановить примитив" });
      }
    },

    addLegendTypeFor: (shape) => {
      const { project } = get();
      const name = `Тип ${project.legend.length + 1}`;
      const result = addLegendType(project, { name, shape });
      withBranchGuard(() => {
        applyNow(
          result.project,
          {
            operationType: "legend.created",
            description: `Создан тип легенды «${name}»`,
          },
          `Создан тип легенды «${name}» — задайте имя, категорию, цвет и стиль в панели легенды`,
        );
        set({ selectedTypeId: result.typeId });
      });
    },

    updateLegendTypeProps: (typeId, patch) => {
      const { project } = get();
      const current = legendTypeById(project, typeId);
      if (!current) return;
      const changed = (Object.keys(patch) as (keyof LegendTypePatch)[]).some(
        (key) => patch[key] !== (current as unknown as Record<string, unknown>)[key],
      );
      if (!changed) return;
      try {
        apply(
          updateLegendType(project, typeId, patch),
          {
            operationType: "legend.updated",
            description: `Тип легенды «${current.name}» изменён`,
            coalesceKey: `legend:${typeId}`,
          },
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось изменить тип легенды" });
      }
    },

    deleteLegendTypeById: (typeId) => {
      const { project } = get();
      const current = legendTypeById(project, typeId);
      if (!current) return;
      try {
        apply(
          deleteLegendType(project, typeId),
          {
            operationType: "legend.deleted",
            description: `Тип легенды «${current.name}» удалён`,
          },
          `Тип легенды «${current.name}» удалён`,
        );
        if (get().selectedTypeId === typeId) set({ selectedTypeId: null });
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось удалить тип легенды" });
      }
    },

    selectLegendType: (typeId) => set({ selectedTypeId: typeId }),

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
      const { activeMapId, selectedEntityId } = get();
      if (!selectedEntityId) return;
      deleteMarkerWithHistory(activeMapId, selectedEntityId);
    },

    deleteMarkerAt: (mapId, entityId) => {
      deleteMarkerWithHistory(mapId, entityId);
    },

    deleteArchivedMarkerById: (archivedEntityId) => {
      const { project } = get();
      const entry = project.markerArchive.find((a) => a.entity.id === archivedEntityId);
      if (!entry) return;
      try {
        apply(
          deleteArchivedMarker(project, archivedEntityId),
          {
            operationType: "archive.entryDeleted",
            description: `Запись архива «${entry.entity.label}» удалена`,
            entityId: archivedEntityId,
          },
          `Запись «${entry.entity.label}» удалена из архива`,
        );
      } catch (e) {
        set({ status: e instanceof Error ? e.message : "Не удалось удалить запись архива" });
      }
    },

    clearArchive: () => {
      const { project } = get();
      const count = project.markerArchive.length;
      if (count === 0) {
        set({ status: "Архив уже пуст" });
        return;
      }
      apply(
        clearMarkerArchive(project),
        {
          operationType: "archive.cleared",
          description: `Архив удалённых маркеров очищен (${count})`,
        },
        `Архив очищен: удалено записей — ${count}`,
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
      if (!info || info.kind !== "marker") {
        set({ status: "Запись не позволяет восстановить маркер" });
        return;
      }
      try {
        const result = restoreMarkerFromRecord(project, info.sourceMapId, info.entity);
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
      const { project, history, activeMapId, selectedEntityId, selectedPrimitiveIds } = get();
      const step = undo(history);
      if (!step) {
        set({ status: "Отменять нечего" });
        return;
      }
      if (step.project === project) return;
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId, selectedPrimitiveIds),
        status: `Отменено. Текущая запись: ${positionDescription(step.history)}`,
      });
    },

    redoChange: () => {
      const { project, history, activeMapId, selectedEntityId, selectedPrimitiveIds } = get();
      const step = redo(history);
      if (!step) {
        set({ status: "Повторять нечего" });
        return;
      }
      if (step.project === project) return;
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId, selectedPrimitiveIds),
        status: `Повторено. Текущая запись: ${positionDescription(step.history)}`,
      });
    },

    jumpToHistory: (index) => {
      const { project, history, activeMapId, selectedEntityId, selectedPrimitiveIds } = get();
      if (index === history.position) return;
      const step = jumpTo(history, index);
      if (step.project === project) {
        set({ history: step.history });
        return;
      }
      set({
        project: step.project,
        history: step.history,
        ...sanitize(step.project, activeMapId, selectedEntityId, selectedPrimitiveIds),
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
        const clean = sanitize(project, project.rootMapId, null, []);
        set({
          project,
          projectPath: path,
          history,
          ...clean,
          selectedEntityId: null,
          selectedPrimitiveIds: [],
          drawingDraft: null,
          labelDraft: null,
          selectedTypeId: null,
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

export function useSelectedPrimitive(): Primitive | null {
  return useAppStore((s) => {
    if (s.selectedPrimitiveIds.length !== 1) return null;
    const map = s.project.maps[s.activeMapId];
    if (!map) return null;
    return map.primitives.find((p) => p.id === s.selectedPrimitiveIds[0]) ?? null;
  });
}

const EMPTY_PRIMITIVES: Primitive[] = [];

export function useSelectedPrimitives(): Primitive[] {
  return useAppStore(
    useShallow((s) => {
      const map = s.project.maps[s.activeMapId];
      if (!map || s.selectedPrimitiveIds.length === 0) return EMPTY_PRIMITIVES;
      return s.selectedPrimitiveIds
        .map((id) => map.primitives.find((p) => p.id === id))
        .filter((p): p is Primitive => !!p);
    }),
  );
}
