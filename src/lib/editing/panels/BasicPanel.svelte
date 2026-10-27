<script lang="ts">
    import SliderRow from '../SliderRow.svelte';
    import { createEventDispatcher } from 'svelte';
    import type { AdjustmentState } from '../adjustments';

    export let adjustments: AdjustmentState;
    export let expanded: boolean = true;

    const dispatch = createEventDispatcher<{ change: Partial<AdjustmentState>; scrub: Partial<AdjustmentState> }>();

    function update(key: keyof AdjustmentState, e: CustomEvent<number>) {
        dispatch('change', { [key]: e.detail });
    }

    function scrub(key: keyof AdjustmentState, e: CustomEvent<number>) {
        dispatch('scrub', { [key]: e.detail });
    }

    // LightCraft WbMode presets (WbMode::preset): Kelvin + tint per lighting condition.
    const WB_PRESETS: Array<{ id: AdjustmentState['wbMode']; label: string; temp?: number; tint?: number }> = [
        { id: 'asShot', label: 'As Shot' },
        { id: 'daylight', label: 'Daylight', temp: 5500, tint: 10 },
        { id: 'cloudy', label: 'Cloudy', temp: 6500, tint: 10 },
        { id: 'shade', label: 'Shade', temp: 7500, tint: 10 },
        { id: 'tungsten', label: 'Tungsten', temp: 2850, tint: 0 },
        { id: 'fluorescent', label: 'Fluorescent', temp: 3800, tint: 21 },
        { id: 'flash', label: 'Flash', temp: 5500, tint: 0 },
    ];

    function applyWbPreset(preset: typeof WB_PRESETS[number]) {
        if (preset.id === 'asShot') {
            dispatch('change', { wbMode: 'asShot', temperature: 6500, tint: 0 });
        } else {
            dispatch('change', {
                wbMode: 'custom',
                temperature: preset.temp ?? 6500,
                tint: preset.tint ?? 0,
            });
        }
    }

    // Manual WB slider edits switch to a custom white.
    function updateWb(key: 'temperature' | 'tint', e: CustomEvent<number>) {
        dispatch('change', { [key]: e.detail, wbMode: 'custom' });
    }

    function scrubWb(key: 'temperature' | 'tint', e: CustomEvent<number>) {
        dispatch('scrub', { [key]: e.detail, wbMode: 'custom' });
    }

    function resetPanel() {
        dispatch('change', {
            wbMode: 'asShot', temperature: 6500, tint: 0, exposure: 0, contrast: 0,
            highlights: 0, shadows: 0, whites: 0, blacks: 0,
            texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0,
        });
    }

    function toggle() { expanded = !expanded; }
</script>

<div class="panel-card">
    <button class="panel-header" on:click={toggle}>
        <span class="panel-icon">☀</span>
        <span class="panel-title">Basic</span>
        <button class="reset-btn" on:click|stopPropagation={resetPanel} title="Reset Basic">↺</button>
        <span class="expand-icon" class:rotated={expanded}>▾</span>
    </button>
    {#if expanded}
        <div class="panel-body" transition:slide|local={{ duration: 250 }}>
            <div class="treatment-row">
                <button class="treatment-btn" class:active={(adjustments.treatment ?? 'color') === 'color'}
                    on:click={() => dispatch('change', { treatment: 'color' })}>Color</button>
                <button class="treatment-btn" class:active={adjustments.treatment === 'bw'}
                    on:click={() => dispatch('change', { treatment: 'bw' })}>B&amp;W</button>
            </div>
            <div class="slider-group">
                <div class="group-label">White Balance</div>
                <div class="wb-presets">
                    {#each WB_PRESETS as preset}
                        <button
                            class="wb-chip"
                            class:active={(adjustments.wbMode ?? 'asShot') === preset.id
                                || (preset.id === 'asShot' && (adjustments.wbMode ?? 'asShot') === 'asShot')}
                            on:click={() => applyWbPreset(preset)}
                        >{preset.label}</button>
                    {/each}
                </div>
                <SliderRow label="Temperature" icon="🌡" value={adjustments.temperature} min={2000} max={50000} step={100} defaultValue={6500} on:change={(e) => updateWb('temperature', e)} on:scrub={(e) => scrubWb('temperature', e)} />
                <SliderRow label="Tint" icon="◆" value={adjustments.tint} min={-150} max={150} step={1} defaultValue={0} on:change={(e) => updateWb('tint', e)} on:scrub={(e) => scrubWb('tint', e)} />
            </div>
            <div class="slider-group">
                <div class="group-label">Tone</div>
                <SliderRow label="Exposure" icon="☀" value={adjustments.exposure} min={-5} max={5} step={0.01} defaultValue={0} on:change={(e) => update('exposure', e)} on:scrub={(e) => scrub('exposure', e)} />
                <SliderRow label="Contrast" icon="◐" value={adjustments.contrast} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('contrast', e)} on:scrub={(e) => scrub('contrast', e)} />
                <SliderRow label="Highlights" icon="◐" value={adjustments.highlights} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('highlights', e)} on:scrub={(e) => scrub('highlights', e)} />
                <SliderRow label="Shadows" icon="◑" value={adjustments.shadows} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('shadows', e)} on:scrub={(e) => scrub('shadows', e)} />
                <SliderRow label="Whites" icon="○" value={adjustments.whites} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('whites', e)} on:scrub={(e) => scrub('whites', e)} />
                <SliderRow label="Blacks" icon="●" value={adjustments.blacks} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('blacks', e)} on:scrub={(e) => scrub('blacks', e)} />
            </div>
            <div class="slider-group">
                <div class="group-label">Presence</div>
                <SliderRow label="Texture" icon="▧" value={adjustments.texture} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('texture', e)} on:scrub={(e) => scrub('texture', e)} />
                <SliderRow label="Clarity" icon="◈" value={adjustments.clarity} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('clarity', e)} on:scrub={(e) => scrub('clarity', e)} />
                <SliderRow label="Dehaze" icon="▽" value={adjustments.dehaze} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('dehaze', e)} on:scrub={(e) => scrub('dehaze', e)} />
                <SliderRow label="Vibrance" icon="◇" value={adjustments.vibrance} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('vibrance', e)} on:scrub={(e) => scrub('vibrance', e)} />
                <SliderRow label="Saturation" icon="◈" value={adjustments.saturation} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('saturation', e)} on:scrub={(e) => scrub('saturation', e)} />
            </div>
        </div>
    {/if}
