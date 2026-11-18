import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,mode,elapsed,platform,mimeCandidates} from '../src/shared.js';
test('all seven source combinations have distinct modes',()=>{const modes=new Set();for(let bits=1;bits<8;bits++){const c={video:!!(bits&1),microphone:!!(bits&2),tabAudio:!!(bits&4)};const label=mode(c);assert.equal(label.includes('Video'),c.video);assert.equal(label.includes('Microphone'),c.microphone);assert.equal(label.includes('Tab audio'),c.tabAudio);modes.add(label);}assert.equal(modes.size,7);});
test('timer excludes pauses and resumes from accumulated duration',()=>{assert.equal(elapsed({status:'paused',duration:3200,since:100},9000),3200);assert.equal(elapsed({status:'recording',duration:3200,since:8000},9000),4200);});
test('audio-only formats never request video',()=>{for(const format of ['webm','mp4'])assert.ok(mimeCandidates(false,format).every(m=>m.startsWith('audio/')));});
test('platform detection uses host boundaries',()=>{assert.equal(platform('https://meet.google.com/abc'),'Google Meet');assert.equal(platform('https://x.com/i/spaces/123'),'X / Twitter');assert.equal(platform('https://twitter.com/video'),'X / Twitter');assert.equal(platform('https://x.com.example.org'),'Browser tab');});
test('requested defaults',()=>{assert.equal(defaults.video,true);assert.equal(defaults.microphone,true);assert.equal(defaults.tabAudio,true);assert.equal(defaults.micVolume,.8);assert.equal(defaults.tabVolume,1);});

import { normalizeConfig, encodingOptions, estimatedBytes, clock, filename, supportedFormats } from '../src/shared.js';
test('compact preset has lower estimated size; audio only is smallest', () => {
  const full = estimatedBytes(defaults, 60);
  const small = estimatedBytes({ ...defaults, quality: '720', fps: 15, compression: 'small', audioKbps: 64 }, 60);
  const audio = estimatedBytes({ ...defaults, video: false, audioKbps: 48 }, 60);
  assert.ok(full > small && small > audio);
  assert.equal(audio, 21600000);
  assert.equal(encodingOptions({ ...defaults, microphone: false, tabAudio: false }).audioBitsPerSecond, undefined);
});
test('config migrates audio MP4 to M4A, clamps gains, rejects invalid quality', () => {
  const config = normalizeConfig({ video: false, format: 'mp4', micVolume: 20, quality: '9000', fps: 100, audioKbps: 999 });
  assert.equal(config.format, 'm4a'); assert.equal(config.micVolume, 1.5);
  assert.equal(config.quality, defaults.quality); assert.equal(config.fps, defaults.fps);
  assert.equal(config.audioKbps, defaults.audioKbps);
  assert.equal(normalizeConfig({ video: true, format: 'm4a' }).format, 'mp4');
});
test('timer supports sessions longer than 24 hours', () => assert.equal(clock(25 * 3600000 + 65000), '25:01:05'));
test('filenames preserve real container extensions and sanitize paths', () => {
  assert.equal(filename('Meet / planning?', 'm4a'), 'Meet _ planning_.m4a');
  assert.equal(filename('...', 'mkv'), 'Recording.mkv');
});
test('container capability checks distinguish audio and video', () => {
  assert.deepEqual(supportedFormats({ video: false, microphone: true }, () => true).map(f => f.id), ['webm', 'm4a']);
  assert.deepEqual(supportedFormats(defaults, () => false).filter(f => f.supported), []);
});
