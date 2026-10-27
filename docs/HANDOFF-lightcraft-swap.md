# Handoff — LightCraft Engine Swap (2026-10-27)

Read `docs/lightcraft-engine-swap.md` first for the architecture rationale. This file is the working state.

## Status: swap complete and compile-verified; needs a live UI pass

**Update 3 (performance parity, 2026-10-27):** found why LightCraft's own app is much faster on the same engine — its UI renders through `lightcraft_engine::media::develop(..., gpu: true)`: a **wgpu GPU pipeline** with CPU fallback, sharing the same StageCache; Galleria was calling the CPU-only `pipeline::render_cached`. Now: `develop.rs` uses the engine's `media::develop` with `gpu = true` (identical output within 1–3 LSB, `LIGHTCRAFT_GPU=0` forces CPU) and warms the GPU during `load_editor_source` (add dep `lightcraft-gpu`); the frontend decodes the base64 pixel IPC via `fetch` data-URL (native C++ decoder, replaced a per-byte JS loop) and renders previews at the viewport's device-pixel size (draft caps 900, full caps 1600) instead of fixed 600/800.

**Update 2 (production-polish round, 2026-10-27):** full browser sweep of every panel, tool and view; measured latencies (editor open 267 ms, warm draft render 45 ms, slider-to-pixels 78 ms in the browser mock). Fixes: histogram & tone-curve canvases got dark backings (screen-blended RGB fills were invisible on the light theme); editor pins the dark M3 palette on `.editor-shell` (MaskingPanel etc. are drawn for dark surfaces; export + shortcuts overlays moved inside the shell to inherit it); the browser mock caches + pre-warms demo images (was re-downloading per render — the "3 s to appear"); mask tool-switch now re-renders; adding a mask sets `hasChanges`; 2-point tone curves draw straight (Catmull-Rom bowed the identity); TIFF added to export formats; toolbar buttons nowrap.

