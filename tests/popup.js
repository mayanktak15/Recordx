import { supportedFormats, defaults } from '../src/shared.js';
window.chrome = {
  runtime: { id: 'layout-test', onMessage: { addListener() {}, removeListener() {} }, async sendMessage(message) {
    return { ok: true, state: { status: 'idle' }, devices: [], formats: supportedFormats(message.config || defaults, mime => MediaRecorder.isTypeSupported(mime)) };
  } },
  storage: { local: { async get() { return {}; }, async set() {} } },
  tabs: { async query() { return [{ title: 'Design review · Google Meet', url: 'https://meet.google.com/test' }]; }, async create() {} },
};
await import('../src/main.jsx');
