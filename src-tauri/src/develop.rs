//! Galleria's develop engine, built on the LightCraft pipeline.
//!
//! Rendering: LightCraft v0.14.0 — https://github.com/storytold/lightcraft
//! © storytold / ArtCraft contributors, MIT OR Apache-2.0 (used under Apache-2.0).
//! The local checkout (`../../lightcraft`, commit 03c88c16) is the pinned source.
//!
//! Every preview goes through the scene-referred linear Rec.2020 pipeline:
//! decode (RAW demosaic + camera colour model, or rendered codecs) →
//! `render_cached` (StageCache keeps a slider drag to the per-pixel stage) →
//! display-encoded sRGB RGBA8 + histogram. Exports re-decode at full size and
//! encode through LightCraft's codecs (JPEG / PNG / TIFF / lossless WebP).

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use lightcraft_codecs::encode::{self, ChromaSubsampling, EncodeImage, EncodeMeta, TiffCompression};
use lightcraft_develop::DevelopSettings;
use lightcraft_pipeline::{Quality, RenderRequest, SourceInfo, StageCache, render};
use lightcraft_raster::Rgb32f;

/// Long edge (px) of the decoded editing proxy. The original's long edge is kept in
/// `SourceInfo::native_long` so previews scale detail (NR radii etc.) like the original.
const EDITOR_PROXY_EDGE: usize = 2816;

/// Previews at or under this many pixels travel as base64 RGBA over IPC; larger
/// renders (full-res "Save Copy") go through a temp JPEG, as before the swap.
const PIXELS_B64_LIMIT: usize = 2_000_000;

pub struct EditorState {
    loaded: Mutex<Option<Arc<Loaded>>>,
    counter: AtomicU64,
}

struct Loaded {
    path: String,
    src: Arc<Rgb32f>,
    info: SourceInfo,
    cache: Arc<StageCache>,
}

impl Default for EditorState {
    fn default() -> Self {
        Self { loaded: Mutex::new(None), counter: AtomicU64::new(0) }
    }
}

/// The original's long edge without decoding pixels: the file header for rendered
/// formats, the raw's declared developed size for RAWs. Orientation-invariant (max of
/// w/h). Falls back to the decoded proxy's long edge.
fn native_long_edge(bytes: &[u8], proxy: &Rgb32f) -> usize {
    let from_raw = lightcraft_raw::probe(bytes)
        .and_then(|_| lightcraft_raw::probe_info(bytes).ok())
        .map(|info| {
            let (w, h) = info.developed_size();
            w.max(h)
        });
    let from_header = lightcraft_codecs::read_header(bytes).ok().map(|h| h.width.max(h.height) as usize);
    from_raw.or(from_header).unwrap_or(proxy.width.max(proxy.height)).max(1)
}

fn load_photo(path: &str, max_edge: usize) -> Result<(Arc<Rgb32f>, SourceInfo), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to open image: {e}"))?;
    let (img, mut info) = lightcraft_engine::files::load_vec(bytes.clone(), max_edge)?;
    let native = native_long_edge(&bytes, &img);
    info.native_long = Some(native);
    Ok((Arc::new(img), info))
}

/// Decode `path` into the editor state if it isn't the currently loaded photo.
fn ensure_loaded(state: &EditorState, path: &str) -> Result<Arc<Loaded>, String> {
    let mut guard = state.loaded.lock().map_err(|e| e.to_string())?;
    if let Some(loaded) = guard.as_ref() {
        if loaded.path == path {
            return Ok(loaded.clone());
        }
    }
    let (src, info) = load_photo(path, EDITOR_PROXY_EDGE)?;
    let loaded = Arc::new(Loaded {
        path: path.to_string(),
        src,
        info,
        cache: Arc::new(StageCache::default()),
    });
    *guard = Some(loaded.clone());
    Ok(loaded)
}

fn parse_settings(value: &serde_json::Value) -> Result<DevelopSettings, String> {
    serde_json::from_value(value.clone()).map_err(|e| format!("Invalid develop settings: {e}"))
}

// ── Tauri commands ──

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    /// Proxy dimensions (what the editor canvas shows).
    pub width: usize,
    pub height: usize,
    /// Original file dimensions (pre-proxy; orientation applied where the format declares it).
    pub native_width: usize,
    pub native_height: usize,
    pub raw: bool,
}

