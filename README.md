# Meet & X Recorder 1.1

A Manifest V3 Chrome extension for recording a meeting, Space, video, or another tab stream. Video, microphone, and tab audio are independent. Recording and local exports continue after the popup closes. No account, server, analytics, or uploads.

## Build and load

Requires Node.js 20+ and pnpm, or npm.

```sh
pnpm install
pnpm test
pnpm build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project’s `dist` folder.
3. If upgrading from 1.0, stop existing recordings, then click **Reload** on the extension’s card. Your local recordings remain in the same extension installation. Do not uninstall first.
4. For microphone capture, open **Microphone access** in the recorder, click **Allow microphone**, and accept the browser prompt. Return to your Meet/X tab and open the recorder again. **Refresh microphones** updates the device list.
5. Obtain participant consent, choose your sources and quality, and click **Start recording**. Recording uses the current tab at start, even if you later switch tabs.
6. Pause/resume or **Stop & save**. In **Library**, play, search, rename, delete, or download an original. Audio-only recordings also offer **MP3** export.

Chrome 116+ is required. `pnpm dev` opens the interface in design preview mode; recording a real tab requires the installed extension. The popup fits Chrome’s height limit with an independently scrolling settings area and fixed recording actions.

## Quality and file size

Video resolution, frame rate, compression and audio bitrate are separate settings. Requested resolution/frame rate are maximum capture constraints; actual dimensions are displayed during capture. The source may be smaller. Bitrate is an encoder target, not a fixed file-size guarantee.

| Quick setup | Video | Audio | Approximate size per hour |
|---|---|---|---|
| Meet compact | 720p, 15 fps, Small file | 64 kbps | 269 MB |
| Presentation | 1080p, 24 fps, Balanced | 96 kbps | 1.55 GB |
| Audio only | No video | 48 kbps Opus | 21 MB |

The popup recalculates minute/hour estimates when settings change. For smaller recordings, first remove video if it is unnecessary, then lower resolution, compression target, frame rate and audio bitrate. Screen text may blur at low video bitrates. The defaults preserve the requested sources: **video ON, microphone ON at 80%, tab audio ON at 100%**.

## Formats

| Format | Use | Availability |
|---|---|---|
| WebM | Compact video or audio; VP9/VP8 and Opus | Default; checked at runtime |
| MP4 | Video with H.264 and optional audio | Only if Chrome reports native encoder support |
| M4A | Audio in an MP4 container | Only if Chrome reports native encoder support |
| MKV | Video in a Matroska container | Only if Chrome reports native encoder support |
| MP3 | A separately encoded audio export | **Library → MP3** for audio-only recordings |

Unsupported containers are disabled. MP4 and MKV are not fabricated by renaming WebM. The engine records the browser’s reported MIME type and uses its corresponding real filename extension. Switching to audio-only maps MP4 to M4A; switching back maps M4A to MP4.

**For smallest speech files, use audio-only WebM/Opus at 48 kbps.** MP3 is useful for player compatibility but is not inherently smaller. Resolution and bitrate usually affect size much more than the container name.

MP3 conversion decodes an audio-only original locally, then encodes it with a bundled JavaScript encoder in a worker. It never uploads media and leaves the source intact. The MP3 bitrate is the source audio setting clamped to 64–192 kbps. Conversion continues outside the popup. For memory safety, input files over 64 MB or an estimated 256 MB of decoded stereo PCM are refused (roughly 12 minutes at 48 kHz stereo). For long meetings, download the efficient WebM/M4A original and use a desktop converter if MP3 is essential. There is no MP4/MKV transcoder or MP3 extraction from video in this release.

## Recording and recovery

- The service worker obtains the tab stream ID; an offscreen document owns capture, audio mixing, recorder, storage and exports. Popup closure and worker idling do not end a recording.
- Each microphone and tab source has an independent gain and meter. Live gain changes are restored when reopening the popup. Capturing the microphone never changes Google Meet’s own mute controls.
- Tab playback is routed locally at its original level, independently of recording gain. Microphone audio is never played back. Use headphones to reduce echo.
- Only this tab’s available audio is captured, not all operating-system audio. Quiet media may yield a silent meter despite an available audio track.
- Double starts are rejected before obtaining a second capture ID. Internal Chrome pages are rejected with a useful error. Capture timeouts release any tracks that arrive late.
- Every media chunk and metadata checkpoint are written atomically in IndexedDB. Displayed bytes represent committed data. Storage failure stops recording while preserving prior chunks for recovery. There can be up to one timeslice plus queued writes of unsaved media.
- Stream end or closure of the captured tab saves the available recording. Closing a tab does not end an unrelated microphone-only recording. Navigation behavior depends on Chrome: capture continues if tracks survive.
- Interrupted entries offer best-effort recovery of saved chunks. Some truncated files may not play or seek. Browser exit, extension reload, OS sleep, crashes, quota and memory limits can interrupt capture. Download irreplaceable media regularly.
- Exports are prepared in the persistent offscreen document. Object URLs are released when a download completes or is interrupted, with a timed cleanup fallback. Conversion errors leave the original intact.
- Playback and downloads assemble media into memory. Very large files can exceed browser resources. Store only what you need, and download/delete old recordings. Storage estimates are approximate.
- All recording settings except audio gains are locked for the active session. The UI always shows the active session’s captured tab and actual settings rather than a newly opened tab’s defaults.
- Deletion is atomic and asks for confirmation. Uninstalling the extension clears its local database; download copies first.

DRM, browser-protected pages and platform capture restrictions are respected.

## Testing

```sh
pnpm test
pnpm build
```

Automated tests cover all seven capture modes, pause/resume, atomic checkpoints, simulated disk failure, restored live gain, duplicate/concurrent starts, microphone-only tab closure, capability checks, capture constraints, both bitrate settings, configuration migration, estimates, long timers and correct filenames. Real MP3 encoding is exercised for mono/stereo audio; `ffprobe`, if installed, independently verifies codec, channels, duration and bitrate.

For additional native browser checks:

1. Run `pnpm dev`.
2. Open `http://localhost:5173/tests/browser.html` (or the Vite URL shown in your terminal).
3. Click **Run native media tests**. This uses synthetic canvas video and an oscillator in place of tab/microphone sources, then exercises the real offscreen controller, native MediaRecorder, Web Audio, IndexedDB, media playback, MP3 worker and decoding. No microphone or real tab capture permissions are requested. Temporary entries in this localhost test origin are cleaned up; installed extension data is separate.

