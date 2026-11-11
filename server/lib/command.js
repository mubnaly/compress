import {
  audioKbpsFor,
  baseDimensions,
  cropWindow,
  estimate,
  normalizeRotation,
  presetDimensions,
  trimWindow,
} from './presets.js';

export function containerFor(codec, requested) {
  if (codec === 'vp9') return 'webm';
  return requested === 'mkv' ? 'mkv' : 'mp4';
}

export function extensionFor(codec, requestedContainer) {
  return containerFor(codec, requestedContainer);
}

export function resolveEncoder(engine, codec, hardware) {
  if (hardware && engine?.hardwareEncoders?.[codec]?.length) {
    return { name: engine.hardwareEncoders[codec][0], hardware: true };
  }
  const software = engine?.softwareEncoders?.[codec];
  if (software) return { name: software, hardware: false };
  const fallback = engine?.softwareEncoders?.h264 || 'libx264';
  return { name: fallback, hardware: false, fallback: true };
}

function familyOf(encoderName) {
  if (encoderName.includes('nvenc')) return 'nvenc';
  if (encoderName.includes('qsv')) return 'qsv';
  if (encoderName.includes('amf')) return 'amf';
  if (encoderName.includes('videotoolbox')) return 'videotoolbox';
  if (encoderName.includes('vaapi')) return 'vaapi';
  return 'software';
}

function qualityArgs(encoder, plan) {
  const family = familyOf(encoder.name);

  if (plan.mode === 'bitrate') {
    const kbps = Math.max(80, Math.round(plan.videoBitrateKbps));
    const maxRate = Math.round(kbps * 1.25);
    switch (family) {
      case 'nvenc':
        return ['-preset', 'p2', '-tune', 'll', '-rc', 'vbr', '-b:v', `${kbps}k`, '-maxrate', `${maxRate}k`, '-bufsize', `${kbps * 2}k`];
      case 'qsv':
        return ['-b:v', `${kbps}k`, '-maxrate', `${maxRate}k`];
      case 'amf':
        return ['-b:v', `${kbps}k`];
      case 'videotoolbox':
        return ['-b:v', `${kbps}k`];
      default:
        return [
          '-preset', 'veryfast',
          '-b:v', `${kbps}k`,
          '-maxrate', `${maxRate}k`,
          '-bufsize', `${kbps * 2}k`,
        ];
    }
  }

  if (family === 'software') {
    switch (encoder.name) {
      case 'libx264':
      case 'libx265':
        return ['-preset', 'veryfast', '-crf', '27'];
      case 'libsvtav1':
        return ['-preset', '8', '-crf', '32'];
      case 'libaom-av1':
        return ['-cpu-used', '6', '-crf', '32', '-b:v', '0'];
      case 'libvpx-vp9':
        return ['-deadline', 'good', '-cpu-used', '3', '-crf', '33', '-b:v', '0'];
      case 'libopenh264':
        return ['-b:v', '2500k'];
      default:
        return ['-crf', '27'];
    }
  }

  switch (family) {
    case 'nvenc':
      return ['-preset', 'p2', '-tune', 'll', '-rc', 'vbr', '-cq', '27', '-b:v', '0'];
    case 'qsv':
      return ['-global_quality', '27'];
    case 'amf':
      return ['-rc', 'cqp', '-qp_i', '26', '-qp_p', '26'];
    case 'videotoolbox':
      return ['-q:v', '55'];
    case 'vaapi':
      return ['-qp', '27'];
    default:
      return ['-crf', '27'];
  }
}

/**
 * HDR (PQ/HLG, Rec.2020) is converted to Rec.709 so a 10-bit phone clip does not
 * come out grey and washed out after an 8-bit H.264 encode.
 */
const TONEMAP_CHAIN = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=mobius',
  'zscale=t=bt709:m=bt709:r=tv',
  'format=yuv420p',
];

