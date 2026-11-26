import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ArchivedMarker,
  type EntityId,
  type LegendShape,
  type LegendType,
  type LinePrimitive,
  type LocationLinkEntity,
  type MapId,
  type MapNode,
  type MapScale,
  type MapView,
  type PointPrimitive,
  type Primitive,
  type PrimitiveKind,
  type Project,
  type Vec2,
} from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const ROOT_MAP_NAME = "Глобальная карта";
export const NEW_LOCATION_NAME = "Новая локация";

function newId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function touch(project: Project): Project {
  return { ...project, updatedAt: now() };
}

export function createMap(name: string, parentId: MapId | null): MapNode {
  const ts = now();
  return {
    id: newId(),
    name,
    parentId,
    entities: [],
    primitives: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createProject(title = "Новый проект"): Project {
  const root = createMap(ROOT_MAP_NAME, null);
  const ts = now();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId(),
    title,
    rootMapId: root.id,
    maps: { [root.id]: root },
    markerArchive: [],
    legend: createDefaultLegend(),
    createdAt: ts,
    updatedAt: ts,
  };
}

export interface AddLocationResult {
  project: Project;
  mapId: MapId;
  entityId: EntityId;
}

export function addLocation(
  project: Project,
  parentMapId: MapId,
  x: number,
  y: number,
): AddLocationResult {
  const parent = project.maps[parentMapId];
  if (!parent) throw new Error("Карта не найдена");
  const ts = now();
  const child: MapNode = {
    id: newId(),
    name: NEW_LOCATION_NAME,
    parentId: parentMapId,
    entities: [],
    primitives: [],
    createdAt: ts,
    updatedAt: ts,
  };
  const entity: LocationLinkEntity = {
    id: newId(),
    kind: "location-link",
    x,
    y,
    label: NEW_LOCATION_NAME,
    targetMapId: child.id,
    createdAt: ts,
    updatedAt: ts,
  };
  const updatedParent: MapNode = {
    ...parent,
    entities: [...parent.entities, entity],
    updatedAt: ts,
  };
  return {
    project: touch({
      ...project,
      maps: { ...project.maps, [parentMapId]: updatedParent, [child.id]: child },
    }),
    mapId: child.id,
    entityId: entity.id,
  };
}

export function renameMap(project: Project, mapId: MapId, name: string): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const trimmed = name.trim();
  if (!trimmed || trimmed === map.name) return project;
  const ts = now();
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, name: trimmed, updatedAt: ts },
    },
  });
}

export function renameMarker(
  project: Project,
  mapId: MapId,
  entityId: EntityId,
  label: string,
): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const trimmed = label.trim();
  if (!trimmed) return project;
  const ts = now();
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: {
        ...map,
        updatedAt: ts,
        entities: map.entities.map((e) =>
          e.id === entityId ? { ...e, label: trimmed, updatedAt: ts } : e,
        ),
      },
    },
  });
}

export function moveMarker(
  project: Project,
  mapId: MapId,
  entityId: EntityId,
  x: number,
  y: number,
): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const ts = now();
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: {
        ...map,
        updatedAt: ts,
        entities: map.entities.map((e) =>
          e.id === entityId ? { ...e, x, y, updatedAt: ts } : e,
        ),
      },
    },
  });
}

/**
 * Удаляет маркер с карты. Связанная карта не удаляется —
 * маркер переносится в архив, откуда его можно восстановить.
 */
export function deleteMarker(project: Project, mapId: MapId, entityId: EntityId): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const entity = map.entities.find((e) => e.id === entityId);
  if (!entity) throw new Error("Маркер не найден");
  const ts = now();
  const archived: ArchivedMarker = {
    entity: { ...entity },
    sourceMapId: mapId,
    archivedAt: ts,
  };
  return touch({
    ...project,
    markerArchive: [...project.markerArchive, archived],
    maps: {
      ...project.maps,
      [mapId]: {
        ...map,
        updatedAt: ts,
        entities: map.entities.filter((e) => e.id !== entityId),
      },
    },
  });
}

export interface RestoreMarkerResult {
  project: Project;
  mapId: MapId;
  entityId: EntityId;
}

/**
 * Вставляет маркер обратно на карту-источник: прежние координаты
 * и связь с целевой картой. Используется и архивом удалённых
 * маркеров (1.5.1), и восстановлением из записи истории (1.5.2).
 * Бросает Error с понятным сообщением, если восстановить невозможно;
 * проект при этом не изменяется.
 */
