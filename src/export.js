import { getRecording, recordingBlob } from './storage.js';
const urls = new Map();
export function revokeExport(url) {
  if (urls.has(url)) { clearTimeout(urls.get(url)); URL.revokeObjectURL(url); urls.delete(url); }
}
export async function prepareExport(id, format, onProgress) {
  const record = await getRecording(id);
  if (!record) throw new Error('Recording no longer exists.');
  let blob = await recordingBlob(id);
  let extension = record.extension || record.format || 'webm';
  if (format === 'mp3') {
    if (record.mime.startsWith('video/')) throw new Error('MP3 export is available for audio-only recordings. Choose the Audio only preset for your next session.');
    // Decode is memory-intensive: refuse oversized jobs before allocating their PCM data.
    if (blob.size > 64 * 1024 ** 2 || (record.duration || 0) / 1000 * 48000 * 2 * 4 > 256 * 1024 ** 2) {
      throw new Error('This recording is too long for safe in-memory MP3 conversion. Download the compact original WebM/M4A and convert it with a desktop audio tool.');
    }
    const context = new AudioContext({ sampleRate: 44100 });
    let channels, sampleRate;
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      if (buffer.length * Math.min(2, buffer.numberOfChannels) * 4 > 256 * 1024 ** 2) throw new Error('Decoded audio is too large for MP3 export. Download the original instead.');
      // Materialize PCM while the decoding context is alive, before closing it.
      channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => new Float32Array(buffer.getChannelData(i)));
      sampleRate = buffer.sampleRate;
    } catch (error) {
      throw new Error('Could not prepare audio for MP3 export. Download the original file instead. ' + error.message);
    } finally { await context.close(); }
    onProgress(5);
    const worker = new Worker(new URL('./mp3-worker.js', import.meta.url), { type: 'module' });
    try {
      blob = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => {
          if (data.diagnostic) { console.info('MP3 diagnostic ' + JSON.stringify(data.diagnostic)); return; }
          if (data.error) reject(new Error(data.error));
          else if (data.blob) resolve(data.blob);
          else onProgress(5 + Math.round(data.progress * .9));
        };
        worker.onerror = () => reject(new Error('MP3 encoding failed. Download the original recording instead.'));
        worker.postMessage({ channels, sampleRate, kbps: Math.max(64, Math.min(192, record.audioKbps || 96)) }, channels.map(c => c.buffer));
      });
    } finally { worker.terminate(); }
    extension = 'mp3';
  }
  const url = URL.createObjectURL(blob);
  urls.set(url, setTimeout(() => revokeExport(url), 30 * 60 * 1000));
  return { url, extension, name: record.name };
}
