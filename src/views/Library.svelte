<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import type { BrowseEntry, BrowseListing, HistoryEntry, HistoryResponse } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { formatBytes, formatRelative } from '../lib/format';

  let listing = $state<BrowseListing | null>(null);
  let pathInput = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);
  let sortBy = $state('date');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let historyData = $state<HistoryResponse | null>(null);
  let queueing = $state(false);
  let isDragging = $state(false);
  let isDropping = $state(false);
  let fileInputEl = $state<HTMLInputElement | null>(null);
  let folderInputEl = $state<HTMLInputElement | null>(null);

  let youtubeUrl = $state('');
  let isDownloadingYoutube = $state(false);
  let youtubeStatus = $state<string | null>(null);

  async function submitYoutube(e: Event) {
    e.preventDefault();
    const url = youtubeUrl.trim();
    if (!url || isDownloadingYoutube) return;

    isDownloadingYoutube = true;
    youtubeStatus = 'Fetching YouTube video & downloading 720p stream...';
    app.notify('Downloading YouTube video stream...', 'info');

    try {
      const res = await api.youtube(url);
      if (res.ok) {
        youtubeStatus = 'Video fetched! Starting 720p compression...';
        app.notify('YouTube video queued for 720p compression! Auto-download will trigger on completion.', 'info');
        youtubeUrl = '';
        await app.refreshJobs();
        app.view = 'queue';
      } else {
        throw new Error(res.error || 'Failed to download YouTube video');
      }
    } catch (err) {
      youtubeStatus = null;
      app.notify(err instanceof Error ? err.message : 'YouTube download failed', 'error');
    } finally {
      isDownloadingYoutube = false;
      setTimeout(() => {
        youtubeStatus = null;
      }, 5000);
    }
  }

  const picked = $derived(new Set(app.selected.map((entry) => entry.path)));

  async function handleDropFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;

    isDropping = true;
    app.notify(`Processing ${files.length} video(s)...`, 'info');

    try {
      const addedEntries: BrowseEntry[] = [];
      for (const file of files) {
        // If file.path is available (e.g. Electron / Tauri / Chromium)
        const filePath = (file as any).path;
        if (filePath && typeof filePath === 'string') {
          addedEntries.push({
            name: file.name,
            path: filePath,
            sizeBytes: file.size,
            modifiedAt: file.lastModified,
          });
        } else {
          // Stream upload to local engine directly
          const res = await api.upload(file);
          if (res.ok && res.file) {
            addedEntries.push(res.file);
          }
        }
      }

      if (addedEntries.length > 0) {
        app.selected = [...app.selected, ...addedEntries];
        app.notify(`Loaded ${addedEntries.length} video(s)! Opening configuration...`, 'info');
        app.view = 'configure';
      }
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not process dropped files', 'error');
    } finally {
      isDropping = false;
      isDragging = false;
    }
  }

  async function pickNativeFolder() {
    try {
      const res = await api.chooseFolder();
      if (res.ok && res.path) {
        await load(res.path);
        app.notify(`Opened folder: ${res.path}`, 'info');
      } else if (!res.cancelled && res.unsupported) {
        folderInputEl?.click();
      }
    } catch {
      folderInputEl?.click();
    }
  }

  async function pickNativeFiles() {
    try {
      const res = await api.chooseFiles();
      if (res.ok && res.files && res.files.length > 0) {
        app.selected = [...app.selected, ...res.files];
        app.notify(`Selected ${res.files.length} video(s)!`, 'info');
        app.view = 'configure';
      } else if (!res.cancelled && res.unsupported) {
        fileInputEl?.click();
      }
    } catch {
      fileInputEl?.click();
    }
  }

  async function load(target?: string) {
    loading = true;
    error = null;
    try {
      const data = await api.browse(target ?? pathInput, sortBy, sortDir);
      listing = data;
      pathInput = data.path;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not open that folder';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load(listing?.path ?? '');
    loadHistory();
  });

  async function loadHistory() {
    try {
      const data = await api.history();
      historyData = { entries: data.entries, totals: data.totals };
    } catch {
      /* history is optional */
    }
  }

  async function changeSort(nextSort: string, nextDir: 'asc' | 'desc') {
    sortBy = nextSort;
    sortDir = nextDir;
    await load(listing?.path ?? '');
  }

  async function queueFolder() {
    if (!listing || !listing.videos.length) return;
    queueing = true;
    try {
      await api.addJobs(
        listing.videos.map((video) => ({
          path: video.path,
          preset: app.settings?.defaultPreset ?? 'optimal',
          options: { codec: app.settings?.defaultCodec ?? 'h264' },
        })),
      );
      app.notify(`Queued ${listing.videos.length} videos from this folder`, 'info');
      await app.refreshJobs();
      app.view = 'queue';
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not queue this folder', 'error');
    } finally {
      queueing = false;
    }
  }

  function toggle(entry: BrowseEntry) {
    if (picked.has(entry.path)) {
      app.selected = app.selected.filter((item) => item.path !== entry.path);
    } else {
      app.selected = [...app.selected, entry];
    }
  }

  function selectVisible() {
    if (!listing) return;
    const existing = new Set(app.selected.map((entry) => entry.path));
    const additions = listing.videos.filter((video) => !existing.has(video.path));
    app.selected = [...app.selected, ...additions];
  }

  function configure() {
    if (!app.selected.length) return;
    app.view = 'configure';
  }
