import test from 'node:test';
import assert from 'node:assert/strict';
import { RainSimulation, CELL_SIZE, BRUSH_RADIUS, DEFAULT_PARAMETERS, PARAMETER_LIMITS, MOISTURE_UPTAKE_SECONDS, MOISTURE_RETENTION_SECONDS, FOREST_RETURN_HEAT_EPSILON } from './simulation.js';

const point = [110.125, -2.125];
const source = [{ longitude: point[0], latitude: point[1] }];
const stroke = (strength = 1) => ({ from: point, to: point, strength });
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const expectedBudget = seconds => Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2 * seconds;
// The older renderer's half-suppression curve remains the wetting calibration.
const visibleFlameHeight = surfaceWetness => {
  const amount = Math.max(0, Math.min(1, (1 - 0.95 * surfaceWetness - 0.1) / 0.68));
  return amount ** 2 * (3 - 2 * amount);
};
// Current abstract surface activity; return controls are calibrated separately
// so its recovery is visibly half complete at the configured return time.
const surfaceActivity = ({ heat = 1, surfaceWetness }) => heat * (1 - surfaceWetness) ** 2.2;
const withCellState = (parameters, state) => {
  const simulation = new RainSimulation(parameters).seed(source);
  Object.assign(simulation.cells.values().next().value, state);
  return simulation;
};

test('forest takeover adds returning heat without replacing rain or remembered ground', () => {
  const simulation = new RainSimulation().seed(source);
  simulation.step(70, [stroke()]);
  const entry = simulation.serialize();
  simulation.beginForestRestoration(); simulation.restoreForest(0);
  assert.deepEqual(simulation.serialize(), entry, 'Entry preserves the actual cooled field.');
  simulation.step(.1);
  const firstReturn = simulation.sample(...point);
  assert.equal(firstReturn.extinguished, false);
  assert.ok(firstReturn.heat > FOREST_RETURN_HEAT_EPSILON && firstReturn.heat < .1, 'Heat returns gradually instead of jumping to the dry baseline.');
  assert.ok(firstReturn.moisture > .99, 'Stored ground moisture survives reheating.');
  simulation.step(2, [stroke()]);
  const touched = simulation.serialize();
  simulation.restoreForest(.5); simulation.restoreForest(1); simulation.restoreForest(1);
  assert.deepEqual(simulation.serialize(), touched, 'Score progress and repeated reads never overwrite a touch.');
  close(simulation.totalWater - entry.totalWater, expectedBudget(2));
  assert.deepEqual(simulation.sourceRecords, entry.sourceRecords);
  assert.deepEqual(simulation.parameters, entry.parameters);
  simulation.endForestRestoration();
  simulation.step(70, [stroke()]); simulation.advanceDry(100);
  assert.equal(simulation.sample(...point).extinguished, true, 'Extinction remains persistent outside takeover.');
});

test('tiny authority intervals still accumulate a genuine returning heat threshold', () => {
  const simulation = withCellState({}, { heat: 0, moisture: 1, surfaceWetness: 1, extinguished: true, settledFor: 4 });
  simulation.beginForestRestoration();
  simulation.step(.0001);
  assert.equal(simulation.sample(...point).extinguished, true);
  assert.equal(simulation.sample(...point).heat, 0, 'An out flag never publishes nonzero heat.');
  for (let frame = 0; frame < 20; frame++) simulation.step(.0001);
  assert.equal(simulation.sample(...point).extinguished, false, 'Sub-threshold intervals accumulate instead of swallowing the return.');
  assert.ok(simulation.sample(...point).heat > FOREST_RETURN_HEAT_EPSILON);
});

test('sustained takeover rain really extinguishes and the returning sources repeatedly rearm', () => {
  for (const parameters of [{}, { deepCoolingSeconds: 2, extinctionHoldSeconds: 0 }]) {
    const simulation = new RainSimulation(parameters).seed(source);
    simulation.beginForestRestoration();
    const events = []; let out = false;
    for (let frame = 1; frame <= 900; frame++) {
      simulation.step(.1, [stroke(.5)]);
      const cell = simulation.sample(...point);
      if (cell.extinguished !== out) {
        events.push({ time: frame / 10, out: cell.extinguished, heat: cell.heat });
        out = cell.extinguished;
      }
      if (frame === 300) simulation.restoreForest(1);
      if (cell.extinguished) assert.equal(cell.heat, 0);
    }
    assert.ok(events.length >= 6, 'Held rain allows multiple real out → fire → out cycles.');
    assert.deepEqual(events.slice(0, 6).map(event => event.out), [true, false, true, false, true, false]);
    assert.ok(events.some(event => event.time > 30 && !event.out && event.heat > FOREST_RETURN_HEAT_EPSILON), 'Return pressure continues after the sound reaches 100%.');
    close(simulation.totalWater, expectedBudget(45), 1e-7);
  }
});

test('takeover competition shares the same elapsed time and water at sparse and frequent ticks', () => {
  const a = new RainSimulation().seed(source), b = new RainSimulation().seed(source);
  for (const simulation of [a, b]) simulation.beginForestRestoration();
  a.step(80, [stroke(.5)]);
  for (let frame = 0; frame < 800; frame++) b.step(.1, [stroke(.5)]);
  for (const field of ['heat', 'moisture', 'surfaceWetness', 'settledFor']) close(a.sample(...point)[field], b.sample(...point)[field]);
  assert.equal(a.sample(...point).extinguished, b.sample(...point).extinguished);
  close(a.totalWater, b.totalWater);
  const entry = a.serialize();
  a.beginForestRestoration(); a.restoreForest(0);
  assert.deepEqual(a.serialize(), entry, 'A manual replay also preserves current touch state.');
});

