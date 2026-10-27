/**
 * Living Library — single listener for batched FS changes from Rust.
 */
import { get } from 'svelte/store'
import { photos, totalPhotoCount } from './store'
import type { Photo } from './store'
import { isTauri } from './tauriMock'

export interface LibraryBatchPayload {
    added: Photo[]
    removedIds: number[]
    updated: Photo[]
}

let unlisten: (() => void) | null = null

function mapRecord(r: Record<string, unknown>): Photo {
    return {
        id: r.id as number,
        path: (r.path as string) || '',
        filename: (r.filename as string) || '',
        folderRel: (r.folderRel as string) || (r.folder_rel as string) || '',
        width: (r.width as number) ?? null,
        height: (r.height as number) ?? null,
        takenAt: (r.takenAt as string) ?? (r.taken_at as string) ?? null,
        modifiedAt: (r.modifiedAt as string) || (r.modified_at as string) || '',
        sizeBytes: (r.sizeBytes as number) ?? (r.size_bytes as number) ?? 0,
        mediaType: (r.mediaType as string) || (r.media_type as string) || 'photo',
        source: (r.source as string) || '',
        isFavorite: !!(r.isFavorite ?? r.is_favorite),
        isDeleted: !!(r.isDeleted ?? r.is_deleted),
        deletedAt: (r.deletedAt as string) ?? (r.deleted_at as string) ?? null,
        cameraMake: (r.cameraMake as string) ?? (r.camera_make as string) ?? null,
        cameraModel: (r.cameraModel as string) ?? (r.camera_model as string) ?? null,
        lens: (r.lens as string) ?? null,
        iso: (r.iso as number) ?? null,
        shutterSpeed: (r.shutterSpeed as string) ?? (r.shutter_speed as string) ?? null,
        aperture: (r.aperture as string) ?? null,
        focalLength: (r.focalLength as string) ?? (r.focal_length as string) ?? null,
        gpsLat: (r.gpsLat as number) ?? (r.gps_lat as number) ?? null,
        gpsLon: (r.gpsLon as number) ?? (r.gps_lon as number) ?? null,
    }
}

function applyBatch(payload: LibraryBatchPayload) {
    photos.update(list => {
        let next = list.filter(p => !payload.removedIds.includes(p.id))
        const byId = new Map(next.map(p => [p.id, p]))
        for (const u of payload.updated) {
            byId.set(u.id, u)
        }
        for (const a of payload.added) {
            const mapped = mapRecord(a as unknown as Record<string, unknown>)
            byId.set(mapped.id, mapped)
        }
        next = Array.from(byId.values())
        return next
    })
    if (payload.added.length > 0 || payload.removedIds.length > 0) {
        totalPhotoCount.update(c => Math.max(0, c + payload.added.length - payload.removedIds.length))
    }
}

export async function initLibrarySync(): Promise<void> {
    if (!isTauri || unlisten) return
    try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<LibraryBatchPayload>('library-batch-changed', (event) => {
            const p = event.payload
            applyBatch({
                added: (p.added || []).map(a => mapRecord(a as unknown as Record<string, unknown>)),
                removedIds: p.removedIds || [],
                updated: (p.updated || []).map(u => mapRecord(u as unknown as Record<string, unknown>)),
            })
        })
    } catch (err) {
        console.warn('[LibrarySync] Failed to listen:', err)
    }
}

export function teardownLibrarySync() {
    if (unlisten) {
        unlisten()
        unlisten = null
    }
}
