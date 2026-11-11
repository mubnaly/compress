import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectEngine } from './lib/ffmpeg.js';
import { probeFile } from './lib/probe.js';
import { PRESETS, estimate } from './lib/presets.js';
import { CompressionQueue, isVideoPath } from './lib/queue.js';
import { Store, defaultRoots, DATA_DIR } from './lib/store.js';
import { generatePreview, generateThumbnail, cleanPreviews } from './lib/preview.js';

const ROOT = typeof __dirname !== 'undefined'
  ? path.resolve(__dirname, '..')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? process.env.PLICO_PORT ?? 7317);
const HOST = process.env.PLICO_HOST ?? '0.0.0.0';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const store = new Store();
let queue = null;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, error) {
  sendJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body must be valid JSON');
  }
}

function streamFile(req, res, filePath, contentType, isDownload = false) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendError(res, 404, 'File not found');
    return;
  }
  if (!stat.isFile()) {
    sendError(res, 404, 'Not a file');
    return;
  }

  const range = req.headers.range;
  const baseHeaders = {
    'content-type': contentType || MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  };

  if (isDownload) {
    baseHeaders['content-disposition'] = `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`;
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (Number.isFinite(start) && start <= end && start < stat.size) {
        res.writeHead(206, {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'content-length': end - start + 1,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, { ...baseHeaders, 'content-length': stat.size });
  fs.createReadStream(filePath).pipe(res);
}

async function existingRoots() {
  const roots = [];
  for (const candidate of defaultRoots()) {
    try {
      const stat = await fsp.stat(candidate.path);
      if (stat.isDirectory()) roots.push(candidate);
    } catch {
      /* missing folder */
    }
  }
  return roots;
}

async function browseDirectory(target, sortBy = 'date', direction = 'desc') {
  const roots = await existingRoots();
  const requested = typeof target === 'string' && target.trim() ? path.resolve(target.trim()) : null;
  const dir = requested || roots[0]?.path || process.cwd();

  const stat = await fsp.stat(dir);
  if (!stat.isDirectory()) throw new Error('That path is not a folder');

  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const directories = [];
  const videos = [];

  await Promise.all(
    entries.slice(0, 1500).map(async (entry) => {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') return;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          directories.push({ name: entry.name, path: full });
        } else if (isVideoPath(entry.name)) {
          const fileStat = await fsp.stat(full);
          videos.push({
            name: entry.name,
            path: full,
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtimeMs,
          });
        }
      } catch {
        /* unreadable entry */
      }
    }),
  );

  const comparators = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    size: (a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0),
    date: (a, b) => (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0),
  };
  const comparator = comparators[sortBy] ?? comparators.date;
  const sign = direction === 'asc' ? 1 : -1;

  directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  videos.sort((a, b) => sign * comparator(a, b));

  return {
    path: dir,
    parent: path.dirname(dir) === dir ? null : path.dirname(dir),
    roots,
    directories: directories.slice(0, 300),
    videos: videos.slice(0, 500),
  };
}

