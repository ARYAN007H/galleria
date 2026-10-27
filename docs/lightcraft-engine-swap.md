# LightCraft Engine Swap — Implementation Plan

**Goal**: Replace Galleria's hand-rolled CPU image pipeline (`src-tauri/src/image_processing.rs`, 1873 lines of LUT-based sRGB math) with [LightCraft](https://github.com/storytold/lightcraft) v0.14.0's develop engine — a scene-referred, 32-bit float, wide-gamut (linear Rec.2020) pipeline that is "very close to Lightroom", and import its advanced features into Galleria's UI.

## Why LightCraft's engine is a strict upgrade

| | Galleria today | LightCraft engine |
|---|---|---|
| Pipeline | sRGB→linear per pixel, LUTs, rayon | Scene-referred linear Rec.2020 f32, edge-aware guided filters on log-luminance |
| Highlights/Shadows | simple gain | local tone mapping without halos (guided filter) |
| WB | D-illuminant approximation | camera colour matrices (DNG spec ch. 6), Kelvin scale for RAWs |
| Colour | sRGB HSL bands | OkLCh perceptual space, 8-band mixer, 3-way wheels, Point Color |
| Perf on slider drag | full re-render every event | `StageCache` — a tone/colour/exposure drag re-runs **only the per-pixel stage**; `Quality::Draft` for drags |
| Formats | JPEG/PNG/WebP via `image` crate | + TIFF, AVIF, JXL, HEIF(optional), PSD; RAW: DNG/CR3/ARW/RAF/NEF/ORF/RW2… with camera profiles |
| Export | 8-bit JPEG/PNG | 8/16-bit, sRGB or wide-gamut spaces, HDR (PQ AVIF) |

## Embedding strategy (decided)

- **Depend on crates by path** from the sibling checkout `../../lightcraft/crates/*` (pinned commit `662df66f`, release 0.14.0; toolchain rustc 1.99.1 ≥ MSRV 1.95). License: MIT OR Apache-2.0, compatible with Galleria's Apache-2.0 (choose Apache-2.0; NOTICE attribution added below).
- **Decode**: `lightcraft_engine::files::load_vec(bytes, max_edge) -> (Rgb32f, SourceInfo)` — the one maintained entry that does RAW demosaic (binned for previews), camera colour-model fit, highlight rebuild, orientation, embedded JPEG fallback for unsupported RAWs, and non-RAW codecs decode. Vendoring the 4.5k-line colour-science path would drift from upstream — rejected.
- **Render**: `lightcraft_pipeline::render_cached(&Arc<Rgb32f>, &SourceInfo, &DevelopSettings, &RenderRequest, &StageCache) -> Rendered { image: Rgba8, histogram }`.
- **Engine crate with `default-features = false`** (no SAM/candle AI deps, no denoise runtime). It does transitively pull gpu/catalog/etc. — compile-time cost only; we never construct sessions.
- **GPU pipeline (wgpu)**: not wired in v1 — the CPU pipeline with StageCache is already a large win over today's full-recompute. Future work.

## Wire & persistence contract

- New wire format for `process_image`: **LightCraft `DevelopSettings` JSON** (snake_case, `#[serde(default)]` everywhere → partials are valid). The TS side maps its `AdjustmentState` → `DevelopSettings` in `src/lib/editing/developSettings.ts`; reverse mapper for loading.
- `photos.edit_params` in SQLite stores the same JSON going forward. Old camelCase `AdjustmentState` blobs are detected and migrated on load (one-way, non-destructive until user saves).
- `ProcessResult` transport kept: `{width, height, pixelsB64 (RGBA8 base64), histogram}` — same canvas `putImageData` path in PhotoEditor.

## Backend work (src-tauri)

1. `Cargo.toml`: path deps `lightcraft-engine` (default-features off), `lightcraft-pipeline`, `lightcraft-develop`, `lightcraft-codecs`, `lightcraft-raster`; `[profile.dev.package."*"] opt-level = 2` so the pipeline isn't interpreted in `tauri dev`.
2. New `src/develop.rs` replacing `image_processing.rs`:
   - `EditorState { loaded: Mutex<Option<Loaded>>, counter: AtomicU64 }`; `Loaded { path, src: Arc<Rgb32f>, info: SourceInfo, cache: StageCache }`.
   - `load_editor_source(path)` — probe native size (header for rendered files, raw probe for RAWs), decode a ≤2816px proxy via `load_vec`, set `SourceInfo::native_long` so previews scale like the original.
   - `process_image(path, settings, draft, max_edge, apply_crop)` — single-flight stale-drop via counter (pattern preserved from old engine), `render_cached`, Draft quality while scrubbing.
   - `auto_enhance(path, settings)` — `pipeline::auto::{auto_tone, auto_wb}` returns a settings patch.
   - `export_image(path, settings, {format, quality, long_edge}, out)` — fresh full-res decode (never trust the proxy), render, encode via codecs (JPEG q, PNG, WebP-lossless, TIFF; AVIF if compiled).
   - Smoke test: encode→decode→render round-trip on a synthetic image.
3. `lib.rs` command registry updated; `image_processing.rs` deleted.

## Frontend work

1. `developSettings.ts` — TS mirror of `DevelopSettings`, `toDevelopSettings(state)`, `applyDevelopPatch/FromSettings(state, dev)` (used by load + Auto).
2. `adjustments.ts` — extend `AdjustmentState` with LightCraft-only controls: WB modes/presets, B&W treatment + B&W mix, defringe, remove-CA/lens-profile toggles, NR detail/smoothness, curve refine-saturation, grading global wheel, vignette style. Presets updated.
3. `imageProcessor.ts` — new invoke params (`settings` JSON, `draft`, `applyCrop`); result handling unchanged.
4. `PhotoEditor.svelte` — scrub ⇒ `draft: true`; release ⇒ full; crop tool ⇒ `applyCrop: false` (replaces the crop-zeroing hack); Auto button applies the returned patch; old-params migration on load.
5. Panels: WB preset dropdown in Basic; B&W toggle + mix (HSL panel becomes Mixer/B&W); Detail NR extras; Lens panel defringe + profile toggles; Grading global wheel.
6. Capabilities file refreshed (was stale anyway).

## Gallery RAW support

- `scan.rs`: add RAW extensions; `thumb.rs`: RAW branch via `load_vec(bytes, 240)` (falls back to embedded camera JPEG automatically). RAWs get real thumbnails, EXIF-guarded.

## Feature deltas accepted for v1 (roadmap)

- AI masks (Subject/Sky/Object; needs `sam` feature + model download), Denoise AI (`denoise` feature), Heal/spot removal UI, Point Color UI, HDR editing UI, Upright/geometry UI, lens DB (`lensdb`) beyond embedded DNG opcodes, 16-bit export UI, GPU render, XMP sidecar interop.
- These all work engine-side already; they are UI/feature-flag work, to be layered on later.

## Attribution

LightCraft © storytold/ArtCraft contributors, MIT OR Apache-2.0. NOTICE entry + source pointer added in `src-tauri/src/develop.rs` header. The vendored-path approach was rejected precisely so upstream fixes keep flowing via the local checkout.
