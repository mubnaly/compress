<script lang="ts">
  import { api } from '../lib/api';
  import type { Job } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { PRESET_LABEL, STATUS_LABEL, formatBytes, formatEta, formatRelative } from '../lib/format';

  let filter = $state<'all' | 'active' | 'done'>('all');

  const jobs = $derived(
    app.jobs.filter((job) => {
      if (filter === 'active') return job.status === 'running' || job.status === 'queued';
      if (filter === 'done') return job.status !== 'running' && job.status !== 'queued';
      return true;
    }),
  );

  const activeCount = $derived(app.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length);

  async function cancel(job: Job) {
    try {
      const result = await api.cancelJob(job.id);
      if (!result.ok) throw new Error('Could not cancel this job');
      await app.refreshJobs();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not cancel', 'error');
    }
  }

  async function retry(job: Job) {
    try {
      const result = await api.retryJob(job.id);
      if (!result.ok) throw new Error('Could not retry this job');
      await app.refreshJobs();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not retry', 'error');
    }
  }

  async function remove(job: Job) {
    try {
      const result = await api.removeJob(job.id);
      if (!result.ok) throw new Error('Could not remove this job');
      await app.refreshJobs();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not remove', 'error');
    }
  }

  async function deleteOriginal(job: Job) {
    const confirmed = window.confirm(
      `Delete the original file permanently?\n\n${job.inputPath}\n\nThis frees ${formatBytes(job.result?.originalSizeBytes ?? job.probe?.fileSizeBytes ?? 0)} and cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const result = await api.deleteOriginal(job.id);
      if (!result.ok) throw new Error(result.error ?? 'Could not delete the original');
      app.notify('Original file deleted', 'info');
      await app.refreshJobs();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not delete the original', 'error');
    }
  }

  async function reveal(path: string | null | undefined) {
    if (!path) return;
    try {
      await api.reveal(path);
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not open that location', 'error');
    }
  }

  async function clearFinished() {
    try {
      await api.clearFinished();
      await app.refreshJobs();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not clear finished jobs', 'error');
    }
  }
</script>

<div class="page-head">
  <div>
    <h2>Compression queue</h2>
    <p>{activeCount > 0 ? `${activeCount} job${activeCount === 1 ? '' : 's'} in flight.` : 'Nothing encoding right now.'}</p>
  </div>
  <div class="row">
    <div class="seg">
      <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
      <button class:active={filter === 'active'} onclick={() => (filter = 'active')}>Active</button>
      <button class:active={filter === 'done'} onclick={() => (filter = 'done')}>Finished</button>
    </div>
    <button class="btn btn-ghost btn-sm" onclick={clearFinished} disabled={!app.finishedJobs.length}>
      Clear finished
    </button>
  </div>
</div>

{#if jobs.length === 0}
  <div class="empty">
    <strong>Queue is empty</strong>
    <span>Select videos in the Library and press Compress.</span>
    <button class="btn btn-primary" onclick={() => (app.view = 'library')}>Pick videos</button>
  </div>
{:else}
  <div class="stack">
    {#each jobs as job (job.id)}
      <div class="job" class:running={job.status === 'running'}>
        <div class="job-top">
          <div class="job-title">
            <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{job.fileName}</span>
            <span class="tiny muted">
              {PRESET_LABEL[job.preset] ?? job.preset}
              {#if job.probe} · {job.probe.width} × {job.probe.height} · {formatBytes(job.probe.fileSizeBytes)}{/if}
              {#if job.options?.codec} · {String(job.options.codec).toUpperCase()}{/if}
            </span>
          </div>

          <span
            class="badge"
            class:accent={job.status === 'running'}
            class:success={job.status === 'completed'}
            class:warning={job.status === 'already_optimal'}
            class:danger={job.status === 'failed'}
          >
            {STATUS_LABEL[job.status] ?? job.status}
          </span>
        </div>

        {#if job.status === 'running' || job.status === 'queued'}
          <div class="progress"><i style={`width:${Math.max(2, job.progress.percent)}%`}></i></div>
          <div class="job-stats">
            <span><b>{job.progress.percent.toFixed(0)}%</b></span>
            {#if job.status === 'running'}
              <span>{job.progress.fps ? `${job.progress.fps} fps` : 'starting'}</span>
              <span>{job.progress.speed ? `${job.progress.speed.toFixed(2)}× realtime` : ''}</span>
              <span>{formatEta(job.progress.etaSeconds)}</span>
            {:else}
              <span>Waiting for a worker…</span>
            {/if}
          </div>
        {/if}

        {#if job.status === 'completed' && job.result}
          <div class="job-stats">
            <span><b>{formatBytes(job.result.originalSizeBytes)}</b> → <b>{formatBytes(job.result.outputSizeBytes)}</b></span>
            <span style="color:var(--success)"><b>{job.result.reductionPercent}%</b> smaller</span>
            <span>saved {formatBytes(job.result.savedBytes)}</span>
            <span>{job.result.dimensions ?? ''} {job.result.container ? `· ${job.result.container}` : ''}</span>
            <span>finished {formatRelative(job.finishedAt ?? 0)}</span>
          </div>
          <div class="tiny mono muted" title={job.result.outputPath ?? ''} style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            {job.result.outputPath}
          </div>
        {/if}

        {#if job.status === 'already_optimal'}
          <div class="notice warning">
            This video is already well compressed. Encoding it would have produced
            {formatBytes(job.result?.wouldBeBytes ?? 0)} instead of {formatBytes(job.result?.originalSizeBytes ?? 0)}, so the
            original was kept.
            <a href="#settings" onclick={() => (app.view = 'settings')}>Allow size increases</a>
          </div>
        {/if}

        {#if job.status === 'failed' && job.error}
          <div class="notice danger">{job.error}</div>
        {/if}

        <div class="row wrap">
          {#if job.status === 'running' || job.status === 'queued'}
            <button class="btn btn-sm btn-danger" onclick={() => cancel(job)}>Cancel</button>
          {/if}

          {#if job.status === 'completed' && job.result?.outputPath}
            <a
              class="btn btn-sm btn-primary"
              href={`/api/media?path=${encodeURIComponent(job.result.outputPath)}&download=1`}
              download={job.fileName.replace(/\.[^.]+$/, '_compressed.mp4')}
            >
              ⬇ Download
            </a>
            <button class="btn btn-sm" onclick={() => app.openCompare(job.id)}>Compare</button>
            <button class="btn btn-sm" onclick={() => reveal(job.result?.outputPath)}>Reveal in Explorer</button>
            <button class="btn btn-sm btn-danger" onclick={() => deleteOriginal(job)} disabled={job.originalDeleted}>
              {job.originalDeleted ? 'Original deleted' : 'Delete original'}
            </button>
          {/if}

          {#if job.status === 'already_optimal'}
            <button class="btn btn-sm" onclick={() => reveal(job.inputPath)}>Reveal original</button>
            <button class="btn btn-sm btn-danger" onclick={() => deleteOriginal(job)} disabled={job.originalDeleted}>
              Delete original
            </button>
          {/if}

          {#if job.status === 'failed' || job.status === 'cancelled' || job.status === 'already_optimal'}
            <button class="btn btn-sm" onclick={() => retry(job)}>Retry</button>
          {/if}

          {#if job.status !== 'running' && job.status !== 'queued'}
            <button class="btn btn-sm btn-ghost" onclick={() => remove(job)}>Remove</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
