import type { EntityId, LocationLinkEntity, MapId, Primitive, Project } from "./types";
import { validateProject } from "./project";

export type OperationType =
  | "project.created"
  | "project.loaded"
  | "project.saved"
  | "map.created"
  | "map.renamed"
  | "map.deleted"
  | "map.scale"
  | "marker.created"
  | "marker.renamed"
  | "marker.moved"
  | "marker.deleted"
  | "marker.restored"
  | "primitive.created"
  | "primitive.moved"
  | "primitive.updated"
  | "primitive.deleted"
  | "primitive.restored"
  | "legend.created"
  | "legend.updated"
  | "legend.deleted"
  | "archive.entryDeleted"
  | "archive.cleared"
  | "map.generated"
  | "profile.applied"
  | "marker.kindChanged"
  | "fog.changed"
  | "entity.playerVisible";

export interface MarkerRestoreInfo {
  kind: "marker";
  sourceMapId: MapId;
  entity: LocationLinkEntity;
}

export interface PrimitiveRestoreInfo {
  kind: "primitive";
  mapId: MapId;
  primitive: Primitive;
}

/** Данные для восстановления удалённого объекта прямо из записи истории. */
export type HistoryRestoreInfo = MarkerRestoreInfo | PrimitiveRestoreInfo;

/**
 * Одна запись журнала: что случилось, когда и в каком состоянии
 * оказался проект после этого. Переход к записи = переход проекта
 * к её снимку (как панель History в Photoshop).
 */
export interface HistoryEntry {
  id: string;
  timestamp: string;
  operationType: OperationType;
  description: string;
  mapId: MapId | null;
  entityId: EntityId | null;
  snapshot: Project;
  restoreInfo?: HistoryRestoreInfo;
  /**
   * Ключ коалесцирования: если последняя применённая запись имеет тот же
   * ключ (например, «legend:<typeId>» при непрерывной правке типа легенды),
   * новая запись ЗАМЕНЯЕТ её — в истории остаётся только конечное
   * состояние непрерывной правки.
   */
  coalesceKey?: string;
}

/**
 * Линейный журнал с текущей позицией.
 * position = индекс применённой записи; -1 означает базовое состояние
 * (проект до первой записи). Записи после position — отменённая
 * ветвь, которую следующее действие перезапишет.
 */
export interface ProjectHistory {
  base: Project;
  entries: HistoryEntry[];
  position: number;
}

export const HISTORY_LIMIT = 100;

export function createHistory(base: Project): ProjectHistory {
  return { base, entries: [], position: -1 };
}

export interface EntryInput {
  operationType: OperationType;
  description: string;
  mapId?: MapId | null;
  entityId?: EntityId | null;
  restoreInfo?: HistoryRestoreInfo;
  coalesceKey?: string;
}

export function makeEntry(input: EntryInput, snapshot: Project): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    operationType: input.operationType,
    description: input.description,
    mapId: input.mapId ?? null,
    entityId: input.entityId ?? null,
    snapshot,
    ...(input.restoreInfo ? { restoreInfo: input.restoreInfo } : null),
    ...(input.coalesceKey ? { coalesceKey: input.coalesceKey } : null),
  };
}

/**
 * Добавляет запись в журнал. Отменённая ветвь (записи после position)
 * отсекается. При превышении HISTORY_LIMIT самые старые записи
 * вытесняются — базовым становится состояние на момент последней
 * вытесненной записи, поэтому глубина отката ограничена, а файл
 * проекта не раздувается бесконечно.
 */
export function record(history: ProjectHistory, entry: HistoryEntry): ProjectHistory {
  // Коалесцирование: непрерывная правка одного объекта (тот же ключ,
  // позиция в конце журнала) заменяет последнюю запись — фиксируется
  // только конечное состояние, а не каждый промежуточный шаг.
  const atEnd = history.position === history.entries.length - 1;
  if (entry.coalesceKey && atEnd && history.position >= 0) {
    const last = history.entries[history.position];
    if (last.coalesceKey === entry.coalesceKey) {
      const entries = [...history.entries.slice(0, -1), entry];
      return { ...history, entries, position: entries.length - 1 };
    }
  }
  const kept = history.entries.slice(0, history.position + 1);
  let entries = [...kept, entry];
  let base = history.base;
  if (entries.length > HISTORY_LIMIT) {
    const overflow = entries.length - HISTORY_LIMIT;
    base = entries[overflow - 1].snapshot;
    entries = entries.slice(overflow);
  }
  return { base, entries, position: entries.length - 1 };
}

export function canUndo(history: ProjectHistory): boolean {
  return history.position >= 0;
}

export function canRedo(history: ProjectHistory): boolean {
  return history.position < history.entries.length - 1;
}

export interface HistoryStep {
  history: ProjectHistory;
  project: Project;
}

/**
 * Перемещает позицию журнала. Индекс -1 — базовое состояние.
 * Индексы за пределами диапазона прижимаются к границам.
 */
export function jumpTo(history: ProjectHistory, index: number): HistoryStep {
  const clamped = Math.max(-1, Math.min(index, history.entries.length - 1));
  const project = clamped < 0 ? history.base : history.entries[clamped].snapshot;
  return { history: { ...history, position: clamped }, project };
}

export function undo(history: ProjectHistory): HistoryStep | null {
  if (!canUndo(history)) return null;
  return jumpTo(history, history.position - 1);
}

