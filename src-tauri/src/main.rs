// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Disables the faulty DMA-BUF renderer typically causing crashes on Nvidia/Linux
        // while safely keeping OpenGL compositing enabled for high performance CSS transforms!
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        // AppImages bundle Ubuntu 22.04's WebKitGTK, whose EGL display creation fails
        // on Nvidia + Wayland ("EGL_BAD_PARAMETER" → grey window). Fall back to
        // software GL for the webview only; the editing engine still uses Vulkan/wgpu.
        if std::path::Path::new("/proc/driver/nvidia/version").exists() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        }
    }

    galleria_expressive::run()
}