#[tauri::command]
pub async fn load_editor_source(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<LoadResult, String> {
    tokio::task::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<EditorState>();
        let loaded = ensure_loaded(&state, &image_path)?;
        // Warm the GPU pipeline while the editor opens (idempotent; the first
        // render would otherwise pay device init).
        lightcraft_gpu::warm_up();
        let native = loaded.info.native_long.unwrap_or(loaded.src.width.max(loaded.src.height)).max(1) as f64;
        let long = loaded.src.width.max(loaded.src.height) as f64;
        // the proxy keeps the original's aspect; recover its w/h from the long edge
        let (w, h) = (loaded.src.width, loaded.src.height);
        let (nw, nh) = if w >= h { (native, native * h as f64 / long) } else { (native * w as f64 / long, native) };
        Ok(LoadResult {
            width: w,
            height: h,
            native_width: nw.round() as usize,
            native_height: nh.round() as usize,
            raw: loaded.info.raw,
        })
    })
    .await
    .map_err(|e| format!("Load error: {e}"))?
}

#[tauri::command]
pub async fn unload_editor_source(state: tauri::State<'_, EditorState>) -> Result<(), String> {
    let mut guard = state.loaded.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistogramResult {
    pub r: Vec<u32>,
    pub g: Vec<u32>,
    pub b: Vec<u32>,
    pub l: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub preview_path: String,
    pub width: usize,
    pub height: usize,
    pub pixels_b64: Option<String>,
    pub histogram: Option<HistogramResult>,
}

fn histogram_of(h: &lightcraft_raster::Histogram) -> HistogramResult {
    HistogramResult { r: h.r.clone(), g: h.g.clone(), b: h.b.clone(), l: h.luma.clone() }
}

/// Render the photo with LightCraft `DevelopSettings` JSON (partials valid: every
/// field defaults). `draft` is true while a slider is being scrubbed (skips the most
/// expensive refinements); `apply_crop` false shows the uncropped image (crop tool).
#[tauri::command]
pub async fn process_image(
    app: tauri::AppHandle,
    image_path: String,
    settings: serde_json::Value,
    draft: Option<bool>,
    max_preview_edge: Option<u32>,
    apply_crop: Option<bool>,
) -> Result<ProcessResult, String> {
    let request_id = {
        use tauri::Manager;
        app.state::<EditorState>().counter.fetch_add(1, Ordering::SeqCst) + 1
    };
    let edge = max_preview_edge.unwrap_or(800).max(64) as usize;
    let mut req = RenderRequest::fit(edge, edge);
    req.quality = if draft.unwrap_or(false) { Quality::Draft } else { Quality::Full };
    req.apply_crop = apply_crop.unwrap_or(true);

    tokio::task::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<EditorState>();
        let latest = state.counter.load(Ordering::SeqCst);
        if latest != request_id {
            return Ok(ProcessResult {
                preview_path: String::new(),
                width: 0,
                height: 0,
                pixels_b64: None,
                histogram: None,
            });
        }
        let loaded = ensure_loaded(&state, &image_path)?;
        let s = parse_settings(&settings)?;
        // LightCraft's own UI entry: renders on the GPU when available (wgpu),
        // CPU fallback otherwise — same StageCache, same output within 1–3 LSB.
        // The CPU-only `pipeline::render_cached` leaves all the heavy stages on
        // the CPU; this is why LightCraft feels instant and we felt slow.
        let rendered = lightcraft_engine::media::develop(&loaded.src, &loaded.info, &s, &req, Some(&loaded.cache), true);
        let img = rendered.image;
        let histogram = Some(histogram_of(&rendered.histogram));
        let (w, h) = (img.width, img.height);
        let pixels: &[u8] = bytemuck::cast_slice(&img.data);
        if pixels.len() / 4 <= PIXELS_B64_LIMIT {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(pixels);
            return Ok(ProcessResult {
                preview_path: String::new(),
                width: w,
                height: h,
                pixels_b64: Some(b64),
                histogram,
            });
        }
        // full-res render: hand the canvas a temp JPEG instead of a huge base64 blob
        let preview_path = std::env::temp_dir().join("galleria_preview.jpg");
        let bytes = encode::encode_jpeg(
            &EncodeImage::rgba8(&img),
            90,
            ChromaSubsampling::S422,
            &EncodeMeta::default(),
        )
        .map_err(|e| format!("Preview encode error: {e}"))?;
        std::fs::write(&preview_path, bytes).map_err(|e| format!("Preview write error: {e}"))?;
        Ok(ProcessResult {
            preview_path: preview_path.to_string_lossy().to_string(),
            width: w,
            height: h,
            pixels_b64: None,
            histogram,
        })
    })
    .await
    .map_err(|e| format!("Processing error: {e}"))?
}

