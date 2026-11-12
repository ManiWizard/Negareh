// Owns the native application lifetime; Tauri releases the window and WebView on exit.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod project;
use std::{ffi::OsString, time::Instant};

struct Boot {
    started: Instant,
    report: Option<OsString>,
}

#[tauri::command]
fn ready(
    window: tauri::WebviewWindow,
    boot: tauri::State<'_, Boot>,
    boot_paint_ms: f64,
    frontend_ready_ms: f64,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("readiness is restricted to the main window".into());
    }
    let Some(path) = &boot.report else {
        return Ok(());
    };
    if !boot_paint_ms.is_finite()
        || !frontend_ready_ms.is_finite()
        || boot_paint_ms < 0.0
        || frontend_ready_ms < boot_paint_ms
    {
        return Err("invalid readiness timings".into());
    }
    let elapsed = boot.started.elapsed().as_secs_f64() * 1000.0;
    std::fs::write(
        path,
        format!(r#"{{"nativeReadyMs":{elapsed},"bootPaintMs":{boot_paint_ms},"frontendReadyMs":{frontend_ready_ms}}}"#),
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    let started = Instant::now();
    tauri::Builder::default()
        .manage(Boot {
            started,
            report: std::env::var_os("NEGAREH_BENCH_REPORT"),
        })
        .manage(project::Files::default())
        .invoke_handler(tauri::generate_handler![
            ready,
            project::project_start,
            project::project_open,
            project::project_save,
            project::project_recovery,
            project::project_reset,
            project::automation_geometry
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Negareh");
}
