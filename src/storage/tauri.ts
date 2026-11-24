import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Project } from "../core/types";
import { deserializeProject, serializeProject } from "./json";
import { ProjectStorage, LoadedProject, UserCancelledError } from "./interface";

const FILE_FILTER = {
  name: "Проект MapGen",
  extensions: ["mapkg"],
};

export class TauriStorage implements ProjectStorage {
  async saveToFile(project: Project, path?: string): Promise<string> {
    let target: string | null | undefined = path;
    if (!target) {
      target = await save({
        title: "Сохранить проект",
        defaultPath: `${project.title || "project"}.mapkg`,
        filters: [FILE_FILTER],
      });
      if (!target) throw new UserCancelledError();
    }
    await invoke("save_project", { path: target, contents: serializeProject(project) });
    return target;
  }

  async loadFromFile(path?: string): Promise<LoadedProject> {
    let target: string | null | undefined = path;
    if (!target) {
      target = await open({
        title: "Открыть проект",
        filters: [FILE_FILTER],
        multiple: false,
      });
      if (!target) throw new UserCancelledError();
    }
    const contents = await invoke<string>("load_project", { path: target });
    return { project: deserializeProject(contents), path: target };
  }

  async saveAutosave(project: Project): Promise<void> {
    await invoke("save_autosave", { contents: serializeProject(project) });
  }

  async loadAutosave(): Promise<Project | null> {
    const contents = await invoke<string | null>("load_autosave");
    if (contents === null) return null;
    return deserializeProject(contents);
  }
}

export function createStorage(): ProjectStorage {
  return new TauriStorage();
}
