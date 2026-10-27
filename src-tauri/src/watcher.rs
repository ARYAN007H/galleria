use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;

const DEBOUNCE_MS: u64 = 500;
const MAX_BATCH_PATHS: usize = 200;

#[derive(Default)]
struct WatchBuffer {
    added: HashSet<PathBuf>,
    removed: HashSet<PathBuf>,
    renamed: Vec<(PathBuf, PathBuf)>,
}

pub struct LibraryWatcher {
    _watcher: RecommendedWatcher,
}

fn is_media(path: &Path) -> bool {
    const EXT: &[&str] = &[
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "tif", "heic", "heif", "raw", "arw",
        "cr2", "nef", "dng", "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "3gp",
    ];
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| EXT.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Start watching library roots; coalesces FS events and emits `library-batch-changed`.
pub fn start_library_watcher(
    app: AppHandle,
    watch_paths: Vec<String>,
) -> Result<LibraryWatcher, String> {
    let buffer: Arc<Mutex<WatchBuffer>> = Arc::new(Mutex::new(WatchBuffer::default()));
    let buffer_flush = buffer.clone();
    let app_flush = app.clone();

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(DEBOUNCE_MS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            let batch = {
                let mut buf = buffer_flush.lock().unwrap();
                if buf.added.is_empty() && buf.removed.is_empty() && buf.renamed.is_empty() {
                    continue;
                }
                let added: Vec<String> = buf.added.drain().map(|p| p.to_string_lossy().to_string()).collect();
                let removed: Vec<String> = buf.removed.drain().map(|p| p.to_string_lossy().to_string()).collect();
                let renamed: Vec<(String, String)> = buf
                    .renamed
                    .drain(..)
                    .map(|(a, b)| (a.to_string_lossy().to_string(), b.to_string_lossy().to_string()))
                    .collect();
                (added, removed, renamed)
            };
            if let Err(e) = crate::commands::flush_library_batch(&app_flush, batch.0, batch.1, batch.2).await
            {
                eprintln!("  ⚠ library batch flush failed: {}", e);
            }
        }
    });

    let buffer_notify = buffer.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
            Ok(event) => push_event(&buffer_notify, &event),
            Err(e) => eprintln!("  ⚠ File watcher error: {}", e),
        }
    })
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    for dir in &watch_paths {
        let p = Path::new(dir);
        if p.exists() && p.is_dir() {
            watcher
                .watch(p, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", dir, e))?;
            eprintln!("  👁 Watching library: {}", dir);
        }
    }

    Ok(LibraryWatcher { _watcher: watcher })
}

fn push_event(buffer: &Arc<Mutex<WatchBuffer>>, event: &Event) {
    let mut buf = buffer.lock().unwrap();
    let total = buf.added.len() + buf.removed.len() + buf.renamed.len();

    match event.kind {
        EventKind::Create(_) => {
            for path in &event.paths {
                if is_media(path) {
                    buf.added.insert(path.clone());
                    buf.removed.remove(path);
                }
            }
        }
        EventKind::Remove(_) => {
            for path in &event.paths {
                if is_media(path) {
                    buf.removed.insert(path.clone());
                    buf.added.remove(path);
                }
            }
        }
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
            if event.paths.len() >= 2 {
                let from = event.paths[0].clone();
                let to = event.paths[1].clone();
                if is_media(&from) || is_media(&to) {
                    buf.renamed.push((from, to));
                }
            } else {
                for path in &event.paths {
                    if is_media(path) {
                        if path.exists() {
                            buf.added.insert(path.clone());
                        } else {
                            buf.removed.insert(path.clone());
                        }
                    }
                }
            }
        }
        _ => {}
    }

    // Early flush if buffer is large (SD card dump)
    if total + buf.added.len() + buf.removed.len() + buf.renamed.len() >= MAX_BATCH_PATHS {
        // Next interval tick will flush; buffer is full enough
    }
}

/// Pause/resume handled via global flag in commands
#[allow(dead_code)]
pub fn set_watcher_paused(_paused: bool) {}
