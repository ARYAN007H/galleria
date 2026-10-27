// ── Library ──
// The photo store, filters, derived views (filter/sort/group), and the
// paged loader with idle-time hydration and the in-memory cap.

import { writable, derived, get } from 'svelte/store'
import { invokeCommand as invoke, pickDirectory, showMessageBox } from './ipc'
import { appSettings, type ExpressiveTier } from './settings'

export type SortBy = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc'
export type SidebarSection = 'all' | 'recents' | 'favorites' | 'videos' | 'source' | 'trash' | 'album' | 'albums' | 'tag'

export interface SourceDirectory {
    id: number
    name: string
    rootPath: string
    photoCount: number
}

export interface Photo {
    id: number
    path: string
    filename: string
    folderRel: string
    width: number | null
    height: number | null
    takenAt: string | null
    modifiedAt: string
    sizeBytes: number
    mediaType: string
    source: string
    isFavorite: boolean
    isDeleted: boolean
    deletedAt: string | null
    // EXIF
    cameraMake: string | null
    cameraModel: string | null
    lens: string | null
    iso: number | null
    shutterSpeed: string | null
    aperture: string | null
    focalLength: string | null
    gpsLat: number | null
    gpsLon: number | null
}

export interface FilterState {
    selectedFolder: string | null
    selectedYear: number | null
    selectedMonth: number | null
    selectedMediaTypes: string[]
}

// ── Core stores ──

export const libraryPath = writable<string | null>(null)
export const photos = writable<Photo[]>([])
export const searchQuery = writable<string>('')
export const selectedPhoto = writable<Photo | null>(null)
export const focusedPhotoId = writable<number | null>(null)
export const isIndexing = writable<boolean>(false)
export const hasMorePhotos = writable<boolean>(true)
export const isLoadingMore = writable<boolean>(false)
const PAGE_SIZE = 100
const MAX_PHOTOS_IN_MEMORY = 2000
export const indexProgress = writable<{
    current: number
    total: number
    phase: 'scanning' | 'processing' | 'done'
}>({
    current: 0,
    total: 0,
    phase: 'done'
})

export const sourceDirectories = writable<SourceDirectory[]>([])
export const activeSource = writable<string | null>(null) // null = all sources
export const totalPhotoCount = writable<number>(0)

export const sortBy = writable<SortBy>('date-desc')
export const activeSection = writable<SidebarSection>('all')

export const filters = writable<FilterState>({
    selectedFolder: null,
    selectedYear: null,
    selectedMonth: null,
    selectedMediaTypes: ['photo', 'video']
})

// ── Derived stores ──

// Cache timestamps so sort comparisons don't create Date objects every time.
// WeakMap ensures entries are GC'd when photos leave the store.
const timestampCache = new WeakMap<Photo, number>()
function getTimestamp(photo: Photo): number {
    let ts = timestampCache.get(photo)
    if (ts === undefined) {
        ts = new Date(photo.takenAt || photo.modifiedAt).getTime()
        timestampCache.set(photo, ts)
    }
    return ts
}

