// ── Collections ──
// Tags, albums, edit variants, favorites/trash, and file operations — the
// actions that mutate the library through backend commands and patch the
// photo store in place.

import { writable, get } from 'svelte/store'
import { invokeCommand as invoke } from './ipc'
import { photos, selectedPhoto, patchPhoto, activeSection } from './library'
import { clearSelection } from './selection'

// ── Tags ──

export interface Tag {
    id: number
    name: string
    color: string
}

export const tags = writable<Tag[]>([])

export async function loadTags() {
    try {
        const result = await invoke<Tag[]>('get_tags')
        tags.set(result || [])
    } catch (err) {
        console.error('Failed to load tags:', err)
    }
}

export async function createTag(name: string, color: string = '#0071e3'): Promise<Tag | null> {
    try {
        const tag = await invoke<Tag>('create_tag', { name, color })
        tags.update(list => [...list, tag])
        return tag
    } catch (err) {
        console.error('Failed to create tag:', err)
        return null
    }
}

export async function deleteTag(tagId: number) {
    try {
        await invoke('delete_tag', { tagId })
        tags.update(list => list.filter(t => t.id !== tagId))
    } catch (err) {
        console.error('Failed to delete tag:', err)
    }
}

export async function tagPhotos(photoIds: number[], tagId: number) {
    try {
        await invoke('tag_photos', { photoIds, tagId })
    } catch (err) {
        console.error('Failed to tag photos:', err)
    }
}

export async function untagPhotos(photoIds: number[], tagId: number) {
    try {
        await invoke('untag_photos', { photoIds, tagId })
    } catch (err) {
        console.error('Failed to untag photos:', err)
    }
}

export async function getPhotoTags(photoId: number): Promise<Tag[]> {
    try {
        return await invoke<Tag[]>('get_photo_tags', { photoId })
    } catch (err) {
        console.error('Failed to get photo tags:', err)
        return []
    }
}

// ── Albums ──

export interface Album {
    id: number
    name: string
    createdAt: string
    photoCount: number
    coverPath: string | null
}

export const albums = writable<Album[]>([])

export async function loadAlbums() {
    try {
        const result = await invoke<Album[]>('get_albums')
        albums.set(result || [])
    } catch (err) {
        console.error('Failed to load albums:', err)
    }
}

export async function createAlbum(name: string): Promise<Album | null> {
    try {
        const album = await invoke<Album>('create_album', { name })
        albums.update(list => [album, ...list])
        return album
    } catch (err) {
        console.error('Failed to create album:', err)
        return null
    }
}

export async function deleteAlbum(albumId: number) {
    try {
        await invoke('delete_album', { albumId })
        albums.update(list => list.filter(a => a.id !== albumId))
    } catch (err) {
        console.error('Failed to delete album:', err)
    }
}

export async function renameAlbum(albumId: number, newName: string) {
    try {
        await invoke('rename_album', { albumId, newName })
        albums.update(list => list.map(a => a.id === albumId ? { ...a, name: newName } : a))
    } catch (err) {
        console.error('Failed to rename album:', err)
    }
}

export async function addToAlbum(albumId: number, photoIds: number[]) {
    try {
        await invoke('add_to_album', { albumId, photoIds })
        await loadAlbums()
    } catch (err) {
        console.error('Failed to add to album:', err)
    }
}

export async function removeFromAlbum(albumId: number, photoIds: number[]) {
    try {
        await invoke('remove_from_album', { albumId, photoIds })
        await loadAlbums()
    } catch (err) {
        console.error('Failed to remove from album:', err)
    }
}

export async function loadAlbumPhotos(albumId: number) {
    try {
        const result = await invoke<import('./library').Photo[]>('get_album_photos', { albumId })
        photos.set(result || [])
        return result
    } catch (err) {
        console.error('Failed to load album photos:', err)
        return []
    }
}

export async function loadTagPhotos(tagName: string) {
    try {
        // Search for #tagName
        const result = await invoke<import('./library').Photo[]>('search_photos', { query: `#${tagName}` })
        photos.set(result || [])
    } catch (err) {
        console.error('Failed to load tag photos:', err)
    }
}

// ── Edit variants ──

export interface PhotoVariant {
    id: number
    photoId: number
    name: string
    editParams: string
    createdAt: string
}

export async function createPhotoVariant(photoId: number, name: string, editParams: string) {
    return invoke<PhotoVariant>('create_photo_variant', { photoId, name, editParams })
}

export async function getPhotoVariants(photoId: number) {
    return invoke<PhotoVariant[]>('get_photo_variants', { photoId })
}

// ── Favorites / Trash / File operations ──

export async function toggleFavorite(photoId: number): Promise<boolean> {
    try {
        const isFav = await invoke<boolean>('toggle_favorite', { photoId })
        patchPhoto(photoId, { isFavorite: isFav })
        selectedPhoto.update(p =>
            p && p.id === photoId ? { ...p, isFavorite: isFav } : p
        )
        return isFav
    } catch (err) {
        console.error('Failed to toggle favorite:', err)
        return false
    }
}

export async function deletePhotos(photoIds: number[]) {
    try {
        await invoke('soft_delete_photos', { photoIds })
        if (get(activeSection) === 'trash') {
            photoIds.forEach(id => patchPhoto(id, { isDeleted: true }))
        } else {
            photos.update(list => list.filter(p => !photoIds.includes(p.id)))
        }
        selectedPhoto.update(p => p && photoIds.includes(p.id) ? null : p)
        clearSelection()
    } catch (err) {
        console.error('Failed to delete photos:', err)
    }
}

export async function restorePhotos(photoIds: number[]) {
    try {
        await invoke('restore_photos', { photoIds })
        photos.update(list => list.filter(p => !photoIds.includes(p.id)))
        clearSelection()
    } catch (err) {
        console.error('Failed to restore photos:', err)
    }
}

export async function hardDeletePhotos(photoIds: number[], deleteFromDisk: boolean = false) {
    try {
        await invoke('hard_delete_photos', { photoIds, deleteFromDisk })
        photos.update(list => list.filter(p => !photoIds.includes(p.id)))
        selectedPhoto.update(p => p && photoIds.includes(p.id) ? null : p)
        clearSelection()
    } catch (err) {
        console.error('Failed to hard delete photos:', err)
    }
}

export async function renamePhoto(photoId: number, newFilename: string) {
    try {
        const newPath = await invoke<string>('rename_photo', { photoId, newFilename })
        photos.update(list => list.map(p =>
            p.id === photoId ? { ...p, filename: newFilename, path: newPath } : p
        ))
        selectedPhoto.update(p =>
            p && p.id === photoId ? { ...p, filename: newFilename, path: newPath } : p
        )
    } catch (err) {
        console.error('Failed to rename photo:', err)
    }
}
