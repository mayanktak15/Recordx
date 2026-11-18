import { filename, isActive, normalizeConfig } from './shared.js';
let creating;
let starting = false;
async function ensureEngine() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (!contexts.length) {
    creating ??= chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS', 'WORKERS'],
      justification: 'Record media outside the popup and encode local audio exports.',
    }).finally(() => { creating = null; });
    await creating;
  }
}
const engine = (type, args = {}) => chrome.runtime.sendMessage({ ...args, target: 'engine', type });
async function start(msg) {
  if (starting) throw new Error('A recording is already starting.');
  starting = true;
  try {
    const current = await engine('state');
    if (isActive(current.state)) throw new Error('A recording is already running. Stop it before starting another.');
    const config = normalizeConfig(msg.config);
    if (!config.video && !config.microphone && !config.tabAudio) throw new Error('Enable at least one source.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('Open the tab you want to record.');
    const captureTab = config.video || config.tabAudio;
    if (captureTab && !/^https?:\/\//.test(tab.url || '')) throw new Error('Open a Google Meet, X, or other ordinary web tab. Chrome internal pages cannot be captured.');
    // Capture exactly the tab inspected above; never a newly activated tab after async setup.
    const streamId = captureTab ? await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }) : null;
    return await engine('start', { config, streamId, tab: { id: tab.id, title: tab.title || 'Recording', url: tab.url } });
  } finally { starting = false; }
}
async function handle(msg) {
  if (msg.type === 'badge') {
    await chrome.action.setBadgeText({ text: ['recording', 'starting'].includes(msg.status) ? 'REC' : msg.status === 'paused' ? 'Ⅱ' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#df526b' });
    await chrome.action.setTitle({ title: msg.status === 'recording' ? 'Recording — Meet & X Recorder' : 'Meet & X Recorder' });
    return { ok: true };
  }
  if (msg.type === 'downloadReady') {
    if (!msg.url?.startsWith('blob:' + chrome.runtime.getURL(''))) throw new Error('Invalid local download URL.');
    try {
      const id = await chrome.downloads.download({ url: msg.url, filename: filename(msg.name, msg.extension), saveAs: true });
      await chrome.storage.session.set({ ['download:' + id]: msg.url });
      return { ok: true };
    } catch (error) {
      await engine('revokeExport', { url: msg.url });
      throw error;
    }
  }
  await ensureEngine();
  return msg.type === 'start' ? start(msg) : engine(msg.type, msg);
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== 'background') return;
  handle(msg).then(result => reply(result || { ok: true })).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  engine('tabEnded', { tabId }).catch(() => {});
});
chrome.downloads.onChanged.addListener(async delta => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  const key = 'download:' + delta.id;
  const stored = await chrome.storage.session.get(key);
  if (stored[key]) {
    await engine('revokeExport', { url: stored[key] }).catch(() => {});
    await chrome.storage.session.remove(key);
  }
});