test('final rain cools the real entry field with its rain envelope while retaining geography and measured water', () => {
  const simulation = withCellState({ deepCoolingSeconds: 2, extinctionHoldSeconds: 0 }, { heat: .8, moisture: .2, surfaceWetness: .4 });
  simulation.seed([{ longitude: 130.125, latitude: -3.125 }]);
  const sourceKey = `${Math.floor(point[0] / CELL_SIZE)},${Math.floor(point[1] / CELL_SIZE)}`;
  const before = simulation.serialize(), historic = simulation.sample(130.125, -3.125);
  simulation.beginFinalRainCooling(new Set([sourceKey])); simulation.coolFinalRain(0);
  assert.deepEqual(simulation.serialize(), before, 'Cue entry preserves every actual cell.');
  simulation.stepFinalRain(30, .25, .5);
  const halfway = simulation.sample(...point);
  close(halfway.heat, .4); close(halfway.moisture, .6); close(halfway.surfaceWetness, .7);
  assert.equal(halfway.extinguished, false);
  assert.deepEqual(simulation.sample(130.125, -3.125), historic, 'Historic sources outside the current snapshot receive no finale rain.');
  close(simulation.totalWater, before.totalWater + 7.5);
  const unchanged = simulation.serialize(); simulation.coolFinalRain(.5); simulation.coolFinalRain(.2);
  assert.deepEqual(simulation.serialize(), unchanged, 'Repeated reads and a longer duration neither add water nor return heat.');
  simulation.stepFinalRain(30, .75, 1);
  assert.deepEqual({ ...simulation.sample(...point), longitude: undefined, latitude: undefined },
    { longitude: undefined, latitude: undefined, heat: 0, moisture: 1, surfaceWetness: 1, extinguished: true, settledFor: 0, hasFire: true });
  close(simulation.totalWater, before.totalWater + 30);
  assert.deepEqual(simulation.parameters, before.parameters);
  assert.deepEqual(simulation.sourceRecords, before.sourceRecords);
  assert.equal(simulation.cells.size, before.cells.length);
  simulation.endFinalRainCooling(); simulation.advanceDry(100);
  assert.equal(simulation.sample(...point).extinguished, true, 'Completed finale extinction remains authoritative after the cue.');
});

test('finale cooling is independent of frame cadence and takes a new entry snapshot on reentry', () => {
  const a = withCellState({}, { heat: .8, moisture: .2, surfaceWetness: .4 });
  const b = withCellState({}, { heat: .8, moisture: .2, surfaceWetness: .4 });
  for (const simulation of [a, b]) simulation.beginFinalRainCooling();
  a.stepFinalRain(10, .25, .5);
  for (let frame = 1; frame <= 100; frame++) b.stepFinalRain(.1, .25, frame / 200);
  for (const field of ['heat', 'moisture', 'surfaceWetness', 'settledFor']) close(a.sample(...point)[field], b.sample(...point)[field]);
  close(a.totalWater, b.totalWater);
  const entry = a.sample(...point);
  a.beginFinalRainCooling(); a.coolFinalRain(0);
  assert.deepEqual(a.sample(...point), entry);
  a.coolFinalRain(.5);
  close(a.sample(...point).heat, .2); close(a.sample(...point).moisture, .8); close(a.sample(...point).surfaceWetness, .85);
  const restored = new RainSimulation(); assert.equal(restored.restore(a.serialize()), true);
  assert.equal(restored.finalRainCooling, null, 'Saved field values do not revive an ephemeral finale envelope.');
  assert.deepEqual(restored.serialize(), a.serialize());
  a.reset(); assert.equal(a.finalRainCooling, null);
});

test('parameter defaults, ranges, and partial updates form a validated configuration', () => {
  assert.deepEqual(DEFAULT_PARAMETERS, { fireReturnSeconds: 4, rainResponseSeconds: 1.5, deepCoolingSeconds: 10, extinctionHoldSeconds: 4 });
  const ranges = { fireReturnSeconds: [3, 90], rainResponseSeconds: [0.5, 20], deepCoolingSeconds: [2, 240], extinctionHoldSeconds: [0, 60] };
  for (const [name, [min, max]] of Object.entries(ranges)) {
    assert.equal(PARAMETER_LIMITS[name].min, min);
    assert.equal(PARAMETER_LIMITS[name].max, max);
    assert.ok(Number.isFinite(PARAMETER_LIMITS[name].step) && PARAMETER_LIMITS[name].step > 0);
  }
  const simulation = new RainSimulation({ fireReturnSeconds: 90 });
  assert.deepEqual(simulation.parameters, { ...DEFAULT_PARAMETERS, fireReturnSeconds: 90 });
  assert.equal(simulation.setParameters({ rainResponseSeconds: 1, extinctionHoldSeconds: 0 }), true);
  assert.deepEqual(simulation.parameters, { ...DEFAULT_PARAMETERS, fireReturnSeconds: 90, rainResponseSeconds: 1, extinctionHoldSeconds: 0 });
  const before = simulation.serialize();
  for (const patch of [null, [], { unknown: 2 }, { fireReturnSeconds: 2 }, { rainResponseSeconds: 21 }, { deepCoolingSeconds: NaN }, { extinctionHoldSeconds: '20' }, { fireReturnSeconds: 30, extinctionHoldSeconds: -1 }]) {
    assert.equal(simulation.setParameters(patch), false);
    assert.deepEqual(simulation.serialize(), before);
  }
  assert.equal(simulation.setParameters({ fireReturnSeconds: 17.5 }), true, 'Slider steps do not restrict valid saved numeric values');
});

