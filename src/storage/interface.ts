import type { ProjectHistory } from "../core/history";
import type { Project } from "../core/types";

export class UserCancelledError extends Error {
  constructor() {
    super("Действие отменено пользователем");
    this.name = "UserCancelledError";
  }
}

export interface LoadedProject {
  project: Project;
  /** Журнал изменений из файла; null, если в файле его нет или он повреждён. */
  history: ProjectHistory | null;
  path: string;
}

/**
 * Слой хранения намеренно отделён от остального кода:
 * формат .mapkg (пока чистый JSON) позже сменится на JSON + бинарные
 * чанки + LZ4 — вызывающий код это не затронет.
 */
export interface ProjectStorage {
  /** Сохраняет проект с журналом изменений в файл. Без path показывает диалог «Сохранить как». */
  saveToFile(project: Project, history: ProjectHistory, path?: string): Promise<string>;
  /** Загружает проект из файла. Без path показывает диалог открытия. */
  loadFromFile(path?: string): Promise<LoadedProject>;
  /** Автосохранение проекта с журналом во внутреннее хранилище приложения. */
  saveAutosave(project: Project, history: ProjectHistory): Promise<void>;
  /** Читает автосохранение; null, если его ещё нет. */
  loadAutosave(): Promise<LoadedProject | null>;
}
