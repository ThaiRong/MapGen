import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ProjectHistory } from "../core/history";
import type { Project } from "../core/types";
import { deserializeSave, serializeSave } from "./json";
import { ProjectStorage, LoadedProject, UserCancelledError } from "./interface";

const FILE_FILTER = {
  name: "Проект MapGen",
  extensions: ["mapkg"],
};

export class TauriStorage implements ProjectStorage {
  async saveToFile(project: Project, history: ProjectHistory, path?: string): Promise<string> {
    let target: string | null | undefined = path;
    if (!target) {
      target = await save({
        title: "Сохранить проект",
        defaultPath: `${project.title || "project"}.mapkg`,
        filters: [FILE_FILTER],
      });
      if (!target) throw new UserCancelledError();
    }
    await invoke("save_project", { path: target, contents: serializeSave(project, history) });
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
    return { ...deserializeSave(contents), path: target };
  }

  async saveAutosave(project: Project, history: ProjectHistory): Promise<void> {
    await invoke("save_autosave", { contents: serializeSave(project, history) });
  }

  async loadAutosave(): Promise<LoadedProject | null> {
    const contents = await invoke<string | null>("load_autosave");
    if (contents === null) return null;
    const parsed = deserializeSave(contents);
    return { ...parsed, path: "" };
  }
}

export function createStorage(): ProjectStorage {
  return new TauriStorage();
}