function audioArgs({ probe, options, container, plan }) {
  if (options.removeAudio) return ['-an'];
  if (!probe.audio || audioKbpsFor(probe, options) === 0) return ['-an'];

  const volume = Number(options.volume);
  const wantsFilter = Number.isFinite(volume) && Math.abs(volume - 1) > 0.001;
  const wantsBitrateMode = plan.mode === 'bitrate';
  const requestedCodec = options.audioCodec || null;

  if (!wantsFilter && !wantsBitrateMode && !requestedCodec && container === 'mp4') {
    return ['-c:a', 'copy'];
  }

  let codec = 'aac';
  if (container === 'webm') codec = 'libopus';
  else if (requestedCodec === 'opus') codec = 'libopus';
  else if (requestedCodec === 'mp3') codec = 'libmp3lame';

  const kbps = Math.max(32, Math.round(plan.audioBitrateKbps || audioKbpsFor(probe, options) || 128));
  const args = [];
  if (wantsFilter) {
    const gain = Math.min(10, Math.max(0, volume));
    const filter = gain > 1 ? `volume=${gain.toFixed(2)},alimiter=limit=0.95` : `volume=${gain.toFixed(2)}`;
    args.push('-af', filter);
  }
  args.push('-c:a', codec, '-b:a', `${kbps}k`);
  return args;
}

/**
 * Build the complete FFmpeg argument vector. No shell is involved anywhere,
 * so paths with spaces and non-ASCII names are safe.
 */
export function buildFfmpegArgs({ engine, inputPath, outputPath, probe, preset, options = {}, plan }) {
  const codec = options.codec || 'h264';
  const container = containerFor(codec, options.container);
  const resolvedPlan = plan ?? estimate({ probe, preset, options });
  if (!resolvedPlan.ok) throw new Error(resolvedPlan.error || 'Invalid preset configuration');

  const trim = trimWindow(probe, options);
  const crop = cropWindow(probe, options);
  const rotation = normalizeRotation(options.rotation);
  const base = baseDimensions(probe, options);
  const dims = presetDimensions(probe, preset, options);
  const encoder = resolveEncoder(engine, codec, Boolean(options.hardwareAcceleration));

  const args = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '0'];

  if (trim.active) args.push('-ss', String(trim.start), '-t', String(trim.duration));

  args.push('-i', inputPath);
  args.push('-map', '0:v:0');
  if (!options.removeAudio && probe.audio) args.push('-map', '0:a:0');
  args.push('-sn');

  const filters = [];
  if (crop.active) filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  if (rotation === 90) filters.push('transpose=1');
  else if (rotation === 270) filters.push('transpose=2');
  else if (rotation === 180) filters.push('hflip', 'vflip');
  if (probe.isHdr && options.tonemap !== false) filters.push(...TONEMAP_CHAIN);
  if (dims.width !== base.width || dims.height !== base.height) {
    filters.push(`scale=${dims.width}:${dims.height}:flags=bicubic`);
  }
  if (filters.length) args.push('-vf', filters.join(','));

  args.push('-c:v', encoder.name, ...qualityArgs(encoder, resolvedPlan));
  args.push(...audioArgs({ probe, options, container, plan: resolvedPlan }));

  if (options.copyMetadata === false) args.push('-map_metadata', '-1');
  else args.push('-map_metadata', '0');
  // The transpose filter already burns the rotation in; drop the tag so players
  // do not rotate the result a second time.
  if (rotation !== 0) args.push('-metadata:s:v:0', 'rotate=0');

  if (container === 'mp4') args.push('-movflags', '+faststart');
  args.push('-pix_fmt', 'yuv420p');

  args.push('-progress', 'pipe:1', '-nostats');
  args.push(outputPath);

  return {
    args,
    encoder: encoder.name,
    container,
    dimensions: dims,
    plan: resolvedPlan,
    trim,
    crop,
    rotation,
  };
}
