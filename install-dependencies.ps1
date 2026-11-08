# ====================================================================
# Plico Video Compressor - Automated Dependency Installer for Windows
# Installs: FFmpeg and yt-dlp
# ====================================================================

$ErrorActionPreference = "Stop"

Write-Host "=== Checking Windows Dependencies for Plico Video Compressor ===" -ForegroundColor Cyan

# Check if winget is available
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Using winget to install / verify FFmpeg..." -ForegroundColor Yellow
    winget install Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
    winget install yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements
} elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host "Using Chocolatey to install FFmpeg & yt-dlp..." -ForegroundColor Yellow
    choco install ffmpeg yt-dlp -y
} elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Host "Using Scoop to install FFmpeg & yt-dlp..." -ForegroundColor Yellow
    scoop install ffmpeg yt-dlp
} else {
    Write-Host "No package manager found. Downloading portable binaries..." -ForegroundColor Yellow
    $toolsDir = "$PSScriptRoot\tools"
    if (!(Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
    
    # Download yt-dlp
    $ytDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    $ytDlpTarget = "$toolsDir\yt-dlp.exe"
    if (!(Test-Path $ytDlpTarget)) {
        Write-Host "Downloading yt-dlp.exe into $toolsDir..."
        Invoke-WebRequest -Uri $ytDlpUrl -OutFile $ytDlpTarget
    }
}

Write-Host "`n=== Verification ===" -ForegroundColor Green
try { ffmpeg -version | Select-Object -First 1 } catch { Write-Host "Note: Restart your terminal so PATH updates take effect." }
try { yt-dlp --version } catch { }
Write-Host "`nReady! Run:" -ForegroundColor Cyan
Write-Host "  npm install"
Write-Host "  npm run build"
Write-Host "  npm start"
