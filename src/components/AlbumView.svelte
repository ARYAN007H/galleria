<script lang="ts">
    import { onMount } from "svelte";
    import * as Icons from "lucide-svelte";
    import {
        albums,
        loadAlbums,
        createAlbum,
        deleteAlbum,
        renameAlbum,
        loadAlbumPhotos,
        activeSection,
        activeResourceId,
        photos,
        appSettings,
    } from "../lib/store";
    import { convertFileSource } from "../lib/store";
    import type { Album } from "../lib/store";

    /** Focus an element when it appears (transient inline editors). */
    function focusOnMount(node: HTMLElement) {
        node.focus();
    }


    let isCreating = false;
    let newAlbumName = "";
    let editingId: number | null = null;
    let editName = "";
    let contextMenuAlbum: Album | null = null;
    let contextMenuPos = { x: 0, y: 0 };

    onMount(() => {
        loadAlbums();
    });

    async function handleCreate() {
        if (!newAlbumName.trim()) return;
        await createAlbum(newAlbumName.trim());
        newAlbumName = "";
        isCreating = false;
    }

    function startRename(album: Album) {
        editingId = album.id;
        editName = album.name;
        contextMenuAlbum = null;
    }

    async function finishRename() {
        if (editingId !== null && editName.trim()) {
            await renameAlbum(editingId, editName.trim());
        }
        editingId = null;
        editName = "";
    }

    async function handleDelete(album: Album) {
        contextMenuAlbum = null;
        if (
            confirm(
                `Delete "${album.name}"? Photos won't be removed from your library.`,
            )
        ) {
            await deleteAlbum(album.id);
        }
    }

    async function openAlbum(album: Album) {
        activeResourceId.set(album.id);
        activeSection.set("album");
        await loadAlbumPhotos(album.id);
    }

    function showContextMenu(e: MouseEvent, album: Album) {
        e.preventDefault();
        contextMenuAlbum = album;
        contextMenuPos = { x: e.clientX, y: e.clientY };
    }

    function closeContextMenu() {
        contextMenuAlbum = null;
    }

    function getCoverUrl(album: Album): string {
        if (album.coverPath) {
            return convertFileSource(album.coverPath);
        }
        return "";
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="album-view" on:click={closeContextMenu}>
    <header class="album-header">
        <h1 class="album-title">Albums</h1>
        <button class="create-btn" on:click={() => (isCreating = true)}>
            <Icons.Plus class="w-5 h-5" />
            <span>New Album</span>
        </button>
    </header>

    {#if isCreating}
        <div class="create-form">
            <input
                class="create-input"
                type="text"
                placeholder="Album name…"
                bind:value={newAlbumName}
                on:keydown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") {
                        isCreating = false;
                        newAlbumName = "";
                    }
                }}
                use:focusOnMount
            />
            <button
                class="create-confirm"
                on:click={handleCreate}
                disabled={!newAlbumName.trim()}
            >
                Create
            </button>
            <button
                class="create-cancel"
                on:click={() => {
                    isCreating = false;
                    newAlbumName = "";
                }}
            >
                Cancel
            </button>
        </div>
    {/if}

    {#if $albums.length === 0 && !isCreating}
        <div class="empty-state">
            <div class="empty-icon">
                <Icons.FolderOpen class="w-16 h-16" />
            </div>
            <h2 class="empty-title">No albums yet</h2>
            <p class="empty-subtitle">
                Create your first album to organize your photos into collections
            </p>
            <button class="empty-cta" on:click={() => (isCreating = true)}>
                <Icons.Plus class="w-5 h-5" />
                Create Album
            </button>
        </div>
    {:else}
        <div class="album-grid">
            {#each $albums as album (album.id)}
                <button
                    class="album-card"
                    on:click={() => openAlbum(album)}
                    on:contextmenu={(e) => showContextMenu(e, album)}
                >
                    <div class="album-cover">
                        {#if album.coverPath}
                            <img
                                src={getCoverUrl(album)}
                                alt={album.name}
                                class="cover-img"
                            />
                        {:else}
                            <div class="cover-placeholder">
                                <Icons.Image class="w-10 h-10" />
                            </div>
                        {/if}
                        <div class="cover-overlay">
                            <span class="album-count"
                                >{album.photoCount} photos</span
                            >
                        </div>
                    </div>
                    <div class="album-info">
                        {#if editingId === album.id}
                            <input
                                class="rename-input"
                                type="text"
                                bind:value={editName}
                                on:keydown={(e) => {
                                    if (e.key === "Enter") finishRename();
                                    if (e.key === "Escape") {
                                        editingId = null;
                                    }
                                }}
                                on:blur={finishRename}
                                on:click|stopPropagation
                                use:focusOnMount
                            />
                        {:else}
                            <span class="album-name">{album.name}</span>
                        {/if}
                    </div>
                </button>
            {/each}
        </div>
    {/if}

    {#if contextMenuAlbum}
        <div
            class="context-menu"
            style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px"
        >
            <button
                class="ctx-item"
                on:click={() =>
                    contextMenuAlbum && startRename(contextMenuAlbum)}
            >
                <Icons.Pencil class="w-4 h-4" />
                Rename
            </button>
            <button
                class="ctx-item ctx-danger"
                on:click={() =>
                    contextMenuAlbum && handleDelete(contextMenuAlbum)}
            >
                <Icons.Trash2 class="w-4 h-4" />
                Delete
            </button>
        </div>
    {/if}
</div>

<style>
    .album-view {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding: var(--sp-5);
    }

    /* ── Header ── */
    .album-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--sp-5);
        flex-shrink: 0;
    }

    .album-title {
        font-size: var(--text-xl);
        font-weight: 700;
        color: var(--text-primary);
    }

    .create-btn {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding: 10px 20px;
        border-radius: var(--radius-full);
        background: var(--accent);
        color: var(--text-on-accent);
        font-weight: 600;
        font-size: var(--text-sm);
        transition: all 0.2s var(--ease-standard);
        box-shadow: var(--shadow-sm);
    }

    .create-btn:hover {
        background: var(--accent-hover);
        box-shadow: var(--shadow-md);
        transform: translateY(-1px);
    }

    /* ── Create Form ── */
    .create-form {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        margin-bottom: var(--sp-5);
        padding: var(--sp-3) var(--sp-4);
        background: var(--md-sys-color-surface-container);
        border-radius: var(--radius-xl);
        border: 1px solid var(--md-sys-color-outline-variant);
        animation: fadeIn 0.2s var(--ease-emphasized-decel);
    }

    .create-input {
        flex: 1;
        padding: 8px 14px;
        border: none;
        background: transparent;
        color: var(--text-primary);
        font-size: var(--text-md);
        outline: none;
    }

    .create-input::placeholder {
        color: var(--text-tertiary);
    }

    .create-confirm {
        padding: 8px 18px;
        border-radius: var(--radius-md);
        background: var(--accent);
        color: var(--text-on-accent);
        font-weight: 600;
        font-size: var(--text-sm);
        transition: var(--transition-fast);
    }

    .create-confirm:disabled {
        opacity: 0.4;
    }

    .create-cancel {
        padding: 8px 14px;
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: var(--text-sm);
        transition: var(--transition-fast);
    }

    .create-cancel:hover {
        background: var(--md-sys-color-surface-container-high);
    }

    /* ── Album Grid ── */
    .album-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: var(--sp-4);
    }

    .album-card {
        display: flex;
        flex-direction: column;
        border-radius: var(--radius-xl);
        background: var(--md-sys-color-surface-container);
        overflow: hidden;
        transition: all 0.25s var(--ease-emphasized);
        cursor: pointer;
        border: 1px solid transparent;
    }

    .album-card:hover {
        transform: translateY(-4px);
        box-shadow: var(--shadow-lg);
        border-color: var(--md-sys-color-outline-variant);
    }

    .album-cover {
        position: relative;
        aspect-ratio: 4/3;
        overflow: hidden;
        background: var(--md-sys-color-surface-container-high);
    }

    .cover-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.4s var(--ease-emphasized);
    }

    .album-card:hover .cover-img {
        transform: scale(1.06);
    }

    .cover-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-quaternary);
    }

    .cover-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 24px 12px 8px;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.5), transparent);
    }

    .album-count {
        font-size: 12px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.85);
    }

    .album-info {
        padding: var(--sp-3);
    }

    .album-name {
        font-size: var(--text-sm);
        font-weight: 600;
        color: var(--text-primary);
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .rename-input {
        width: 100%;
        padding: 4px 8px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        background: var(--md-sys-color-surface-container-lowest);
        color: var(--text-primary);
        font-size: var(--text-sm);
        outline: none;
    }

    /* ── Empty State ── */
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--sp-4);
        padding: var(--sp-8);
        animation: fadeIn 0.4s var(--ease-emphasized-decel);
    }

    .empty-icon {
        width: 88px;
        height: 88px;
        border-radius: var(--radius-2xl);
        background: var(--accent-subtle);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--accent);
    }

    .empty-title {
        font-size: var(--text-lg);
        font-weight: 700;
        color: var(--text-primary);
    }

    .empty-subtitle {
        font-size: var(--text-sm);
        color: var(--text-secondary);
        text-align: center;
        max-width: 300px;
    }

    .empty-cta {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding: 12px 24px;
        border-radius: var(--radius-full);
        background: var(--accent);
        color: var(--text-on-accent);
        font-weight: 600;
        transition: all 0.2s var(--ease-standard);
        box-shadow: var(--shadow-sm);
    }

    .empty-cta:hover {
        background: var(--accent-hover);
        box-shadow: var(--shadow-md);
    }

    /* ── Context Menu ── */
    .context-menu {
        position: fixed;
        z-index: 1000;
        min-width: 160px;
        padding: 6px;
        background: var(--md-sys-color-surface-container-high);
        border: 1px solid var(--md-sys-color-outline-variant);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        animation: fadeIn 0.15s var(--ease-emphasized-decel);
    }

    .ctx-item {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        width: 100%;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
        color: var(--text-primary);
        transition: var(--transition-fast);
        text-align: left;
    }

    .ctx-item:hover {
        background: var(--md-sys-color-surface-container-highest);
    }

    .ctx-danger {
        color: var(--color-danger);
    }

    .ctx-danger:hover {
        background: var(--color-danger-subtle);
    }
</style>
