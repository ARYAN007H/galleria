// ── Image Processor ──
// Tauri invoke wrapper with single-flight coalescing, on top of the LightCraft
// develop engine. Previews travel as base64-encoded RGBA (fast path) or a temp
// JPEG (full-res renders); drags render at draft quality, releases at full.

import { invokeCommand, convertFileSource } from '../store';
import { toDevelopSettings, autoPatchToState, type DevelopSettings } from './developSettings';
import type { AdjustmentState } from './adjustments';

interface ProcessResult {
    previewPath: string; // temp file path (fallback for large images)
    width: number;
    height: number;
    pixelsB64: string | null; // base64-encoded RGBA pixels (fast path)
    histogram: HistogramResult | null; // inline histogram from the render
}

export interface LoadSourceResult {
    width: number;   // proxy dimensions (what the canvas shows)
    height: number;
    nativeWidth: number;  // original file dimensions
    nativeHeight: number;
    raw: boolean;
}

export interface HistogramData {
    r: number[];
    g: number[];
    b: number[];
    l: number[];
}

interface HistogramResult {
    r: number[];
    g: number[];
    b: number[];
    l: number[];
}

export interface ProcessOptions {
    /** True while a slider is being scrubbed — draft quality (faster, slightly coarser). */
    draft?: boolean;
    /** False shows the uncropped frame (crop tool). Default true. */
    applyCrop?: boolean;
}

// ── Single-Flight Coalescing State ──
// Only one Rust invocation can be in-flight at a time.
// New requests while processing replace the pending slot (latest-wins).
// When processing finishes, the pending request fires immediately.

let isProcessing = false;
let pendingRequest: {
    path: string;
    settings: DevelopSettings;
    maxEdge?: number;
    opts: ProcessOptions;
    resolve: (v: { imageData: ImageData | null; histogram: HistogramData | null }) => void;
    reject: (e: any) => void;
} | null = null;

// Monotonic version counter for stale detection
let requestVersion = 0;

/**
 * Decode source into the Rust-side editor cache (call once per photo).
 */
export async function loadEditorSource(imagePath: string): Promise<LoadSourceResult | null> {
    try {
        return await invokeCommand<LoadSourceResult>('load_editor_source', { imagePath });
    } catch (err) {
        console.error('Failed to load editor source:', err);
        return null;
    }
}

/**
 * Drop the Rust-side editor cache (call on editor close).
 */
export async function unloadEditorSource(): Promise<void> {
    try {
        await invokeCommand('unload_editor_source');
    } catch (err) {
        console.error('Failed to unload editor source:', err);
    }
}

/** LightCraft Auto tone + Auto WB, returned as a UI-state patch. */
export async function autoEnhance(
    imagePath: string,
    adjustments: AdjustmentState,
): Promise<Partial<AdjustmentState> | null> {
    try {
        const patch = await invokeCommand<any>('auto_enhance', {
            imagePath,
            settings: toDevelopSettings(adjustments),
        });
        return patch ? autoPatchToState(patch) : null;
    } catch (err) {
        console.error('Auto enhance failed:', err);
        return null;
    }
}

/** Full-quality export through the same pipeline (re-decodes the original). */
export async function exportImage(
    imagePath: string,
    adjustments: AdjustmentState,
    options: { format: string; quality: number; maxLongEdge: number },
    outputPath: string,
): Promise<void> {
    await invokeCommand('export_image', {
        imagePath,
        settings: toDevelopSettings(adjustments),
        options,
        outputPath,
    });
}

/**
 * Decode base64-encoded RGBA pixels into ImageData.
 * The `fetch` data-URL path decodes base64 natively (C++) — the old per-byte
 * `charCodeAt` loop cost tens of ms on every preview frame.
 */
async function base64ToImageData(b64: string, width: number, height: number): Promise<ImageData | null> {
    try {
        const resp = await fetch(`data:application/octet-stream;base64,${b64}`);
        const buf = new Uint8ClampedArray(await resp.arrayBuffer());
        const expectedLength = width * height * 4;
        if (buf.length !== expectedLength) {
            console.warn(`Base64 pixel length mismatch: got ${buf.length}, expected ${expectedLength}`);
            return null;
        }
        return new ImageData(buf, width, height);
    } catch (err) {
        console.error('Failed to decode base64 pixels:', err);
        return null;
    }
}

/**
 * Load a temp file preview image into an ImageData for canvas rendering.
 */
