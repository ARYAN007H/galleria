<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import Histogram from './Histogram.svelte';
    import BasicPanel from './panels/BasicPanel.svelte';
    import ToneCurvePanel from './panels/ToneCurvePanel.svelte';
    import HSLPanel from './panels/HSLPanel.svelte';
    import ColorGradingPanel from './panels/ColorGradingPanel.svelte';
    import DetailPanel from './panels/DetailPanel.svelte';
    import LensPanel from './panels/LensPanel.svelte';
    import EffectsPanel from './panels/EffectsPanel.svelte';
    import CalibrationPanel from './panels/CalibrationPanel.svelte';
    import HistoryPanel from './panels/HistoryPanel.svelte';
    import SnapshotPanel from './panels/SnapshotPanel.svelte';
    import MaskingPanel from './panels/MaskingPanel.svelte';
    import {
        type AdjustmentState,
        type FilterPreset,
        defaultAdjustments,
        filterPresets,
        cloneAdjustments,
    } from './adjustments';
    import type { HistogramData } from './imageProcessor';

    export let adjustments: AdjustmentState;
    export let histogramData: HistogramData | null = null;
    export let showOriginal: boolean = false;
    export let activeTool: string = 'adjust';

    // Mask Tool Bindings
    export let activeMaskId: string | null = null;
    export let activeNewType: string | null = null;

    const dispatch = createEventDispatcher<{
        change: Partial<AdjustmentState>;
        scrub: Partial<AdjustmentState>;
        resetAll: void;
        beforeAfter: boolean;
        copySettings: void;
        pasteSettings: void;
        maskSelect: any;
        activeNewType: any;
    }>();

    // ── Section rail: one panel visible at a time (no accordion scroll) ──
    const sections = [
        { id: 'light', label: 'Light', icon: '☀' },
        { id: 'curve', label: 'Curves', icon: '⟋' },
        { id: 'color', label: 'Color', icon: '🎨' },
        { id: 'grading', label: 'Grading', icon: '🎭' },
        { id: 'detail', label: 'Detail', icon: '△' },
        { id: 'lens', label: 'Lens', icon: '◎' },
        { id: 'effects', label: 'Effects', icon: '✦' },
        { id: 'calib', label: 'Calib', icon: '⚙' },
        { id: 'history', label: 'History', icon: '🕐' },
        { id: 'snaps', label: 'Snaps', icon: '📷' },
    ] as const;
    type SectionId = typeof sections[number]['id'];
    let activeSection: SectionId = 'light';

    function onPanelChange(e: CustomEvent<Partial<AdjustmentState>>) {
        dispatch('change', e.detail);
    }

    function onPanelScrub(e: CustomEvent<Partial<AdjustmentState>>) {
        dispatch('scrub', e.detail);
    }

    function onHistoryRestore(e: CustomEvent<AdjustmentState>) {
        // Full state from history — emit as change
        if (e.detail && Object.keys(e.detail).length > 0) {
            dispatch('change', e.detail);
        } else {
            dispatch('resetAll');
        }
    }

    function onSnapshotRestore(e: CustomEvent<AdjustmentState>) {
        dispatch('change', e.detail);
    }

    function applyPreset(preset: FilterPreset) {
        const base = cloneAdjustments(defaultAdjustments);
        const merged = { ...base, ...preset.adjustments };
        // Emit the full state for presets to ensure all values are reset
        const partial: Partial<AdjustmentState> = {};
        for (const key of Object.keys(preset.adjustments) as (keyof AdjustmentState)[]) {
            (partial as any)[key] = (preset.adjustments as any)[key];
        }
        dispatch('change', partial);
    }

    function resetAll() {
        dispatch('resetAll');
    }

    function toggleBeforeAfter() {
        showOriginal = !showOriginal;
        dispatch('beforeAfter', showOriginal);
    }

    let copiedSettings: AdjustmentState | null = null;

    function copySettings() {
        copiedSettings = cloneAdjustments(adjustments);
        dispatch('copySettings');
    }

    function pasteSettings() {
        if (copiedSettings) {
            dispatch('change', copiedSettings);
        }
        dispatch('pasteSettings');
    }
</script>

