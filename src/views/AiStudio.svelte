<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/state.svelte';
  import { api } from '../lib/api';
  import type { ViralReel, SoundEffect, BrowseEntry } from '../lib/api';
  import { formatBytes, formatDuration } from '../lib/format';

  let activeTab = $state<'silence' | 'reels' | 'captions' | 'montage'>('silence');

  // Selected video
  let videoPath = $state<string>(app.selected[0]?.path || '');
  let videoName = $state<string>(app.selected[0]?.name || '');

  // Global loading & status
  let loading = $state(false);
  let loadingMsg = $state('');

  // Silence Removal state
  let noiseThreshold = $state(-30);
  let minDuration = $state(0.35);
  let silenceResult = $state<{
    silencesDetected: number;
    speechChunksCount: number;
    timeSavedSeconds: number;
    newDurationSeconds: number;
    outputPath: string;
    message?: string;
  } | null>(null);

  // Viral Reels state
  let viralReels = $state<ViralReel[]>([]);
  let exportingReelId = $state<string | null>(null);
  let exportedReels = $state<{ id: string; title: string; path: string; duration: number }[]>([]);

  // Captions state
  let srtContent = $state('');
  let srtPath = $state('');
  let subtitledVideoPath = $state('');

  // Smart Montage state
  let montageResult = $state<{ outputPath: string; effectsApplied: number; markers: any[] } | null>(null);
  let localSounds = $state<SoundEffect[]>([]);
  let soundDownloadUrl = $state('');
  let soundDownloadName = $state('');
  let downloadingSound = $state(false);

  onMount(async () => {
    if (!videoPath && app.selected.length > 0) {
      videoPath = app.selected[0].path;
      videoName = app.selected[0].name;
    }
    loadSounds();
  });

  async function loadSounds() {
    try {
      const res = await api.aiSounds();
      if (res.ok) localSounds = res.sounds || [];
    } catch {
      // offline or engine offline
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      loading = true;
      loadingMsg = 'Importing selected video...';
      api.upload(file)
        .then((res) => {
          videoPath = res.file.path;
          videoName = res.file.name;
          app.notify(`Loaded ${res.file.name}`, 'info');
        })
        .catch((err) => {
          app.notify(err instanceof Error ? err.message : 'Failed to load video', 'error');
        })
        .finally(() => {
          loading = false;
        });
    }
  }

  // --- ACTIONS ---

  async function runSilenceRemoval() {
    if (!videoPath) return app.notify('Please select or drop a video first', 'error');
    loading = true;
    loadingMsg = 'Analyzing audio waveform and cutting out silence…';
    silenceResult = null;
    try {
      const res = await api.aiRemoveSilence(videoPath, noiseThreshold, minDuration);
      silenceResult = res;
      app.notify(`Silence removed! Saved ${res.timeSavedSeconds}s of dead air.`, 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Silence removal failed', 'error');
    } finally {
      loading = false;
    }
  }

  async function runViralReelsDiscovery() {
    if (!videoPath) return app.notify('Please select or drop a video first', 'error');
    loading = true;
    loadingMsg = 'AI is analyzing transcript & finding highest-retention viral moments…';
    viralReels = [];
    try {
      const res = await api.aiViralReels(videoPath);
      viralReels = res.reels || [];
      if (app.settings) {
        app.settings.aiTokensUsed = (app.settings.aiTokensUsed || 0) + (res.tokens || 0);
      }
      app.notify(`Discovered ${viralReels.length} viral reel opportunities!`, 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Viral reels analysis failed', 'error');
    } finally {
      loading = false;
    }
  }

  async function exportReel(reel: ViralReel) {
    if (!videoPath) return;
    exportingReelId = reel.id;
    try {
      const res = await api.aiExportReel({
        path: videoPath,
        start: reel.start,
        end: reel.end,
        title: reel.title,
        aspect: '9:16',
      });
      exportedReels = [
        { id: reel.id, title: reel.title, path: res.outputPath, duration: res.duration },
        ...exportedReels,
      ];
      app.notify(`Reel "${reel.title}" exported in 9:16!`, 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Reel export failed', 'error');
    } finally {
      exportingReelId = null;
    }
  }

  async function runTranscription() {
    if (!videoPath) return app.notify('Please select or drop a video first', 'error');
    loading = true;
    loadingMsg = 'Transcribing speech & aligning timestamps with Gemini…';
    srtContent = '';
    subtitledVideoPath = '';
    try {
      const res = await api.aiTranscribe(videoPath);
      srtContent = res.srt;
      srtPath = res.srtPath;
      if (app.settings) {
        app.settings.aiTokensUsed = (app.settings.aiTokensUsed || 0) + (res.tokens || 0);
      }
      app.notify('Subtitles generated successfully!', 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Transcription failed', 'error');
    } finally {
      loading = false;
    }
  }

  async function burnSubtitles() {
    if (!videoPath || !srtPath) return app.notify('Generate subtitles first', 'error');
    loading = true;
    loadingMsg = 'Burning styled captions into video…';
    try {
      const res = await api.aiBurnSubtitles(videoPath, srtPath);
      subtitledVideoPath = res.outputPath;
      app.notify('Captions burned into video!', 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Burning failed', 'error');
    } finally {
      loading = false;
    }
  }

  async function runSmartMontage() {
    if (!videoPath) return app.notify('Please select or drop a video first', 'error');
    loading = true;
    loadingMsg = 'Analyzing speaker delivery & adding dynamic zooms and SFX…';
    montageResult = null;
    try {
      const res = await api.aiSmartMontage(videoPath);
      montageResult = res;
      app.notify(`Montage complete! ${res.effectsApplied} effects synchronized.`, 'info');
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Montage failed', 'error');
    } finally {
      loading = false;
    }
  }

  async function downloadSound() {
    if (!soundDownloadUrl.trim()) return;
    downloadingSound = true;
    try {
      const res = await api.aiDownloadSound(soundDownloadUrl.trim(), soundDownloadName.trim());
      if (res.ok) {
        app.notify(`Sound "${res.sound.name}" cached offline!`, 'info');
        soundDownloadUrl = '';
        soundDownloadName = '';
        await loadSounds();
      }
    } catch (err) {
      app.notify(err instanceof Error ? err.message : 'Download failed', 'error');
    } finally {
      downloadingSound = false;
    }
  }

  function downloadSrtFile() {
    if (!srtContent) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${videoName || 'video'}_subtitles.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function revealFile(path: string) {
    fetch('/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {});
  }
</script>

<div class="page-head">
  <div>
    <h2>✨ AI Studio · ستوديو الذكاء الاصطناعي</h2>
    <p>Smart video editing powered by Google Gemini: Auto-Captions, Silence Removal, Viral Reels & Dynamic SFX.</p>
  </div>
  <div class="row align-center" style="gap:10px">
    <div class="card" style="padding:6px 14px; background:rgba(139, 92, 246, 0.15); border:1px solid rgba(139, 92, 246, 0.3); border-radius:20px;">
      <span class="tiny muted">AI Usage: </span>
      <strong style="color:#a78bfa">{(app.settings?.aiTokensUsed || 0).toLocaleString()}</strong>
      <span class="tiny muted"> tokens</span>
    </div>
  </div>
</div>

<!-- Video Selector Card -->
<div class="card" style="margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.1)">
  <div class="row between align-center wrap" style="gap:12px">
    <div class="row align-center" style="gap:12px; flex:1; min-width:280px">
      <span style="font-size:1.8rem">🎬</span>
      <div style="flex:1; overflow:hidden">
        {#if videoPath}
          <div class="row align-center" style="gap:8px">
            <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">{videoName || videoPath}</strong>
            <span class="badge success">Active</span>
          </div>
          <span class="tiny muted mono" style="display:block; overflow:hidden; text-overflow:ellipsis">{videoPath}</span>
        {:else}
          <strong>No video selected</strong>
          <span class="tiny muted" style="display:block">Choose a video from your computer or pick one from the Library</span>
        {/if}
      </div>
    </div>
    <div class="row" style="gap:8px">
      <label class="btn btn-sm btn-primary" style="cursor:pointer; margin:0">
        📁 Choose Video File…
        <input type="file" accept="video/*" onchange={handleFileSelect} style="display:none" />
      </label>
      <button class="btn btn-sm btn-ghost" onclick={() => app.view = 'library'}>
        Browse Library
      </button>
    </div>
  </div>
</div>

<!-- Tabs Navigation -->
<div class="tabs-nav row wrap" style="gap:8px; margin-bottom:20px">
  <button
    class="btn {activeTab === 'silence' ? 'btn-primary' : 'btn-ghost'}"
    onclick={() => activeTab = 'silence'}
  >
    ⚡ Remove Silence (حذف السكتات)
  </button>
  <button
    class="btn {activeTab === 'reels' ? 'btn-primary' : 'btn-ghost'}"
    onclick={() => activeTab = 'reels'}
  >
    🔥 Viral Reels (قص ريلز فيروسية)
  </button>
  <button
    class="btn {activeTab === 'captions' ? 'btn-primary' : 'btn-ghost'}"
    onclick={() => activeTab = 'captions'}
  >
    💬 Auto Captions (الكابشنز والترجمة)
  </button>
  <button
    class="btn {activeTab === 'montage' ? 'btn-primary' : 'btn-ghost'}"
    onclick={() => activeTab = 'montage'}
  >
    🎬 Smart Montage & SFX (مونتاج ومؤثرات)
  </button>
</div>

{#if loading}
  <div class="card stack align-center" style="padding:40px; text-align:center; gap:16px">
    <div class="spinner" style="width:36px; height:36px; border:3px solid rgba(139,92,246,0.2); border-top-color:#a78bfa; border-radius:50%; animation:spin 0.8s linear infinite"></div>
    <strong>{loadingMsg}</strong>
    <span class="tiny muted">Processing locally with high performance...</span>
  </div>
{:else}

  <!-- TAB 1: SILENCE REMOVAL -->
  {#if activeTab === 'silence'}
    <div class="card stack" style="gap:18px">
      <div class="card-header">
        <div>
          <h3>⚡ Silence & Pause Removal · حذف الوقفات والسكتات</h3>
          <p class="tiny muted">Automatically detects dead air, speech pauses, and hesitations and concats active speech chunks seamlessly for fast-paced video.</p>
        </div>
      </div>

      <div class="row wrap" style="gap:20px; align-items:flex-end">
        <label class="field" style="flex:1; min-width:200px">
          <span>Noise Threshold (dB)</span>
          <input class="input" type="number" bind:value={noiseThreshold} min="-50" max="-10" step="1" />
          <span class="tiny muted">Audio below this volume is considered silence (Default: -30dB)</span>
        </label>
        <label class="field" style="flex:1; min-width:200px">
          <span>Min Silence Duration (seconds)</span>
          <input class="input" type="number" bind:value={minDuration} min="0.1" max="2.0" step="0.05" />
          <span class="tiny muted">Pauses longer than this will be cut out (Default: 0.35s)</span>
        </label>
        <button class="btn btn-primary" onclick={runSilenceRemoval} disabled={!videoPath}>
          ⚡ Remove Silence Now
        </button>
      </div>

      {#if silenceResult}
        <div class="card" style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); padding: 18px; margin-top:10px">
          <div class="row between align-center wrap" style="gap:12px">
            <div>
              <strong style="color: #4ade80; font-size: 1.15rem">✅ Silence Successfully Removed!</strong>
              <div class="row wrap" style="gap:16px; margin-top:8px">
                <div>Detected Pauses: <strong>{silenceResult.silencesDetected}</strong></div>
                <div>Time Saved: <strong style="color:#4ade80">{silenceResult.timeSavedSeconds}s</strong></div>
                <div>New Duration: <strong>{silenceResult.newDurationSeconds}s</strong></div>
              </div>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-sm" onclick={() => revealFile(silenceResult?.outputPath || '')}>
                📁 Show in Folder
              </button>
              <a class="btn btn-sm btn-primary" href={api.mediaUrl(silenceResult.outputPath)} target="_blank">
                ▶️ Play Video
              </a>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- TAB 2: VIRAL REELS -->
  {#if activeTab === 'reels'}
    <div class="card stack" style="gap:18px">
      <div class="card-header">
        <div>
          <h3>🔥 Viral Reels & Shorts Cutter · قص ريلز فيروسية تلقائياً</h3>
          <p class="tiny muted">Gemini analyzes your full video speech, detects high-retention hooks and viral punchlines, and cuts them into ready-to-post 9:16 vertical videos.</p>
        </div>
        <button class="btn btn-primary" onclick={runViralReelsDiscovery} disabled={!videoPath}>
          🔍 Detect Viral Reels with AI
        </button>
      </div>

      {#if viralReels.length === 0}
        <div class="empty-notice stack align-center" style="padding:40px; text-align:center">
          <span style="font-size:2.5rem">✨</span>
          <strong>No viral reels analyzed yet</strong>
          <p class="tiny muted">Click "Detect Viral Reels with AI" above to extract the most engaging moments.</p>
        </div>
      {:else}
        <div class="grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px">
          {#each viralReels as reel}
            <div class="card stack" style="border: 1px solid rgba(139, 92, 246, 0.3); background: rgba(30, 41, 59, 0.5); justify-content:space-between">
              <div class="stack" style="gap:10px">
                <div class="row between align-center">
                  <span class="badge" style="background:#8b5cf6; color:white">🔥 {reel.viralityScore}% Virality</span>
                  <span class="tiny mono muted">{formatDuration(reel.start)} → {formatDuration(reel.end)}</span>
                </div>
                <strong style="font-size:1.1rem; line-height:1.4">{reel.title}</strong>
                <p class="tiny" style="color:#e2e8f0; font-style:italic">"{reel.hook}"</p>
                <p class="tiny muted">{reel.reason}</p>
              </div>

              <div style="margin-top:14px">
                <button
                  class="btn btn-sm btn-primary"
                  style="width:100%"
                  onclick={() => exportReel(reel)}
                  disabled={exportingReelId === reel.id}
                >
                  {exportingReelId === reel.id ? 'Exporting 9:16 Reel…' : '✂️ Export 9:16 Reel'}
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      {#if exportedReels.length > 0}
        <div class="card stack" style="margin-top:20px; background: rgba(15, 23, 42, 0.6)">
          <h4>Exported Viral Reels</h4>
          <div class="stack" style="gap:8px">
            {#each exportedReels as exp}
              <div class="row between align-center" style="padding:8px 12px; background: rgba(255,255,255,0.04); border-radius:6px">
                <div>
                  <strong>{exp.title}</strong>
                  <span class="tiny muted" style="margin-left:8px">({exp.duration.toFixed(1)}s)</span>
                </div>
                <div class="row" style="gap:8px">
                  <button class="btn btn-xs" onclick={() => revealFile(exp.path)}>Folder</button>
                  <a class="btn btn-xs btn-primary" href={api.mediaUrl(exp.path)} target="_blank">Play 9:16</a>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- TAB 3: AUTO CAPTIONS -->
  {#if activeTab === 'captions'}
    <div class="card stack" style="gap:18px">
      <div class="card-header">
        <div>
          <h3>💬 AI Auto-Captions · الترجمة والكابشنز التلقائية</h3>
          <p class="tiny muted">Generates timed subtitles using Gemini, exports standard .SRT files, or burns high-visibility captions directly onto the video.</p>
        </div>
        <button class="btn btn-primary" onclick={runTranscription} disabled={!videoPath}>
          🎙️ Transcribe & Generate Subtitles
        </button>
      </div>

      {#if srtContent}
        <div class="stack" style="gap:12px">
          <div class="row between align-center">
            <strong>SubRip (SRT) Preview:</strong>
            <div class="row" style="gap:8px">
              <button class="btn btn-sm btn-ghost" onclick={downloadSrtFile}>
                ⬇️ Download .SRT
              </button>
              <button class="btn btn-sm btn-primary" onclick={burnSubtitles}>
                🔥 Burn Subtitles into Video
              </button>
            </div>
          </div>
          <textarea
            class="input mono"
            rows="10"
            bind:value={srtContent}
            style="line-height:1.5; font-size:0.85rem; background:rgba(0,0,0,0.4)"
          ></textarea>
        </div>
      {:else}
        <div class="empty-notice stack align-center" style="padding:40px; text-align:center">
          <span style="font-size:2.5rem">💬</span>
          <strong>No subtitles generated yet</strong>
          <p class="tiny muted">Click "Transcribe & Generate Subtitles" to produce synchronized captions.</p>
        </div>
      {/if}

      {#if subtitledVideoPath}
        <div class="card" style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); padding: 14px">
          <div class="row between align-center">
            <div>
              <strong style="color:#4ade80">✅ Captions Burned Successfully!</strong>
              <span class="tiny muted mono" style="display:block">{subtitledVideoPath}</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-sm" onclick={() => revealFile(subtitledVideoPath)}>Folder</button>
              <a class="btn btn-sm btn-primary" href={api.mediaUrl(subtitledVideoPath)} target="_blank">Play Subtitled Video</a>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- TAB 4: SMART MONTAGE & SFX -->
  {#if activeTab === 'montage'}
    <div class="card stack" style="gap:18px">
      <div class="card-header">
        <div>
          <h3>🎬 Smart Montage & Sound Effects · مونتاج ذكي ومؤثرات صوتية</h3>
          <p class="tiny muted">Syncs dynamic camera punches (zooms) and royalty-free sound effects (whoosh, pop, ding, chime) to punchy speaker words.</p>
        </div>
        <button class="btn btn-primary" onclick={runSmartMontage} disabled={!videoPath}>
          🪄 Apply Smart Montage
        </button>
      </div>

      {#if montageResult}
        <div class="card" style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); padding: 14px">
          <div class="row between align-center">
            <div>
              <strong style="color:#4ade80">✅ Smart Montage Applied!</strong>
              <span class="tiny muted" style="display:block">{montageResult.effectsApplied} synchronized sound & camera zoom effects added.</span>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn-sm" onclick={() => revealFile(montageResult?.outputPath || '')}>Folder</button>
              <a class="btn btn-sm btn-primary" href={api.mediaUrl(montageResult.outputPath)} target="_blank">Play Video</a>
            </div>
          </div>
        </div>
      {/if}

      <!-- Offline Sound Library Manager -->
      <div class="card stack" style="gap:14px; background: rgba(15, 23, 42, 0.5)">
        <div class="card-header">
          <h4>🔊 Offline Sound Effects Library (المكتبة الصوتية المحفوظة محلياً)</h4>
          <span class="tiny muted">All sounds are cached locally on your device for fast offline reuse.</span>
        </div>

        <div class="row wrap" style="gap:8px">
          {#each localSounds as sound}
            <div class="card" style="padding:8px 14px; background: rgba(255,255,255,0.05); border-radius:20px">
              <span class="tiny">🎵 <strong>{sound.name}</strong> ({sound.file})</span>
            </div>
          {/each}
        </div>

        <div class="stack" style="margin-top:10px; gap:8px">
          <span class="tiny muted">Download free sound effect from online URL to cache offline:</span>
          <div class="row wrap" style="gap:8px">
            <input
              class="input"
              style="flex:2; min-width:220px"
              placeholder="e.g. https://cdn.freesound.org/previews/.../sound.mp3"
              bind:value={soundDownloadUrl}
            />
            <input
              class="input"
              style="flex:1; min-width:140px"
              placeholder="Sound Name (e.g. riser)"
              bind:value={soundDownloadName}
            />
            <button class="btn btn-sm btn-ghost" onclick={downloadSound} disabled={downloadingSound || !soundDownloadUrl}>
              {downloadingSound ? 'Downloading…' : '⬇️ Save Offline'}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

{/if}

<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