export function restoreMarkerEntity(
  project: Project,
  sourceMapId: MapId,
  entity: LocationLinkEntity,
): RestoreMarkerResult {
  const source = project.maps[sourceMapId];
  if (!source) {
    throw new Error("Нельзя восстановить: карта, на которой стоял маркер, удалена из проекта");
  }
  if (!project.maps[entity.targetMapId]) {
    throw new Error(`Нельзя восстановить «${entity.label}»: связанная карта удалена из проекта`);
  }
  if (source.entities.some((e) => e.id === entity.id)) {
    throw new Error("Такой маркер уже существует на карте");
  }

  const ts = now();
  const restored: LocationLinkEntity = { ...entity, updatedAt: ts };
  return {
    project: touch({
      ...project,
      maps: {
        ...project.maps,
        [sourceMapId]: {
          ...source,
          updatedAt: ts,
          entities: [...source.entities, restored],
        },
      },
    }),
    mapId: sourceMapId,
    entityId: restored.id,
  };
}

/**
 * Восстанавливает маркер из архива удалённых маркеров (1.5.1).
 */
export function restoreMarker(project: Project, archivedEntityId: EntityId): RestoreMarkerResult {
  const index = project.markerArchive.findIndex((a) => a.entity.id === archivedEntityId);
  if (index < 0) throw new Error("Маркер не найден в архиве");
  const entry = project.markerArchive[index];

  const result = restoreMarkerEntity(project, entry.sourceMapId, entry.entity);
  return {
    ...result,
    project: touch({
      ...result.project,
      markerArchive: result.project.markerArchive.filter((_, i) => i !== index),
    }),
  };
}

/**
 * Восстанавливает маркер по записи истории (restoreInfo записи
 * marker.deleted, 1.5.2). В отличие от голого restoreMarkerEntity,
 * убирает маркер из архива удалённых, если он там ещё числится, —
 * иначе один и тот же маркер можно было бы восстановить дважды
 * (и из истории, и из архива).
 */
export function restoreMarkerFromRecord(
  project: Project,
  sourceMapId: MapId,
  entity: LocationLinkEntity,
): RestoreMarkerResult {
  const result = restoreMarkerEntity(project, sourceMapId, entity);
  if (!result.project.markerArchive.some((a) => a.entity.id === entity.id)) {
    return result;
  }
  return {
    ...result,
    project: touch({
      ...result.project,
      markerArchive: result.project.markerArchive.filter((a) => a.entity.id !== entity.id),
    }),
  };
}

export function deleteMap(project: Project, mapId: MapId): Project {
  if (mapId === project.rootMapId) throw new Error("Корневую карту нельзя удалить");
  if (!project.maps[mapId]) return project;

  const removedIds = collectDescendants(project.maps, mapId);
  const maps: Record<MapId, MapNode> = {};
  for (const [id, map] of Object.entries(project.maps)) {
    if (removedIds.has(id)) continue;
    // Удаляем маркеры-ссылки на удалённые карты — проект не должен ломаться.
    const entities = map.entities.filter((e) => !removedIds.has(e.targetMapId));
    maps[id] = entities.length === map.entities.length ? map : { ...map, entities };
  }
  return touch({ ...project, maps });
}

export function setMapScale(
  project: Project,
  mapId: MapId,
  scale: MapScale | undefined,
): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  return touch({
    ...project,
    maps: { ...project.maps, [mapId]: { ...map, scale, updatedAt: now() } },
  });
}

// Смена вида не попадает в историю отмен — это навигация, а не правка.
export function setMapView(project: Project, mapId: MapId, view: MapView): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const prev = map.view;
  if (prev && prev.centerX === view.centerX && prev.centerY === view.centerY && prev.zoom === view.zoom) {
    return project;
  }
  return {
    ...project,
    maps: { ...project.maps, [mapId]: { ...map, view } },
  };
}

export function renameProject(project: Project, title: string): Project {
  const trimmed = title.trim();
  if (!trimmed || trimmed === project.title) return project;
  return touch({ ...project, title: trimmed });
}

export function countChildren(project: Project, mapId: MapId): number {
  let count = 0;
  for (const map of Object.values(project.maps)) {
    if (map.parentId === mapId) count += 1;
  }
  return count;
}