test('sampling is nonmutating; seeding copies source coordinates and retains state', () => {
  const simulation = new RainSimulation();
  assert.equal(simulation.sample(...point).heat, 0);
  assert.equal(simulation.cells.size, 0);
  const records = [{ ...source[0], extra: 'unchanged' }];
  simulation.seed(records).step(10, [stroke()]);
  const before = simulation.sample(...point);
  simulation.seed(records);
  assert.deepEqual(simulation.sample(...point), before);
  const sample = simulation.sample(...point); sample.moisture = 0;
  assert.equal(simulation.sample(...point).moisture, before.moisture);
  assert.deepEqual(records, [{ ...source[0], extra: 'unchanged' }]);
});

test('stationary and long sweeping paths emit the same time-based water budget', () => {
  const stationary = new RainSimulation().step(2, [stroke(0.5)]);
  const moving = new RainSimulation().step(2, [{ from: [100, -4], to: [130, 3], strength: 0.5 }]);
  close(stationary.stats().totalWater, expectedBudget(1));
  close(moving.stats().totalWater, stationary.stats().totalWater);
  assert.ok(moving.stats().wetCells > stationary.stats().wetCells);
  assert.ok(moving.sample(115, -0.5).moisture < stationary.sample(...point).moisture);
});

test('polyline subdivisions and duplicate pointer events never multiply water', () => {
  const simple = new RainSimulation().step(2, [{ path: [[108, -2], [112, -2]], strength: 0.7 }]);
  const subdivided = new RainSimulation().step(2, [{ path: [[108, -2], [108, -2], [109, -2], [110, -2], [111, -2], [112, -2], [112, -2]], strength: 0.7 }]);
  close(simple.totalWater, subdivided.totalWater);
  for (const cell of simple.cells.values()) {
    close(simple.sample(cell.longitude, cell.latitude).moisture, subdivided.sample(cell.longitude, cell.latitude).moisture);
  }
});

test('different event/frame rates preserve budget and constant-rain state', () => {
  const batched = new RainSimulation().seed(source).step(12, [stroke(0.5)]);
  const frequent = new RainSimulation().seed(source);
  for (let i = 0; i < 720; i += 1) frequent.step(1 / 60, [stroke(0.5)]);
  close(batched.totalWater, frequent.totalWater, 1e-7);
  for (const field of ['surfaceWetness', 'moisture', 'heat']) close(batched.sample(...point)[field], frequent.sample(...point)[field]);
});

test('independent overlapping strokes add their water and infiltration', () => {
  const single = new RainSimulation().step(1, [stroke(0.5)]);
  const overlap = new RainSimulation().step(1, [stroke(0.5), stroke(0.5)]);
  close(overlap.totalWater, 2 * single.totalWater);
  close(overlap.sample(...point).moisture, 2 * single.sample(...point).moisture);
});

test('half-strength stationary interior rain reaches moisture .8 in under two seconds without changing its budget', () => {
  const simulation = new RainSimulation().seed(source);
  const crossing = -MOISTURE_RETENTION_SECONDS * Math.log(1 - 0.8 / (0.5 * MOISTURE_RETENTION_SECONDS / MOISTURE_UPTAKE_SECONDS));
  assert.ok(crossing > 1 && crossing < 2);
  simulation.step(crossing, [stroke(0.5)]);
  const cell = simulation.sample(...point);
  close(cell.moisture, 0.8);
  close(simulation.totalWater, expectedBudget(crossing * 0.5));
  assert.ok(cell.heat > 0.15);
  assert.equal(cell.extinguished, false);
});

test('release leaves surface water and retained moisture, which dry at different rates', () => {
  const simulation = new RainSimulation().seed(source).step(20, [stroke()]);
  const wet = simulation.sample(...point);
  simulation.step(15);
  const dry = simulation.sample(...point);
  close(dry.moisture, wet.moisture * Math.exp(-15 / 180));
  assert.ok(dry.surfaceWetness > 0 && dry.surfaceWetness < wet.surfaceWetness);
  assert.ok(dry.surfaceWetness / wet.surfaceWetness < dry.moisture / wet.moisture);
  assert.ok(dry.moisture > 0);
  simulation.advanceDry(86400);
  assert.ok(simulation.sample(...point).moisture < 1e-100);
});

test('return controls match current surface activity while wetting retains its half-suppression calibration', () => {
  for (const fireReturnSeconds of [3, DEFAULT_PARAMETERS.fireReturnSeconds, 90]) {
    const simulation = withCellState({ fireReturnSeconds }, { surfaceWetness: 1 });
    simulation.advanceDry(fireReturnSeconds);
    close(surfaceActivity(simulation.sample(...point)), 0.5);
    assert.equal(simulation.sample(...point).heat, 1, 'A fully hot unfinished patch remains hot while its surface dries');
  }
  for (const rainResponseSeconds of [0.5, DEFAULT_PARAMETERS.rainResponseSeconds, 20]) {
    const simulation = new RainSimulation({ rainResponseSeconds }).step(rainResponseSeconds, [stroke(0.5)]);
    close(visibleFlameHeight(simulation.sample(...point).surfaceWetness), 0.5);
  }
});

