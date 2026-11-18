import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodeMp3 } from '../src/mp3-encoder.js';
test('real MP3 encoder creates decodable mono and stereo audio', async () => {
  for (const count of [1, 2]) {
    const channels = Array.from({ length: count }, () => Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 44100) * .3));
    const progress = [];
    const blob = encodeMp3(channels, 44100, 96, p => progress.push(p));
    assert.equal(blob.type, 'audio/mpeg'); assert.ok(blob.size > 9000 && blob.size < 16000); assert.equal(progress.at(-1), 100);
    const dir = await mkdtemp(join(tmpdir(), 'recorder-mp3-'));
    try {
      const file = join(dir, 'tone.mp3'); await writeFile(file, Buffer.from(await blob.arrayBuffer()));
      const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate:format=duration,bit_rate', '-of', 'json', file], { encoding: 'utf8' });
      if (result.error?.code === 'ENOENT') continue;
      assert.equal(result.status, 0, result.stderr);
      const probe = JSON.parse(result.stdout); const stream = probe.streams[0];
      assert.equal(stream.codec_name, 'mp3'); assert.equal(stream.channels, count); assert.ok(+stream.sample_rate >= 22050 && +stream.sample_rate <= 44100); assert.ok(+probe.format.duration >= 1 && +probe.format.duration < 1.2); assert.ok(+probe.format.bit_rate >= 90000 && +probe.format.bit_rate < 110000);
      const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', 'pipe:1']);
      if (decoded.error?.code !== 'ENOENT') { assert.equal(decoded.status, 0); let peak = 0; for (let i = 0; i < decoded.stdout.length; i += 4) peak = Math.max(peak, Math.abs(decoded.stdout.readFloatLE(i))); assert.ok(peak > .1, 'Encoder lost tone amplitude'); }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
