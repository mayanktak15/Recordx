import { encodeMp3 } from '../src/mp3-encoder.js';
const log = text => document.querySelector('#log').textContent += text + '\n';
document.querySelector('#run').onclick = async () => {
  const channels = Array.from({ length: 2 }, () => Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100) * .3));
  const context = new AudioContext(); await context.resume();
  async function inspect(blob, label) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    log(label + ': size=' + blob.size + ', checksum=' + bytes.reduce((a, b) => a + b, 0));
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    log(label + ' decoded peak=' + decoded.getChannelData(0).reduce((a, b) => Math.max(a, Math.abs(b)), 0));
    const link = document.createElement('a'); link.textContent = 'Download ' + label; link.href = URL.createObjectURL(blob); link.download = label + '.mp3'; document.body.append(link);
  }
  await inspect(encodeMp3(channels, 44100, 64), 'main');
  const worker = new Worker(new URL('../src/mp3-worker.js', import.meta.url), { type: 'module' });
  await new Promise((resolve, reject) => { worker.onmessage = async ({ data }) => { if (data.blob) { await inspect(data.blob, 'worker'); resolve(); } else if (data.error) reject(new Error(data.error)); }; worker.postMessage({ channels, sampleRate: 44100, kbps: 64 }); });
  worker.terminate(); await context.close();
};