test('a long fire-return setting preserves gradual recovery after release', () => {
  const simulation = new RainSimulation({ fireReturnSeconds: 90, extinctionHoldSeconds: 60 }).seed(source).step(12, [stroke(0.5)]);
  close(simulation.sample(...point).surfaceWetness, 1);
  simulation.advanceDry(20);
  assert.ok(surfaceActivity(simulation.sample(...point)) < 0.1, 'Surface activity stays low twenty seconds into a deliberately long recovery');
  assert.equal(simulation.sample(...point).extinguished, false);
  simulation.advanceDry(70);
  const recovering = simulation.sample(...point);
  close((1 - recovering.surfaceWetness) ** 2.2, 0.5);
  simulation.advanceDry(180);
  assert.ok(surfaceActivity(simulation.sample(...point)) > 0.85);
});

test('timing settings change suppression, recovery, and deep cooling without changing water or infiltration', () => {
  const fast = new RainSimulation({ fireReturnSeconds: 3, rainResponseSeconds: 1, deepCoolingSeconds: 15, extinctionHoldSeconds: 60 }).seed(source);
  const slow = new RainSimulation({ fireReturnSeconds: 90, rainResponseSeconds: 20, deepCoolingSeconds: 240, extinctionHoldSeconds: 60 }).seed(source);
  fast.step(3, [stroke(0.5)]); slow.step(3, [stroke(0.5)]);
  assert.ok(fast.sample(...point).surfaceWetness > slow.sample(...point).surfaceWetness);
  fast.step(72, [stroke()]); slow.step(72, [stroke()]);
  const fastWet = fast.sample(...point), slowWet = slow.sample(...point);
  close(fastWet.moisture, slowWet.moisture);
  close(fast.totalWater, slow.totalWater);
  close(fast.totalWater, expectedBudget(73.5));
  assert.ok(fastWet.heat < slowWet.heat * 0.5, 'A shorter deep-cooling time must remove more retained heat under the same rain');
  fast.advanceDry(10); slow.advanceDry(10);
  assert.ok(fast.sample(...point).surfaceWetness < slow.sample(...point).surfaceWetness);
  close(fast.sample(...point).moisture, slow.sample(...point).moisture);
});

test('rain elsewhere and weak local rain do not accelerate surface-fire recovery', () => {
  const payload = new RainSimulation().seed(source).step(8, [stroke(0.5)]).serialize();
  const dry = new RainSimulation(), elsewhere = new RainSimulation(), drizzle = new RainSimulation(), frequent = new RainSimulation();
  for (const simulation of [dry, elsewhere, drizzle, frequent]) assert.ok(simulation.restore(payload));
  dry.advanceDry(20);
  elsewhere.step(20, [{ from: [125.125, -2.125], to: [125.125, -2.125], strength: 0.5 }]);
  drizzle.step(20, [stroke(0.02)]);
  for (let i = 0; i < 200; i++) frequent.step(0.1, [stroke(0.02)]);
  close(elsewhere.sample(...point).surfaceWetness, dry.sample(...point).surfaceWetness);
  assert.ok(drizzle.sample(...point).surfaceWetness >= dry.sample(...point).surfaceWetness);
  close(drizzle.sample(...point).surfaceWetness, frequent.sample(...point).surfaceWetness);
});

test('surface suppression, deep cooling, and four seconds of out confirmation remain distinct', () => {
  const simulation = new RainSimulation().seed(source).step(10, [stroke(0.5)]);
  assert.ok(simulation.sample(...point).surfaceWetness > 0.99);
  assert.ok(simulation.sample(...point).heat > 0.15);
  assert.equal(simulation.sample(...point).extinguished, false);
  let iterations = 0;
  while (simulation.sample(...point).settledFor === 0 && iterations++ < 200) simulation.step(0.1, [stroke(0.5)]);
  const start = simulation.sample(...point);
  assert.ok(start.settledFor > 0 && start.settledFor < 0.1);
  simulation.step(3.8, [stroke(0.5)]);
  assert.equal(simulation.sample(...point).extinguished, false);
  simulation.step(0.2, [stroke(0.5)]);
  assert.equal(simulation.sample(...point).extinguished, true);
  assert.equal(simulation.stats().extinguishedCells, 1);
  assert.equal(simulation.sample(...point).heat, 0);
});

test('unfinished recovery is invariant across dry intervals and rain elsewhere, regardless of deep-cooling setting', () => {
  for (const deepCoolingSeconds of [15, 37, 240]) {
    const simulation = withCellState({ deepCoolingSeconds, extinctionHoldSeconds: 7 }, { surfaceWetness: 0.8, moisture: 0.96, heat: 0.42 });
    const payload = simulation.serialize();
    const one = new RainSimulation(), many = new RainSimulation(), rainElsewhere = new RainSimulation();
    assert.ok(one.restore(payload)); assert.ok(many.restore(payload)); assert.ok(rainElsewhere.restore(payload));
    one.advanceDry(60);
    for (let i = 0; i < 600; i += 1) {
      many.advanceDry(0.1);
      rainElsewhere.step(0.1, [{ from: [125.125, -2.125], to: [125.125, -2.125], strength: 0.5 }]);
    }
    const result = one.sample(...point);
    for (const field of ['surfaceWetness', 'moisture', 'heat', 'settledFor']) {
      close(result[field], many.sample(...point)[field]);
      close(result[field], rainElsewhere.sample(...point)[field]);
    }
    assert.equal(result.extinguished, many.sample(...point).extinguished);
    assert.equal(result.extinguished, rainElsewhere.sample(...point).extinguished);
    assert.equal(result.extinguished, false);
    assert.equal(result.settledFor, 0);
    close(result.heat, 1 - (1 - .42) * 2 ** (-60 / DEFAULT_PARAMETERS.fireReturnSeconds));
  }
});

