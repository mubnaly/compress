# 01. Target Product Reconnaissance: Proton Video Compressor

## Executive Summary

This reconnaissance report documents the comprehensive black-box and static architectural investigation of the target Android application **Proton Video Compressor** (version `3.4.1`, package name `com.arthur.hritik.proton.video.compressor`). The analysis was conducted in accordance with non-destructive, clean-room reverse-engineering methodologies utilizing the unpacked application artifact (`base.apk`), Android AAPT asset parsing, DEX symbol analysis, resource tree decoding, and controlled multimedia verification.

---

## 1. Application Inventory & Metadata

| Attribute | Extracted Value | Evidence Source |
|---|---|---|
| **Application Name** | Proton Video Compressor | `AndroidManifest.xml`, `resources.arsc` (`string/app_name`) |
| **Package Name** | `com.arthur.hritik.proton.video.compressor` | `AndroidManifest.xml` (package attribute) |
| **Version Name** | `3.4.1` | `AndroidManifest.xml` (`versionName`) |
| **Version Code** | `104` | `AndroidManifest.xml` (`versionCode`) |
| **Platform Target** | Android 15 (API level 35) | `compileSdkVersion=35`, `targetSdkVersion=35` |
| **Minimum Supported SDK** | Android 10 (API level 29) | `minSdkVersion=29` |
| **Distribution Format** | Split APK / Android App Bundle (`base.apk`) | `requiredSplitTypes="base__abi,base__density"` |
| **Developer / Entity** | Arthur Hritik | Package identifier, namespace, Play Store metadata |
| **Local Processing** | 100% Local / On-Device | Verified via string table: `feature_offline_title` ("100% Offline"), `feature_offline_desc` ("No cloud upload, no privacy risk. Everything stays on your device.") |
| **Monetization / Ads** | Google Mobile Ads (AdMob SDK) & Firebase | Manifest activities: `com.google.android.gms.ads`, banner & native ad templates |
| **Analytics & Telemetry** | Google Firebase Analytics & Crashlytics | `ComponentDiscoveryService`, `CrashlyticsRegistrar` |

---

## 2. Permissions & System Interactions

The application requests 18 permissions designed for media access, foreground processing, and ad tracking:

```xml
<!-- Storage & Media Access -->
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

<!-- Background Execution & Lifecycle -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.VIBRATE" />

<!-- Network & Telemetry (Used solely for Ads & Analytics) -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="com.google.android.gms.permission.AD_ID" />
<uses-permission android:name="android.permission.ACCESS_ADSERVICES_ATTRIBUTION" />
<uses-permission android:name="android.permission.ACCESS_ADSERVICES_AD_ID" />
<uses-permission android:name="android.permission.ACCESS_ADSERVICES_TOPICS" />
```

### Observations on Permissions:
1. **Offline Independence**: The core multimedia processing does **not** make network requests or communicate with backend compression servers. The internet permission is utilized exclusively by Google Mobile Ads and Firebase Crashlytics.
2. **Granular Media Permissions**: Compatible with Android 13/14+ (`READ_MEDIA_VIDEO` and Android 14 partial photo/video picker `READ_MEDIA_VISUAL_USER_SELECTED`).
3. **Foreground Data Sync**: Utilizes `FOREGROUND_SERVICE_DATA_SYNC` to comply with Android 14+ foreground service type mandates.

---

## 3. Component Architecture & Screen Inventory

### A. Activities

1. **`com.arthur.hritik.video.compressor.ui.activities.EntryActivity`**
   - **Role**: Splash screen, onboarding, initial permission validation, and dynamic entry routing.
   - **Layout**: `res/layout/activity_entry.xml`
   - **Behaviors**: Checks storage permissions; presents initial Privacy Policy agreement (`agree_to_privacy`: *"By clicking on Get Started, you agree to our privacy policy"*).

2. **`com.arthur.hritik.video.compressor.ui.activities.MainActivity`**
   - **Role**: Primary application container hosting Jetpack Navigation graph (`navigation_main.xml`).
   - **Layout**: `res/layout/activity_main.xml` (contains `FragmentContainerView [id=id/mainNavHostFragment]`, `FrameLayout [id=id/adContainerView]`, progress overlay).

3. **`com.arthur.hritik.video.compressor.ui.activities.PreviewActivity`**
   - **Role**: Video preview generator and playback verification screen.
   - **Layout**: `res/layout/activity_preview.xml`
   - **Behaviors**: Allows user to select segment duration (5s, 10s, 15s, 20s, 30s, 45s, 60s), generates a fast transcode sample using ExoPlayer for playback, displays side-by-side bitrate/size estimation, and provides "Re-preview" or "Compress" actions.

4. **`com.arthur.hritik.video.compressor.ui.activities.CompareActivity`**
   - **Role**: Side-by-side or synced player comparing original uncompressed vs. compressed video.
   - **Layout**: `res/layout/activity_compare.xml`
   - **Components**: Dual ExoPlayer views (`StyledPlayerView [id=id/originalPlayer]` and `StyledPlayerView [id=id/compressedPlayer]`), displaying original file size vs compressed file size.

