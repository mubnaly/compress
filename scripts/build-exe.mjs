import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST_NATIVE = path.join(ROOT, 'dist-native');
const DIST_SERVER = path.join(ROOT, 'dist-server');

async function main() {
  console.log('🚀 Building Plico standalone Windows executable (.exe)...');
  await fsp.mkdir(DIST_NATIVE, { recursive: true });
  await fsp.mkdir(DIST_SERVER, { recursive: true });

  // 1. Build frontend if not present
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.log('📦 Building frontend assets...');
    execSync('npm run build', { stdio: 'inherit' });
  }

  // 2. Bundle backend into single CommonJS file
  console.log('📦 Bundling backend with esbuild...');
  execSync(
    'npx --yes esbuild server/index.js --bundle --platform=node --target=node20 --outfile=dist-server/server.cjs --format=cjs --define:import.meta.url=\'""\'',
    { stdio: 'inherit' }
  );

  // 3. Create SEA config
  const seaConfig = {
    main: 'dist-server/server.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
  };
  await fsp.writeFile(path.join(ROOT, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));

  // 4. Generate SEA blob
  console.log('⚡ Generating Node SEA blob...');
  execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

  // 5. Ensure existing executable is not locked by a running instance
  const outExe = path.join(DIST_NATIVE, 'Plico-Video-Compressor.exe');
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM Plico-Video-Compressor.exe', { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      // Process was not running
    }
  }

  if (fs.existsSync(outExe)) {
    try {
      await fsp.unlink(outExe);
    } catch (err) {
      if (err.code === 'EBUSY') {
        console.log('⚠️ Target executable is locked by an active process, terminating it...');
        if (process.platform === 'win32') {
          try {
            execSync('taskkill /F /IM Plico-Video-Compressor.exe', { stdio: 'ignore' });
            await new Promise((r) => setTimeout(r, 1000));
            await fsp.unlink(outExe);
          } catch (killErr) {
            throw new Error(`Cannot overwrite ${outExe} because it is currently running. Please close the app and retry.`);
          }
        }
      } else {
        throw err;
      }
    }
  }

  // 6. Copy node binary
  console.log(`📋 Copying Node.js binary (${process.execPath}) -> ${outExe}...`);
  await fsp.copyFile(process.execPath, outExe);

  // 7. Inject blob into exe via postject
  console.log('💉 Injecting SEA blob into executable with postject...');
  execSync(
    `npx --yes postject "${outExe}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: 'inherit' }
  );

  const stats = await fsp.stat(outExe);
  console.log(`✅ Successfully built standalone Windows executable: ${outExe} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error('❌ Build failed:', err.message || err);
  process.exit(1);
});
