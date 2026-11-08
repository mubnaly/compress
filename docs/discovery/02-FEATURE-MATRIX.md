# 02. Feature Matrix: Target Analysis & Independent Enhancement Specification

## 1. Feature Classification Standard

Each capability discovered during technical inspection is classified using strict evidence criteria:
- **Confirmed**: Verified directly in manifest, bytecode, resource declarations, and execution experiments.
- **Partially Confirmed**: Partial UI or symbol references exist, but logic is restricted or stubbed.
- **Not Available**: Explicitly checked in the codebase and proven to be absent in the target application.
- **Not Investigated**: Potential feature that could not be verified due to platform barriers.

---

## 2. Comprehensive Feature Matrix

### A. Core Compression Features

| Feature | Available in target? | Description | Options | Dependencies | Evidence | Priority |
|---|---|---|---|---|---|---|
| **Constant Rate Factor (CRF) Encoding** | **Confirmed** | Perceptually uniform video compression based on x264 CRF rate control. | Default CRF 27; preset `veryfast`. | FFmpeg libx264 | DEX strings: `-vcodec libx264 -crf 27`, `-preset veryfast` | High |
| **Optimal Quality Preset** | **Confirmed** | Preserves input resolution while minimizing bitrate with acceptable visual degradation. | Auto-bitrate or CRF 27 at original resolution. | Source metadata probe | DEX string: `"Optimal quality & file size"`, `"Compress at original resolution"` | Critical |
| **Medium Quality Preset** | **Confirmed** | Balanced profile downscaling resolution to 720p or applying proportional bitrate target. | Resolution scaling (-2:720) + calculated bitrate. | Video scaler | DEX string: `"Medium quality & medium file size"` | High |
| **Small Resolution / Low Preset** | **Confirmed** | Aggressive space-saving compression scaling to 480p with constrained bitrate. | Resolution downscaling (-2:480) + ~600k bitrate. | Video scaler | DEX string: `"Small Resolution"`, `"Low quality & small file size"` | High |
| **WhatsApp Target Preset** | **Confirmed** | Enforces hard 16 MB maximum size ceiling for WhatsApp sharing limits. | 16 MB file size threshold, pre-flight check. | Duration probe, two-pass or target bitrate calculation | DEX strings: `"Compress for WhatsApp \| 16 MB"`, `"Video is already smaller than 16 MB required by WhatsApp"` | High |
| **Gmail Target Preset** | **Confirmed** | Enforces 25 MB file size limit for email attachments. | 25 MB file size threshold, pre-flight check. | Duration probe | DEX strings: `"Compress for Gmail \| 25 MB"`, `"Video is already smaller than 25 MB required by Gmail"` | High |
| **Custom Target File Size** | **Confirmed** | Allows user to explicitly specify exact target size in MB with interactive slider. | Target MB input, step buttons (`+`/`-`), SeekBar. | Bitrate math: `(target_bytes * 8) / duration - audio_bitrate` | Layout `bottom_sheet_fragment_custom_filesize.xml`, DEX `CustomBitrates(videoKbps=...` | High |
| **Custom Resolution Downscaling** | **Confirmed** | Explicitly specifies custom width and height with aspect ratio locking. | Width & Height inputs, "Lock Aspect Ratio" checkbox, slider. | Video filter (`scale=w:h`), multiples of 2 rule | Layout `bottom_sheet_fragment_custom_resolution.xml`, strings `width_and_height_multiples_of_2`, `width_and_height_greater_128` | High |
| **"Already Optimal" Guard** | **Confirmed** | Automatically aborts or prevents output saving if compressed size exceeds original. | Active by default; user-overridable via Settings. | Post-encode file size comparison | String `already_optimal` ("This video is already well compressed..."), `setting_allow_size_increase_label` | Critical |

---

### B. Video & Audio Editing Features

