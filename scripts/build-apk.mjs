import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST_NATIVE = path.join(ROOT, 'dist-native');
const ANDROID_DIR = path.join(ROOT, 'android');

async function main() {
  console.log('🤖 Building Plico Android APK (.apk)...');
  await fsp.mkdir(DIST_NATIVE, { recursive: true });

  // 1. Build frontend
  console.log('📦 Building frontend assets...');
  execSync('npm run build', { stdio: 'inherit' });

  // 2. Sync with Capacitor
  console.log('🔄 Syncing with Capacitor Android...');
  execSync('npx cap sync android', { stdio: 'inherit' });

  // 3. Resolve SDK & Java environments
  const env = { ...process.env };
  if (!env.JAVA_HOME) {
    const candidates = [
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17',
      'C:\\Program Files\\Java\\jdk-17',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        env.JAVA_HOME = c;
        break;
      }
    }
  }

  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    const candidates = [
      'D:\\programs\\android_sdk',
      path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        env.ANDROID_HOME = c;
        env.ANDROID_SDK_ROOT = c;
        break;
      }
    }
  }

  console.log(`☕ Using JAVA_HOME: ${env.JAVA_HOME}`);
  console.log(`📱 Using ANDROID_HOME: ${env.ANDROID_HOME}`);

  // 4. Run Gradle assembleDebug
  console.log('⚙️ Compiling APK with Gradle...');
  const gradlewCmd = process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug';
  execSync(gradlewCmd, {
    cwd: ANDROID_DIR,
    env,
    stdio: 'inherit',
  });

  // 5. Copy output APK
  const outputApk = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const targetApk = path.join(DIST_NATIVE, 'Rasheeq.apk');
  const legacyApk = path.join(DIST_NATIVE, 'Plico-Video-Compressor.apk');
  if (fs.existsSync(outputApk)) {
    await fsp.copyFile(outputApk, targetApk);
    await fsp.copyFile(outputApk, legacyApk);
    const stats = await fsp.stat(targetApk);
    console.log(`✅ Successfully built Android APK: ${targetApk} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    throw new Error(`APK was not generated at expected path: ${outputApk}`);
  }
}

main().catch((err) => {
  console.error('❌ APK build failed:', err);
  process.exit(1);
});
