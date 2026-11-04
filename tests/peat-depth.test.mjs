import test from 'node:test';
import assert from 'node:assert/strict';
import { RainSimulation } from '../app/simulation.js';
import { derivePeatDepthState } from '../visual-assets/peat-section.js';

const position = [114.125, -.125];
const fire = { longitude: position[0], latitude: position[1] };
const depth = (patch, at) => derivePeatDepthState(patch, at);

test('first rain stops surface flare while deep peat still carries residual embers', () => {
  const dry = { heat: 1, surfaceWetness: 0, moisture: 0 };
  const earlyWet = { heat: .97, surfaceWetness: 1, moisture: .25 };
  assert.equal(depth(dry, 0).stage, 'fire');
  assert.equal(depth(dry, 0).flame, 1);
  assert.equal(depth(earlyWet, 0).flame, 0);
  assert.equal(depth(earlyWet, 0).stage, 'ember');
  assert.ok(depth(earlyWet, 0).surfaceEmber > 0);
  assert.ok(depth(earlyWet, 0).ember < .1);
  assert.ok(depth(earlyWet, .8).ember > .9, 'A wet skin must not dim the whole column.');
});

test('the confirmed cooling front darkens upper peat before reaching lower strata', () => {
  const middle = { heat: .7, surfaceWetness: 1, moisture: .9 };
  const later = { heat: .35, surfaceWetness: 1, moisture: 1 };
  assert.ok(depth(middle, .2).cooling > .9);
  assert.ok(depth(middle, .75).cooling < .01);
  assert.ok(depth(middle, .75).ember > .85);
  assert.ok(depth(later, .75).cooling > .9);
  assert.ok(depth(later, .75).ember < depth(middle, .75).ember * .1);
  assert.ok(depth(later, 1).ember > depth(later, .75).ember * 10, 'The deepest remaining ember band is distinct.');
});

test('actual held rain progresses from surface fire through shallow cooling and deep ember to out', () => {
  const simulation = new RainSimulation().seed([fire]);
  const snapshots = [];
  let previous = 0;
  for (const seconds of [0, 1, 5, 15, 30]) {
    if (seconds > previous) simulation.step(seconds - previous, [{ path: [position], strength: 1 }]);
    snapshots.push(simulation.sample(...position)); previous = seconds;
  }
  const [dry, early, middle, late, out] = snapshots;
  assert.equal(depth(dry, 0).stage, 'fire');
  assert.ok(depth(early, 0).flame < depth(dry, 0).flame * .1);
  assert.ok(depth(early, 1).ember > .9);
  assert.ok(depth(early, 0).ember < depth(early, 1).ember * .1);
  assert.ok(depth(middle, .25).cooling > .9);
  assert.ok(depth(middle, .85).ember > .8);
  assert.ok(depth(late, .85).ember < depth(middle, .85).ember * .1);
  const fronts = snapshots.map(patch => depth(patch, .5).coolingFront);
  assert.ok(fronts.every((front, index) => !index || front >= fronts[index - 1]));
  assert.equal(out.extinguished, true);
  for (const at of [0, .1, .3, .5, .8, 1]) {
    const state = depth(out, at);
    assert.equal(state.ember, 0); assert.equal(state.flame, 0); assert.equal(state.stage, 'out');
  }
});

test('depth artwork is read-only and cannot cool a neighboring geographic patch', () => {
  const simulation = new RainSimulation().seed([fire, { longitude: 135.125, latitude: -1.875 }]);
  simulation.step(5, [{ path: [position], strength: 1 }]);
  const wet = Object.freeze(simulation.sample(...position));
  const untouched = Object.freeze(simulation.sample(135.125, -1.875));
  const before = simulation.serialize();
  for (const at of [0, .2, .5, 1]) {
    assert.ok(depth(wet, at).ember < depth(untouched, at).ember);
    assert.equal(depth(untouched, at).cooling, 0);
  }
  assert.deepEqual(simulation.serialize(), before);
});

test('explicit extinction removes all persistent fire and ember, even with inconsistent heat input', () => {
  const out = { heat: 1, surfaceWetness: 0, moisture: .3, extinguished: true };
  for (const at of [0, .5, 1]) {
    const state = depth(out, at);
    assert.equal(state.flame, 0); assert.equal(state.ember, 0); assert.equal(state.surfaceEmber, 0);
    assert.equal(state.stage, 'out');
  }
});
