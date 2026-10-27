<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import {
        selectedPhoto,
        convertFileSource,
        invokeCommand,
        filteredPhotos,
    } from "../lib/store";
    import type { Photo } from "../lib/store";
    import EditingSidebar from "../lib/editing/EditingSidebar.svelte";
    import CropOverlay from "../lib/editing/CropOverlay.svelte";
    import MaskingOverlay from "../lib/editing/MaskingOverlay.svelte";
    import Histogram from "../lib/editing/Histogram.svelte";
    import ExportDialog from "../lib/editing/ExportDialog.svelte";
    import {
        type AdjustmentState,
        defaultAdjustments,
        cloneAdjustments,
    } from "../lib/editing/adjustments";
    import {
        toDevelopSettings,
        isDevelopSettings,
        applyDevelopSettings,
    } from "../lib/editing/developSettings";
    import {
        processImage,
        computeHistogram,
        loadEditorSource,
        unloadEditorSource,
        autoEnhance,
        exportImage,
        type HistogramData,
    } from "../lib/editing/imageProcessor";
    import { getCachedThumb } from "../lib/thumbnailCache";
    import {
        recordChange,
        historyUndo,
        historyRedo,
        resetHistory,
    } from "../lib/editor/historyStore";

    export let onClose: () => void;

    // ── State ──
    let adjustments: AdjustmentState = cloneAdjustments(defaultAdjustments);
    let histogramData: HistogramData | null = null;
    let showOriginal = false;
    let saving = false;
    let hasChanges = false;
    let imagePath = '';
    let showExport = false;
    let isRawSource = false;

    // Canvas refs
    let canvasEl: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    let imageLoaded = false;
    let imgW = 0;
    let imgH = 0;
    let isProcessingPreview = false;
    let clippingCanvasEl: HTMLCanvasElement;
    let clippingCtx: CanvasRenderingContext2D;

    // Undo (using historyStore)
    // historyStore is now the source of truth for undo/redo

    // Resizable sidebar
    let sidebarWidth = 320;
    let isResizing = false;
    const MIN_SIDEBAR = 260;
    const MAX_SIDEBAR = 480;

    // Zoom
    let zoomLevel = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;

    // Tool strip
    // Tool strip
    type EditorTool = 'adjust' | 'crop' | 'mask';
    let activeTool: EditorTool = 'adjust';
    
    // Mask Tool State
    let activeMaskId: string | null = null;
    let activeNewType: string | null = null;

    function switchTool(tool: EditorTool) {
        activeTool = tool;
        if (tool !== 'mask') {
            activeMaskId = null;
            activeNewType = null;
        }
    }

    // Panel visibility
    let canvasClientWidth = 0;
    let canvasClientHeight = 0;

    let showPanel = true;
    let showHistogramOverlay = true;

    // Before/After split
    let splitPosition = 50; // percent
    let isDraggingSplit = false;

    // Keyboard shortcut overlay
    let showShortcuts = false;

    // Clipping warnings
    let showClippingWarnings = false;

    // Filmstrip
    $: filmstripPhotos = $filteredPhotos.slice(0, 100); // first 100 for filmstrip
    $: currentPhotoIndex = filmstripPhotos.findIndex(p => p.id === $selectedPhoto?.id);
    let filmstripEl: HTMLDivElement;

    // ── Zoom Functions ──
    function zoomIn() { zoomLevel = Math.min(zoomLevel * 1.25, 8); }
    function zoomOut() { zoomLevel = Math.max(zoomLevel / 1.25, 0.25); }
    function zoomFit() { zoomLevel = 1; panX = 0; panY = 0; }
    function zoom100() {
        if (canvasEl) {
            const area = canvasEl.parentElement?.parentElement;
            if (area) {
                const areaW = area.clientWidth - 48;
                const areaH = area.clientHeight - 48;
                const fitScale = Math.min(areaW / imgW, areaH / imgH, 1);
                zoomLevel = 1 / fitScale;
            }
        }
        panX = 0; panY = 0;
    }

    function handleWheel(e: WheelEvent) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomLevel = Math.max(0.25, Math.min(8, zoomLevel * delta));
    }

    function handleCanvasPointerDown(e: MouseEvent) {
        if (zoomLevel > 1) {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartPanX = panX;
            panStartPanY = panY;
        }
    }

    function handleCanvasPointerMove(e: MouseEvent) {
        if (!isPanning) return;
        panX = panStartPanX + (e.clientX - panStartX);
        panY = panStartPanY + (e.clientY - panStartY);
    }

    function handleCanvasPointerUp() {
        isPanning = false;
    }

    // ── Sidebar Resize ──
    function startResize(e: MouseEvent) {
        e.preventDefault();
        isResizing = true;
        const startX = e.clientX;
        const startWidth = sidebarWidth;
        function onMove(ev: MouseEvent) {
            sidebarWidth = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startWidth + (startX - ev.clientX)));
        }
        function onUp() {
            isResizing = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        }
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // ── Image Loading ──
    // Loads saved edits for the open photo: the XMP sidecar next to the file
    // wins (edits travel with the photo and stay editable in LightCraft /
    // Lightroom Classic), then the DB's LightCraft JSON, then the legacy blob.
    async function loadSavedEdits(path: string): Promise<boolean> {
        try {
            const xmp = await invokeCommand<unknown>('read_xmp_sidecar', { photoPath: path }).catch(() => null);
            if (xmp && typeof xmp === 'object') {
                adjustments = applyDevelopSettings(xmp as any);
                hasChanges = true;
                return true;
            }
        } catch (err) {
            console.warn('Could not read XMP sidecar:', err);
        }
        try {
            const savedJson = await invokeCommand<string | null>('load_edit_params', { photoPath: path });
            if (savedJson) {
                const saved = JSON.parse(savedJson);
                if (isDevelopSettings(saved)) {
                    adjustments = applyDevelopSettings(saved);
                } else {
                    adjustments = { ...cloneAdjustments(defaultAdjustments), ...saved };
                }
                hasChanges = true;
                return true;
            }
        } catch (err) {
            console.warn('Could not load saved edits:', err);
        }
        return false;
    }

    // Decodes the photo into the Rust-side editor cache and sizes the canvas.
    // Everything shown on the canvas comes from the engine — RAWs included.
    async function openPhoto(path: string) {
        const loaded = await loadEditorSource(path);
        if (loaded && loaded.width > 0) {
            imgW = loaded.width;
            imgH = loaded.height;
            isRawSource = loaded.raw;
            initCanvas();
        } else {
            imageLoaded = true;
        }
    }

    onMount(async () => {
        if (!$selectedPhoto) return;
        imagePath = $selectedPhoto.path;
        await loadSavedEdits(imagePath);
        await openPhoto(imagePath);
    });

    onDestroy(() => {
        unloadEditorSource();
        resetHistory();
    });

    function initCanvas() {
        const tryInit = () => {
            if (canvasEl && clippingCanvasEl && imgW > 0 && imgH > 0) {
                canvasEl.width = imgW;
                canvasEl.height = imgH;
                clippingCanvasEl.width = imgW;
                clippingCanvasEl.height = imgH;
                ctx = canvasEl.getContext("2d")!;
                clippingCtx = clippingCanvasEl.getContext("2d")!;
                imageLoaded = true;
                triggerProcess(true);
            } else {
                requestAnimationFrame(tryInit);
            }
        };
        tryInit();
    }

    // ── Processing Pipeline ──
    let processingTimeout: ReturnType<typeof setTimeout> | null = null;

    async function triggerProcess(preview: boolean = true, isDrag: boolean = false, beforeState: AdjustmentState | null = null) {
        if (!imagePath || !canvasEl || !ctx) return;

        // Show processing indicator after a short delay (avoid flicker on fast ops)
        if (processingTimeout) clearTimeout(processingTimeout);
        processingTimeout = setTimeout(() => { isProcessingPreview = true; }, 150);

        const adj = beforeState ?? adjustments;

        // Render at what the viewport actually shows (device pixels), not a fixed
        // size — LightCraft's UI does the same. Drafts cap lower for cheap drags.
        const dpr = window.devicePixelRatio || 1;
        const viewportEdge = Math.round(Math.max(canvasClientWidth, canvasClientHeight, 300) * dpr);
        const maxEdge = isDrag ? Math.min(viewportEdge, 900) : Math.min(viewportEdge, 1600);
        const result = await processImage(imagePath, adj, preview, maxEdge, {
            draft: isDrag,
            applyCrop: activeTool !== 'crop',
        });

        if (processingTimeout) { clearTimeout(processingTimeout); processingTimeout = null; }
        isProcessingPreview = false;

        if (result.imageData && ctx && canvasEl && clippingCanvasEl && clippingCtx) {
            const imgData = result.imageData;
            if (imgData.width !== canvasEl.width || imgData.height !== canvasEl.height) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = imgData.width;
                tempCanvas.height = imgData.height;
                const tempCtx = tempCanvas.getContext('2d')!;
                tempCtx.putImageData(imgData, 0, 0);
                ctx.drawImage(tempCanvas, 0, 0, canvasEl.width, canvasEl.height);

                clippingCanvasEl.width = canvasEl.width;
                clippingCanvasEl.height = canvasEl.height;
            } else {
                ctx.putImageData(imgData, 0, 0);
            }
            // Use inline histogram from the render (free), fallback to JS computation
            histogramData = result.histogram ?? computeHistogram(imgData);
            if (showClippingWarnings) updateClippingWarnings(imgData);
        }
    }

    /** The "before" state: default settings through the same engine (cheap — StageCache). */
    function showBefore() {
        triggerProcess(true, false, cloneAdjustments(defaultAdjustments));
    }

    function updateClippingWarnings(imageData: ImageData) {
        if (!clippingCtx || !clippingCanvasEl || !showClippingWarnings) return;
        const width = imageData.width;
        const height = imageData.height;
        if (clippingCanvasEl.width !== width || clippingCanvasEl.height !== height) {
            clippingCanvasEl.width = width;
            clippingCanvasEl.height = height;
        }

        const newImageData = clippingCtx.createImageData(width, height);
        const data = imageData.data;
        const out = newImageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            // Pure white -> red
            if (r === 255 && g === 255 && b === 255) {
                out[i] = 255; out[i+1] = 0; out[i+2] = 0; out[i+3] = 200;
            } 
            // Pure black -> blue
            else if (r === 0 && g === 0 && b === 0) {
                out[i] = 0; out[i+1] = 0; out[i+2] = 255; out[i+3] = 200;
            }
        }
        clippingCtx.putImageData(newImageData, 0, 0);
    }

    // Reactively update clipping warnings when toggled
    $: if (showClippingWarnings && ctx && canvasEl) {
        if (canvasEl.width > 0 && canvasEl.height > 0) {
            const currentImg = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            updateClippingWarnings(currentImg);
        }
    } else if (!showClippingWarnings && clippingCtx && clippingCanvasEl) {
        clippingCtx.clearRect(0, 0, clippingCanvasEl.width, clippingCanvasEl.height);
    }

    // ── Adjustment Handlers ──
    let historyDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * Scrub handler — fires continuously during slider drag.
     * Updates adjustment state and triggers low-res preview.
     * NO history recording (too expensive per-frame).
     */
    function onAdjustmentScrub(e: CustomEvent<Partial<AdjustmentState>>) {
        adjustments = { ...adjustments, ...e.detail };
        hasChanges = true;
        triggerProcess(true, true); // preview, isDrag=true for adaptive resolution
    }

    /**
     * Change handler — fires on slider release (commit point).
     * Updates adjustment state, triggers full-res processing,
     * and records a debounced history entry.
     */
    function onAdjustmentChange(e: CustomEvent<Partial<AdjustmentState>>) {
        const changedKeys = Object.keys(e.detail);
        const label = changedKeys.length === 1 ? changedKeys[0] : 'Multiple adjustments';
        adjustments = { ...adjustments, ...e.detail };
        hasChanges = true;

        // Debounced history: coalesce rapid commits (e.g. double-click reset)
        if (historyDebounceTimer) clearTimeout(historyDebounceTimer);
        historyDebounceTimer = setTimeout(() => {
            recordChange(label, adjustments);
            historyDebounceTimer = null;
        }, 150);

        triggerProcess(true, false); // preview but NOT drag → 800px
    }

    function onResetAll() {
        recordChange('Reset All', cloneAdjustments(defaultAdjustments));
        adjustments = cloneAdjustments(defaultAdjustments);
        hasChanges = false;
        triggerProcess(true);
    }

    function onBeforeAfter(e: CustomEvent<boolean>) {
        showOriginal = e.detail;
        if (showOriginal) {
            showBefore();
        } else {
            triggerProcess(true);
        }
    }

    /** LightCraft Auto (scene analysis): tone + white balance as a state patch. */
    async function handleAuto() {
        if (!imagePath || isProcessingPreview) return;
        const patch = await autoEnhance(imagePath, adjustments);
        if (patch) {
            adjustments = { ...adjustments, ...patch };
            hasChanges = true;
            recordChange('Auto', adjustments);
            triggerProcess(true);
        }
    }

    function undo() {
        const prev = historyUndo();
        if (prev) {
            adjustments = prev;
            triggerProcess(true);
        }
        // Check if we're back to original
        const adj = adjustments;
        const def = defaultAdjustments;
        hasChanges = JSON.stringify(adj) !== JSON.stringify(def);
    }

    function redo() {
        const next = historyRedo();
        if (next) {
            adjustments = next;
            hasChanges = true;
            triggerProcess(true);
        }
    }

    async function handleSave() {
        if (!$selectedPhoto) return;
        saving = true;
        try {
            const originalPath = $selectedPhoto.path;
            // Save a developed copy at the original's full resolution through the
            // engine (re-decodes the original — never the editor proxy).
            const ext = (originalPath.split(".").pop() || "jpg").toLowerCase();
            const format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : (ext === 'tif' || ext === 'tiff') ? 'tiff' : 'jpeg';
            const baseName = originalPath.replace(/\.[^.]+$/, "");
            const savePath = `${baseName}_edited.${format === 'jpeg' ? 'jpg' : format}`;
            await exportImage(originalPath, adjustments, { format, quality: 95, maxLongEdge: 0 }, savePath);

            // Persist the develop settings: DB blob + XMP sidecar next to the
            // file (sidecar wins on load, and LightCraft/Lightroom can read it)
            try {
                const dev = JSON.stringify(toDevelopSettings(adjustments));
                await invokeCommand('save_edit_params', {
                    photoPath: originalPath,
                    paramsJson: dev,
                });
                await invokeCommand('write_xmp_sidecar', {
                    photoPath: originalPath,
                    settings: toDevelopSettings(adjustments),
                }).catch((err) => console.warn('Sidecar write skipped:', err));
            } catch (err) { console.warn('Could not persist edit params:', err); }

            onClose();
        } catch (err) { console.error("Save failed:", err); }
        saving = false;
    }

    // ── Filmstrip Navigation ──
    async function navigateToPhoto(photo: Photo) {
        if (hasChanges && !confirm("Discard unsaved changes?")) return;

        // Auto-save current edit state before navigating (DB blob + XMP sidecar)
        if (hasChanges && imagePath) {
            const dev = toDevelopSettings(adjustments);
            invokeCommand('save_edit_params', {
                photoPath: imagePath,
                paramsJson: JSON.stringify(dev),
            }).catch(() => {});
            invokeCommand('write_xmp_sidecar', { photoPath: imagePath, settings: dev }).catch(() => {});
        }

        selectedPhoto.set(photo);
        adjustments = cloneAdjustments(defaultAdjustments);
        resetHistory();
        hasChanges = false;
        imagePath = photo.path;
        imageLoaded = false;

        await loadSavedEdits(photo.path);
        await openPhoto(photo.path);
    }

    function nextPhoto() {
        if (currentPhotoIndex < filmstripPhotos.length - 1) {
            navigateToPhoto(filmstripPhotos[currentPhotoIndex + 1]);
        }
    }

    function prevPhoto() {
        if (currentPhotoIndex > 0) {
            navigateToPhoto(filmstripPhotos[currentPhotoIndex - 1]);
        }
    }

    // ── Keyboard Shortcuts ──
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            if (showShortcuts) { showShortcuts = false; return; }
            onClose();
        }
        if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) undo();
        if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) redo();
        if (e.key === "y" && (e.ctrlKey || e.metaKey)) redo();
        if (e.key === "=" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomIn(); }
        if (e.key === "-" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomOut(); }
        if (e.key === "0" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); zoomFit(); }
        if (e.key === "ArrowRight") nextPhoto();
        if (e.key === "ArrowLeft") prevPhoto();
        if (e.key === "\\") showOriginal = !showOriginal;
        if (e.key === "h") showHistogramOverlay = !showHistogramOverlay;
        if (e.key === "p") showPanel = !showPanel;
        if (e.key === "?") showShortcuts = !showShortcuts;
        if (e.key === "j") showClippingWarnings = !showClippingWarnings;
    }

    function handlePointerUp() {
        // On global pointer-up, if there are pending changes, trigger
        // a final full-quality preview render (not full-res, just bigger preview)
        if (hasChanges) triggerProcess(true, false); // 800px preview, not drag
    }

    // ── Auto-scroll filmstrip to current photo ──
    function scrollFilmstripToCurrent() {
        if (!filmstripEl || currentPhotoIndex < 0) return;
        const thumbs = filmstripEl.querySelectorAll('.filmstrip-thumb');
        const active = thumbs[currentPhotoIndex] as HTMLElement;
        if (active) {
            active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    $: if (filmstripEl && currentPhotoIndex >= 0) {
        // Reactive auto-scroll when photo changes
        setTimeout(scrollFilmstripToCurrent, 100);
    }

    $: zoomPercent = Math.round(zoomLevel * 100);
    $: filename = $selectedPhoto?.filename || '';
</script>

<svelte:window on:keydown={handleKeydown} on:pointerup={handlePointerUp} />

<div class="editor-shell">
    <!-- ═══ ZONE 1: Toolbar (48px top) ═══ -->
    <header class="editor-toolbar">
        <div class="toolbar-left">
            <button class="tool-btn" on:click={onClose} title="Back (Esc)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <span class="toolbar-filename" title={filename}>{filename}</span>
            {#if hasChanges}
                <span class="toolbar-modified">●</span>
            {/if}
            {#if isProcessingPreview}
                <div class="processing-dot" title="Processing…"></div>
            {/if}
        </div>

        <div class="toolbar-center">
            <button class="tool-btn" on:click={handleAuto} title="Auto tone & white balance (LightCraft scene analysis)">
                <span>✨</span>
                <span>Auto</span>
            </button>
            <button class="tool-btn" class:active={showOriginal}
                on:mousedown={() => { showOriginal = true; showBefore(); }}
                on:mouseup={() => { showOriginal = false; triggerProcess(true); }}
                title="Hold for before (\\)"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11 2v20a10 10 0 0 1 0-20zm2 0v20a10 10 0 0 0 0-20z"/></svg>
                <span>B/A</span>
            </button>
        </div>

        <div class="toolbar-right">
            <div class="zoom-controls">
                <button class="zoom-btn" on:click={zoomOut} title="Zoom out">−</button>
                <button class="zoom-label" on:click={zoomFit} title="Fit (Ctrl+0)">{zoomPercent}%</button>
                <button class="zoom-btn" on:click={zoomIn} title="Zoom in">+</button>
                <button class="zoom-btn text" on:click={zoom100} title="100%">1:1</button>
            </div>
            <div class="toolbar-sep"></div>
            <button class="tool-btn" on:click={undo} title="Undo (Ctrl+Z)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            </button>
            <button class="tool-btn" on:click={redo} title="Redo (Ctrl+Shift+Z)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.06-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
            </button>
            <button class="tool-btn" class:active={showClippingWarnings} on:click={() => showClippingWarnings = !showClippingWarnings} title="Clipping warnings (J)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            </button>
            <button class="tool-btn" on:click={() => showShortcuts = true} title="Shortcuts (?)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/></svg>
            </button>
            <div class="toolbar-sep"></div>
            <button class="tool-btn accent" on:click={handleSave} disabled={!hasChanges || saving}>
                {saving ? "Saving…" : "Save Copy"}
            </button>
            <button class="tool-btn export" on:click={() => showExport = true} disabled={!hasChanges} title="Export with options">
                Export
            </button>
        </div>
    </header>

    <div class="editor-content">
        <!-- ═══ ZONE 2: Tool Strip (48px left) ═══ -->
        <div class="tool-strip">
            <button class="strip-btn" class:active={activeTool === 'adjust'} on:click={() => { activeTool = 'adjust'; triggerProcess(true); }} title="Adjust">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>
            </button>
            <button class="strip-btn" class:active={activeTool === 'crop'} on:click={() => { activeTool = 'crop'; triggerProcess(true); }} title="Crop & Straighten">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17 15h2V7c0-1.1-.9-2-2-2H9v2h8v8zM7 17V1H5v4H1v2h4v10c0 1.1.9 2 2 2h10v4h2v-4h4v-2H7z"/></svg>
            </button>
            <button class="strip-btn" class:active={activeTool === 'mask'} on:click={() => { activeTool = 'mask'; triggerProcess(true); }} title="Masking (Local Adjustments)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-2.48 1.13-4.7 2.9-6.17L18.17 17.1A7.945 7.945 0 0 1 12 20zm5.1-1.83L5.83 6.9A7.945 7.945 0 0 1 12 4c4.42 0 8 3.58 8 8 0 2.48-1.13 4.7-2.9 6.17z"/></svg>
            </button>
            <div class="strip-spacer"></div>
            <button class="strip-btn" class:active={showPanel} on:click={() => showPanel = !showPanel} title="Toggle panel (P)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
            </button>
        </div>

        <!-- ═══ ZONE 3: Canvas (center) ═══ -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="editor-canvas-zone"
            on:wheel={handleWheel}
            on:mousedown={handleCanvasPointerDown}
            on:mousemove={handleCanvasPointerMove}
            on:mouseup={handleCanvasPointerUp}
            on:mouseleave={handleCanvasPointerUp}
            class:panning={isPanning}
            class:zoomable={zoomLevel > 1}
        >
            {#if !imageLoaded}
                <div class="canvas-loading">
                    <div class="loading-spinner"></div>
                    <span>Loading image…</span>
                </div>
            {/if}

            <div class="canvas-transform" style="transform: scale({zoomLevel}) translate({panX / zoomLevel}px, {panY / zoomLevel}px);">
                <canvas 
                    bind:this={canvasEl} 
                    class="editor-canvas"
                    bind:clientWidth={canvasClientWidth}
                    bind:clientHeight={canvasClientHeight}
                ></canvas>
                <canvas 
                    bind:this={clippingCanvasEl} 
                    class="clipping-canvas" 
                    class:visible={showClippingWarnings}
                ></canvas>

                {#if activeTool === 'crop' && zoomLevel === 1}
                    <div class="overlay-layer">
                        <CropOverlay
                            bind:cropX={adjustments.cropX}
                            bind:cropY={adjustments.cropY}
                            bind:cropWidth={adjustments.cropWidth}
                            bind:cropHeight={adjustments.cropHeight}
                            cropRotation={adjustments.cropRotation}
                            previewWidth={canvasClientWidth}
                            previewHeight={canvasClientHeight}
                            on:change={() => triggerProcess(true)}
                        />
                    </div>
                {/if}

                {#if activeTool === 'mask'}
                    <div class="overlay-layer">
                        <MaskingOverlay
                            masks={adjustments.masks || []}
                            bind:activeMaskId
                            bind:activeNewType
                            previewWidth={canvasClientWidth}
                            previewHeight={canvasClientHeight}
                            on:select={(e) => activeMaskId = e.detail}
                            on:change={() => triggerProcess(true, true)}
                            on:changeEnd={() => triggerProcess(false, false)}
                            on:addMask={(e) => {
                                adjustments.masks = [...(adjustments.masks || []), e.detail];
                                hasChanges = true;
                                triggerProcess(true, true);
                            }}
                        />
                    </div>
                {/if}
            </div>

            <!-- Floating histogram: only while the editing panel (with its own histogram) is hidden -->
            {#if showHistogramOverlay && histogramData && !showPanel}
                <div class="histogram-overlay">
                    <Histogram data={histogramData} />
                </div>
            {/if}

            <!-- Zoom indicator -->
            {#if zoomLevel !== 1}
                <div class="zoom-indicator">{zoomPercent}%</div>
            {/if}

            <!-- Processing indicator -->
            {#if isProcessingPreview}
                <div class="processing-indicator">
                    <div class="processing-bar"></div>
                </div>
            {/if}
        </div>

        <!-- ═══ ZONE 4: Editing Panel (right) ═══ -->
        {#if showPanel}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="resize-handle" class:active={isResizing} on:mousedown={startResize}>
                <div class="resize-grip"></div>
            </div>
            <div class="editing-panel" style="width: {sidebarWidth}px;">
                <EditingSidebar
                    {adjustments}
                    {histogramData}
                    {showOriginal}
                    {activeTool}
                    bind:activeMaskId
                    bind:activeNewType
                    on:change={onAdjustmentChange}
                    on:scrub={onAdjustmentScrub}
                    on:resetAll={onResetAll}
                    on:beforeAfter={onBeforeAfter}
                />
            </div>
        {/if}
    </div>

    <!-- ═══ ZONE 5: Filmstrip (80px bottom) ═══ -->
    <div class="filmstrip">
        <button class="filmstrip-nav" on:click={prevPhoto} disabled={currentPhotoIndex <= 0} title="Previous (←)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
        </button>
        <div class="filmstrip-scroll" bind:this={filmstripEl}>
            {#each filmstripPhotos as photo, i (photo.id)}
                <button
                    class="filmstrip-thumb"
                    class:active={photo.id === $selectedPhoto?.id}
                    on:click={() => navigateToPhoto(photo)}
                    title={photo.filename}
                >
                    {#await (async () => { const c = getCachedThumb(photo.path); return c || convertFileSource(photo.path); })() then url}
                        <img src={url} alt={photo.filename} draggable="false" />
                    {/await}
                </button>
            {/each}
        </div>
        <button class="filmstrip-nav" on:click={nextPhoto} disabled={currentPhotoIndex >= filmstripPhotos.length - 1} title="Next (→)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
        </button>
    </div>

    <!-- Export + shortcuts overlays live inside the shell so they inherit the
         editor's pinned dark palette. -->
    <ExportDialog {imagePath} {adjustments} show={showExport} on:close={() => showExport = false} />

    {#if showShortcuts}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="shortcuts-overlay" on:click={() => showShortcuts = false}>
        <div class="shortcuts-panel" on:click|stopPropagation>
            <div class="shortcuts-header">
                <h3>Keyboard Shortcuts</h3>
                <button class="shortcuts-close" on:click={() => showShortcuts = false}>&times;</button>
            </div>
            <div class="shortcuts-grid">
                <div class="shortcut-group">
                    <h4>Navigation</h4>
                    <div class="shortcut-row"><kbd>←</kbd><span>Previous photo</span></div>
                    <div class="shortcut-row"><kbd>→</kbd><span>Next photo</span></div>
                    <div class="shortcut-row"><kbd>Esc</kbd><span>Close editor</span></div>
                </div>
                <div class="shortcut-group">
                    <h4>Editing</h4>
                    <div class="shortcut-row"><kbd>Ctrl+Z</kbd><span>Undo</span></div>
                    <div class="shortcut-row"><kbd>Ctrl+Shift+Z</kbd><span>Redo</span></div>
                    <div class="shortcut-row"><kbd>\</kbd><span>Toggle before/after</span></div>
                </div>
                <div class="shortcut-group">
                    <h4>View</h4>
                    <div class="shortcut-row"><kbd>Ctrl+=</kbd><span>Zoom in</span></div>
                    <div class="shortcut-row"><kbd>Ctrl+-</kbd><span>Zoom out</span></div>
                    <div class="shortcut-row"><kbd>Ctrl+0</kbd><span>Fit to view</span></div>
                </div>
                <div class="shortcut-group">
                    <h4>Panels</h4>
                    <div class="shortcut-row"><kbd>H</kbd><span>Toggle histogram</span></div>
                    <div class="shortcut-row"><kbd>P</kbd><span>Toggle edit panel</span></div>
                    <div class="shortcut-row"><kbd>J</kbd><span>Clipping warnings</span></div>
                    <div class="shortcut-row"><kbd>?</kbd><span>This dialog</span></div>
                </div>
            </div>
        </div>
    </div>
{/if}
</div>

<style>
    /* ═══ Shell ═══ */
    .editor-shell {
        position: fixed;
        inset: 0;
        z-index: 600;
        display: flex;
        flex-direction: column;
        background: var(--md-sys-color-surface, #1a1a1f);
        animation: editorFadeIn 200ms cubic-bezier(0.2, 0, 0, 1);
    }

    /* The editor is a dark-surface tool (like Lightroom): pin the dark palette
       regardless of the app theme — several editor components (MaskingPanel,
       overlays, canvas-drawn widgets) are drawn for dark surfaces. */
    .editor-shell {
        --md-sys-color-primary: #A8C7FA;
        --md-sys-color-on-primary: #062E6F;
        --md-sys-color-primary-container: #1B4B99;
        --md-sys-color-on-primary-container: #D3E3FD;
        --md-sys-color-error: #FFB4AB;
        --md-sys-color-on-error: #690005;
        --md-sys-color-error-container: #93000A;
        --md-sys-color-surface: #111318;
        --md-sys-color-on-surface: #E2E2E9;
        --md-sys-color-on-surface-variant: #C4C6D0;
        --md-sys-color-surface-dim: #111318;
        --md-sys-color-surface-bright: #37393E;
        --md-sys-color-surface-container-lowest: #0C0E13;
        --md-sys-color-surface-container-low: #191C20;
        --md-sys-color-surface-container: #1D2024;
        --md-sys-color-surface-container-high: #282A2F;
        --md-sys-color-surface-container-highest: #33353A;
        --md-sys-color-outline: #8E9099;
        --md-sys-color-outline-variant: #44474F;
        color-scheme: dark;
    }

    @keyframes editorFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    /* ═══ ZONE 1: Toolbar ═══ */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 48px;
        flex-shrink: 0;
        padding: 0 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        background: var(--md-sys-color-surface-container, #22222a);
        gap: 8px;
    }

    .toolbar-left, .toolbar-center, .toolbar-right {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .toolbar-left { min-width: 0; flex: 1; }
    .toolbar-center { flex-shrink: 0; }
    .toolbar-right { flex: 1; justify-content: flex-end; }

    .toolbar-filename {
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.6);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 200px;
    }

    .toolbar-modified {
        color: var(--md-sys-color-primary, #a0c4ff);
        font-size: 10px;
    }

    .toolbar-sep {
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.08);
        margin: 0 2px;
    }

    .tool-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        border-radius: 10px;
        border: none;
        background: none;
        color: rgba(255, 255, 255, 0.6);
        font-family: 'Outfit', sans-serif;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 120ms ease;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .tool-btn:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.9); }
    .tool-btn:disabled { opacity: 0.3; cursor: default; }
    .tool-btn.active { background: rgba(255, 255, 255, 0.1); color: white; }

    .tool-btn.accent {
        background: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-on-primary, #003258);
        font-weight: 600;
        height: 28px;
        padding: 0 14px;
        border-radius: 9px;
    }
    .tool-btn.accent:hover { filter: brightness(1.1); }
    .tool-btn.accent:disabled { opacity: 0.4; }
    .tool-btn.export {
        background: rgba(255,255,255,0.08);
        color: var(--md-sys-color-primary, #a0c4ff);
        height: 28px;
        padding: 0 14px;
        border-radius: 9px;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid rgba(160,196,255,0.2);
    }
    .tool-btn.export:hover { background: rgba(160,196,255,0.15); }
    .tool-btn.export:disabled { opacity: 0.3; }

    /* Zoom controls */
    .zoom-controls {
        display: flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        overflow: hidden;
    }

    .zoom-btn {
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        background: none; border: none;
        color: rgba(255, 255, 255, 0.5);
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        transition: all 100ms ease;
    }
    .zoom-btn.text { font-size: 10px; width: auto; padding: 0 8px; font-family: 'Outfit', sans-serif; }
    .zoom-btn:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.9); }

    .zoom-label {
        padding: 0 6px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        background: none; border: none;
        color: rgba(255, 255, 255, 0.4);
        font-family: 'Outfit', monospace;
        font-size: 10px; cursor: pointer; min-width: 36px;
    }
    .zoom-label:hover { color: rgba(255, 255, 255, 0.8); }

    /* ═══ Content (tool strip + canvas + panel) ═══ */
    .editor-content {
        flex: 1;
        display: flex;
        min-height: 0;
    }

    /* ═══ ZONE 2: Tool Strip ═══ */
    .tool-strip {
        width: 48px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 0;
        gap: 4px;
        background: var(--md-sys-color-surface-container, #22222a);
        border-right: 1px solid rgba(255, 255, 255, 0.04);
    }

    .strip-btn {
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 10px; border: none;
        background: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        transition: all 120ms ease;
    }
    .strip-btn:hover { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.9); }
    .strip-btn.active { background: var(--md-sys-color-primary-container, rgba(160, 196, 255, 0.15)); color: var(--md-sys-color-on-primary-container, #a0c4ff); }
    .strip-btn:disabled { opacity: 0.25; cursor: default; }
    .strip-spacer { flex: 1; }

    /* ═══ ZONE 3: Canvas ═══ */
    .editor-canvas-zone {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
        background: #0c0c10;
        min-width: 0;
    }

    .editor-canvas-zone.zoomable { cursor: grab; }
    .editor-canvas-zone.panning { cursor: grabbing; }

    .canvas-transform {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        max-height: 100%;
        transform-origin: center center;
        transition: transform 50ms ease-out;
    }

    .editor-canvas {
        max-width: 100%;
        max-height: calc(100vh - 48px - 80px - 24px);
        object-fit: contain;
        border-radius: 3px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
    }

    .clipping-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
        opacity: 0;
        transition: opacity 200ms ease;
    }

    .clipping-canvas.visible {
        opacity: 1;
    }

    .canvas-loading {
        position: absolute;
        inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 12px;
        color: rgba(255, 255, 255, 0.45);
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        z-index: 2;
    }

    .loading-spinner {
        width: 24px; height: 24px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.06);
        border-top-color: var(--md-sys-color-primary, #a0c4ff);
        animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Floating histogram */
    .histogram-overlay {
        position: absolute;
        top: 12px;
        left: 12px;
        background: rgba(0, 0, 0, 0.65);
        border-radius: 8px;
        padding: 6px;
        z-index: 5;
        opacity: 0.85;
        transition: opacity 150ms ease;
        transform: scale(0.8);
        transform-origin: top left;
    }
    .histogram-overlay:hover { opacity: 1; transform: scale(0.9); }

    /* Zoom indicator */
    .zoom-indicator {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.6);
        color: rgba(255, 255, 255, 0.7);
        padding: 4px 12px;
        border-radius: 12px;
        font-family: 'Outfit', monospace;
        font-size: 11px;
        font-weight: 500;
        z-index: 5;
    }

    /* ═══ ZONE 4: Editing Panel ═══ */
    .editing-panel {
        flex-shrink: 0;
        height: 100%;
        min-width: 260px;
        max-width: 480px;
        overflow: hidden;
    }

    /* Resize handle */
    .resize-handle {
        width: 5px;
        flex-shrink: 0;
        cursor: col-resize;
        position: relative;
        background: transparent;
        transition: background 150ms ease;
        z-index: 10;
    }
    .resize-handle:hover, .resize-handle.active { background: rgba(255, 255, 255, 0.04); }

    .resize-grip {
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        width: 3px; height: 28px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
        transition: all 150ms ease;
    }
    .resize-handle:hover .resize-grip, .resize-handle.active .resize-grip {
        background: var(--md-sys-color-primary, #a0c4ff);
        height: 40px;
    }

    /* ═══ ZONE 5: Filmstrip ═══ */
    .filmstrip {
        height: 80px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 0;
        background: var(--md-sys-color-surface-container, #22222a);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        padding: 0 4px;
    }

    .filmstrip-nav {
        width: 28px; height: 64px;
        display: flex; align-items: center; justify-content: center;
        background: none; border: none;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        border-radius: 8px;
        flex-shrink: 0;
        transition: all 120ms ease;
    }
    .filmstrip-nav:hover { background: rgba(255, 255, 255, 0.06); color: white; }
    .filmstrip-nav:disabled { opacity: 0.2; cursor: default; }

    .filmstrip-scroll {
        flex: 1;
        display: flex;
        gap: 4px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 8px 4px;
        scrollbar-width: none;
    }
    .filmstrip-scroll::-webkit-scrollbar { display: none; }

    .filmstrip-thumb {
        width: 60px; height: 60px;
        flex-shrink: 0;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.04);
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 150ms ease;
        padding: 0;
    }
    .filmstrip-thumb:hover { border-color: rgba(255, 255, 255, 0.2); }
    .filmstrip-thumb.active {
        border-color: var(--md-sys-color-primary, #a0c4ff);
        box-shadow: 0 0 0 1px var(--md-sys-color-primary, #a0c4ff);
    }

    .filmstrip-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    /* ═══ UX Polish Elements ═══ */
    .processing-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--md-sys-color-primary, #a0c4ff);
        margin-left: 8px;
        animation: pulse 1s infinite alternate;
    }

    @keyframes pulse {
        0% { opacity: 0.3; transform: scale(0.8); }
        100% { opacity: 1; transform: scale(1.2); }
    }

    .shortcuts-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(8px);
        animation: editorFadeIn 200ms ease;
    }

    .shortcuts-panel {
        background: var(--md-sys-color-surface-container-high, #2b2b36);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 24px;
        width: 100%;
        max-width: 600px;
        padding: 32px;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
    }

    .shortcuts-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
    }

    .shortcuts-header h3 {
        margin: 0;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 20px;
        font-weight: 500;
        color: white;
    }

    .shortcuts-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.6);
        font-size: 24px;
        cursor: pointer;
        transition: color 150ms ease;
    }

    .shortcuts-close:hover {
        color: white;
    }

    .shortcuts-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 32px;
    }

    .shortcut-group h4 {
        margin: 0 0 16px 0;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: var(--md-sys-color-primary, #a0c4ff);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .shortcut-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }

    .shortcut-row span {
        font-family: 'Instrument Sans', sans-serif;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.8);
    }

    kbd {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        padding: 4px 8px;
        font-family: monospace;
        font-size: 12px;
        color: white;
        box-shadow: 0 2px 0 rgba(0,0,0,0.2);
    }
</style>
