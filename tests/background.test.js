import { test } from 'node:test';
import assert from 'node:assert/strict';
let listener, captureIds = [], messages = [], engineState = { status: 'idle' }, engineStart;
globalThis.chrome = {
  runtime: {
    getURL: p => 'chrome-extension://test/' + p,
    getContexts: async () => [{}],
    onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage(message) {
      messages.push(message);
      if (message.target !== 'engine') throw new Error('Wrong message destination');
      if (message.type === 'state') return { ok: true, state: engineState };
      if (message.type === 'start' && engineStart) return engineStart();
      return { ok: true, state: engineState };
    },
  },
  tabs: { query: async () => [{ id: 42, url: 'https://meet.google.com/abc', title: 'Meet' }], onRemoved: { addListener() {} } },
  tabCapture: { async getMediaStreamId(args) { captureIds.push(args.targetTabId); return 'id'; } },
  downloads: { onChanged: { addListener() {} } },
};
await import('../src/background.js');
const command = (type, args = {}) => new Promise(resolve => listener({ target: 'background', type, ...args }, {}, resolve));
test('worker forwards UI messages to engine rather than back to itself', async () => {
  messages = []; const result = await command('formats', { config: { video: false } });
  assert.equal(result.ok, true); assert.equal(messages[0].target, 'engine'); assert.equal(messages[0].type, 'formats');
});
test('worker rejects duplicate start before obtaining another stream ID', async () => {
  captureIds = []; engineState = { status: 'recording' };
  const result = await command('start', { config: { video: true } });
  assert.equal(result.ok, false); assert.equal(captureIds.length, 0);
  engineState = { status: 'idle' };
});
test('worker records the inspected Meet tab and serializes concurrent starts', async () => {
  let finish;
  engineStart = () => new Promise(resolve => { finish = resolve; });
  const first = command('start', { config: { video: true } });
  for (let i = 0; i < 20 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 1));
  const second = await command('start', { config: { video: true } });
  assert.equal(second.ok, false); assert.match(second.error, /already starting/);
  assert.deepEqual(captureIds, [42]);
  finish({ ok: true, state: { status: 'recording' } });
  assert.equal((await first).ok, true);
  engineStart = null;
});
