import { api } from './api';
import type { BrowseEntry, EngineInfo, Job, PresetMeta, Settings } from './api';
import { playCompletionSound } from './sound';

export type View = 'library' | 'configure' | 'queue' | 'compare' | 'history' | 'settings' | 'ai';

export interface Toast {
  message: string;
  kind: 'info' | 'error';
}

const prevStatus = new Map<string, Job['status']>();
const autoDownloaded = new Set<string>();

class AppState {
  view = $state<View>('library');
  engine = $state<EngineInfo | null>(null);
  presets = $state<PresetMeta[]>([]);
  settings = $state<Settings | null>(null);
  roots = $state<{ label: string; path: string }[]>([]);
  jobs = $state<Job[]>([]);
  selected = $state<BrowseEntry[]>([]);
  compareJobId = $state<string | null>(null);
  toast = $state<Toast | null>(null);
  bootError = $state<string | null>(null);

  get busyJobs(): Job[] {
    return this.jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  }

  get finishedJobs(): Job[] {
    return this.jobs.filter((job) => job.status !== 'running' && job.status !== 'queued');
  }

  notify(message: string, kind: Toast['kind'] = 'info') {
    this.toast = { message, kind };
    const current = this.toast;
    setTimeout(() => {
      if (this.toast === current) this.toast = null;
    }, 4200);
  }

  async refreshJobs() {
    try {
      const data = await api.jobs();
      // Sort jobs by default: last modified / finished / newest first
      const sorted = (data.jobs || []).slice().sort((a, b) => {
        const timeA = a.finishedAt || a.startedAt || a.createdAt || 0;
        const timeB = b.finishedAt || b.startedAt || b.createdAt || 0;
        return timeB - timeA;
      });

      // Check for newly completed jobs to play sound and trigger auto-downloads
      for (const job of sorted) {
        const oldStatus = prevStatus.get(job.id);
        if (oldStatus && (oldStatus === 'running' || oldStatus === 'queued')) {
          if (job.status === 'completed' || job.status === 'already_optimal') {
            // Play notification chime
            playCompletionSound();
            this.notify(`Completed: ${job.fileName}`, 'info');

            // Handle auto-download (for YouTube & online compression)
            if (job.options && (job.options as Record<string, unknown>).autoDownload && !autoDownloaded.has(job.id)) {
              autoDownloaded.add(job.id);
              const downloadPath = job.result?.outputPath || (job as any).outputPath;
              if (downloadPath) {
                const link = document.createElement('a');
                link.href = `${api.mediaUrl(downloadPath)}&download=1`;
                link.download = job.fileName.replace(/\.[^.]+$/, '_720p.mp4');
                document.body.appendChild(link);
                link.click();
                link.remove();
                this.notify(`Downloaded ${job.fileName} in 720p!`, 'info');
              }
            }
          }
        }
        prevStatus.set(job.id, job.status);
      }

      this.jobs = sorted;
    } catch {
      /* engine restarting */
    }
  }

  applyTheme(theme: Settings['theme']) {
    if (typeof document === 'undefined') return;
    const resolved =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : theme;
    document.documentElement.dataset.theme = resolved;
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings | null> {
    if (!this.settings) return null;
    const next = { ...this.settings, ...patch };
    try {
      const saved = await api.saveSettings(next);
      this.settings = saved.settings;
      this.applyTheme(saved.settings.theme);
      return saved.settings;
    } catch (err) {
      this.notify(err instanceof Error ? err.message : 'Could not save settings', 'error');
      return null;
    }
  }

  openCompare(jobId: string) {
    this.compareJobId = jobId;
    this.view = 'compare';
  }
}

export const app = new AppState();