test('a zero extinction hold still needs active local rain and a qualifying wet, cool fire', () => {
  const dry = new RainSimulation({ extinctionHoldSeconds: 0 }).seed(source).advanceDry(10);
  assert.equal(dry.sample(...point).extinguished, false);
  dry.step(1, [stroke(0.001)]);
  assert.equal(dry.sample(...point).extinguished, false);
  const insufficientMoisture = withCellState({ extinctionHoldSeconds: 0 }, { moisture: 0.79, heat: 0.1 }).advanceDry(1);
  assert.equal(insufficientMoisture.sample(...point).extinguished, false);
  for (const wetStep of [false, true]) {
    const eligible = withCellState({ extinctionHoldSeconds: 0 }, { moisture: 0.8, heat: 0.15 });
    if (wetStep) eligible.step(0.1, [stroke(0.5)]);
    else eligible.advanceDry(0.1);
    assert.equal(eligible.sample(...point).extinguished, wetStep, 'Only active local rain can complete an eligible patch');
  }
  const crossing = withCellState({ deepCoolingSeconds: 15, extinctionHoldSeconds: 0 }, { moisture: 1, heat: 0.16 }).step(2, [stroke()]);
  assert.equal(crossing.sample(...point).extinguished, true, 'Active rain can cross the heat threshold partway through an interval');
});

test('live parameter changes preserve cells, geographic history, water, and current extinction progress', () => {
  const simulation = new RainSimulation().seed(source).step(12, [stroke()]);
  Object.assign(simulation.cells.values().next().value, { moisture: 0.9, heat: 0.1, settledFor: 5 });
  simulation.seed([{ longitude: 125.125, latitude: -3.125 }]);
  const cells = simulation.cells;
  const before = simulation.serialize();
  assert.equal(simulation.setParameters({ fireReturnSeconds: 90, rainResponseSeconds: 20, deepCoolingSeconds: 240, extinctionHoldSeconds: 0 }), true);
  assert.equal(simulation.cells, cells);
  const after = simulation.serialize();
  assert.deepEqual({ ...after, parameters: before.parameters }, before);
  assert.ok(simulation.sample(...point).hasFire, 'Previously visited source cells remain in geographic history');
  simulation.step(0.1, [stroke()]);
  assert.equal(simulation.sample(...point).extinguished, true, 'A shorter hold applies on the next advance without clearing existing progress');
});

test('reset retains timing settings, discards rain and heat changes, and reseeds the latest records', () => {
  const simulation = new RainSimulation({ fireReturnSeconds: 90, deepCoolingSeconds: 15 }).seed(source).step(30, [stroke()]);
  const parameters = simulation.parameters;
  simulation.seed([{ longitude: 120, latitude: -3 }]);
  simulation.reset();
  assert.equal(simulation.totalWater, 0);
  assert.equal(simulation.cells.size, 1);
  assert.equal(simulation.sample(120, -3).heat, 1);
  assert.equal(simulation.sample(...point).hasFire, false);
  assert.equal(simulation.sample(120, -3).moisture, 0);
  assert.deepEqual(simulation.parameters, parameters);
});

test('snapshot refresh counts only current source patches while retaining geographic history', () => {
  const simulation = new RainSimulation().seed(source).step(30, [stroke()]);
  const retainedMoisture = simulation.sample(...point).moisture;
  simulation.seed([{ longitude: 125, latitude: -3 }]);
  assert.equal(simulation.stats().fireCells, 1);
  assert.equal(simulation.stats().extinguishedCells, 0);
  assert.equal(simulation.sample(...point).moisture, retainedMoisture);
  assert.equal(simulation.sample(...point).hasFire, true);
  simulation.seed(source);
  assert.equal(simulation.stats().fireCells, 1);
  assert.equal(simulation.sample(...point).moisture, retainedMoisture);
});

test('version 3 snapshots round-trip parameters and state through JSON and reject invalid payloads atomically', () => {
  const original = new RainSimulation({ fireReturnSeconds: 90, rainResponseSeconds: 1, deepCoolingSeconds: 15, extinctionHoldSeconds: 0 }).seed(source).step(12, [stroke()]);
  const payload = JSON.parse(JSON.stringify(original.serialize()));
  assert.equal(payload.schemaVersion, 3);
  assert.deepEqual(payload.parameters, original.parameters);
  const restored = new RainSimulation();
  assert.ok(restored.restore(payload));
  assert.deepEqual(restored.serialize(), original.serialize());
  payload.cells[0].moisture = 0;
  assert.notEqual(restored.sample(...point).moisture, 0);
  const before = restored.serialize();
  const incompleteParameters = { ...before.parameters }; delete incompleteParameters.deepCoolingSeconds;
  const bad = [null, {}, { ...before, totalWater: -1 }, { ...before, cells: [{ ...before.cells[0], heat: Infinity }] }, { ...before, cells: [{ ...before.cells[0], longitude: 190 }] }, { ...before, cells: [{ ...before.cells[0], longitude: 110.1 }] }, { ...before, cells: [before.cells[0], before.cells[0]] }, { ...before, parameters: undefined }, { ...before, parameters: incompleteParameters }, { ...before, parameters: { ...before.parameters, deepCoolingSeconds: 241 } }, { ...before, parameters: { ...before.parameters, rainResponseSeconds: Infinity } }, { ...before, parameters: { ...before.parameters, extra: 1 } }];
  for (const value of bad) {
    assert.equal(restored.restore(value), false);
    assert.deepEqual(restored.serialize(), before);
  }
});

