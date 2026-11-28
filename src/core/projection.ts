/**
 * Проекция карты для окна игрока (итерация 7, фаза 7.5; окно — итерация 8).
 *
 * Видимость сущности для игрока = НЕ скрыта туманом нужной категории
 * И флаг «показывать игрокам» не снят. Скрытые сущности НЕ попадают в
 * проекцию вообще — ни геометрия, ни названия, ни заметки: фильтрация
 * выполняется здесь, в основном процессе, до передачи в окно игрока.
 * Чистые функции.
 */

import { fogHidesPoint } from "./fog";
import type { FogCategory, MapNode, Primitive } from "./types";

/** Категория тумана для вида примитива. */
export function fogCategoryOfPrimitive(kind: Primitive["kind"]): FogCategory {
  // Ландшафт — области; топография — линии, точки, подписи.
  return kind === "area" ? "landscape" : "topography";
}

/** Категория тумана для маркеров-локаций — интерактивные элементы. */
export const FOG_CATEGORY_MARKERS: FogCategory = "objects";

/** Видна ли примитив игроку: туман её категории + флаг playerVisible. */
export function primitiveVisibleToPlayer(map: MapNode, primitive: Primitive): boolean {
  if (primitive.playerVisible === false) return false;
  const category = fogCategoryOfPrimitive(primitive.kind);
  if (primitive.kind === "line" || primitive.kind === "area") {
    // Сущность видна, если хотя бы одна её точка раскрыта.
    return primitive.points.some((p) => !fogHidesPoint(map.fog, category, p.x, p.y));
  }
  return !fogHidesPoint(map.fog, category, primitive.x, primitive.y);
}

/** Виден ли маркер игроку. */
export function markerVisibleToPlayer(map: MapNode, x: number, y: number, playerVisible?: boolean): boolean {
  if (playerVisible === false) return false;
  return !fogHidesPoint(map.fog, FOG_CATEGORY_MARKERS, x, y);
}

export interface PlayerProjection {
  id: string;
  name: string;
  primitives: Primitive[];
  markers: { id: string; x: number; y: number; label: string; targetMapId: string }[];
}

/**
 * Строит проекцию карты для игрока: только раскрытые туманом и явно
 * разрешённые сущности. Заметки (note) в проекцию не входят вовсе.
 */
export function projectForPlayer(map: MapNode): PlayerProjection {
  return {
    id: map.id,
    name: map.name,
    primitives: map.primitives.filter((p) => primitiveVisibleToPlayer(map, p)),
    markers: map.entities
      .filter((e) => markerVisibleToPlayer(map, e.x, e.y, e.playerVisible))
      .map((e) => ({ id: e.id, x: e.x, y: e.y, label: e.label, targetMapId: e.targetMapId })),
  };
}