**Update 1 (browser verification round, 2026-10-27):**
- Web test harness restored: `tauriMock.ts` now speaks the new contract (`settings`/`draft`/`applyCrop`, `load_editor_source`, `auto_enhance`) and draws the **actual demo photo** (CORS-permitting) instead of a gradient. Test at `npm run dev` → http://localhost:1420.
- Editing sidebar redesigned: icon rail (Light/Curves/Color/Grading/Detail/Lens/Effects/Calib/History/Snaps) shows **one** section at a time — no accordion scrolling.
- Editor tools (Adjust/Mask/Crop) moved to the left tool strip; Save Copy/Export normalized to 28px toolbar buttons.
- Floating histogram only shows when the editing panel is hidden, scaled 0.8.
- **Real export bug fixed**: `RenderRequest::fit(usize::MAX, ..)` overflows in `Frame::sample` — full-size exports now compute `native_output_size()` first (same as LightCraft's own export path). Caught by the new `frontend_payload_round_trip` test (frontend-shaped JSON incl. mask/crop/B&W through parse→render→encode; 3/3 tests pass).
- Mask-local `hue` mapping added to `developSettings.ts`.

Verified so far:
- `cargo check` (src-tauri) — exit 0, including capabilities/permissions.
- `cargo test --lib develop::` — 2/2 pass (render smoke: encode→decode→develop→render inside Galleria's dep graph; partial-JSON settings parse).
- `vite build` — clean. `svelte-check` — 4 errors **all pre-existing** (librarySync.ts `get` import, SettingsPanel ExpressiveTier, BottomPill `badge`, PhotoGrid a11y); none in swapped files.

## What changed (commit-ready summary)

Backend (`src-tauri/`):
- `Cargo.toml` — path deps on `../../lightcraft/crates/{engine,pipeline,develop,codecs,raster,raw}` (engine with `default-features = false`); `avif-serialize = "=0.8.9"` pinned (0.8.6 lacks `Aviffy::set_content_light_level`); `[profile.dev.package."*"] opt-level = 2`.
- `src/develop.rs` (NEW, replaces `image_processing.rs` — deleted) — commands: `load_editor_source` (proxy decode ≤2816px via `lightcraft_engine::files::load_vec`, sets `SourceInfo::native_long`), `unload_editor_source`, `process_image` (DevelopSettings JSON in; `render_cached` + StageCache; `draft` flag → `Quality::Draft`; `applyCrop` flag → `RenderRequest::apply_crop`; base64 RGBA ≤2MP else temp JPEG), `compute_histogram`, `auto_enhance` (`pipeline::auto::{auto_tone, auto_wb}` → JSON patch), `export_image` (full re-decode, JPEG/PNG/lossless-WebP/TIFF via codecs). Commands take `tauri::AppHandle` and resolve state inside `spawn_blocking` (State<'_> can't cross into 'static).
- `src/lib.rs` — registry swapped to `develop::*`.
- `src/scan.rs` — RAW extensions added (cr3, orf, rw2, raf, erf, …).
- `src/thumb.rs` — `generate_thumbnail_engine` fallback: when the `image` crate fails, `load_vec` + `render` at defaults + JPEG encode. **Critical: `load_vec` returns linear Rec.2020 scene data — always render before 8-bit conversion.**
- `permissions/commands.toml` + `capabilities/main-capability.json` — new command permissions added.

Frontend (`src/`):
- `lib/editing/developSettings.ts` (NEW) — the wire contract: TS mirror of LightCraft `DevelopSettings` (snake_case, serde-default), `toDevelopSettings(AdjustmentState)`, `applyDevelopSettings(dev)` (reverse), `isDevelopSettings()` (detects new vs legacy blob by `light` key), `autoPatchToState()`. Hue note: UI mixer hue ±180 → engine ±100 (`HUE_TO_DEV`); curves 0–255 → 0..1.
- `lib/editing/adjustments.ts` — `AdjustmentState` extended (wbMode, treatment/bwMix, refineSaturation, cgGlobal, removeCA/lensProfileEnabled/profileDistortion/profileVignetting, defringePurple/Green, vignetteStyle); `toRustPayload` now delegates to `toDevelopSettings`.
- `lib/editing/imageProcessor.ts` — new invoke contract (`settings`, `draft`, `maxPreviewEdge`, `applyCrop`); `autoEnhance()`, `exportImage()` helpers; single-flight coalescing preserved; proxy edge = 2816.
- `components/PhotoEditor.svelte` — engine-first flow (no more `<img>` decode; RAWs work): `loadSavedEdits` migrates legacy JSON on load; `openPhoto` sizes canvas from `loadEditorSource` result; `triggerProcess(beforeState?)` with draft/crop flags (crop tool renders uncropped via `applyCrop:false` — old crop-zeroing hack removed); B/A now renders defaults through the engine (`showBefore()`); Save = `exportImage` full-res + persists `toDevelopSettings` JSON; Auto button wired; filmstrip nav async-safe.
- Panels: BasicPanel (WB preset chips + sliders switch to `custom`), HSLPanel (B&W `bwMix` view when `treatment==='bw'`), LensPanel (profile-corrections + remove-CA checkboxes, defringe sliders), ColorGradingPanel (Global wheel), ExportDialog (`settings` + `maxLongEdge` camelCase fix).

## Remaining work (small, self-contained)

1. **Live `npm run tauri:dev` pass** — the only real unknown. Checklist in "Verification" below.
2. **Mask hue/sat local adjustments**: `localAdjustmentsToDev` maps temp/tint/exposure/…/noise/sharpness but not the mask `hue`/`saturation` (LightCraft has `hue`, `saturation`, `color_hue/color_sat` overlay). Add to the mapping in `developSettings.ts` when masks get color controls.
3. **SettingsPanel.svelte (line ~293) & BottomPill.svelte** type errors — pre-existing, unrelated to the swap.
4. **Roadmap features** (engine-side ready, UI work needed): Point Color panel, spot removal/heal UI, masks beyond linear/radial (brush strokes → `MaskShape::Brush`), AI masks (enable `sam` feature + model download), Denoise (`denoise` feature), HDR editing UI, Upright/geometry panel, 16-bit/HDR export options, XMP sidecar interop (`docs/xmp-interop.md`).
5. **Bump LightCraft**: it's a path dep on the sibling checkout at release 0.14.0 (commit 662df66f). `git -C ../lightcraft pull && cargo update -p <changed>` then re-pin `avif-serialize` if codecs changes.

## Gotchas

- `tauri dev` needs `../dist` to exist for `generate_context!` — run `npm run build` first if `dist/` was cleaned.
- `lightcraft-engine` logs "no craft-fonts embedded" warning at build time — cosmetic; only matters for CJK watermarks.
- LightCraft `DevelopSettings` requires `wb.scale` semantics: for RAWs the engine treats temp as Kelvin; for rendered files 6500 = as-shot. The mapper sends raw Kelvin + `mode`; UI defaults 6500/0 = neutral either way.
- Legacy saved edits (`photos.edit_params` camelCase blobs) migrate one-way at load; they're re-saved as LightCraft JSON on next save. Before/after is not lossless for masks (legacy mask shapes map to linear/radial only — that's all the old app had).
- Don't convert `Rgb32f` from `load_vec` to u8 directly — it's linear scene-referred; run it through `render()`.

## Verification checklist (live pass)

1. `npm run build && npm run tauri:dev`
2. Open a JPEG → editor: image renders; drag Exposure (fast draft updates), release (sharper); histogram live; B/A shows flat defaults.
3. Auto button: exposure/WB visibly normalize; undo works.
4. Crop tool: uncropped frame shows; drag crop → preview applies on exit of tool.
5. WB preset chips: Tungsten cools the image; Temperature slider → mode switches to Custom.
6. Treatment → B&W (need a toggle — see "Remaining" #2: **the B&W toggle UI doesn't exist yet** — add a Color/BW switch to BasicPanel or HSLPanel header; state + engine support it).
7. Save Copy → `<name>_edited.jpg` at full res; reopen editor → edits restored (new JSON format).
8. Open a RAW (CR3/NEF/ARW) → editor renders it; gallery shows real thumbnails for RAWs.
9. Export dialog: JPEG/PNG/WebP/TIFF options work; check `maxLongEdge` resize.
10. Old photo with legacy edits: opens with adjustments applied (migrated), no crash.
