import { mimeCandidates, elapsed, mode, normalizeConfig, encodingOptions, supportedFormats, isActive } from './shared.js';
import { appendChunk, putRecording } from './storage.js';
import { prepareExport, revokeExport } from './export.js';
let state = { status: 'idle', duration: 0, bytes: 0 };
let exportState = { status: 'idle' };
let recorder, context, output, streams = [], gains = {}, analysers = {};
let pending = Promise.resolve(), index = 0, metadata, timer, stopping = false, writeError;
const snapshot = () => ({ ...state, export: exportState });
function publish(badge = true) {
  chrome.runtime.sendMessage({ target: 'popup', type: 'state', state: snapshot() }).catch(() => {});
  if (badge) chrome.runtime.sendMessage({ target: 'background', type: 'badge', status: state.status }).catch(() => {});
}
function release() {
  clearInterval(timer);
  for (const stream of streams) for (const track of stream.getTracks()) { track.onended = null; track.stop(); }
  output?.getTracks().forEach(t => t.stop());
  streams = []; output = null;
  context?.close().catch(() => {}); context = null;
  gains = {}; analysers = {}; state.levels = {};
}
function meter(analyser) {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  return Math.min(1, Math.sqrt(data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / data.length) * 4);
}
function capture(constraints) {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error('Capture timed out. Grant microphone access first, return to the meeting tab and retry.'));
    }, 20000);
    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
      clearTimeout(timeout);
      if (expired) stream.getTracks().forEach(t => t.stop()); else resolve(stream);
    }, error => { clearTimeout(timeout); reject(error); });
  });
}
function readableError(error) {
  if (error.name === 'NotAllowedError') return 'Capture permission denied. Use Microphone access to allow the extension, then reopen it on your meeting tab. Protected tab content cannot be captured.';
  if (error.name === 'NotFoundError') return 'No microphone found. Connect a microphone or switch microphone recording off.';
  if (error.name === 'OverconstrainedError') return 'The selected device or quality is unavailable. Select Default microphone or a lower resolution, then retry.';
  if (error.name === 'NotReadableError') return 'Chrome could not read the capture source. Close other capture sessions, check the device and retry.';
  return error.message || 'Recording failed. Try a smaller quality preset.';
}
function extensionFor(mime) {
  return mime.includes('matroska') ? 'mkv' : mime.includes('mp4') ? mime.startsWith('audio/') ? 'm4a' : 'mp4' : 'webm';
}
async function start(message) {
  if (isActive(state)) throw new Error('A recording is already running.');
  if (exportState.status === 'working') throw new Error('Wait for the current export to finish before recording.');
  const config = normalizeConfig(message.config);
  if (!config.video && !config.microphone && !config.tabAudio) throw new Error('Enable at least one recording source.');
  state = { status: 'starting', duration: 0, bytes: 0, config, tab: message.tab };
  publish(); stopping = false; writeError = null; recorder = null; metadata = null;
  try {
    const mime = mimeCandidates(config.video, config.format, config.microphone || config.tabAudio).find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('This format is unavailable in this Chrome installation. Select WebM to record.');
    let tab, microphone;
    if (config.video || config.tabAudio) {
      if (!message.streamId) throw new Error('Tab capture is unavailable. Open a normal web tab and start again.');
      const height = +config.quality, width = Math.round(height * 16 / 9);
      tab = await capture({
        audio: config.tabAudio ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } } : false,
        video: config.video ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId, maxWidth: width, maxHeight: height, maxFrameRate: config.fps } } : false,
      });
      streams.push(tab);
      if (config.tabAudio && !tab.getAudioTracks().length) throw new Error('This tab provides no audio track. Disable tab audio or choose a playing tab.');
      if (config.video && !tab.getVideoTracks().length) throw new Error('This tab provides no video track. Switch to audio only or choose another tab.');
    }
    if (config.microphone) {
      microphone = await capture({ audio: { deviceId: config.deviceId ? { exact: config.deviceId } : undefined, echoCancellation: true, noiseSuppression: true }, video: false });
      streams.push(microphone);
    }
    output = new MediaStream(tab?.getVideoTracks() || []);
    if (config.microphone || config.tabAudio) {
      context = new AudioContext(); await context.resume();
      const mixed = context.createMediaStreamDestination();
      for (const [source, stream, volume] of [['microphone', microphone, config.micVolume], ['tabAudio', tab, config.tabVolume]]) {
        if (!stream?.getAudioTracks().length) continue;
        const input = context.createMediaStreamSource(stream), gain = context.createGain(), analyser = context.createAnalyser();
        gain.gain.value = volume; analyser.fftSize = 256;
        input.connect(gain); gain.connect(analyser); analyser.connect(mixed);
        gains[source] = gain; analysers[source] = analyser;
        // Playback bypasses recording gain; microphone is never played back.
        if (source === 'tabAudio') input.connect(context.destination);
      }
      mixed.stream.getAudioTracks().forEach(t => output.addTrack(t));
    }
    recorder = new MediaRecorder(output, { mimeType: mime, ...encodingOptions(config) });
    const actualMime = recorder.mimeType || mime;
    const settings = output.getVideoTracks()[0]?.getSettings?.();
    metadata = {
      id: crypto.randomUUID(), name: message.tab.title, date: Date.now(), mime: actualMime,
      format: extensionFor(actualMime), extension: extensionFor(actualMime), mode: mode(config), config,
      audioKbps: config.audioKbps, quality: config.video ? config.quality + 'p' : 'Audio',
      actualVideo: settings ? { width: settings.width, height: settings.height, frameRate: settings.frameRate } : null,
      status: 'recording', duration: 0, bytes: 0,
    };
    await putRecording(metadata);
    pending = Promise.resolve(); index = 0;
    recorder.ondataavailable = event => {
      if (!event.data.size || writeError) return;
      const chunkIndex = index++;
      const checkpoint = { ...metadata, bytes: state.bytes + event.data.size, duration: elapsed(state) };
      // Serialize atomic chunk+metadata transactions; don't count data until it is durable.
      pending = pending.then(async () => {
        if (writeError) return;
        checkpoint.bytes = state.bytes + event.data.size;
        try {
          await appendChunk(metadata.id, chunkIndex, event.data, checkpoint);
          state.bytes = checkpoint.bytes;
        } catch (error) {
          writeError = error;
          state.error = 'Local storage is full or unavailable. Recording stopped; previously saved chunks can be downloaded from the library.';
          stop();
        }
      });
    };
    recorder.onerror = event => {
      state.error = event.error?.message || 'Browser recording resources were exhausted. Try a smaller preset.';
      stop();
    };
    recorder.onstop = async () => {
      state.duration = elapsed(state); state.status = 'saving'; publish(); release();
      await pending;
      try {
        await putRecording({ ...metadata, duration: state.duration, bytes: state.bytes, status: writeError || state.error ? 'interrupted' : 'saved' });
        state = { ...state, status: 'idle', savedId: metadata.id };
      } catch (error) {
        state = { ...state, status: 'error', error: 'Could not finalize metadata. Previously committed media chunks remain available in the library. ' + error.message };
      }
      publish();
    };
    streams.forEach(stream => stream.getTracks().forEach(track => {
      track.onended = () => { state.error = 'A capture source ended. Available media was saved to the library.'; stop(); };
    }));
    recorder.start(1000);
    state = { ...state, status: 'recording', since: Date.now(), recordingId: metadata.id, actualVideo: metadata.actualVideo, mime: actualMime, extension: metadata.extension };
    publish();
    timer = setInterval(() => {
      state.levels = state.status === 'recording' ? Object.fromEntries(Object.entries(analysers).map(([key, analyser]) => [key, meter(analyser)])) : {};
      publish(false);
    }, 250);
    return { ok: true, state: snapshot() };
  } catch (error) {
    release();
    if (metadata) await putRecording({ ...metadata, status: 'interrupted' }).catch(() => {});
    state = { status: 'error', duration: 0, bytes: 0, error: readableError(error) }; publish();
    throw new Error(state.error);
  }
}
function stop() {
  if (stopping || !recorder || recorder.state === 'inactive') return;
  stopping = true;
  state.duration = elapsed(state); state.status = 'stopping'; publish();
  recorder.stop();
}
async function exportRecording(message) {
  if (isActive(state)) throw new Error('Stop and save the active recording before exporting.');
  if (exportState.status === 'working') throw new Error('Another export is still running.');
  exportState = { status: 'working', id: message.id, progress: 0, format: message.format }; publish(false);
  // Keep work in this persistent document, independent of popup/worker lifetime.
  (async () => {
    try {
      const result = await prepareExport(message.id, message.format, progress => {
        exportState = { ...exportState, progress }; publish(false);
      });
      const reply = await chrome.runtime.sendMessage({ target: 'background', type: 'downloadReady', ...result });
      if (!reply?.ok) { revokeExport(result.url); throw new Error(reply?.error || 'Download failed. Try again.'); }
      exportState = { ...exportState, status: 'ready', progress: 100 };
    } catch (error) { exportState = { ...exportState, status: 'error', error: error.message }; }
    publish(false);
  })();
  return { ok: true, state: snapshot() };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'engine') return;
  (async () => {
    switch (message.type) {
      case 'start': return start(message);
      case 'state': return { ok: true, state: snapshot() };
      case 'pause':
        if (recorder?.state === 'recording') {
          recorder.pause(); state.duration = elapsed(state); state.status = 'paused'; state.levels = {}; publish();
        }
        break;
      case 'resume':
        if (recorder?.state === 'paused') {
          recorder.resume(); state.status = 'recording'; state.since = Date.now(); publish();
        }
        break;
      case 'stop': stop(); break;
      case 'tabEnded': if ((state.config?.video || state.config?.tabAudio) && message.tabId === state.tab?.id) stop(); break;
      case 'volume': {
        if (!['microphone', 'tabAudio'].includes(message.source) || !Number.isFinite(message.value)) throw new Error('Invalid recording volume.');
        const value = Math.min(1.5, Math.max(0, message.value));
        if (gains[message.source]) {
          gains[message.source].gain.setTargetAtTime(value, context.currentTime, .02);
          state.config = { ...state.config, [message.source === 'microphone' ? 'micVolume' : 'tabVolume']: value }; publish(false);
        }
        break;
      }
      case 'devices': return { ok: true, devices: (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label })) };
      case 'formats': return { ok: true, formats: supportedFormats(normalizeConfig(message.config), mime => MediaRecorder.isTypeSupported(mime)) };
      case 'export': return exportRecording(message);
      case 'revokeExport': revokeExport(message.url); break;
      case 'dismissError': state.error = ''; exportState = exportState.status === 'error' ? { status: 'idle' } : exportState; publish(false); break;
    }
    return { ok: true, state: snapshot() };
  })().then(reply).catch(error => reply({ ok: false, error: readableError(error) }));
  return true;
});