test('version 1 saved state migrates to current defaults while preserving the performance', () => {
  const original = new RainSimulation({ fireReturnSeconds: 90, rainResponseSeconds: 20 }).seed(source).step(12, [stroke()]);
  const legacy = original.serialize();
  legacy.schemaVersion = 1;
  delete legacy.parameters;
  const restored = new RainSimulation({ fireReturnSeconds: 3, deepCoolingSeconds: 15 });
  assert.equal(restored.restore(legacy), true);
  assert.deepEqual(restored.parameters, DEFAULT_PARAMETERS);
  assert.deepEqual(restored.serialize(), { ...legacy, schemaVersion: 3, parameters: { ...DEFAULT_PARAMETERS } });
});

test('out patches survive a shorter hold setting and restoration with their original settled duration', () => {
  const simulation = new RainSimulation({ extinctionHoldSeconds: 20 }).seed(source).step(50, [stroke()]);
  assert.equal(simulation.sample(...point).extinguished, true);
  assert.equal(simulation.sample(...point).settledFor, 20);
  assert.equal(simulation.setParameters({ extinctionHoldSeconds: 0 }), true);
  const payload = JSON.parse(JSON.stringify(simulation.serialize()));
  const restored = new RainSimulation();
  assert.equal(restored.restore(payload), true);
  assert.deepEqual(restored.serialize(), simulation.serialize());
  restored.advanceDry(86400);
  assert.equal(restored.sample(...point).extinguished, true);
  assert.equal(restored.sample(...point).heat, 0);
});

test('domain edge discards water outside the grid instead of increasing edge rainfall', () => {
  const interior = new RainSimulation().step(1, [stroke()]);
  const edge = new RainSimulation().step(1, [{ from: [94, -2.125], to: [94, -2.125], strength: 1 }]);
  close(interior.totalWater, edge.totalWater);
  for (const cell of edge.cells.values()) assert.ok(cell.longitude >= 94 && cell.longitude < 142 && cell.latitude >= -12 && cell.latitude < 7);
  close(edge.sample(94.125, -2.125).moisture, interior.sample(...point).moisture);
});

test('ordinary half-strength stationary holds achieve lasting out within the rehearsal targets', () => {
  const minimum = Object.fromEntries(Object.entries(PARAMETER_LIMITS).map(([key, value]) => [key, value.min]));
  for (const [parameters, strength, before, after] of [[DEFAULT_PARAMETERS, .5, 24.5, 24.6], [minimum, .5, 5.4, 5.5], [minimum, .1, 11.9, 12]]) {
    const simulation = new RainSimulation(parameters).seed(source).step(before, [stroke(strength)]);
    assert.equal(simulation.sample(...point).extinguished, false);
    simulation.step(after - before, [stroke(strength)]);
    assert.equal(simulation.sample(...point).extinguished, true);
    close(simulation.totalWater, expectedBudget(after * strength));
    simulation.advanceDry(86400);
    assert.equal(simulation.sample(...point).extinguished, true);
    assert.equal(simulation.sample(...point).heat, 0);
    const restored = new RainSimulation();
    assert.ok(restored.restore(JSON.parse(JSON.stringify(simulation.serialize()))));
    restored.seed(source);
    assert.equal(restored.sample(...point).extinguished, true);
    restored.reset();
    assert.equal(restored.sample(...point).extinguished, false);
    assert.equal(restored.sample(...point).heat, 1);
  }
});

test('fractional wet and cool threshold settlement is invariant across coarse and irregular frames', () => {
  for (const parameters of [DEFAULT_PARAMETERS, { ...DEFAULT_PARAMETERS, deepCoolingSeconds: 2 }, { ...DEFAULT_PARAMETERS, deepCoolingSeconds: 2, extinctionHoldSeconds: 0 }]) {
    for (const duration of [5.43, 12.03, 23.73, 24.59]) {
      const coarse = new RainSimulation(parameters).seed(source).step(duration, [stroke(0.5)]);
      const fine = new RainSimulation(parameters).seed(source);
      let remaining = duration, index = 0;
      while (remaining > 1e-12) {
        const seconds = Math.min(remaining, [1 / 60, .039, .113, .007][index++ % 4]);
        fine.step(seconds, [stroke(0.5)]);
        remaining -= seconds;
      }
      for (const name of ['moisture', 'surfaceWetness', 'heat', 'settledFor']) close(coarse.sample(...point)[name], fine.sample(...point)[name], 1e-8);
      assert.equal(coarse.sample(...point).extinguished, fine.sample(...point).extinguished);
      close(coarse.totalWater, fine.totalWater, 1e-7);
    }
  }
});

test('released unfinished ground retains moisture but authoritatively recovers heat without adding water', () => {
  const fastReturn = new RainSimulation({ fireReturnSeconds: 3 }).seed(source).step(2, [stroke(0.5)]);
  const slowReturn = new RainSimulation({ fireReturnSeconds: 90 }).seed(source).step(2, [stroke(0.5)]);
  const wet = fastReturn.sample(...point), water = fastReturn.totalWater;
  fastReturn.advanceDry(15); slowReturn.advanceDry(15);
  const dry = fastReturn.sample(...point);
  close(dry.moisture, wet.moisture * Math.exp(-15 / 180));
  assert.ok(dry.moisture > 0.1);
  assert.ok(dry.heat > wet.heat);
  assert.ok(surfaceActivity(dry) > surfaceActivity(slowReturn.sample(...point)));
  assert.equal(dry.extinguished, false);
  close(fastReturn.totalWater, water);
  assert.ok(dry.heat > slowReturn.sample(...point).heat);
});

