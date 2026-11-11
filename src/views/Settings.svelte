<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { api, getEngineUrl, setEngineUrl } from '../lib/api';
  import type { Settings } from '../lib/api';

  let draft = $state<Settings | null>(app.settings ? { ...app.settings } : null);
  let customEngineUrl = $state(getEngineUrl());
  let saving = $state(false);
  let pickError = $state<string | null>(null);
  let showApiKey = $state(false);
  let resettingTokens = $state(false);

  const DEFAULT_AI_KEY = '';

  function setDefaultAiKey() {
    if (draft) {
      draft.aiApiKey = '';
      app.notify('AI Key cleared', 'info');
    }
  }

  async function resetTokenCounter() {
    if (!confirm('Are you sure you want to reset the AI token counter to zero?')) return;
    resettingTokens = true;
    try {
      const res = await api.aiResetTokens();
      if (draft) draft.aiTokensUsed = res.aiTokensUsed;
      app.notify('AI Token counter reset', 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Failed to reset tokens', 'error');
    } finally {
      resettingTokens = false;
    }
  }

  function saveEngineConnection() {
    setEngineUrl(customEngineUrl);
    app.notify('Engine URL updated. Reconnecting...', 'info');
    app.boot();
  }

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
      <div class="card" style="border: 1px solid rgba(139, 92, 246, 0.35); background: linear-gradient(180deg, rgba(139, 92, 246, 0.08) 0%, rgba(15, 23, 42, 0.4) 100%);">
        <div class="card-header">
          <div class="row align-center" style="gap:8px">
            <span style="font-size:1.2rem">✨</span>
            <div>
              <h3>AI & Smart Editing (Gemini)</h3>
              <span class="tiny muted">Powering Auto-Captions, Silence Removal & Viral Reels</span>
            </div>
          </div>
          <span class="badge" class:success={Boolean(draft.aiApiKey)} class:danger={!draft.aiApiKey}>
            {draft.aiApiKey ? 'AI Active' : 'No Key'}
          </span>
        </div>

        <div class="stack" style="gap:14px; margin-top:8px">
          <label class="field">
            <div class="row between align-center">
              <span>Gemini API Key</span>
              <button class="btn btn-xs btn-ghost" type="button" onclick={() => showApiKey = !showApiKey}>
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {#if showApiKey}
              <input class="input mono" type="text" bind:value={draft.aiApiKey} placeholder="AIzaSy..." />
            {:else}
              <input class="input mono" type="password" bind:value={draft.aiApiKey} placeholder="AIzaSy..." />
            {/if}
          </label>

          <div class="row between align-center wrap" style="gap:8px">
            <label class="field" style="flex:1; min-width:180px">
              <span>Model</span>
              <select class="input" bind:value={draft.aiModel}>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fastest & Best)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              </select>
            </label>
            <button class="btn btn-sm btn-ghost" type="button" onclick={setDefaultAiKey} style="margin-top:20px">
              Reset Default Key
            </button>
          </div>

          <div class="card" style="background: rgba(15, 23, 42, 0.5); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06)">
            <div class="row between align-center">
              <div>
                <span class="tiny muted" style="display:block">Cumulative AI Usage</span>
                <strong style="font-size: 1.15rem; color: #a78bfa;">
                  {(draft.aiTokensUsed || 0).toLocaleString()} <span style="font-size: 0.8rem; font-weight: normal; color: var(--muted)">tokens</span>
                </strong>
              </div>
              <button class="btn btn-xs btn-ghost" type="button" onclick={resetTokenCounter} disabled={resettingTokens}>
                {resettingTokens ? 'Resetting…' : 'Reset Counter'}
              </button>
            </div>
          </div>
        </div>
      </div>

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
        <div class="card-header">
          <h3>Online / Remote Engine</h3>
          <span class="tiny muted">For GitHub Pages or Remote Hosting</span>
        </div>
        <div class="stack" style="gap:10px">
          <p class="tiny muted">
            When hosted online (e.g. GitHub Pages), connect to your running backend instance (Render, Railway, or local tunnel).
          </p>
          <label class="field">
            <span>Engine Backend URL</span>
            <input
              class="input"
              placeholder="e.g. https://compress.onrender.com (or leave empty)"
              bind:value={customEngineUrl}
            />
          </label>
          <button class="btn btn-sm btn-ghost" onclick={saveEngineConnection}>
            Connect / Reload Engine
          </button>
        </div>
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
