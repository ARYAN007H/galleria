<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { invokeCommand } from '../store';
    import { toRustPayload, type AdjustmentState } from './adjustments';

    export let imagePath: string;
    export let adjustments: AdjustmentState;
    export let show: boolean = false;

    const dispatch = createEventDispatcher<{ close: void }>();

    let format: 'jpeg' | 'png' | 'webp' | 'tiff' = 'jpeg';
    let quality = 92;
    let maxLongEdge = 0; // 0 = original size
    let customSize = false;
    let customSizeValue = 2048;
    let exporting = false;
    let exportSuccess = false;
    let exportError = '';

    $: actualMaxEdge = customSize ? customSizeValue : 0;

    const sizePresets = [
        { label: 'Original', value: 0 },
        { label: '4K (3840px)', value: 3840 },
        { label: '2K (2048px)', value: 2048 },
        { label: 'HD (1920px)', value: 1920 },
        { label: '1080px', value: 1080 },
        { label: '800px (Web)', value: 800 },
    ];

    function getExtension(): string {
        return format === 'jpeg' ? 'jpg' : format;
    }

    function getOutputPath(): string {
        const ext = getExtension();
        const lastDot = imagePath.lastIndexOf('.');
        const base = lastDot > 0 ? imagePath.substring(0, lastDot) : imagePath;
        return `${base}_export.${ext}`;
    }

    async function handleExport() {
        exporting = true;
        exportSuccess = false;
        exportError = '';

        try {
            // DevelopSettings payload; option keys are camelCase (Rust serde rename_all)
            const payload = toRustPayload(adjustments);
            const outputPath = getOutputPath();

            await invokeCommand('export_image', {
                imagePath,
                settings: payload,
                options: {
                    format,
                    quality,
                    maxLongEdge: actualMaxEdge,
                },
                outputPath,
            });

            exportSuccess = true;
            setTimeout(() => { dispatch('close'); }, 1500);
        } catch (err) {
            exportError = String(err);
        } finally {
            exporting = false;
        }
    }

    function handleClose() {
        if (!exporting) dispatch('close');
    }

    function handleBackdrop(e: MouseEvent) {
        if (e.target === e.currentTarget) handleClose();
    }
</script>

