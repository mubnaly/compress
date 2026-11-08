# 07. Technical Risks, Licensing Considerations & Strategic Decisions

## 1. Technical Risks & Mitigation Strategies

### A. FFmpeg Licensing & Distribution Risk
- **Risk**: FFmpeg contains components under both **LGPL v2.1+** and **GPL v2+** (e.g. `libx264`, `libx265`). Statically linking GPL components into a closed-source binary imposes copyleft requirements on the host application.
- **Mitigation Architecture**:
  1. **Dynamic Process Isolation (Desktop)**: On Desktop (Windows/macOS/Linux), the Rust backend interfaces with FFmpeg strictly as an independent external child process over standard OS pipes (`stdin`/`stdout`/`stderr`). This establishes a clear legal and architectural separation.
  2. **LGPL Build Flags**: For mobile and WASM where shared libraries or in-process execution are required, we configure FFmpeg with `--enable-version3 --disable-gpl --disable-nonfree`, utilizing native hardware encoders (MediaCodec on Android, VideoToolbox on iOS) or royalty-free codecs (VP9 / AV1 via `libvpx` / `libsvtav1`).
  3. **Third-Party Attribution**: Bundle full source-code offer and licenses in an in-app "Open Source Notices" screen.

---

### B. Mobile Background Process Termination (OEM Task Killers)
- **Risk**: Android OEMs (Samsung OneUI, Xiaomi MIUI/HyperOS, Huawei EMUI) employ aggressive memory managers that terminate background processes exceeding 30–60 seconds, even when running an Android `ForegroundService` with a `WAKE_LOCK`.
- **Mitigation Architecture**:
  1. Implement persistent, prominent user guidance mirroring the successful educational flow in Proton Video Compressor (linking to "Don't Kill My App").
  2. Structure transcoding into small chunked segments or checkpointed frames allowing automatic resumption if the service is killed and restarted by `WorkManager`.
  3. Enable native hardware acceleration (`MediaCodec`), which reduces transcode time by up to 80%, finishing jobs before aggressive timeout thresholds are triggered.

---

### C. WebAssembly Memory Ceilings & Large Video Files in Browsers
- **Risk**: 32-bit WebAssembly processes are constrained by a 4 GB address space limit. Loading a 3 GB 4K video file into JavaScript memory (`Uint8Array`) will crash mobile and desktop browser tabs with an `Out Of Memory` (OOM) exception.
- **Mitigation Architecture**:
  1. **Origin Private File System (OPFS)**: Stream video files directly from user disk into OPFS without loading full contents into JS heap.
  2. **WebCodecs API**: Utilize browser-native `VideoEncoder` and `VideoDecoder` streams, which process video frame-by-frame directly in GPU/hardware buffers rather than CPU memory.
  3. **Client-Side File Size Warning**: For the web variant, recommend using the Desktop app for videos larger than 2 GB.

---

### D. Codec Compatibility & Hardware Fragmentation
- **Risk**: While H.264 is universally decoded by almost all consumer hardware, modern codecs like AV1 or HEVC (H.265) may not have hardware decode/encode support on older budget devices.
- **Mitigation Architecture**:
  - Implement a runtime hardware capability probe at application launch.
  - Default preset remains **H.264 (MP4)** for guaranteed universal playback across WhatsApp, Instagram, Discord, and legacy TVs.
  - Present AV1 and H.265 as explicit user options with clear labels: *"AV1: 40% higher compression efficiency, requires modern playback device"*.

---

## 2. Unknown Behaviors & Platform Boundaries

| Unknown Area | Current Finding | Boundary / Verification Strategy |
|---|---|---|
| **ExoPlayer Audio Pitch in Target App** | Proton Video Compressor supports up to 300% volume boosting. How does it handle severe clipping on loud audio tracks? | Our independent app should incorporate an automatic soft-knee limiter (`-filter:a "volume=2.0,alimiter=limit=0.95"`) to prevent harsh acoustic distortion. |
| **HDR to SDR Tone Mapping** | Does the target app properly tonemap 10-bit HDR / Dolby Vision iPhone videos when downscaling to 8-bit H.264? | Most simple FFmpeg scripts wash out colors; our engine must include automatic zscale/tonemap filter detection (`zscale=t=linear:npl=100,format=gbrpf32,tonemap=tonemap=mobius,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p`). |
| **Orientation Metadata Bugs** | Portrait videos recorded on Samsung/Pixel phones frequently have 90° rotation metadata flags that standard video tag re-muxers strip. | Verified in our experiments: using `-vcodec libx264` without stripping rotation metadata preserves orientation correctly. |

---

## 3. Key Decisions Requiring Project Approval

Before transitioning from Phase 0 to production implementation, we request approval on the following strategic design decisions:

1. **Desktop Bundling Strategy**:
   - **Option A (Recommended)**: Bundle optimized, stripped FFmpeg binaries directly inside the installer (~25 MB total app size). Ensures instant out-of-the-box offline functionality with zero external dependencies.
   - **Option B**: Download FFmpeg on first launch. Keeps initial installer size small (~5 MB), but requires an internet connection during setup.
   - *Recommendation*: **Option A** to uphold our strict "100% Offline" product promise.

2. **Mobile Implementation Architecture**:
   - **Option A (Tauri Mobile v2)**: Reuses 95% of the Svelte UI code and Rust multimedia logic directly on Android and iOS.
   - **Option B (Native Kotlin / Swift with Shared Rust Core)**: Reuses the Rust core via UniFFI/JNI, but builds platform-native Jetpack Compose (Android) and SwiftUI (iOS) interfaces.
   - *Recommendation*: **Option A** for fastest time-to-market and seamless cross-platform parity, falling back to targeted native plugins where deep background execution requires native service lifecycles.

3. **Default Codec Selection**:
   - **Recommendation**: Keep **H.264 (libx264 / hardware AVC)** as the default for universal compatibility across WhatsApp and web sharing, with a single-click toggle to switch to **AV1** for next-generation efficiency.