</div>

<script context="module">
    import { slide } from 'svelte/transition';
</script>

<style>
    .panel-card {
        background: var(--md-sys-color-surface-container, #22222a);
        border-radius: 16px;
        overflow: hidden;
        margin-bottom: 8px;
    }

    .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 12px 14px;
        background: none;
        border: none;
        color: var(--md-sys-color-on-surface, rgba(255,255,255,0.85));
        cursor: pointer;
        transition: background 150ms ease;
    }

    .panel-header:hover {
        background: rgba(255,255,255,0.04);
    }

    .panel-icon {
        font-size: 16px;
        width: 20px;
        text-align: center;
    }

    .panel-title {
        flex: 1;
        text-align: left;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
    }

    .reset-btn {
        width: 24px;
        height: 24px;
        border-radius: 8px;
        background: transparent;
        border: none;
        color: var(--md-sys-color-on-surface-variant, rgba(255,255,255,0.4));
        font-size: 14px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 150ms ease;
    }

    .panel-header:hover .reset-btn {
        opacity: 1;
    }

    .reset-btn:hover {
        background: rgba(255,255,255,0.08);
        color: var(--md-sys-color-on-surface, rgba(255,255,255,0.8));
    }

    .expand-icon {
        font-size: 12px;
        color: rgba(255,255,255,0.4);
        transition: transform 250ms cubic-bezier(0.2, 0, 0, 1);
    }

    .expand-icon.rotated {
        transform: rotate(0deg);
    }

    .expand-icon:not(.rotated) {
        transform: rotate(-90deg);
    }

    .panel-body {
        padding: 0 14px 14px;
    }

    .slider-group {
        margin-bottom: 8px;
    }

    .treatment-row {
        display: flex;
        gap: 4px;
        margin-bottom: 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 10px;
        padding: 3px;
    }

    .treatment-btn {
        flex: 1;
        padding: 6px 0;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.5);
        font-family: 'Instrument Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .treatment-btn.active {
        background: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-on-primary, #003258);
    }

    .wb-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
    }

    .wb-chip {
        padding: 4px 10px;
        border-radius: 14px;
        background: var(--md-sys-color-surface-container-high, rgba(255,255,255,0.07));
        border: 1px solid rgba(255,255,255,0.08);
        color: var(--md-sys-color-on-surface-variant, rgba(255,255,255,0.6));
        font-family: 'Instrument Sans', sans-serif;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 140ms ease;
        white-space: nowrap;
    }

    .wb-chip:hover { background: rgba(255,255,255,0.12); color: var(--md-sys-color-on-surface, rgba(255,255,255,0.9)); }

    .wb-chip.active {
        background: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-on-primary, #003258);
        border-color: transparent;
    }

    .group-label {
        font-family: 'Instrument Sans', sans-serif;
        font-size: 10px;
        font-weight: 600;
        color: var(--md-sys-color-on-surface-variant, rgba(255,255,255,0.4));
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 4px;
        padding-top: 4px;
    }
</style>
