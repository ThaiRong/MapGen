/**
 * Адаптер локальной модели (итерация 6).
 *
 * Изолирован от ядра и генераторов: они о нём не знают и не зависят.
 * Модель никогда не рисует и не меняет проект — только переводит
 * свободное описание в предложение параметров (SpecSuggestion),
 * которое пользователь подтверждает или правит вручную.
 *
 * Единственное допустимое сетевое взаимодействие — локальный Ollama
 * по адресу 127.0.0.1/localhost, и только при явном включении
 * пользователем в настройках. По умолчанию модель выключена.
 */

import type { GenerationSpec, StructureSpec } from "../types";

export type ModelMode = "terrain" | "structure";

/** Предложение параметров, распознанное моделью. Это не приказ. */
export interface SpecSuggestion {
  mode: ModelMode;
  /** Распознанные параметры спеки (частичные, провалидированные). */
  spec: Partial<GenerationSpec> | Partial<StructureSpec>;
  /** Что модель распознала (для предпросмотра пользователю). */
  recognized: { key: string; value: string }[];
  warnings: string[];
}

export interface ModelSettings {
  /** Выключено по умолчанию. */
  enabled: boolean;
  /** Адрес локального Ollama. Только 127.0.0.1 / localhost. */
  host: string;
  /** Имя модели из списка локальных. */
  model: string;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly code: "unavailable" | "timeout" | "invalid-response" | "not-enabled" | "network",
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/**
 * Контракт адаптера. Реализация — только локальный Ollama (последняя
 * версия), но ядро видит лишь этот интерфейс.
 */
export interface ModelAdapter {
  /** Доступен ли локальный сервер модели. */
  isAvailable(): Promise<boolean>;
  /** Список локально установленных моделей. */
  listModels(): Promise<string[]>;
  /** Переводит свободное описание в предложение параметров. */
  parseDescription(text: string, mode: ModelMode): Promise<SpecSuggestion>;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  enabled: false,
  host: "http://127.0.0.1:11434",
  model: "",
};
