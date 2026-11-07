import test from 'node:test';
import assert from 'node:assert/strict';
import { RainSimulation, BRUSH_RADIUS, CELL_SIZE, MOISTURE_RETENTION_SECONDS, MOISTURE_UPTAKE_SECONDS } from '../app/simulation.js';
import { rainSupplyCapacity, RAIN_SUPPLY_FACTOR } from '../app/rain-supply.mjs';
import { audienceRainStrength } from '../app/scene-score.js';
import { RegionCatalog } from '../app/regions.mjs';
import { NationalSpace } from '../app/national-space.mjs';
import { createParticipantSoundField } from '../app/sound-participants.js';
import { createRainAreaTracker } from '../app/rain-area.js';

const center = [110.125, -2.125];
function visibleSources(position) {
  const sources = [];
  for (let x = Math.floor((position[0] - BRUSH_RADIUS) / CELL_SIZE); x <= Math.floor((position[0] + BRUSH_RADIUS) / CELL_SIZE); x++)
    for (let y = Math.floor((position[1] - BRUSH_RADIUS) / CELL_SIZE); y <= Math.floor((position[1] + BRUSH_RADIUS) / CELL_SIZE); y++) {
      const longitude = (x + .5) * CELL_SIZE, latitude = (y + .5) * CELL_SIZE;
      if (Math.hypot(longitude - position[0], latitude - position[1]) <= BRUSH_RADIUS + 1e-12) sources.push({ longitude, latitude });
    }
  return sources;
}

function extinguishArea({ sceneId, position = center, parameters = {}, strength = .45, step = .2, calibratedWindow = false }) {
  const sources = visibleSources(position), simulation = new RainSimulation(parameters).seed(sources);
  const national = new NationalSpace(new RegionCatalog(sources));
  if (sceneId === 'forest-takeover') simulation.beginForestRestoration(national.fireKeys);
  const tracker = createRainAreaTracker(), contact = { id: 'one-phone', position, holding: true };
  const field = () => createParticipantSoundField(sources.map(source => simulation.sample(source.longitude, source.latitude)));
  tracker.update(field(), [contact], 0);
  const capacity = rainSupplyCapacity(simulation.parameters, strength);
  const limit = calibratedWindow ? capacity / RAIN_SUPPLY_FACTOR : capacity;
  const stroke = { path: [position], strength: audienceRainStrength({ id: sceneId }, strength), constraint: national.constraint };
  for (let index = 1; index <= Math.ceil(limit / step); index++) {
    simulation.step(step, [stroke]);
    const at = index * step, events = tracker.update(field(), [contact], at);
    if (events.length) {
      assert.equal(events.length, 1);
      assert.equal(events[0].memberKeys.length, sources.length, 'The completion covers every visible source centre in the brush.');
      assert.ok(sources.every(source => simulation.sample(source.longitude, source.latitude).extinguished));
      return { at, capacity, sourceCount: sources.length };
    }
  }
  assert.fail(`${sceneId} failed to complete ${sources.length} visible patches within its ${capacity}s water supply.`);
}

test('one default full supply completes a stationary visible rain area in Scenes 3 and 4, including off-grid brush edges', () => {
  for (const sceneId of ['participation', 'forest-takeover']) for (const offset of [[0, 0], [.0625, 0], [.125, 0], [.0625, .0625], [.125, .125], [.001, .124]]) {
    const result = extinguishArea({ sceneId, strength: .54, position: [center[0] + offset[0], center[1] + offset[1]] });
    assert.equal(result.capacity, 50.25);
    assert.ok(result.sourceCount >= 30);
    assert.ok(result.at <= 32, `Actual ${sceneId} area completion still fits the expanded default supply without changing fire physics.`);
  }
});

test('slower custom cooling receives 1.5 times the previous supply without accelerating fire physics', () => {
  const settings = { rainResponseSeconds: 10, deepCoolingSeconds: 30, extinctionHoldSeconds: 8 };
  for (const sceneId of ['participation', 'forest-takeover']) {
    const result = extinguishArea({ sceneId, parameters: settings, calibratedWindow: true });
    assert.equal(result.capacity, 100.5);
    assert.ok(result.at < 100, 'Independent physical cooling still completes within the original calibration window.');
  }
});

test('the 1.5-times supply increase also covers maximum custom timings', () => {
  const result = extinguishArea({ sceneId: 'forest-takeover', step: .5, calibratedWindow: true,
    parameters: { deepCoolingSeconds: 240, extinctionHoldSeconds: 60, rainResponseSeconds: 20 } });
  assert.equal(result.capacity, 638.175);
  assert.ok(result.at < result.capacity);
  assert.ok(result.at < 605);
});

test('source centres on the brush boundary exceed the conservative coverage fraction used to size the supply', () => {
  let minimum = Infinity;
  for (let index = 0; index < 360; index++) {
    const angle = 2 * Math.PI * index / 360;
    const position = [center[0] + BRUSH_RADIUS * Math.cos(angle), center[1] + BRUSH_RADIUS * Math.sin(angle)];
    const simulation = new RainSimulation().seed([{ longitude: center[0], latitude: center[1] }]);
    simulation.step(.1, [{ path: [position], strength: 1 }]);
    // Infer the actual analytic footprint's rate from exact initial moisture
    // uptake, before either moisture or surface clamping can obscure it.
    const gain = MOISTURE_RETENTION_SECONDS / MOISTURE_UPTAKE_SECONDS * -Math.expm1(-.1 / MOISTURE_RETENTION_SECONDS);
    const fraction = simulation.sample(...center).moisture / gain;
    minimum = Math.min(minimum, fraction);
  }
  assert.ok(minimum >= .35, `Minimum actual center-in-brush coverage ${minimum} must exceed the capacity bound.`);
  assert.ok(minimum > .46 && minimum < .48);
});

test('water supply duration does not override intentionally disabled or physically insufficient rain strength', () => {
  for (const strength of [0, .01]) {
    const position = [center[0] + BRUSH_RADIUS / Math.SQRT2, center[1] + BRUSH_RADIUS / Math.SQRT2];
    const simulation = new RainSimulation().seed([{ longitude: center[0], latitude: center[1] }]);
    const capacity = rainSupplyCapacity(simulation.parameters, strength);
    simulation.step(capacity, [{ path: [position], strength: audienceRainStrength({ id: 'forest-takeover' }, strength) }]);
    const patch = simulation.sample(...center);
    assert.equal(patch.extinguished, false);
    assert.ok(patch.moisture < .8, 'A longer tank cannot change an intentionally insufficient physical rain rate.');
  }
});