/* ---------- Легенда (итерация 2) ---------- */

const LEGEND_BUILTIN_CATEGORY = "Базовые";

function builtinType(
  name: string,
  shape: LegendShape,
  color: string,
  opacity: number,
  strokeWidth: number,
): LegendType {
  const ts = now();
  return {
    id: newId(),
    name,
    category: LEGEND_BUILTIN_CATEGORY,
    shape,
    color,
    opacity,
    strokeWidth,
    strokeStyle: "solid",
    visible: true,
    isBuiltin: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Ровно 4 нейтральных базовых типа — никакой сеттинг-стилистики. */
export function createDefaultLegend(): LegendType[] {
  return [
    builtinType("Точка", "point", "#4f8cff", 1, 2),
    builtinType("Линия", "line", "#9aa3b2", 1, 2),
    builtinType("Область", "area", "#8a94a6", 1, 2),
    builtinType("Подпись", "label", "#d7d9e0", 1, 2),
  ];
}

export function legendTypeById(project: Project, typeId: string): LegendType | undefined {
  return project.legend.find((t) => t.id === typeId);
}

export function legendTypesByShape(project: Project, shape: LegendShape): LegendType[] {
  return project.legend.filter((t) => t.shape === shape);
}

/** Первый подходящий тип для примитива данного вида (фолбэк при рисовании). */
export function fallbackTypeForKind(project: Project, kind: PrimitiveKind): LegendType | undefined {
  return legendTypesByShape(project, kind)[0];
}

export interface AddLegendTypeResult {
  project: Project;
  typeId: string;
}

/** Создаёт пользовательский тип легенды. Форму задаёт вызывающий код. */
export function addLegendType(
  project: Project,
  input: { name: string; shape: LegendShape },
): AddLegendTypeResult {
  const ts = now();
  const type: LegendType = {
    id: newId(),
    name: input.name.trim() || "Новый тип",
    category: "",
    shape: input.shape,
    color: "#9aa3b2",
    opacity: 1,
    strokeWidth: 2,
    strokeStyle: "solid",
    visible: true,
    isBuiltin: false,
    createdAt: ts,
    updatedAt: ts,
  };
  return {
    project: touch({ ...project, legend: [...project.legend, type] }),
    typeId: type.id,
  };
}

export type LegendTypePatch = Partial<
  Pick<
    LegendType,
    "name" | "category" | "shape" | "color" | "opacity" | "strokeWidth" | "strokeStyle" | "visible"
  >
>;

export function updateLegendType(project: Project, typeId: string, patch: LegendTypePatch): Project {
  const type = legendTypeById(project, typeId);
  if (!type) throw new Error("Тип легенды не найден");
  if (type.isBuiltin && patch.shape !== undefined && patch.shape !== type.shape) {
    throw new Error("Нельзя менять форму базового типа");
  }
  const ts = now();
  return touch({
    ...project,
    legend: project.legend.map((t) =>
      t.id === typeId ? { ...t, ...patch, name: patch.name !== undefined ? patch.name.trim() || t.name : t.name, updatedAt: ts } : t,
    ),
  });
}

/** Сколько примитивов использует тип легенды. */
export function countLegendTypeUsage(project: Project, typeId: string): number {
  let count = 0;
  for (const map of Object.values(project.maps)) {
    for (const primitive of map.primitives) {
      if (primitive.typeId === typeId) count += 1;
    }
  }
  return count;
}

/**
 * Удаляет тип легенды. Бросает Error с понятной причиной, если удалить
 * нельзя: тип используется примитивами или является последним опорным
 * типом своей формы (базовые типы нельзя удалять, если это сломает
 * покрытие формы).
 */
export function deleteLegendType(project: Project, typeId: string): Project {
  const type = legendTypeById(project, typeId);
  if (!type) throw new Error("Тип легенды не найден");
  const usage = countLegendTypeUsage(project, typeId);
  if (usage > 0) {
    throw new Error(`Нельзя удалить тип «${type.name}»: его используют ${usage} примитивов`);
  }
  const sameShapeLeft = project.legend.filter((t) => t.shape === type.shape && t.id !== typeId);
  if (type.isBuiltin && sameShapeLeft.length === 0) {
    throw new Error(`Нельзя удалить базовый тип «${type.name}»: это единственный тип формы «${type.shape}»`);
  }
  return touch({ ...project, legend: project.legend.filter((t) => t.id !== typeId) });
}

/* ---------- Примитивы (итерация 2) ---------- */

const PRIMITIVE_BASE_NAME: Record<PrimitiveKind, string> = {
  point: "Точка",
  line: "Линия",
  area: "Область",
  label: "Подпись",
};

function nextPrimitiveName(map: MapNode, kind: PrimitiveKind): string {
  const count = map.primitives.filter((p) => p.kind === kind).length;
  return `${PRIMITIVE_BASE_NAME[kind]} ${count + 1}`;
}

function primitiveBase(map: MapNode, kind: PrimitiveKind, typeId: string) {
  const ts = now();
  return {
    id: newId(),
    kind,
    name: nextPrimitiveName(map, kind),
    typeId,
    note: "",
    visible: true,
    locked: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createPointPrimitive(
  map: MapNode,
  typeId: string,
  x: number,
  y: number,
): PointPrimitive {
  return { ...primitiveBase(map, "point", typeId), kind: "point", x, y };
}

export function createLinePrimitive(
  map: MapNode,
  typeId: string,
  points: Vec2[],
): LinePrimitive {
  if (points.length < 2) throw new Error("Линия должна иметь минимум 2 точки");
  return { ...primitiveBase(map, "line", typeId), kind: "line", points: points.map((p) => ({ ...p })) };
}

export function createAreaPrimitive(
  map: MapNode,
  typeId: string,
  points: Vec2[],
): Primitive {
  if (points.length < 3) throw new Error("Область должна иметь минимум 3 вершины");
  return { ...primitiveBase(map, "area", typeId), kind: "area", points: points.map((p) => ({ ...p })) };
}

export function createLabelPrimitive(
  map: MapNode,
  typeId: string,
  x: number,
  y: number,
  text: string,
): Primitive {
  return {
    ...primitiveBase(map, "label", typeId),
    kind: "label",
    x,
    y,
    text,
    fontSize: 14,
  };
}

export function findPrimitive(project: Project, mapId: MapId, primitiveId: EntityId) {
  const map = project.maps[mapId];
  if (!map) return undefined;
  return map.primitives.find((p) => p.id === primitiveId);
}

export function addPrimitive(project: Project, mapId: MapId, primitive: Primitive): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const type = legendTypeById(project, primitive.typeId);
  if (!type || type.shape !== primitive.kind) {
    throw new Error("Тип легенды не соответствует виду примитива");
  }
  const ts = now();
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, updatedAt: ts, primitives: [...map.primitives, primitive] },
    },
  });
}

