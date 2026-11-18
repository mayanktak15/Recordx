import { Mp3Encoder } from '@breezystack/lamejs';
export function encodeMp3(channels, sampleRate, kbps, onProgress = () => {}) {
  if (!channels.length || channels.length > 2 || !channels[0].length) throw new Error('No audio samples available for MP3 export.');
  const encoder = new Mp3Encoder(channels.length, sampleRate, kbps);
  const chunks = [];
  const length = channels[0].length;
  function pcm(input, start, end) {
    const output = new Int16Array(end - start);
    for (let i = start; i < end; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output[i - start] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    return output;
  }
  for (let start = 0; start < length; start += 1152) {
    const end = Math.min(length, start + 1152);
    const left = pcm(channels[0], start, end);
    const right = channels.length === 2 ? pcm(channels[1], start, end) : undefined;
    const data = encoder.encodeBuffer(left, right);
    if (data.length) chunks.push(new Uint8Array(data));
    if (start % (1152 * 100) === 0) onProgress(Math.floor(start / length * 100));
  }
  const last = encoder.flush();
  if (last.length) chunks.push(new Uint8Array(last));
  onProgress(100);
  return new Blob(chunks, { type: 'audio/mpeg' });
}
