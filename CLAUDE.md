# Project & Architecture

Galleria Expressive is an offline-first desktop photo library/manager with a Material 3 Expressive "Liquid Glass" UI, built as a Tauri 2 app: Svelte 4 + TypeScript + Vite 5 frontend, Rust backend, embedded SQLite (`rusqlite`, bundled). Cross-platform (Linux/Windows/macOS); `tauri dev` serves the frontend on fixed port 1420.

- **UI layer** — `src/components/*.svelte` (views: PhotoGrid, DetailView, PhotoEditor, SettingsPanel…) and editor panels in `src/lib/editing/panels/`. Svelte 4 stores/transitions only — no Svelte 5 runes. Icons: inline SVG strings in `src/lib/icons.ts`, `lucide-svelte`, Material Symbols Rounded font; Outfit is the UI font.
- **State & IPC** — `src/lib/store.ts` is the single gateway to the backend: it binds real `@tauri-apps/api` invokes under Tauri and browser mocks otherwise (`src/lib/tauriMock.ts`), so `npm run dev` works without Rust. Editor undo history: `src/lib/editor/historyStore.ts`; adjustment state: `src/lib/editing/adjustments.ts`.
- **Develop engine** — LightCraft crates by path from the sibling checkout `../lightcraft/` (`../../lightcraft/crates/*` relative to `src-tauri/`; pinned upstream — plan in `docs/lightcraft-engine-swap.md`). `src-tauri/src/develop.rs` decodes a ≤2816 px editing proxy, renders via `render_cached` + `StageCache` (draft quality while scrubbing sliders, full quality on release), and exports re-decode at full resolution. Previews cross IPC as base64 RGBA8 (≤2 MP) or temp-file JPEG above that.
- **Edit-settings contract** — persistence + wire format is LightCraft `DevelopSettings` JSON: snake_case, every field optional (`#[serde(default)]`). TS mirror/mappers in `src/lib/editing/developSettings.ts`; stored in SQLite `photos.edit_params`; legacy camelCase blobs migrate on load. Keep Rust serde derives and the TS mirror in lockstep.
- **Backend modules** (`src-tauri/src/`) — `commands.rs` (library/album/tag/favorite CRUD, session), `db.rs` (SQLite in the OS app-data dir), `scan.rs` (walkdir + rexif EXIF indexing), `thumb.rs` (thumbnails to the OS cache dir), `curation.rs` (perceptual-hash dedupe), `watcher.rs` (notify fs watching). Every command must be registered in `lib.rs` → `invoke_handler`.
- **Styling** — M3 design tokens as `--md-sys-color-*` CSS variables in `src/app.css` (dark/light themes, dynamic palettes); Tailwind 4 via PostCSS (`postcss.config.js`).

## Developer Workflows & Commands

Run from repo root:

- `npm run tauri:dev` — full app (Vite + Rust); the real dev loop.
- `npm run dev` — frontend only, in a browser (Tauri APIs mocked).
- `npm run build` — frontend production build (Vite).
- `npm run tauri:build` — production bundle; binary at `src-tauri/target/release/`.
- `npm run check` — svelte-check over `tsconfig.json`; the authoritative frontend typecheck.
- No `lint`/`test` npm scripts. `eslint.config.js` is stale (imports React plugins that are not installed — eslint crashes); don't rely on it.
- Rust (run inside `src-tauri/`): `cargo check`, `cargo clippy`, `cargo test` (smoke test lives in `develop.rs`; there are no TS tests).
- `[profile.dev.package."*"] opt-level = 2` in `Cargo.toml` keeps the f32 pipeline usable in dev — don't remove it.

## Code Style & Constraints

- TypeScript `strict`, `verbatimModuleSyntax`, `isolatedModules` → use `import type` for type-only imports; avoid `any` and unused variables in new code.
- Svelte 4 syntax (no runes, no `$props()`); TS in components via `svelte-preprocess`; 4-space indentation.
- Rust 2021: commands are snake_case, return `Result<T, String>`, and must be added to the `generate_handler!` list in `lib.rs`.
- Styling: Tailwind utilities plus component-scoped `<style>` blocks; colors/shape/motion come from the M3 CSS variables in `src/app.css` — no hardcoded hex values in components.
- New editing controls must go through the DevelopSettings contract: add the field to the Rust struct and to `developSettings.ts` (partial objects are always valid).
- No new runtime npm dependencies or Rust crates without approval; new icons belong in `src/lib/icons.ts`.

## Agent Guardrails

- LightCraft checkout (`../lightcraft/`) is a separate git repo consumed via path deps (`../../lightcraft/crates/*` from `src-tauri/`) and IS legitimately edited as part of the engine integration (other sessions work in it). Treat edits there as deliberate: follow its own `CLAUDE.md`/`AGENTS.md`, commit its changes in its own repo (never mixed into Galleria commits), and keep the pinned-commit comment in `src-tauri/Cargo.toml` in sync when the checkout moves.
- Never edit generated or volatile paths: `src-tauri/gen/`, `src-tauri/target/`, `dist/`, `check_output*.txt`. Leave lockfiles alone unless a dependency change is intended.
- Security-sensitive: `src-tauri/tauri.conf.json` (CSP, asset-protocol scope, updater endpoint) and `src-tauri/capabilities/main-capability.json`. Change only deliberately; never widen the asset scope.
- Data safety: the SQLite DB holds real user photo libraries. Schema changes belong in `db.rs` and must be backward-compatible; `edit_params` JSON must stay loadable for both old camelCase and new snake_case blobs.
- Performance invariants: slider drags render with `draft: true`; never reintroduce full re-renders per input event or bypass the StageCache; keep preview payloads under the base64 pixel limit.
- Secrets: none belong in the repo (`.env`/`.env.*` are gitignored); the updater pubkey in `tauri.conf.json` is public. Never hardcode absolute local paths.
- **Verification rule:** before signaling completion run `npm run check` and `cd src-tauri && cargo check`; add `cargo test` when `develop.rs` or the pipeline was touched. Report failures verbatim — never claim success without running them.

## Git & Workflow Hygiene

- Conventional Commits, imperative subject: `feat:`, `fix:`, `perf:`, `docs:`, `chore:`; scope platform-specific fixes (`fix(linux): …`).
- **PR-first workflow (standing user directive, 2026-10-28): never commit directly to `main`.** Branch as `feat/<kebab-scope>`, `fix/<kebab-scope>`, `docs/<kebab-scope>`, or `chore/<kebab-scope>`, push, and open a PR via `gh pr create` with a one-paragraph description, the verification results, and the issue it closes (`Fixes #N`). Only exceptions (direct commits to `main`): release version-bump commits + tags, and urgent CI/workflow repairs.
- Track planned work as GitHub issues (`gh issue create`); pull backlog items from `docs/HANDOFF-lightcraft-swap.md` and reference the issue from every PR. Open issues before starting work, not after.
- PRs are merged by the user after review; merge yourself only when the user explicitly asks. Delete the branch after merge.
- Releases: bump the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`, commit as `chore: release vX.Y.Z` (direct to `main` is allowed here), push tag `vX.Y.Z` — the `v*` tag triggers `.github/workflows/release.yml`. After CI completes, check `gh release list` for duplicate drafts on the tag (matrix jobs can race and split assets) and consolidate before publishing.
- Keep planning docs in-tree (`docs/`, `vision.md`) and update them when architecture decisions change.
