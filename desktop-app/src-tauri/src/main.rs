// VoiceZettel Desktop — Tauri Main (Rust)
//
// Antigravity-compatible:
// - Window HIDES on blur/minimize — pre-warmed WebRTC stays alive
// - Global shortcut: Ctrl+Shift+Space to toggle visibility
// - Always on top when visible

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Register global shortcut: Ctrl+Shift+Space
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

            let shortcut: Shortcut = "CmdOrCtrl+Shift+Space".parse().unwrap();
            let app_handle = app.handle().clone();

            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
