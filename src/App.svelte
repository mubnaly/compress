<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state.svelte';
  import type { View } from './lib/state.svelte';
  import { api, getEngineUrl, setEngineUrl } from './lib/api';
  import type { BrowseEntry } from './lib/api';
  import Library from './views/Library.svelte';
  import Details from './views/Details.svelte';
  import QueueView from './views/Queue.svelte';
  import Compare from './views/Compare.svelte';
  import History from './views/History.svelte';
  import SettingsView from './views/Settings.svelte';
  import AiStudio from './views/AiStudio.svelte';

  let remoteEngineInput = $state(getEngineUrl());

  function connectRemoteEngine() {
    setEngineUrl(remoteEngineInput);
    app.notify('Engine URL updated. Reconnecting...', 'info');
    window.location.reload();
  }

  const nav: { id: View; label: string; icon: string }[] = [
    { id: 'library', label: 'Library', icon: '▤' },
    { id: 'configure', label: 'Configure', icon: '⚙' },
    { id: 'ai', label: 'AI Studio', icon: '✨' },
    { id: 'queue', label: 'Queue', icon: '⇣' },
    { id: 'history', label: 'History', icon: '◷' },
    { id: 'settings', label: 'Settings', icon: '≡' },
  ];

  const titles: Record<View, { title: string; sub: string }> = {
    library: { title: 'Library', sub: 'Pick videos from this machine — nothing is uploaded.' },
    configure: { title: 'Configure', sub: 'Choose quality, size targets and audio handling.' },
    ai: { title: 'AI Studio (ستوديو الذكاء الاصطناعي)', sub: 'Auto-Captions, Silence Removal, Viral Reels & Dynamic SFX.' },
    queue: { title: 'Queue', sub: 'Watch encodes progress and inspect the results.' },
    compare: { title: 'Compare', sub: 'Inspect compression artifacts frame by frame.' },
    history: { title: 'History', sub: 'Everything you have compressed locally.' },
    settings: { title: 'Settings', sub: 'Output, safety guard and engine preferences.' },
  };

  let bootTimer: ReturnType<typeof setInterval> | undefined;

  function handleShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    const modifier = event.ctrlKey || event.metaKey;

    if (modifier && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      app.view = 'library';
      setTimeout(() => document.querySelector<HTMLInputElement>('.pathbar .input')?.focus(), 60);
      return;
    }
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('plico:compress'));
      return;
    }
    if (event.key === 'Escape') {
      window.dispatchEvent(new CustomEvent('plico:escape'));
      return;
    }
    if (event.key === ' ' && !typing) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('plico:playpause'));
    }
  }

  onMount(() => {
    (async () => {
      // Auto-detect local engine if running on GitHub Pages / remote web host
      if (
        !getEngineUrl() &&
        typeof window !== 'undefined' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
      ) {
        try {
          const probe = await fetch('http://127.0.0.1:7317/api/health', { signal: AbortSignal.timeout(1200) });
          if (probe.ok) {
            setEngineUrl('http://127.0.0.1:7317');
            remoteEngineInput = 'http://127.0.0.1:7317';
          }
        } catch {
          // Local engine not running
        }
      }

      try {
        const health = await api.health();
        app.engine = health.engine;
        app.presets = health.presets;
        app.settings = health.settings;
        app.roots = health.roots;
        app.jobs = health.queue;
        app.applyTheme(health.settings.theme);
        if (!health.engine.ok) app.bootError = health.engine.error ?? 'FFmpeg is not available on this machine.';
        else app.bootError = null;
      } catch (err) {
        app.presets = [
          { id: 'optimal', label: 'Optimal quality', badge: 'Recommended', summary: 'CRF rate control at native resolution.' },
          { id: 'medium', label: 'Medium quality', badge: 'Balanced', summary: 'Downscales to 720p for a large size cut.' },
          { id: 'small', label: 'Small size', badge: 'Max savings', summary: 'Downscales to 480p with constrained bitrate.' },
          { id: 'whatsapp', label: 'WhatsApp', badge: '16 MB cap', summary: 'Fits a 16 MB chat attachment.' },
          { id: 'gmail', label: 'Gmail', badge: '25 MB cap', summary: 'Fits a 25 MB email attachment.' },
        ];
        app.settings = {
          outputDirectory: '',
          namingPattern: '{name}_compressed.{ext}',
          allowSizeIncrease: false,
          concurrency: 2,
          defaultCodec: 'h264',
          defaultPreset: 'medium',
          hardwareAcceleration: true,
          theme: 'dark',
        };
        app.bootError = 'offline';
      }
    })();

    bootTimer = setInterval(() => app.refreshJobs(), 900);
    window.addEventListener('keydown', handleShortcut);

    // Desktop heartbeat and clean shutdown on window close
    const pingHeartbeat = () => {
      fetch('/api/heartbeat').catch(() => {});
    };
    pingHeartbeat();
    const heartbeatTimer = setInterval(pingHeartbeat, 3000);

    const onBeforeUnload = () => {
      try {
        navigator.sendBeacon('/api/shutdown');
      } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      if (bootTimer) clearInterval(bootTimer);
      clearInterval(heartbeatTimer);
      window.removeEventListener('keydown', handleShortcut);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });

  $effect(() => {
    if (app.settings) app.applyTheme(app.settings.theme);
  });

  function go(view: View) {
    app.view = view;
  }
</script>

<svelte:head>
  <title>{titles[app.view].title} · Rasheeq | رَشيق</title>
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <img src="/logo.png" alt="Rasheeq Logo" class="brand-logo" style="width:36px;height:36px;border-radius:8px;object-fit:cover" />
      <div>
        <div class="brand-name">Rasheeq <span style="font-size:12px;opacity:0.8">رَشيق</span></div>
        <div class="brand-sub">Offline compressor</div>
      </div>
    </div>

    <nav class="nav" aria-label="Main">
      <div class="nav-label">Workspace</div>
      {#each nav as item (item.id)}
        <button
          class="nav-item"
          class:active={app.view === item.id || (item.id === 'queue' && app.view === 'compare')}
          onclick={() => go(item.id)}
        >
          <span class="nav-icon">{item.icon}</span>
          {item.label}
          {#if item.id === 'queue' && app.busyJobs.length > 0}
            <span class="nav-badge">{app.busyJobs.length}</span>
          {/if}
          {#if item.id === 'configure' && app.selected.length > 0}
            <span class="nav-badge">{app.selected.length}</span>
          {/if}
        </button>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <div>
        <span class="dot" class:off={!app.engine?.ok}></span>
        {#if app.engine?.ok}
          FFmpeg {app.engine.version?.split(' ')[0] ?? 'ready'}
        {:else}
          Engine offline
        {/if}
      </div>
      <div>100% local · no uploads</div>
      <div>No ads · no telemetry</div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="topbar-title">
        <h1>{titles[app.view].title}</h1>
        <span class="tiny muted">{titles[app.view].sub}</span>
      </div>
      <div class="row" style="margin-left:auto">
        {#if app.busyJobs.length > 0}
          <span class="badge accent">{app.busyJobs.length} encoding</span>
        {/if}
        {#if app.selected.length > 0}
          <span class="badge">{app.selected.length} selected</span>
        {/if}
      </div>
    </header>

    <section class="view">
      {#if app.bootError}
        <div class="notice" style="margin-bottom:16px;background:var(--panel-2);border-color:var(--accent);display:flex;flex-direction:column;gap:8px">
          <div class="row between wrap">
            <span style="font-weight:600;display:flex;align-items:center;gap:6px">
              🌐 Web Preview Mode (Engine Not Connected)
            </span>
            <div class="row wrap" style="gap:8px">
              <a
                class="btn btn-sm btn-primary"
                href="https://github.com/mubnaly/rasheeq/releases/latest"
                target="_blank"
                rel="noreferrer"
              >
                💻 Download Windows (.exe)
              </a>
              <a
                class="btn btn-sm btn-primary"
                href="https://github.com/mubnaly/rasheeq/releases/latest"
                target="_blank"
                rel="noreferrer"
              >
                📱 Download Android (.apk)
              </a>
              <button class="btn btn-sm btn-ghost" onclick={() => (app.view = 'settings')}>
                ⚙ Engine Settings
              </button>
            </div>
          </div>
          <p class="tiny muted" style="margin:0;line-height:1.5">
            You are browsing the static web interface on GitHub Pages. To encode videos or download YouTube streams:
            run the backend locally with <span class="mono">docker run -d -p 7317:7317 ghcr.io/mubnaly/rasheeq</span>, or connect below:
          </p>
          <div class="row wrap" style="gap:8px">
            <input
              class="input mono"
              style="max-width:320px;height:32px;font-size:12px;padding:4px 10px"
              placeholder="e.g. http://localhost:7317"
              bind:value={remoteEngineInput}
            />
            <button class="btn btn-sm btn-primary" onclick={connectRemoteEngine}>
              Connect Engine
            </button>
          </div>
        </div>
      {/if}

      {#if app.view === 'library'}
        <Library />
      {:else if app.view === 'configure'}
        <Details />
      {:else if app.view === 'ai'}
        <AiStudio />
      {:else if app.view === 'queue'}
        <QueueView />
      {:else if app.view === 'compare'}
        <Compare />
      {:else if app.view === 'history'}
        <History />
      {:else if app.view === 'settings'}
        <SettingsView />
      {/if}
    </section>
  </div>
</div>

{#if app.toast}
  <div class="toast" class:error={app.toast.kind === 'error'}>{app.toast.message}</div>
{/if}
