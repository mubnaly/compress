import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function start(label, scriptPath, extraArgs = []) {
  const child = spawn(process.execPath, [scriptPath, ...extraArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev] ${label} exited with code ${code}`);
    }
  });
  children.push(child);
  return child;
}

start('engine', path.join(ROOT, 'server', 'index.js'));
start('vite', path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'));

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
