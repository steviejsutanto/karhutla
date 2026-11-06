import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { birdEvent, wildlifeEnvelope, SceneWildlifeAudio, normalizeWildlifeRecording, wildlifeSourcesForRole } from '../app/scene-wildlife.js';
import { PhoneDroneAudio, phoneDroneWeight, phoneDroneFrequency, PHONE_DRONE_PITCH_RATIO, PHONE_DRONE_PITCH_SEMITONES, PHONE_DRONE_GAIN_TRIM, PHONE_DRONE_MOVING_BANK_WEIGHT } from '../app/phone-drone.js';
import { computeSceneScore, scoreDurations } from '../app/scene-score.js';
import { soundLibrary, ambianceSources } from '../app/sound-library.js';
import { SharedRoom } from '../app/shared-room.mjs';

class Param {
  constructor() { this.value = 0; this.events = []; }
  cancelScheduledValues() {}
  setValueAtTime(value, at) { this.value = value; this.events.push([value, at]); }
  setTargetAtTime(value, at, seconds) { this.value = value; this.events.push([value, at, seconds]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.events.push([value, at]); }
}
class Context {
  constructor() { this.currentTime = 0; this.nodes = []; this.decoded = 0; }
  node(type) {
    const node = { type, gain: new Param(), frequency: new Param(), Q: new Param(), playbackRate: new Param(), connections: [],
      connect(to) { this.connections.push(to); }, disconnect() { this.connections = []; },
      start(at, offset) { this.started = { at, offset }; }, stop(at) { this.stopped = at ?? 0; } };
    this.nodes.push(node); return node;
  }
  createBufferSource() { return this.node('source'); }
  createOscillator() { return this.node('oscillator'); }
  createGain() { return this.node('gain'); }
  createBiquadFilter() { return this.node('filter'); }
  createWaveShaper() { return this.node('shaper'); }
  decodeAudioData() {
    this.decoded++; const data = Float32Array.from({ length: 25600 }, (_, i) => .025 * Math.sin(2 * Math.PI * 220 * i / 32000));
    return Promise.resolve({ duration: .8, length: data.length, sampleRate: 32000, numberOfChannels: 1, getChannelData: () => data });
  }
}
const sources = { orangutan: '/audio-assets/v3/orangutan-distant-v25.mp3', birds: ['/audio-assets/v3/rainforest-coo-a-v32.mp3', '/audio-assets/v3/rainforest-coo-b-v32.mp3', '/audio-assets/v3/rainforest-chirp-c-v31.mp3'] };
const scene = { id: 'afterglow', startedAt: 1, paused: false };
const flush = () => new Promise(resolve => setImmediate(resolve));
const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(128) });

test('default rain is 54% and final rain is eight seconds shorter', () => {
  const room = new SharedRoom();
  assert.equal(room.strength, .54); assert.equal(scoreDurations().finalRainRiseMs, 52000);
  assert.equal(scoreDurations({ finalRainRiseSeconds: 60 }).finalRainRiseMs, 60000);
});

test('the distorted phone drone follows Main pitch banks, enters in Scene 4 and fades through final rain', () => {
  const weight = (id, elapsedMs) => phoneDroneWeight({ id }, computeSceneScore({ id, elapsedMs }));
  assert.equal(weight('participation', 30000), 0);
  assert.equal(weight('forest-takeover', 0), 0); assert.equal(weight('forest-takeover', 15000), .5);
  assert.equal(weight('forest-takeover', 30000), 1); assert.equal(weight('final-rain', 0), 1);
  assert.equal(weight('final-rain', 26000), .5); assert.equal(weight('final-rain', 52000), 0);
  assert.equal(weight('afterglow', 0), 0);
  const context = new Context(), drone = new PhoneDroneAudio({ context, destination: {} });
  const frequencies = [69, 104, 155, 52, 78, 116];
  drone.update({ active: true, weight: .5, frequencies, amplitudes: [.72, .24, .34] });
  assert.equal(drone.getMetrics().oscillatorCount, 6);
  assert.deepEqual(drone.voice.oscillators.map(node => node.frequency.value), frequencies.map((value, index) => phoneDroneFrequency(frequencies, index)));
  assert.deepEqual(drone.voice.oscillators.slice(0, 3).map(node => node.frequency.value), frequencies.slice(0, 3).map(value => value * PHONE_DRONE_PITCH_RATIO));
  assert.equal(drone.voice.drive.oversample, 'none'); assert.equal(drone.voice.drive.curve.length, 513);
  assert.equal(drone.voice.gain.gain.value, .016 * PHONE_DRONE_GAIN_TRIM);
  assert.deepEqual(drone.voice.partials.map(node => node.gain.value), [.72, .24, .34, .72, .24, .34].map((amplitude, index) => amplitude * (index < 3 ? 1 - PHONE_DRONE_MOVING_BANK_WEIGHT : PHONE_DRONE_MOVING_BANK_WEIGHT)));
  assert.equal(drone.getMetrics().movingBankWeight, .38);
  assert.equal(drone.getMetrics().beatOffsetHz, 1.4);
  assert.equal(drone.getMetrics().pitchSemitones, PHONE_DRONE_PITCH_SEMITONES);
  assert.equal(drone.getMetrics().trimDb, 3, 'Presence changes preserve the previous output trim.');
  const first = [...drone.voice.oscillators];
  for (let i = 0; i < 50; i++) drone.update({ active: true, weight: .8, frequencies, amplitudes: [.72, .24, .34] });
  assert.equal(context.nodes.filter(node => node.type === 'sine').length, 6, 'Updates reuse native oscillators.');
  drone.update({ active: false }); assert.equal(drone.getMetrics().oscillatorCount, 0);
  assert.ok(first.every(node => node.stopped === .18));
  first[0].onended(); assert.ok(first.every(node => node.connections.length === 0));
});