test('partially covered brush-edge fire responds in proportion to coverage, and overlap adds only its fixed budget', () => {
  const edgePoint = [point[0] + .75, point[1] + .5];
  const records = [...source, { longitude: edgePoint[0], latitude: edgePoint[1] }];
  const single = new RainSimulation().seed(records).step(2, [stroke(.5)]);
  const overlap = new RainSimulation().seed(records).step(2, [stroke(.5), stroke(.5)]);
  assert.ok(single.sample(...edgePoint).moisture < single.sample(...point).moisture);
  assert.ok(single.sample(...edgePoint).heat > single.sample(...point).heat);
  assert.equal(single.sample(...edgePoint).extinguished, false);
  assert.ok(overlap.sample(...edgePoint).heat < single.sample(...edgePoint).heat);
  close(overlap.totalWater, 2 * single.totalWater);
});

test('short and soaked unfinished holds recover after release instead of finishing extinction unattended', () => {
  const tap = new RainSimulation().seed(source).step(.5, [stroke(.5)]);
  const tappedWater = tap.totalWater;
  tap.advanceDry(3600);
  assert.equal(tap.sample(...point).extinguished, false);
  close(tap.totalWater, tappedWater);
  const soaked = new RainSimulation().seed(source).step(2.5, [stroke(.5)]);
  assert.equal(soaked.sample(...point).extinguished, false);
  assert.ok(soaked.sample(...point).heat > .8);
  const soakedWater = soaked.totalWater;
  soaked.advanceDry(40);
  assert.equal(soaked.sample(...point).extinguished, false);
  assert.ok(soaked.sample(...point).heat > .99);
  close(soaked.totalWater, soakedWater);
});

test('default recovery visibly restores unfinished patches within four seconds after short holds', () => {
  for (const holdSeconds of [1, 5]) {
    const simulation = new RainSimulation().seed(source).step(holdSeconds, [stroke(.5)]);
    const wet = simulation.sample(...point), water = simulation.totalWater;
    assert.equal(wet.extinguished, false);
    simulation.advanceDry(4);
    const returning = simulation.sample(...point);
    close(returning.heat, wet.heat + (1 - wet.heat) / 2);
    assert.ok(surfaceActivity(returning) > .4, 'The shared state itself restores clearly visible surface activity.');
    assert.ok(returning.moisture > .8 * wet.moisture, 'Moisture history is retained without suppressing recovery.');
    assert.equal(returning.extinguished, false); assert.equal(returning.settledFor, 0);
    close(simulation.totalWater, water);
  }
});

test('release cancels near-complete settlement even with zero-hold timing and preserves nonfire and out cells', () => {
  for (const extinctionHoldSeconds of [0, 4]) {
    const simulation = withCellState({ extinctionHoldSeconds }, { surfaceWetness: 1, moisture: .99, heat: .1, settledFor: Math.max(0, extinctionHoldSeconds - .01) });
    simulation.advanceDry(.05);
    const released = simulation.sample(...point);
    assert.equal(released.extinguished, false); assert.equal(released.settledFor, 0); assert.ok(released.heat > .1);
  }
  const blank = new RainSimulation().step(1, [stroke(.5)]);
  blank.advanceDry(60);
  assert.ok([...blank.cells.values()].every(cell => !cell.hasFire && cell.heat === 0 && !cell.extinguished));
  const out = new RainSimulation().seed(source).step(30, [stroke()]);
  assert.equal(out.sample(...point).extinguished, true);
  const restored = new RainSimulation(); assert.ok(restored.restore(JSON.parse(JSON.stringify(out.serialize()))));
  restored.seed(source).advanceDry(86400);
  assert.equal(restored.sample(...point).heat, 0); assert.equal(restored.sample(...point).extinguished, true);
});

test('schema 2 stock defaults and fast endpoints migrate once while cells and bespoke numeric settings survive', () => {
  const original = withCellState({}, { surfaceWetness: .7, moisture: .9, heat: .12, settledFor: 3 }).serialize();
  for (const [oldParameters, expected] of [
    [{ fireReturnSeconds: 25, rainResponseSeconds: 4, deepCoolingSeconds: 90, extinctionHoldSeconds: 20 }, DEFAULT_PARAMETERS],
    [{ fireReturnSeconds: 3, rainResponseSeconds: 1, deepCoolingSeconds: 15, extinctionHoldSeconds: 0 }, { fireReturnSeconds: 3, rainResponseSeconds: .5, deepCoolingSeconds: 2, extinctionHoldSeconds: 0 }],
    [{ fireReturnSeconds: 17.5, rainResponseSeconds: 2.5, deepCoolingSeconds: 37, extinctionHoldSeconds: 7 }, { fireReturnSeconds: 17.5, rainResponseSeconds: 2.5, deepCoolingSeconds: 37, extinctionHoldSeconds: 7 }],
    [{ fireReturnSeconds: 90, rainResponseSeconds: 20, deepCoolingSeconds: 240, extinctionHoldSeconds: 60 }, { fireReturnSeconds: 90, rainResponseSeconds: 20, deepCoolingSeconds: 240, extinctionHoldSeconds: 60 }],
  ]) {
    const legacy = { ...original, schemaVersion: 2, parameters: oldParameters, totalWater: 1234.567 };
    const restored = new RainSimulation();
    assert.ok(restored.restore(legacy));
    assert.deepEqual(restored.serialize(), { ...legacy, schemaVersion: 3, parameters: expected });
    const again = new RainSimulation();
    assert.ok(again.restore(restored.serialize()));
    assert.deepEqual(again.serialize(), restored.serialize());
  }
  // The same numeric values deliberately chosen in the new schema are valid
  // custom settings and must not be mistaken for a second legacy migration.
  const current = { ...original, parameters: { fireReturnSeconds: 25, rainResponseSeconds: 4, deepCoolingSeconds: 90, extinctionHoldSeconds: 20 } };
  const restored = new RainSimulation();
  assert.ok(restored.restore(current));
  assert.deepEqual(restored.serialize(), current);
  for (const parameters of [{ ...current.parameters, deepCoolingSeconds: 2 }, { ...current.parameters, rainResponseSeconds: .5 }]) {
    assert.equal(restored.restore({ ...current, schemaVersion: 2, parameters }), false, 'Legacy validation uses the old parameter limits');
  }
});

