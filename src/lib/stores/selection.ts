// ── Multi-select ──

import { writable, get } from 'svelte/store'
import { filteredPhotos } from './library'

export const selectedPhotoIds = writable<Set<number>>(new Set())
export const isMultiSelectMode = writable<boolean>(false)

export function toggleMultiSelect() {
    isMultiSelectMode.update(v => {
        if (v) selectedPhotoIds.set(new Set())
        return !v
    })
}

export function clearSelection() {
    selectedPhotoIds.set(new Set())
    isMultiSelectMode.set(false)
}

export function togglePhotoSelection(photoId: number) {
    selectedPhotoIds.update(ids => {
        const next = new Set(ids)
        if (next.has(photoId)) next.delete(photoId)
        else next.add(photoId)
        return next
    })
}

export function selectAllPhotos() {
    const all = get(filteredPhotos)
    selectedPhotoIds.set(new Set(all.map(p => p.id)))
}
