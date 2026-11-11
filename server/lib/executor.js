import { spawn, exec } from 'node:child_process';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lastMeaningfulLine(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = [...lines].reverse().find((line) => /error|invalid|not found|failed|unable|no such/i.test(line));
  return errorLine || lines[lines.length - 1] || '';
}

/**
 * Supervise one FFmpeg process: stream progress from `-progress pipe:1`,
 * keep a stderr tail for diagnostics, and support cancellation.
 */
export function runFfmpeg({ ffmpegPath, args, durationSeconds, onProgress }) {
  const child = spawn(ffmpegPath, args, { windowsHide: true });
  let stderrTail = '';
  let stdoutBuffer = '';
  let cancelled = false;
  let latest = {
    percent: 0,
    processedSeconds: 0,
    fps: 0,
    speed: 0,
    etaSeconds: null,
    bitrateKbps: 0,
  };

  const emit = () => {
    if (typeof onProgress === 'function') onProgress({ ...latest });
  };

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const separator = line.indexOf('=');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();

      if (key === 'out_time_us' || key === 'out_time_ms') {
        const seconds = Number(value) / 1_000_000;
        if (Number.isFinite(seconds) && seconds >= 0) {
          latest.processedSeconds = seconds;
          if (durationSeconds > 0) {
            latest.percent = clamp((seconds / durationSeconds) * 100, 0, 99.9);
          }
        }
      } else if (key === 'frame') {
        // frame counter is not surfaced directly; fps arrives separately
      } else if (key === 'fps') {
        const fps = Number(value);
        if (Number.isFinite(fps)) latest.fps = Math.round(fps * 10) / 10;
      } else if (key === 'speed') {
        const speed = Number(String(value).replace('x', ''));
        if (Number.isFinite(speed)) {
          latest.speed = Math.round(speed * 100) / 100;
          latest.etaSeconds =
            latest.speed > 0 && durationSeconds > 0
              ? Math.max(0, Math.round((durationSeconds - latest.processedSeconds) / latest.speed))
              : null;
        }
      } else if (key === 'bitrate') {
        const bitrate = Number(String(value).replace('kbits/s', ''));
        if (Number.isFinite(bitrate)) latest.bitrateKbps = Math.round(bitrate);
      } else if (key === 'progress' && value === 'end') {
        latest.percent = durationSeconds > 0 ? 100 : latest.percent;
        latest.etaSeconds = 0;
      }
      emit();
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-8000);
  });

  const promise = new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    child.on('error', (err) =>
      finish({ ok: false, cancelled, error: err.message, stderr: stderrTail }),
    );
    child.on('close', (code, signal) => {
      if (cancelled) {
        finish({ ok: false, cancelled: true, error: 'Cancelled', stderr: stderrTail });
        return;
      }
      if (code === 0) {
        latest.percent = 100;
        latest.etaSeconds = 0;
        emit();
        finish({ ok: true, cancelled: false, stderr: stderrTail });
        return;
      }
      finish({
        ok: false,
        cancelled: false,
        error: lastMeaningfulLine(stderrTail) || `FFmpeg exited with code ${code}${signal ? ` (${signal})` : ''}`,
        stderr: stderrTail,
      });
    });
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      if (process.platform === 'win32' && child.pid) {
        exec(`taskkill /F /T /PID ${child.pid}`, () => {});
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      /* already exited */
    }
    const force = setTimeout(() => {
      try {
        if (process.platform === 'win32' && child.pid) {
          exec(`taskkill /F /T /PID ${child.pid}`, () => {});
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already exited */
      }
    }, 1500);
    if (typeof force.unref === 'function') force.unref();
  };

  return { promise, cancel, get pid() { return child.pid; } };
}
