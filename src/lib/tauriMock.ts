/**
 * Tauri API Mock Layer
 * Provides stub implementations of Tauri APIs when running in a standard browser,
 * enabling UI development and testing without the Tauri runtime.
 */

import type { Photo, Tag, Album, SourceDirectory } from './store'

// Detect if we're running inside Tauri
export const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// ── Demo Photo Data ──

function generateDemoPhotos(count: number): Photo[] {
    const folders = ['Vacation', 'Family', 'Nature', 'Architecture', 'Street', 'Portraits', 'Events']
    const cameras = ['Canon EOS R5', 'Sony A7IV', 'Nikon Z9', 'iPhone 15 Pro', 'Pixel 8 Pro']
    const lenses = ['RF 24-70mm f/2.8', 'FE 85mm f/1.4', 'NIKKOR Z 50mm f/1.8', null]

    const photos: Photo[] = []
    for (let i = 1; i <= count; i++) {
        const isWide = Math.random() > 0.4
        const w = isWide ? 1600 : 1080
        const h = isWide ? 1067 : 1440
        const folder = folders[i % folders.length]
        const camera = cameras[i % cameras.length]
        const lens = lenses[i % lenses.length]

        // Generate dates spread across the last 6 months
        const daysAgo = Math.floor(Math.random() * 180)
        const date = new Date()
        date.setDate(date.getDate() - daysAgo)
        date.setHours(Math.floor(Math.random() * 14) + 8)
        date.setMinutes(Math.floor(Math.random() * 60))

        photos.push({
            id: i,
            path: `https://picsum.photos/seed/ifoto${i}/${w}/${h}`,
            filename: `IMG_${String(i).padStart(4, '0')}.jpg`,
            folderRel: folder,
            width: w,
            height: h,
            takenAt: date.toISOString(),
            modifiedAt: date.toISOString(),
            sizeBytes: Math.floor(Math.random() * 8_000_000) + 2_000_000,
            mediaType: i % 15 === 0 ? 'video' : 'photo',
            source: '/demo/photos',
            isFavorite: i % 7 === 0,
            isDeleted: false,
            deletedAt: null,
            cameraMake: camera.split(' ')[0],
            cameraModel: camera,
            lens: lens,
            iso: [100, 200, 400, 800, 1600][Math.floor(Math.random() * 5)],
            shutterSpeed: ['1/125', '1/250', '1/500', '1/1000', '1/2000'][Math.floor(Math.random() * 5)],
            aperture: ['f/1.4', 'f/2.0', 'f/2.8', 'f/4.0', 'f/5.6'][Math.floor(Math.random() * 5)],
            focalLength: ['24mm', '35mm', '50mm', '85mm', '70mm'][Math.floor(Math.random() * 5)],
            gpsLat: 37.7749 + (Math.random() - 0.5) * 10,
            gpsLon: -122.4194 + (Math.random() - 0.5) * 10,
        })
    }
    return photos
}

const demoPhotos = generateDemoPhotos(60)

// Pre-warm the decoded-image cache in the background so opening the editor
// renders instantly: the grid loads these URLs without CORS, and the editor's
// CORS fetch would otherwise re-download (~2-3s through picsum's redirects).
if (typeof window !== 'undefined') {
    const warm = () => {
        for (const p of demoPhotos) {
            if (p.mediaType === 'photo' && /^https?:/.test(p.path)) {
                loadImageCached(p.path).catch(() => {})
            }
        }
    }
    if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(warm, { timeout: 3000 })
    } else {
        setTimeout(warm, 800)
    }
}

const demoTags: Tag[] = [
    { id: 1, name: 'Nature', color: '#22c55e' },
    { id: 2, name: 'Travel', color: '#3b82f6' },
    { id: 3, name: 'Family', color: '#ec4899' },
    { id: 4, name: 'Work', color: '#f97316' },
]

const demoAlbums: Album[] = [
    { id: 1, name: 'Summer 2025', createdAt: '2025-08-01T00:00:00Z', photoCount: 24, coverPath: null },
    { id: 2, name: 'Best Shots', createdAt: '2025-06-15T00:00:00Z', photoCount: 12, coverPath: null },
]

const demoLibraries: SourceDirectory[] = [
    { id: 1, name: 'Demo Photos', rootPath: '/demo/photos', photoCount: demoPhotos.length },
]

// ── Mock invoke() ──

type InvokeHandler = (args?: any) => any

// Decoded demo images by URL — fetching+decoding a photo per render call is what
// made the browser editor feel like it took seconds to draw; cache the element.
const imageCache = new Map<string, Promise<HTMLImageElement>>()