function areaFixture(center, predicate = () => true) {
  const records = [];
  for (let x = Math.floor((center[0] - BRUSH_RADIUS) / CELL_SIZE); x <= Math.floor((center[0] + BRUSH_RADIUS) / CELL_SIZE); x += 1) {
    for (let y = Math.floor((center[1] - BRUSH_RADIUS) / CELL_SIZE); y <= Math.floor((center[1] + BRUSH_RADIUS) / CELL_SIZE); y += 1) {
      const longitude = (x + 0.5) * CELL_SIZE, latitude = (y + 0.5) * CELL_SIZE;
      if (predicate(longitude, latitude)) records.push({ longitude, latitude });
    }
  }
  return new RainSimulation().seed(records);
}

test('area sampling recovers a known uniform field and never mutates it', () => {
  const simulation = areaFixture(point);
  for (const cell of simulation.cells.values()) Object.assign(cell, { surfaceWetness: 0.35, moisture: 0.65, heat: 0.8 });
  const before = simulation.serialize();
  const area = simulation.sampleArea(...point);
  close(area.surfaceWetness, 0.35);
  close(area.moisture, 0.65);
  close(area.heat, 0.8);
  close(area.fireFraction, 1);
  close(area.coveredFraction, 1);
  assert.ok(area.cellCount > 1);
  assert.deepEqual(simulation.serialize(), before);
  area.moisture = 0;
  assert.equal(simulation.sample(...point).moisture, 0.65);
});

test('area sampling includes missing dry cells instead of averaging only fire cells', () => {
  const simulation = new RainSimulation().seed(source);
  const before = simulation.serialize();
  const area = simulation.sampleArea(...point);
  close(area.heat, 1 / (Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2));
  close(area.fireFraction, area.heat);
  assert.equal(simulation.sample(...point).heat, 1);
  assert.ok(area.heat < 0.03);
  assert.deepEqual(simulation.serialize(), before);
});

test('a half-hot half-missing circle averages the area rather than the center cell', () => {
  const center = [110, -2.125];
  const simulation = areaFixture(center, longitude => longitude >= center[0]);
  const area = simulation.sampleArea(...center);
  close(area.heat, 0.5);
  close(area.fireFraction, 0.5);
  assert.equal(simulation.sample(...center).heat, 1);
});

test('area sampling weights partial edge cells even when their centers miss the circle', () => {
  const center = [110.2, -2.125];
  const hotBoundary = 111;
  const simulation = areaFixture(center, longitude => longitude >= hotBoundary);
  const distance = hotBoundary - center[0];
  const capArea = BRUSH_RADIUS ** 2 * Math.acos(distance / BRUSH_RADIUS) - distance * Math.sqrt(BRUSH_RADIUS ** 2 - distance ** 2);
  const area = simulation.sampleArea(...center);
  close(area.heat, capArea / (Math.PI * BRUSH_RADIUS ** 2));
  assert.ok(area.heat > 0);
  assert.equal(simulation.sample(...center).heat, 0);
  for (const cell of simulation.cells.values()) assert.ok(Math.hypot(cell.longitude - center[0], cell.latitude - center[1]) > BRUSH_RADIUS);
});

test('area sampling clips the model boundary and normalizes the covered half', () => {
  const center = [94, -2.125];
  const simulation = areaFixture(center);
  for (const cell of simulation.cells.values()) Object.assign(cell, { surfaceWetness: 0.3, moisture: 0.6 });
  const area = simulation.sampleArea(...center);
  close(area.coveredFraction, 0.5);
  close(area.surfaceWetness, 0.3);
  close(area.moisture, 0.6);
  close(area.heat, 1);
  close(area.fireFraction, 1);
  assert.ok(simulation.sampleArea(93.8, center[1]).coveredFraction > 0);
});

test('area sampling safely handles empty state, no overlap, and invalid coordinates', () => {
  const simulation = new RainSimulation();
  const empty = simulation.sampleArea(...point);
  close(empty.coveredFraction, 1);
  assert.ok(empty.cellCount > 0);
  assert.equal(empty.heat, 0);
  assert.equal(simulation.cells.size, 0);
  const zero = { surfaceWetness: 0, moisture: 0, heat: 0, coveredFraction: 0, cellCount: 0, fireFraction: 0, extinguishedFraction: 0 };
  for (const coordinates of [[80, 0], [180, 90], [NaN, 0], [110, Infinity], [181, 0], [110, 91], ['110', -2], [undefined, undefined]]) assert.deepEqual(simulation.sampleArea(...coordinates), zero);
  assert.equal(simulation.cells.size, 0);
});