/** Смещает примитив: точку/подпись — x/y, линию/область — все точки. */
export function movePrimitive(
  project: Project,
  mapId: MapId,
  primitiveId: EntityId,
  dx: number,
  dy: number,
): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const ts = now();
  const move = (p: Primitive): Primitive => {
    if (p.id !== primitiveId) return p;
    if (p.kind === "point" || p.kind === "label") {
      return { ...p, x: p.x + dx, y: p.y + dy, updatedAt: ts };
    }
    return { ...p, points: p.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })), updatedAt: ts };
  };
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, updatedAt: ts, primitives: map.primitives.map(move) },
    },
  });
}

export type PrimitivePatch = Partial<{
  name: string;
  note: string;
  visible: boolean;
  locked: boolean;
  typeId: string;
  text: string;
  fontSize: number;
}>;

export function updatePrimitive(
  project: Project,
  mapId: MapId,
  primitiveId: EntityId,
  patch: PrimitivePatch,
): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  const current = map.primitives.find((p) => p.id === primitiveId);
  if (!current) throw new Error("Примитив не найден");
  if (patch.typeId !== undefined) {
    const type = legendTypeById(project, patch.typeId);
    if (!type) throw new Error("Тип легенды не найден");
    if (type.shape !== current.kind) {
      throw new Error(`Тип «${type.name}» не подходит: форма «${type.shape}», а примитив — «${current.kind}»`);
    }
  }
  const ts = now();
  const apply = (p: Primitive): Primitive => {
    if (p.id !== primitiveId) return p;
    const next = { ...p, ...patch, updatedAt: ts };
    if (patch.name !== undefined) next.name = patch.name.trim() || p.name;
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.fontSize !== undefined) next.fontSize = Math.max(8, Math.min(72, patch.fontSize));
    return next;
  };
  // Не трогаем проект, если патч ничего не меняет (blur без изменений
  // не должен плодить записи в журнале).
  const nextPrimitive = apply(current);
  const comparable = (p: Primitive) =>
    JSON.stringify({
      name: p.name,
      note: p.note,
      visible: p.visible,
      locked: p.locked,
      typeId: p.typeId,
      text: p.kind === "label" ? p.text : undefined,
      fontSize: p.kind === "label" ? p.fontSize : undefined,
    });
  if (comparable(nextPrimitive) === comparable(current)) return project;
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, updatedAt: ts, primitives: map.primitives.map(apply) },
    },
  });
}

