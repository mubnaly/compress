import { spawn } from 'node:child_process';

const DEFAULT_FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const DEFAULT_FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

let cached = null;

/**
 * Run a short-lived binary and capture its output without a shell.
 * Child processes are always isolated: the engine never links FFmpeg code.
 */
export function execCapture(bin, args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: '', error: err.message });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => finish({ code: -1, stdout, stderr, error: err.message }));
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

function parseEncoders(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[VAS][F.][S.][X.][B.][D.]\s+(\S+)/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

const CODEC_CANDIDATES = {
  h264: { software: ['libx264', 'libopenh264'], hardware: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'h264_vaapi'] },
  hevc: { software: ['libx265'], hardware: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox', 'hevc_vaapi'] },
  av1: { software: ['libsvtav1', 'libaom-av1'], hardware: ['av1_nvenc', 'av1_qsv', 'av1_amf'] },
  vp9: { software: ['libvpx-vp9'], hardware: ['vp9_qsv', 'vp9_vaapi'] },
};

/**
 * Detect the FFmpeg toolchain once and expose what this machine can encode.
 */
export async function detectEngine({ force = false } = {}) {
  if (cached && !force) return cached;

  const versionRun = await execCapture(DEFAULT_FFMPEG, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
  const engine = {
    ok: false,
    ffmpegPath: DEFAULT_FFMPEG,
    ffprobePath: DEFAULT_FFPROBE,
    version: null,
    encoderNames: [],
    softwareEncoders: {},
    hardwareEncoders: {},
    hardwareAcceleration: false,
    error: null,
    probedAt: Date.now(),
  };

  if (versionRun.code !== 0) {
    engine.error = (versionRun.stderr || versionRun.error || 'ffmpeg was not found on PATH').trim();
    cached = engine;
    return engine;
  }

  const firstLine = (versionRun.stdout.split(/\r?\n/)[0] || '').trim();
  engine.version = firstLine.replace(/^ffmpeg version\s*/i, '').split(' Copyright')[0] || firstLine;
  engine.ok = true;

  const probeVersion = await execCapture(DEFAULT_FFPROBE, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
  if (probeVersion.code !== 0) {
    engine.ok = false;
    engine.error = 'ffprobe was not found next to ffmpeg on PATH';
    cached = engine;
    return engine;
  }

  const encodersRun = await execCapture(DEFAULT_FFMPEG, ['-hide_banner', '-encoders'], { timeoutMs: 20_000 });
  const names = parseEncoders(encodersRun.stdout);
  engine.encoderNames = [...names].sort();

  for (const [codec, candidates] of Object.entries(CODEC_CANDIDATES)) {
    engine.softwareEncoders[codec] = candidates.software.find((name) => names.has(name)) || null;
    engine.hardwareEncoders[codec] = candidates.hardware.filter((name) => names.has(name));
  }
  engine.hardwareAcceleration = Object.values(engine.hardwareEncoders).some((list) => list.length > 0);

  cached = engine;
  return engine;
}

export function getEngineSync() {
  return cached;
}
