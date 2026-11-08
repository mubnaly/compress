<script lang="ts">
  import { app } from '../lib/state.svelte';
  import type { Settings } from '../lib/api';

  let draft = $state<Settings | null>(app.settings ? { ...app.settings } : null);
  let saving = $state(false);
  let pickError = $state<string | null>(null);

  const codecs = [
    { id: 'h264', label: 'H.264 · most compatible' },
    { id: 'hevc', label: 'H.265 / HEVC' },
    { id: 'av1', label: 'AV1' },
    { id: 'vp9', label: 'VP9' },
  ];

  const presets = [
    { id: 'optimal', label: 'Optimal quality' },
    { id: 'medium', label: 'Medium quality' },
    { id: 'small', label: 'Small size' },
    { id: 'whatsapp', label: 'WhatsApp 16 MB' },
    { id: 'gmail', label: 'Gmail 25 MB' },
  ];

  async function save() {
    if (!draft) return;
    saving = true;
    pickError = null;
    try {
      const saved = await app.saveSettings(draft);
      if (saved) {
        draft = { ...saved };
        app.notify('Settings saved', 'info');
      }
    } finally {
      saving = false;
    }
  }

  async function validatePath(path: string) {
    if (!path.trim()) return;
    try {
      const listing = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
      if (!listing.ok) throw new Error('Folder not accessible');
      pickError = null;
    } catch {
      pickError = 'That output folder is not accessible. Leave it empty to save next to each source file.';
    }
  }
</script>

<div class="page-head">
  <div>
    <h2>Preferences</h2>
    <p>These settings live in a local JSON file next to the app.</p>
  </div>
  <button class="btn btn-primary" onclick={save} disabled={!draft || saving}>{saving ? 'Saving…' : 'Save settings'}</button>
</div>

{#if draft}
  <div class="split-2">
    <div class="stack">
      <div class="card">
        <div class="card-header">
          <h3>Output</h3>
          <span class="tiny muted">Where finished files land</span>
        </div>
        <div class="stack">
          <label class="field">
            <span>Output folder <span class="tiny muted">(leave empty to save beside the original)</span></span>
            <input
              class="input mono"
              bind:value={draft.outputDirectory}
              placeholder="D:\Exports"
              onblur={() => validatePath(draft?.outputDirectory ?? '')}
            />
          </label>
          {#if pickError}
            <div class="notice danger">{pickError}</div>
          {/if}

          <label class="field">
            <span>File naming pattern</span>
            <input
              class="input mono"
              bind:value={draft.namingPattern}
              placeholder={'{name}_compressed.{ext}'}
            />
          </label>
          <p class="tiny muted">
            Available tokens: <span class="mono">{'{name}'}</span>, <span class="mono">{'{preset}'}</span>,
            <span class="mono">{'{ext}'}</span>. Existing files are never overwritten.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Encoding</h3>
          <span class="tiny muted">Defaults for new jobs</span>
        </div>
        <div class="option-grid">
          <label class="field">
            <span>Default preset</span>
            <select class="select" bind:value={draft.defaultPreset}>
              {#each presets as preset (preset.id)}
                <option value={preset.id}>{preset.label}</option>
              {/each}
            </select>
          </label>

          <label class="field">
            <span>Default codec</span>
            <select class="select" bind:value={draft.defaultCodec}>
              {#each codecs as codec (codec.id)}
                <option value={codec.id}>{codec.label}</option>
              {/each}
            </select>
          </label>

          <label class="field">
            <span>Parallel workers · {draft.concurrency}</span>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={draft.concurrency}
              oninput={(event) => {
                if (draft) draft.concurrency = Number(event.currentTarget.value);
              }}
            />
          </label>
        </div>

        <div class="grid" style="margin-top:10px">
          <label class="check">
            <input type="checkbox" bind:checked={draft.allowSizeIncrease} />
            <span>
              Continue even if the file size increases
              <small>Off by default: the already-optimal guard keeps your original instead.</small>
            </span>
          </label>

          <label class="check">
            <input
              type="checkbox"
              bind:checked={draft.hardwareAcceleration}
              disabled={!app.engine?.hardwareAcceleration}
            />
            <span>
              Prefer hardware encoding
              <small>
                {app.engine?.hardwareAcceleration
                  ? 'Uses the detected GPU encoder for much faster renders.'
                  : 'No hardware encoder was detected by this FFmpeg build.'}
              </small>
            </span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Appearance</h3>
        </div>
        <div class="seg">
          {#each ['system', 'dark', 'light'] as theme}
            <button
              class:active={draft.theme === theme}
              onclick={() => {
                if (draft) {
                  draft.theme = theme as Settings['theme'];
                  app.applyTheme(theme as Settings['theme']);
                }
              }}
            >
              {theme[0].toUpperCase() + theme.slice(1)}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="card-header">
          <h3>Engine</h3>
          <span class="badge" class:success={app.engine?.ok} class:danger={!app.engine?.ok}>
            {app.engine?.ok ? 'ready' : 'offline'}
          </span>
        </div>
        {#if app.engine?.ok}
          <div class="tiny mono stack" style="gap:6px;line-height:1.6">
            <div>version: {app.engine.version}</div>
            <div>ffmpeg: {app.engine.ffmpegPath}</div>
            <div>ffprobe: {app.engine.ffprobePath}</div>
            <div>h264: {app.engine.softwareEncoders.h264 ?? 'missing'}</div>
            <div>hevc: {app.engine.softwareEncoders.hevc ?? 'missing'}</div>
            <div>av1: {app.engine.softwareEncoders.av1 ?? 'missing'}</div>
            <div>vp9: {app.engine.softwareEncoders.vp9 ?? 'missing'}</div>
            <div>
              hardware:
              {#if app.engine.hardwareEncoders.h264.length || app.engine.hardwareEncoders.hevc.length}
                {[...app.engine.hardwareEncoders.h264, ...app.engine.hardwareEncoders.hevc].join(', ')}
              {:else}
                none detected
              {/if}
            </div>
          </div>
        {:else}
          <div class="notice danger">{app.engine?.error ?? 'Engine not reachable'}</div>
        {/if}
      </div>

      <div class="card">
        <div class="card-header"><h3>Privacy</h3></div>
        <p class="tiny muted">
          Plico never uploads media, never bundles ads, and never sends telemetry. FFmpeg runs as a separate local
          process; history is a JSON file in the app's <span class="mono">data</span> folder. Deleting that folder
          removes all traces of usage.
        </p>
      </div>
    </div>
  </div>
{/if}
