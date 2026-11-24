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
