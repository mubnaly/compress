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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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

  probe: (path: string) => request<{ probe: Probe }>('/api/probe', { method: 'POST', body: JSON.stringify({ path }) }),

  estimate: (payload: { path?: string; probe?: Probe; preset: string; options: Record<string, unknown> }) =>
    request<{ probe: Probe; estimate: Estimate }>('/api/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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
    const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      body: file,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed: ${err}`);
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

  history: () => request<HistoryResponse & { ok: boolean }>('/api/history'),
  clearHistory: () => request<{ ok: boolean }>('/api/history', { method: 'DELETE' }),

  mediaUrl: (path: string) => `/api/media?path=${encodeURIComponent(path)}`,
  thumbUrl: (path: string, timeSeconds = 1) =>
    `/api/thumb?path=${encodeURIComponent(path)}&t=${encodeURIComponent(String(timeSeconds))}`,
};
