/**
 * Preset catalogue plus the bitrate arithmetic recovered from the target app:
 *   videoKbps = (targetBytes * 8) / duration / 1000 - audioKbps
 *
 * Trimming, cropping and rotation are folded into every calculation so estimates
 * and the encoder agree on the final frame and runtime.
 */

export const PRESETS = [
  {
    id: 'optimal',
    label: 'Optimal quality',
    badge: 'Recommended',
    summary: 'Keeps the original resolution and applies perceptual CRF rate control.',
  },
  {
    id: 'medium',
    label: 'Medium quality',
    badge: 'Balanced',
    summary: 'Downscales to 720p for a large size cut with minimal visible loss.',
  },
  {
    id: 'small',
    label: 'Small size',
    badge: 'Max savings',
    summary: 'Downscales to 480p with a constrained bitrate.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    badge: '16 MB cap',
    summary: 'Solves the bitrate so the output fits a 16 MB chat attachment.',
  },
  {
    id: 'gmail',
    label: 'Gmail',
    badge: '25 MB cap',
    summary: 'Solves the bitrate so the output fits a 25 MB email attachment.',
  },
  {
    id: 'custom_size',
    label: 'Custom file size',
    badge: 'Exact size',
    summary: 'Pick a target size in MB and the bitrate is calculated for you.',
  },
  {
    id: 'custom_resolution',
    label: 'Custom resolution',
    badge: 'Precise',
    summary: 'Set exact width and height with optional aspect-ratio locking.',
  },
];

export const PRESET_IDS = PRESETS.map((preset) => preset.id);
export const SIZE_CAPS = { whatsapp: 16 * 1024 * 1024, gmail: 25 * 1024 * 1024 };
export const SIZE_MARGIN = 0.95;
export const MIN_VIDEO_KBPS = 80;
export const KNOWN_ROTATIONS = [0, 90, 180, 270];

// Bits-per-pixel-per-frame heuristics used to preview output sizes.
const BPP = { h264: 0.075, hevc: 0.055, av1: 0.045, vp9: 0.05 };

const CODEC_LABELS = { h264: 'H.264', hevc: 'H.265 / HEVC', av1: 'AV1', vp9: 'VP9' };

export function even(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function scaleToHeight(width, height, targetHeight) {
  const safeHeight = Math.max(2, even(Math.min(targetHeight, height)));
  const ratio = safeHeight / height;
  return { width: Math.max(2, even(width * ratio)), height: safeHeight };
}

export function normalizeRotation(value) {
  const rotation = Number(value);
  return KNOWN_ROTATIONS.includes(rotation) ? rotation : 0;
}

/**
 * Resolve the encoded time range. `active` is false when the whole clip is kept.
 */
export function trimWindow(probe, options = {}) {
  const total = Number(probe.durationSeconds) || 0;
  const rawStart = Number(options.startSeconds);
  const rawEnd = Number(options.endSeconds);

  const start = Number.isFinite(rawStart) ? Math.min(Math.max(0, rawStart), Math.max(0, total - 0.2)) : 0;
  const end = Number.isFinite(rawEnd) && rawEnd > start ? Math.min(total || rawEnd, rawEnd) : total;
  const duration = Math.max(0.2, end - start);

  return {
    start: Math.round(start * 1000) / 1000,
    end: Math.round((start + duration) * 1000) / 1000,
    duration: Math.round(duration * 1000) / 1000,
    active: start > 0.05 || duration < total - 0.05,
  };
}

/**
 * Resolve the crop rectangle in source pixels (even, inside bounds).
 */
export function cropWindow(probe, options = {}) {
  const sourceWidth = probe.video.displayWidth || probe.video.width;
  const sourceHeight = probe.video.displayHeight || probe.video.height;
  const raw = options.crop;

  if (!raw) {
    return { x: 0, y: 0, width: even(sourceWidth), height: even(sourceHeight), active: false };
  }

  const width = Math.max(16, even(clamp(Number(raw.width) || sourceWidth, 16, sourceWidth)));
  const height = Math.max(16, even(clamp(Number(raw.height) || sourceHeight, 16, sourceHeight)));
  const x = clamp(even(Number(raw.x) || 0), 0, Math.max(0, sourceWidth - width));
  const y = clamp(even(Number(raw.y) || 0), 0, Math.max(0, sourceHeight - height));

  return {
    x,
    y,
    width,
    height,
    active: x > 0 || y > 0 || width < even(sourceWidth) || height < even(sourceHeight),
  };
}

/** Frame size after cropping and rotation, before any quality preset scaling. */
export function baseDimensions(probe, options = {}) {
  const crop = cropWindow(probe, options);
  const rotation = normalizeRotation(options.rotation);
  const swapped = rotation === 90 || rotation === 270;

  return {
    crop,
    rotation,
    width: swapped ? crop.height : crop.width,
    height: swapped ? crop.width : crop.height,
  };
}

export function presetDimensions(probe, preset, options = {}) {
  const base = baseDimensions(probe, options);

  if (preset === 'medium') {
    return {
      ...scaleToHeight(base.width, base.height, 720),
      scaled: base.height > 720,
      crop: base.crop,
      rotation: base.rotation,
    };
  }

  if (preset === 'small') {
    return {
      ...scaleToHeight(base.width, base.height, 480),
      scaled: base.height > 480,
      crop: base.crop,
      rotation: base.rotation,
    };
  }

  if (preset === 'custom_resolution') {
    return {
      width: even(options.targetWidth ?? base.width),
      height: even(options.targetHeight ?? base.height),
      scaled: true,
      crop: base.crop,
      rotation: base.rotation,
    };
  }

  return {
    width: even(base.width),
    height: even(base.height),
    scaled: base.rotation !== 0 || base.crop.active,
    crop: base.crop,
    rotation: base.rotation,
  };
}

export function validateCustomResolution(probe, options) {
  const base = baseDimensions(probe, options);
  const width = Number(options.targetWidth);
  const height = Number(options.targetHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height)) return 'Enter a width and a height.';
  if (width < 128 || height < 128) return 'Width and height must be at least 128 pixels.';
  if (width % 2 !== 0 || height % 2 !== 0) return 'Width and height must be even numbers.';
  if (width > base.width || height > base.height) {
    return 'Custom resolution cannot exceed the source bounds.';
  }
  return null;
}

