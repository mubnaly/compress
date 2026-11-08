import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PREVIEW_DIR, THUMB_DIR } from './store.js';
import { execCapture } from './ffmpeg.js';

function previewEncoder(engine) {
  return engine?.softwareEncoders?.h264 || 'libx264';
}

/**
 * Render a short, ultrafast sample segment so quality can be judged before a
 * full encode. Mirrors the target app's 5s-60s fast-preview behaviour.
 */
export async function generatePreview({ engine, inputPath, startSeconds = 0, durationSeconds = 5, probe }) {
  await fs.mkdir(PREVIEW_DIR, { recursive: true });

  const start = Math.max(0, Number(startSeconds) || 0);
  const requested = Math.max(1, Number(durationSeconds) || 5);
  const available = probe?.durationSeconds ? Math.max(0.5, probe.durationSeconds - start) : requested;
  const duration = Math.min(requested, available);

  const hash = crypto
    .createHash('sha1')
    .update(`${inputPath}:${start}:${duration}:${Date.now()}`)
    .digest('hex')
    .slice(0, 12);
  const output = path.join(PREVIEW_DIR, `preview-${hash}.mp4`);

  const args = [
    '-y', '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-ss', String(start),
    '-t', String(duration),
    '-i', inputPath,
    '-map', '0:v:0',
  ];
  if (probe?.audio) args.push('-map', '0:a:0');
  args.push('-c:v', previewEncoder(engine), '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p');
  if (probe?.audio) args.push('-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push('-movflags', '+faststart', '-progress', 'pipe:2', '-nostats', output);

  const { code, stderr } = await execCapture(engine.ffmpegPath, args, { timeoutMs: 240_000 });
  if (code !== 0) {
    await fs.unlink(output).catch(() => {});
    throw new Error(`Could not render the preview. ${(stderr || '').slice(-400).trim()}`);
  }

  return { path: output, startSeconds: start, durationSeconds: duration };
}

export async function generateThumbnail({ engine, inputPath, timeSeconds = 1 }) {
  await fs.mkdir(THUMB_DIR, { recursive: true });
  const stat = await fs.stat(inputPath);
  const hash = crypto
    .createHash('sha1')
    .update(`${inputPath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 16);
  const output = path.join(THUMB_DIR, `${hash}.jpg`);

  try {
    await fs.access(output);
    return output;
  } catch {
    /* not cached yet */
  }

  const args = [
    '-y', '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-ss', String(Math.max(0, Number(timeSeconds) || 0)),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=640:-2',
    '-q:v', '4',
    output,
  ];
  const { code } = await execCapture(engine.ffmpegPath, args, { timeoutMs: 60_000 });
  if (code !== 0) throw new Error('Could not render a thumbnail for this file');
  return output;
}

export async function cleanPreviews(maxAgeMs = 3 * 60 * 60 * 1000) {
  try {
    const entries = await fs.readdir(PREVIEW_DIR, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mp4'))
        .map(async (entry) => {
          const full = path.join(PREVIEW_DIR, entry.name);
          try {
            const stat = await fs.stat(full);
            if (now - stat.mtimeMs > maxAgeMs) await fs.unlink(full);
          } catch {
            /* ignore */
          }
        }),
    );
  } catch {
    /* cache directory may not exist yet */
  }
}