export const filteredPhotos = derived(
    [photos, filters, searchQuery, sortBy, activeSection, activeSource],
    ([$photos, $filters, $searchQuery, $sortBy, $activeSection, $activeSource]) => {
        let filtered = $photos

        // Source-based filtering
        if ($activeSection === 'source' && $activeSource) {
            filtered = filtered.filter(p => p.source === $activeSource)
        }

        // Section-based filtering
        if ($activeSection === 'trash') {
            filtered = filtered.filter(p => p.isDeleted)
        } else {
            filtered = filtered.filter(p => !p.isDeleted)
        }

        if ($activeSection === 'favorites') {
            filtered = filtered.filter(p => p.isFavorite)
        } else if ($activeSection === 'videos') {
            filtered = filtered.filter(p => p.mediaType === 'video')
        } else if ($activeSection === 'recents') {
            // Last 30 days
            const cutoff = Date.now() - 30 * 86400000
            filtered = filtered.filter(p => getTimestamp(p) >= cutoff)
        }

        // Search filter
        if ($searchQuery) {
            const query = $searchQuery.toLowerCase()
            filtered = filtered.filter(p =>
                p.filename.toLowerCase().includes(query) ||
                p.path.toLowerCase().includes(query) ||
                p.folderRel.toLowerCase().includes(query)
            )
        }

        // Media type filter
        if ($activeSection !== 'videos') {
            filtered = filtered.filter(p => $filters.selectedMediaTypes.includes(p.mediaType))
        }

        // Folder filter
        if ($filters.selectedFolder) {
            filtered = filtered.filter(p => p.folderRel === $filters.selectedFolder)
        }

        // Year filter
        if ($filters.selectedYear) {
            filtered = filtered.filter(p => {
                const year = new Date(getTimestamp(p)).getFullYear()
                return year === $filters.selectedYear
            })
        }

        // Month filter
        if ($filters.selectedMonth !== null && $filters.selectedYear) {
            filtered = filtered.filter(p => {
                const date = new Date(getTimestamp(p))
                return date.getFullYear() === $filters.selectedYear && date.getMonth() === $filters.selectedMonth
            })
        }

        // Sort — uses cached timestamps instead of creating Date objects per comparison
        filtered = [...filtered].sort((a, b) => {
            switch ($sortBy) {
                case 'date-desc':
                    return getTimestamp(b) - getTimestamp(a)
                case 'date-asc':
                    return getTimestamp(a) - getTimestamp(b)
                case 'name-asc':
                    return a.filename.localeCompare(b.filename)
                case 'name-desc':
                    return b.filename.localeCompare(a.filename)
                case 'size-desc':
                    return b.sizeBytes - a.sizeBytes
                case 'size-asc':
                    return a.sizeBytes - b.sizeBytes
                default:
                    return 0
            }
        })

        return filtered
    }
)

// Group photos by date for section headers
export const groupedPhotos = derived(filteredPhotos, ($filtered) => {
    const groups: { label: string; dateKey: string; photos: Photo[] }[] = []
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const thisWeekStart = new Date(today.getTime() - today.getDay() * 86400000)
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const groupMap = new Map<string, Photo[]>()
    const groupLabels = new Map<string, string>()
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December']

    for (const photo of $filtered) {
        const ts = getTimestamp(photo)
        const date = new Date(ts)
        const photoDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

        let label: string
        let dateKey: string

        if (photoDay.getTime() === today.getTime()) {
            label = 'Today'
            dateKey = 'today'
        } else if (photoDay.getTime() === yesterday.getTime()) {
            label = 'Yesterday'
            dateKey = 'yesterday'
        } else if (photoDay >= thisWeekStart) {
            label = 'This Week'
            dateKey = 'this-week'
        } else if (photoDay >= thisMonthStart) {
            label = 'This Month'
            dateKey = 'this-month'
        } else {
            label = `${monthNames[date.getMonth()]} ${date.getFullYear()}`
            dateKey = `${date.getFullYear()}-${String(date.getMonth()).padStart(2, '0')}`
        }

        if (!groupMap.has(dateKey)) {
            groupMap.set(dateKey, [])
            groupLabels.set(dateKey, label)
        }
        groupMap.get(dateKey)!.push(photo)
    }

    for (const [dateKey, photos] of groupMap) {
        groups.push({
            label: groupLabels.get(dateKey)!,
            dateKey,
            photos,
        })
    }

    return groups
})

// Category stores
export const years = derived(photos, ($photos) => {
    const yearsSet = new Set<number>()
    $photos.forEach(p => {
        const year = p.takenAt ? new Date(p.takenAt).getFullYear() : new Date(p.modifiedAt).getFullYear()
        yearsSet.add(year)
    })
    return Array.from(yearsSet).sort((a, b) => b - a)
})

export const folders = derived(photos, ($photos) => {
    const foldersSet = new Set<string>()
    $photos.forEach(p => {
        if (p.folderRel) foldersSet.add(p.folderRel)
    })
    return Array.from(foldersSet).sort()
})

// Filtered folders based on hiddenFolders/pinnedFolders/maxVisibleFolders
export const visibleFolders = derived(
    [folders, appSettings],
    ([$folders, $settings]) => {
        const hidden = new Set($settings.hiddenFolders)
        const pinned = new Set($settings.pinnedFolders)
        const visible = $folders.filter(f => !hidden.has(f))
        // Sort: pinned first, then alphabetically
        visible.sort((a, b) => {
            const aPinned = pinned.has(a) ? 0 : 1
            const bPinned = pinned.has(b) ? 0 : 1
            if (aPinned !== bPinned) return aPinned - bPinned
            return a.localeCompare(b)
        })
        return visible.slice(0, $settings.maxVisibleFolders)
    }
)