export function audioKbpsFor(probe, options = {}) {
  if (options.removeAudio || !probe.audio) return 0;
  const requested = Number(options.audioBitrateKbps);
  if (Number.isFinite(requested) && requested > 0) return Math.round(requested);
  return Math.min(192, Math.max(96, probe.audio.bitrateKbps || 128));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Estimate the encoded size for a preset without running a full encode.
 */
export function estimate({ probe, preset, options = {} }) {
  const codec = options.codec || 'h264';
  const bpp = BPP[codec] ?? BPP.h264;
  const totalDuration = Number(probe.durationSeconds) || 0;
  if (!totalDuration) return { ok: false, error: 'This file has no readable duration, so a size cannot be estimated.' };

  const window = trimWindow(probe, options);
  const duration = window.duration;
  const originalBytes = Number(probe.fileSizeBytes) || 0;
  const fps = Number(probe.video.fps) || 30;
  const audioKbps = audioKbpsFor(probe, options);
  const dims = presetDimensions(probe, preset, options);
  const warnings = [];
  const codecLabel = CODEC_LABELS[codec] || codec;

  if (preset === 'custom_resolution') {
    const invalid = validateCustomResolution(probe, options);
    if (invalid) return { ok: false, error: invalid };
  }

  const capBytes = SIZE_CAPS[preset] ?? null;
  const targetBytes =
    preset === 'custom_size'
      ? Number(options.targetSizeMB) > 0
        ? Number(options.targetSizeMB) * 1024 * 1024
        : null
      : capBytes;

  if (preset === 'custom_size' && !targetBytes) {
    return { ok: false, error: 'Enter a target size in megabytes.' };
  }

  let videoKbps;
  let mode = 'crf';

  if (targetBytes) {
    const budgetKbps = (targetBytes * 8 * SIZE_MARGIN) / duration / 1000;
    videoKbps = budgetKbps - audioKbps;
    mode = 'bitrate';

    if (videoKbps < MIN_VIDEO_KBPS) {
      return {
        ok: false,
        error: `A ${(targetBytes / 1024 / 1024).toFixed(1)} MB target is too small for ${Math.round(duration)}s of video. Pick a larger size.`,
      };
    }
    if (capBytes && originalBytes <= capBytes) {
      const label = preset === 'whatsapp' ? 'WhatsApp' : 'Gmail';
      warnings.push(`This video is already smaller than ${(capBytes / 1024 / 1024).toFixed(0)} MB required by ${label}.`);
    }
  } else if (preset === 'medium') {
    mode = 'bitrate';
    videoKbps = clamp((bpp * 1.15 * dims.width * dims.height * fps) / 1000, 500, 3200);
  } else if (preset === 'small') {
    mode = 'bitrate';
    videoKbps = clamp((bpp * 1.1 * dims.width * dims.height * fps) / 1000, 220, 950);
  } else {
    videoKbps = clamp((bpp * dims.width * dims.height * fps) / 1000, 160, 26000);
  }

  videoKbps = Math.round(videoKbps);
  const totalKbps = videoKbps + audioKbps;
  const outputSizeBytes = Math.round(((totalKbps * 1000) / 8) * duration);
  const reductionPercent = originalBytes ? ((originalBytes - outputSizeBytes) / originalBytes) * 100 : 0;

  if (outputSizeBytes >= originalBytes && !targetBytes) {
    warnings.push('This output would not be smaller. The already-optimal guard will keep your original file.');
  } else if (probe.alreadyOptimal?.likely && !targetBytes) {
    warnings.push('This file is already efficiently encoded, so the savings will be small.');
  }

  return {
    ok: true,
    preset,
    codec,
    codecLabel,
    mode,
    durationSeconds: duration,
    totalDurationSeconds: totalDuration,
    trimStart: window.start,
    trimEnd: window.end,
    trimActive: window.active,
    width: dims.width,
    height: dims.height,
    videoBitrateKbps: videoKbps,
    audioBitrateKbps: audioKbps,
    totalBitrateKbps: totalKbps,
    outputSizeBytes,
    originalSizeBytes: originalBytes,
    reductionPercent: Math.round(reductionPercent * 10) / 10,
    targetSizeBytes: targetBytes,
    warnings,
  };
}
