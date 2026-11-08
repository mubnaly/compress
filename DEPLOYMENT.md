# Plico Video Compressor - Deployment & Hosting Guide

This repository contains everything needed to run **Plico Video Compressor** locally or host it as a standalone web service on any cloud platform or private server.

All backend processing engines (**FFmpeg**, **FFprobe**, and **yt-dlp**) are fully integrated.

---

## 🚀 Option 1: Docker (Recommended for 1-Click Hosting)

The included [Dockerfile](./Dockerfile) and [docker-compose.yml](./docker-compose.yml) bundle Node.js 20, FFmpeg, FFprobe, and the latest yt-dlp binary into a self-contained container.

### Run with Docker Compose:
```bash
docker compose up -d --build
```

Access the application in your browser at `http://localhost:7317`.

Data (downloaded videos, uploads, compressed outputs, settings) persists in `./data`.

---

## ☁️ Option 2: Cloud Container Hosting (Render, Railway, Fly.io)

### Deploying to Render:
1. Fork or push this repository to GitHub: `https://github.com/mubnaly/compress`.
2. Go to [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.
3. Select your repository. Render automatically reads [render.yaml](./render.yaml).
4. Click **Apply**. Render will build the Docker container and provide a public HTTPS URL.

### Deploying to Railway:
1. Go to [Railway.app](https://railway.app/).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select `mubnaly/compress`.
4. Railway detects `Dockerfile` and deploys automatically.

### Deploying to Fly.io:
```bash
fly launch
fly deploy
```

---

## 🖥️ Option 3: Direct VPS Deployment (Ubuntu / Debian / Linux)

### 1. Install System Dependencies
Run our automated script:
```bash
chmod +x install-dependencies.sh
./install-dependencies.sh
```

Or manually:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3 curl
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### 2. Install Node.js App & Build
```bash
npm install
npm run build
```

### 3. Run with systemd (Production Background Service)
Create `/etc/systemd/system/compressor.service`:
```ini
[Unit]
Description=Plico Video Compressor
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/compress
Environment=PORT=7317
Environment=PLICO_HOST=0.0.0.0
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now compressor
```

---

## 💻 Option 4: Local Windows / macOS

### Windows:
1. Run PowerShell as Administrator:
   ```powershell
   .\install-dependencies.ps1
   ```
2. Build and start:
   ```powershell
   npm install
   npm run build
   npm start
   ```

### macOS:
```bash
brew install ffmpeg yt-dlp
npm install
npm run build
npm start
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7317` | Port for HTTP server |
| `PLICO_HOST` | `0.0.0.0` | Bind host IP (`0.0.0.0` for all interfaces) |
| `YT_DLP_PATH` | System PATH | Explicit path to `yt-dlp` executable |
| `FFMPEG_PATH` | Auto-detected | Explicit path to `ffmpeg` executable |
| `FFPROBE_PATH` | Auto-detected | Explicit path to `ffprobe` executable |
| `PLICO_DATA_DIR` | `./data` | Directory for uploads, downloads, and output |