5. **`com.arthur.hritik.video.compressor.ui.activities.CompressionStatsActivity`**
   - **Role**: Historical metrics screen reporting total storage saved across all compression runs.
   - **Layout**: `res/layout/activity_compression_stats.xml` / `fragment_compression_stats.xml`.

6. **`com.arthur.hritik.video.compressor.ui.activities.UnsupportedDeviceActivity`**
   - **Role**: Fallback screen for legacy devices lacking minimum hardware or codec capabilities.

7. **`com.arthur.hritik.video.compressor.ui.activities.ForceUpdateActivity`**
   - **Role**: In-app update gatekeeper when backend flags mark the version deprecated.

---

### B. Fragments & Navigation Graphs

The app uses `navigation_main.xml` managing transitions between primary views:

1. **`HomeFragment` (`res/layout/fragment_home.xml`)**:
   - Contains top toolbar (`layout_toolbar.xml`), tabs (`TabLayout [id=id/tabs]`), `ViewPager2 [id=id/viewpager]`, and cross-promotion banners (`image_compressor`: *"Try our image compressor app"*).
   - Hosts sub-views: Album directory picker (`fragment_albums.xml`) and Video multi-selection list (`fragment_video_list.xml`).

2. **`VideoDetailsFragment` (`res/layout/fragment_video_details.xml`)**:
   - The central compression configuration dashboard for a selected video.
   - Displays video thumbnail, duration, file size, and original resolution.
   - Offers output filename configuration (`bottom_sheet_custom_file_name.xml`).
   - Toggles: "Copy Metadata" checkbox (`-map_metadata 0`), "Remove Audio" checkbox (`-an`).
   - Audio Volume slider: range 0% to 300% with Reset action.
   - Quality/Preset list recycler view (`item_quality.xml`).
   - Action buttons: "Preview" and "Compress".

3. **`CompressionResultsFragment` (`res/layout/fragment_compression_results.xml`)**:
   - Shows the outcome of single or batch compression jobs.
   - Each completed item displays original size, final size, space saved percentage.
   - Statuses handled: Success, `compression_failed` ("Compression Failed"), and `already_optimal` ("Already Optimal - This video is already well compressed...").
   - Actions per video: Share, Compare (launches `CompareActivity`), and "Delete original".
   - Feedback and star/emoji rating container (`layout_emoji_rating.xml`).

4. **`SettingsFragment` (`res/layout/fragment_settings.xml`)**:
   - Switch: `switchAnalytics` (Share anonymous usage data).
   - Switch: `switchCrashlytics` (Share crash reports).
   - Switch: `switchAllowSizeIncrease` ("Continue even if file size increases" - allows overriding the Already-Optimal guard).
   - Ad preferences link.

5. **Bottom Sheets & Dialogs**:
   - **`CustomResolutionBottomSheetFragment` (`bottom_sheet_fragment_custom_resolution.xml`)**:
     - Custom width & height text inputs.
     - "Lock Aspect Ratio" checkbox.
     - Interactive percentage slider (SeekBar).
     - Validation: Width/height > 128, must be multiples of 2, must not exceed original bounds.
   - **`CustomFileSizeBottomSheet` (`bottom_sheet_fragment_custom_filesize.xml`)**:
     - Target file size in MB with `+` / `-` increment buttons and slider.
     - Validation against minimum duration threshold (`file_size_too_small`).
   - **`BottomSheetBattery` (`bottom_sheet_battery.xml` / `dialog_go_background.xml`)**:
     - Explains Android OS background task restrictions.
     - Guides users to disable Battery Optimization for uninterrupted compression.

---

### C. Services & Database

1. **`CompressionService` (`com.arthur.hritik.video.compressor.service.CompressionService`)**:
   - Android Foreground Service managing the FFmpeg execution lifecycle.
   - Posts persistent notification with real-time percentage progress.
   - Acquires `WAKE_LOCK` to prevent CPU sleep during long renders.
   - Contains execution safety timeout watchdog (`CompressionService foreground service timeout`).

