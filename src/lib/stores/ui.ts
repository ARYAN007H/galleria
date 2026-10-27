// ── UI state ──
// View-level toggles. Photo filtering/sorting lives in library.ts.

import { writable } from 'svelte/store'
import type { ViewMode } from './settings'

export const viewMode = writable<ViewMode>('grid')
export const activeResourceId = writable<number | null>(null) // For album/tag IDs
export const showSettings = writable<boolean>(false)
export const showEditor = writable<boolean>(false)
export const showChronicleAtlas = writable<boolean>(false)
export const showCuratorDesk = writable<boolean>(false)
export const showInfoPanel = writable<boolean>(false)