function revealInFileManager(target) {
  if (process.platform === 'win32') {
    spawn('explorer.exe', [`/select,${path.resolve(target)}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-R', path.resolve(target)], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('xdg-open', [path.dirname(path.resolve(target))], { detached: true, stdio: 'ignore' }).unref();
}

let lastActivity = Date.now();
let hasEverConnected = false;

// If in desktop app mode, auto-terminate when the window is closed and no heartbeats arrive for 15s
setInterval(() => {
  if (hasEverConnected && Date.now() - lastActivity > 15000) {
    process.exit(0);
  }
}, 5000);

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/heartbeat') {
    hasEverConnected = true;
    lastActivity = Date.now();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/shutdown') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100);
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    const engine = await detectEngine();
    return sendJson(res, 200, {
      ok: true,
      engine,
      presets: PRESETS,
      settings: store.getSettings(),
      roots: await existingRoots(),
      queue: queue.list(),
    });
  }

  if (pathname === '/api/presets' && req.method === 'GET') {
    return sendJson(res, 200, { presets: PRESETS });
  }

  if (pathname === '/api/browse' && req.method === 'GET') {
    try {
      const listing = await browseDirectory(
        url.searchParams.get('path') ?? '',
        url.searchParams.get('sort') ?? 'date',
        url.searchParams.get('dir') ?? 'desc',
      );
      return sendJson(res, 200, { ok: true, ...listing });
    } catch (err) {
      return sendError(res, 400, err);
    }
  }

  if (pathname === '/api/media' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return sendError(res, 400, 'Missing path');
    const isDownload = url.searchParams.get('download') === '1';
    return streamFile(req, res, path.resolve(filePath), undefined, isDownload);
  }

  if (pathname === '/api/thumb' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return sendError(res, 400, 'Missing path');
    try {
      const engine = await detectEngine();
      const thumb = await generateThumbnail({
        engine,
        inputPath: path.resolve(filePath),
        timeSeconds: Number(url.searchParams.get('t') ?? 1) || 1,
      });
      return streamFile(req, res, thumb, 'image/jpeg');
    } catch {
      // Unreadable files (offline cloud placeholders, corrupt media) simply have no thumbnail.
      res.writeHead(204, { 'cache-control': 'no-store' });
      return res.end();
    }
  }

  if (pathname === '/api/probe' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.path) return sendError(res, 400, 'Missing path');
      const engine = await detectEngine();
      const probe = await probeFile(engine, path.resolve(body.path));
      return sendJson(res, 200, { ok: true, probe });
    } catch (err) {
      return sendError(res, 422, err);
    }
  }

  if (pathname === '/api/estimate' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const engine = await detectEngine();
      let probe = body.probe;
      if (!probe) {
        if (!body.path) return sendError(res, 400, 'Provide a probe or a path');
        probe = await probeFile(engine, path.resolve(body.path));
      }
      const result = estimate({ probe, preset: body.preset, options: body.options ?? {} });
      return sendJson(res, 200, { ok: true, probe, estimate: result });
    } catch (err) {
      return sendError(res, 422, err);
    }
  }

  if (pathname === '/api/jobs' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, jobs: queue.list() });
  }

  if (pathname === '/api/jobs' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendError(res, 400, 'No files were provided');
      for (const item of items) {
        if (!item?.path) return sendError(res, 400, 'Each job needs an input path');
        await fsp.access(path.resolve(item.path));
      }
      const jobs = queue.add(items);
      return sendJson(res, 201, { ok: true, jobs });
    } catch (err) {
      return sendError(res, 400, err);
    }
  }

  if (pathname === '/api/jobs/clear-finished' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true, ...queue.clearFinished() });
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/(cancel|retry|delete-original))?$/.exec(pathname);
  if (jobMatch) {
    const jobId = jobMatch[1];
    const action = jobMatch[2];

    if (!action && req.method === 'DELETE') {
      return sendJson(res, 200, await queue.remove(jobId));
    }
    if (action === 'cancel' && req.method === 'POST') {
      return sendJson(res, 200, queue.cancel(jobId));
    }
    if (action === 'retry' && req.method === 'POST') {
      return sendJson(res, 200, queue.retry(jobId));
    }
    if (action === 'delete-original' && req.method === 'POST') {
      return sendJson(res, 200, await queue.deleteOriginal(jobId));
    }
  }

  if (pathname === '/api/preview' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.path) return sendError(res, 400, 'Missing path');
      const engine = await detectEngine();
      const inputPath = path.resolve(body.path);
      const probe = body.probe ?? (await probeFile(engine, inputPath));
      const preview = await generatePreview({
        engine,
        inputPath,
        startSeconds: Number(body.startSeconds ?? 0),
        durationSeconds: Number(body.durationSeconds ?? 5),
        probe,
      });
      return sendJson(res, 200, {
        ok: true,
        preview: {
          ...preview,
          url: `/api/media?path=${encodeURIComponent(preview.path)}`,
        },
      });
    } catch (err) {
      return sendError(res, 422, err);
    }
  }

  if (pathname === '/api/reveal' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.path) return sendError(res, 400, 'Missing path');
      await fsp.access(path.resolve(body.path));
      revealInFileManager(body.path);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendError(res, 400, err);
    }
  }

  if (pathname === '/api/choose-folder' && req.method === 'POST') {
    return sendJson(res, 200, { ok: false, unsupported: true });
  }

  if (pathname === '/api/choose-files' && req.method === 'POST') {
    return sendJson(res, 200, { ok: false, unsupported: true });
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    try {
      const rawName = url.searchParams.get('name') || `dropped_${Date.now()}.mp4`;
      const safeName = path.basename(rawName).replace(/[<>:"/\\|?*]/g, '_');
      const uploadsDir = path.join(DATA_DIR, 'uploads');
      await fsp.mkdir(uploadsDir, { recursive: true });
      const targetPath = path.join(uploadsDir, safeName);

      const out = fs.createWriteStream(targetPath);
      await new Promise((resolve, reject) => {
        req.pipe(out);
        req.on('error', reject);
        out.on('finish', resolve);
        out.on('error', reject);
      });

      const stat = await fsp.stat(targetPath);
      const engine = await detectEngine();
      const probe = await probeFile(engine, targetPath);

      return sendJson(res, 200, {
        ok: true,
        file: {
          path: targetPath,
          name: safeName,
          sizeBytes: stat.size,
          modifiedAt: stat.mtimeMs,
        },
        probe,
      });
    } catch (err) {
      return sendError(res, 422, err);
    }
  }

  if (pathname === '/api/youtube' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const rawUrl = body.url ? String(body.url).trim() : '';
      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
        return sendError(res, 400, 'Please provide a valid YouTube or video URL (http:// or https://)');
      }

      const downloadsDir = path.join(DATA_DIR, 'downloads');
      await fsp.mkdir(downloadsDir, { recursive: true });

      const outTemplate = path.join(downloadsDir, '%(title).60s_%(id)s.%(ext)s');
      const ytBinary = process.env.YT_DLP_PATH || (process.platform === 'win32' && fs.existsSync('C:\\Users\\mymas\\Downloads\\youtube-dl\\yt-dlp.exe')
        ? 'C:\\Users\\mymas\\Downloads\\youtube-dl\\yt-dlp.exe'
        : 'yt-dlp');

      const args = [
        '--no-playlist',
        '--force-ipv4',
        '--socket-timeout',
        '30',
        '--retries',
        '5',
        '--extractor-args',
        'youtube:player_client=ios,android',
        '-f',
        'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
        '--merge-output-format',
        'mp4',
        '--print',
        'after_move:filepath',
        '-o',
        outTemplate,
      ];

      const cookieCandidate = process.env.YT_DLP_COOKIES || (process.platform === 'win32' && fs.existsSync('C:\\Users\\mymas\\Downloads\\youtube-dl\\cookies.txt') ? 'C:\\Users\\mymas\\Downloads\\youtube-dl\\cookies.txt' : null);
      if (cookieCandidate && fs.existsSync(cookieCandidate)) {
        args.push('--cookies', cookieCandidate);
      }

      args.push(rawUrl);

      const ytProc = spawn(ytBinary, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';

      ytProc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      ytProc.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      const exitCode = await new Promise((resolve) => {
        ytProc.on('close', resolve);
        ytProc.on('error', (err) => {
          stderr += err.message;
          resolve(1);
        });
      });

      if (exitCode !== 0) {
        const cleanErr = stderr
          .split(/\r?\n/)
          .filter((l) => l.includes('ERROR:') || l.includes('Error'))
          .join('; ') || stderr.slice(-300) || 'yt-dlp download failed';
        return sendError(res, 422, `YouTube download failed: ${cleanErr}`);
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let downloadedPath = lines.find((l) => fs.existsSync(l) && isVideoPath(l));

      if (!downloadedPath) {
        const entries = await fsp.readdir(downloadsDir);
        let newest = null;
        let newestMtime = 0;
        for (const f of entries) {
          const fp = path.join(downloadsDir, f);
          try {
            const st = await fsp.stat(fp);
            if (st.isFile() && isVideoPath(fp) && st.mtimeMs > newestMtime) {
              newestMtime = st.mtimeMs;
              newest = fp;
            }
          } catch {}
        }
        downloadedPath = newest;
      }

      if (!downloadedPath || !fs.existsSync(downloadedPath)) {
        return sendError(res, 500, 'Could not locate downloaded YouTube video file');
      }

      const engine = await detectEngine();
      const probe = await probeFile(engine, downloadedPath);

      // Add to compression queue with 720p preset and autoDownload=true
      const jobs = queue.add([
        {
          path: downloadedPath,
          preset: 'medium', // 720p downscaling
          options: {
            codec: 'h264',
            autoDownload: true,
          },
        },
      ]);

      return sendJson(res, 200, {
        ok: true,
        job: jobs[0],
        probe,
        downloadedPath,
      });
    } catch (err) {
      return sendError(res, 500, err);
    }
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, settings: store.getSettings() });
  }

  if (pathname === '/api/settings' && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      const settings = await store.saveSettings(body.settings ?? body);
      queue.pump();
      return sendJson(res, 200, { ok: true, settings });
    } catch (err) {
      return sendError(res, 400, err);
    }
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    const { entries, totals } = store.getHistory();
    return sendJson(res, 200, { ok: true, entries, totals });
  }

  if (pathname === '/api/history' && req.method === 'DELETE') {
    await store.clearHistory();
    return sendJson(res, 200, { ok: true });
  }

  return sendError(res, 404, 'Unknown endpoint');
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.resolve(DIST_DIR, relative);
  const indexPath = path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(indexPath)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      'Plico engine is running, but the interface has not been built yet.\n\n' +
        'For development:  npm run dev\n' +
        'For production:    npm run build && npm start\n',
    );
    return;
  }

  if (candidate.startsWith(DIST_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return streamFile(req, res, candidate);
  }

  return streamFile(req, res, indexPath);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Enable CORS so web clients on GitHub Pages or custom origins can access the engine
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Content-Disposition, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'Method not allowed');
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!res.headersSent) sendError(res, 500, err);
    else res.end();
  }
});

function openAppWindow(port) {
  if (process.env.NO_OPEN || process.env.PLICO_HEADLESS || process.env.CI) return;

  const url = `http://127.0.0.1:${port}`;
  let browserPath = null;

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        browserPath = c;
        break;
      }
    }
  }

  if (browserPath) {
    const profileDir = path.join(DATA_DIR, 'desktop-profile');
    try {
      fs.mkdirSync(profileDir, { recursive: true });
    } catch {}

    const appProc = spawn(
      browserPath,
      [
        `--app=${url}`,
        '--window-size=1280,840',
        '--disable-extensions',
        '--disable-default-apps',
        `--user-data-dir=${profileDir}`,
      ],
      { detached: true, windowsHide: true, stdio: 'ignore' }
    );
    appProc.unref();
  } else {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { windowsHide: true, detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true }).unref();
    }
  }
}

async function start() {
  await store.ready;
  queue = new CompressionQueue({ store, getEngine: () => detectEngine() });
  await cleanPreviews();

  server.listen(PORT, HOST, async () => {
    const engine = await detectEngine();
    console.log(`Plico engine listening on http://${HOST}:${PORT}`);
    if (!engine.ok) {
      console.error(`FFmpeg unavailable: ${engine.error}`);
    } else {
      const hardware = Object.entries(engine.hardwareEncoders)
        .filter(([, list]) => list.length)
        .map(([codec, list]) => `${codec}:${list[0]}`);
      console.log(`FFmpeg ${engine.version}`);
      console.log(`Software encoders: ${Object.entries(engine.softwareEncoders).map(([k, v]) => `${k}=${v ?? 'n/a'}`).join(', ')}`);
      console.log(`Hardware encoders: ${hardware.length ? hardware.join(', ') : 'none detected'}`);
    }

    openAppWindow(PORT);
  });
}

start();
