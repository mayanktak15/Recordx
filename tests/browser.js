import { defaults, supportedFormats } from '../src/shared.js';
import { getRecording, recordingBlob, deleteRecording } from '../src/storage.js';
const log = document.querySelector('#log');
const say = line => { log.textContent += '\n' + line; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let receive, downloaded, canvasTimer;
const contexts = [];
const ids = [];
function check(value, message) { if (!value) throw new Error(message); }
window.chrome = { runtime: {
  onMessage: { addListener(fn) { receive = fn; } },
  async sendMessage(message) {
    if (message.type === 'downloadReady') { downloaded = message; return { ok: true }; }
    return { ok: true };
  },
} };
const canvas = document.querySelector('canvas'), brush = canvas.getContext('2d');
function frame() { brush.fillStyle = '#193858'; brush.fillRect(0, 0, 640, 360); brush.fillStyle = '#a5c8ff'; brush.font = '30px system-ui'; brush.fillText('Synthetic meeting · ' + new Date().toLocaleTimeString(), 30, 170); }
async function syntheticCapture(constraints) {
  const tracks = [];
  if (constraints.video) tracks.push(...canvas.captureStream(15).getVideoTracks());
  if (constraints.audio) {
    const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
    const gain = context.createGain(); gain.gain.value = .05;
    oscillator.connect(gain); gain.connect(destination); await context.resume(); oscillator.start(); say('Synthetic source AudioContext=' + context.state);
    contexts.push(context); tracks.push(...destination.stream.getAudioTracks());
  }
  return new MediaStream(tracks);
}
const command = (type, args = {}) => new Promise(resolve => receive({ target: 'engine', type, ...args }, {}, resolve));
async function waitUntil(predicate) { for (let i = 0; i < 300; i++) { const { state } = await command('state'); if (predicate(state)) return state; await delay(50); } throw new Error('Timed out waiting for engine'); }
document.querySelector('#run').onclick = async event => {
  event.target.disabled = true; log.textContent = 'Running with actual Chrome MediaRecorder, Web Audio, IndexedDB and MP3 worker…';
  const nativeDecode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = async function (...args) { const buffer = await nativeDecode.apply(this, args); say('Decode ' + buffer.sampleRate + ' Hz, ' + buffer.numberOfChannels + ' ch, peak ' + buffer.getChannelData(0).reduce((max, value) => Math.max(max, Math.abs(value)), 0)); return buffer; };
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = syntheticCapture;
  frame(); canvasTimer = setInterval(frame, 100);
  try {
    await import('../src/offscreen.js');
    const formats = supportedFormats(defaults, mime => MediaRecorder.isTypeSupported(mime));
    say('Video capabilities: ' + formats.map(f => f.id + '=' + f.supported).join(', '));
    const cases = Array.from({ length: 7 }, (_, i) => { const bits = i + 1; return { label: 'mode ' + bits, config: { ...defaults, video: !!(bits & 1), microphone: !!(bits & 2), tabAudio: !!(bits & 4), quality: '480', audioKbps: 64, fps: 15 } }; });
    for (const f of formats.filter(f => f.supported && f.id !== 'webm')) cases.push({ label: f.label + ' video', config: { ...defaults, format: f.id, quality: '480', audioKbps: 64, fps: 15 } });
    if (supportedFormats({ ...defaults, video: false }, m => MediaRecorder.isTypeSupported(m)).find(f => f.id === 'm4a')?.supported) cases.push({ label: 'M4A audio', config: { ...defaults, video: false, format: 'm4a', audioKbps: 64 } });
    for (const [caseIndex, { label, config }] of cases.entries()) {
      const started = await command('start', { config, streamId: 'synthetic', tab: { id: 123, title: 'Browser smoke ' + label } });
      check(started.ok, started.error); ids.push(started.state.recordingId);
      await delay(1200); await command('pause');
      const paused = (await command('state')).state.duration;
      await delay(100); check((await command('state')).state.duration === paused, 'Paused time advanced');
      await command('resume'); await delay(300); await command('stop');
      const saved = await waitUntil(s => s.status === 'idle' || s.status === 'error');
      check(!saved.error, saved.error);
      const record = await getRecording(saved.savedId), blob = await recordingBlob(saved.savedId);
      check(record.bytes === blob.size && blob.size > 0, 'Chunk/metadata size mismatch');
      const url = URL.createObjectURL(blob), element = document.createElement(config.video ? 'video' : 'audio');
      element.src = url; element.muted = true;
      await new Promise((resolve, reject) => { element.onloadeddata = resolve; element.onerror = () => reject(new Error('Saved media cannot be decoded')); element.load(); });
      if (config.video) check(element.videoWidth > 0, 'No video in saved media');
      element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url);
      say('PASS ' + label + ': ' + record.mode + ' → ' + blob.type + ' (' + blob.size + ' bytes), playback decoded');
      if (caseIndex === 1) {
        downloaded = null;
        await command('export', { id: saved.savedId, format: 'mp3' });
        const exported = await waitUntil(s => ['ready', 'error'].includes(s.export?.status));
        check(exported.export.status === 'ready', exported.export.error);
        check(downloaded.extension === 'mp3', 'Wrong export extension');
        const mp3 = await (await fetch(downloaded.url)).blob();
        check(mp3.type === 'audio/mpeg' && mp3.size > 1000, 'Invalid MP3 blob');
        const decoder = new AudioContext(); const originalAudio = await decoder.decodeAudioData(await blob.arrayBuffer());
        const peak = channel => channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        say('Original PCM peak: ' + peak(originalAudio.getChannelData(0)));
        const audio = await decoder.decodeAudioData(await mp3.arrayBuffer()); say('MP3 PCM peak: ' + peak(audio.getChannelData(0)));
        check(audio.duration > 1, 'MP3 too short'); check(audio.getChannelData(0).some(sample => Math.abs(sample) > .001), 'MP3 lost the generated signal'); await decoder.close();
        await command('revokeExport', { url: downloaded.url });
        say('PASS MP3: worker encoded, download URL persisted, native decoder accepted exported audio');
      }
      await Promise.all(contexts.splice(0).map(c => c.close()));
    }
    say('ALL BROWSER TESTS PASSED'); document.body.dataset.result = 'passed';
  } catch (error) { say('FAIL: ' + error.message); document.body.dataset.result = 'failed'; }
  finally {
    AudioContext.prototype.decodeAudioData = nativeDecode;
    clearInterval(canvasTimer); navigator.mediaDevices.getUserMedia = original;
    await command('stop'); await Promise.all(contexts.map(c => c.close()));
    for (const id of ids) await deleteRecording(id);
  }
};
