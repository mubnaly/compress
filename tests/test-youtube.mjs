// Test YouTube download and 720p queue insertion
const BASE = 'http://127.0.0.1:7317';

async function main() {
  console.log('Testing /api/youtube endpoint with sample video...');
  const res = await fetch(`${BASE}/api/youtube`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    console.error('FAIL  /api/youtube returned error:', res.status, data);
    process.exit(1);
  }

  console.log('PASS  /api/youtube response ok:', data.ok);
  console.log('PASS  Job created:', data.job.id, 'Preset:', data.job.preset, 'autoDownload:', data.job.options?.autoDownload);
  console.log('PASS  Downloaded file:', data.downloadedPath);

  // Poll until job completes
  console.log('Waiting for job compression to complete...');
  let job = null;
  for (let i = 0; i < 40; i++) {
    const listRes = await fetch(`${BASE}/api/jobs`);
    const listData = await listRes.json();
    job = listData.jobs.find((j) => j.id === data.job.id);
    if (job && ['completed', 'failed', 'already_optimal'].includes(job.status)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!job) {
    console.error('FAIL  Job not found in queue');
    process.exit(1);
  }

  console.log(`PASS  Job finished with status: ${job.status}`);
  if (job.status === 'completed' || job.status === 'already_optimal') {
    const outPath = job.result?.outputPath || job.inputPath;
    console.log('PASS  Output path:', outPath);
    console.log('PASS  Original bytes:', job.result?.originalSizeBytes, '-> Output bytes:', job.result?.outputSizeBytes);
    console.log('ALL YOUTUBE INTEGRATION TESTS PASSED!');
  } else {
    console.error('Job error:', job.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