export function redo(history: ProjectHistory): HistoryStep | null {
  if (!canRedo(history)) return null;
  return jumpTo(history, history.position + 1);
}

/* ---------- Сохранение в файл проекта ---------- */

export const HISTORY_FILE_FORMAT = "mapgen-history";
export const HISTORY_FILE_VERSION = 1;

interface HistoryFile {
  format: typeof HISTORY_FILE_FORMAT;
  version: typeof HISTORY_FILE_VERSION;
  base: Project;
  entries: HistoryEntry[];
  position: number;
}

export function toHistoryFile(history: ProjectHistory): HistoryFile {
  return {
    format: HISTORY_FILE_FORMAT,
    version: HISTORY_FILE_VERSION,
    base: history.base,
    entries: history.entries,
    position: history.position,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OPERATION_TYPES = new Set<string>([
  "project.created",
  "project.loaded",
  "project.saved",
  "map.created",
  "map.renamed",
  "map.deleted",
  "map.scale",
  "marker.created",
  "marker.renamed",
  "marker.moved",
  "marker.deleted",
  "marker.restored",
  "primitive.created",
  "primitive.moved",
  "primitive.updated",
  "primitive.deleted",
  "primitive.restored",
  "legend.created",
  "legend.updated",
  "legend.deleted",
  "archive.entryDeleted",
  "archive.cleared",
  "map.generated",
  "profile.applied",
  "marker.kindChanged",
  "fog.changed",
  "entity.playerVisible",
]);

function isIsoDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function tryValidateEntry(raw: unknown): HistoryEntry | null {
  try {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || !raw.id) return null;
    const timestamp = raw.timestamp;
    if (typeof timestamp !== "string" || !isIsoDate(timestamp)) return null;
    if (typeof raw.operationType !== "string" || !OPERATION_TYPES.has(raw.operationType)) {
      return null;
    }
    if (typeof raw.description !== "string") return null;
    if (raw.mapId !== null && typeof raw.mapId !== "string") return null;
    if (raw.entityId !== null && typeof raw.entityId !== "string") return null;
    // Снимок записи должен быть валидным проектом; иначе запись бесполезна.
    const snapshot = validateProject(raw.snapshot);
    let restoreInfo: HistoryRestoreInfo | undefined;
    if (raw.restoreInfo !== undefined) {
      const ri = raw.restoreInfo;
      if (!isRecord(ri)) return null;
      if (ri.kind === "primitive") {
        // Восстановление примитива: нужны карта и сам примитив.
        if (typeof ri.mapId !== "string" || !ri.mapId) return null;
        const rp = ri.primitive;
        if (!isRecord(rp)) return null;
        if (rp.kind !== "point" && rp.kind !== "line" && rp.kind !== "area" && rp.kind !== "label") {
          return null;
        }
        if (typeof rp.id !== "string" || !rp.id) return null;
        restoreInfo = {
          kind: "primitive",
          mapId: ri.mapId,
          primitive: rp as unknown as Primitive,
        };
      } else {
        // Маркер. Файлы до 1.5.2 хранили restoreInfo без kind —
        // распознаём их по наличию sourceMapId + entity.
        if (typeof ri.sourceMapId !== "string" || !ri.sourceMapId) return null;
        const re = ri.entity;
        if (!isRecord(re)) return null;
        if (re.kind !== "location-link") return null;
        if (typeof re.id !== "string" || typeof re.x !== "number" || typeof re.y !== "number") {
          return null;
        }
        if (typeof re.label !== "string" || typeof re.targetMapId !== "string") return null;
        restoreInfo = {
          kind: "marker",
          sourceMapId: ri.sourceMapId,
          entity: re as unknown as LocationLinkEntity,
        };
      }
    }
    return {
      id: raw.id,
      timestamp,
      operationType: raw.operationType as OperationType,
      description: raw.description,
      mapId: (raw.mapId as MapId | null) ?? null,
      entityId: (raw.entityId as EntityId | null) ?? null,
      snapshot,
      ...(typeof raw.coalesceKey === "string" ? { coalesceKey: raw.coalesceKey } : null),
      ...(restoreInfo ? { restoreInfo } : null),
    };
  } catch {
    return null;
  }
}

/**
 * Разбирает историю из файла проекта. Толерантна: повреждённая
 * история никогда не ломает загрузку — возвращается null, и вызывающий
 * код начинает журнал заново, сохраняя архив удалённых маркеров
 * (он живёт в проекте, а не в истории).
 */
export function validateHistoryFile(raw: unknown, fallbackBase: Project): ProjectHistory | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return null;
  if (raw.format !== HISTORY_FILE_FORMAT) return null;
  if (raw.version !== HISTORY_FILE_VERSION) return null;

  let base: Project;
  try {
    base = validateProject(raw.base);
  } catch {
    base = fallbackBase;
  }

  if (!Array.isArray(raw.entries)) return null;
  const entries: HistoryEntry[] = [];
  for (const rawEntry of raw.entries) {
    const entry = tryValidateEntry(rawEntry);
    if (entry) entries.push(entry);
  }

  let position = typeof raw.position === "number" ? Math.floor(raw.position) : entries.length - 1;
  position = Math.max(-1, Math.min(position, entries.length - 1));

  return { base, entries, position };
}
