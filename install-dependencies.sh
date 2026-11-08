#!/usr/bin/env bash
# ====================================================================
# Plico Video Compressor - Automated Dependency Installer for Linux/macOS
# Installs: FFmpeg, FFprobe, and yt-dlp
# ====================================================================

set -e

echo "=== Installing Plico Video Compressor Host Dependencies ==="

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "Detected Debian/Ubuntu system..."
    sudo apt-get update
    sudo apt-get install -y ffmpeg python3 curl
  elif command -v dnf >/dev/null 2>&1; then
    echo "Detected Fedora/RHEL/CentOS system..."
    sudo dnf install -y ffmpeg python3 curl
  elif command -v pacman >/dev/null 2>&1; then
    echo "Detected Arch Linux system..."
    sudo pacman -Sy --noconfirm ffmpeg python curl
  fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS..."
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg yt-dlp
  else
    echo "Homebrew not found. Please install Homebrew or install ffmpeg manually."
  fi
fi

# Install or update yt-dlp binary if not present
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "Installing standalone yt-dlp binary..."
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
fi

echo "=== Verifying Installations ==="
ffmpeg -version | head -n 1
yt-dlp --version
node -v

echo "All dependencies installed successfully! Ready to run:"
echo "  npm install"
echo "  npm run build"
echo "  npm start"
