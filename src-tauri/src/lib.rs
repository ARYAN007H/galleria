pub mod commands;
pub mod develop;
mod curation;
mod db;
mod scan;
mod thumb;
mod watcher;

use tauri::Manager;



pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            commands::setup_state(app.handle());
            app.handle().manage(develop::EditorState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_and_index,
            commands::get_categories,
            commands::get_months,
            commands::get_photos,
            commands::search_photos,
            commands::get_thumbnail_path,
            commands::get_index_progress,
            commands::get_current_library_path,
            commands::scan_default_directories,
            commands::get_all_photos,
            commands::get_photo_count,
            commands::get_libraries,
            commands::restore_session,
            commands::add_library_path,
            commands::remove_library_path,
            commands::get_library_paths,
            commands::toggle_favorite,
            commands::soft_delete_photos,
            commands::restore_photos,
            commands::get_photo_detail,
            // File operations
            commands::hard_delete_photos,
            commands::rename_photo,
            // Tags
            commands::create_tag,
            commands::delete_tag,
            commands::get_tags,
            commands::tag_photos,
            commands::untag_photos,
            commands::get_photo_tags,
            // Albums
            commands::create_album,
            commands::delete_album,
            commands::rename_album,
            commands::get_albums,
            commands::add_to_album,
            commands::remove_from_album,
            commands::get_album_photos,
            // Photo editor
            commands::save_edited_photo,
            commands::save_edit_params,
            commands::load_edit_params,
            // Image processing (LightCraft engine)
            develop::load_editor_source,
            develop::unload_editor_source,
            develop::process_image,
            develop::compute_histogram,
            develop::auto_enhance,
            develop::export_image,
            develop::write_xmp_sidecar,
            develop::read_xmp_sidecar,
            // Performance & streaming
            commands::scan_directory,
            commands::get_system_info,
            commands::get_trash_photos,
            commands::get_timeline_density,
            commands::get_photo_locations,
            commands::search_with_facets,
            commands::create_photo_variant,
            commands::get_photo_variants,
            commands::delete_photo_variant,
            commands::get_duplicate_groups,
            commands::run_phash_indexing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
