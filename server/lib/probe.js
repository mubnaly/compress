import path from 'node:path';
import fs from 'node:fs/promises';
import { execCapture } from './ffmpeg.js';

function parseRate(value) {
  if (!value) return 0;
  const [num, den] = String(value).split('/').map(Number);
  if (!Number.isFinite(num)) return 0;
  if (!den) return num;
  return num / den;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rotationOf(stream) {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  const rotational = sideData.find((entry) => typeof entry.rotation === 'number');
  if (rotational) return Math.abs(Math.round(rotational.rotation)) % 360;
  const tag = Number(stream.tags?.rotate);
  if (Number.isFinite(tag)) return Math.abs(Math.round(tag)) % 360;
  return 0;
}

function isHdrStream(stream) {
  const transfer = stream.color_transfer || stream.color_transfer_characteristics || '';
  if (transfer === 'smpte2084' || transfer === 'arib-std-b67') return true;
  if (stream.color_primaries === 'bt2020') return true;
  return Boolean(stream.pix_fmt && /10|12/.test(stream.pix_fmt.replace(/[a-z]/g, '')) && stream.color_space === 'bt2020nc');
}

/**
 * Read container + stream metadata with ffprobe and normalise it for the UI.
 */
export async function probeFile(engine, filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Not a file');

  const { code, stdout, stderr } = await execCapture(
    engine.ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 45_000 },
  );

  if (code !== 0) {
    throw new Error(`Could not read this file with ffprobe. ${(stderr || '').trim() || `exit code ${code}`}`);
  }

  const data = JSON.parse(stdout);
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  if (!video) throw new Error('No video stream found in this file');

  const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
  const format = data.format || {};

  const rotation = rotationOf(video);
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const rotated = rotation === 90 || rotation === 270;
  const displayWidth = rotated ? height : width;
  const displayHeight = rotated ? width : height;

  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
  const durationSeconds = Number(format.duration) || Number(video.duration) || 0;
  const fileSizeBytes = Number(format.size) || stat.size;
  const totalBitrateKbps = Number(format.bit_rate)
    ? Math.round(Number(format.bit_rate) / 1000)
    : Math.round((fileSizeBytes * 8) / Math.max(durationSeconds, 0.001) / 1000);
  const videoBitrateKbps = Number(video.bit_rate)
    ? Math.round(Number(video.bit_rate) / 1000)
    : Math.round((Number(video.tags?.BPS) || 0) / 1000) || null;

  const bitsPerPixel =
    videoBitrateKbps && displayWidth && displayHeight && fps
      ? round((videoBitrateKbps * 1000) / (displayWidth * displayHeight * fps), 4)
      : null;

  const alreadyOptimalLikely = bitsPerPixel !== null && bitsPerPixel < 0.035;

  return {
    path: path.resolve(filePath),
    fileName: path.basename(filePath),
    directory: path.dirname(path.resolve(filePath)),
    fileSizeBytes,
    durationSeconds: round(durationSeconds, 3),
    formatName: format.format_name || null,
    formatLongName: format.format_long_name || null,
    totalBitrateKbps,
    rotation,
    isHdr: isHdrStream(video),
    bitsPerPixel,
    alreadyOptimal: {
      likely: alreadyOptimalLikely,
      reason: alreadyOptimalLikely
        ? 'This file already uses a very low bitrate for its resolution, so re-encoding may not shrink it.'
        : null,
    },
    video: {
      codec: video.codec_name || 'unknown',
      codecLong: video.codec_long_name || null,
      profile: video.profile || null,
      width,
      height,
      displayWidth,
      displayHeight,
      fps: round(fps, 2),
      bitrateKbps: videoBitrateKbps,
      pixelFormat: video.pix_fmt || null,
    },
    audio: audio
      ? {
          codec: audio.codec_name || 'unknown',
          channels: Number(audio.channels) || 0,
          channelLayout: audio.channel_layout || null,
          sampleRate: Number(audio.sample_rate) || 0,
          bitrateKbps: Number(audio.bit_rate) ? Math.round(Number(audio.bit_rate) / 1000) : null,
        }
      : null,
  };
}
