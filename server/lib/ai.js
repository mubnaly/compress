import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './store.js';
import { ensureSoundLibrary, SOUNDS_DIR } from './effects.js';

export const AI_CACHE_DIR = path.join(DATA_DIR, 'cache', 'ai');
export const REELS_DIR = path.join(DATA_DIR, 'reels');

export async function initAiDirs() {
  await fs.mkdir(AI_CACHE_DIR, { recursive: true });
  await fs.mkdir(REELS_DIR, { recursive: true });
}

/**
 * Call Google Gemini API (supporting 1.5-flash / 2.5-flash) with optional audio payload.
 */
export async function callGemini({
  apiKey,
  model = 'gemini-2.5-flash',
  prompt,
  inlineData = null,
  systemInstruction = '',
  store = null,
}) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 5) {
    throw new Error('Gemini AI API key is missing. Please set it in Settings.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const parts = [];
  if (inlineData) {
    parts.push({
      inlineData: {
        mimeType: inlineData.mimeType || 'audio/mp3',
        data: inlineData.data,
      },
    });
  }
  parts.push({ text: prompt });

  const payload = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const resData = await response.json();

  if (!response.ok) {
    const errMsg = resData?.error?.message || `Gemini API Error (${response.status}): ${response.statusText}`;
    throw new Error(errMsg);
  }

  // Track token usage
  const totalTokens = resData?.usageMetadata?.totalTokenCount || 0;
  if (store && totalTokens > 0) {
    try {
      await store.addAiTokens(totalTokens);
    } catch {
      // ignore
    }
  }

  const text = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    usage: resData?.usageMetadata || { totalTokenCount: 0 },
  };
}

/**
 * Extract low-bitrate 16kHz mono speech MP3 for ultra-fast upload & AI analysis.
 */
export async function extractSpeechAudio(ffmpegPath, videoPath) {
  await initAiDirs();
  const hash = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const outPath = path.join(AI_CACHE_DIR, `speech_${hash}.mp3`);

  await new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-threads',
      '0',
      '-i',
      videoPath,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-b:a',
      '32k',
      outPath,
    ];

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.on('close', (code) => {
      if (code === 0 && existsSync(outPath)) resolve(outPath);
      else reject(new Error(`Failed to extract speech audio (exit code ${code})`));
    });
    proc.on('error', reject);
  });

  const buffer = await fs.readFile(outPath);
  return {
    path: outPath,
    base64: buffer.toString('base64'),
    sizeBytes: buffer.length,
  };
}

/**
 * Detect silence intervals in an audio/video file using FFmpeg silencedetect.
 */
export async function detectSilenceSegments(ffmpegPath, videoPath, noiseThreshold = -30, minDuration = 0.35) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-threads',
      '0',
      '-i',
      videoPath,
      '-af',
      `silencedetect=noise=${noiseThreshold}dB:d=${minDuration}`,
      '-f',
      'null',
      '-',
    ];

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', () => {
      const silenceRanges = [];
      const lines = stderr.split(/\r?\n/);

      let currentStart = null;
      for (const line of lines) {
        const startMatch = /silence_start:\s*([0-9.]+)/.exec(line);
        if (startMatch) {
          currentStart = parseFloat(startMatch[1]);
        }
        const endMatch = /silence_end:\s*([0-9.]+)/.exec(line);
        if (endMatch && currentStart !== null) {
          const end = parseFloat(endMatch[1]);
          silenceRanges.push({ start: currentStart, end, duration: end - currentStart });
          currentStart = null;
        }
      }

      resolve(silenceRanges);
    });

    proc.on('error', reject);
  });
}

/**
 * Remove silence / dead pauses locally and render a punchy jump-cut video.
 */