| Feature | Available in target? | Description | Options | Dependencies | Evidence | Priority |
|---|---|---|---|---|---|---|
| **Audio Removal (Mute)** | **Confirmed** | Strips all audio tracks from container to maximize space savings. | On/Off toggle checkbox. | FFmpeg `-an` flag | Layout `fragment_video_details.xml` (`AppCompatCheckBox [id=id/removeAudio]`), FFmpeg command builder | Medium |
| **Audio Volume Boosting** | **Confirmed** | Amplifies or reduces audio gain during compression. | 0% to 300% range slider with "Reset" action. | FFmpeg audio filter `-filter:a volume=...` | Layout `fragment_video_details.xml` (`AppCompatSeekBar [id=id/volumeSeekbar]`, `volumeReset`), DEX `,volume=`, `-filter:a volume=` | Medium |
| **Metadata Preservation** | **Confirmed** | Copies container metadata, EXIF, creation date, camera tags. | "Copy Metadata" checkbox. | FFmpeg `-map_metadata 0` | Layout `fragment_video_details.xml` (`AppCompatCheckBox [id=id/metadata]`), DEX `-map_metadata 0` | Medium |
| **Video Trimming / Cutting** | **Not Available** | Trimming start/end timestamps for full compressions (only used internally for 5s-60s preview generation). | Preview only (5s, 10s, 15s, 20s, 30s, 45s, 60s). | N/A for output | Absent from `fragment_video_details.xml`; only in `activity_preview.xml` | High (Target for Improvement) |
| **Video Cropping** | **Not Available** | Spatial crop of black bars or bounding box. | None. | N/A | No crop filters or UI elements found | Medium (Target for Improvement) |
| **Video Rotation / Transpose** | **Partially Confirmed** | Respects source rotation tag metadata (`o_rotation`, `c_rotation`), but no manual rotation controls. | Automatic tag pass-through. | Room DB `o_rotation`, `c_rotation` | Database schema in DEX; no UI rotation buttons | Medium (Target for Improvement) |
| **Video Playback Speed Adjustment** | **Not Available** | Changing playback speed (timelapse / slow motion) in output. | ExoPlayer playback speed only. | Player UI only | Layout `player_controls.xml` | Low |

---

### C. File & Queue Management

| Feature | Available in target? | Description | Options | Dependencies | Evidence | Priority |
|---|---|---|---|---|---|---|
| **Custom Output Filename** | **Confirmed** | Modifies the default output file name before compression starts. | Text input field with inline validation. | File naming regex | Layout `bottom_sheet_custom_file_name.xml`, string `enter_file_name` | Medium |
| **Default Filename Pattern** | **Confirmed** | Automatically appends branding/indicator suffix. | `[OriginalName] (Proton Compressed Video).mp4` | String formatter | DEX string: `") Proton Compressed Video."` | Medium |
| **Output Directory Selection** | **Partially Confirmed** | Saves to app-specific Movies directory; no custom folder picker in UI. | System default Movies location. | Android Scoped Storage | String `view_full_path` | Medium (Target for Improvement) |
| **Batch Multi-Select** | **Confirmed** | Allows selecting multiple videos from gallery to queue for compression. | Checkboxes on grid items. | Recycler adapter multi-selection | Layout `fragment_video_list.xml` | High |
| **Sequential Processing Queue** | **Confirmed** | Processes batch jobs serially in foreground service. | One active job; subsequent jobs wait. | `CompressionService` queue | DEX string: `"Another compression is still running, please wait for it to complete"` | High |
| **Cancellation & Progress Reporting** | **Confirmed** | Real-time percent progress in notification and UI with Cancel button. | Cancel action in UI & Notification. | FFmpeg progress pipe | Layout `fragment_dialog_exit.xml`, `ProgressBar`, `TextView [id=id/progressPercentage]` | Critical |
| **Delete Original Video** | **Confirmed** | Prompts user to delete original source video after successful verification. | Post-compression action button. | Android MediaStore delete intent | Layout `item_compressed_video_v2.xml` (`delete_original`), string `delete_original_video` | High |
| **System Share Sheet** | **Confirmed** | Directly shares compressed output to external apps (WhatsApp, Drive, etc.). | Standard Android Share Intent. | Android `FileProvider` | Layout `item_compressed_video_v2.xml` (`share`), `androidx.core.content.FileProvider` in manifest | High |

---

### D. Preview & Quality Comparison

