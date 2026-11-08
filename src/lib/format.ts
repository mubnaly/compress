export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds <= 1) return 'almost done';
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s left`;
}

export function formatRelative(timestamp: number): string {
  if (!timestamp) return '—';
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (!kbps) return '—';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function truncateMiddle(text: string, max = 46): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Compressing',
  completed: 'Compressed',
  already_optimal: 'Already optimal',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const PRESET_LABEL: Record<string, string> = {
  optimal: 'Optimal quality',
  medium: 'Medium quality',
  small: 'Small size',
  whatsapp: 'WhatsApp 16 MB',
  gmail: 'Gmail 25 MB',
  custom_size: 'Custom size',
  custom_resolution: 'Custom resolution',
};