test('phone drone raises its previous register by a major third and deepens faster beats without extra voices or gain', () => {
  const context = new Context(), drone = new PhoneDroneAudio({ context, destination: {} });
  const frequencies = [100, 150, 200, 100, 150, 200], original = [...frequencies];
  drone.update({ active: true, weight: 1, frequencies, amplitudes: [.72, .24, .34] });
  const voices = drone.voice.oscillators;
  for (let index = 0; index < 3; index++) {
    const previousPhoneHz = frequencies[index] * 2;
    assert.ok(Math.abs(12 * Math.log2(voices[index].frequency.value / previousPhoneHz) - 4) < 1e-12);
    assert.ok(Math.abs(voices[index].frequency.value - voices[index + 3].frequency.value - [1.4, 1.7, 2][index]) < 1e-12);
    assert.ok(Math.abs(drone.voice.partials[index].gain.value + drone.voice.partials[index + 3].gain.value - [.72, .24, .34][index]) < 1e-12);
  }
  assert.deepEqual(frequencies, original, 'Phone pitch and beating never mutate Main frequencies.');
  assert.equal(drone.voice.gain.gain.value, .032 * 10 ** (3 / 20), 'The existing output trim stays fixed.');
  assert.equal(drone.getMetrics().oscillatorCount, 6);
  assert.equal(drone.getMetrics().pitchSemitones, 16);
  drone.destroy();
});

test('bird calls rotate across 28 phones with one owner, 4–8 second irregular rests and brief varied bird calls', () => {
  const events = Array.from({ length: 28 }, (_, index) => birdEvent(index, scene, 28));
  assert.equal(new Set(events.map(event => event.slot)).size, 28);
  assert.ok(events[0].atMs > 42000);
  for (let i = 1; i < events.length; i++) { const gap = events[i].atMs - events[i - 1].atMs; assert.ok(gap >= 4000 && gap <= 8000); }
  for (const event of events) {
    assert.equal(Array.from({ length: 28 }, (_, slot) => slot).filter(slot => slot === event.slot).length, 1);
    assert.equal(event.rate, 1, 'Every complete brief recording keeps its prepared pitch and speed.');
    assert.equal(event.sourceOffset, undefined); assert.equal(event.durationSeconds, undefined);
  }
  assert.equal(new Set(events.slice(0, 8).map(event => event.variant)).size, 3);
  for (let i = 1; i < events.length; i++) assert.notEqual(events[i].asset, events[i - 1].asset, 'Adjacent calls never repeat the same source.');
  const gaps = events.slice(1).map((event, index) => event.atMs - events[index].atMs);
  assert.ok(new Set(gaps).size > 20, 'The room has no repeating fixed-interval bird loop.');
  assert.ok(events.every(event => event.asset >= 0 && event.asset < 3));
});