/// Kept for the frontend's pixel-side fallback path.
#[tauri::command]
pub async fn compute_histogram(image_data: Vec<u8>) -> Result<HistogramResult, String> {
    let mut r = vec![0u32; 256];
    let mut g = vec![0u32; 256];
    let mut b = vec![0u32; 256];
    let mut l = vec![0u32; 256];
    for chunk in image_data.chunks(4) {
        if chunk.len() < 4 {
            continue;
        }
        r[chunk[0] as usize] += 1;
        g[chunk[1] as usize] += 1;
        b[chunk[2] as usize] += 1;
        let lum = (0.299 * chunk[0] as f64 + 0.587 * chunk[1] as f64 + 0.114 * chunk[2] as f64) as usize;
        l[lum.min(255)] += 1;
    }
    Ok(HistogramResult { r, g, b, l })
}

/// Auto tone + auto white balance, LightCraft's own analysis (scene log-mean luminance,
/// grey-world white). Returns a `DevelopSettings` patch the frontend merges in.
#[tauri::command]
pub async fn auto_enhance(
    app: tauri::AppHandle,
    image_path: String,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tokio::task::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<EditorState>();
        let loaded = ensure_loaded(&state, &image_path)?;
        let s = parse_settings(&settings)?;
        let tone = lightcraft_pipeline::auto::auto_tone(&loaded.src, &loaded.info, &s);
        let (temp, tint) = lightcraft_pipeline::auto::auto_wb(&loaded.src, &loaded.info);
        Ok(serde_json::json!({
            "light": {
                "exposure": tone.exposure,
                "contrast": tone.contrast,
                "highlights": tone.highlights,
                "shadows": tone.shadows,
                "whites": tone.whites,
                "blacks": tone.blacks
            },
            "color": { "vibrance": tone.vibrance, "saturation": tone.saturation },
            "wb": { "mode": "custom", "temp": temp, "tint": tint }
        }))
    })
    .await
    .map_err(|e| format!("Auto-enhance error: {e}"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub format: String, // "jpeg" | "png" | "webp" | "tiff"
    pub quality: u8,    // 1-100 (JPEG)
    pub max_long_edge: u32, // 0 = full resolution
}

/// The export target is written with the app's privileges; a compromised
/// renderer must not use it to plant files elsewhere. Rules: the extension
/// matches the encoded format, the output sits beside the source, and it never
/// overwrites the original or its edited-copy sidecars.
fn export_target_allowed(input: &std::path::Path, output: &std::path::Path, format: &str) -> Result<(), &'static str> {
    let expected_ext: &[&str] = match format {
        "jpeg" | "jpg" => &["jpg", "jpeg"],
        "png" => &["png"],
        "webp" => &["webp"],
        "tiff" | "tif" => &["tif", "tiff"],
        _ => return Err("Unsupported export format"),
    };
    let matches_ext = output
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| expected_ext.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false);
    if !matches_ext {
        return Err("Export extension does not match the selected format");
    }
    if output == input {
        return Err("Export would overwrite the original");
    }
    let in_parent = input.parent().unwrap_or_else(|| std::path::Path::new("."));
    let out_parent = output.parent().unwrap_or_else(|| std::path::Path::new("."));
    if in_parent != out_parent {
        return Err("Export must be written next to the original photo");
    }
    if let Some(stem) = input.file_stem() {
        for ext in ["jpg", "jpeg", "png", "webp", "tif", "tiff"] {
            if output
                .file_name()
                .map(|n| n == std::ffi::OsStr::new(&format!("{}_edited.{ext}", stem.to_string_lossy())))
                .unwrap_or(false)
            {
                return Err("Export would overwrite an edited copy of the original");
            }
        }
    }
    Ok(())
}

