use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const AUTOSAVE_NAME: &str = "autosave.mapkg";
const PLAYER_WINDOW_LABEL: &str = "player";

/// Окно игрока (итерация 8): отдельное окно с тем же фронтендом
/// в режиме ?player=1. Переключатель: открыть/закрыть.
#[tauri::command]
pub fn toggle_player_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PLAYER_WINDOW_LABEL) {
        window.close().map_err(|e| format!("Не удалось закрыть окно игрока: {e}"))?;
        return Ok(false);
    }
    let url = WebviewUrl::App("index.html?player=1".into());
    WebviewWindowBuilder::new(&app, PLAYER_WINDOW_LABEL, url)
        .title("MapGen — окно игрока")
        .inner_size(1024.0, 700.0)
        .min_inner_size(640.0, 420.0)
        .build()
        .map_err(|e| format!("Не удалось открыть окно игрока: {e}"))?;
    Ok(true)
}

/// Открыто ли окно игрока (для индикации в интерфейсе мастера).
#[tauri::command]
pub fn player_window_open(app: AppHandle) -> bool {
    app.get_webview_window(PLAYER_WINDOW_LABEL).is_some()
}

/* ---------- Библиотека профилей: ~/.mapgen/profiles ---------- */

fn profiles_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Не удалось определить домашнюю папку")?;
    let dir = home.join(".mapgen").join("profiles");
    fs::create_dir_all(&dir).map_err(|e| format!("Не удалось создать папку профилей: {e}"))?;
    Ok(dir)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub updated_at: f64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct ProfileIndex {
    #[serde(default)]
    profiles: Vec<ProfileMeta>,
}

/// Сканирует папку профилей и перестраивает индекс (id + name из файлов).
fn rebuild_index(dir: &Path) -> Result<ProfileIndex, String> {
    let mut index = ProfileIndex::default();
    let entries = fs::read_dir(dir).map_err(|e| format!("Не удалось прочитать папку профилей: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("index.json") {
            continue;
        }
        let contents = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed: serde_json::Value = match serde_json::from_str(&contents) {
            Ok(v) => v,
            Err(_) => continue, // битый файл — индекс не строим, UI пометит при чтении
        };
        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let updated_at = parsed
            .get("updatedAt")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if !id.is_empty() {
            index.profiles.push(ProfileMeta { id, name, updated_at });
        }
    }
    index.profiles.sort_by(|a, b| b.updated_at.total_cmp(&a.updated_at));
    if let Ok(text) = serde_json::to_string_pretty(&index) {
        let _ = fs::write(index_path(dir), text);
    }
    Ok(index)
}

#[tauri::command]
pub fn profile_list() -> Result<Vec<ProfileMeta>, String> {
    let dir = profiles_dir()?;
    let index_file = index_path(&dir);
    if index_file.exists() {
        if let Ok(text) = fs::read_to_string(&index_file) {
            if let Ok(index) = serde_json::from_str::<ProfileIndex>(&text) {
                // Проверяем, что файлы на месте; иначе пересборка.
                let alive: Vec<ProfileMeta> = index
                    .profiles
                    .into_iter()
                    .filter(|p| dir.join(format!("{}.json", p.id)).exists())
                    .collect();
                if !alive.is_empty() || dir.join("index.json").exists() {
                    return Ok(alive);
                }
            }
        }
    }
    rebuild_index(&dir).map(|i| i.profiles)
}

#[tauri::command]
pub fn profile_read(id: String) -> Result<String, String> {
    let dir = profiles_dir()?;
    fs::read_to_string(dir.join(format!("{id}.json"))).map_err(|e| format!("Не удалось прочитать профиль: {e}"))
}

#[tauri::command]
pub fn profile_write(id: String, contents: String) -> Result<(), String> {
    let dir = profiles_dir()?;
    // Валидация JSON до записи.
    serde_json::from_str::<serde_json::Value>(&contents).map_err(|e| format!("Профиль не является JSON: {e}"))?;
    write_via_tmp(&dir.join(format!("{id}.json")), &contents)?;
    let _ = rebuild_index(&dir);
    Ok(())
}

#[tauri::command]
pub fn profile_delete(id: String) -> Result<(), String> {
    let dir = profiles_dir()?;
    let path = dir.join(format!("{id}.json"));
    match fs::remove_file(&path) {
        Ok(()) => {
            let _ = rebuild_index(&dir);
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Err("Профиль не найден".to_string()),
        Err(e) => Err(format!("Не удалось удалить профиль: {e}")),
    }
}

/// Запись через временный файл: исходный файл остаётся целым,
/// пока новое содержимое полностью не записано.
fn write_via_tmp(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
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