export const months = derived(
    [photos, filters],
    ([$photos, $filters]) => {
        if (!$filters.selectedYear) return []
        const monthsSet = new Set<number>()
        $photos.forEach(p => {
            const date = new Date(p.takenAt || p.modifiedAt)
            if (date.getFullYear() === $filters.selectedYear) {
                monthsSet.add(date.getMonth())
            }
        })
        return Array.from(monthsSet).sort((a, b) => a - b)
    }
)

export const photoCount = derived(photos, ($photos) => $photos.length)
export const filteredCount = derived(filteredPhotos, ($f) => $f.length)

export const favoritesCount = derived(photos, ($photos) => $photos.filter(p => p.isFavorite).length)
export const trashCount = derived(photos, ($photos) => $photos.filter(p => p.isDeleted).length)

// ── Library actions ──

export async function selectLibrary() {
    try {
        const path = await pickDirectory('Select a folder with photos')
        if (path) {
            libraryPath.set(path)
            await indexLibrary()
        }
    } catch (err) {
        console.error('Failed to select library:', err)
        await showMessageBox(String(err), { title: 'Import Error', kind: 'error' })
    }
}

export async function indexLibrary() {
    try {
        isIndexing.set(true)
        const path = get(libraryPath)
        if (!path) throw new Error('No library path set')

        await invoke<any>('select_and_index', { path })

        // Reload everything from DB
        await loadAllPhotos()

        // Refresh source directories
        try {
            const libs = await invoke<any[]>('get_libraries')
            if (libs) {
                sourceDirectories.set(libs.map((l: any) => ({
                    id: l.id,
                    name: (l.rootPath || l.root_path || '').split(/[\\/]/).filter(Boolean).pop() || 'Library',
                    rootPath: l.rootPath || l.root_path,
                    photoCount: l.photoCount || l.photo_count || 0
                })))
            }
        } catch { /* ignore */ }
    } catch (err) {
        console.error('Failed to index library:', err)
        await showMessageBox(String(err), { title: 'Indexing Error', kind: 'error' })
    } finally {
        isIndexing.set(false)
    }
}

export function searchPhotos(query: string) {
    searchQuery.set(query)
}

export interface SearchFacets {
    query?: string
    cameraMake?: string
    cameraModel?: string
    mediaType?: string
}

export async function searchWithFacets(facets: SearchFacets) {
    try {
        const result = await invoke<Photo[]>('search_with_facets', {
            query: facets.query || null,
            cameraMake: facets.cameraMake || null,
            cameraModel: facets.cameraModel || null,
            mediaType: facets.mediaType || null,
            limit: 200,
        })
        photos.set(result || [])
        hasMorePhotos.set(false)
    } catch (err) {
        console.error('Facet search failed:', err)
    }
}

// Debounced search for input fields
let searchTimer: ReturnType<typeof setTimeout> | null = null
export function debouncedSearch(query: string, delay = 300) {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => searchQuery.set(query), delay)
}

export async function initAutoScan() {
    try {
        // Restore session from persisted DB — initializes Rust AppState.db + library_roots
        // This is instant: no filesystem scanning, just opens the SQLite file
        const libraries = await invoke<any[]>('restore_session').catch(() => [])

        if (libraries && libraries.length > 0) {
            sourceDirectories.set(libraries.map((l: any) => ({
                id: l.id,
                name: l.name || (l.rootPath || l.root_path || '').split(/[\\/]/).filter(Boolean).pop() || 'Library',
                rootPath: l.rootPath || l.root_path,
                photoCount: l.photoCount || l.photo_count || 0
            })))
            libraryPath.set(libraries[0].rootPath || libraries[0].root_path)
            await loadAllPhotos()
            return
        }

        // NO libraries in DB — show EmptyState, let user import
    } catch (err) {
        console.error('Failed to initialize:', err)
    }

    // Auto-detect performance mode
    try {
        const sysInfo = await invoke<{ totalRamMb: number; availableRamMb: number; cpuThreads: number; cpuName: string }>('get_system_info')
        const current = get(appSettings)
        // Auto-enable if RAM < 6GB or CPU threads <= 4, unless manually overridden
        if (!current.performanceMode && (sysInfo.availableRamMb < 6144 || sysInfo.cpuThreads <= 4)) {
            appSettings.update(s => ({
                ...s,
                performanceMode: true,
                performanceModeAuto: true,
            }))
            console.log(`[PerfMode] Auto-enabled: RAM ${sysInfo.availableRamMb}MB, ${sysInfo.cpuThreads} threads (${sysInfo.cpuName})`)
        }
        if (!current.tierAutoDetected) {
            let tier: ExpressiveTier = 'full'
            if (sysInfo.totalRamMb <= 4096) tier = 'essential'
            else if (sysInfo.totalRamMb <= 8192) tier = 'balanced'
            appSettings.update(s => ({
                ...s,
                expressiveTier: tier,
                tierAutoDetected: true,
                performanceMode: tier !== 'full' ? true : s.performanceMode,
            }))
        }
    } catch (err) {
        console.warn('Failed to get system info for perf mode:', err)
    }

    const { initLibrarySync } = await import('../librarySync')
    await initLibrarySync()
}