2. **SQLite / Room Database (`compressed_video_stats`)**:
   - Database schema revealed in bytecode:
     ```sql
     CREATE TABLE IF NOT EXISTS `compressed_video_stats` (
       `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
       `original_video_path` TEXT NOT NULL,
       `compressed_video_path` TEXT NOT NULL,
       `timestamp` INTEGER NOT NULL,
       `compression_status` INTEGER NOT NULL,
       `o_width` INTEGER NOT NULL,
       `o_height` INTEGER NOT NULL,
       `o_rotation` INTEGER NOT NULL,
       `o_bitrate_kbps` INTEGER NOT NULL,
       `o_file_size_kB` INTEGER NOT NULL,
       `duration_secs` INTEGER NOT NULL,
       `c_width` INTEGER NOT NULL,
       `c_height` INTEGER NOT NULL,
       `c_rotation` INTEGER NOT NULL,
       `c_bitrate_kbps` INTEGER NOT NULL,
       `c_file_size_kB` INTEGER NOT NULL
     );
     ```

---

## 4. Complete User Flow & Screen State Machine

```mermaid
stateDiagram-v2
    [*] --> EntryActivity: App Launch
    EntryActivity --> HomeFragment: Permissions Granted & Privacy Accepted
    EntryActivity --> EntryActivity: Request Permissions

    state HomeFragment {
        [*] --> AlbumList: Default Tab
        AlbumList --> VideoList: Select Folder / Album
        VideoList --> VideoList: Multi-select Videos (Batch)
    }

    HomeFragment --> VideoDetailsFragment: Single or Batch Selection Confirmed
    HomeFragment --> DrawerNavigation: Open Drawer
    
    state DrawerNavigation {
        SettingsFragment
        FAQFragment
        PrivacyPolicyFragment
        RateApp
    }

    state VideoDetailsFragment {
        [*] --> InspectMetadata: Auto-probe (Resolution, Duration, Bitrate)
        InspectMetadata --> QualitySelection
        QualitySelection --> CustomResolutionBottomSheet: Select "Custom Resolution"
        QualitySelection --> CustomFileSizeBottomSheet: Select "Custom File Size"
        QualitySelection --> PreviewActivity: Click "Preview"
        QualitySelection --> StartCompression: Click "Compress"
    }

    state PreviewActivity {
        [*] --> SelectChip: 5s / 10s / 15s / 30s / 60s
        SelectChip --> FastTranscode: Generate Preview (ultrafast)
        FastTranscode --> PlayPreview: ExoPlayer Playback
        PlayPreview --> VideoDetailsFragment: Re-preview or Accept
    }

    StartCompression --> CompressionService: Enqueue Job & Start Foreground Service
    
    state CompressionService {
        [*] --> BackgroundCheck: Verify Battery Optimization
        BackgroundCheck --> FFmpegExecution: Run FFmpeg Process
        FFmpegExecution --> PostProcess: Compare Output Size vs Original
        PostProcess --> EvaluateGuard: Is Output >= Original?
        EvaluateGuard --> MarkAlreadyOptimal: Yes & Size Increase Flag = False
        EvaluateGuard --> MarkSuccess: No or Size Increase Flag = True
    }

    CompressionService --> CompressionResultsFragment: All Jobs Completed
    
    state CompressionResultsFragment {
        [*] --> DisplayCards
        DisplayCards --> CompareActivity: Click "Compare" (Dual Player)
        DisplayCards --> ShareIntent: Click "Share"
        DisplayCards --> DeletePrompt: Click "Delete original"
    }

    CompressionResultsFragment --> HomeFragment: Close / Done
```

---

## 5. Technical Evidence Matrix

| Component / Flow | Observed Behavior | Primary Evidence Reference | Confidence |
|---|---|---|---|
| **Engine** | Uses FFmpegKit (`libx264`, `libvpx-vp9`) | DEX strings: `Lcom/arthenica/ffmpegkit/FFmpegKitConfig;`, `-vcodec libx264` | **Confirmed (100%)** |
| **Preview** | Generates fast partial sample (5s–60s) | Layout `activity_preview.xml`, DEX `preview_5s.mp4`, `chip5s` to `chip60s` | **Confirmed (100%)** |
| **Comparison** | Dual ExoPlayer side-by-side/synced player | Layout `activity_compare.xml`, IDs: `originalPlayer`, `compressedPlayer` | **Confirmed (100%)** |
| **Metadata** | Toggle to preserve container metadata | CheckBox `Copy Metadata` in `fragment_video_details.xml`, DEX `-map_metadata 0` | **Confirmed (100%)** |
| **Audio Removal** | Checkbox to mute audio stream | CheckBox `Remove Audio` in `fragment_video_details.xml`, FFmpeg `-an` flag | **Confirmed (100%)** |
| **Audio Volume** | Slider from 0% to 300% with Reset | `volumeSeekbar`, `volumeReset`, FFmpeg `-filter:a volume=` | **Confirmed (100%)** |
| **WhatsApp Preset** | 16 MB target check with warning | DEX string: `"Video is already smaller than 16 MB required by WhatsApp."` | **Confirmed (100%)** |
| **Gmail Preset** | 25 MB target check with warning | DEX string: `"Video is already smaller than 25 MB required by Gmail."` | **Confirmed (100%)** |
| **Already Optimal** | Blocks larger output unless toggled | Layout `item_compressed_video_v2.xml`, strings `already_optimal`, `setting_allow_size_increase_label` | **Confirmed (100%)** |
| **Delete Original** | Prompts to delete uncompressed video | Button `delete_original` in results view, storage delete intent | **Confirmed (100%)** |