| Feature | Available in target? | Description | Options | Dependencies | Evidence | Priority |
|---|---|---|---|---|---|---|
| **Fast Segment Preview** | **Confirmed** | Encodes a short slice (5s–60s) with ultrafast preset to preview visual quality before full render. | Duration chips: 5s, 10s, 15s, 20s, 30s, 45s, 60s; filmstrip scrubber. | FFmpeg `-ss` & `-t` slice + `ultrafast` preset | Layout `activity_preview.xml`, DEX `preview_5s.mp4`, `chip5s` to `chip60s` | Critical |
| **Dual Video Comparison** | **Confirmed** | Synchronized side-by-side playback of original vs compressed video. | Dual ExoPlayer views with original vs compressed sizes. | ExoPlayer synchronization | Layout `activity_compare.xml`, IDs: `originalPlayer`, `compressedPlayer` | High |
| **Compression History / Space Saved** | **Confirmed** | Tracks historical statistics showing cumulative gigabytes saved across all runs. | History list, total space saved counter. | SQLite Room DB `compressed_video_stats` | Layout `activity_compression_stats.xml`, `fragment_compression_stats.xml` | Medium |

---

### E. Settings & System Integration

| Feature | Available in target? | Description | Options | Dependencies | Evidence | Priority |
|---|---|---|---|---|---|---|
| **Allow Size Increase Toggle** | **Confirmed** | Allows compression to finish even if output file size exceeds original input. | On/Off toggle switch in Settings. | Setting DataStore | Layout `fragment_settings.xml` (`SwitchMaterial [id=id/switchAllowSizeIncrease]`) | Medium |
| **Battery Optimization Warning** | **Confirmed** | Informs user about OEM background killing and guides them to disable battery optimization. | Direct settings link to "Don't kill my app". | Android system intent | Layout `bottom_sheet_battery.xml`, `dialog_go_background.xml` | High |
| **Sorting Gallery** | **Confirmed** | Sorts video library by date, name, file size, or duration. | Sort bottom sheet. | MediaStore query ordering | Layout `fragment_sort.xml`, string `sort_by` | Medium |
| **Crash & Usage Consent Toggles** | **Confirmed** | User consent management for Firebase Analytics and Crashlytics. | Toggle switches in Settings. | Firebase SDK | Layout `fragment_settings.xml` (`switchAnalytics`, `switchCrashlytics`) | Low (Independent app will be telemetry-free) |

---

## 3. High-Value Opportunities for Independent Improvement

Our independent product should **not** merely mirror Proton's limitations. The following architectural and functional improvements must be designed into our new application:

| Feature / Area | Target Application (Proton) | Our Independent Application | Justification & Advantage |
|---|---|---|---|
| **Cross-Platform Support** | Android Only | **Windows, macOS, Linux, Web, Android, iOS** | Eliminates single-platform lock-in; unifies desktop and mobile workflows. |
| **Modern Codec Support** | H.264 (`libx264`) and VP9 only | **H.264, H.265 (HEVC), AV1 (`libsvtav1`), VP9, ProRes** | AV1 achieves 30–50% higher compression efficiency at equivalent visual quality compared to H.264. |
| **Hardware Acceleration** | Software only (`libx264` CPU execution) | **NVENC, QuickSync, VideoToolbox, VAAPI, Android MediaCodec** | Hardware encoding renders 5x–15x faster with 70% lower battery/CPU consumption. |
| **Trimming & Range Cutting** | Only for preview (5s–60s) | **Interactive timeline trimming with start/end boundary selection** | Allows users to cut unwanted footage before compressing, drastically saving time and space. |
| **Visual Cropping & Rotation** | Not available | **Interactive crop box & 90°/180° rotation controls** | Common requirement when preparing mobile videos for social media. |
| **Concurrent Multi-Core Queue** | Single-threaded serial execution | **Multi-worker concurrent job queue with thread management** | Modern multicore desktops and mobile chipsets can compress multiple small clips simultaneously. |
| **Comparison UX** | Split dual-screen only | **Side-by-side AND Interactive Before/After Split-Slider** | A split-slider allows pixel-level inspection of compression artifacts on the exact same frame. |
| **Privacy & Monetization** | Ad-supported with Google AdMob & Firebase tracking | **100% Ad-Free, Local, Privacy-First, Zero Telemetry** | Respects user privacy, eliminates network battery drain and intrusive banner/interstitial ads. |
| **Audio Codec Controls** | Fixed transcode or mute | **AAC, Opus, MP3, FLAC, Bitrate selection (64k–320k)** | Opus provides transparent audio quality at just 64 kbps (half the size of standard AAC). |
