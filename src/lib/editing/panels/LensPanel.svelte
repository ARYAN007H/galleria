<script lang="ts">
    import SliderRow from '../SliderRow.svelte';
    import { createEventDispatcher } from 'svelte';
    import type { AdjustmentState } from '../adjustments';

    export let adjustments: AdjustmentState;
    export let expanded: boolean = false;

    const dispatch = createEventDispatcher<{ change: Partial<AdjustmentState>; scrub: Partial<AdjustmentState> }>();

    function update(key: keyof AdjustmentState, e: CustomEvent<number>) {
        dispatch('change', { [key]: e.detail });
    }

    function scrub(key: keyof AdjustmentState, e: CustomEvent<number>) {
        dispatch('scrub', { [key]: e.detail });
    }

    function resetPanel() {
        dispatch('change', {
            lensDistortion: 0, lensVignetting: 0, lensCaRed: 0, lensCaBlue: 0,
            removeCA: false, lensProfileEnabled: false, profileDistortion: 100,
            profileVignetting: 100, defringePurple: 0, defringeGreen: 0,
        });
    }

    function toggleFlag(key: 'removeCA' | 'lensProfileEnabled') {
        dispatch('change', { [key]: !adjustments[key] });
    }

    function toggle() { expanded = !expanded; }
</script>

<script context="module">
    import { slide } from 'svelte/transition';
</script>

<div class="panel-card">
    <button class="panel-header" on:click={toggle}>
        <span class="panel-icon">◎</span>
        <span class="panel-title">Lens Corrections</span>
        <button class="reset-btn" on:click|stopPropagation={resetPanel}>↺</button>
        <span class="expand-icon" class:rotated={expanded}>▾</span>
    </button>
    {#if expanded}
        <div class="panel-body" transition:slide|local={{ duration: 250 }}>
            <label class="check-row">
                <input type="checkbox" checked={adjustments.lensProfileEnabled} on:change={() => toggleFlag('lensProfileEnabled')} />
                <span>Enable Profile Corrections</span>
            </label>
            {#if adjustments.lensProfileEnabled}
                <SliderRow label="Distortion Amount" value={adjustments.profileDistortion} min={0} max={100} step={1} defaultValue={100} on:change={(e) => update('profileDistortion', e)} on:scrub={(e) => scrub('profileDistortion', e)} />
                <SliderRow label="Vignetting Amount" value={adjustments.profileVignetting} min={0} max={100} step={1} defaultValue={100} on:change={(e) => update('profileVignetting', e)} on:scrub={(e) => scrub('profileVignetting', e)} />
            {/if}

            <div class="group-label" style="margin-top: 8px;">Manual</div>
            <SliderRow label="Distortion" value={adjustments.lensDistortion} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('lensDistortion', e)} on:scrub={(e) => scrub('lensDistortion', e)} />
            <SliderRow label="Vignetting" value={adjustments.lensVignetting} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('lensVignetting', e)} on:scrub={(e) => scrub('lensVignetting', e)} />

            <div class="group-label" style="margin-top: 8px;">Chromatic Aberration</div>
            <label class="check-row">
                <input type="checkbox" checked={adjustments.removeCA} on:change={() => toggleFlag('removeCA')} />
                <span>Remove Chromatic Aberration</span>
            </label>
            <SliderRow label="Red/Cyan" value={adjustments.lensCaRed} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('lensCaRed', e)} on:scrub={(e) => scrub('lensCaRed', e)} />
            <SliderRow label="Blue/Yellow" value={adjustments.lensCaBlue} min={-100} max={100} step={1} defaultValue={0} on:change={(e) => update('lensCaBlue', e)} on:scrub={(e) => scrub('lensCaBlue', e)} />

            <div class="group-label" style="margin-top: 8px;">Defringe</div>
            <SliderRow label="Purple Amount" value={adjustments.defringePurple} min={0} max={100} step={1} defaultValue={0} on:change={(e) => update('defringePurple', e)} on:scrub={(e) => scrub('defringePurple', e)} />
            <SliderRow label="Green Amount" value={adjustments.defringeGreen} min={0} max={100} step={1} defaultValue={0} on:change={(e) => update('defringeGreen', e)} on:scrub={(e) => scrub('defringeGreen', e)} />
        </div>
    {/if}
</div>

<style>
    .panel-card { background: var(--md-sys-color-surface-container, #22222a); border-radius: 16px; overflow: hidden; margin-bottom: 8px; }
    .panel-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 14px; background: none; border: none; color: var(--md-sys-color-on-surface, rgba(255,255,255,0.85)); cursor: pointer; transition: background 150ms; }
    .panel-header:hover { background: rgba(255,255,255,0.04); }
    .panel-icon { font-size: 16px; width: 20px; text-align: center; }
    .panel-title { flex: 1; text-align: left; font-family: 'Instrument Sans', sans-serif; font-size: 14px; font-weight: 600; }
    .reset-btn { width: 24px; height: 24px; border-radius: 8px; background: transparent; border: none; color: rgba(255,255,255,0.4); font-size: 14px; cursor: pointer; opacity: 0; transition: opacity 150ms; }
    .panel-header:hover .reset-btn { opacity: 1; }
    .expand-icon { font-size: 12px; color: rgba(255,255,255,0.4); transition: transform 250ms cubic-bezier(0.2, 0, 0, 1); }
    .expand-icon.rotated { transform: rotate(0deg); }
    .expand-icon:not(.rotated) { transform: rotate(-90deg); }
    .panel-body { padding: 0 14px 14px; }
    .group-label { font-family: 'Instrument Sans', sans-serif; font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; padding-top: 4px; }
    .check-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-family: 'Instrument Sans', sans-serif; font-size: 13px; color: var(--md-sys-color-on-surface, rgba(255,255,255,0.85)); cursor: pointer; }
    .check-row input { accent-color: var(--md-sys-color-primary, #a0c4ff); width: 15px; height: 15px; cursor: pointer; }
</style>