let hydrateGeneration = 0
let hydrateIdleScheduled = false

function scheduleIdleHydration() {
    if (hydrateIdleScheduled || !get(hasMorePhotos)) return
    hydrateIdleScheduled = true
    const gen = hydrateGeneration
    const run = () => {
        hydrateIdleScheduled = false
        if (gen !== hydrateGeneration) return
        if (!get(hasMorePhotos) || get(isLoadingMore)) {
            if (get(hasMorePhotos)) scheduleIdleHydration()
            return
        }
        loadMorePhotos().then(() => {
            if (gen === hydrateGeneration && get(hasMorePhotos)) scheduleIdleHydration()
        })
    }
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(run, { timeout: 2000 })
    } else {
        setTimeout(run, 16)
    }
}

/** Patch a single photo row in place (shallow update). */
export function patchPhoto(photoId: number, partial: Partial<Photo>) {
    photos.update(list => {
        const i = list.findIndex(p => p.id === photoId)
        if (i < 0) return list
        const next = list.slice()
        next[i] = { ...next[i], ...partial }
        return next
    })
}

export async function loadAllPhotos() {
    try {
        hydrateGeneration++
        const firstPage = await invoke<Photo[]>('get_all_photos', {
            params: { limit: PAGE_SIZE, offset: 0 }
        })
        photos.set(firstPage || [])
        hasMorePhotos.set((firstPage || []).length >= PAGE_SIZE)

        try {
            const count = await invoke<number>('get_photo_count')
            totalPhotoCount.set(count)
        } catch { /* ignore */ }

        try {
            const libs = await invoke<SourceDirectory[]>('get_libraries')
            if (libs) sourceDirectories.set(libs)
        } catch { /* ignore */ }

        scheduleIdleHydration()
    } catch (err) {
        console.error('Failed to load photos:', err)
    }
}

export async function loadTrashPhotos() {
    try {
        hydrateGeneration++
        const firstPage = await invoke<Photo[]>('get_trash_photos', {
            params: { limit: PAGE_SIZE, offset: 0 }
        })
        photos.set(firstPage || [])
        hasMorePhotos.set((firstPage || []).length >= PAGE_SIZE)
        scheduleIdleHydration()
    } catch (err) {
        console.error('Failed to load trash:', err)
    }
}

export async function loadMorePhotos() {
    if (get(isLoadingMore) || !get(hasMorePhotos)) return
    isLoadingMore.set(true)
    try {
        const currentCount = get(photos).length
        const cmd = get(activeSection) === 'trash' ? 'get_trash_photos' : 'get_all_photos'
        const nextPage = await invoke<Photo[]>(cmd, {
            params: { limit: PAGE_SIZE, offset: currentCount }
        })
        if (!nextPage || nextPage.length === 0) {
            hasMorePhotos.set(false)
        } else {
            photos.update(list => {
                const combined = [...list, ...nextPage]
                // Sliding window eviction: keep only the latest MAX_PHOTOS_IN_MEMORY
                if (combined.length > MAX_PHOTOS_IN_MEMORY) {
                    const evicted = combined.slice(combined.length - MAX_PHOTOS_IN_MEMORY)
                    console.log(`[Memory] Evicted ${combined.length - evicted.length} photos from store (cap: ${MAX_PHOTOS_IN_MEMORY})`)
                    return evicted
                }
                return combined
            })
            hasMorePhotos.set(nextPage.length >= PAGE_SIZE)
        }
    } catch (err) {
        console.error('Failed to load more photos:', err)
    } finally {
        isLoadingMore.set(false)
    }
}
