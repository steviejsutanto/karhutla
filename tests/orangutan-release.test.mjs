import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneWildlifeAudio } from '../app/scene-wildlife.js';
import { scoreDurations } from '../app/scene-score.js';
import { WildfireSound } from '../app/sound-engine.js';

const url = '/audio-assets/v3/orangutan-distant-v25.mp3';
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
class Parameter {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, at) { this.events.push({ value, at }); this.value = value; }
  linearRampToValueAtTime(value, at) { this.events.push({ value, at, ramp: true }); this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); }
  at(time) {
    let previous = { value: 0, at: 0 };
    for (const next of this.events) {
      if (next.at > time) return next.ramp && next.at > previous.at
        ? previous.value + (next.value - previous.value) * (time - previous.at) / (next.at - previous.at) : previous.value;
      previous = next;
    }
    return previous.value;
  }
}
function fixture(settings) {
  const node = () => ({ gain: new Parameter(), frequency: new Parameter(), Q: new Parameter(), playbackRate: new Parameter(),
    connect() {}, disconnect() {}, start(at, offset) { this.started = [at, offset]; }, stop(at) { this.stopped = at; } });
  const context = { currentTime: 0, state: 'running', createGain: node, createBiquadFilter: node, createBufferSource: node };
  const audio = new SceneWildlifeAudio({ context, mode: 'operator', destination: {} });
  audio.setSources({ orangutan: url }); audio.buffers.set(url, { duration: 16 });
  const scene = { id: 'afterglow', startedAt: 1, settings };
  return { audio, context, scene, update(elapsedMs, extra = {}) { audio.update({ active: true, scene: { ...scene, ...extra }, elapsedMs }); } };
}

test('Main phrases release smoothly over the last three seconds and resumed closing phrases stay quiet', () => {
  const f = fixture(); f.update(16550);
  const original = [...f.audio.shots][0], at = original.source.started[0], age = original.source.started[1];
  close(original.envelope.gain.at(at + 13 - age), 1, .002);
  close(original.envelope.gain.at(at + 14.5 - age), .5, .002);
  assert.ok(original.envelope.gain.at(at + 15.8 - age) < .016);
  close(original.envelope.gain.at(at + 16 - age), 0);
  f.context.currentTime = 15; f.update(31500, { paused: true }); assert.equal(f.audio.shots.size, 0);
  f.context.currentTime = 25; f.update(31700);
  const resumed = [...f.audio.shots][0]; assert.notEqual(resumed.source, original.source);
  close(resumed.source.started[1], 15.2);
  assert.ok(Math.max(...resumed.envelope.gain.events.map(event => event.value)) < .18,
    'The final recording fraction cannot retrigger the full-level body after a pause.');
  close(resumed.envelope.gain.events.at(-1).value, 0); f.audio.destroy();
});

test('native dry and wet final release reaches exact silence for default and shorter custom endings', () => {
  for (const settings of [undefined, { phoneOnlySeconds: 4, phoneFadeSeconds: 28 }, { phoneFadeSeconds: 1 }]) {
    const f = fixture(settings), d = scoreDurations(settings), fade = Math.min(6000, d.phoneFadeMs);
    f.update(16550); const parameter = f.audio.finalRelease.gain;
    close(parameter.at((d.afterglowDurationMs - fade - 16550) / 1000), 1);
    close(parameter.at((d.afterglowDurationMs - fade / 2 - 16550) / 1000), .5);
    close(parameter.at((d.afterglowDurationMs - 16550) / 1000), 0);
    close(parameter.events.at(-1).at, (d.afterglowDurationMs - 16550) / 1000);
    f.context.currentTime = (d.afterglowDurationMs - 16550) / 1000;
    close(f.audio.getMetrics().finalRelease, 0);
    f.audio.update({ active: true, scene: { id: 'ended' }, elapsedMs: 0 });
    close(f.audio.finalRelease.gain.at(f.context.currentTime), 0); assert.equal(f.audio.shots.size, 0); f.audio.destroy();
  }
});

test('final release follows paused show time and reschedules from its unchanged position on resume', () => {
  const f = fixture(); f.update(126000, { paused: true });
  close(f.audio.getMetrics().finalRelease, .5);
  f.context.currentTime = 20; close(f.audio.getMetrics().finalRelease, .5); close(f.audio.finalRelease.gain.at(20), .5);
  f.update(126000); close(f.audio.finalRelease.gain.at(20), .5);
  close(f.audio.finalRelease.gain.at(23), 0);
  f.context.currentTime = 21; f.audio.stop(); close(f.audio.finalRelease.gain.at(21), 0);
  f.context.currentTime = 24; close(f.audio.getMetrics().finalRelease, 0); f.audio.destroy();
});

test('reverse cue carry freezes the current final gate without boosting the call or retaining its old deadline', () => {
  const f = fixture(); f.update(124550); const shot = [...f.audio.shots][0]; assert.ok(shot);
  f.context.currentTime = 1.45; const held = f.audio.getMetrics().finalRelease; close(held, .5);
  const engine = new WildfireSound({ mode: 'operator', document: null });
  engine.context = f.context; engine.enabled = true; engine.wildlife = f.audio; engine.scene = { id: 'instructions', startedAt: 2 };
  engine._mainWildlifeComponents = () => ({ base: .01, tail: .005 });
  engine._syncSceneWildlife(); close(f.audio.getMetrics().finalRelease, held);
  f.context.currentTime = 9; engine._syncSceneWildlife(); close(f.audio.getMetrics().finalRelease, held);
  close(f.audio.finalRelease.gain.at(9), held);
  assert.equal([...f.audio.shots][0], shot, 'The reverse bridge keeps the same native phrase alive.');
  f.audio.stop(); close(f.audio.finalRelease.gain.at(9), 0); f.audio.destroy();
});
