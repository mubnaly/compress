import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = typeof __dirname !== 'undefined'
  ? path.resolve(__dirname, '../..')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const DATA_DIR = process.env.PLICO_DATA_DIR
  ? path.resolve(process.env.PLICO_DATA_DIR)
  : path.join(ROOT, 'data');

export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const PREVIEW_DIR = path.join(CACHE_DIR, 'previews');
export const THUMB_DIR = path.join(CACHE_DIR, 'thumbs');

export const DEFAULT_SETTINGS = {
  outputDirectory: '',
  namingPattern: '{name}_compressed.{ext}',
  allowSizeIncrease: false,
  concurrency: 2,
  defaultCodec: 'h264',
  defaultPreset: 'optimal',
  hardwareAcceleration: false,
  theme: 'dark',
};

const THEMES = new Set(['system', 'dark', 'light']);
const CODECS = new Set(['h264', 'hevc', 'av1', 'vp9']);

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, file);
}

export function defaultRoots() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push({ label: '💾 C: Drive', path: 'C:\\' });
    candidates.push({ label: '📁 C:\\Users', path: path.join('C:\\', 'Users') });
  }
  candidates.push(
    { label: '🎬 Videos', path: path.join(home, 'Videos') },
    { label: '⬇️ Downloads', path: path.join(home, 'Downloads') },
    { label: '🖥️ Desktop', path: path.join(home, 'Desktop') },
    { label: '🖼️ Pictures', path: path.join(home, 'Pictures') },
  );
  return candidates;
}

export class Store {
  constructor() {
    this.settingsFile = path.join(DATA_DIR, 'settings.json');
    this.historyFile = path.join(DATA_DIR, 'history.json');
    this.settings = { ...DEFAULT_SETTINGS };
    this.history = [];
    this.ready = this.load();
  }

  async load() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const settings = await readJson(this.settingsFile, {});
    this.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...settings });
    const history = await readJson(this.historyFile, { entries: [] });
    this.history = Array.isArray(history.entries) ? history.entries : [];
  }

  getSettings() {
    return { ...this.settings };
  }

  async saveSettings(patch) {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    await writeJsonAtomic(this.settingsFile, this.settings);
    return this.getSettings();
  }

  getHistory() {
    const entries = [...this.history].sort((a, b) => b.timestamp - a.timestamp);
    const totals = entries.reduce(
      (acc, entry) => {
        acc.count += 1;
        acc.savedBytes += Math.max(0, entry.savedBytes || 0);
        acc.originalBytes += entry.originalSizeBytes || 0;
        acc.compressedBytes += entry.outputSizeBytes || 0;
        return acc;
      },
      { count: 0, savedBytes: 0, originalBytes: 0, compressedBytes: 0 },
    );
    return { entries, totals };
  }

  async appendHistory(entry) {
    this.history.push(entry);
    if (this.history.length > 500) this.history = this.history.slice(-500);
    await writeJsonAtomic(this.historyFile, { entries: this.history });
  }

  async clearHistory() {
    this.history = [];
    await writeJsonAtomic(this.historyFile, { entries: [] });
  }

  async markOriginalDeleted(historyId) {
    const entry = this.history.find((item) => item.id === historyId);
    if (entry) {
      entry.originalDeleted = true;
      await writeJsonAtomic(this.historyFile, { entries: this.history });
    }
  }
}

export function sanitizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const concurrency = Number(merged.concurrency);
  const naming = String(merged.namingPattern || '').trim();

  return {
    outputDirectory: typeof merged.outputDirectory === 'string' ? merged.outputDirectory.trim() : '',
    namingPattern: naming || DEFAULT_SETTINGS.namingPattern,
    allowSizeIncrease: Boolean(merged.allowSizeIncrease),
    concurrency: Number.isFinite(concurrency) ? Math.min(4, Math.max(1, Math.round(concurrency))) : DEFAULT_SETTINGS.concurrency,
    defaultCodec: CODECS.has(merged.defaultCodec) ? merged.defaultCodec : DEFAULT_SETTINGS.defaultCodec,
    defaultPreset: typeof merged.defaultPreset === 'string' ? merged.defaultPreset : DEFAULT_SETTINGS.defaultPreset,
    hardwareAcceleration: Boolean(merged.hardwareAcceleration),
    theme: THEMES.has(merged.theme) ? merged.theme : DEFAULT_SETTINGS.theme,
  };
}
