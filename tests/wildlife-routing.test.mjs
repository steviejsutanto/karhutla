import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedRoom } from '../app/shared-room.mjs';
import { birdEvent, BIRD_MIN_GAP_MS, ORANGUTAN_INTERVAL_MS, PHONE_BIRD_LEVEL, PHONE_BIRD_RELATIVE_DB, SceneWildlifeAudio } from '../app/scene-wildlife.js';
import { PHONE_CRICKET_LEVEL } from '../app/phone-crickets.js';
import { scoreDurations } from '../app/scene-score.js';

async function fixture(count, settings = {}, wallStart = 100000) {
  const time = { now: 0 };
  const room = new SharedRoom({ records: [{ longitude: 110.125, latitude: -2.125 }], clock: () => time.now, wallClock: () => wallStart + time.now });
  await room.bootstrap();
  const phones = Array.from({ length: count }, (_, index) => room.connect({ clientId: `wildlife-phone-${index}`, scope: 'indonesia' }));
  room.simulation.stepGlobalRain(1000, room.national.fireKeys);
  await room.setScene({ scene: 'afterglow', settings });
  const advance = elapsedMs => { time.now = elapsedMs; room.advance(); };
  return { room, phones, advance, time };
}

test('brief bird calls follow the cricket entrance and exactly one room-wide owner for occasional irregular default calls', async () => {
  for (const count of [1, 2, 28]) {
    const f = await fixture(count), assigned = new Map();
    const scene = f.room.sceneState(), duration = scoreDurations(scene.settings).afterglowDurationMs;
    for (let index = 0; birdEvent(index, scene).atMs < duration - 2000; index++) {
      const event = birdEvent(index, scene); f.advance(event.atMs - 11000);
      const owners = f.phones.filter(phone => f.room.phoneState(phone.connectionId).birdEvents.includes(index));
      assert.equal(owners.length, 1, `${count} phones must have one owner for event ${index}`);
      assigned.set(index, owners[0].participantNumber);
    }
    assert.ok(assigned.size >= 9 && assigned.size <= 18, 'Brief calls occur every4–8 seconds across the room during the default ending.');
    if (count === 1) assert.equal(new Set(assigned.values()).size, 1);
    if (count === 2) assert.equal(new Set([...assigned.values()].slice(0, 4)).size, 2);
    const first = birdEvent(0, scene).atMs, d = scoreDurations(scene.settings);
    const established = d.paCricketOnlyStartMs + d.paCricketOnlyMs + d.cricketHandoffMs;
    assert.ok(first >= established + 4000 && first < established + 8000,
      'The first bird call follows the complete phone cricket entrance rather than overwhelming its fade-in.');
  }
});

test('maximum legal phone windows keep every eligible call inside the128-index protocol and one owner per call', async () => {
  for (const lead of [1, 180]) for (const count of [1, 2, 28]) {
    const settings = { projectionFadeSeconds: lead, rainCricketOverlapSeconds: lead,
      paCricketOnlySeconds: lead === 1 ? 1 : 120, cricketHandoffSeconds: lead === 1 ? 1 : 120,
      phoneOnlySeconds: 120, phoneFadeSeconds: 300 };
    const f = await fixture(count, settings), scene = f.room.sceneState(), d = scoreDurations(settings);
    const maximumCalls = Math.ceil((d.phoneOnlyMs + d.phoneFadeMs - 4000 - 2000) / BIRD_MIN_GAP_MS);
    assert.equal(maximumCalls, 104);
    let calls = 0;
    for (let index = 0; ; index++) {
      const event = birdEvent(index, scene);
      if (event.atMs >= d.afterglowDurationMs - 2000) break;
      assert.ok(index < maximumCalls && index < 128);
      f.advance(event.atMs - 11000);
      const owners = f.phones.filter(phone => f.room.phoneState(phone.connectionId).birdEvents.includes(index));
      assert.equal(owners.length, 1, `${count} phones, ${lead}s lead, call${index}`);
      const wire = f.room.phoneState(owners[0].connectionId).birdEvents;
      assert.ok(wire.length <= 128 && wire.every(value => value >= 0 && value < 128));
      calls++;
    }
    assert.ok(calls > 60 && calls <= maximumCalls, 'Long endings retain every call without crowd multiplication or index truncation.');
  }
});

test('short handoffs and a long phone tail retain room-wide ownership beyond the old ten-second event bound', async () => {
  const settings = { projectionFadeSeconds: 1, rainCricketOverlapSeconds: 1,
    paCricketOnlySeconds: 1, cricketHandoffSeconds: 1, phoneOnlySeconds: 17, phoneFadeSeconds: 60 };
  // This deterministic performance has several naturally short4–8s rests.
  // Its ninth eligible call was excluded by ceil(duration/10000).
  const f = await fixture(28, settings, 2430281), scene = f.room.sceneState();
  const duration = scoreDurations(scene.settings).afterglowDurationMs;
  const index = Math.ceil(duration / 10000), event = birdEvent(index, scene);
  assert.equal(index, 8); assert.ok(event.atMs < duration - 2000);
  f.advance(event.atMs - 11000);
  const owners = f.phones.filter(phone => f.room.phoneState(phone.connectionId).birdEvents.includes(index));
  assert.equal(owners.length, 1, 'The later valid call still has exactly one owner among28 phones.');
});