test('bird variation is shared by the authority and phones, and a fresh performance receives a fresh score', () => {
  const first = Array.from({ length: 8 }, (_, index) => birdEvent(index, scene, 28));
  const copy = Array.from({ length: 8 }, (_, index) => birdEvent(index, JSON.parse(JSON.stringify(scene)), 1));
  for (let i = 0; i < first.length; i++) {
    const { slot: ignoredA, ...a } = first[i], { slot: ignoredB, ...b } = copy[i];
    assert.deepEqual(a, b, 'Phone count cannot change the shared call timing or material.');
  }
  const next = Array.from({ length: 8 }, (_, index) => birdEvent(index, { ...scene, startedAt: scene.startedAt + 1 }, 28));
  assert.notDeepEqual(first.map(event => event.atMs), next.map(event => event.atMs));
  assert.notDeepEqual(first.map(event => event.asset), next.map(event => event.asset));
});

test('orangutan remains faint after the Main cricket master reaches zero and shares the final retreat', () => {
  assert.equal(wildlifeEnvelope({ id: 'participation' }, 30000), 0);
  assert.equal(wildlifeEnvelope(scene, 0), 0);
  assert.equal(wildlifeEnvelope(scene, 30000), 1);
  assert.equal(computeSceneScore({ ...scene, elapsedMs: 54000 }).mainGain, 0);
  assert.ok(Math.abs(wildlifeEnvelope(scene, 54000) - .16) < 1e-12);
  assert.ok(wildlifeEnvelope(scene, 99000) < wildlifeEnvelope(scene, 69000));
  assert.equal(wildlifeEnvelope(scene, 129000), 0);
});

test('phone wildlife loads only its assigned short bird recording and never loads orangutan', async () => {
  const context = new Context(), requests = [];
  const audio = new SceneWildlifeAudio({ context, destination: {}, fetchImpl: async url => { requests.push(url); return fetchImpl(); } });
  audio.setSources(sources);
  assert.deepEqual(audio.sources, { birds: sources.birds });
  audio._load(sources.orangutan); await flush();
  assert.deepEqual(requests, [], 'A direct wrong-role load cannot request the Main voice.');
  const event = birdEvent(0, scene, 28); audio.setAudience({ slot: event.slot, count: 28 });
  audio.update({ active: true, scene, elapsedMs: 0 }); assert.deepEqual(requests, []);
  audio.update({ active: true, scene, elapsedMs: event.atMs - 1000 }); await flush();
  assert.equal(context.decoded, 1); assert.equal(requests[0], sources.birds[event.asset]);
  assert.equal(audio.setSources({ birds: [sources.orangutan] }), false, 'The Main file cannot masquerade as a phone bird.');
  const retiredCoo = '/audio-assets/v3/rainforest-bird-low-a-v25.mp3';
  assert.equal(audio.setSources({ birds: [retiredCoo] }), false, 'An old cached coo palette cannot be replayed as a new bird.');
  audio._load(retiredCoo); await flush(); assert.equal(requests.length, 1);
  audio.update({ active: true, scene, elapsedMs: event.atMs + 50 });
  assert.equal(audio.shots.size, 1); assert.equal([...audio.shots][0].source.loop, false);
  assert.ok([...audio.shots][0].source.started.offset > 0);
  const voice = [...audio.shots][0];
  assert.ok(Math.abs(voice.source.started.offset - .05) < 1e-10);
  assert.ok(Math.abs(voice.source.stopped - voice.source.started.at - .01 - (.8 - .05)) < 1e-10,
    'Native playback plays the complete brief bird recording once and never loops it.');
  for (let i = 0; i < 10; i++) audio.update({ active: true, scene, elapsedMs: event.atMs + 50 });
  assert.equal(audio.shots.size, 1); assert.equal(requests.length, 1);
  audio.update({ active: true, scene: { ...scene, paused: true }, elapsedMs: event.atMs + 500 });
  assert.equal(audio.shots.size, 0);
  audio.update({ active: true, scene, elapsedMs: event.atMs + 500 }); assert.equal(audio.shots.size, 1);
  audio.update({ active: false, scene, elapsedMs: event.atMs + 600 }); assert.equal(audio.shots.size, 0);
  audio.destroy(); assert.equal(audio.getMetrics().decodedBytes, 0);
});

test('a late join does not replay elapsed bird calls; scene changes stop and invalidate loads', async () => {
  const context = new Context(), audio = new SceneWildlifeAudio({ context, destination: {}, fetchImpl });
  const event = birdEvent(0, scene, 28); audio.setSources(sources); audio.setAudience({ slot: event.slot, count: 28 });
  audio.update({ active: true, scene, elapsedMs: event.atMs + 2000 }); await flush();
  audio.update({ active: true, scene, elapsedMs: event.atMs + 2000 }); assert.equal(audio.shots.size, 0);
  audio.update({ active: true, scene: { id: 'ended' }, elapsedMs: 0 });
  assert.equal(audio.getMetrics().active, false); assert.equal(audio.shots.size, 0);
  assert.equal(audio.setSources({ orangutan: 'https://invalid.example/a.mp3', birds: [] }), false);
  audio.destroy();
});

