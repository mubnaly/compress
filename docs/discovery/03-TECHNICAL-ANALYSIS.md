# 03. Technical Analysis & Multimedia Engineering Report

## 1. Multimedia Pipeline Reverse-Engineering

### A. Engine Identification & Packaging Architecture
Through static inspection of `classes.dex` and APK manifest analysis, the core multimedia pipeline of Proton Video Compressor was definitively identified:

- **Multimedia Framework**: `com.arthenica.ffmpegkit:ffmpeg-kit` (Android packaging of FFmpeg).
- **Packaging Method**: Android App Bundle (AAB) split configuration (`split_config.arm64_v8a.apk`, `split_config.armeabi_v7a.apk`). The primary `base.apk` delivers Java/Kotlin bytecode, resources, and UI bindings, while Google Play dynamically provides the architecture-specific native shared objects (`libffmpegkit.so`, `libavcodec.so`, `libavformat.so`, `libavfilter.so`, `libswscale.so`, `libswresample.so`).
- **Dynamic ABI Fallback**: DEX symbols reveal runtime detection of ARM NEON extensions via `com.arthenica.ffmpegkit.AbiDetect`:
  `"NEON supported armeabi-v7a ffmpegkit library not found. Loading default armeabi-v7a library."`
- **Playback & Visual Inspection**: Google ExoPlayer / AndroidX Media3 (`com.google.android.exoplayer2.ui.StyledPlayerView`) is embedded for video previewing, frame seeking, and synchronized dual playback in `CompareActivity`.

---

## 2. Command Pipeline & Encoding Models

The target application constructs dynamic FFmpeg execution strings based on user selections in `VideoDetailsFragment`.

### Model 1: Optimal Quality (CRF Rate Control)
When selecting original resolution and optimal quality:
```bash
ffmpeg -y -i "{input}" \
  -vcodec libx264 -preset veryfast -crf 27 \
  -c:a copy \
  -map_metadata 0 \
  "{output}"
```
- **Rationale**: CRF (Constant Rate Factor) 27 provides a proven trade-off for mobile screens where H.264 compression artifacts remain largely imperceptible while yielding typical 60–80% bandwidth reductions on high-bitrate phone camera recordings.
- **Metadata**: `-map_metadata 0` is conditionally appended when the "Copy Metadata" checkbox is selected.
- **Audio**: If audio is retained and not modified, `-c:a copy` preserves the original audio stream without re-encoding loss.

### Model 2: Resolution Downscaling & Constrained Bitrate
When selecting 720p (Medium) or 480p (Small):
```bash
ffmpeg -y -i "{input}" \
  -vf "scale=-2:720" \
  -vcodec libx264 -preset veryfast \
  -b:v {calculated_bitrate}k \
  -c:a aac -b:a 128k \
  "{output}"
```
- **Filter**: `scale=-2:H` ensures that the aspect ratio is locked and width is automatically calculated as an even multiple of 2 (satisfying H.264 macroblock constraints).
- **Audio Re-encode**: If the video stream is scaled or re-muxed, audio is encoded with AAC at 96k–128k.

### Model 3: Custom File Size (Target Bitrate Formula)
For WhatsApp (16 MB), Gmail (25 MB), or user-defined custom MB targets:
The application computes the target video bitrate using the mathematical formula:
$$\text{Bitrate}_{\text{video}} = \frac{(\text{TargetSize}_{\text{bytes}} \times 8)}{\text{Duration}_{\text{seconds}}} - \text{Bitrate}_{\text{audio}}$$

Bytecode Evidence:
`CustomBitrates(videoKbps=..., audioKbps=...)`
The target bitrate is passed via `-b:v {videoKbps}k`.

### Model 4: Fast Segment Preview (Ultrafast Slice)
To allow instant visual preview before committing to a long compression:
```bash
ffmpeg -y -ss {seek_time} -t {duration} -i "{input}" \
  -vcodec libx264 -preset ultrafast -crf 27 \
  "{output_temp_preview.mp4}"
```
- **Duration**: Selected by the user via UI chips: 5s, 10s, 15s, 20s, 30s, 45s, 60s.
- **Preset**: `ultrafast` trades compression ratio for maximum encoding speed, rendering the sample in 2–4 seconds.

### Model 5: Audio Controls (Volume & Mute)
- **Mute / Remove Audio**: Adds the `-an` flag to omit the audio track entirely.
- **Volume Boost**:
  ```bash
  -filter:a "volume={gain}"
  ```
  Where `{gain}` ranges from `0.0` (0%) to `3.0` (300%).

---

## 3. Controlled Compression Experiments & Empirical Results

Controlled experiments were executed using independently generated synthetic video test assets matching mobile capture profiles. Analysis was verified with FFprobe.

### Test Environment
- **Host CPU**: AMD Ryzen / Multi-core x86_64
- **FFmpeg Version**: 7.1-full_build (Chocolatey distribution)
- **Tooling**: Python 3.13 harness + FFprobe automated JSON parser

