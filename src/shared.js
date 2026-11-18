export const defaults = {
  video: true, microphone: true, tabAudio: true,
  micVolume: 0.8, tabVolume: 1, deviceId: '',
  quality: '1080', compression: 'balanced', fps: 24, audioKbps: 96, format: 'webm',
};
export const formatOptions = [
  { id: 'webm', label: 'WebM', detail: 'Compact · Opus audio / VP9 or VP8 video', video: true, audio: true },
  { id: 'mp4', label: 'MP4', detail: 'H.264 video · broad player compatibility', video: true, audio: false },
  { id: 'm4a', label: 'M4A', detail: 'MP4 audio container · native encoder required', video: false, audio: true },
  { id: 'mkv', label: 'MKV', detail: 'Matroska video · native encoder required', video: true, audio: false },
];
export const presets = {
  meeting: { label: 'Meet compact', detail: '720p · 15 fps', video: true, microphone: true, tabAudio: true, quality: '720', compression: 'small', fps: 15, audioKbps: 64, format: 'webm' },
  clear: { label: 'Presentation', detail: '1080p · 24 fps', video: true, microphone: true, tabAudio: true, quality: '1080', compression: 'balanced', fps: 24, audioKbps: 96, format: 'webm' },
  voice: { label: 'Audio only', detail: 'Smallest · 48 kbps', video: false, microphone: true, tabAudio: true, audioKbps: 48, format: 'webm' },
};
export const activeStatuses = ['starting', 'recording', 'paused', 'stopping', 'saving'];
export const isActive = state => activeStatuses.includes(state.status);
export function mode(c) {
  return [c.video && 'Video', c.microphone && 'Microphone', c.tabAudio && 'Tab audio'].filter(Boolean).join(' + ') || 'Choose a source';
}
export function platform(url = '') {
  try {
    const h = new URL(url).hostname;
    return h === 'meet.google.com' ? 'Google Meet' : ['x.com', 'twitter.com'].some(d => h === d || h.endsWith('.' + d)) ? 'X / Twitter' : 'Browser tab';
  } catch { return 'Browser tab'; }
}
export function elapsed(s, now = Date.now()) {
  return (s.duration || 0) + (s.status === 'recording' ? Math.max(0, now - s.since) : 0);
}
export function clock(ms = 0) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function size(bytes = 0) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}
export function normalizeConfig(value = {}) {
  const c = { ...defaults, ...value };
  for (const key of ['video', 'microphone', 'tabAudio']) c[key] = !!c[key];
  for (const key of ['micVolume', 'tabVolume']) c[key] = Number.isFinite(+c[key]) ? Math.min(1.5, Math.max(0, +c[key])) : defaults[key];
  c.quality = ['480', '720', '1080'].includes(String(c.quality)) ? String(c.quality) : defaults.quality;
  c.compression = ['small', 'balanced', 'high'].includes(c.compression) ? c.compression : defaults.compression;
  c.fps = [15, 24, 30].includes(+c.fps) ? +c.fps : defaults.fps;
  c.audioKbps = [48, 64, 96, 128, 192].includes(+c.audioKbps) ? +c.audioKbps : defaults.audioKbps;
  c.deviceId = typeof c.deviceId === 'string' ? c.deviceId : '';
  if (!formatOptions.some(f => f.id === c.format)) c.format = 'webm';
  if (c.video && c.format === 'm4a') c.format = 'mp4';
  if (!c.video && c.format === 'mp4') c.format = 'm4a';
  if (!c.video && c.format === 'mkv') c.format = 'webm';
  return c;
}
export function mimeCandidates(video, format, audio = true) {
  if (format === 'mp4' || format === 'm4a') return video
    ? [...(audio ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2'] : ['video/mp4;codecs=avc1.42E01E']), 'video/mp4']
    : ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];
  if (format === 'mkv') return video ? [audio ? 'video/x-matroska;codecs=avc1,opus' : 'video/x-matroska;codecs=avc1', 'video/x-matroska'] : [];
  if (format !== 'webm') return [];
  return video ? [audio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9', audio ? 'video/webm;codecs=vp8,opus' : 'video/webm;codecs=vp8', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/webm'];
}
export function supportedFormats(c, supports) {
  return formatOptions.filter(f => c.video ? f.video : f.audio).map(f => ({ ...f, supported: mimeCandidates(c.video, f.id, c.microphone || c.tabAudio).some(m => supports(m)) }));
}
export function encodingOptions(value) {
  const c = normalizeConfig(value);
  const base = { '480': 900000, '720': 1800000, '1080': 3600000 }[c.quality];
  return {
    ...(c.video ? { videoBitsPerSecond: Math.round(base * ({ small: 0.5, balanced: 1, high: 1.7 }[c.compression]) * c.fps / 24) } : {}),
    ...(c.microphone || c.tabAudio ? { audioBitsPerSecond: c.audioKbps * 1000 } : {}),
  };
}
export function estimatedBytes(c, minutes = 1) {
  return Object.values(encodingOptions(c)).reduce((a, b) => a + b, 0) * 60 * minutes / 8;
}
export function filename(name, extension) {
  const clean = String(name || 'Recording').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 120);
  return (clean || 'Recording') + '.' + extension;
}