</script>

<div class="page-head">
  <div>
    <h2>Videos on this device</h2>
    <p>Browse a folder, choose your C: drive, or drop videos below to compress.</p>
  </div>
  <div class="row">
    <button class="btn btn-ghost btn-sm" onclick={queueFolder} disabled={!listing?.videos.length || queueing}>
      {queueing ? 'Queueing…' : 'Queue folder'}
    </button>
    <button class="btn btn-ghost btn-sm" onclick={() => (app.selected = [])} disabled={!app.selected.length}>
      Clear selection
    </button>
    <button class="btn btn-primary" onclick={configure} disabled={!app.selected.length}>
      Configure {app.selected.length || ''}
      {app.selected.length === 1 ? 'video' : app.selected.length > 1 ? 'videos' : ''}
    </button>
  </div>
</div>

<div
  class="dropzone-card"
  class:active={isDragging}
  role="region"
  aria-label="Dropzone for video files"
  ondragover={(e) => {
    e.preventDefault();
    isDragging = true;
  }}
  ondragenter={(e) => {
    e.preventDefault();
    isDragging = true;
  }}
  ondragleave={(e) => {
    e.preventDefault();
    isDragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files?.length) {
      handleDropFiles(e.dataTransfer.files);
    }
  }}
>
  <div class="dropzone-icon">🎬</div>
  <div class="dropzone-text">
    <h3>Drag & Drop video files here</h3>
    <p>Drag any video from your C: partition directly into this box, or select below</p>
  </div>
  <div class="dropzone-actions">
    <button class="btn btn-primary btn-sm" onclick={pickNativeFiles} disabled={isDropping}>
      🎥 Select Videos...
    </button>
    <button class="btn btn-ghost btn-sm" onclick={pickNativeFolder} disabled={isDropping}>
      📂 Choose Specific Folder...
    </button>
  </div>
  {#if isDropping}
    <div class="dropzone-loading">Processing & probing videos...</div>
  {/if}
</div>

<div class="youtube-card">
  <div class="youtube-icon">▶️</div>
  <div class="youtube-body">
    <div class="youtube-title">
      <h3>Compress YouTube Video Online (720p)</h3>
      <p>Paste a YouTube URL to download and compress it to 720p, automatically downloading to your device when done.</p>
    </div>
    <form class="youtube-form" onsubmit={submitYoutube}>
      <input
        type="url"
        class="input youtube-input"
        placeholder="https://www.youtube.com/watch?v=..."
        bind:value={youtubeUrl}
        disabled={isDownloadingYoutube}
        required
      />
      <button class="btn btn-primary" type="submit" disabled={isDownloadingYoutube || !youtubeUrl.trim()}>
        {#if isDownloadingYoutube}
          ⏳ Downloading stream...
        {:else}
          ⚡ Compress 720p & Auto-Download
        {/if}
      </button>
    </form>
    {#if youtubeStatus}
      <div class="tiny youtube-status">{youtubeStatus}</div>
    {/if}
  </div>
</div>

<!-- Fallback inputs for browser file and folder selection -->
<input
  type="file"
  multiple
  accept="video/*,.mp4,.mkv,.mov,.avi,.webm,.m4v,.flv,.wmv"
  bind:this={fileInputEl}
  style="display:none"
  onchange={(e) => {
    if (e.currentTarget.files) handleDropFiles(e.currentTarget.files);
  }}
/>
<input
  type="file"
  webkitdirectory
  bind:this={folderInputEl}
  style="display:none"
  onchange={(e) => {
    if (e.currentTarget.files) handleDropFiles(e.currentTarget.files);
  }}
/>

<div class="pathbar">
  <button class="btn btn-ghost btn-sm" onclick={() => load(listing?.parent ?? undefined)} disabled={!listing?.parent}>
    ↑ Up
  </button>
  <input
    class="input mono"
    bind:value={pathInput}
    placeholder="C:\Users\you\Videos"
    onkeydown={(event) => {
      if (event.key === 'Enter') load(pathInput);
    }}
  />
  <button class="btn btn-sm" onclick={() => load(pathInput)} disabled={loading}>Open</button>
</div>

{#if app.roots.length}
  <div class="row wrap" style="margin-bottom:14px">
    {#each app.roots as root (root.path)}
      <button
        class="badge"
        style="cursor:pointer;background:var(--panel-2)"
        onclick={() => load(root.path)}
        title={root.path}
      >
        {root.label}
      </button>
    {/each}
  </div>
{/if}

{#if error}
  <div class="notice danger" style="margin-bottom:14px">{error}</div>
{/if}

<div class="browser">
  <div class="card tight">
    <div class="card-header" style="margin-bottom:8px">
      <h3>Folders</h3>
      <span class="tiny muted">{listing?.directories.length ?? 0}</span>
    </div>
    <div class="folder-list">
      {#each listing?.directories ?? [] as folder (folder.path)}
        <button class="folder" onclick={() => load(folder.path)} title={folder.path}>
          <span>🗀</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{folder.name}</span>
        </button>
      {/each}
      {#if listing && listing.directories.length === 0}
        <span class="tiny muted" style="padding:8px 4px">No subfolders here.</span>
      {/if}
      {#if loading}
        <span class="tiny muted" style="padding:8px 4px">Loading…</span>
      {/if}
    </div>
  </div>

  <div class="card tight">
    <div class="card-header" style="margin-bottom:10px">
      <h3>Videos <span class="tiny muted">({listing?.videos.length ?? 0})</span></h3>
      <div class="row">
        <select
          class="select"
          style="width:auto;padding:6px 9px;font-size:12.5px"
          value={sortBy}
          onchange={(event) => changeSort(event.currentTarget.value, sortDir)}
        >
          <option value="date">Newest</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
        <button
          class="btn btn-ghost btn-sm"
          onclick={() => changeSort(sortBy, sortDir === 'desc' ? 'asc' : 'desc')}
          title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick={selectVisible} disabled={!listing?.videos.length}>
          Select all
        </button>
        <button class="btn btn-ghost btn-sm" onclick={() => load(listing?.path ?? undefined)} disabled={loading}>
          Refresh
        </button>
      </div>
    </div>

    <div class="video-list">
      {#each listing?.videos ?? [] as video (video.path)}
        <div
          class="video-item"
          class:picked={picked.has(video.path)}
          role="button"
          tabindex="0"
          onclick={() => toggle(video)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggle(video);
            }
          }}
        >
          <input type="checkbox" checked={picked.has(video.path)} tabindex="-1" style="pointer-events:none" />
          <div class="video-thumb">
            <img
              src={api.thumbUrl(video.path, 1)}
              alt=""
              loading="lazy"
              onerror={(event) => event.currentTarget.remove()}
            />
          </div>
          <div class="video-meta">
            <span class="video-name" title={video.path}>{video.name}</span>
            <span class="tiny muted">
              {formatBytes(video.sizeBytes ?? 0)} · modified {formatRelative(video.modifiedAt ?? 0)}
            </span>
          </div>
          <span class="badge">{video.path.split('.').pop()?.toUpperCase()}</span>
        </div>
      {/each}

      {#if listing && listing.videos.length === 0 && !loading}
        <div class="empty">
          <strong>No videos in this folder</strong>
          <span>Open a folder above or use one of the shortcuts.</span>
        </div>
      {/if}
    </div>
  </div>
</div>

{#if historyData && historyData.entries.length > 0}
  <div class="card tight" style="margin-top:16px">
    <div class="card-header" style="margin-bottom:10px">
      <h3>Recent compressions</h3>
      <span class="tiny muted">
        {formatBytes(historyData.totals.savedBytes)} saved across {historyData.totals.count}
        {historyData.totals.count === 1 ? 'run' : 'runs'}
      </span>
    </div>
    <div class="stack" style="gap:6px">
      {#each historyData.entries.slice(0, 3) as entry (entry.id)}
        <div class="row between tiny">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%">{entry.fileName}</span>
          <span class="muted" style="white-space:nowrap">
            {formatBytes(entry.originalSizeBytes)} → {formatBytes(entry.outputSizeBytes)} · {formatRelative(entry.timestamp)}
          </span>
        </div>
      {/each}
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick={() => (app.view = 'history')}>
      Open history
    </button>
  </div>
{/if}

{#if app.selected.length > 0}
  <div class="selection-bar">
    <div>
      <strong>{app.selected.length}</strong>
      {app.selected.length === 1 ? 'video selected' : 'videos selected'}
      <span class="tiny muted" style="display:block">
        {formatBytes(app.selected.reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0))} total
      </span>
    </div>
    <button class="btn btn-primary" onclick={configure}>Configure compression →</button>
  </div>
{/if}
