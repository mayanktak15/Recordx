# Build a Chrome Extension for Video and Audio Recording

Act as a senior Chrome Extension developer and full-stack JavaScript engineer.

Build a complete, production-quality Chrome extension using **Manifest V3** that can record browser tab video and audio, initially supporting **Google Meet and X (Twitter/X Spaces)**.

The extension must have a modern, clean, easy-to-use interface with independent recording controls for microphone audio, tab/speaker audio, and video.

## 1. Core Features

### Video Recording
- Record Google Meet video meetings.
- Record X (Twitter) videos and X Spaces where browser capture is supported.
- Capture the current browser tab.
- Support video recording with or without audio.
- Provide recording quality options: 720p and 1080p where supported.
- Allow users to start, pause, resume, and stop recording.
- Display a live recording timer.
- Save recordings locally in WebM format, with MP4 export if technically supported.

### Microphone Audio Control
Provide an independent microphone recording option.

- Microphone ON/OFF toggle.
- Microphone device selection dropdown.
- Microphone volume adjustment for the recording.
- Live microphone audio-level indicator.
- Allow microphone-only recording.
- Allow microphone recording together with video and/or tab audio.

### Speaker / Tab Audio Control
Provide an independent tab audio recording option.

- Tab Audio ON/OFF toggle.
- Capture audio playing inside the selected Chrome tab, including other meeting participants.
- Tab audio volume adjustment for the recording.
- Live tab audio-level indicator.
- Allow tab-audio-only recording.
- Allow recording without microphone audio.
- Preserve tab audio playback for the user while recording, where supported.

Important: Clearly distinguish captured tab audio from operating-system speaker output. Do not claim to capture all system audio unless the platform and capture APIs support it.

## 2. Recording Modes

Support the following combinations:

| Mode | Video | Microphone | Tab Audio |
|---|---|---|---|
| Full Recording | ON | ON | ON |
| Video + Tab Audio | ON | OFF | ON |
| Video + Microphone | ON | ON | OFF |
| Video Only | ON | OFF | OFF |
| Audio Only (Both) | OFF | ON | ON |
| Microphone Only | OFF | ON | OFF |
| Tab Audio Only | OFF | OFF | ON |

All three controls must work independently.

## 3. Chrome Extension Popup UI

Create a beautiful popup dashboard with:

**Header**
- Extension name: Meet & X Recorder
- Current tab/platform detection
- Recording status indicator

**Recording Controls**
- Video Capture: ON/OFF
- Microphone: ON/OFF
- Tab Audio: ON/OFF

**Audio Settings**
- Microphone device selector
- Microphone recording volume slider
- Tab audio recording volume slider
- Separate audio-level meters

**Recording Actions**
- Start Recording
- Pause Recording
- Resume Recording
- Stop Recording

**Recording Information**
- Recording duration
- Current recording mode
- File size
- Recording quality

**Recording Library**
- List of previous recordings
- Play/preview recordings
- Download recordings
- Rename recordings
- Delete recordings

Use a modern dark theme with responsive styling, rounded controls, clear icons, and polished UI states.

## 4. Platform Support

### Google Meet
- Detect meet.google.com.
- Record the meeting tab and its available audio.
- Capture microphone separately when enabled.
- Work without modifying Google Meet's own microphone settings.
- Continue recording when the popup closes.

### X (Twitter)
- Detect x.com and twitter.com.
- Support recording X Spaces audio.
- Support recording X video playback.
- Capture available tab audio and optional microphone input.
- Support video capture when selected.

Do not bypass DRM, platform restrictions, or browser security controls.

## 5. Technical Architecture

Use:

- Chrome Extension Manifest V3
- JavaScript or TypeScript
- React for popup UI
- Tailwind CSS for styling
- Chrome Tab Capture API
- Chrome Offscreen Documents API
- MediaDevices.getUserMedia()
- MediaRecorder API
- Web Audio API for mixing audio streams
- IndexedDB for recording metadata and locally stored recordings
- Chrome Downloads API

Implement the correct Manifest V3 lifecycle.

Recording must continue when the extension popup closes. Use an offscreen document or another supported persistent recording context rather than relying on a popup or service worker remaining alive.

Mix microphone and tab audio using Web Audio API, with independent gain controls before sending the mixed stream to MediaRecorder.

When audio-only recording is selected, produce an audio-only file without requiring a video track.

## 6. Privacy and Permissions

- Recording must start only after explicit user interaction.
- Request appropriate Chrome permissions.
- Display a clear recording indicator.
- Handle microphone permission denial.
- Handle unsupported capture scenarios.
- Stop or safely finalize recordings when captured streams end.
- Store recordings locally by default.
- Never upload audio or video without explicit user consent.
- Provide a reminder to obtain appropriate participant consent before recording.

## 7. Error Handling

Handle:
- Microphone permission denied
- No microphone detected
- Tab capture unavailable
- Tab audio unavailable
- Recording interrupted
- Tab closed or navigated
- Browser resource limitations
- Recording save failure
- Unsupported recording formats

Display meaningful error messages and recovery options.

## 8. Project Structure

Create a complete, organized project containing:

- manifest.json
- background service worker
- offscreen recording document and controller
- React popup components
- Audio capture and mixing utilities
- Video recording utilities
- Recording storage service
- Download/export service
- CSS/Tailwind configuration
- Package.json
- README.md

## 9. Development Requirements

1. Generate complete working source code, not pseudocode.
2. Implement all recording modes.
3. Ensure independent microphone and tab audio toggles.
4. Make recording survive popup closure.
5. Use supported Chrome APIs and Manifest V3 permissions.
6. Do not fabricate support for unavailable system-audio capture or MP4 encoding.
7. Avoid unnecessary permissions and remote servers.
8. Include installation and testing instructions.
9. Include instructions to load the unpacked extension using chrome://extensions.
10. Test the recording workflow for Google Meet, X Spaces, and X videos.

## 10. Expected Deliverable

Deliver a fully functional Chrome extension project that can be built and loaded into Chrome.

Prioritize the following for version 1:

- Google Meet recording
- X Spaces recording
- Video ON/OFF
- Microphone ON/OFF
- Tab Audio ON/OFF
- Separate recording volume controls
- Start/Pause/Resume/Stop
- Local recording download
- Modern dark UI

Build the complete MVP first, then suggest optional future enhancements such as transcription, speaker separation, and cloud storage.