{#if show}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="export-backdrop" on:click={handleBackdrop} role="dialog">
        <div class="export-dialog">
            <div class="dialog-header">
                <h3>Export Photo</h3>
                <button class="close-btn" on:click={handleClose} disabled={exporting}>✕</button>
            </div>

            <div class="dialog-body">
                <!-- Format -->
                <div class="field">
                    <label class="field-label">Format</label>
                    <div class="format-options">
                        <button class="format-btn" class:active={format === 'jpeg'} on:click={() => format = 'jpeg'}>
                            <span class="format-icon">📸</span>
                            <span>JPEG</span>
                        </button>
                        <button class="format-btn" class:active={format === 'png'} on:click={() => format = 'png'}>
                            <span class="format-icon">🖼️</span>
                            <span>PNG</span>
                        </button>
                        <button class="format-btn" class:active={format === 'webp'} on:click={() => format = 'webp'}>
                            <span class="format-icon">🌐</span>
                            <span>WebP</span>
                        </button>
                        <button class="format-btn" class:active={format === 'tiff'} on:click={() => format = 'tiff'}>
                            <span class="format-icon">🗃️</span>
                            <span>TIFF</span>
                        </button>
                    </div>
                </div>

                <!-- Quality (JPEG/WebP only) -->
                {#if format === 'jpeg' || format === 'webp'}
                    <div class="field">
                        <label class="field-label">Quality <span class="field-value">{quality}%</span></label>
                        <input type="range" class="quality-slider" min="1" max="100" bind:value={quality} />
                        <div class="quality-labels">
                            <span>Smaller</span>
                            <span>Better</span>
                        </div>
                    </div>
                {/if}

                <!-- Size -->
                <div class="field">
                    <label class="field-label">Size</label>
                    <div class="size-grid">
                        {#each sizePresets as preset}
                            <button
                                class="size-btn"
                                class:active={!customSize && actualMaxEdge === preset.value}
                                on:click={() => { customSize = false; maxLongEdge = preset.value; }}
                            >
                                {preset.label}
                            </button>
                        {/each}
                        <button
                            class="size-btn"
                            class:active={customSize}
                            on:click={() => { customSize = true; }}
                        >
                            Custom
                        </button>
                    </div>
                    {#if customSize}
                        <div class="custom-size-row">
                            <input
                                type="number"
                                class="custom-input"
                                bind:value={customSizeValue}
                                min="100"
                                max="16000"
                            />
                            <span class="unit">px (long edge)</span>
                        </div>
                    {/if}
                </div>

                <!-- Output path preview -->
                <div class="field">
                    <label class="field-label">Output</label>
                    <div class="output-path">{getOutputPath()}</div>
                </div>

                <!-- Status -->
                {#if exportSuccess}
                    <div class="status success">✓ Exported successfully!</div>
                {/if}
                {#if exportError}
                    <div class="status error">✕ {exportError}</div>
                {/if}
            </div>

            <div class="dialog-footer">
                <button class="cancel-btn" on:click={handleClose} disabled={exporting}>Cancel</button>
                <button class="export-btn" on:click={handleExport} disabled={exporting}>
                    {#if exporting}
                        <span class="spinner"></span> Exporting...
                    {:else}
                        Export
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .export-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 200ms ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .export-dialog {
        background: var(--md-sys-color-surface, #1a1a1f);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        width: 420px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5);
        animation: slideUp 250ms cubic-bezier(0.2, 0, 0, 1);
    }
    @keyframes slideUp { from { transform: translateY(16px); opacity: 0.5; } to { transform: translateY(0); opacity: 1; } }

    .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px 12px;
    }
    .dialog-header h3 {
        font-family: 'Instrument Sans', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: var(--md-sys-color-on-surface, rgba(255,255,255,0.9));
        margin: 0;
    }
    .close-btn {
        width: 32px; height: 32px;
        border-radius: 10px;
        background: rgba(255,255,255,0.06);
        border: none;
        color: rgba(255,255,255,0.5);
        font-size: 14px;
        cursor: pointer;
        transition: all 150ms ease;
    }
    .close-btn:hover { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); }

    .dialog-body { padding: 8px 24px 16px; }

    .field { margin-bottom: 16px; }
    .field-label {
        display: flex;
        justify-content: space-between;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        color: rgba(255,255,255,0.55);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
    }
    .field-value { font-weight: 700; color: var(--md-sys-color-primary, #a0c4ff); }

    .format-options { display: flex; gap: 8px; }
    .format-btn {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 12px 8px;
        border-radius: 14px;
        background: rgba(255,255,255,0.04);
        border: 1.5px solid rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.6);
        font-family: 'Instrument Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 200ms ease;
    }
    .format-btn:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
    .format-btn.active {
        background: rgba(160,196,255,0.12);
        border-color: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-primary, #a0c4ff);
    }
    .format-icon { font-size: 20px; }

    .quality-slider {
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        outline: none;
    }
    .quality-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 16px; height: 16px;
        border-radius: 50%;
        background: var(--md-sys-color-primary, #a0c4ff);
        cursor: pointer;
        box-shadow: 0 0 8px rgba(160,196,255,0.3);
    }
    .quality-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: rgba(255,255,255,0.3);
        margin-top: 4px;
    }

    .size-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
    }
    .size-btn {
        padding: 8px 6px;
        border-radius: 10px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.6);
        font-family: 'Instrument Sans', sans-serif;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 150ms ease;
    }
    .size-btn:hover { background: rgba(255,255,255,0.08); }
    .size-btn.active {
        background: rgba(160,196,255,0.12);
        border-color: var(--md-sys-color-primary, #a0c4ff);
        color: var(--md-sys-color-primary, #a0c4ff);
    }

    .custom-size-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
    }
    .custom-input {
        width: 100px;
        padding: 6px 10px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        color: rgba(255,255,255,0.9);
        font-family: 'DM Mono', monospace;
        font-size: 13px;
        outline: none;
    }
    .custom-input:focus { border-color: var(--md-sys-color-primary, #a0c4ff); }
    .unit { font-size: 12px; color: rgba(255,255,255,0.4); }

    .output-path {
        padding: 8px 12px;
        background: rgba(255,255,255,0.04);
        border-radius: 10px;
        font-family: 'DM Mono', monospace;
        font-size: 11px;
        color: rgba(255,255,255,0.4);
        word-break: break-all;
    }

    .status {
        padding: 10px 14px;
        border-radius: 12px;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 13px;
        font-weight: 500;
    }
    .status.success { background: rgba(34,197,94,0.12); color: #4ade80; }
    .status.error { background: rgba(239,68,68,0.12); color: #f87171; }

    .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 24px 20px;
    }
    .cancel-btn {
        padding: 10px 20px;
        border-radius: 12px;
        background: rgba(255,255,255,0.06);
        border: none;
        color: rgba(255,255,255,0.6);
        font-family: 'Instrument Sans', sans-serif;
        font-size: 13px;
        cursor: pointer;
        transition: all 150ms ease;
    }
    .cancel-btn:hover { background: rgba(255,255,255,0.1); }
    .export-btn {
        padding: 10px 28px;
        border-radius: 12px;
        background: var(--md-sys-color-primary, #a0c4ff);
        border: none;
        color: var(--md-sys-color-on-primary, #003258);
        font-family: 'Instrument Sans', sans-serif;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 200ms ease;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .export-btn:hover { filter: brightness(1.1); transform: scale(1.02); }
    .export-btn:disabled { opacity: 0.5; cursor: wait; }

    .spinner {
        width: 14px; height: 14px;
        border: 2px solid rgba(0,50,88,0.3);
        border-top-color: #003258;
        border-radius: 50%;
        animation: spin 600ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
</style>
