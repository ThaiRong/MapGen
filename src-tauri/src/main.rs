mod commands;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::save_project,
            commands::load_project,
            commands::save_autosave,
            commands::load_autosave,
            commands::profile_list,
            commands::profile_read,
            commands::profile_write,
            commands::profile_delete,
        ])
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                std::fs::create_dir_all(&dir)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