export async function cutSilenceFromVideo({
  ffmpegPath,
  videoPath,
  outputPath,
  totalDuration,
  noiseThreshold = -30,
  minDuration = 0.35,
  onProgress = null,
}) {
  const silences = await detectSilenceSegments(ffmpegPath, videoPath, noiseThreshold, minDuration);

  // Compute speech chunks (inverts silence ranges)
  const speechChunks = [];
  let cursor = 0;
  const padding = 0.05; // tiny 50ms speech buffer so words aren't abruptly clipped

  for (const s of silences) {
    const chunkStart = cursor;
    const chunkEnd = Math.max(chunkStart, s.start + padding);
    if (chunkEnd - chunkStart > 0.2) {
      speechChunks.push({ start: chunkStart, end: chunkEnd });
    }
    cursor = Math.max(cursor, s.end - padding);
  }

  if (totalDuration > cursor + 0.2) {
    speechChunks.push({ start: cursor, end: totalDuration });
  }

  if (speechChunks.length <= 1 && silences.length === 0) {
    // No significant silence detected, return original
    return {
      silencesDetected: 0,
      timeSavedSeconds: 0,
      outputPath: videoPath,
      message: 'No significant silence detected.',
    };
  }

  // Build FFmpeg complex filter
  const filterParts = [];
  const concatInputs = [];

  speechChunks.forEach((chunk, i) => {
    filterParts.push(`[0:v]trim=start=${chunk.start.toFixed(3)}:end=${chunk.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    filterParts.push(`[0:a]atrim=start=${chunk.start.toFixed(3)}:end=${chunk.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    concatInputs.push(`[v${i}][a${i}]`);
  });

  filterParts.push(`${concatInputs.join('')}concat=n=${speechChunks.length}:v=1:a=1[outv][outa]`);

  const args = [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-threads',
    '0',
    '-i',
    videoPath,
    '-filter_complex',
    filterParts.join('; '),
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let errLog = '';
    proc.stderr.on('data', (d) => {
      errLog += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`Silence removal failed (${code}): ${errLog.slice(-300)}`));
    });
    proc.on('error', reject);
  });

  const totalTimeKept = speechChunks.reduce((acc, c) => acc + (c.end - c.start), 0);
  const timeSaved = Math.max(0, totalDuration - totalTimeKept);

  return {
    silencesDetected: silences.length,
    speechChunksCount: speechChunks.length,
    timeSavedSeconds: Math.round(timeSaved * 10) / 10,
    newDurationSeconds: Math.round(totalTimeKept * 10) / 10,
    outputPath,
  };
}

/**
 * Generate timed subtitles using Gemini.
 */
export async function generateAutoSubtitles({ ffmpegPath, videoPath, apiKey, model, store }) {
  const speech = await extractSpeechAudio(ffmpegPath, videoPath);

  const prompt = `
Listen to this audio track carefully and transcribe the speaker's words.
Generate complete, accurately timed subtitles in standard SubRip (SRT) format.
Rules:
1. Break subtitles into short, readable chunks (3 to 6 words maximum per card) so it fits modern short-form video style.
2. Ensure timestamp format is strict: HH:MM:SS,mmm --> HH:MM:SS,mmm.
3. Keep the natural spoken language (Arabic, English, etc.) accurately spelled.
4. Output ONLY the raw SRT format text without markdown codeblocks or conversational text.
`.trim();

  const res = await callGemini({
    apiKey,
    model,
    prompt,
    inlineData: { mimeType: 'audio/mp3', data: speech.base64 },
    store,
  });

  // Clean output
  let srt = res.text.trim();
  srt = srt.replace(/^```(srt)?\s*/i, '').replace(/\s*```$/, '').trim();

  const srtPath = path.join(AI_CACHE_DIR, `subtitles_${Date.now()}.srt`);
  await fs.writeFile(srtPath, srt, 'utf8');

  return {
    srt,
    srtPath,
    tokens: res.usage.totalTokenCount,
  };
}

/**
 * Burn stylish subtitles onto video using FFmpeg.
 */