<aside class="editing-sidebar">
    <!-- Presets Strip -->
    <div class="presets-strip">
        <div class="presets-scroll">
            {#each filterPresets as preset}
                <button class="preset-chip" on:click={() => applyPreset(preset)}>
                    <span class="preset-name">{preset.name}</span>
                </button>
            {/each}
        </div>
    </div>

    <!-- Histogram (always visible) -->
    <Histogram data={histogramData} />

    <!-- Section rail + single active panel -->
    <div class="panels-area">
        {#if activeTool === 'mask'}
            <div class="panels-scroll">
                <MaskingPanel
                    {adjustments}
                    bind:activeMaskId
                    bind:activeNewType
                    on:select={(e) => dispatch('maskSelect', e.detail)}
                    on:activeNewType={(e) => dispatch('activeNewType', e.detail)}
                    on:change={onPanelChange}
                />
            </div>
        {:else}
            <div class="panel-rail" role="tablist" aria-label="Edit sections">
                {#each sections as s}
                    <button
                        class="rail-btn"
                        class:active={activeSection === s.id}
                        title={s.label}
                        aria-label={s.label}
                        on:click={() => activeSection = s.id}
                    >
                        <span class="rail-icon">{s.icon}</span>
                        <span class="rail-label">{s.label}</span>
                    </button>
                {/each}
            </div>

            <div class="panels-scroll">
                {#if activeSection === 'light'}
                    <BasicPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'curve'}
                    <ToneCurvePanel {adjustments} {histogramData} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'color'}
                    <HSLPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'grading'}
                    <ColorGradingPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'detail'}
                    <DetailPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'lens'}
                    <LensPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'effects'}
                    <EffectsPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'calib'}
                    <CalibrationPanel {adjustments} expanded={true} on:change={onPanelChange} on:scrub={onPanelScrub} />
                {:else if activeSection === 'history'}
                    <HistoryPanel on:restore={onHistoryRestore} />
                {:else if activeSection === 'snaps'}
                    <SnapshotPanel {adjustments} on:restore={onSnapshotRestore} />
                {/if}
            </div>
        {/if}
    </div>

    <!-- Bottom Actions -->
    <div class="sidebar-actions">
        <div class="action-row">
            <button class="action-btn" on:click={toggleBeforeAfter} class:active={showOriginal} title="Before / After">
                <span>👁</span>
                <span>{showOriginal ? 'After' : 'Before'}</span>
            </button>
            <button class="action-btn" on:click={copySettings} title="Copy Settings">
                <span>📋</span>
                <span>Copy</span>
            </button>
            <button class="action-btn" on:click={pasteSettings} disabled={!copiedSettings} title="Paste Settings">
                <span>📌</span>
                <span>Paste</span>
            </button>
        </div>
        <button class="reset-all-btn" on:click={resetAll}>
            Reset All
        </button>
    </div>
</aside>

<style>
    .editing-sidebar {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--md-sys-color-surface, #1a1a1f);
        border-left: 1px solid rgba(255, 255, 255, 0.06);
        flex-shrink: 0;
    }

    /* Presets Strip */
    .presets-strip {
        flex-shrink: 0;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .presets-scroll {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        scrollbar-width: none;
    }

    .presets-scroll::-webkit-scrollbar { display: none; }

    .preset-chip {
        flex-shrink: 0;
        padding: 6px 14px;
        border-radius: 20px;
        background: var(--md-sys-color-surface-container-high, rgba(255,255,255,0.08));
        border: 1px solid rgba(255, 255, 255, 0.06);
        color: var(--md-sys-color-on-surface-variant, rgba(255,255,255,0.6));
        font-family: 'Instrument Sans', sans-serif;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 200ms cubic-bezier(0.2, 0, 0, 1);
        white-space: nowrap;
    }

    .preset-chip:hover {
        background: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-on-primary, #003258);
        border-color: transparent;
        transform: scale(1.04);
    }

    /* Section rail + panel */
    .panels-area {
        flex: 1;
        display: flex;
        min-height: 0;
    }

    .panel-rail {
        width: 44px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        padding: 6px 3px;
        overflow-y: auto;
        border-right: 1px solid rgba(255, 255, 255, 0.05);
        scrollbar-width: none;
    }
    .panel-rail::-webkit-scrollbar { display: none; }

    .rail-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 30px;
        border-radius: 9px;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.45);
        cursor: pointer;
        transition: all 130ms ease;
        flex-shrink: 0;
    }

    .rail-btn:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.85); }

    .rail-btn.active {
        background: var(--md-sys-color-primary-container, rgba(160, 196, 255, 0.16));
        color: var(--md-sys-color-on-primary-container, #a0c4ff);
    }

    .rail-icon { font-size: 15px; line-height: 1; }
    .rail-label {
        display: none;
    }

    /* Panels scroll */
    .panels-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 8px 8px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    .panels-scroll::-webkit-scrollbar {
        width: 4px;
    }

    .panels-scroll::-webkit-scrollbar-track {
        background: transparent;
    }

    .panels-scroll::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
    }

    /* Bottom Actions */
    .sidebar-actions {
        flex-shrink: 0;
        padding: 10px 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .action-row {
        display: flex;
        gap: 4px;
    }

    .action-btn {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 6px 8px;
        border-radius: 12px;
        background: var(--md-sys-color-surface-container, rgba(255,255,255,0.06));
        border: none;
        color: var(--md-sys-color-on-surface-variant, rgba(255,255,255,0.6));
        font-family: 'Instrument Sans', sans-serif;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
    }

    .action-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
    }

    .action-btn.active {
        background: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-on-primary, #003258);
    }

    .action-btn:disabled {
        opacity: 0.3;
        cursor: default;
    }

    .action-btn span:first-child {
        font-size: 13px;
    }

    .reset-all-btn {
        width: 100%;
        padding: 8px;
        border-radius: 12px;
        background: rgba(220, 38, 38, 0.12);
        border: none;
        color: #f87171;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 200ms cubic-bezier(0.2, 0, 0, 1);
    }

    .reset-all-btn:hover {
        background: rgba(220, 38, 38, 0.2);
        color: #fca5a5;
        transform: scale(1.02);
    }
</style>