/// Full-quality export: re-decodes the original (never the editor proxy), renders at
/// the requested size through the same pipeline, encodes via LightCraft's codecs.
#[tauri::command]
pub async fn export_image(
    image_path: String,
    settings: serde_json::Value,
    options: ExportOptions,
    output_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // ── Security guard (see `export_target_allowed`) ──
        let in_path = std::path::Path::new(&image_path);
        let out = std::path::Path::new(&output_path);
        export_target_allowed(in_path, out, options.format.to_ascii_lowercase().as_str())
            .map_err(|e| e.to_string())?;

        let (src, info) = load_photo(&image_path, usize::MAX)?;
        let s = parse_settings(&settings)?;
        // Full-size export renders at the pipeline's native output size (never
        // usize::MAX: Frame::fit/sample overflow on an unbounded box).
        let req = if options.max_long_edge > 0 {
            let edge = options.max_long_edge as usize;
            RenderRequest::fit(edge, edge)
        } else {
            let (nw, nh) = lightcraft_pipeline::native_output_size(src.width, src.height, &s);
            RenderRequest::fit(nw.round().max(1.0) as usize, nh.round().max(1.0) as usize)
        };
        let img = render(&src, &info, &s, &req).image;
        let enc = EncodeImage::rgba8(&img);
        let meta = EncodeMeta::default();
        let subsampling = if options.quality >= 90 { ChromaSubsampling::S444 } else { ChromaSubsampling::S422 };
        let bytes = match options.format.to_ascii_lowercase().as_str() {
            "jpeg" | "jpg" => encode::encode_jpeg(&enc, options.quality, subsampling, &meta),
            "png" => encode::encode_png(&enc, &meta),
            "webp" => encode::encode_webp_lossless(&enc, &meta),
            "tiff" | "tif" => encode::encode_tiff(&enc, TiffCompression::Deflate, &meta),
            other => return Err(format!("Unsupported export format: {other}")),
        }
        .map_err(|e| format!("Encode error: {e}"))?;
        std::fs::write(&output_path, bytes).map_err(|e| format!("Export write error: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Export error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use lightcraft_pipeline::render_cached;

    /// Encode a tiny JPEG with LightCraft's codec, load it back through the editor
    /// path and render it with a non-default setting: proves decode → develop →
    /// encode all work inside Galleria's dependency graph.
    #[test]
    fn render_smoke() {
        let img = lightcraft_raster::Rgba8 {
            width: 8,
            height: 8,
            data: vec![[200, 40, 40, 255]; 64],
        };
        let jpg = encode::encode_jpeg(&EncodeImage::rgba8(&img), 92, ChromaSubsampling::S444, &EncodeMeta::default())
            .expect("encode fixture jpeg");
        let (src, info) = lightcraft_engine::files::load_vec(jpg, usize::MAX).expect("decode fixture");
        let mut s = DevelopSettings::default();
        s.light.exposure = 1.0;
        s.color.saturation = 50.0;
        let out = render(&src, &info, &s, &RenderRequest::fit(8, 8));
        assert_eq!(out.image.width, 8);
        assert_eq!(out.image.height, 8);
        assert!(out.histogram.total > 0);
        // exposure +1 EV must brighten the red patch
        assert!(out.image.data[0][0] > img.data[0][0]);
    }

    #[test]
    fn settings_partial_json_parses() {
        let s: DevelopSettings = serde_json::from_value(serde_json::json!({"light": {"exposure": 0.5}})).unwrap();
        assert_eq!(s.light.exposure, 0.5);
        assert_eq!(s.color.vibrance, 0.0); // defaults fill the rest
    }

    /// The exact JSON shape `src/lib/editing/developSettings.ts::toDevelopSettings`
    /// emits (a full edit + a radial mask + B&W + WB preset + crop), through the same
    /// parse the `process_image` command performs, then rendered and encoded — the
    /// wire-contract round trip the live editor depends on.
    #[test]
    fn frontend_payload_round_trip() {
        let payload = serde_json::json!({
            "version": 1,
            "treatment": "bw",
            "wb": { "mode": "custom", "temp": 2850.0, "tint": 0.0 },
            "light": { "exposure": 0.35, "contrast": 12.0, "highlights": -15.0,
                       "shadows": 18.0, "whites": 0.0, "blacks": -5.0 },
            "curve": { "highlights": 0.0, "lights": 0.0, "darks": 0.0, "shadows": 0.0,
                       "split_shadows": 25.0, "split_mid": 50.0, "split_highlights": 75.0,
                       "master": [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.54}, {"x": 1.0, "y": 1.0}],
                       "red": [], "green": [], "blue": [], "refine_saturation": 100.0 },
            "color": { "vibrance": 22.0, "saturation": -8.0 },
            "mixer": { "red": {"hue": 11.1, "sat": 15.0, "lum": 0.0},
                       "blue": {"hue": -5.5, "sat": 0.0, "lum": -8.0} },
            "bw_mix": { "red": 20.0, "orange": 10.0, "yellow": 0.0, "green": -10.0,
                        "aqua": 0.0, "blue": -20.0, "purple": 0.0, "magenta": 0.0 },
            "grading": { "shadows": {"hue": 200.0, "sat": 18.0, "lum": -6.0},
                         "midtones": {"hue": 0.0, "sat": 0.0, "lum": 0.0},
                         "highlights": {"hue": 40.0, "sat": 12.0, "lum": 4.0},
                         "global": {"hue": 0.0, "sat": 0.0, "lum": 0.0},
                         "blending": 50.0, "balance": 0.0 },
            "effects": { "texture": 8.0, "clarity": 14.0, "dehaze": -6.0 },
            "vignette": { "amount": -24.0, "midpoint": 50.0, "roundness": 0.0,
                          "feather": 50.0, "highlights": 0.0, "style": "highlightPriority" },
            "grain": { "amount": 18.0, "size": 15.0, "roughness": 60.0, "seed": 0 },
            "detail": { "sharpen_amount": 40.0, "sharpen_radius": 1.0, "sharpen_detail": 25.0,
                        "sharpen_masking": 0.0, "nr_luminance": 0.0, "nr_detail": 50.0,
                        "nr_contrast": 50.0, "nr_color": 0.0, "nr_color_detail": 50.0,
                        "nr_color_smoothness": 50.0 },
            "optics": { "remove_ca": true, "lens_profile": false,
                        "profile_distortion": 100.0, "profile_vignetting": 100.0,
                        "defringe_purple_amount": 12.0, "defringe_green_amount": 0.0,
                        "distortion": 0.0, "vignetting": 0.0, "vignetting_midpoint": 50.0,
                        "ca_red": 0.0, "ca_blue": 0.0 },
            "calibration": { "shadows_tint": 4.0, "red_hue": 0.0, "red_sat": 0.0,
                             "green_hue": 0.0, "green_sat": 0.0, "blue_hue": 0.0, "blue_sat": 0.0 },
            "crop": { "geometry": { "rect": { "x0": 0.05, "y0": 0.05, "x1": 0.95, "y1": 0.9 },
                                    "angle": 2.5 },
                      "aspect": null, "flip_h": false, "flip_v": false },
            "orientation": "Normal",
            "masks": [{
                "id": 3711820903u64,
                "name": "Face light",
                "visible": true,
                "invert": false,
                "components": [{ "op": "add", "invert": false,
                    "shape": { "kind": "radial", "center": {"x": 0.4, "y": 0.35},
                               "rx": 0.25, "ry": 0.25, "angle": 0.0, "feather": 40.0,
                               "invert": false } }],
                "adjust": { "exposure": 0.4, "clarity": 10.0, "noise": 15.0 }
            }]
        });
        let s = parse_settings(&payload).expect("frontend payload must parse");

        // Render at preview size, both qualities, cropped and uncropped (crop tool view)
        let img = lightcraft_raster::Rgba8 { width: 96, height: 64, data: (0..96 * 64).map(|i| {
            let (x, y) = (i % 96, i / 96);
            [(x * 2) as u8, (y * 3) as u8, 128, 255]
        }).collect() };
        let jpg = encode::encode_jpeg(&EncodeImage::rgba8(&img), 92, ChromaSubsampling::S444, &EncodeMeta::default())
            .expect("fixture encode");
        let (img32, info) = lightcraft_engine::files::load_vec(jpg, usize::MAX).expect("fixture decode");
        let src = std::sync::Arc::new(img32);
        let cache = StageCache::default();

        let mut req = RenderRequest::fit(600, 600);
        req.quality = Quality::Draft; // what a slider drag sends
        let draft = render_cached(&src, &info, &s, &req, &cache);
        assert_eq!(draft.image.width, 600, "draft preview fits the request");
        assert!(draft.histogram.total > 0);

        let full = render_cached(&src, &info, &s, &RenderRequest::fit(600, 600), &cache);
        assert_eq!(full.image.width, 600);

        let mut uncropped = RenderRequest::fit(600, 600);
        uncropped.apply_crop = false; // the crop-tool request
        let unc = render_cached(&src, &info, &s, &uncropped, &cache);
        // same fit size: the crop (10% off the height) must render a shorter frame
        assert!(unc.image.height > full.image.height, "uncropped frame should be taller");

        // Export path: native-size render + JPEG encode of the same settings
        let (nw, nh) = lightcraft_pipeline::native_output_size(src.width, src.height, &s);
        let req = RenderRequest::fit(nw.round().max(1.0) as usize, nh.round().max(1.0) as usize);
        let exported = render(&src, &info, &s, &req).image;
        let bytes = encode::encode_jpeg(&EncodeImage::rgba8(&exported), 95, ChromaSubsampling::S444, &EncodeMeta::default())
            .expect("export encode");
        assert!(bytes.len() > 1000);
    }

    /// Hostile inputs through the editor's load path must return errors, never
    /// panic or hang: a downloaded photo is untrusted input, and a poisoned
    /// decoder would be a denial of service (or worse) on a local app.
    #[test]
    fn malformed_files_fail_clean() {
        let valid = lightcraft_raster::Rgba8 { width: 16, height: 16, data: vec![[80, 90, 100, 255]; 256] };
        let jpeg = encode::encode_jpeg(&EncodeImage::rgba8(&valid), 90, ChromaSubsampling::S420, &EncodeMeta::default())
            .expect("fixture");

        // Valid JPEG truncated mid-stream
        assert!(lightcraft_engine::files::load_vec(jpeg[..jpeg.len() / 2].to_vec(), 512).is_err());

        // PNG signature + garbage
        let mut fake_png = b"\x89PNG\r\n\x1a\n".to_vec();
        fake_png.extend_from_slice(&[0u8; 512]);
        assert!(lightcraft_engine::files::load_vec(fake_png, 512).is_err());

        // Polyglot: GIF header stamped in front of JPEG data
        let mut polyglot = b"GIF89a".to_vec();
        polyglot.extend_from_slice(&jpeg);
        let polyglot_result = lightcraft_engine::files::load_vec(polyglot, 512);
        // Must not panic; error or a safe decode of one of the streams both pass
        let _ = polyglot_result;

        // Random noise (fuzz-style): 64 seeds, any outcome is fine as long as
        // nothing panics and nothing hangs.
        let mut seed: u64 = 0x9E3779B97F4A7C15;
        for _ in 0..64 {
            seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17;
            let bytes: Vec<u8> = (0..256u32).map(|i| (seed.wrapping_mul(i as u64 + 1) >> 24) as u8).collect();
            let _ = lightcraft_engine::files::load_vec(bytes.clone(), 512);
            let _ = native_long_edge(&bytes, &lightcraft_raster::Rgb32f { width: 4, height: 4, data: vec![[0.5; 3]; 16] });
        }
    }

    /// Decompression-bomb guard: a header claiming enormous dimensions must be
    /// refused by the codecs (or decoded within bounded memory) — never OOM the
    /// process. LightCraft's header reader rejects images whose data can't exist.
    #[test]
    fn dimension_bombs_are_refused() {
        // JPEG SOF0 declaring 65535×65535 but carrying almost no scan data
        let mut bomb = vec![0xFF, 0xD8, 0xFF, 0xE0, 0, 16, b'J', b'F', b'I', b'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
        bomb.extend_from_slice(&[0xFF, 0xC0, 0, 17, 8, 0xFF, 0xFF, 0xFF, 0xFF, 3, 0x11, 0, 2, 0x11, 1, 0x11, 0]);
        bomb.extend_from_slice(&[0xFF, 0xD9]);
        let header = lightcraft_codecs::read_header(&bomb);
        // Either an error, or a header whose decode is bounded by the data check
        if let Ok(h) = header {
            // the header reader must not trust dimensions that outstrip the file
            assert!(h.width as u64 * h.height as u64 <= (bomb.len() as u64) * 4_000_000 + 10_000_000);
        }
        assert!(lightcraft_engine::files::load_vec(bomb, 512).is_err());

        // Empty and one-byte files
        assert!(lightcraft_engine::files::load_vec(Vec::new(), 512).is_err());
        assert!(lightcraft_engine::files::load_vec(vec![0xFF], 512).is_err());
    }

    /// Export path guard: the output must sit beside the source, must not
    /// overwrite the original, and must match the format's extension.
    #[test]
    fn export_path_guard_rejects_hostile_targets() {
        // The guard logic mirrored from the command (kept in sync via the helper
        // below exercising the same rules)
        let in_path = std::path::Path::new("/photos/vacation/IMG_1.jpg");
        let cases: &[(&str, &str, bool)] = &[
            ("/photos/vacation/IMG_1.jpg", "jpeg", false),          // overwrite original
            ("/photos/vacation/IMG_1_export.png", "jpeg", false),   // extension mismatch
            ("/tmp/evil.jpg", "jpeg", false),                       // outside the source dir
            ("/photos/vacation/IMG_1_edited.jpg", "jpeg", false),   // sidecar overwrite
            ("/photos/vacation/IMG_1_export.jpg", "jpeg", true),    // the normal target
        ];
        for (out, format, ok) in cases {
            assert_eq!(export_target_allowed(in_path, std::path::Path::new(out), format).is_ok(), *ok, "{out}");
        }
    }

    /// Export speed at a realistic 12 MP size: decode → full pipeline render →
    /// JPEG encode, timed. Run with `-- --nocapture` to see the numbers. This is
    /// the CPU path (CI/headless has no GPU); with the GPU pipeline wired the
    /// app's exports only get faster.
    #[test]
    fn export_speed_12mp() {
        let (w, h) = (4000usize, 3000usize);
        let img = lightcraft_raster::Rgba8 {
            width: w,
            height: h,
            data: (0..w * h).map(|i| {
                let (x, y) = (i % w, i / w);
                [((x * 3 + y) % 256) as u8, ((y * 5 + x) % 256) as u8, ((x + y) % 256) as u8, 255]
            }).collect(),
        };
        let jpg = encode::encode_jpeg(&EncodeImage::rgba8(&img), 92, ChromaSubsampling::S422, &EncodeMeta::default())
            .expect("fixture encode");
        let jpg_len = jpg.len();

        let t = std::time::Instant::now();
        let (src, info) = lightcraft_engine::files::load_vec(jpg, usize::MAX).expect("decode");
        let decode_ms = t.elapsed().as_millis();

        let mut s = DevelopSettings::default();
        s.light.exposure = 0.4;
        s.effects.clarity = 12.0;
        s.color.vibrance = 18.0;
        s.detail.sharpen_amount = 30.0;
        let t = std::time::Instant::now();
        let (nw, nh) = lightcraft_pipeline::native_output_size(src.width, src.height, &s);
        let req = RenderRequest::fit(nw.round().max(1.0) as usize, nh.round().max(1.0) as usize);
        let out = render(&src, &info, &s, &req).image;
        let render_ms = t.elapsed().as_millis();

        let t = std::time::Instant::now();
        let bytes = encode::encode_jpeg(&EncodeImage::rgba8(&out), 92, ChromaSubsampling::S444, &EncodeMeta::default())
            .expect("export encode");
        let encode_ms = t.elapsed().as_millis();

        println!("12 MP export: decode {decode_ms} ms ({jpg_len} B file) → render {render_ms} ms → encode {encode_ms} ms ({} KB out)",
            bytes.len() / 1024);
        assert_eq!(out.width, w);
    }
}