export function deletePrimitive(project: Project, mapId: MapId, primitiveId: EntityId): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Карта не найдена");
  if (!map.primitives.some((p) => p.id === primitiveId)) return project;
  const ts = now();
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, updatedAt: ts, primitives: map.primitives.filter((p) => p.id !== primitiveId) },
    },
  });
}

/**
 * Вставляет примитив обратно на карту (восстановление из записи истории).
 * Атомарно: либо примитив восстановлен, либо брошена ошибка и проект
 * не изменился. Дубликаты по id блокируются.
 */
export function restorePrimitiveToMap(project: Project, mapId: MapId, primitive: Primitive): Project {
  const map = project.maps[mapId];
  if (!map) throw new Error("Нельзя восстановить: карта, на которой был примитив, удалена из проекта");
  if (map.primitives.some((p) => p.id === primitive.id)) {
    throw new Error("Такой примитив уже существует на карте");
  }
  const typeId = legendTypeById(project, primitive.typeId)
    ? primitive.typeId
    : (fallbackTypeForKind(project, primitive.kind)?.id ?? primitive.typeId);
  const ts = now();
  const restored: Primitive = { ...primitive, typeId, updatedAt: ts };
  return touch({
    ...project,
    maps: {
      ...project.maps,
      [mapId]: { ...map, updatedAt: ts, primitives: [...map.primitives, restored] },
    },
  });
}

