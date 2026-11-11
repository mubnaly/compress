export interface EngineInfo {
  ok: boolean;
  error: string | null;
  version: string | null;
  ffmpegPath: string;
  ffprobePath: string;
  encoderNames: string[];
  softwareEncoders: Record<string, string | null>;
  hardwareEncoders: Record<string, string[]>;
  hardwareAcceleration: boolean;
}

export interface PresetMeta {
  id: string;
  label: string;
  badge: string;
  summary: string;
}

export interface Probe {
  path: string;
  fileName: string;
  directory: string;
  fileSizeBytes: number;
  durationSeconds: number;
  formatName: string | null;
  totalBitrateKbps: number;
  rotation: number;
  isHdr: boolean;
  bitsPerPixel: number | null;
  alreadyOptimal: { likely: boolean; reason: string | null };
  video: {
    codec: string;
    codecLong: string | null;
    profile: string | null;
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    fps: number;
    bitrateKbps: number | null;
    pixelFormat: string | null;
  };
  audio: {
    codec: string;
    channels: number;
    channelLayout: string | null;
    sampleRate: number;
    bitrateKbps: number | null;
  } | null;
}

export interface Estimate {
  ok: boolean;
  error?: string;
  preset: string;
  codec: string;
  codecLabel: string;
  mode: 'crf' | 'bitrate';
  durationSeconds: number;
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  totalBitrateKbps: number;
  outputSizeBytes: number;
  originalSizeBytes: number;
  reductionPercent: number;
  targetSizeBytes: number | null;
  warnings: string[];
}

export interface JobResult {
  originalSizeBytes: number;
  compressedSizeBytes: number;
  outputSizeBytes: number;
  savedBytes: number;
  reductionPercent: number;
  wouldBeBytes: number;
  alreadyOptimal: boolean;
  outputPath: string | null;
  encoder: string;
  dimensions?: string;
  container?: string;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'already_optimal' | 'failed' | 'cancelled';

export interface JobProgress {
  percent: number;
  processedSeconds: number;
  fps: number;
  speed: number;
  etaSeconds: number | null;
  outputBytes: number;
}

export interface Job {
  id: string;
  inputPath: string;
  fileName: string;
  preset: string;
  options: Record<string, unknown>;
  status: JobStatus;
  progress: JobProgress;
  estimate: Estimate | null;
  probe: {
    durationSeconds: number;
    fileSizeBytes: number;
    width: number;
    height: number;
    codec: string;
    audio: boolean;
  } | null;
  result: JobResult | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  originalDeleted: boolean;
}

export interface Settings {
  outputDirectory: string;
  namingPattern: string;
  allowSizeIncrease: boolean;
  concurrency: number;
  defaultCodec: string;
  defaultPreset: string;
  hardwareAcceleration: boolean;
  theme: 'system' | 'dark' | 'light';
  aiApiKey: string;
  aiModel: string;
  aiTokensUsed: number;
}

export interface ViralReel {
  id: string;
  start: number;
  end: number;
  title: string;
  hook: string;
  reason: string;
  viralityScore: number;
}

export interface SoundEffect {
  name: string;
  file: string;
  path: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  sizeBytes?: number;
  modifiedAt?: number;
}

export interface BrowseListing {
  path: string;
  parent: string | null;
  roots: { label: string; path: string }[];
  directories: BrowseEntry[];
  videos: BrowseEntry[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  inputPath: string;
  outputPath: string | null;
  fileName: string;
  preset: string;
  status: JobStatus;
  originalSizeBytes: number;
  outputSizeBytes: number;
  savedBytes: number;
  reductionPercent: number;
  durationSeconds: number;
  width: number;
  height: number;
  encoder: string;
  originalDeleted?: boolean;
}

export interface HistoryResponse {
  entries: HistoryEntry[];
  totals: { count: number; savedBytes: number; originalBytes: number; compressedBytes: number };
}

export function getEngineUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('plico_engine_url');
    if (custom) return custom.replace(/\/+$/, '');
  }
  return '';
}

export function setEngineUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) localStorage.setItem('plico_engine_url', url.trim());
    else localStorage.removeItem('plico_engine_url');
  }
}

export async function probeBrowserVideo(url: string, name = 'Selected Video', size = 0): Promise<{ probe: Probe }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const timer = setTimeout(() => {
      done(1920, 1080, 10);
    }, 4000);

    function done(w: number, h: number, dur: number) {
      clearTimeout(timer);
      const safeDuration = Math.max(0.1, Number.isFinite(dur) ? dur : 10);
      const safeWidth = w || 1920;
      const safeHeight = h || 1080;
      const safeSize = size || Math.round(safeDuration * 2 * 1024 * 1024);
      const bitrate = Math.round((safeSize * 8) / (safeDuration * 1000));

      resolve({
        probe: {
          path: url,
          fileName: name,
          directory: 'Browser Memory',
          fileSizeBytes: safeSize,
          durationSeconds: Math.round(safeDuration * 10) / 10,
          formatName: 'mp4',
          totalBitrateKbps: bitrate,
          rotation: 0,
          isHdr: false,
          bitsPerPixel: 0.08,
          alreadyOptimal: { likely: false, reason: null },
          video: {
            codec: 'h264',
            codecLong: 'H.264 / AVC (Web Browser)',
            profile: 'High',
            width: safeWidth,
            height: safeHeight,
            displayWidth: safeWidth,
            displayHeight: safeHeight,
            fps: 30,
            bitrateKbps: Math.max(80, bitrate - 128),
            pixelFormat: 'yuv420p',
          },
          audio: {
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            sampleRate: 48000,
            bitrateKbps: 128,
          },
        },
      });
    }

    video.onloadedmetadata = () => {
      done(video.videoWidth, video.videoHeight, video.duration);
    };
    video.onerror = () => {
      done(1920, 1080, 10);
    };
    video.src = url;
  });
}