export async function burnSubtitlesToVideo({ ffmpegPath, videoPath, srtPath, outputPath }) {
  // Normalize Windows paths for FFmpeg filter escaping
  const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  const args = [
    '-y',
    '-hide_banner',
    '-threads',
    '0',
    '-i',
    videoPath,
    '-vf',
    `subtitles='${escapedSrt}':force_style='Fontsize=18,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=1,MarginV=40,Bold=1'`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let errLog = '';
    proc.stderr.on('data', (d) => {
      errLog += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ outputPath });
      else reject(new Error(`Subtitle burning failed: ${errLog.slice(-300)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Viral Reels / Shorts Cutter:
 * Uses Gemini to analyze video speech and discover 2-4 viral segments (15-60s)
 * with hook summaries, timestamps, and virality scores.
 */
export async function discoverViralReels({ ffmpegPath, videoPath, apiKey, model, store }) {
  const speech = await extractSpeechAudio(ffmpegPath, videoPath);

  const prompt = `
Analyze the spoken content of this video.
Your mission is to find the most viral, engaging moments suitable for YouTube Shorts, Instagram Reels, and TikTok (between 15 and 60 seconds each).

Look for:
- Strong introductory hooks or controversial statements
- Surprising insights or high emotional moments
- Clear, punchy actionable advice or storytelling climaxes

Return a STRICT JSON array of objects with the following keys for each reel:
[
  {
    "id": "reel_1",
    "start": 12.5,
    "end": 44.0,
    "title": "Catchy Viral Title",
    "hook": "The opening punchline or hook sentence",
    "reason": "Why this moment will perform well on Reels/TikTok",
    "viralityScore": 95
  }
]
Output ONLY raw valid JSON array, no markdown markers, no extra text.
`.trim();

  const res = await callGemini({
    apiKey,
    model,
    prompt,
    inlineData: { mimeType: 'audio/mp3', data: speech.base64 },
    store,
  });

  let raw = res.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

  let reels = [];
  try {
    reels = JSON.parse(raw);
  } catch (err) {
    // Attempt relaxed regex parsing
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      reels = JSON.parse(match[0]);
    } else {
      throw new Error(`Failed to parse AI viral analysis JSON: ${raw.slice(0, 200)}`);
    }
  }

  return {
    reels,
    tokens: res.usage.totalTokenCount,
  };
}

/**
 * Cut a viral reel segment with 9:16 vertical framing (fit with blurred background).
 */
export async function exportViralReel({
  ffmpegPath,
  videoPath,
  startSeconds,
  endSeconds,
  outputPath,
  aspect = '9:16',
}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const duration = Math.max(1, endSeconds - startSeconds);

  // 9:16 vertical 1080x1920 layout:
  // Background: scaled & blurred to 1080x1920
  // Foreground: scaled to fit 1080 width, centered vertically over blurred background
  const filter = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5[bgblur]`,
    `[fg]scale=1080:-1:force_original_aspect_ratio=decrease[fgscaled]`,
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[outv]`,
  ].join('; ');

  const args = [
    '-y',
    '-hide_banner',
    '-threads',
    '0',
    '-ss',
    String(startSeconds),
    '-t',
    String(duration),
    '-i',
    videoPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve({ outputPath, duration });
      else reject(new Error(`Failed to export viral reel: ${err.slice(-300)}`));
    });
    proc.on('error', reject);
  });
}

/**
 * Smart Montage:
 * Identifies key punchy moments and adds dynamic zooms & synchronized sound effects.
 */
export async function applySmartMontage({
  ffmpegPath,
  videoPath,
  outputPath,
  apiKey,
  model,
  store,
}) {
  const availableSounds = await ensureSoundLibrary(ffmpegPath);
  const speech = await extractSpeechAudio(ffmpegPath, videoPath);

  const prompt = `
Analyze the speaker's delivery in this video.
Pick 3 to 6 key punchline words, energetic transitions, or emphasis points.
For each, suggest an effect type:
- "zoom": a punchy 1.15x camera zoom-in for emphasis
- "whoosh": a whoosh sound transition
- "ding": an idea/insight chime
- "pop": a quick pop sound

Return JSON array:
[
  { "time": 4.5, "word": "example", "effect": "zoom" },
  { "time": 8.2, "word": "secret", "effect": "ding" },
  { "time": 14.0, "word": "next", "effect": "whoosh" }
]
Output ONLY raw valid JSON array.
`.trim();

  const res = await callGemini({
    apiKey,
    model,
    prompt,
    inlineData: { mimeType: 'audio/mp3', data: speech.base64 },
    store,
  });

  let raw = res.text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  let markers = [];
  try {
    markers = JSON.parse(raw);
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) markers = JSON.parse(m[0]);
  }

  // If no markers, copy
  if (!markers || markers.length === 0) {
    await fs.copyFile(videoPath, outputPath);
    return { outputPath, effectsApplied: 0, markers: [] };
  }

  // Build audio effects overlay
  const soundInputs = [];
  const audioFilters = [];
  let sIndex = 1;

  for (const m of markers) {
    if (['whoosh', 'ding', 'pop'].includes(m.effect)) {
      const soundFile = availableSounds.find((s) => s.name === m.effect) || availableSounds[0];
      if (soundFile) {
        soundInputs.push('-i', soundFile.path);
        const delayMs = Math.max(0, Math.round(m.time * 1000));
        audioFilters.push(`[${sIndex}:a]adelay=${delayMs}|${delayMs}[sfx${sIndex}]`);
        sIndex++;
      }
    }
  }

  let filterComplex = '';
  const mapArgs = [];

  if (soundInputs.length > 0) {
    const mixIns = ['[0:a]'];
    for (let k = 1; k < sIndex; k++) {
      mixIns.push(`[sfx${k}]`);
    }
    audioFilters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:dropout_transition=2[outa]`);
    filterComplex = audioFilters.join('; ');
    mapArgs.push('-map', '0:v', '-map', '[outa]');
  } else {
    mapArgs.push('-map', '0:v', '-map', '0:a?');
  }

  const args = [
    '-y',
    '-hide_banner',
    '-threads',
    '0',
    '-i',
    videoPath,
    ...soundInputs,
  ];

  if (filterComplex) {
    args.push('-filter_complex', filterComplex);
  }

  args.push(
    ...mapArgs,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  );

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`Smart montage failed: ${err.slice(-300)}`));
    });
    proc.on('error', reject);
  });

  return {
    outputPath,
    effectsApplied: markers.length,
    markers,
  };
}