function loadImageCached(src: string): Promise<HTMLImageElement> {
    let p = imageCache.get(src)
    if (!p) {
        p = new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image()
            im.crossOrigin = 'anonymous'
            im.onload = () => res(im)
            im.onerror = () => rej(new Error('load failed'))
            im.src = src
        })
        imageCache.set(src, p)
        // drop the entry on failure so a retry can succeed (flaky network)
        p.catch(() => imageCache.delete(src))
    }
    return p
}

const invokeHandlers: Record<string, InvokeHandler> = {
    'restore_session': () => demoLibraries.map(l => ({ id: l.id, rootPath: l.rootPath, name: l.name, photoCount: l.photoCount })),
    'get_all_photos': (args: any) => {
        const { limit = 100, offset = 0 } = args?.params || {}
        return demoPhotos.slice(offset, offset + limit)
    },
    'get_photo_count': () => demoPhotos.length,
    'get_libraries': () => demoLibraries,
    'select_and_index': () => null,
    'get_thumbnail_path': (args: any) => args?.sourcePath || '',
    'toggle_favorite': (args: any) => {
        const photo = demoPhotos.find(p => p.id === args?.photoId)
        if (photo) {
            photo.isFavorite = !photo.isFavorite
            return photo.isFavorite
        }
        return false
    },
    'soft_delete_photos': () => null,
    'restore_photos': () => null,
    'get_tags': () => demoTags,
    'create_tag': (args: any) => ({ id: Date.now(), name: args?.name, color: args?.color || '#0071e3' }),
    'delete_tag': () => null,
    'tag_photos': () => null,
    'untag_photos': () => null,
    'get_photo_tags': () => demoTags.slice(0, 2),
    'get_albums': () => demoAlbums,
    'create_album': (args: any) => ({ id: Date.now(), name: args?.name, createdAt: new Date().toISOString(), photoCount: 0, coverPath: null }),
    'delete_album': () => null,
    'rename_album': () => null,
    'add_to_album': () => null,
    'remove_from_album': () => null,
    'get_album_photos': () => demoPhotos.slice(0, 12),
    'search_photos': (args: any) => {
        const q = (args?.query || '').toLowerCase()
        return demoPhotos.filter(p => p.filename.toLowerCase().includes(q) || p.folderRel.toLowerCase().includes(q))
    },
    'load_editor_source': () => ({ width: 1200, height: 800, nativeWidth: 1600, nativeHeight: 1067, raw: false }),
    'unload_editor_source': () => null,
    'load_edit_params': () => null,
    'save_edit_params': () => null,
    'auto_enhance': () => ({
        light: { exposure: 0.25, contrast: 8, highlights: -12, shadows: 14, whites: 0, blacks: -4 },
        color: { vibrance: 15, saturation: 0 },
        wb: { mode: 'custom', temp: 5600, tint: 6 },
    }),
    'export_image': (args: any) => {
        console.log('[TauriMock] export_image →', args?.outputPath, args?.options)
        return null
    },
    'process_image': async (args: any) => {
        // Fallback Javascript pixel processor for browser testing! Speaks the new
        // LightCraft contract: `settings` (DevelopSettings JSON), `draft`,
        // `maxPreviewEdge`, `applyCrop` → ProcessResult with a data-URL preview.
        const dev = args?.settings ?? {}
        ;(window as any).__procT0 = performance.now()
        const light = dev.light ?? {}
        const wb = dev.wb ?? {}
        const color = dev.color ?? {}
        const effects = dev.effects ?? {}
        const draft = args?.draft === true
        const w = draft ? 600 : 800
        const h = Math.round(w * 2 / 3)
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        // Draw the actual photo (browser mode passes an http URL); cover-fit.
        // Falls back to the placeholder gradient if the load fails or the
        // canvas would be tainted (CORS).
        let drew = false
        const src = args?.imagePath
        if (typeof src === 'string' && /^https?:/.test(src)) {
            try {
                const img = await loadImageCached(src)
                const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
                const dw = img.naturalWidth * scale
                const dh = img.naturalHeight * scale
                ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
                drew = true
            } catch {
                drew = false
            }
        }

        if (!drew) {
            const lg = ctx.createLinearGradient(0, 0, w, h);
            lg.addColorStop(0, '#4a90e2');
            lg.addColorStop(0.5, '#50e3c2');
            lg.addColorStop(1, '#b8e986');
            ctx.fillStyle = lg;
            ctx.fillRect(0, 0, w, h);
        }

        // Small badge so it's clear this is the browser mock (suppress with
        // `window.__hideMockBadge = true` for clean screenshots)
        if (!(window as any).__hideMockBadge) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, 0, 168, 24);
            ctx.fillStyle = 'white';
            ctx.font = '11px sans-serif';
            ctx.fillText(drew ? 'BROWSER MOCK · ENGINE OFF' : 'BROWSER MOCK · NO PHOTO', 8, 16);
        }
        if (args?.applyCrop === false) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(0, h - 24, 220, 24);
            ctx.fillStyle = 'white';
            ctx.fillText('uncropped frame (crop tool)', 8, h - 8);
        }

        // Get pixels — may throw on a tainted canvas; retry on the gradient
        let idata: ImageData
        try {
            idata = ctx.getImageData(0, 0, w, h)
        } catch {
            const lg = ctx.createLinearGradient(0, 0, w, h);
            lg.addColorStop(0, '#4a90e2');
            lg.addColorStop(0.5, '#50e3c2');
            lg.addColorStop(1, '#b8e986');
            ctx.fillStyle = lg;
            ctx.fillRect(0, 0, w, h);
            idata = ctx.getImageData(0, 0, w, h)
        }
        const data = idata.data;

        const exposure = light.exposure || 0;
        const contrast = (light.contrast || 0) / 100.0;
        const temp = (wb.temp || 6500) - 6500;
        const tempShift = temp / 20000;

        for (let i = 0; i < data.length; i += 4) {
             let r = data[i] / 255.0;
             let g = data[i+1] / 255.0;
             let b = data[i+2] / 255.0;

             // Exposure
             const mult = Math.pow(2.0, exposure);
             r *= mult; g *= mult; b *= mult;

             // Temp
             r += tempShift;
             b -= tempShift;

             // Contrast
             if (Math.abs(contrast) > 0.001) {
                 const pivot = 0.5;
                 r = r > 0 ? Math.pow(r / pivot, 1.0 + contrast) * pivot : r;
                 g = g > 0 ? Math.pow(g / pivot, 1.0 + contrast) * pivot : g;
                 b = b > 0 ? Math.pow(b / pivot, 1.0 + contrast) * pivot : b;
             }

             // Desaturate slightly if negative sat, etc
             const sat = (color.saturation || 0) / 100.0;
             if (sat !== 0) {
                 const lum = 0.3*r + 0.59*g + 0.11*b;
                 r = lum + (r - lum) * (1.0 + sat);
                 g = lum + (g - lum) * (1.0 + sat);
                 b = lum + (b - lum) * (1.0 + sat);
             }

             // Clarity stands in for the effects section (visible feedback)
             const clarity = (effects.clarity || 0) / 100.0;
             if (clarity !== 0) {
                 const lum = 0.3*r + 0.59*g + 0.11*b;
                 r = lum + (r - lum) * (1.0 + clarity * 0.5);
                 g = lum + (g - lum) * (1.0 + clarity * 0.5);
                 b = lum + (b - lum) * (1.0 + clarity * 0.5);
             }

             data[i] = Math.max(0, Math.min(255, r * 255));
             data[i+1] = Math.max(0, Math.min(255, g * 255));
             data[i+2] = Math.max(0, Math.min(255, b * 255));
        }

        ctx.putImageData(idata, 0, 0);

        // Convert to data URL for immediate rendering
        const url = canvas.toDataURL('image/jpeg', 0.8);

        // A plausible histogram from the drawn pixels
        const r = new Array(256).fill(0), g = new Array(256).fill(0), b = new Array(256).fill(0), l = new Array(256).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            r[data[i]]++; g[data[i+1]]++; b[data[i+2]]++;
            l[Math.min(255, Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]))]++;
        }

        // Render timing for the UI test sweep (visible in console / window.__procMs)
        const t1 = performance.now()
        const elapsed = Math.round(t1 - (window as any).__procT0)
        ;(window as any).__procMs = elapsed
        console.log(`[TauriMock] process_image (${draft ? 'draft' : 'full'}) took ${elapsed}ms (incl. image fetch on cold cache)`)

        return {
            previewPath: url,
            width: w,
            height: h,
            pixelsB64: null,
            histogram: { r, g, b, l },
        };
    }
}

export async function mockInvoke<T>(cmd: string, args?: any): Promise<T> {
    const handler = invokeHandlers[cmd]
    if (handler) {
        // Simulate async delay — skipped for processing calls (they do real work
        // and the single-flight queue already coalesces them)
        if (cmd !== 'process_image' && cmd !== 'load_editor_source') {
            await new Promise(r => setTimeout(r, 80))
        }
        return handler(args) as T
    }
    console.warn(`[TauriMock] Unhandled invoke: "${cmd}"`, args)
    return null as T
}

export function mockConvertFileSrc(path: string): string {
    // In browser mode, if path is already an HTTP URL or data URI, return as-is
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
        return path;
    }
    // For local paths, return a placeholder
    const seed = path.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'default'
    return `https://picsum.photos/seed/${seed}/800/600`
}

export async function mockOpen(_options?: any): Promise<string | null> {
    // Simulate folder selection
    return '/demo/photos'
}

export async function mockMessage(msg: string, _options?: any): Promise<void> {
    console.log(`[TauriMock Dialog] ${msg}`)
    alert(msg)
}
