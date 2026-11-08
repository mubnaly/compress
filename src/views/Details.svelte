<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import type { Estimate, Probe } from '../lib/api';
  import { app } from '../lib/state.svelte';
  import { formatBitrate, formatBytes, formatDuration } from '../lib/format';

  let probe = $state<Probe | null>(null);
  let probeError = $state<string | null>(null);
  let loading = $state(false);

  let preset = $state(app.settings?.defaultPreset ?? 'optimal');
  let codec = $state(app.settings?.defaultCodec ?? 'h264');
  let hardware = $state(app.settings?.hardwareAcceleration ?? false);
  let removeAudio = $state(false);
  let volume = $state(100);
  let copyMetadata = $state(true);
  let audioBitrateKbps = $state(128);

  let targetSizeMB = $state(25);
  let targetWidth = $state(0);
  let targetHeight = $state(0);
  let lockAspect = $state(true);
  let scalePercent = $state(100);

  let estimate = $state<Estimate | null>(null);
  let estimateError = $state<string | null>(null);
  let submitting = $state(false);

  let showPreview = $state(false);
  let previewBusy = $state(false);
  let previewUrl = $state<string | null>(null);
  let previewChip = $state(10);
  let previewStart = $state(0);

  const ASPECTS = { free: null, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const;
  type CropAspect = keyof typeof ASPECTS;

  let trimStart = $state(0);
  let trimEnd = $state(0);
  let rotation = $state(0);
  let tonemap = $state(true);
  let container = $state<'mp4' | 'mkv' | 'webm'>('mp4');
  let cropActive = $state(false);
  let cropAspect = $state<CropAspect>('free');
  let cropXp = $state(0);
  let cropYp = $state(0);
  let cropWp = $state(100);
  let cropHp = $state(100);
  let cropStageEl = $state<HTMLDivElement | null>(null);
  let cropDrag = $state<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  function cropPixels() {
    if (!probe) return null;
    const srcW = probe.video.displayWidth || probe.video.width;
    const srcH = probe.video.displayHeight || probe.video.height;
    const width = Math.max(16, Math.round((srcW * cropWp) / 100 / 2) * 2);
    const height = Math.max(16, Math.round((srcH * cropHp) / 100 / 2) * 2);
    const x = Math.min(Math.max(0, Math.round((srcW * cropXp) / 100 / 2) * 2), Math.max(0, srcW - width));
    const y = Math.min(Math.max(0, Math.round((srcH * cropYp) / 100 / 2) * 2), Math.max(0, srcH - height));
    return { x, y, width, height };
  }

  function buildOptions() {
    return {
      codec,
      container,
      removeAudio,
      volume: volume / 100,
      copyMetadata,
      audioBitrateKbps,
      targetSizeMB,
      targetWidth,
      targetHeight,
      hardwareAcceleration: hardware,
      startSeconds: trimStart,
      endSeconds: trimEnd,
      rotation,
      tonemap,
      crop: cropActive ? cropPixels() : null,
    };
  }

  function resetCrop() {
    cropXp = 0;
    cropYp = 0;
    cropWp = 100;
    cropHp = 100;
    cropAspect = 'free';
    cropActive = false;
  }

  function applyAspect(aspect: CropAspect) {
    cropAspect = aspect;
    const ratio = ASPECTS[aspect];
    if (!ratio || !probe) return;
    const srcW = probe.video.displayWidth || probe.video.width;
    const srcH = probe.video.displayHeight || probe.video.height;
    let width = srcW;
    let height = srcW / ratio;
    if (height > srcH) {
      height = srcH;
      width = srcH * ratio;
    }
    cropWp = Math.round((width / srcW) * 1000) / 10;
    cropHp = Math.round((height / srcH) * 1000) / 10;
    cropXp = Math.round(((100 - cropWp) / 2) * 10) / 10;
    cropYp = Math.round(((100 - cropHp) / 2) * 10) / 10;
    cropActive = true;
  }

  function toggleSourcePlayback() {
    const video = document.querySelector<HTMLVideoElement>('.source-preview');
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  const first = $derived(app.selected[0] ?? null);
  const selectedCount = $derived(app.selected.length);
  const sourcePath = $derived(first?.path ?? null);

  $effect(() => {
    const path = sourcePath;
    if (!path) {
      probe = null;
      return;
    }
    let cancelled = false;
    loading = true;
    probeError = null;
    probe = null;
    estimate = null;
    previewUrl = null;
    api
      .probe(path)
      .then((data) => {
        if (cancelled) return;
        probe = data.probe;
        targetWidth = data.probe.video.displayWidth;
        targetHeight = data.probe.video.displayHeight;
        scalePercent = 100;
        audioBitrateKbps = [64, 96, 128, 192, 256].reduce((best, option) =>
          Math.abs(option - (data.probe.audio?.bitrateKbps ?? 128)) < Math.abs(best - (data.probe.audio?.bitrateKbps ?? 128))
            ? option
            : best,
          128,
        );
        trimStart = 0;
        trimEnd = Math.round((data.probe.durationSeconds || 0) * 10) / 10;
        rotation = 0;
        tonemap = data.probe.isHdr;
        resetCrop();
      })
      .catch((err) => {
        if (!cancelled) probeError = err instanceof Error ? err.message : 'Could not inspect this file';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const path = sourcePath;
    const currentProbe = probe;
    if (!path || !currentProbe) return;

    const options = buildOptions();

    const timer = setTimeout(async () => {
      try {
        const data = await api.estimate({ path, preset, options });
        estimate = data.estimate;
        estimateError = data.estimate.ok ? null : (data.estimate.error ?? 'This preset cannot be applied.');
      } catch (err) {
        estimate = null;
        estimateError = err instanceof Error ? err.message : 'Could not estimate the output size';
      }
    }, 240);

    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!probe) return;
    const duration = probe.durationSeconds || 0;
    if (previewStart > Math.max(0, duration - previewChip)) {
      previewStart = Math.max(0, Math.round((duration - previewChip) * 10) / 10);
    }
  });

  function changeCodec(next: string) {
    codec = next;
    if (next === 'vp9') container = 'webm';
    else if (container === 'webm') container = 'mp4';
  }

  onMount(() => {
    const onCompress = () => {
      if (!submitting) compress();
    };
    const onEscape = () => {
      showPreview = false;
    };
    window.addEventListener('plico:compress', onCompress);
    window.addEventListener('plico:escape', onEscape);
    window.addEventListener('plico:playpause', toggleSourcePlayback);
    return () => {
      window.removeEventListener('plico:compress', onCompress);
      window.removeEventListener('plico:escape', onEscape);
      window.removeEventListener('plico:playpause', toggleSourcePlayback);
    };
  });

  function syncHeightFromWidth(width: number) {
    targetWidth = width;
    if (lockAspect && probe) {
      const ratio = probe.video.displayHeight / probe.video.displayWidth;
      targetHeight = Math.max(2, Math.round((width * ratio) / 2) * 2);
    }
  }

  function syncWidthFromHeight(height: number) {
    targetHeight = height;
    if (lockAspect && probe) {
      const ratio = probe.video.displayWidth / probe.video.displayHeight;
      targetWidth = Math.max(2, Math.round((height * ratio) / 2) * 2);
    }
  }

  function applyScalePercent(percent: number) {
    scalePercent = percent;
    if (!probe) return;
    syncHeightFromWidth(Math.max(2, Math.round((probe.video.displayWidth * percent) / 100 / 2) * 2));
  }

  async function runPreview() {
    if (!probe) return;
    previewBusy = true;
    previewUrl = null;
    try {
      const data = await api.preview({
        path: probe.path,
        startSeconds: previewStart,
        durationSeconds: previewChip,
        probe,
      });
      previewUrl = data.preview.url;
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Preview failed', 'error');
    } finally {
      previewBusy = false;
    }
  }

  async function compress() {
    if (!estimate?.ok || !app.selected.length) return;
    submitting = true;
    try {
      const options = buildOptions();
      await api.addJobs(app.selected.map((entry) => ({ path: entry.path, preset, options })));
      app.notify(`Queued ${app.selected.length} file${app.selected.length > 1 ? 's' : ''}`, 'info');
      app.selected = [];
      await app.refreshJobs();
      app.view = 'queue';
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Could not start compression', 'error');
    } finally {
      submitting = false;
    }
  }

  const codecOptions = [
    { id: 'h264', label: 'H.264 · maximum compatibility' },
    { id: 'hevc', label: 'H.265 / HEVC · smaller, newer' },
    { id: 'av1', label: 'AV1 · best efficiency' },
    { id: 'vp9', label: 'VP9 · WebM output' },
  ];
</script>

{#if !first}
  <div class="empty">
    <strong>Nothing selected</strong>
    <span>Choose one or more videos in the Library to configure compression.</span>
    <button class="btn btn-primary" onclick={() => (app.view = 'library')}>Go to Library</button>
  </div>
{:else}
  <div class="split-2">
    <div class="stack">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 style="font-size:16px">{first.name}</h2>
            <span class="tiny muted">{probe?.directory ?? first.path}</span>
          </div>
          {#if selectedCount > 1}
            <span class="badge accent">+{selectedCount - 1} more in batch</span>
          {/if}
        </div>

        <div class="stack">
          <video class="source-preview" src={api.mediaUrl(first.path)} controls preload="metadata"></video>

          {#if loading}
            <div class="notice">Inspecting streams…</div>
          {:else if probeError}
            <div class="notice danger">{probeError}</div>
          {:else if probe}
            <dl class="inspector-grid">
              <div class="stat">
                <dt>Resolution</dt>
                <dd>{probe.video.displayWidth} × {probe.video.displayHeight}</dd>
              </div>
              <div class="stat">
                <dt>Duration</dt>
                <dd>{formatDuration(probe.durationSeconds)}</dd>
              </div>
              <div class="stat">
                <dt>Original size</dt>
                <dd>{formatBytes(probe.fileSizeBytes)}</dd>
              </div>
              <div class="stat">
                <dt>Video</dt>
                <dd>{probe.video.codec.toUpperCase()} · {formatBitrate(probe.video.bitrateKbps ?? probe.totalBitrateKbps)}</dd>
              </div>
              <div class="stat">
                <dt>Frame rate</dt>
                <dd>{probe.video.fps} fps</dd>
              </div>
              <div class="stat">
                <dt>Audio</dt>
                <dd>
                  {#if probe.audio}
                    {probe.audio.codec.toUpperCase()} · {probe.audio.channels} ch
                    {#if probe.audio.bitrateKbps}· {formatBitrate(probe.audio.bitrateKbps)}{/if}
                  {:else}
                    none
                  {/if}
                </dd>
              </div>
              <div class="stat">
                <dt>Rotation</dt>
                <dd>{probe.rotation}°</dd>
              </div>
              <div class="stat">
                <dt>HDR</dt>
                <dd>{probe.isHdr ? 'Yes' : 'No'}</dd>
              </div>
            </dl>

            {#if probe.alreadyOptimal.likely}
              <div class="notice warning">{probe.alreadyOptimal.reason}</div>
            {/if}
          {/if}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Quality preset</h2>
          <span class="tiny muted">Applies to {selectedCount || 1} file{selectedCount === 1 ? '' : 's'}</span>
        </div>

        <div class="preset-grid">
          {#each app.presets as option (option.id)}
            <button
              class="preset-card"
              class:active={preset === option.id}
              onclick={() => (preset = option.id)}
            >
              <span class="row between">
                <span class="title">{option.label}</span>
                <span class="badge" class:accent={preset === option.id}>{option.badge}</span>
              </span>
              <span class="desc">{option.summary}</span>
            </button>
          {/each}
        </div>

        {#if preset === 'custom_size'}
          <div class="option-grid" style="margin-top:16px">
            <label class="field">
              <span>Target size · {targetSizeMB} MB</span>
              <input
                type="range"
                min="1"
                max="200"
                step="1"
                value={targetSizeMB}
                oninput={(event) => (targetSizeMB = Number(event.currentTarget.value))}
              />
            </label>
            <label class="field">
              <span>Exact megabytes</span>
              <div class="row">
                <button class="btn btn-sm" onclick={() => (targetSizeMB = Math.max(1, targetSizeMB - 1))}>−</button>
                <input
                  class="input"
                  type="number"
                  min="1"
                  max="4096"
                  bind:value={targetSizeMB}
                  style="width:100px;text-align:center"
                />
                <button class="btn btn-sm" onclick={() => (targetSizeMB = targetSizeMB + 1)}>+</button>
              </div>
            </label>
          </div>
        {/if}

        {#if preset === 'custom_resolution'}
          <div class="option-grid" style="margin-top:16px">
            <label class="field">
              <span>Width (even, ≥ 128)</span>
              <input
                class="input"
                type="number"
                min="128"
                step="2"
                value={targetWidth}
                oninput={(event) => syncHeightFromWidth(Number(event.currentTarget.value))}
              />
            </label>
            <label class="field">
              <span>Height (even, ≥ 128)</span>
              <input
                class="input"
                type="number"
                min="128"
                step="2"
                value={targetHeight}
                oninput={(event) => syncWidthFromHeight(Number(event.currentTarget.value))}
              />
            </label>
            <div class="field">
              <span>Scale · {scalePercent}%</span>
              <input
                type="range"
                min="10"
                max="100"
                step="1"
                value={scalePercent}
                oninput={(event) => applyScalePercent(Number(event.currentTarget.value))}
              />
            </div>
            <label class="check" style="align-self:end">
              <input type="checkbox" bind:checked={lockAspect} />
              <span>
                Lock aspect ratio
                <small>Keep proportions while typing a dimension.</small>
              </span>
            </label>
          </div>
        {/if}
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Trim, crop &amp; rotation</h2>
          <span class="tiny muted">Optional edits applied before encoding</span>
        </div>

        {#if probe}
          <div class="stack" style="gap:18px">
            <div class="field">
              <span>
                Trim · keeping {formatDuration(Math.max(0, trimEnd - trimStart))} of
                {formatDuration(probe.durationSeconds)}
              </span>
              <div class="trim-row">
                <span class="tiny mono" style="min-width:44px">{formatDuration(trimStart)}</span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0.2, probe.durationSeconds - 0.2)}
                  step="0.1"
                  value={trimStart}
                  oninput={(event) => {
                    if (probe) {
                      trimStart = Math.min(Number(event.currentTarget.value), trimEnd - 0.2);
                    }
                  }}
                />
              </div>
              <div class="trim-row">
                <span class="tiny mono" style="min-width:44px">{formatDuration(trimEnd)}</span>
                <input
                  type="range"
                  min="0.2"
                  max={probe.durationSeconds}
                  step="0.1"
                  value={trimEnd}
                  oninput={(event) => (trimEnd = Math.max(Number(event.currentTarget.value), trimStart + 0.2))}
                />
              </div>
              <div class="row wrap" style="margin-top:4px">
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => {
                    trimStart = 0;
                    trimEnd = probe?.durationSeconds ?? 0;
                  }}
                >
                  Full length
                </button>
                <span class="tiny muted">{formatDuration(trimStart)} – {formatDuration(trimEnd)}</span>
              </div>
            </div>

            <div class="option-grid">
              <div class="field">
                <span>Rotation</span>
                <div class="seg">
                  {#each [0, 90, 180, 270] as angle}
                    <button class:active={rotation === angle} onclick={() => (rotation = angle)}>{angle}°</button>
                  {/each}
                </div>
              </div>

            </div>

            <div class="field">
              <div class="row between">
                <span style="font-size:12px;color:var(--muted);font-weight:540">Crop</span>
                <label class="check" style="padding:0">
                  <input type="checkbox" bind:checked={cropActive} />
                  <span class="tiny">Enable crop</span>
                </label>
              </div>

              <div
                class="crop-stage"
                bind:this={cropStageEl}
                onpointermove={(event) => {
                  if (!cropDrag || !cropStageEl) return;
                  const rect = cropStageEl.getBoundingClientRect();
                  if (!rect.width || !rect.height) return;
                  const dx = ((event.clientX - cropDrag.startX) / rect.width) * 100;
                  const dy = ((event.clientY - cropDrag.startY) / rect.height) * 100;
                  cropXp = Math.round(Math.min(100 - cropWp, Math.max(0, cropDrag.originX + dx)) * 10) / 10;
                  cropYp = Math.round(Math.min(100 - cropHp, Math.max(0, cropDrag.originY + dy)) * 10) / 10;
                }}
                onpointerup={() => (cropDrag = null)}
                onpointerleave={() => (cropDrag = null)}
              >
                <img src={api.thumbUrl(probe.path, Math.min(2, (probe.durationSeconds || 2) / 2))} alt="" />
                {#if cropActive}
                  <div
                    class="crop-box"
                    role="presentation"
                    style={`left:${cropXp}%;top:${cropYp}%;width:${cropWp}%;height:${cropHp}%`}
                    onpointerdown={(event) => {
                      cropDrag = { startX: event.clientX, startY: event.clientY, originX: cropXp, originY: cropYp };
                    }}
                  >
                    <span class="crop-grid" aria-hidden="true"></span>
                  </div>
                {/if}
              </div>

              <div class="row wrap" style="margin-top:8px">
                {#each ['free', '16:9', '9:16', '1:1', '4:5'] as aspect}
                  <button
                    class="btn btn-sm"
                    class:btn-primary={cropAspect === aspect}
                    onclick={() => applyAspect(aspect as CropAspect)}
                  >
                    {aspect === 'free' ? 'Free' : aspect}
                  </button>
                {/each}
                <button class="btn btn-ghost btn-sm" onclick={resetCrop}>Reset</button>
              </div>

              {#if cropActive}
                <div class="option-grid" style="margin-top:10px">
                  <label class="field">
                    <span>Width · {cropWp.toFixed(0)}%</span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="1"
                      value={cropWp}
                      oninput={(event) => {
                        cropWp = Number(event.currentTarget.value);
                        cropXp = Math.min(cropXp, 100 - cropWp);
                      }}
                    />
                  </label>
                  <label class="field">
                    <span>Height · {cropHp.toFixed(0)}%</span>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="1"
                      value={cropHp}
                      oninput={(event) => {
                        cropHp = Number(event.currentTarget.value);
                        cropYp = Math.min(cropYp, 100 - cropHp);
                      }}
                    />
                  </label>
                  <label class="field">
                    <span>Offset X · {cropXp.toFixed(0)}%</span>
                    <input
                      type="range"
                      min="0"
                      max={100 - cropWp}
                      step="1"
                      value={cropXp}
                      oninput={(event) => (cropXp = Number(event.currentTarget.value))}
                    />
                  </label>
                  <label class="field">
                    <span>Offset Y · {cropYp.toFixed(0)}%</span>
                    <input
                      type="range"
                      min="0"
                      max={100 - cropHp}
                      step="1"
                      value={cropYp}
                      oninput={(event) => (cropYp = Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
                <p class="tiny muted" style="margin-top:6px">
                  Output frame: {cropPixels()?.width} × {cropPixels()?.height} px before scaling.
                </p>
              {/if}
            </div>

            {#if probe.isHdr}
              <label class="check">
                <input type="checkbox" bind:checked={tonemap} />
                <span>
                  Tone map HDR to SDR
                  <small>Converts PQ/HLG sources to Rec.709 instead of washing the colours out.</small>
                </span>
              </label>
            {/if}
          </div>
        {:else}
          <div class="notice">Inspect a video to enable trimming and cropping.</div>
        {/if}
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Advanced encoding</h2>
          <span class="tiny muted">Optional — defaults are safe</span>
        </div>

        <div class="option-grid">
          <label class="field">
            <span>Video codec</span>
            <select class="select" value={codec} onchange={(event) => changeCodec(event.currentTarget.value)}>
              {#each codecOptions as option (option.id)}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
          </label>

          <label class="field">
            <span>Container</span>
            <select class="select" bind:value={container}>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="webm" disabled={codec !== 'vp9'}>WebM</option>
            </select>
          </label>

          <label class="field">
            <span>Audio bitrate</span>
            <select class="select" bind:value={audioBitrateKbps} disabled={removeAudio || !probe?.audio}>
              <option value={64}>64 kbps</option>
              <option value={96}>96 kbps</option>
              <option value={128}>128 kbps</option>
              <option value={192}>192 kbps</option>
              <option value={256}>256 kbps</option>
            </select>
          </label>

          <div class="field">
            <span>Audio volume · {volume}%</span>
            <input
              type="range"
              min="0"
              max="300"
              step="5"
              value={volume}
              disabled={removeAudio || !probe?.audio}
              oninput={(event) => (volume = Number(event.currentTarget.value))}
            />
          </div>

          <div class="field" style="justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" onclick={() => (volume = 100)} disabled={removeAudio}>
              Reset volume to 100%
            </button>
          </div>
        </div>

        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:8px">
          <label class="check">
            <input type="checkbox" bind:checked={removeAudio} disabled={!probe?.audio} />
            <span>
              Remove audio track
              <small>Strips every audio stream for the smallest file.</small>
            </span>
          </label>

          <label class="check">
            <input type="checkbox" bind:checked={copyMetadata} />
            <span>
              Copy metadata
              <small>Keeps creation date, camera tags and rotation info.</small>
            </span>
          </label>

          <label class="check">
            <input type="checkbox" bind:checked={hardware} disabled={!app.engine?.hardwareAcceleration} />
            <span>
              Hardware acceleration
              <small>
                {app.engine?.hardwareAcceleration
                  ? 'Use the GPU encoder when one is detected.'
                  : 'No hardware encoder was detected on this machine.'}
              </small>
            </span>
          </label>
        </div>
      </div>
    </div>

    <div class="stack" style="position:sticky;top:88px">
      <div class="card">
        <div class="card-header">
          <h2>Estimated output</h2>
          {#if estimate?.ok}
            <span class="badge" class:success={estimate.reductionPercent > 0} class:warning={estimate.reductionPercent <= 0}>
              {estimate.reductionPercent > 0 ? '−' : '+'}{Math.abs(estimate.reductionPercent)}%
            </span>
          {/if}
        </div>

        {#if estimateError}
          <div class="notice danger">{estimateError}</div>
        {:else if !estimate}
          <div class="notice">Calculating…</div>
        {:else if estimate.ok}
          <div class="stack" style="gap:10px">
            <div class="row between">
              <span class="muted tiny">New size</span>
              <span style="font-size:20px;font-weight:700">{formatBytes(estimate.outputSizeBytes)}</span>
            </div>
            <div class="row between tiny muted">
              <span>Original</span>
              <span>{formatBytes(estimate.originalSizeBytes)}</span>
            </div>
            <div class="row between tiny muted">
              <span>Output</span>
              <span>{estimate.width} × {estimate.height} · {estimate.codecLabel}</span>
            </div>
            <div class="row between tiny muted">
              <span>Video bitrate</span>
              <span>
                {formatBitrate(estimate.videoBitrateKbps)}
                {#if estimate.mode === 'bitrate'}· capped{:else}· CRF{/if}
              </span>
            </div>
            <div class="row between tiny muted">
              <span>Audio</span>
              <span>{estimate.audioBitrateKbps ? formatBitrate(estimate.audioBitrateKbps) : 'removed'}</span>
            </div>

            {#each estimate.warnings as warning}
              <div class="notice warning">{warning}</div>
            {/each}
          </div>
        {/if}

        <div class="stack" style="margin-top:16px;gap:9px">
          <button class="btn btn-primary btn-block" onclick={compress} disabled={!estimate?.ok || submitting}>
            {submitting ? 'Starting…' : `Compress ${selectedCount || 1} video${selectedCount === 1 ? '' : 's'}`}
          </button>
          <button class="btn btn-block" onclick={() => (showPreview = true)} disabled={!probe}>
            Fast preview
          </button>
        </div>

        <p class="tiny muted" style="margin-top:12px">
          Files are read and written on this machine. The already-optimal guard keeps your original when an encode
          would be larger.
        </p>
      </div>

      {#if app.engine?.ok}
        <div class="card tight">
          <div class="tiny muted" style="margin-bottom:8px">Engine</div>
          <div class="tiny mono" style="line-height:1.7">
            <div>ffmpeg {app.engine.version?.split(' ')[0]}</div>
            <div>h264: {app.engine.softwareEncoders.h264 ?? 'n/a'}</div>
            <div>hevc: {app.engine.softwareEncoders.hevc ?? 'n/a'}</div>
            <div>av1: {app.engine.softwareEncoders.av1 ?? 'n/a'}</div>
            <div>vp9: {app.engine.softwareEncoders.vp9 ?? 'n/a'}</div>
            {#if app.engine.hardwareAcceleration}
              <div style="color:var(--success)">hardware: available</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showPreview}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showPreview = false;
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="Fast preview">
      <div class="modal-head">
        <div>
          <h2>Fast preview</h2>
          <span class="tiny muted">Renders a short slice with the ultrafast preset so you can judge quality.</span>
        </div>
        <button class="btn btn-ghost btn-sm" onclick={() => (showPreview = false)}>Close</button>
      </div>

      <div class="stack">
        <div class="row wrap">
          {#each [5, 10, 15, 30] as chip}
            <button
              class="btn btn-sm"
              class:btn-primary={previewChip === chip}
              onclick={() => {
                previewChip = chip;
                previewUrl = null;
              }}
            >
              {chip}s
            </button>
          {/each}
          {#if probe && probe.durationSeconds > 0}
            <span class="tiny muted">from {previewStart.toFixed(1)}s</span>
          {/if}
        </div>

        {#if probe && probe.durationSeconds > previewChip}
          <label class="field">
            <span>Sample start</span>
            <input
              type="range"
              min="0"
              max={Math.max(0, probe.durationSeconds - previewChip)}
              step="0.5"
              value={previewStart}
              oninput={(event) => {
                previewStart = Number(event.currentTarget.value);
                previewUrl = null;
              }}
            />
          </label>
        {/if}

        {#if previewUrl}
          <video src={previewUrl} controls autoplay style="width:100%;border-radius:10px;border:1px solid var(--border)"></video>
        {:else}
          <div class="empty" style="padding:28px 16px">
            <strong>{previewBusy ? 'Rendering sample…' : 'No preview yet'}</strong>
            <span>Short clips are generated in a few seconds.</span>
          </div>
        {/if}

        <button class="btn btn-primary" onclick={runPreview} disabled={previewBusy || !probe}>
          {previewBusy ? 'Rendering…' : 'Generate preview'}
        </button>

        <p class="tiny muted">
          The preview uses the source resolution with ultrafast settings, so the real encode will look equal or better
          and take longer to finish.
        </p>
      </div>
    </div>
  </div>
{/if}
