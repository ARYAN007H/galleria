// ── IPC bootstrap ──
// Conditional Tauri API — real APIs in Tauri, mocks in the browser.
// This is the only module that touches the runtime; every other store module
// goes through `invoke`.

import { isTauri, mockInvoke, mockConvertFileSrc, mockOpen, mockMessage } from '../tauriMock'
import type { Photo } from './library'

let invoke: <T>(cmd: string, args?: any) => Promise<T>
let convertFileSrc: (path: string) => string
let open: (options?: any) => Promise<string | string[] | null>
let message: (msg: string, options?: any) => Promise<void>

if (isTauri) {
    // Dynamic import for Tauri runtime
    const tauriCore = await import('@tauri-apps/api/core')
    const tauriDialog = await import('@tauri-apps/plugin-dialog')
    invoke = tauriCore.invoke
    convertFileSrc = tauriCore.convertFileSrc
    open = tauriDialog.open as any
    message = tauriDialog.message as any
} else {
    invoke = mockInvoke
    convertFileSrc = mockConvertFileSrc
    open = mockOpen as any
    message = mockMessage
}

/** Direct command access for components and engine helpers. */
export async function invokeCommand<T>(cmd: string, args?: any): Promise<T> {
    return invoke<T>(cmd, args)
}

/** Asset-protocol URL for a file path. */
export function convertFileSource(path: string): string {
    return convertFileSrc(path)
}

/** Instant photo source — the asset protocol serves the original file directly. */
export function getPhotoSrc(photo: Photo): string {
    return convertFileSrc(photo.path)
}

/** Cached thumbnail path for a source photo. */
export async function getThumbnail(photoPath: string): Promise<string> {
    try {
        return await invoke<string>('get_thumbnail_path', { sourcePath: photoPath })
    } catch (err) {
        console.error('Failed to get thumbnail:', err)
        return ''
    }
}

export async function showMessageBox(msg: string, options?: any): Promise<void> {
    await message(msg, options)
}

export async function pickDirectory(title: string): Promise<string | null> {
    const selected = await open({ directory: true, multiple: false, title })
    if (!selected) return null
    return typeof selected === 'string' ? selected : selected[0]
}
