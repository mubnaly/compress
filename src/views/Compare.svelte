<script lang="ts">
  import { api } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { formatBytes, formatDuration } from '../lib/format';

  let compareJobId = $state<string | null>(app.compareJobId);
  let split = $state(50);
  let playing = $state(false);
  let position = $state(0);
  let stageEl = $state<HTMLDivElement | null>(null);
  let originalEl = $state<HTMLVideoElement | null>(null);
  let compressedEl = $state<HTMLVideoElement | null>(null);
  let dragging = $state(false);

  const comparable = $derived(app.jobs.filter((job) => job.status === 'completed' && job.result?.outputPath));

  $effect(() => {
    if (!compareJobId && comparable.length > 0) compareJobId = comparable[0].id;
  });

  const job = $derived(app.jobs.find((entry) => entry.id === compareJobId) ?? null);
  const duration = $derived(job?.probe?.durationSeconds ?? 0);

  function setSplitFromClientX(clientX: number) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    split = Math.min(100, Math.max(0, Math.round(percent * 10) / 10));
  }

  async function togglePlay() {
    const original = originalEl;
    const compressed = compressedEl;
    if (!original || !compressed) return;

    if (playing) {
      original.pause();
      compressed.pause();
      playing = false;
      return;
    }

    if (Math.abs(original.currentTime - compressed.currentTime) > 0.12) {
      compressed.currentTime = original.currentTime;
    }
    try {
      await original.play();
      await compressed.play();
      playing = true;
    } catch {
      playing = false;
    }
  }

  function seek(seconds: number) {
    position = seconds;
    if (originalEl) originalEl.currentTime = seconds;
    if (compressedEl) compressedEl.currentTime = seconds;
  }

  function handleTimeUpdate() {
    if (!originalEl) return;
    position = originalEl.currentTime;
    if (compressedEl && Math.abs(compressedEl.currentTime - originalEl.currentTime) > 0.2) {
      compressedEl.currentTime = originalEl.currentTime;
    }
  }

  function choose(id: string) {
    compareJobId = id;
    app.compareJobId = id;
    playing = false;
    position = 0;
    split = 50;
  }
</script>

<div class="page-head">
  <div>
    <h2>Before / after</h2>
    <p>Drag the divider to inspect the same frame at full quality on the left and compressed on the right.</p>
  </div>
  <div class="row">
    <button class="btn btn-ghost btn-sm" onclick={() => (app.view = 'queue')}>Back to queue</button>
  </div>
</div>

{#if comparable.length === 0}
  <div class="empty">
    <strong>No finished compressions yet</strong>
    <span>Compress a video and it will appear here for comparison.</span>
    <button class="btn btn-primary" onclick={() => (app.view = 'library')}>Pick videos</button>
  </div>
{:else}
  <div class="stack">
    <div class="row wrap">
      {#each comparable as entry (entry.id)}
        <button class="btn btn-sm" class:btn-primary={entry.id === compareJobId} onclick={() => choose(entry.id)}>
          {entry.fileName}
        </button>
      {/each}
    </div>

    {#if job && job.result?.outputPath}
      <div class="card">
        <div class="card-header">
          <div>
            <h3>{job.fileName}</h3>
            <span class="tiny muted">{formatBytes(job.result.originalSizeBytes)} → {formatBytes(job.result.outputSizeBytes)} · {job.result.reductionPercent}% smaller</span>
          </div>
          <span class="badge success">{(job.result.encoder ?? '').toUpperCase()}</span>
        </div>

        <div
          class="compare-stage"
          bind:this={stageEl}
          role="slider"
          tabindex="0"
          aria-label="Comparison divider"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={split}
          onpointerdown={(event) => {
            dragging = true;
            setSplitFromClientX(event.clientX);
          }}
          onpointermove={(event) => {
            if (dragging) setSplitFromClientX(event.clientX);
          }}
          onpointerup={() => (dragging = false)}
          onpointerleave={() => (dragging = false)}
          onkeydown={(event) => {
            if (event.key === 'ArrowLeft') split = Math.max(0, split - 2);
            if (event.key === 'ArrowRight') split = Math.min(100, split + 2);
          }}
        >
          <video
            bind:this={originalEl}
            src={api.mediaUrl(job.inputPath)}
            preload="metadata"
            muted
            playsinline
            ontimeupdate={handleTimeUpdate}
            onended={() => (playing = false)}
          ></video>
          <video
            bind:this={compressedEl}
            src={api.mediaUrl(job.result.outputPath)}
            preload="metadata"
            muted
            playsinline
            style={`clip-path: inset(0 0 0 ${split}%)`}
          ></video>

          <span class="compare-label left">Original</span>
          <span class="compare-label right">Compressed</span>

          <div class="compare-divider" style={`left:${split}%`}>
            <span class="compare-handle">↔</span>
          </div>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="btn btn-primary btn-sm" onclick={togglePlay}>{playing ? 'Pause' : 'Play both'}</button>
          <span class="tiny mono muted" style="min-width:92px">{formatDuration(position)} / {formatDuration(duration)}</span>
          <input
            type="range"
            min="0"
            max={Math.max(0.1, duration)}
            step="0.05"
            value={position}
            oninput={(event) => seek(Number(event.currentTarget.value))}
            style="flex:1"
          />
          <button class="btn btn-ghost btn-sm" onclick={() => (split = 50)}>Reset split</button>
        </div>
      </div>
    {/if}
  </div>
{/if}
