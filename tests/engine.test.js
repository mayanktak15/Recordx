import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared.js';
import { installDatabase } from './fake-idb.js';
const database = installDatabase();
let receive, captures = [], denied = false, lastRecorder, supports = () => true;
globalThis.chrome = { runtime: { onMessage: { addListener(fn) { receive = fn; } }, sendMessage: async () => ({ ok: true }) } };
class Track { constructor(kind) { this.kind = kind; } stop() { this.stopped = true; } getSettings() { return { width: 1280, height: 720, frameRate: 15 }; } }
class Stream { constructor(tracks = []) { this.tracks = tracks; } getTracks() { return this.tracks; } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); } addTrack(t) { this.tracks.push(t); } }
globalThis.MediaStream = Stream;
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: {
  async getUserMedia(constraints) {
    if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    captures.push(constraints);
    return new Stream([...(constraints.audio ? [new Track('audio')] : []), ...(constraints.video ? [new Track('video')] : [])]);
  },
  async enumerateDevices() { return []; },
} }, configurable: true });
function node() { return { connect() {}, gain: { value: 1, setTargetAtTime() {} }, fftSize: 256, getByteTimeDomainData(a) { a.fill(128); } }; }
globalThis.AudioContext = class {
  destination = node(); currentTime = 0; async resume() {} async close() {}
  createMediaStreamDestination() { return { ...node(), stream: new Stream([new Track('audio')]) }; }
  createMediaStreamSource() { return node(); } createGain() { return node(); } createAnalyser() { return node(); }
};
globalThis.MediaRecorder = class {
  static isTypeSupported(mime) { return supports(mime); }
  constructor(stream, options) { this.stream = stream; this.options = options; this.mimeType = options.mimeType; lastRecorder = this; this.state = 'inactive'; }
  start() { this.state = 'recording'; } pause() { this.state = 'paused'; } resume() { this.state = 'recording'; }
  chunk() { this.ondataavailable({ data: new Blob(['media'], { type: this.options.mimeType }) }); }
  stop() { this.state = 'inactive'; this.chunk(); this.onstop(); }
};
await import('../src/offscreen.js');
const command = (type, args = {}) => new Promise(resolve => receive({ target: 'engine', type, ...args }, {}, resolve));
const start = config => command('start', { config, streamId: config.video || config.tabAudio ? 'capture-id' : null, tab: { id: 1, title: 'Synthetic Meet', url: 'https://meet.google.com/abc' } });
const wait = () => new Promise(resolve => setTimeout(resolve, 3));
async function finalized() {
  for (let i = 0; i < 100; i++) { const r = await command('state'); if (['idle', 'error'].includes(r.state.status)) return r.state; await wait(); }
  throw new Error('Engine did not finish saving');
}
test('engine captures, pauses, resumes and saves all seven source combinations', async () => {
  for (let bits = 1; bits < 8; bits++) {
    captures = [];
    const config = { ...defaults, video: !!(bits & 1), microphone: !!(bits & 2), tabAudio: !!(bits & 4) };
    const result = await start(config);
    assert.equal(result.ok, true, result.error);
    assert.equal(lastRecorder.stream.getVideoTracks().length, config.video ? 1 : 0);
    assert.equal(lastRecorder.stream.getAudioTracks().length, config.microphone || config.tabAudio ? 1 : 0);
    assert.equal(captures.length, (config.video || config.tabAudio ? 1 : 0) + (config.microphone ? 1 : 0));
    await command('pause'); assert.equal((await command('state')).state.status, 'paused');
    await command('resume'); assert.equal((await command('state')).state.status, 'recording');
    await command('stop');
    const state = await finalized();
    assert.equal(state.bytes, 5);
    assert.equal(database.stores.get('recordings').get(state.savedId).status, 'saved');
    assert.equal(database.stores.get('recordings').get(state.savedId).bytes, 5);
  }
});
test('quality choices reach capture constraints and both encoder bitrates', async () => {
  captures = [];
  await start({ ...defaults, quality: '480', compression: 'small', fps: 15, audioKbps: 48 });
  assert.equal(captures[0].video.mandatory.maxHeight, 480);
  assert.equal(captures[0].video.mandatory.maxFrameRate, 15);
  assert.equal(lastRecorder.options.videoBitsPerSecond, 281250);
  assert.equal(lastRecorder.options.audioBitsPerSecond, 48000);
  assert.equal((await command('state')).state.actualVideo.height, 720);
  await command('stop'); await finalized();
});
test('live volume is restored in session state, duplicate starts do not disturb capture', async () => {
  await start(defaults);
  const before = captures.length;
  const duplicate = await start(defaults);
  assert.equal(duplicate.ok, false); assert.equal(captures.length, before);
  await command('volume', { source: 'microphone', value: .35 });
  assert.equal((await command('state')).state.config.micVolume, .35);
  await command('stop'); await finalized();
});
test('closing unrelated tab does not stop microphone-only recording', async () => {
  await start({ ...defaults, video: false, tabAudio: false });
  await command('tabEnded', { tabId: 1 });
  assert.equal((await command('state')).state.status, 'recording');
  await command('stop'); await finalized();
});
test('chunk and metadata checkpoints survive a subsequent storage failure', async () => {
  const { state: initial } = await start(defaults);
  lastRecorder.chunk();
  for (let i = 0; i < 30 && database.stores.get('recordings').get(initial.recordingId).bytes === 0; i++) await wait();
  assert.equal(database.stores.get('recordings').get(initial.recordingId).bytes, 5);
  database.failNextChunk(); lastRecorder.chunk();
  const final = await finalized();
  assert.match(final.error, /storage/i);
  assert.equal(final.bytes, 5);
  assert.equal(database.stores.get('recordings').get(initial.recordingId).status, 'interrupted');
});
test('unsupported formats never silently record another container', async () => {
  supports = mime => mime.includes('webm');
  const capabilities = await command('formats', { config: defaults });
  assert.equal(capabilities.formats.find(f => f.id === 'mkv').supported, false);
  const result = await start({ ...defaults, format: 'mp4' });
  assert.equal(result.ok, false); assert.match(result.error, /unavailable/i);
  supports = () => true;
});
test('permission denial returns actionable error and releases engine', async () => {
  denied = true;
  const r = await start({ ...defaults, video: false, tabAudio: false });
  assert.equal(r.ok, false); assert.match(r.error, /permission denied/i);
  assert.equal((await command('state')).state.status, 'error'); denied = false;
});
