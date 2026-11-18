import { encodeMp3 } from './mp3-encoder.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ diagnostic: { channels: data.channels.length, length: data.channels[0].length, sampleRate: data.sampleRate, kbps: data.kbps, peaks: data.channels.map(channel => channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0)), rms: data.channels.map(channel => Math.sqrt(channel.reduce((sum, value) => sum + value * value, 0) / channel.length)), nonzero: data.channels.map(channel => channel.filter(value => Math.abs(value) > .001).length) } });
    const blob = encodeMp3(data.channels, data.sampleRate, data.kbps, progress => self.postMessage({ progress }));
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error.message }); }
};
