import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { probeFile } from './probe.js';
import { estimate } from './presets.js';
import { buildFfmpegArgs, extensionFor } from './command.js';
import { runFfmpeg } from './executor.js';

const TERMINAL = new Set(['completed', 'already_optimal', 'failed', 'cancelled']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg', '.3gp', '.ogv']);

export function isVideoPath(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function shortId() {
  return randomUUID().slice(0, 8);
}

function timestamp() {
  return Date.now();
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') return;
      await new Promise((res) => setTimeout(res, 120));
    }
  }
}

function sanitizeName(name) {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildOutputName(pattern, inputPath, preset, ext) {
  const original = path.parse(inputPath).name;
  const template = pattern || '{name}_compressed.{ext}';
  const withExt = template.includes('{ext}') ? template : `${template}.{ext}`;
  const name = withExt
    .replaceAll('{name}', original)
    .replaceAll('{preset}', preset)
    .replaceAll('{ext}', ext);
  const cleaned = sanitizeName(name) || `${original}_compressed.${ext}`;
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

async function uniquePath(target) {
  try {
    await fs.access(target);
  } catch {
    return target;
  }
  const parsed = path.parse(target);
  for (let index = 2; index < 500; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
}

export class CompressionQueue {
  constructor({ store, getEngine }) {
    this.store = store;
    this.getEngine = getEngine;
    this.jobs = [];
    this.runners = new Map();
    this.active = 0;
  }

  list() {
    return this.jobs.map((job) => this.serialize(job));
  }

  get(id) {
    return this.jobs.find((job) => job.id === id) || null;
  }

  serialize(job) {
    return {
      id: job.id,
      inputPath: job.inputPath,
      fileName: job.fileName,
      preset: job.preset,
      options: job.options,
      status: job.status,
      progress: job.progress,
      estimate: job.estimate,
      probe: job.probe
        ? {
            durationSeconds: job.probe.durationSeconds,
            fileSizeBytes: job.probe.fileSizeBytes,
            width: job.probe.video.displayWidth,
            height: job.probe.video.displayHeight,
            codec: job.probe.video.codec,
            audio: Boolean(job.probe.audio),
          }
        : null,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      originalDeleted: job.originalDeleted,
    };
  }

  add(items) {
    const created = [];
    for (const item of items) {
      const job = {
        id: randomUUID(),
        inputPath: path.resolve(item.path),
        fileName: path.basename(item.path),
        preset: item.preset || this.store.getSettings().defaultPreset,
        options: {
          codec: this.store.getSettings().defaultCodec,
          container: 'mp4',
          copyMetadata: true,
          removeAudio: false,
          volume: 1,
          rotation: 0,
          tonemap: true,
          startSeconds: 0,
          endSeconds: null,
          crop: null,
          ...item.options,
        },
        status: 'queued',
        progress: { percent: 0, processedSeconds: 0, fps: 0, speed: 0, etaSeconds: null, outputBytes: 0 },
        probe: null,
        estimate: null,
        outputPath: null,
        tempPath: null,
        result: null,
        error: null,
        createdAt: timestamp(),
        startedAt: null,
        finishedAt: null,
        cancelRequested: false,
        originalDeleted: false,
      };
      this.jobs.push(job);
      created.push(this.serialize(job));
    }
    this.pump();
    return created;
  }

  hasActiveJobs() {
    return this.jobs.some((job) => job.status === 'running' || job.status === 'queued');
  }

  cancel(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: 'Job not found' };
    if (TERMINAL.has(job.status)) return { ok: false, error: 'This job already finished' };
    job.cancelRequested = true;
    job.status = 'cancelled';
    job.finishedAt = timestamp();
    const runner = this.runners.get(job.id);
    if (runner) {
      try {
        runner.cancel();
      } catch (err) {
        console.error('Failed to cancel runner:', err);
      }
    }
    return { ok: true };
  }

  retry(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: 'Job not found' };
    if (!TERMINAL.has(job.status)) return { ok: false, error: 'This job is still running' };
    job.status = 'queued';
    job.progress = { percent: 0, processedSeconds: 0, fps: 0, speed: 0, etaSeconds: null, outputBytes: 0 };
    job.result = null;
    job.error = null;
    job.outputPath = null;
    job.tempPath = null;
    job.finishedAt = null;
    job.startedAt = null;
    job.cancelRequested = false;
    this.pump();
    return { ok: true };
  }

  async remove(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: 'Job not found' };
    if (!TERMINAL.has(job.status)) return { ok: false, error: 'Cancel this job before removing it' };
    if (job.result?.outputPath) await safeUnlink(job.tempPath);
    this.jobs = this.jobs.filter((item) => item.id !== id);
    return { ok: true };
  }

  clearFinished() {
    this.jobs = this.jobs.filter((job) => !TERMINAL.has(job.status));
    return { ok: true };
  }

  async deleteOriginal(id) {
    const job = this.get(id);
    if (!job) return { ok: false, error: 'Job not found' };
    if (job.status !== 'completed' && job.status !== 'already_optimal') {
      return { ok: false, error: 'Only finished jobs can have their source removed' };
    }
    try {
      await fs.unlink(job.inputPath);
    } catch (err) {
      return { ok: false, error: `Could not delete the original: ${err.message}` };
    }
    job.originalDeleted = true;
    if (job.historyId) await this.store.markOriginalDeleted(job.historyId);
    return { ok: true };
  }

  pump() {
    const concurrency = this.store.getSettings().concurrency;
    while (this.active < concurrency) {
      const next = this.jobs.find((job) => job.status === 'queued');
      if (!next) return;
      next.status = 'running';
      next.startedAt = timestamp();
      this.active += 1;
      this.runJob(next)
        .catch((err) => {
          next.status = 'failed';
          next.error = err.message;
          next.finishedAt = timestamp();
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  async runJob(job) {
    const engine = await this.getEngine();
    if (!engine.ok) throw new Error(engine.error || 'FFmpeg is not available on this machine');

    const settings = this.store.getSettings();
    job.probe = await probeFile(engine, job.inputPath);
    job.preset = job.preset || settings.defaultPreset;

    const plan = estimate({ probe: job.probe, preset: job.preset, options: job.options });
    if (!plan.ok) throw new Error(plan.error || 'This preset cannot be applied to the file');
    job.estimate = plan;

    const codec = job.options.codec || settings.defaultCodec;
    const ext = extensionFor(codec, job.options.container);
    const outputDir = settings.outputDirectory || path.dirname(job.inputPath);
    await fs.mkdir(outputDir, { recursive: true });

    const outputName = buildOutputName(settings.namingPattern, job.inputPath, job.preset, ext);
    const outputPath = await uniquePath(path.join(outputDir, outputName));
    const tempPath = path.join(outputDir, `.${path.parse(outputPath).name}.part-${shortId()}.${ext}`);

    job.outputPath = outputPath;
    job.tempPath = tempPath;

    await fs.access(job.inputPath);

    const built = buildFfmpegArgs({
      engine,
      inputPath: job.inputPath,
      outputPath: tempPath,
      probe: job.probe,
      preset: job.preset,
      options: {
        hardwareAcceleration: settings.hardwareAcceleration ?? true,
        ...job.options,
        codec,
      },
      plan,
    });

    const runner = runFfmpeg({
      ffmpegPath: engine.ffmpegPath,
      args: built.args,
      durationSeconds: plan.durationSeconds,
      onProgress: (progress) => {
        job.progress = progress;
      },
    });
    this.runners.set(job.id, runner);

    let outcome;
    try {
      outcome = await runner.promise;
    } finally {
      this.runners.delete(job.id);
    }

    if (job.cancelRequested) {
      await safeUnlink(tempPath);
      job.status = 'cancelled';
      job.finishedAt = timestamp();
      job.outputPath = null;
      return;
    }

    if (!outcome.ok) {
      await safeUnlink(tempPath);
      throw new Error(outcome.error || 'FFmpeg failed to finish this job');
    }

    const outputStat = await fs.stat(tempPath);
    const originalSizeBytes = job.probe.fileSizeBytes;
    const compressedSizeBytes = outputStat.size;

    if (compressedSizeBytes >= originalSizeBytes && !settings.allowSizeIncrease) {
      await safeUnlink(tempPath);
      job.status = 'already_optimal';
      job.outputPath = null;
      job.progress = { ...job.progress, percent: 100, etaSeconds: 0 };
      job.result = {
        originalSizeBytes,
        compressedSizeBytes,
        outputSizeBytes: originalSizeBytes,
        savedBytes: 0,
        reductionPercent: 0,
        wouldBeBytes: compressedSizeBytes,
        alreadyOptimal: true,
        outputPath: null,
        encoder: built.encoder,
      };
    } else {
      await fs.rename(tempPath, outputPath);
      const savedBytes = Math.max(0, originalSizeBytes - compressedSizeBytes);
      job.status = 'completed';
      job.progress = { ...job.progress, percent: 100, etaSeconds: 0 };
      job.result = {
        originalSizeBytes,
        compressedSizeBytes,
        outputSizeBytes: compressedSizeBytes,
        savedBytes,
        reductionPercent: originalSizeBytes ? Math.round((savedBytes / originalSizeBytes) * 1000) / 10 : 0,
        wouldBeBytes: compressedSizeBytes,
        alreadyOptimal: false,
        outputPath,
        encoder: built.encoder,
        dimensions: `${built.dimensions.width}×${built.dimensions.height}`,
        container: built.container,
      };
    }

    job.finishedAt = timestamp();
    job.historyId = randomUUID();
    await this.store.appendHistory({
      id: job.historyId,
      timestamp: timestamp(),
      inputPath: job.inputPath,
      outputPath: job.result.outputPath,
      fileName: job.fileName,
      preset: job.preset,
      status: job.status,
      originalSizeBytes,
      outputSizeBytes: job.result.outputSizeBytes,
      savedBytes: job.result.savedBytes,
      reductionPercent: job.result.reductionPercent,
      durationSeconds: job.probe.durationSeconds,
      width: job.probe.video.displayWidth,
      height: job.probe.video.displayHeight,
      encoder: job.result.encoder,
    });
  }
}
