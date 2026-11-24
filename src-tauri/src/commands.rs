use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const AUTOSAVE_NAME: &str = "autosave.mapkg";

/// Запись через временный файл: исходный файл остаётся целым,
/// пока новое содержимое полностью не записано.
fn write_via_tmp(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("mapkg.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Не удалось записать временный файл: {e}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Не удалось заменить старый файл: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Не удалось завершить сохранение: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_project(path: String, contents: String) -> Result<(), String> {
    write_via_tmp(Path::new(&path), &contents)
}

#[tauri::command]
pub fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Не удалось прочитать файл: {e}"))
}

fn autosave_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(AUTOSAVE_NAME))
        .map_err(|e| format!("Не удалось определить папку данных приложения: {e}"))
}

#[tauri::command]
pub fn save_autosave(app: AppHandle, contents: String) -> Result<(), String> {
    let path = autosave_path(&app)?;
    write_via_tmp(&path, &contents)
}

#[tauri::command]
pub fn load_autosave(app: AppHandle) -> Result<Option<String>, String> {
    let path = autosave_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Не удалось прочитать автосохранение: {e}")),
    }
}