test('wildlife palette accepts verified local species entries and rejects mismatched or missing birds', () => {
  const asset = (id, kind) => ({ id, kind, title: id, file: `audio-assets/v3/${id}.mp3`, sha256: 'a'.repeat(64), durationSeconds: 3 });
  const assets = [asset('orangutan', 'wildlife-orangutan'), asset('bird-a', 'wildlife-bird'), asset('bird-b', 'wildlife-bird')];
  const library = soundLibrary({ assets, wildlife: { orangutan: 'orangutan', birds: ['bird-a', 'bird-b'] } });
  assert.equal(ambianceSources(library).wildlife.birds.length, 2);
  assert.deepEqual(ambianceSources(library).phoneWildlife, { birds: ambianceSources(library).wildlife.birds });
  assert.deepEqual(ambianceSources(library).mainWildlife, { orangutan: ambianceSources(library).wildlife.orangutan });
  for (const birds of [['orangutan'], ['bird-a', 'bird-a'], ['missing'], []])
    assert.equal(ambianceSources({ ...library, wildlife: { orangutan: 'orangutan', birds } }).wildlife, undefined);
});


test('wildlife uses only fixed recording makeup and preserves the source dynamics within its peak budget', () => {
  const samples = Float32Array.from([.02, -.04, .01, -.02]);
  const before = [...samples], buffer = { numberOfChannels: 1, getChannelData: () => samples };
  const info = normalizeWildlifeRecording(buffer);
  assert.ok(Math.abs(info.outputRms - .085) < 1e-12);
  assert.ok(info.outputPeak <= .90);
  for (let i = 0; i < samples.length; i++) assert.ok(Math.abs(samples[i] / before[i] - info.gain) < .000001);
  const transient = Float32Array.from([.01, -.01, 4]);
  const limited = normalizeWildlifeRecording({ numberOfChannels: 1, getChannelData: () => transient });
  assert.ok(limited.outputPeak <= .90); assert.ok(Math.max(...transient.map(Math.abs)) <= .900001);
  assert.throws(() => normalizeWildlifeRecording({ numberOfChannels: 1, getChannelData: () => Float32Array.of(NaN) }), /invalid samples/);
});

test('silent phone bird padding never raises the active call body above its fixed preparation target', () => {
  const voice = Float32Array.from({ length: 800 }, (_, index) => .04 * Math.sin(2 * Math.PI * index / 16));
  const prepare = padding => {
    const data = new Float32Array(voice.length + padding * 2); data.set(voice, padding);
    return normalizeWildlifeRecording({ numberOfChannels: 1, getChannelData: () => data }, { activeBody: true });
  };
  const tight = prepare(0), padded = prepare(8000);
  assert.equal(tight.activeBody, true); assert.equal(padded.activeBody, true);
  assert.equal(tight.gain, padded.gain, 'Quiet edges cannot provide extra makeup to a short pulse.');
  assert.ok(Math.abs(padded.outputBodyRms - .085) < 1e-12);
  assert.ok(padded.outputRms < tight.outputRms / 4);
});

test('muting a wildlife call consumes it while a repeated scene pause resumes only the interrupted call', async () => {
  const context = new Context(), audio = new SceneWildlifeAudio({ context, destination: {}, fetchImpl });
  const event = birdEvent(0, scene, 28); audio.setSources(sources); audio.setAudience({ slot: event.slot, count: 28 });
  audio.update({ active: true, scene, elapsedMs: event.atMs - 1000 }); await flush();
  audio.update({ active: true, scene, elapsedMs: event.atMs + 50 }); assert.equal(audio.shots.size, 1);
  audio.update({ active: false, scene, elapsedMs: event.atMs + 100 });
  audio.update({ active: true, scene, elapsedMs: event.atMs + 200 }); assert.equal(audio.shots.size, 0, 'Unmute cannot replay the interrupted old call.');
  const nextScene = { ...scene, startedAt: 2 }, nextEvent = birdEvent(0, nextScene, 28);
  audio.setAudience({ slot: nextEvent.slot, count: 28 });
  audio.update({ active: true, scene: nextScene, elapsedMs: nextEvent.atMs - 1000 }); await flush();
  audio.update({ active: true, scene: nextScene, elapsedMs: nextEvent.atMs + 50 }); assert.equal(audio.shots.size, 1);
  for (let i = 0; i < 5; i++) audio.update({ active: true, scene: { ...nextScene, paused: true }, elapsedMs: nextEvent.atMs + 350 });
  audio.update({ active: true, scene: nextScene, elapsedMs: nextEvent.atMs + 350 });
  assert.equal(audio.shots.size, 1); assert.ok([...audio.shots][0].source.started.offset > .3, 'The one-shot resumes at its frozen show-clock offset.');
  audio.destroy(); assert.equal(audio.shots.size, 0); assert.equal(audio.getMetrics().decodedBytes, 0);
});