async function loadPreviewFile(previewPath: string): Promise<ImageData | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            resolve(imageData);
        };
        img.onerror = () => {
            console.error('Failed to load preview file');
            resolve(null);
        };
        const mapped = convertFileSource(previewPath);
        if (mapped.startsWith('data:')) {
            img.src = mapped;
        } else {
            img.src = mapped + '?t=' + Date.now();
        }
    });
}

/**
 * Core processing function — sends DevelopSettings to the LightCraft backend.
 */
async function executeProcess(
    path: string,
    settings: DevelopSettings,
    maxEdge: number | undefined,
    opts: ProcessOptions,
): Promise<{ imageData: ImageData | null; histogram: HistogramData | null }> {
    try {
        const result = await invokeCommand<ProcessResult>('process_image', {
            imagePath: path,
            settings,
            draft: opts.draft === true,
            maxPreviewEdge: maxEdge ?? null,
            applyCrop: opts.applyCrop !== false,
        });

        if (!result || result.width === 0) return { imageData: null, histogram: null };

        const histogram = result.histogram ?? null;

        if (result.pixelsB64 && result.pixelsB64.length > 0) {
            const imageData = await base64ToImageData(result.pixelsB64, result.width, result.height);
            return { imageData, histogram };
        }

        if (result.previewPath) {
            const imageData = await loadPreviewFile(result.previewPath);
            return { imageData, histogram };
        }
    } catch (err) {
        console.error('Image processing failed:', err);
    }
    return { imageData: null, histogram: null };
}

/**
 * Process image with single-flight coalescing for fluid updates.
 *
 * @param path - Absolute file path to the source image
 * @param adjustments - Current adjustment state
 * @param preview - If true, process at reduced resolution (600-800px); else at the proxy's size
 * @param maxPreviewEdge - Adaptive preview edge override
 * @param opts - draft quality (slider drag) / applyCrop (false in crop tool)
 */
export function processImage(
    path: string,
    adjustments: AdjustmentState,
    preview: boolean = true,
    maxPreviewEdge?: number,
    opts: ProcessOptions = {},
): Promise<{ imageData: ImageData | null; histogram: HistogramData | null }> {
    const version = ++requestVersion;
    const settings = toDevelopSettings(adjustments);
    const edge = preview ? maxPreviewEdge : 2816; // 2816 = the editor proxy's long edge

    return new Promise((resolve, reject) => {
        if (isProcessing) {
            if (pendingRequest) {
                pendingRequest.resolve({ imageData: null, histogram: null });
            }
            pendingRequest = { path, settings, maxEdge: edge, opts, resolve, reject };
            return;
        }
        runProcess(path, settings, edge, opts, version, resolve, reject);
    });
}

/**
 * Internal: Execute processing and drain pending queue when done.
 */
async function runProcess(
    path: string,
    settings: DevelopSettings,
    maxEdge: number | undefined,
    opts: ProcessOptions,
    version: number,
    resolve: (v: { imageData: ImageData | null; histogram: HistogramData | null }) => void,
    reject: (e: any) => void,
): Promise<void> {
    isProcessing = true;
    try {
        const result = await executeProcess(path, settings, maxEdge, opts);

        if (version < requestVersion && pendingRequest) {
            resolve({ imageData: null, histogram: null });
        } else {
            resolve(result);
        }
    } catch (err) {
        reject(err);
    } finally {
        isProcessing = false;

        if (pendingRequest) {
            const req = pendingRequest;
            pendingRequest = null;
            const nextVersion = ++requestVersion;
            queueMicrotask(() => {
                runProcess(req.path, req.settings, req.maxEdge, req.opts, nextVersion, req.resolve, req.reject);
            });
        }
    }
}

/**
 * Process at the proxy's full resolution. For final render on pointer release.
 */
export async function processImageFull(
    path: string,
    adjustments: AdjustmentState,
): Promise<{ imageData: ImageData | null; histogram: HistogramData | null }> {
    return executeProcess(path, toDevelopSettings(adjustments), 2816, {});
}

/**
 * Compute histogram from ImageData (inline, no IPC needed).
 */
export function computeHistogram(imageData: ImageData): HistogramData {
    const data = imageData.data;
    const r = new Uint32Array(256);
    const g = new Uint32Array(256);
    const b = new Uint32Array(256);
    const l = new Uint32Array(256);

    for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
        const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5) | 0;
        l[Math.min(lum, 255)]++;
    }

    return {
        r: Array.from(r),
        g: Array.from(g),
        b: Array.from(b),
        l: Array.from(l),
    };
}
