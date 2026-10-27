<script lang="ts">
    import { createEventDispatcher } from 'svelte';

    export let cropX: number;
    export let cropY: number;
    export let cropWidth: number;
    export let cropHeight: number;
    // Rotation is applied by the engine; kept as a read-only reference for consumers.
    export const cropRotation: number = 0;
    export let previewWidth: number = 0;
    export let previewHeight: number = 0;

    const dispatch = createEventDispatcher();

    let isInteraction = false;
    let dragAction: string | null = null;
    let startPanX = 0, startPanY = 0;
    
    // Explicit copies needed to compute deltas
    let origCropX = 0, origCropY = 0, origCropW = 0, origCropH = 0;
    
    function startDrag(action: string, e: MouseEvent | PointerEvent) {
        e.preventDefault();
        e.stopPropagation();
        isInteraction = true;
        dragAction = action;
        startPanX = e.clientX;
        startPanY = e.clientY;
        origCropX = cropX;
        origCropY = cropY;
        origCropW = cropWidth;
        origCropH = cropHeight;

        window.addEventListener('pointermove', onDrag);
        window.addEventListener('pointerup', endDrag);
    }

    function onDrag(e: PointerEvent) {
        if (!isInteraction || !dragAction) return;

        // Compute delta in normalized coordinates
        const dx = (e.clientX - startPanX) / previewWidth;
        const dy = (e.clientY - startPanY) / previewHeight;

        let nx = origCropX;
        let ny = origCropY;
        let nw = origCropW;
        let nh = origCropH;

        if (dragAction === 'pan') {
            nx = Math.max(0, Math.min(1 - nw, origCropX + dx));
            ny = Math.max(0, Math.min(1 - nh, origCropY + dy));
        } else {
            if (dragAction.includes('top')) {
                ny = origCropY + dy;
                nh = origCropH - dy;
                if (nh < 0.1) { nh = 0.1; ny = origCropY + origCropH - 0.1; }
                if (ny < 0) {
                    ny = 0; 
                    nh = origCropY + origCropH; 
                }
            }
            if (dragAction.includes('bottom')) {
                nh = origCropH + dy;
                if (nh < 0.1) nh = 0.1;
                if (origCropY + nh > 1) nh = 1 - origCropY;
            }
            if (dragAction.includes('left')) {
                nx = origCropX + dx;
                nw = origCropW - dx;
                if (nw < 0.1) { nw = 0.1; nx = origCropX + origCropW - 0.1; }
                if (nx < 0) { 
                    nx = 0; 
                    nw = origCropX + origCropW; 
                }
            }
            if (dragAction.includes('right')) {
                nw = origCropW + dx;
                if (nw < 0.1) nw = 0.1;
                if (origCropX + nw > 1) nw = 1 - origCropX;
            }
        }

        cropX = nx;
        cropY = ny;
        cropWidth = nw;
        cropHeight = nh;
    }

    function endDrag() {
        if (!isInteraction) return;
        isInteraction = false;
        dragAction = null;
        window.removeEventListener('pointermove', onDrag);
        window.removeEventListener('pointerup', endDrag);
        dispatch('change');
    }

    $: boxLeft = cropX * 100;
    $: boxTop = cropY * 100;
    $: boxWidth = cropWidth * 100;
    $: boxHeight = cropHeight * 100;
</script>

<div class="crop-overlay-container">
    <!-- Shading -->
    <div class="shade top" style="height: {boxTop}%;"></div>
    <div class="shade bottom" style="height: {100 - boxTop - boxHeight}%;"></div>
    <div class="shade left" style="top: {boxTop}%; bottom: {100 - boxTop - boxHeight}%; width: {boxLeft}%;"></div>
    <div class="shade right" style="top: {boxTop}%; bottom: {100 - boxTop - boxHeight}%; width: {100 - boxLeft - boxWidth}%;"></div>

    <!-- The Box -->
    <div class="crop-box" style="left: {boxLeft}%; top: {boxTop}%; width: {boxWidth}%; height: {boxHeight}%;">
        <!-- Pan Area -->
        <div class="pan-area" role="none" on:pointerdown={(e) => startDrag('pan', e)}>
            <!-- Rule of Thirds Grid -->
            <div class="grid-line h1"></div>
            <div class="grid-line h2"></div>
            <div class="grid-line v1"></div>
            <div class="grid-line v2"></div>
        </div>

        <!-- Handles -->
        <div role="none" class="handle top-left" on:pointerdown={(e) => startDrag('top-left', e)}></div>
        <div role="none" class="handle top-right" on:pointerdown={(e) => startDrag('top-right', e)}></div>
        <div role="none" class="handle bottom-left" on:pointerdown={(e) => startDrag('bottom-left', e)}></div>
        <div role="none" class="handle bottom-right" on:pointerdown={(e) => startDrag('bottom-right', e)}></div>
        
        <div role="none" class="handle edge-top" on:pointerdown={(e) => startDrag('top', e)}></div>
        <div role="none" class="handle edge-bottom" on:pointerdown={(e) => startDrag('bottom', e)}></div>
        <div role="none" class="handle edge-left" on:pointerdown={(e) => startDrag('left', e)}></div>
        <div role="none" class="handle edge-right" on:pointerdown={(e) => startDrag('right', e)}></div>
    </div>
</div>

<style>
    .crop-overlay-container {
        position: absolute;
        inset: 0;
        pointer-events: none; /* Let events through where not interacting */
        z-index: 50;
    }

    .shade {
        position: absolute;
        background: rgba(0, 0, 0, 0.7);
        pointer-events: auto; /* Catch clicks */
    }
    
    .shade.top { top: 0; left: 0; right: 0; }
    .shade.bottom { bottom: 0; left: 0; right: 0; }
    .shade.left { left: 0; }
    .shade.right { right: 0; }

    .crop-box {
        position: absolute;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.9), 0 0 0 2px rgba(0,0,0,0.5);
        pointer-events: none;
    }

    .pan-area {
        position: absolute;
        inset: 0;
        cursor: move;
        pointer-events: auto;
    }

    .grid-line {
        position: absolute;
        background: rgba(255,255,255,0.4);
        pointer-events: none;
    }
    .grid-line.h1 { top: 33.33%; left: 0; right: 0; height: 1px; }
    .grid-line.h2 { top: 66.66%; left: 0; right: 0; height: 1px; }
    .grid-line.v1 { left: 33.33%; top: 0; bottom: 0; width: 1px; }
    .grid-line.v2 { left: 66.66%; top: 0; bottom: 0; width: 1px; }

    .handle {
        position: absolute;
        background: white;
        pointer-events: auto;
    }

    .top-left { top: -6px; left: -6px; width: 12px; height: 12px; cursor: nwse-resize; }
    .top-right { top: -6px; right: -6px; width: 12px; height: 12px; cursor: nesw-resize; }
    .bottom-left { bottom: -6px; left: -6px; width: 12px; height: 12px; cursor: nesw-resize; }
    .bottom-right { bottom: -6px; right: -6px; width: 12px; height: 12px; cursor: nwse-resize; }

    .edge-top { top: -4px; left: 50%; transform: translateX(-50%); width: 20px; height: 8px; cursor: ns-resize; }
    .edge-bottom { bottom: -4px; left: 50%; transform: translateX(-50%); width: 20px; height: 8px; cursor: ns-resize; }
    .edge-left { left: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 20px; cursor: ew-resize; }
    .edge-right { right: -4px; top: 50%; transform: translateY(-50%); width: 8px; height: 20px; cursor: ew-resize; }
</style>
