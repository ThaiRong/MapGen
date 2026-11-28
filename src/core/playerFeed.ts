/**
 * Канал «мастер → окно игрока» (итерация 8).
 *
 * Мастер считает проекцию (только раскрытое туманом и разрешённое)
 * и отправляет её событием Tauri. В окно игрока не сериализуется
 * ничего скрытого: ни геометрия, ни названия, ни заметки.
 */

import type { PlayerProjection } from "./projection";
import type { LegendType } from "./types";

export const PLAYER_FEED_EVENT = "player:feed";

export interface PlayerFeedPayload {
  mapId: string;
  mapName: string;
  projection: PlayerProjection;
  /** Стили типов легенды (без служебных данных проекта). */
  legend: LegendType[];
  /** Камера мастера — для режима «следовать за камерой». */
  camera: { centerX: number; centerY: number; zoom: number };
}
