// ── Settings ──
// App preferences persisted to localStorage, plus their DOM side effects
// (theme attribute, accent presets, palette selection).

import { writable } from 'svelte/store'

export type Theme = 'light' | 'dark'
export type ViewMode = 'grid' | 'list'
export type LayoutMode = 'compact' | 'default' | 'expressive'
export type ExpressiveTier = 'essential' | 'balanced' | 'full'
export type AccentColor = 'blue' | 'purple' | 'pink' | 'red' | 'orange' | 'green' | 'teal' | 'indigo'
export type ColorPalette = 'default' | 'lavender' | 'mauve' | 'sage' | 'coral' | 'ocean'

export interface AppSettings {
    theme: Theme
    layoutMode: LayoutMode
    filmstripScrollEnabled: boolean
    gridZoom: number // 1-5 scale
    showSidebar: boolean
    accentColor: AccentColor
    colorPalette: ColorPalette
    hiddenFolders: string[]
    pinnedFolders: string[]
    maxVisibleFolders: number
    performanceMode: boolean
    performanceModeAuto: boolean
    expressiveTier: ExpressiveTier
    tierAutoDetected: boolean
}

const defaultSettings: AppSettings = {
    theme: 'light',
    layoutMode: 'default',
    filmstripScrollEnabled: true,
    gridZoom: 3,
    showSidebar: true,
    accentColor: 'blue',
    colorPalette: 'default',
    hiddenFolders: [],
    pinnedFolders: [],
    maxVisibleFolders: 8,
    performanceMode: false,
    performanceModeAuto: false,
    expressiveTier: 'balanced',
    tierAutoDetected: false,
}

function loadSettings(): AppSettings {
    try {
        const stored = localStorage.getItem('photo-sorter-settings')
        if (stored) return { ...defaultSettings, ...JSON.parse(stored) }
    } catch { }
    return { ...defaultSettings }
}

function saveSettings(s: AppSettings) {
    try {
        localStorage.setItem('photo-sorter-settings', JSON.stringify(s))
    } catch { }
}

export const appSettings = writable<AppSettings>(loadSettings())

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme)
}

const accentPresets: Record<AccentColor, { main: string; hover: string; text: string; subtle: string; glow: string }> = {
    blue: { main: '#3b82f6', hover: '#2563eb', text: '#60a5fa', subtle: 'rgba(59,130,246,0.12)', glow: 'rgba(59,130,246,0.25)' },
    purple: { main: '#8b5cf6', hover: '#7c3aed', text: '#a78bfa', subtle: 'rgba(139,92,246,0.12)', glow: 'rgba(139,92,246,0.25)' },
    pink: { main: '#ec4899', hover: '#db2777', text: '#f472b6', subtle: 'rgba(236,72,153,0.12)', glow: 'rgba(236,72,153,0.25)' },
    red: { main: '#ef4444', hover: '#dc2626', text: '#f87171', subtle: 'rgba(239,68,68,0.12)', glow: 'rgba(239,68,68,0.25)' },
    orange: { main: '#f97316', hover: '#ea580c', text: '#fb923c', subtle: 'rgba(249,115,22,0.12)', glow: 'rgba(249,115,22,0.25)' },
    green: { main: '#22c55e', hover: '#16a34a', text: '#4ade80', subtle: 'rgba(34,197,94,0.12)', glow: 'rgba(34,197,94,0.25)' },
    teal: { main: '#14b8a6', hover: '#0d9488', text: '#2dd4bf', subtle: 'rgba(20,184,166,0.12)', glow: 'rgba(20,184,166,0.25)' },
    indigo: { main: '#6366f1', hover: '#4f46e5', text: '#818cf8', subtle: 'rgba(99,102,241,0.12)', glow: 'rgba(99,102,241,0.25)' },
}

function applyAccent(color: AccentColor) {
    const p = accentPresets[color]
    const root = document.documentElement
    root.style.setProperty('--accent', p.main)
    root.style.setProperty('--accent-hover', p.hover)
    root.style.setProperty('--accent-text', p.text)
    root.style.setProperty('--accent-subtle', p.subtle)
    root.style.setProperty('--accent-glow', p.glow)
    root.style.setProperty('--shadow-glow', `0 0 20px ${p.glow}`)
}

function applyPalette(palette: ColorPalette) {
    if (palette === 'default') {
        document.documentElement.removeAttribute('data-palette')
    } else {
        document.documentElement.setAttribute('data-palette', palette)
    }
}

{
    const initial = (function () {
        let v!: AppSettings
        const unsub = appSettings.subscribe(s => (v = s))
        unsub()
        return v
    })()
    applyTheme(initial.theme)
    applyAccent(initial.accentColor)
    applyPalette(initial.colorPalette)
}

// Persist on change
appSettings.subscribe(s => {
    saveSettings(s)
    applyTheme(s.theme)
    applyPalette(s.colorPalette)
    // Only apply accent presets when using the default palette
    // (palettes define their own accent colors via CSS)
    if (s.colorPalette === 'default') {
        applyAccent(s.accentColor)
    } else {
        // Clear inline accent overrides so CSS palette takes effect
        const root = document.documentElement
        root.style.removeProperty('--accent')
        root.style.removeProperty('--accent-hover')
        root.style.removeProperty('--accent-text')
        root.style.removeProperty('--accent-subtle')
        root.style.removeProperty('--accent-glow')
        root.style.removeProperty('--shadow-glow')
    }
})

export function toggleTheme() {
    appSettings.update(s => ({
        ...s,
        theme: s.theme === 'light' ? 'dark' : 'light'
    }))
}

export function updateSettings(partial: Partial<AppSettings>) {
    appSettings.update(s => ({ ...s, ...partial }))
}