### Experiment Summary Table

| Test Case | Scenario / Preset | Input Spec | Output Spec | Input Size | Output Size | Size Reduction | Processing Time | Verification |
|---|---|---|---|---|---|---|---|---|
| **EXP-01** | Optimal Quality (CRF 27) | 1080p @ 30fps (H.264 + AAC) | 1080p @ 30fps (H.264 + AAC) | 1,166,448 B (1.11 MB) | 322,612 B (0.31 MB) | **+72.34%** | 17.55s | Stream bitrates & PTS verified via FFprobe |
| **EXP-02** | Medium Preset (720p Scale) | 1080p @ 30fps (H.264 + AAC) | 720p @ 30fps (H.264 + AAC) | 1,166,448 B (1.11 MB) | 1,238,878 B (1.18 MB) | **-6.21% (Expansion)** | 9.30s | Validates "Already Optimal" guard trigger |
| **EXP-03** | Small Resolution (480p Scale) | 1080p @ 30fps (H.264 + AAC) | 480p @ 30fps (854x480) | 1,166,448 B (1.11 MB) | 689,198 B (0.66 MB) | **+40.91%** | 7.14s | Complies with macroblock bounds |
| **EXP-04** | Audio Stripping (`-an`) | 1080p @ 30fps (with 192k audio) | 1080p @ 30fps (video only) | 1,166,448 B (1.11 MB) | 134,362 B (0.13 MB) | **+88.48%** | 25.96s | Audio stream completely absent |
| **EXP-05** | Audio Volume Boost 200% | 1080p @ 30fps (normal sine wave) | 1080p (video copy, audio filtered) | 1,166,448 B (1.11 MB) | 1,145,283 B (1.09 MB) | **+1.81%** | 2.43s | Audio amplitude amplified +6.02 dB |
| **EXP-06** | Portrait Mobile Video (9:16) | 1080x1920 @ 30fps (no audio) | 1080x1920 (Optimal CRF 27) | 1,138,692 B (1.09 MB) | 67,822 B (0.06 MB) | **+94.04%** | 15.93s | Portrait aspect ratio maintained without distortion |
| **EXP-07** | Custom Target (800 KB Cap) | 1080x1920 @ 30fps (8.0s) | 1080x1920 (bitrate constrained) | 1,138,692 B (1.09 MB) | 393,860 B (0.38 MB) | **+65.41%** | 18.92s | Output strictly adheres to target budget (<800 KB) |
| **EXP-08** | Fast Segment Preview (5s) | 1080p @ 30fps (10.0s total) | 1080p @ 30fps (5.0s slice, ultrafast)| 1,166,448 B (1.11 MB) | 196,574 B (0.19 MB) | **+83.15%** | **4.38s** | Render time 4x faster than full encode |

---

## 4. Key Engineering Insights & Discovered Constraints

### A. The "Already Optimal" Edge Case
During Experiment 02, attempting to compress a video that already had an efficient bitrate into a fixed 1500 kbps target resulted in an output file size that was **6.21% larger** than the input.
This confirms why the target app includes:
1. `already_optimal`: *"This video is already well compressed. Compressing it further would make the file larger, so we kept your original."*
2. An override switch in Settings: `setting_allow_size_increase_label` (*"Continue even if file size increases"*).
**Architecture Recommendation**: Our new engine must implement a post-compression verification hook: if `output_size >= input_size` and the user did not intentionally request a volume boost or transcode, the engine should automatically preserve the original and notify the user.

### B. Background Execution Vulnerability on Android
In `dialog_go_background.xml` and `bottom_sheet_battery.xml`, the target application devotes substantial UI messaging to warning users that Android OEM task killers (Samsung, Xiaomi, Huawei, etc.) kill long-running FFmpeg processes when the app is backgrounded or screen locked.
- Even with `ForegroundService` and `WAKE_LOCK`, OEM memory management kills native worker processes.
- **Architecture Recommendation**: For our Android platform target, we must utilize Android `WorkManager` with expedited job constraints, persistent foreground notifications, and checkpointed multi-part rendering or resume capabilities.

### C. Lack of Hardware Acceleration in Target App
Proton Video Compressor relies entirely on CPU software encoding (`libx264` via FFmpegKit).
- **Limitation**: Compressing a 4K 60fps video on mobile with CPU software encoding causes severe thermal throttling, high battery drain, and can take 5x the video duration.
- **Opportunity**: Our independent architecture must support hardware encoder pass-through:
  - **Desktop**: NVENC (NVIDIA), QSV (Intel), AMF (AMD), VideoToolbox (Apple).
  - **Android**: Android `MediaCodec` hardware encoders (`video/avc`, `video/hevc`).
  - **Web**: WebCodecs Hardware Acceleration API.
