// End-to-end smoke test against the running Plico engine on 127.0.0.1:7317.
// Usage: node data/smoke-test.mjs <input-video>
import path from 'node:path';

const BASE = 'http://127.0.0.1:7317';
const input = process.argv[2];

const failures = [];
function check(label, condition, detail = '') {
  const line = `${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  if (!condition) failures.push(label);
}

async function call(path, init) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${String(text).slice(0, 300)}`);
  return data;
}

function post(path, body) {
  return call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitForJob(id, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { jobs } = await call('/api/jobs');
    const job = jobs.find((entry) => entry.id === id);
    if (!job) throw new Error('job disappeared');
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('job timed out');
}

// wait for engine readiness
let health = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    health = await call('/api/health');
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
if (!health) {
  console.error('FAIL  engine did not become ready');
  process.exit(1);
}

check('engine detected', health.engine.ok, health.engine.version ?? health.engine.error ?? '');
check('libx264 available', health.engine.softwareEncoders.h264 === 'libx264', String(health.engine.softwareEncoders.h264));
check('preset catalogue served', health.presets.length === 7, `${health.presets.length} presets`);

const browseDir = process.env.PLICO_TEST_DIR ?? (input ? path.dirname(path.resolve(input)) : '.');
const listing = await call(`/api/browse?path=${encodeURIComponent(browseDir)}`);
check('browse lists directories', Array.isArray(listing.directories), `${listing.directories.length} dirs`);
const normalize = (value) => path.resolve(value).replaceAll('\\', '/').toLowerCase();
check('browse lists videos', listing.videos.some((video) => normalize(video.path) === normalize(input)), `${listing.videos.length} videos`);

const { probe } = await post('/api/probe', { path: input });
check('probe reads dimensions', probe.video.displayWidth === 1920 && probe.video.displayHeight === 1080, `${probe.video.displayWidth}x${probe.video.displayHeight}`);
check('probe reads duration', Math.abs(probe.durationSeconds - 8) < 0.6, `${probe.durationSeconds}s`);
check('probe reads audio', Boolean(probe.audio), probe.audio?.codec ?? 'none');

const optimal = (await post('/api/estimate', { path: input, preset: 'optimal', options: { codec: 'h264' } })).estimate;
check('optimal estimate ok', optimal.ok && optimal.outputSizeBytes > 0, `~${Math.round(optimal.outputSizeBytes / 1024)} KB, ${optimal.reductionPercent}%`);
check('optimal estimate keeps resolution', optimal.width === 1920 && optimal.height === 1080);

const whatsapp = (await post('/api/estimate', { path: input, preset: 'whatsapp', options: { codec: 'h264' } })).estimate;
check('whatsapp estimate under 16 MB', whatsapp.ok && whatsapp.outputSizeBytes <= 16 * 1024 * 1024, `${Math.round(whatsapp.outputSizeBytes / 1024)} KB`);

const custom = (await post('/api/estimate', { path: input, preset: 'custom_resolution', options: { codec: 'h264', targetWidth: 960, targetHeight: 540 } })).estimate;
check('custom resolution estimate', custom.ok && custom.width === 960 && custom.height === 540, `${custom.width}x${custom.height}`);

const sortedBySize = await call(`/api/browse?path=${encodeURIComponent(process.env.PLICO_TEST_DIR ?? '.')}&sort=size&dir=desc`);
check(
  'browse sorts by size',
  sortedBySize.videos.every((video, index, arr) => index === 0 || (arr[index - 1].sizeBytes ?? 0) >= (video.sizeBytes ?? 0)),
  `${sortedBySize.videos.length} videos`,
);

const trimEstimate = (await post('/api/estimate', { path: input, preset: 'optimal', options: { codec: 'h264', startSeconds: 2, endSeconds: 5 } })).estimate;
check('trim shortens the estimate window', trimEstimate.ok && Math.abs(trimEstimate.durationSeconds - 3) < 0.2, `${trimEstimate.durationSeconds}s, ${Math.round(trimEstimate.outputSizeBytes / 1024)} KB`);

const cropEstimate = (await post('/api/estimate', { path: input, preset: 'optimal', options: { codec: 'h264', crop: { x: 0, y: 0, width: 960, height: 540 } } })).estimate;
check('crop changes the estimated frame', cropEstimate.ok && cropEstimate.width === 960 && cropEstimate.height === 540, `${cropEstimate.width}x${cropEstimate.height}`);

const rotationEstimate = (await post('/api/estimate', { path: input, preset: 'optimal', options: { codec: 'h264', rotation: 90 } })).estimate;
check('rotation swaps the frame axes', rotationEstimate.ok && rotationEstimate.width === 1080 && rotationEstimate.height === 1920, `${rotationEstimate.width}x${rotationEstimate.height}`);

const badRes = (await post('/api/estimate', { path: input, preset: 'custom_resolution', options: { codec: 'h264', targetWidth: 961, targetHeight: 540 } })).estimate;
check('custom resolution rejects odd width', badRes.ok === false, badRes.error ?? '');

const tooSmall = (await post('/api/estimate', { path: input, preset: 'custom_size', options: { codec: 'h264', targetSizeMB: 0.01 } })).estimate;
check('tiny target rejected', tooSmall.ok === false, tooSmall.error ?? '');

const created = await post('/api/jobs', {
  items: [{ path: input, preset: 'optimal', options: { codec: 'h264', copyMetadata: true } }],
});
check('job queued', created.jobs.length === 1 && created.jobs[0].status === 'queued');

const finished = await waitForJob(created.jobs[0].id);
check('job completed', finished.status === 'completed', `${finished.status} ${finished.error ?? ''}`);
check('output smaller than original', finished.result && finished.result.outputSizeBytes < finished.result.originalSizeBytes, `${finished.result?.reductionPercent}% smaller`);
check('output file recorded', Boolean(finished.result?.outputPath), finished.result?.outputPath ?? '');

const fs = await import('node:fs/promises');
if (finished.result?.outputPath) {
  const stat = await fs.stat(finished.result.outputPath);
  check('output exists on disk', stat.size === finished.result.outputSizeBytes, `${stat.size} bytes`);
  check('output is a real mp4', stat.size > 20_000, `${stat.size} bytes`);
  const outProbe = (await post('/api/probe', { path: finished.result.outputPath })).probe;
  check('output keeps 1080p', outProbe.video.displayWidth === 1920, `${outProbe.video.displayWidth}x${outProbe.video.displayHeight}`);
}

const preview = await post('/api/preview', { path: input, startSeconds: 1, durationSeconds: 3 });
check('preview rendered', Boolean(preview.preview?.url), preview.preview?.path ?? '');
if (preview.preview?.path) {
  const previewStat = await fs.stat(preview.preview.path);
  check('preview file non-empty', previewStat.size > 1000, `${previewStat.size} bytes`);
}

const thumbResponse = await fetch(`${BASE}/api/thumb?path=${encodeURIComponent(input)}&t=1`);
check('thumbnail served', thumbResponse.ok, `content-type ${thumbResponse.headers.get('content-type')}`);

const mediaResponse = await fetch(`${BASE}/api/media?path=${encodeURIComponent(input)}`, { headers: { range: 'bytes=0-1023' } });
check('media range streaming', mediaResponse.status === 206, `status ${mediaResponse.status}`);

// Trim + crop + rotation are applied by the encoder itself, not just previewed.
const trimJob = await post('/api/jobs', {
  items: [{ path: input, preset: 'optimal', options: { codec: 'h264', startSeconds: 2, endSeconds: 5 } }],
});
const trimDone = await waitForJob(trimJob.jobs[0].id);
check('trim job completed', trimDone.status === 'completed', `${trimDone.status} ${trimDone.error ?? ''}`);
if (trimDone.result?.outputPath) {
  const trimmed = (await post('/api/probe', { path: trimDone.result.outputPath })).probe;
  check('trim output is ~3s', trimmed.durationSeconds > 2.4 && trimmed.durationSeconds < 3.6, `${trimmed.durationSeconds}s`);
}

const cropJob = await post('/api/jobs', {
  items: [
    {
      path: input,
      preset: 'optimal',
      options: { codec: 'h264', crop: { x: 100, y: 40, width: 960, height: 540 }, rotation: 90 },
    },
  ],
});
const cropDone = await waitForJob(cropJob.jobs[0].id);
check('crop + rotation job completed', cropDone.status === 'completed', `${cropDone.status} ${cropDone.error ?? ''}`);
if (cropDone.result?.outputPath) {
  const cropped = (await post('/api/probe', { path: cropDone.result.outputPath })).probe;
  check(
    'crop + rotation output is 540x960',
    cropped.video.displayWidth === 540 && cropped.video.displayHeight === 960,
    `${cropped.video.displayWidth}x${cropped.video.displayHeight}`,
  );
}

const mkvJob = await post('/api/jobs', {
  items: [{ path: input, preset: 'small', options: { codec: 'h264', container: 'mkv' } }],
});
const mkvDone = await waitForJob(mkvJob.jobs[0].id);
check('mkv container job completed', mkvDone.status === 'completed' && (mkvDone.result?.outputPath ?? '').endsWith('.mkv'), `${mkvDone.status} ${mkvDone.result?.outputPath ?? mkvDone.error}`);

// Already-optimal guard: compressing the already-compressed output at optimal should be refused.
const guardCreated = await post('/api/jobs', {
  items: [{ path: finished.result.outputPath, preset: 'custom_size', options: { codec: 'h264', targetSizeMB: 50 } }],
});
const guardFinished = await waitForJob(guardCreated.jobs[0].id);
check('already-optimal guard works', guardFinished.status === 'already_optimal', `${guardFinished.status} (would be ${guardFinished.result?.wouldBeBytes} vs ${guardFinished.result?.originalSizeBytes})`);

// Batch job with 2 files exercises the queue and concurrency.
const batch = await post('/api/jobs', {
  items: [
    { path: input, preset: 'small', options: { codec: 'h264' } },
    { path: input, preset: 'medium', options: { codec: 'h264' } },
  ],
});
check('batch accepted', batch.jobs.length === 2);
const batchResults = await Promise.all(batch.jobs.map((job) => waitForJob(job.id)));
check('batch finished', batchResults.every((job) => ['completed', 'already_optimal'].includes(job.status)), batchResults.map((job) => job.status).join(', '));

const settings = (await call('/api/settings')).settings;
const savedSettings = (await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { ...settings, concurrency: 3 } }) })).settings;
check('settings persist', savedSettings.concurrency === 3, `concurrency ${savedSettings.concurrency}`);
await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings }) });

const history = await call('/api/history');
check('history recorded', history.entries.length >= 3, `${history.entries.length} entries, ${history.totals.savedBytes} bytes saved`);

const badProbe = await fetch(`${BASE}/api/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'D:/definitely/missing.mp4' }) });
check('missing file rejected', badProbe.status === 422, `status ${badProbe.status}`);

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