function calculateFallbackEstimate(probe: Probe, preset: string, options: Record<string, unknown>): Estimate {
  const duration = probe.durationSeconds || 10;
  const originalSize = probe.fileSizeBytes || 20 * 1024 * 1024;
  let targetBytes = originalSize * 0.5;

  let width = probe.video.displayWidth;
  let height = probe.video.displayHeight;

  if (preset === 'optimal') {
    targetBytes = originalSize * 0.65;
  } else if (preset === 'medium') {
    targetBytes = originalSize * 0.45;
    if (height > 720) {
      width = Math.round((width * (720 / height)) / 2) * 2;
      height = 720;
    }
  } else if (preset === 'small') {
    targetBytes = originalSize * 0.28;
    if (height > 480) {
      width = Math.round((width * (480 / height)) / 2) * 2;
      height = 480;
    }
  } else if (preset === 'whatsapp') {
    targetBytes = Math.min(originalSize, 16 * 1024 * 1024 * 0.95);
  } else if (preset === 'gmail') {
    targetBytes = Math.min(originalSize, 25 * 1024 * 1024 * 0.95);
  } else if (preset === 'custom_size') {
    const mb = Number(options.targetSizeMB) || 25;
    targetBytes = mb * 1024 * 1024;
  }

  const reduction = Math.max(0, Math.round(((originalSize - targetBytes) / originalSize) * 100));
  const audioKbps = options.removeAudio ? 0 : 128;
  const totalKbps = Math.round((targetBytes * 8) / (duration * 1000));
  const videoKbps = Math.max(80, totalKbps - audioKbps);

  return {
    ok: true,
    preset,
    codec: String(options.codec || 'h264'),
    codecLabel: String(options.codec || 'h264').toUpperCase(),
    mode: preset === 'optimal' ? 'crf' : 'bitrate',
    durationSeconds: duration,
    width,
    height,
    videoBitrateKbps: videoKbps,
    audioBitrateKbps: audioKbps,
    totalBitrateKbps: totalKbps,
    outputSizeBytes: Math.round(targetBytes),
    originalSizeBytes: originalSize,
    reductionPercent: reduction,
    targetSizeBytes: targetBytes,
    warnings: [],
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const base = getEngineUrl();
  const target = base ? `${base}${url}` : url;
  const response = await fetch(target, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 405) {
      throw new Error(
        'Backend engine is required. Please run Plico-Video-Compressor.exe or connect to http://localhost:7317.'
      );
    }
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  health: () =>
    request<{ engine: EngineInfo; presets: PresetMeta[]; settings: Settings; roots: { label: string; path: string }[]; queue: Job[] }>(
      '/api/health',
    ),

  browse: (path?: string, sort = 'date', direction: 'asc' | 'desc' = 'desc') =>
    request<BrowseListing & { ok: boolean }>(
      `/api/browse?path=${encodeURIComponent(path ?? '')}&sort=${encodeURIComponent(sort)}&dir=${direction}`,
    ),

  probe: async (path: string): Promise<{ probe: Probe }> => {
    if (path.startsWith('blob:') || path.startsWith('data:')) {
      return probeBrowserVideo(path);
    }
    return request<{ probe: Probe }>('/api/probe', { method: 'POST', body: JSON.stringify({ path }) });
  },

  estimate: async (payload: { path?: string; probe?: Probe; preset: string; options: Record<string, unknown> }): Promise<{ probe: Probe; estimate: Estimate }> => {
    if (payload.path?.startsWith('blob:') && payload.probe) {
      return {
        probe: payload.probe,
        estimate: calculateFallbackEstimate(payload.probe, payload.preset, payload.options),
      };
    }
    try {
      return await request<{ probe: Probe; estimate: Estimate }>('/api/estimate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (payload.probe) {
        return {
          probe: payload.probe,
          estimate: calculateFallbackEstimate(payload.probe, payload.preset, payload.options),
        };
      }
      throw err;
    }
  },

  addJobs: (items: { path: string; preset: string; options: Record<string, unknown> }[]) =>
    request<{ jobs: Job[] }>('/api/jobs', { method: 'POST', body: JSON.stringify({ items }) }),

  jobs: () => request<{ jobs: Job[] }>('/api/jobs'),

  cancelJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  retryJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  removeJob: (id: string) => request<{ ok: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  clearFinished: () => request<{ ok: boolean }>('/api/jobs/clear-finished', { method: 'POST' }),
  deleteOriginal: (id: string) =>
    request<{ ok: boolean; error?: string }>(`/api/jobs/${id}/delete-original`, { method: 'POST' }),

  preview: (payload: { path: string; startSeconds: number; durationSeconds: number; probe: Probe | null }) =>
    request<{ preview: { path: string; startSeconds: number; durationSeconds: number; url: string } }>('/api/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reveal: (path: string) => request<{ ok: boolean }>('/api/reveal', { method: 'POST', body: JSON.stringify({ path }) }),

  chooseFolder: () =>
    request<{ ok: boolean; path?: string; cancelled?: boolean; unsupported?: boolean }>('/api/choose-folder', {
      method: 'POST',
    }),

  chooseFiles: () =>
    request<{ ok: boolean; files?: BrowseEntry[]; cancelled?: boolean; unsupported?: boolean }>('/api/choose-files', {
      method: 'POST',
    }),

  upload: async (file: File): Promise<{ ok: boolean; file: BrowseEntry; probe: Probe }> => {
    const base = getEngineUrl();
    if (!base && typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
      throw new Error(
        'Cannot upload to GitHub Pages static host. Please connect to your local Plico engine at http://localhost:7317 or run Plico-Video-Compressor.exe.'
      );
    }
    const target = base ? `${base}/api/upload?name=${encodeURIComponent(file.name)}` : `/api/upload?name=${encodeURIComponent(file.name)}`;
    const res = await fetch(target, {
      method: 'POST',
      body: file,
    });
    if (!res.ok) {
      if (res.status === 405) {
        throw new Error(
          'Backend engine required: static web host does not support direct video upload. Run Plico-Video-Compressor.exe or connect to http://localhost:7317.'
        );
      }
      let err = '';
      try {
        err = await res.text();
      } catch {
        err = `${res.status} ${res.statusText}`;
      }
      if (err.includes('<html') || err.includes('<!DOCTYPE')) {
        throw new Error(`Engine not reachable (status ${res.status}). Connect to http://localhost:7317.`);
      }
      throw new Error(`Upload failed: ${err.slice(0, 150)}`);
    }
    return res.json();
  },

  youtube: (url: string) =>
    request<{ ok: boolean; job: Job; downloadedPath: string; error?: string }>('/api/youtube', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  settings: () => request<{ settings: Settings }>('/api/settings'),
  saveSettings: (settings: Settings) =>
    request<{ settings: Settings }>('/api/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),

  // --- AI STUDIO API ---
  aiSounds: () => request<{ ok: boolean; sounds: SoundEffect[] }>('/api/ai/sounds'),
  aiDownloadSound: (url: string, name?: string) =>
    request<{ ok: boolean; sound: SoundEffect }>('/api/ai/sounds/download', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    }),
  aiRemoveSilence: (path: string, noiseThreshold = -30, minDuration = 0.35) =>
    request<{
      ok: boolean;
      silencesDetected: number;
      speechChunksCount: number;
      timeSavedSeconds: number;
      newDurationSeconds: number;
      outputPath: string;
      message?: string;
    }>('/api/ai/remove-silence', {
      method: 'POST',
      body: JSON.stringify({ path, noiseThreshold, minDuration }),
    }),
  aiTranscribe: (path: string) =>
    request<{ ok: boolean; srt: string; srtPath: string; tokens: number }>('/api/ai/transcribe', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  aiBurnSubtitles: (path: string, srtPath: string) =>
    request<{ ok: boolean; outputPath: string }>('/api/ai/burn-subtitles', {
      method: 'POST',
      body: JSON.stringify({ path, srtPath }),
    }),
  aiViralReels: (path: string) =>
    request<{ ok: boolean; reels: ViralReel[]; tokens: number }>('/api/ai/viral-reels', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  aiExportReel: (payload: { path: string; start: number; end: number; title: string; aspect?: string }) =>
    request<{ ok: boolean; outputPath: string; duration: number }>('/api/ai/export-reel', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  aiSmartMontage: (path: string) =>
    request<{ ok: boolean; outputPath: string; effectsApplied: number; markers: any[] }>('/api/ai/smart-montage', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  aiResetTokens: () => request<{ ok: boolean; aiTokensUsed: number }>('/api/ai/reset-tokens', { method: 'POST' }),

  history: () => request<HistoryResponse & { ok: boolean }>('/api/history'),
  clearHistory: () => request<{ ok: boolean }>('/api/history', { method: 'DELETE' }),

  mediaUrl: (path: string) => {
    if (!path) return '';
    if (path.startsWith('blob:') || path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return `${getEngineUrl()}/api/media?path=${encodeURIComponent(path)}`;
  },
  thumbUrl: (path: string, timeSeconds = 1) => {
    if (!path) return '';
    if (path.startsWith('blob:') || path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://')) {
      return '';
    }
    return `${getEngineUrl()}/api/thumb?path=${encodeURIComponent(path)}&t=${encodeURIComponent(String(timeSeconds))}`;
  },
};
