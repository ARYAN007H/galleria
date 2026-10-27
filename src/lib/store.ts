// ── Store facade ──
// The original single-module store, now split by domain under ./stores/.
// Everything is re-exported here unchanged, so existing component imports
// keep working; new code can import directly from the domain module.
//
//   stores/ipc.ts         — runtime bootstrap, invoke/thumbnail/src helpers
//   stores/settings.ts    — app preferences + theme/accent/palette side effects
//   stores/library.ts     — photos, filters, derived views, paged loading
//   stores/ui.ts          — view toggles (editor/settings/atlas overlays)
//   stores/selection.ts   — multi-select
//   stores/collections.ts — tags, albums, variants, favorites/trash, file ops

export * from './stores/ipc'
export * from './stores/settings'
export * from './stores/library'
export * from './stores/ui'
export * from './stores/selection'
export * from './stores/collections'
