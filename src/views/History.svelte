<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import type { HistoryResponse } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { PRESET_LABEL, STATUS_LABEL, formatBytes, formatRelative } from '../lib/format';

  let data = $state<HistoryResponse | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      const response = await api.history();
      data = { entries: response.entries, totals: response.totals };
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load history';
    }
  }

  onMount(load);

  async function clear() {
    if (!window.confirm('Clear the compression history? Files on disk are not touched.')) return;
    try {
      await api.clearHistory();
      await load();
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not clear history', 'error');
    }
  }

  async function reveal(path: string | null) {
    if (!path) return;
    try {
      await api.reveal(path);
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not open that file', 'error');
    }
  }

  const savingsRatio = $derived(
    data && data.totals.originalBytes > 0
      ? Math.round((data.totals.savedBytes / data.totals.originalBytes) * 1000) / 10
      : 0,
  );
</script>

<div class="page-head">
  <div>
    <h2>Local history</h2>
    <p>Stored on this machine only. Nothing leaves your computer.</p>
  </div>
  <button class="btn btn-ghost btn-sm" onclick={clear} disabled={!data?.entries.length}>Clear history</button>
</div>

{#if error}
  <div class="notice danger">{error}</div>
{:else if data}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:18px">
    <div class="card">
      <div class="tiny muted">Space saved</div>
      <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em">{formatBytes(data.totals.savedBytes)}</div>
      <div class="tiny muted">{savingsRatio}% off the originals</div>
    </div>
    <div class="card">
      <div class="tiny muted">Videos compressed</div>
      <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em">{data.totals.count}</div>
      <div class="tiny muted">{formatBytes(data.totals.compressedBytes)} written</div>
    </div>
    <div class="card">
      <div class="tiny muted">Original volume</div>
      <div style="font-size:24px;font-weight:700;letter-spacing:-0.02em">{formatBytes(data.totals.originalBytes)}</div>
      <div class="tiny muted">across all runs</div>
    </div>
  </div>

  {#if data.entries.length === 0}
    <div class="empty">
      <strong>No compressions recorded yet</strong>
      <span>Finished jobs show up here with their exact savings.</span>
      <button class="btn btn-primary" onclick={() => (app.view = 'library')}>Pick videos</button>
    </div>
  {:else}
    <div class="card tight" style="overflow-x:auto">
      <table class="table">
        <thead>
          <tr>
            <th>Video</th>
            <th>Preset</th>
            <th>Before</th>
            <th>After</th>
            <th>Saved</th>
            <th>When</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as entry (entry.id)}
            <tr>
              <td>
                <strong style="display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={entry.inputPath}>
                  {entry.fileName}
                </strong>
                <span class="tiny">{STATUS_LABEL[entry.status] ?? entry.status}</span>
              </td>
              <td>{PRESET_LABEL[entry.preset] ?? entry.preset}</td>
              <td>{formatBytes(entry.originalSizeBytes)}</td>
              <td>{formatBytes(entry.outputSizeBytes)}</td>
              <td>
                <span style="color:var(--success)">{entry.savedBytes ? formatBytes(entry.savedBytes) : '—'}</span>
                {#if entry.reductionPercent > 0}
                  <span class="tiny">({entry.reductionPercent}%)</span>
                {/if}
              </td>
              <td>{formatRelative(entry.timestamp)}</td>
              <td>
                {#if entry.outputPath}
                  <button class="btn btn-sm btn-ghost" onclick={() => reveal(entry.outputPath)}>Show file</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
{/if}