test('rapid phone drone toggles keep one bounded retirement bank and destroy disconnects every graph', () => {
  const context = new Context(), drone = new PhoneDroneAudio({ context, destination: {} });
  const options = { active: true, weight: 1, frequencies: [69, 104, 155, 52, 78, 116], amplitudes: [.72, .24, .34] };
  for (let i = 0; i < 20; i++) {
    drone.update(options); drone.stop();
    assert.equal(drone.getMetrics().oscillatorCount, 0); assert.equal(drone.getMetrics().retiringOscillatorCount, 6);
    assert.ok(context.nodes.filter(node => node.type === 'sine' && node.connections.length > 0).length <= 6);
  }
  drone.update(options); assert.equal(drone.getMetrics().oscillatorCount, 6);
  drone.destroy(); assert.equal(drone.getMetrics().retiringOscillatorCount, 0);
  assert.ok(context.nodes.every(node => node.connections.length === 0));
});


test('the shipped wildlife manifest resolves into actual Main and phone recording URLs', async () => {
  const catalog = soundLibrary(JSON.parse(await readFile(new URL('../audio-assets/v3/manifest.json', import.meta.url), 'utf8')));
  const palette = ambianceSources(catalog);
  assert.match(palette.wildlife.orangutan, /orangutan-distant-v25\.mp3/);
  assert.equal(palette.wildlife.birds.length, 3);
  assert.match(palette.wildlife.birds[0], /rainforest-coo-a-v32\.mp3/);
  assert.match(palette.wildlife.birds[1], /rainforest-coo-b-v32\.mp3/);
  assert.match(palette.wildlife.birds[2], /rainforest-chirp-c-v31\.mp3/);
  const lengths = catalog.wildlife.birds.map(id => catalog.assets.find(asset => asset.id === id).durationSeconds);
  assert.ok(lengths[0] <= 2 && lengths[1] <= 2 && lengths[2] < 1,
    'Coo phrases are brief recordings; the chirp is shorter still.');
  for (let index = 1; index < 28; index++) {
    const previous = birdEvent(index - 1, scene, 28), current = birdEvent(index, scene, 28);
    assert.ok(previous.atMs + lengths[previous.asset] * 1000 + 20 < current.atMs,
      'Complete coos and chirps finish before the next room-wide call, including native scheduling offset.');
  }
  assert.deepEqual(wildlifeSourcesForRole(palette.wildlife, 'phone'), palette.phoneWildlife);
  assert.equal(palette.phoneWildlife.orangutan, undefined);
  assert.equal(palette.mainWildlife.birds, undefined);
});

test('the Main wildlife controller never requests birds and the engine keeps a phone-only source bank before enable', async () => {
  const context = new Context(), requests = [];
  const audio = new SceneWildlifeAudio({ context, mode: 'operator', destination: {}, fetchImpl: async url => { requests.push(url); return fetchImpl(); } });
  audio.setSources(sources); assert.deepEqual(audio.sources, { orangutan: sources.orangutan });
  audio._load(sources.birds[0]); await flush(); assert.deepEqual(requests, []);
  audio.update({ active: true, scene, elapsedMs: 16000 }); await flush();
  audio.update({ active: true, scene, elapsedMs: 16550 });
  assert.deepEqual(requests, [sources.orangutan]); assert.equal(context.decoded, 1);
  assert.equal(audio.shots.size, 1); audio.destroy();
  const { WildfireSound } = await import('../app/sound-engine.js');
  const phone = new WildfireSound({ mode: 'phone', document: null });
  assert.equal(phone.setWildlifeSources(sources), true);
  assert.deepEqual(phone.wildlifeSources, { birds: sources.birds });
  assert.equal(phone.setWildlifeSources({ birds: [sources.orangutan] }), false);
  assert.deepEqual(phone.wildlifeSources, { birds: sources.birds });
  phone.destroy();
});
