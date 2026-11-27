import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface ProfileMeta {
  id: string;
  name: string;
  updatedAt: number;
}

/** Список профилей библиотеки (~/.mapgen/profiles, индекс от Rust). */
export async function listProfiles(): Promise<ProfileMeta[]> {
  return invoke<ProfileMeta[]>("profile_list");
}

export async function readProfile(id: string): Promise<string> {
  return invoke<string>("profile_read", { id });
}

export async function writeProfile(id: string, contents: string): Promise<void> {
  await invoke("profile_write", { id, contents });
}

export async function deleteProfile(id: string): Promise<void> {
  await invoke("profile_delete", { id });
}

/** Экспорт профиля в JSON-файл через диалог. Переиспользуем атомарную запись. */
export async function exportProfileToFile(id: string, name: string, contents: string): Promise<void> {
  const target = await save({
    title: "Экспорт профиля",
    defaultPath: `${name || id}.profile.json`,
    filters: [{ name: "Профиль MapGen", extensions: ["json"] }],
  });
  if (!target) throw new UserCancelledProfile();
  await invoke("save_project", { path: target, contents });
}

/** Импорт профиля из JSON-файла; возвращает содержимое файла. */
export async function importProfileFromFile(): Promise<string> {
  const target = await open({
    title: "Импорт профиля",
    filters: [{ name: "Профиль MapGen", extensions: ["json"] }],
    multiple: false,
  });
  if (!target) throw new UserCancelledProfile();
  return invoke<string>("load_project", { path: target });
}

export class UserCancelledProfile extends Error {
  constructor() {
    super("Действие отменено пользователем");
    this.name = "UserCancelledProfile";
  }
}
