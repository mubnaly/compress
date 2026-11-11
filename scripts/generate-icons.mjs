import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const LOGO_SRC = path.join(ROOT, 'logo.png');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

async function main() {
  if (!fs.existsSync(LOGO_SRC)) {
    throw new Error('logo.png not found at project root');
  }

  await fsp.mkdir(PUBLIC_DIR, { recursive: true });

  console.log('🖼️ Copying logo.png to public assets...');
  await fsp.copyFile(LOGO_SRC, path.join(PUBLIC_DIR, 'logo.png'));

  // 1. Web icons
  console.log('🌐 Generating web favicons and apple touch icons...');
  execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf scale=256:256 "${path.join(PUBLIC_DIR, 'favicon.ico')}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf scale=64:64 "${path.join(PUBLIC_DIR, 'favicon.png')}"`, { stdio: 'ignore' });
  execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf scale=180:180 "${path.join(PUBLIC_DIR, 'apple-touch-icon.png')}"`, { stdio: 'ignore' });

  // 2. Android mipmap icons
  const densities = [
    { dir: 'mipmap-mdpi', size: 48, fgSize: 108 },
    { dir: 'mipmap-hdpi', size: 72, fgSize: 162 },
    { dir: 'mipmap-xhdpi', size: 96, fgSize: 216 },
    { dir: 'mipmap-xxhdpi', size: 144, fgSize: 324 },
    { dir: 'mipmap-xxxhdpi', size: 192, fgSize: 432 },
  ];

  console.log('📱 Generating Android mipmap launcher icons...');
  for (const { dir, size, fgSize } of densities) {
    const targetDir = path.join(RES_DIR, dir);
    if (!fs.existsSync(targetDir)) continue;

    const launcher = path.join(targetDir, 'ic_launcher.png');
    const round = path.join(targetDir, 'ic_launcher_round.png');
    const foreground = path.join(targetDir, 'ic_launcher_foreground.png');

    execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf "scale=${size}:${size}" "${launcher}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf "scale=${size}:${size}" "${round}"`, { stdio: 'ignore' });
    execSync(`ffmpeg -y -i "${LOGO_SRC}" -vf "scale=${fgSize}:${fgSize}" "${foreground}"`, { stdio: 'ignore' });
  }

  console.log('✅ All icons successfully generated from logo.png!');
}

main().catch((err) => {
  console.error('❌ Failed to generate icons:', err);
  process.exit(1);
});