function collectDescendants(maps: Record<MapId, MapNode>, mapId: MapId): Set<MapId> {
  const result = new Set<MapId>([mapId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const map of Object.values(maps)) {
      if (map.parentId && result.has(map.parentId) && !result.has(map.id)) {
        result.add(map.id);
        changed = true;
      }
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validateEntityShape(raw: unknown, where: string): LocationLinkEntity {
  if (!isRecord(raw)) throw new ValidationError(`${where}: сущность повреждена`);
  if (raw.kind !== "location-link") throw new ValidationError(`${where}: неизвестный тип сущности`);
  if (typeof raw.id !== "string" || !raw.id) throw new ValidationError(`${where}: у сущности нет id`);
  if (typeof raw.x !== "number" || typeof raw.y !== "number") {
    throw new ValidationError(`${where}: у сущности нет координат`);
  }
  if (typeof raw.label !== "string") throw new ValidationError(`${where}: у сущности нет подписи`);
  if (typeof raw.targetMapId !== "string" || !raw.targetMapId) {
    throw new ValidationError(`${where}: у сущности нет целевой карты`);
  }
  if (!isIsoDate(raw.createdAt) || !isIsoDate(raw.updatedAt)) {
    throw new ValidationError(`${where}: повреждены даты сущности`);
  }
  return raw as unknown as LocationLinkEntity;
}

function validateEntity(raw: unknown, maps: Record<MapId, MapNode>, where: string): LocationLinkEntity {
  const entity = validateEntityShape(raw, where);
  if (!maps[entity.targetMapId]) {
    throw new ValidationError(`${where}: маркер ссылается на отсутствующую карту`);
  }
  return entity;
}

// Архив удалённых маркеров появился после первых файлов формата v1:
// в них поле отсутствует, читаем как пустой архив.
function validateArchive(raw: unknown, where: string): ArchivedMarker[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ValidationError(`${where}: архив удалённых маркеров повреждён`);
  return raw.map((entry, i) => {
    const place = `${where}, запись №${i + 1}`;
    if (!isRecord(entry)) throw new ValidationError(`${place}: запись повреждена`);
    const entity = validateEntityShape(entry.entity, `${place}: маркер`);
    if (typeof entry.sourceMapId !== "string" || !entry.sourceMapId) {
      throw new ValidationError(`${place}: нет карты-источника`);
    }
    const archivedAt = entry.archivedAt;
    if (typeof archivedAt !== "string" || !isIsoDate(archivedAt)) {
      throw new ValidationError(`${place}: повреждена дата архивации`);
    }
    return { entity, sourceMapId: entry.sourceMapId, archivedAt };
  });
}

/* ---------- Легенда и примитивы: валидация с миграцией ---------- */

const LEGEND_SHAPES = new Set<string>(["point", "line", "area", "label"]);

/**
 * Разбирает легенду. Файлы итерации 1 поля legend не имеют —
 * им создаются 4 базовых типа (миграция). Битые записи пропускаются;
 * если валидных типов нет вообще — безопасный фолбэк на базовые.
 */
function validateLegend(raw: unknown): LegendType[] {
  if (raw === undefined) return createDefaultLegend();
  if (!Array.isArray(raw)) throw new ValidationError("Легенда повреждена: это не список типов");
  const seen = new Set<string>();
  const result: LegendType[] = [];
  for (const rawType of raw) {
    if (!isRecord(rawType)) continue;
    if (typeof rawType.id !== "string" || !rawType.id || seen.has(rawType.id)) continue;
    if (typeof rawType.name !== "string" || !rawType.name.trim()) continue;
    if (typeof rawType.shape !== "string" || !LEGEND_SHAPES.has(rawType.shape)) continue;
    if (typeof rawType.color !== "string" || !rawType.color) continue;
    const createdAt = rawType.createdAt;
    const updatedAt = rawType.updatedAt;
    if (typeof createdAt !== "string" || !isIsoDate(createdAt)) continue;
    if (typeof updatedAt !== "string" || !isIsoDate(updatedAt)) continue;
    seen.add(rawType.id);
    const opacity =
      typeof rawType.opacity === "number" && Number.isFinite(rawType.opacity)
        ? Math.min(1, Math.max(0, rawType.opacity))
        : 1;
    const strokeWidth =
      typeof rawType.strokeWidth === "number" && Number.isFinite(rawType.strokeWidth)
        ? Math.min(20, Math.max(1, rawType.strokeWidth))
        : 2;
    result.push({
      id: rawType.id,
      name: rawType.name.trim(),
      category: typeof rawType.category === "string" ? rawType.category : "",
      shape: rawType.shape as LegendShape,
      color: rawType.color,
      opacity,
      strokeWidth,
      strokeStyle: rawType.strokeStyle === "dashed" ? "dashed" : "solid",
      visible: rawType.visible !== false,
      isBuiltin: rawType.isBuiltin === true,
      createdAt,
      updatedAt,
    });
  }
  return result.length > 0 ? result : createDefaultLegend();
}

function tryValidatePrimitive(raw: unknown, legend: LegendType[]): Primitive | null {
  try {
    if (!isRecord(raw)) return null;
    if (raw.kind !== "point" && raw.kind !== "line" && raw.kind !== "area" && raw.kind !== "label") {
      return null;
    }
    if (typeof raw.id !== "string" || !raw.id) return null;
    if (!isIsoDate(raw.createdAt) || !isIsoDate(raw.updatedAt)) return null;
    const kind = raw.kind as PrimitiveKind;
    const base = {
      id: raw.id,
      kind,
      name:
        typeof raw.name === "string" && raw.name.trim()
          ? raw.name.trim()
          : PRIMITIVE_BASE_NAME[kind],
      note: typeof raw.note === "string" ? raw.note : "",
      visible: raw.visible !== false,
      locked: raw.locked === true,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
    // typeId: должен ссылаться на существующий тип той же формы;
    // иначе — фолбэк на первый подходящий тип, а если типов такой
    // формы нет — примитив выбрасывается (безопасно, не краш).
    const byShape = legend.filter((t) => t.shape === kind);
    let typeId = typeof raw.typeId === "string" ? raw.typeId : "";
    if (!byShape.some((t) => t.id === typeId)) {
      if (byShape.length === 0) return null;
      typeId = byShape[0].id;
    }
    if (kind === "point") {
      if (typeof raw.x !== "number" || typeof raw.y !== "number") return null;
      return { ...base, typeId, x: raw.x, y: raw.y } as Primitive;
    }
    if (kind === "label") {
      if (typeof raw.x !== "number" || typeof raw.y !== "number") return null;
      const fontSize =
        typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
          ? Math.max(8, Math.min(72, raw.fontSize))
          : 14;
      return {
        ...base,
        typeId,
        x: raw.x,
        y: raw.y,
        text: typeof raw.text === "string" ? raw.text : "",
        fontSize,
      } as Primitive;
    }
    if (!Array.isArray(raw.points)) return null;
    const points: Vec2[] = [];
    for (const pt of raw.points) {
      if (!isRecord(pt) || typeof pt.x !== "number" || typeof pt.y !== "number") return null;
      points.push({ x: pt.x, y: pt.y });
    }
    if (kind === "line" && points.length < 2) return null;
    if (kind === "area" && points.length < 3) return null;
    return { ...base, typeId, points } as Primitive;
  } catch {
    return null;
  }
}

function validatePrimitives(raw: unknown, legend: LegendType[], where: string): Primitive[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ValidationError(`${where}: список примитивов повреждён`);
  const result: Primitive[] = [];
  for (const rawPrimitive of raw) {
    const primitive = tryValidatePrimitive(rawPrimitive, legend);
    if (primitive) result.push(primitive);
  }
  return result;
}

export function validateProject(raw: unknown): Project {
  if (!isRecord(raw)) throw new ValidationError("Файл не является проектом MapGen");
  if (raw.format !== PROJECT_FORMAT) {
    throw new ValidationError("Файл не является проектом MapGen (нет метки формата)");
  }
  if (raw.version !== PROJECT_VERSION) {
    throw new ValidationError(
      `Неподдерживаемая версия формата: ${String(raw.version)}. Ожидается ${PROJECT_VERSION}.`,
    );
  }
  if (typeof raw.id !== "string" || !raw.id) {
    throw new ValidationError("В проекте отсутствует id");
  }
  if (typeof raw.title !== "string") throw new ValidationError("В проекте отсутствует название");
  if (!isRecord(raw.maps)) throw new ValidationError("В проекте отсутствует список карт");
  if (typeof raw.rootMapId !== "string" || !raw.maps[raw.rootMapId]) {
    throw new ValidationError("В проекте отсутствует корневая карта");
  }
  if (!isIsoDate(raw.createdAt) || !isIsoDate(raw.updatedAt)) {
    throw new ValidationError("В проекте повреждены даты");
  }

  const legend = validateLegend(raw.legend);

  const maps: Record<MapId, MapNode> = {};
  for (const [mapId, rawMap] of Object.entries(raw.maps)) {
    const where = `Карта «${mapId}»`;
    if (!isRecord(rawMap)) throw new ValidationError(`${where}: данные повреждены`);
    if (rawMap.id !== mapId) throw new ValidationError(`${where}: id не совпадает с ключом`);
    if (typeof rawMap.name !== "string" || !rawMap.name) {
      throw new ValidationError(`${where}: нет названия`);
    }
    if (rawMap.parentId !== null && typeof rawMap.parentId !== "string") {
      throw new ValidationError(`${where}: повреждён родитель`);
    }
    if (!Array.isArray(rawMap.entities)) {
      throw new ValidationError(`${where}: список сущностей повреждён`);
    }
    if (!isIsoDate(rawMap.createdAt) || !isIsoDate(rawMap.updatedAt)) {
      throw new ValidationError(`${where}: повреждены даты`);
    }
    maps[mapId] = rawMap as unknown as MapNode;
  }

  // Проверяем сущности и родительские связи после того, как все карты разобраны.
  for (const [mapId, map] of Object.entries(maps)) {
    if (mapId !== raw.rootMapId) {
      if (!map.parentId || !maps[map.parentId]) {
        throw new ValidationError(`Карта «${map.name}» ссылается на отсутствующего родителя`);
      }
    } else if (map.parentId !== null) {
      throw new ValidationError("Корневая карта не должна иметь родителя");
    }
    map.entities = map.entities.map((e, i) => validateEntity(e, maps, `Карта «${map.name}», сущность №${i + 1}`));
    map.primitives = validatePrimitives(map.primitives, legend, `Карта «${map.name}»`);
  }

  raw.markerArchive = validateArchive(raw.markerArchive, "Архив удалённых маркеров");
  raw.legend = legend;

  return raw as unknown as Project;
}
