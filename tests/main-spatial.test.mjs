import test from 'node:test';
import assert from 'node:assert/strict';
import { mainSpatialPosition, MAIN_STEREO_FOCUS } from '../app/main-spatial.js';
import { participantPosition } from '../app/sound-engine.js';
import { PatchSoftToneAudio } from '../app/patch-soft-tones.js';

test('Main stereo focus preserves calibrated HRTF positions, distance and centre', () => {
  for (const y of [0, .25, .5, .75, 1]) {
    assert.deepEqual(mainSpatialPosition([.5, y]).world, [0, 0, -(.8 + 6 * y)]);
    assert.equal(mainSpatialPosition([.5, y]).pan, 0);
    for (const x of [0, .1, .25, .4, .5, .6, .75, .9, 1]) {
      const pose = mainSpatialPosition([x, y]);
      const previous = [(x - .5) * 7, 0, -(.8 + 6 * y)];
      assert.deepEqual(pose.world, previous);
      assert.ok(Math.abs(Math.hypot(...pose.world) - Math.hypot(...previous)) < 1e-12);
      assert.equal(pose.distanceGain, 1 / (1 + .8 * y));
      assert.ok(Math.abs(pose.pan) <= 1);
      assert.equal(pose.focusPan, pose.pan * MAIN_STEREO_FOCUS);
      assert.deepEqual(participantPosition([x, y]), pose);
    }
  }
});

test('stereo fallback remains symmetric, monotonic and equal-power with a stable mono centre', () => {
  let previous = -1;
  for (let step = 0; step <= 100; step++) {
    const x = step / 100, pan = mainSpatialPosition([x, .5]).pan;
    assert.ok(pan >= previous); previous = pan;
    assert.ok(Math.abs(pan + mainSpatialPosition([1 - x, .5]).pan) < 1e-12);
    const angle = (pan + 1) * Math.PI / 4, left = Math.cos(angle), right = Math.sin(angle);
    assert.ok(Math.abs(left * left + right * right - 1) < 1e-12);
    assert.ok((left + right) / 2 >= .5 - 1e-12, 'Mono fold-down never cancels or loses more than equal-power panning.');
  }
  assert.equal(mainSpatialPosition([0, .5]).pan, -1);
  assert.equal(mainSpatialPosition([1, .5]).pan, 1);
  assert.ok(mainSpatialPosition([.75, .5]).pan > .45);
});

test('patch tones, quench and legacy voices share one Main coordinate rule', () => {
  const pose = mainSpatialPosition([.9, .7]);
  const hrtf = { mode: 'HRTF', panner: { positionX: {}, positionY: {}, positionZ: {} }, focus: { pan: {} }, distance: { gain: {} } };
  PatchSoftToneAudio.prototype._position(hrtf, [.9, .7]);
  assert.deepEqual([hrtf.panner.positionX.value, hrtf.panner.positionY.value, hrtf.panner.positionZ.value], pose.world);
  assert.equal(hrtf.distance.gain.value, 1);
  assert.equal(hrtf.focus.pan.value, pose.focusPan);
  const stereo = { mode: 'stereo', panner: { pan: {} }, distance: { gain: {} } };
  PatchSoftToneAudio.prototype._position(stereo, [.9, .7]);
  assert.equal(stereo.panner.pan.value, pose.pan); assert.equal(stereo.distance.gain.value, pose.distanceGain);
  assert.deepEqual(mainSpatialPosition([Infinity, -4]).world, [0, 0, -.8]);
  assert.deepEqual(mainSpatialPosition(null), mainSpatialPosition([.5, .5]));
});
