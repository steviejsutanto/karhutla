import test from 'node:test';
import assert from 'node:assert/strict';
import { WildfireSound, SOUND_MIXER_DEFAULTS } from '../app/sound-engine.js';
import { SceneWildlifeAudio, wildlifeEnvelope } from '../app/scene-wildlife.js';
import { DEFAULT_SOUND_SETTINGS, soundSettingsPatch } from '../app/performance-scenes.mjs';
import { SharedRoom } from '../app/shared-room.mjs';
import { validateSettingsPreset } from '../app/settings-presets.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
const afterglow = { id: 'afterglow', startedAt: 1, paused: true, elapsedMs: 30000 };
const sources = { orangutan: '/audio-assets/v3/orangutan-distant-v25.mp3', birds: ['/audio-assets/v3/rainforest-bird-low-a-v25.mp3'] };
function context() {
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; },
    setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } });
  const node = () => ({ gain: parameter(), frequency: parameter(), Q: parameter(), playbackRate: parameter(),
    connect() {}, disconnect() {}, start(at, offset) { this.started = [at, offset]; }, stop() {} });
  return { currentTime: 0, state: 'running', createGain: node, createBiquadFilter: node, createBufferSource: node };
}

test('orangutan voice and tail are separate bounded mixer channels with matching saved defaults', () => {
  assert.equal(SOUND_MIXER_DEFAULTS.orangutan, 1); assert.equal(SOUND_MIXER_DEFAULTS.orangutanTail, 1);
  assert.deepEqual(SOUND_MIXER_DEFAULTS, DEFAULT_SOUND_SETTINGS.mixer);
  const next = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mixer: { orangutan: .7, orangutanTail: 1.8 } });
  assert.equal(next.mixer.crickets, 1); assert.equal(next.mixer.orangutan, .7); assert.equal(next.mixer.orangutanTail, 1.8);
  for (const key of ['orangutan', 'orangutanTail']) for (const value of [-1, 2.1, NaN, Infinity, '1'])
    assert.throws(() => soundSettingsPatch(DEFAULT_SOUND_SETTINGS, { mixer: { [key]: value } }), /mixer/);
});

test('orangutan trims immediately update the actual gain and remain independent of Crickets', () => {
  const engine = new WildfireSound({ mode: 'operator', document: null });
  engine.context = context(); engine.enabled = true; engine.scene = { ...afterglow };
  const wildlife = new SceneWildlifeAudio({ context: engine.context, mode: 'operator', destination: {} });
  wildlife.setSources(sources); engine.wildlife = wildlife;
  engine._syncSceneWildlife();
  const full = wildlife.gain.gain.value;
  // The voice trim now precedes the common smooth Main output stage.
  // User volume is applied once by that stage, not baked into this asset.
  close(full, .035 * .8);
  engine.setMixer({ crickets: 0 }); close(wildlife.gain.gain.value, full);
  engine.setMixer({ orangutan: .5 }); close(wildlife.gain.gain.value, full / 2);
  engine.setMixer({ orangutanTail: 0 }); close(wildlife.gain.gain.value, full / 2, 'Tail does not change the early voice.');
  engine.scene.elapsedMs = 54000;
  engine.setMixer({ orangutanTail: 1 }); const quiet = wildlife.gain.gain.value;
  close(quiet, full * .5 * .16);
  engine.setMixer({ orangutanTail: 2 }); close(wildlife.gain.gain.value, quiet * 2);
  engine.setMixer({ orangutanTail: 0 }); close(wildlife.gain.gain.value, 0);
  engine.setMixer({ orangutan: 1, orangutanTail: 1 }); close(wildlife.gain.gain.value, full * .16);
  engine.setMixer({ orangutan: 0 }); close(wildlife.gain.gain.value, 0);
  wildlife.destroy();
});

test('the tail trim crosses over smoothly without changing entrance, retreat timing or final silence', () => {
  for (const tail of [0, .25, 1, 2]) {
    close(wildlifeEnvelope(afterglow, 30000, tail), 1);
    close(wildlifeEnvelope(afterglow, 54000, tail), .16 * tail);
    close(wildlifeEnvelope(afterglow, 129000, tail), 0);
    for (const time of [42000, 54000, 69000])
      assert.ok(Math.abs(wildlifeEnvelope(afterglow, time - .001, tail) - wildlifeEnvelope(afterglow, time, tail)) < 1e-6);
  }
});

test('moving Orangutan voice changes an already playing phrase without restarting or stacking it', () => {
  const engine = new WildfireSound({ mode: 'operator', document: null });
  engine.context = context(); engine.enabled = true; engine.scene = { ...afterglow, paused: false, elapsedMs: 16550 };
  const wildlife = new SceneWildlifeAudio({ context: engine.context, mode: 'operator', destination: {} });
  wildlife.setSources(sources); wildlife.buffers.set(sources.orangutan, { duration: 16 }); engine.wildlife = wildlife;
  engine._syncSceneWildlife(); assert.equal(wildlife.shots.size, 1);
  const source = [...wildlife.shots][0].source, full = wildlife.gain.gain.value;
  engine.setMixer({ orangutan: .5 }); close(wildlife.gain.gain.value, full / 2);
  assert.equal(wildlife.shots.size, 1); assert.equal([...wildlife.shots][0].source, source);
  engine.setMixer({ crickets: 0 }); close(wildlife.gain.gain.value, full / 2);
  engine.setMixer({ orangutan: 0 }); close(wildlife.gain.gain.value, 0);
  assert.equal(wildlife.shots.size, 1, 'The original phrase keeps its clock while the level is zero.');
  wildlife.destroy();
});

test('settings export/import preserves both trims and complete legacy presets inherit unity without mutation', async () => {
  const room = new SharedRoom();
  await room.setSoundSettings({ mixer: { orangutan: .4, orangutanTail: 1.7, crickets: .8 } });
  const preset = room.exportSettingsPreset();
  const target = new SharedRoom(); await target.importSettingsPreset(preset);
  assert.equal(target.soundSettingsState().mixer.orangutan, .4);
  assert.equal(target.soundSettingsState().mixer.orangutanTail, 1.7);
  assert.equal(target.soundSettingsState().mixer.crickets, .8);
  const legacy = structuredClone(preset);
  delete legacy.soundSettings.mixer.orangutan; delete legacy.soundSettings.mixer.orangutanTail;
  const before = structuredClone(legacy), restored = validateSettingsPreset(legacy);
  assert.equal(restored.soundSettings.mixer.orangutan, 1); assert.equal(restored.soundSettings.mixer.orangutanTail, 1);
  assert.equal(restored.soundSettings.mixer.crickets, .8); assert.deepEqual(legacy, before);
  for (const broken of [
    value => { delete value.soundSettings.mixer.bells; },
    value => { value.soundSettings.mixer.unknown = 1; },
    value => { value.soundSettings.mixer.orangutanTail = 1; },
  ]) {
    const invalid = structuredClone(legacy); broken(invalid); assert.throws(() => validateSettingsPreset(invalid), /sound mixer/);
  }
});
