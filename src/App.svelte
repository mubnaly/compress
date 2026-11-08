<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/state.svelte';
  import type { View } from './lib/state.svelte';
  import { api } from './lib/api';
  import type { BrowseEntry } from './lib/api';
  import Library from './views/Library.svelte';
  import Details from './views/Details.svelte';
  import QueueView from './views/Queue.svelte';
  import Compare from './views/Compare.svelte';
  import History from './views/History.svelte';
  import SettingsView from './views/Settings.svelte';

  const nav: { id: View; label: string; icon: string }[] = [
    { id: 'library', label: 'Library', icon: '▤' },
    { id: 'configure', label: 'Configure', icon: '⚙' },
    { id: 'queue', label: 'Queue', icon: '⇣' },
    { id: 'history', label: 'History', icon: '◷' },
    { id: 'settings', label: 'Settings', icon: '≡' },
  ];

  const titles: Record<View, { title: string; sub: string }> = {
    library: { title: 'Library', sub: 'Pick videos from this machine — nothing is uploaded.' },
    configure: { title: 'Configure', sub: 'Choose quality, size targets and audio handling.' },
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
      try {
        const health = await api.health();
        app.engine = health.engine;
        app.presets = health.presets;
        app.settings = health.settings;
        app.roots = health.roots;
        app.jobs = health.queue;
        app.applyTheme(health.settings.theme);
        if (!health.engine.ok) app.bootError = health.engine.error ?? 'FFmpeg is not available on this machine.';
      } catch (err) {
        app.bootError = err instanceof Error ? err.message : 'Could not reach the local engine.';
      }
    })();

    bootTimer = setInterval(() => app.refreshJobs(), 900);
    window.addEventListener('keydown', handleShortcut);

    return () => {
      if (bootTimer) clearInterval(bootTimer);
      window.removeEventListener('keydown', handleShortcut);
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
  <title>{titles[app.view].title} · Plico</title>
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">P</div>
      <div>
        <div class="brand-name">Plico</div>
        <div class="brand-sub">Local compressor</div>
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
        <div class="notice danger" style="margin-bottom:16px">
          {app.bootError}
          <div class="tiny" style="margin-top:6px">
            Install FFmpeg and make sure <span class="mono">ffmpeg</span> and <span class="mono">ffprobe</span> are on
            PATH, then reload this page.
          </div>
        </div>
      {/if}

      {#if app.view === 'library'}
        <Library />
      {:else if app.view === 'configure'}
        <Details />
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