test('late phones can own future calls and a current call never changes owner after a join or disconnect', async () => {
  const f = await fixture(1, { phoneFadeSeconds: 120 }), scene = f.room.sceneState(), first = birdEvent(0, scene);
  f.advance(first.atMs - 10000);
  assert.ok(f.room.phoneState(f.phones[0].connectionId).birdEvents.includes(0));
  const late = f.room.connect({ clientId: 'late-wildlife-phone', scope: 'indonesia' });
  assert.equal(f.room.phoneState(late.connectionId).soundSlot, -1, 'Legacy rank remains stable, while event ownership admits the late phone.');
  assert.ok(!f.room.phoneState(late.connectionId).birdEvents.includes(0));
  f.advance(birdEvent(2, scene).atMs - 10000);
  assert.ok(f.room.phoneState(late.connectionId).birdEvents.includes(2));
  f.room.disconnect(late.connectionId);
  const replacement = f.room.connect({ clientId: 'different-wildlife-phone', scope: 'indonesia' });
  assert.ok(!f.room.phoneState(replacement.connectionId).birdEvents.includes(2), 'A disconnected owner leaves a quiet gap rather than handing an active call to another phone.');
  assert.ok(!f.room.phoneState(f.phones[0].connectionId).birdEvents.includes(2));
});

test('phone crickets and bird calls both rise 3.5 dB while their relative balance stays fixed', () => {
  assert.equal(ORANGUTAN_INTERVAL_MS, 27000);
  assert.equal(PHONE_BIRD_RELATIVE_DB, 8.5);
  assert.ok(Math.abs(20 * Math.log10(PHONE_BIRD_LEVEL / PHONE_CRICKET_LEVEL) - PHONE_BIRD_RELATIVE_DB) < 1e-12);
  const previousCricket = .04 * 10 ** (-12 / 20), previousBird = previousCricket * 10 ** (8.5 / 20);
  assert.ok(Math.abs(20 * Math.log10(PHONE_CRICKET_LEVEL / previousCricket) - 3.5) < 1e-12);
  assert.ok(Math.abs(20 * Math.log10(PHONE_BIRD_LEVEL / previousBird) - 3.5) < 1e-12);
});

test('Main alone allocates the small reverb graph and phone bird presence does not add a convolver', () => {
  const param = () => ({ value: 0, setTargetAtTime() {} });
  const context = { sampleRate: 8000, currentTime: 0, createGain: node, createBiquadFilter: node,
    createConvolver: node, createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate, length, numberOfChannels: channels, getChannelData: channel => data[channel] };
    } };
  function node() { return { connections: [], gain: param(), frequency: param(), Q: param(), connect(to) { this.connections.push(to); }, disconnect(to) { this.connections = to ? this.connections.filter(value => value !== to) : []; } }; }
  const main = new SceneWildlifeAudio({ context, destination: {}, mode: 'operator' });
  assert.ok(main.reverb); assert.equal(main.reverb.gain.gain.value, .12); assert.equal(main.reverb.convolver.buffer.numberOfChannels, 2);
  assert.equal(main.reverb.convolver.buffer.length, 13200);
  const phone = new SceneWildlifeAudio({ context, destination: {}, mode: 'phone' });
  assert.equal(phone.reverb, null); assert.equal(phone.presence, null); assert.equal(phone.filter.frequency.value, 4200);
  const convolver = main.reverb.convolver; main.destroy(); phone.destroy(); assert.equal(convolver.buffer, null); assert.equal(convolver.connections.length, 0);
});

test('mute clears the Main reverb history once and repeated inactive updates keep one bounded graph', () => {
  let convolvers = 0;
  const parameter = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connections: [], gain: parameter(), frequency: parameter(), Q: parameter(), playbackRate: parameter(),
    connect(to) { this.connections.push(to); }, disconnect(to) { this.connections = to ? this.connections.filter(value => value !== to) : []; }, start() {}, stop() {} });
  const context = { sampleRate: 8000, currentTime: 0, createGain: node, createBiquadFilter: node, createBufferSource: node,
    createConvolver() { convolvers++; return node(); }, createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { length, numberOfChannels: channels, getChannelData: channel => data[channel] }; } };
  const audio = new SceneWildlifeAudio({ context, mode: 'operator', destination: {} });
  const url = '/audio-assets/v3/orangutan-distant-v25.mp3'; audio.setSources({ orangutan: url, birds: [] }); audio.buffers.set(url, { duration: 16 });
  const original = audio.reverb.convolver, impulse = original.buffer, scene = { id: 'afterglow', startedAt: 1 };
  audio.update({ active: true, scene, elapsedMs: 16550 }); assert.equal(audio.shots.size, 1);
  audio.stop(); assert.notEqual(audio.reverb.convolver, original); assert.equal(original.buffer, null);
  assert.equal(audio.reverb.convolver.buffer, impulse); assert.equal(convolvers, 2);
  for (let index = 0; index < 20; index++) audio.update({ active: false, scene, elapsedMs: 16600 });
  assert.equal(convolvers, 2); assert.equal(audio.filter.connections.length, 2, 'One dry path and one current reverb path remain.');
  audio.destroy();
});
