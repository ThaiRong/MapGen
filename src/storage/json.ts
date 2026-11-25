import { validateHistoryFile, toHistoryFile, type ProjectHistory } from "../core/history";
import { validateProject, ValidationError } from "../core/project";
import type { Project } from "../core/types";

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(contents: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new ValidationError("Файл повреждён: это не JSON");
  }
  return validateProject(raw);
}

export interface SavedProject {
  project: Project;
  history: ProjectHistory | null;
}

/** Сериализует проект вместе с журналом изменений (формат файла .mapkg). */
export function serializeSave(project: Project, history: ProjectHistory): string {
  return JSON.stringify({ ...project, history: toHistoryFile(history) }, null, 2);
}

/**
 * Разбирает файл .mapkg: проект валидируется строго, журнал —
 * толерантно (повреждённая история не мешает открыть проект).
 */
export function deserializeSave(contents: string): SavedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new ValidationError("Файл повреждён: это не JSON");
  }
  const project = validateProject(raw);
  const history = validateHistoryFile(
    (raw as Record<string, unknown>).history,
    project,
  );
  if (history === null) return { project, history: null };
  // Поле history не является частью Project — убираем его из объекта.
  const clean = { ...project } as Record<string, unknown>;
  delete clean.history;
  return { project: clean as unknown as Project, history };
}