Real Meet/X tab capture still requires manual verification in an installed extension and actual media sessions. Synthetic tests do not establish platform compatibility.

| Manual scenario | Expected result |
|---|---|
| Meet compact preset | Participant voice + local mic + meeting video; both meters react. Meet’s mute state remains unchanged. Small file estimate and actual dimensions are displayed. |
| Meet audio only | No video track, 48 kbps requested audio; original plays and MP3 export works for a short sample. |
| X Spaces | Join a playing Space, disable video/mic, record participant audio with uninterrupted playback. |
| X video | Record unprotected playback with video + tab audio; check synchronization and actual quality. |
| All seven source modes | Expected tracks only; microphone and tab audio are independent. |
| Formats | Try each enabled WebM/MP4/M4A/MKV option. Output decodes and has the correct real extension. Unavailable formats stay disabled. |
| Popup and tab lifecycle | Close popup, switch tabs, reopen. Original captured tab/settings and elapsed time remain correct. Pause excludes paused time; microphone-only survives tab closure. |
| Failure handling | Deny mic, disconnect device, capture a restricted page, simulate quota failure. Useful error plus recoverable committed chunks. |
| Library/export | Search, play, rename, export original/MP3, close popup mid-export, then delete a disposable test recording. Confirm download and preserved original. |

## Files

- `src/background.js`: offscreen lifecycle, capture IDs, start lock, download lifecycle, badge.
- `src/offscreen.js`: recording state machine, capture, mix, meters, checkpointing, persistent exports.
- `src/shared.js`: supported containers, quality/bitrate policy, migration, estimates and helpers.
- `src/storage.js`: atomic IndexedDB recording/chunk transactions.
- `src/export.js`, `src/mp3-worker.js`, `src/mp3-encoder.js`: local export, decode and worker encoding.
- `src/main.jsx`, `src/icons.jsx`, `src/style.css`: React/Tailwind popup and local SVG icons.
- `public/permission.html`: explicit microphone permission flow.

The bundled `@breezystack/lamejs` MP3 encoder is LGPL-3.0; its license is included under `public/licenses/` and copied to the extension build. Source: https://github.com/shijinyu/lamejs

Chrome capture architecture: https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture

Potential future work: streaming MP3 encoding for long sessions, disk streaming for large video, captions, transcription, speaker separation and explicit opt-in cloud backup.
