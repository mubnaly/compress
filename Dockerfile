# ====================================================================
# Plico Video Compressor - Production Docker Container
# Complete bundle with Node.js 20, FFmpeg, FFprobe, Python 3 & yt-dlp
# ====================================================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy full application source for frontend build
COPY . .

# Build Svelte 5 frontend into dist/
RUN npm run build


FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install FFmpeg, FFprobe, Python3, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install the latest standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version

ENV NODE_ENV=production
ENV PORT=7317
ENV PLICO_HOST=0.0.0.0
ENV PLICO_DATA_DIR=/app/data

# Copy production files from builder
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Create data directories
RUN mkdir -p /app/data/uploads /app/data/downloads /app/data/output /app/data/cache

EXPOSE 7317

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:7317/api/health || exit 1

CMD ["node", "server/index.js"]
