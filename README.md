# Plico — Offline Video Compressor & Online 720p YouTube Engine

[![Build, Test & Deploy](https://github.com/mubnaly/compress/actions/workflows/deploy.yml/badge.svg)](https://github.com/mubnaly/compress/actions/workflows/deploy.yml)

A modern, fast video compressor with 100% offline local processing, drag-and-drop file ingestion, audio completion chime, last-modified queue sorting, and an online **720p YouTube download & compression engine**.

🌐 **Live Web UI**: [https://mubnaly.github.io/compress/](https://mubnaly.github.io/compress/)  
📱 **Android APK**: [Download APK from GitHub Releases](https://github.com/mubnaly/compress/releases)  
🐳 **Pre-built Container**: `docker run -d -p 7317:7317 -v ./data:/app/data ghcr.io/mubnaly/compress:latest`

Media is encoded directly using FFmpeg with hardware acceleration (NVENC, QSV, AMF, VideoToolbox) when available. Nothing is sent to third parties, and there are zero ads or telemetry.

---

## ⚡ Quick Start

### 1. Run Pre-built Docker Container (Zero Setup)
```bash
docker run -d -p 7317:7317 -v $(pwd)/data:/app/data ghcr.io/mubnaly/compress:latest
```
Open [http://localhost:7317](http://localhost:7317) in your browser. All dependencies (Node.js 20, FFmpeg, FFprobe, yt-dlp) are bundled inside.

### 2. Run Locally with Node.js
```bash
# Install dependencies
npm install

# Run development server (engine on :7317 + Vite on :5180)
npm run dev

# Or build and start production server on :7317
npm run build
npm start
```

---

## 🚀 Key Features

| Area | Description |
|---|---|
| **YouTube 720p Engine** | Paste any YouTube link. The engine downloads the stream, compresses it to 720p with perceptual CRF rate control, plays a completion chime, and **automatically downloads the file to your device**. |
| **Drag & Drop + C: Drive** | Drag & drop videos directly from your C: partition or any drive into the dropzone. Native Windows file/folder pickers included. |
| **Audio Notification** | Plays a synthesized two-tone completion chime via Web Audio API when encoding finishes. |
| **Queue Management** | Sorted by default with **last modified / newest jobs on top**. Live FPS, ETA, speed multiplier, cancel/retry, and one-click direct download. |
| **Compression Presets** | Optimal (native CRF), Medium (720p), Small (480p), WhatsApp 16 MB, Gmail 25 MB, custom target size, custom resolution with aspect lock. |
| **Non-Destructive & Guard** | Never overwrites original files. If compression would increase file size, original is preserved and marked *already optimal*. |
| **Visual Comparison** | Synchronized side-by-side split slider comparing original vs compressed video with real-time audio and dual playback. |
| **Multi-Codec & Hardware** | H.264 (default), H.265/HEVC, AV1, VP9 (WebM). Auto-detects NVENC / QSV / AMF hardware acceleration. |

---

## ☁️ Deployment & Online Hosting

Full instructions for hosting on any cloud platform or VPS are in [DEPLOYMENT.md](DEPLOYMENT.md):

- **GitHub Pages**: Automatically deployed via GitHub Actions on every push to `main`.
- **Render.com**: 1-click deploy using [render.yaml](render.yaml).
- **Railway.app**: Instant deploy using [railway.json](railway.json).
- **Docker Compose**: `docker compose up -d`
- **Linux / VPS**: Run `install-dependencies.sh` then `npm run build && npm start`.

---

## 📁 Repository Structure

```
.github/workflows/   Automated GitHub Actions CI/CD (Test, GitHub Pages, Docker publish)
server/              Node.js engine & REST API (port 7317, CORS enabled)
  index.js           API router: /api/youtube, /api/upload, /api/jobs, /api/browse, etc.
  lib/ffmpeg.js      FFmpeg & hardware encoder auto-detection
  lib/probe.js       FFprobe JSON stream inspection
  lib/presets.js     Preset algorithms & bitrate formulas
  lib/queue.js       Job worker pool & concurrency manager
  lib/store.js       Local settings & history persistence
src/                 Svelte 5 + TypeScript reactive UI
  views/Library.svelte  Video browsing, drag-and-drop, YouTube 720p card
  views/Queue.svelte    Real-time queue with default last-modified sorting & download
  views/Compare.svelte  Side-by-side visual difference slider
  views/Details.svelte  Crop, trim, rotation, bitrate & audio settings
  lib/sound.ts       Web Audio API completion chime
Dockerfile           Multi-stage Docker container with Node.js 20, FFmpeg & yt-dlp
docker-compose.yml   Single command Docker orchestration
tests/               Smoke and integration test suites
```

---

## 🧪 Testing

```bash
# Run complete end-to-end smoke test suite
node tests/smoke.mjs "data/test-inputs/sample_1080p.mp4"

# Run YouTube endpoint integration test
node tests/test-youtube.mjs
```

---

## 📜 Licensing Note

FFmpeg runs strictly as an external child process over standard pipes; no FFmpeg code is compiled or linked into this project. FFmpeg and its dependencies retain their respective open-source licenses.
