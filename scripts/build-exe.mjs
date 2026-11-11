import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as ResEdit from 'resedit';

const ROOT = process.cwd();
const DIST_NATIVE = path.join(ROOT, 'dist-native');
const DIST_SERVER = path.join(ROOT, 'dist-server');

async function main() {
  console.log('🚀 Building Rasheeq (رَشيق) standalone Windows executable (.exe)...');
  await fsp.mkdir(DIST_NATIVE, { recursive: true });
  await fsp.mkdir(DIST_SERVER, { recursive: true });

  // 1. Build frontend if not present
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.log('📦 Building frontend assets...');
    execSync('npm run build', { stdio: 'inherit' });
  }

  // 2. Ensure icons are generated
  if (!fs.existsSync(path.join(ROOT, 'public', 'favicon.ico'))) {
    console.log('🖼️ Generating icons...');
    execSync('node scripts/generate-icons.mjs', { stdio: 'inherit' });
  }

  // 3. Bundle backend into single CommonJS file
  console.log('📦 Bundling backend with esbuild...');
  execSync(
    'npx --yes esbuild server/index.js --bundle --platform=node --target=node20 --outfile=dist-server/server.cjs --format=cjs --define:import.meta.url=\'""\'',
    { stdio: 'inherit' }
  );

  // 4. Create SEA config
  const seaConfig = {
    main: 'dist-server/server.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
  };
  await fsp.writeFile(path.join(ROOT, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));

  // 5. Generate SEA blob
  console.log('⚡ Generating Node SEA blob...');
  execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

  // 6. Close running instances
  const outExe = path.join(DIST_NATIVE, 'Rasheeq.exe');
  const legacyExe = path.join(DIST_NATIVE, 'Plico-Video-Compressor.exe');
  if (process.platform === 'win32') {
    try {
      execSync('taskkill /F /IM Rasheeq.exe /IM Plico-Video-Compressor.exe', { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      // Process was not running
    }
  }

  for (const target of [outExe, legacyExe]) {
    if (fs.existsSync(target)) {
      try {
        await fsp.unlink(target);
      } catch (err) {
        if (err.code === 'EBUSY') {
          console.log(`⚠️ Terminating running process locking ${path.basename(target)}...`);
          try {
            execSync(`taskkill /F /IM "${path.basename(target)}"`, { stdio: 'ignore' });
            await new Promise((r) => setTimeout(r, 1000));
            await fsp.unlink(target);
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  // 7. Copy node binary
  console.log(`📋 Copying Node.js binary (${process.execPath}) -> ${outExe}...`);
  await fsp.copyFile(process.execPath, outExe);

  // 8. Inject custom App Icon & Version Information into Windows executable
  const icoPath = path.join(ROOT, 'public', 'favicon.ico');
  if (fs.existsSync(icoPath)) {
    try {
      console.log('🎨 Injecting Rasheeq icon into Windows executable resources...');
      const exeData = await fsp.readFile(outExe);
      const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
      const res = ResEdit.NtExecutableResource.from(exe);
      const iconFile = ResEdit.Data.IconFile.from(await fsp.readFile(icoPath));

      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        1,
        1033,
        iconFile.icons.map((i) => i.data)
      );

      // Set version and product metadata
      const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
      const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
      vi.setStringValues(
        { lang: 1033, codepage: 1200 },
        {
          FileDescription: 'Rasheeq - Video Compressor (رَشيق)',
          ProductName: 'Rasheeq',
          LegalCopyright: 'Copyright © 2026 Rasheeq',
          OriginalFilename: 'Rasheeq.exe',
          InternalName: 'Rasheeq',
        }
      );
      vi.outputToResourceEntries(res.entries);

      res.outputResource(exe);
      await fsp.writeFile(outExe, Buffer.from(exe.generate()));
      console.log('✨ Windows executable icon and metadata injected successfully.');
    } catch (iconErr) {
      console.warn('⚠️ Could not inject icon via ResEdit:', iconErr.message);
    }
  }

  // 9. Inject SEA blob into exe via postject
  console.log('💉 Injecting SEA blob into executable with postject...');
  execSync(
    `npx --yes postject "${outExe}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: 'inherit' }
  );

  // 10. Patch PE subsystem to Windows GUI (2) so no black terminal console window appears
  if (process.platform === 'win32') {
    try {
      const buf = await fsp.readFile(outExe);
      const peOffset = buf.readUInt32LE(0x3c);
      const subsystemOffset = peOffset + 24 + 68;
      const currentSubsystem = buf.readUInt16LE(subsystemOffset);
      if (currentSubsystem === 3) {
        buf.writeUInt16LE(2, subsystemOffset);
        await fsp.writeFile(outExe, buf);
        console.log('✨ Patched executable subsystem to Windows GUI (no console window).');
      }
    } catch (patchErr) {
      console.warn('⚠️ Could not patch PE subsystem:', patchErr.message);
    }
  }

  // Also create a copy for legacy name compatibility
  await fsp.copyFile(outExe, legacyExe);

  const stats = await fsp.stat(outExe);
  console.log(`✅ Successfully built standalone Windows GUI app: ${outExe} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error('❌ Build failed:', err.message || err);
  process.exit(1);
});
