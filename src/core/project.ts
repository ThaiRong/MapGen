import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type EntityId,
  type LocationLinkEntity,
  type MapId,
  type MapNode,
  type MapScale,
  type MapView,
  type Project,
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

export function deleteMarker(project: Project, mapId: MapId, entityId: EntityId): Project {
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
        entities: map.entities.filter((e) => e.id !== entityId),
      },
    },
  });
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

function validateEntity(raw: unknown, maps: Record<MapId, MapNode>, where: string): LocationLinkEntity {
  if (!isRecord(raw)) throw new ValidationError(`${where}: сущность повреждена`);
  if (raw.kind !== "location-link") throw new ValidationError(`${where}: неизвестный тип сущности`);
  if (typeof raw.id !== "string" || !raw.id) throw new ValidationError(`${where}: у сущности нет id`);
  if (typeof raw.x !== "number" || typeof raw.y !== "number") {
    throw new ValidationError(`${where}: у сущности нет координат`);
  }
  if (typeof raw.label !== "string") throw new ValidationError(`${where}: у сущности нет подписи`);
  if (typeof raw.targetMapId !== "string" || !maps[raw.targetMapId]) {
    throw new ValidationError(`${where}: маркер ссылается на отсутствующую карту`);
  }
  if (!isIsoDate(raw.createdAt) || !isIsoDate(raw.updatedAt)) {
    throw new ValidationError(`${where}: повреждены даты сущности`);
  }
  return raw as unknown as LocationLinkEntity;
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
  }

  return raw as unknown as Project;
}
