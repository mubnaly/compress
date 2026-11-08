# Plico — local video compressor

A 100% offline video compressor built from the product specification in
[`docs/discovery`](docs/discovery). Media is read from disk, encoded on this machine, and written back — nothing is
uploaded, and there is no advertising or telemetry.

The UI is Svelte 5 + TypeScript; the engine is a small Node service that supervises an FFmpeg child process per job and
streams real progress back to the browser.

## Requirements

- Node.js 20+
- `ffmpeg` and `ffprobe` on `PATH` (set `FFMPEG_PATH` / `FFPROBE_PATH` to override)

## Run

```bash
npm install
npm run dev        # engine on :7317 + Vite on :5180
```

Production-style run (single server, no Vite):

```bash
npm run build
npm start          # http://127.0.0.1:7317
```

The engine binds to loopback only. On launch it detects the FFmpeg version and which software/hardware encoders are
available, and reports them in Settings.

### Shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd + O` | Jump to the library path bar |
| `Ctrl/Cmd + Enter` | Start the configured compression |
| `Space` | Play/pause the source preview |
| `Esc` | Close the preview dialog |

## Features

| Area | What it does |
| --- | --- |
| Presets | Optimal (CRF 27 at native resolution), Medium (720p), Small (480p), WhatsApp 16 MB, Gmail 25 MB, custom target size, custom resolution with aspect lock |
| Size math | `videoKbps = (targetBytes × 8 × 0.95) / duration − audioKbps`, with validation for impossible targets |
| Audio | Remove track, 0–300 % volume with a soft limiter, bitrate selection (64–256 kbps) |
| Streams | Probed on import: resolution, rotation, fps, codecs, bitrate, HDR flag, bits-per-pixel heuristic |
| Edits | Timeline trim (in/out), drag-to-move crop with 16:9 / 9:16 / 1:1 / 4:5 presets, 90°/180°/270° rotation, HDR→SDR tone mapping |
| Containers | MP4, MKV and WebM (WebM pairs with VP9) |
| Guard | If an encode would be larger than the original, the original is kept and the job is marked *already optimal* (overridable in Settings) |
| Preview | Renders a 5/10/15/30 s slice with `-preset ultrafast` and plays it in place |
| Compare | Synchronised split-slider of original vs. compressed, with dual playback |
| Queue | Concurrent workers (1–4), live %/fps/speed/ETA, cancel, retry, remove |
| Files | Custom naming pattern, non-destructive output naming, reveal in Explorer, delete original with confirmation |
| History | Cumulative space saved and per-run results, stored as local JSON |
| Library | Folder browsing sorted by date/name/size, multi-select, whole-folder batch queue, recent-savings strip |

Codecs: H.264 (default), H.265/HEVC, AV1, VP9 (WebM). Hardware encoders (NVENC/QSV/AMF/VideoToolbox/VAAPI) are used
when detected and enabled.

## Layout

```
server/            engine + HTTP API (loopback only)
  index.js         routes: browse, probe, estimate, jobs, preview, thumb, media, settings, history
  lib/ffmpeg.js    toolchain and encoder detection
  lib/probe.js     ffprobe JSON → normalised stream metadata
  lib/presets.js   preset catalogue, bitrate math, validation
  lib/command.js   FFmpeg argument builder
  lib/executor.js  child-process supervisor, progress parser, cancellation
  lib/queue.js     worker pool, already-optimal guard, history writes
  lib/store.js     settings/history persistence
src/               Svelte 5 UI (Library, Configure, Queue, Compare, History, Settings)
data/              local settings, history, caches (gitignored)
tests/smoke.mjs    end-to-end API check against a running engine
```

## Tests

With the engine running on port 7317 and a sample clip available:

```bash
node tests/smoke.mjs "D:/path/to/sample.mp4"
```

It covers probing, previews, estimates and their validation, a real encode, trim/crop/rotation output geometry, MKV
muxing, the already-optimal guard, a batch run, sorting, settings persistence, history, range streaming, thumbnails and
error handling.

## Licensing note

FFmpeg runs strictly as an external child process over pipes; no FFmpeg code is linked into this project. Any FFmpeg
build containing GPL components (`libx264`, `libx265`) keeps its own license, which is the boundary the architecture
documents in `docs/discovery/04-ARCHITECTURE-PLAN.md` rely on.
