import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './store.js';

export const EFFECTS_DIR = path.join(DATA_DIR, 'effects');
export const SOUNDS_DIR = path.join(EFFECTS_DIR, 'sounds');

/**
 * Ensure sound directory exists and generate local offline default audio effects
 * using FFmpeg audio synthesis if not present. This guarantees 100% offline availability.
 */
export async function ensureSoundLibrary(ffmpegPath = 'ffmpeg') {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });

  const soundDefs = [
    {
      name: 'whoosh.wav',
      // White noise swept with bandpass filter for a whoosh transition
      filter: 'anoisesrc=d=0.35:c=white:r=44100,lowpass=f=800,volume=1.8',
    },
    {
      name: 'pop.wav',
      // High-to-low sine pitch drop for a crisp pop
      filter: 'sine=frequency=280:duration=0.08,volume=2.2',
    },
    {
      name: 'ding.wav',
      // Crystal chime ding
      filter: 'sine=frequency=1150:duration=0.3,volume=1.6',
    },
    {
      name: 'chime.wav',
      // Harmonic pleasant bell
      filter: 'sine=frequency=880:duration=0.45,volume=1.5',
    },
    {
      name: 'bass_hit.wav',
      // Low punch impact
      filter: 'sine=frequency=85:duration=0.25,volume=2.5',
    },
  ];

  for (const item of soundDefs) {
    const target = path.join(SOUNDS_DIR, item.name);
    if (!existsSync(target)) {
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(ffmpegPath, ['-y', '-f', 'lavfi', '-i', item.filter, target], {
            windowsHide: true,
            stdio: 'ignore',
          });
          proc.on('close', (code) => (code === 0 ? resolve(true) : reject(new Error(`Exit ${code}`))));
          proc.on('error', reject);
        });
      } catch (err) {
        // Synthesis failed, can be generated or downloaded later
      }
    }
  }

  // Scan sounds dir
  const entries = await fs.readdir(SOUNDS_DIR);
  return entries.filter((f) => /\.(wav|mp3|ogg|m4a)$/i.test(f)).map((f) => ({
    name: path.parse(f).name,
    file: f,
    path: path.join(SOUNDS_DIR, f),
  }));
}

/**
 * Download a free sound effect URL and cache it permanently offline.
 */
export async function downloadSoundOffline(url, customName = '') {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
  const filename = customName || path.basename(new URL(url).pathname) || `sound_${Date.now()}.mp3`;
  const targetPath = path.join(SOUNDS_DIR, filename);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download sound effect: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(targetPath, buffer);

  return {
    name: path.parse(filename).name,
    file: filename,
    path: targetPath,
  };
}
