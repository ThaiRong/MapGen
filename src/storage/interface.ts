import type { Project } from "../core/types";

export class UserCancelledError extends Error {
  constructor() {
    super("Действие отменено пользователем");
    this.name = "UserCancelledError";
  }
}

export interface LoadedProject {
  project: Project;
  path: string;
}

/**
 * Слой хранения намеренно отделён от остального кода:
 * формат .mapkg (пока чистый JSON) позже сменится на JSON + бинарные
 * чанки + LZ4 — вызывающий код это не затронет.
 */
export interface ProjectStorage {
  /** Сохраняет проект в файл. Без path показывает диалог «Сохранить как». */
  saveToFile(project: Project, path?: string): Promise<string>;
  /** Загружает проект из файла. Без path показывает диалог открытия. */
  loadFromFile(path?: string): Promise<LoadedProject>;
  /** Автосохранение во внутреннее хранилище приложения. */
  saveAutosave(project: Project): Promise<void>;
  /** Читает автосохранение; null, если его ещё нет. */
  loadAutosave(): Promise<Project | null>;
}
