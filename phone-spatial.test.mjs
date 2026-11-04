import test from 'node:test';
import assert from 'node:assert/strict';
import { RegionCatalog, regionCellKey } from './regions.mjs';
import { RainSimulation, CELL_SIZE, BRUSH_RADIUS } from './simulation.js';
import { SharedRoom } from './shared-room.mjs';
import { phoneSpatialField, phoneBrushSummary } from './phone-spatial.mjs';

const close = (actual, expected, tolerance = .000051) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const record = ([longitude, latitude]) => ({ longitude, latitude });

function customCatalog(positions, firePositions = positions) {
  const cells = new Map(positions.map(point => [regionCellKey(...point), point]));
  const rowMap = new Map();
  for (const point of positions) {
    if (!rowMap.has(point[1])) rowMap.set(point[1], []);
    rowMap.get(point[1]).push(point);
  }
  const rows = [...rowMap.values()].sort((a, b) => b[0][1] - a[0][1]);
  for (const row of rows) row.sort((a, b) => a[0] - b[0]);
  const region = { cells, rows, fireKeys: new Set(firePositions.map(point => regionCellKey(...point))) };
  return { regions: new Map([['fixture', region]]) };
}

function stateMap(values) {
  return { cells: new Map(values.map(({ position, ...value }) => [regionCellKey(...position), { surfaceWetness: 0, moisture: 0, heat: 0, extinguished: false, ...value }])) };
}

test('integer spatial rectangles exactly invert all occupied land cells in all seven masks', () => {
  const initial = new RegionCatalog();
  const records = [...initial.regions.values()].flatMap(region => [...region.cells.values()].map(record));
  const catalog = new RegionCatalog(records);
  const simulation = new RainSimulation().seed(records);
  for (const [id, region] of catalog.regions) {
    const field = phoneSpatialField(catalog, id, simulation);
    assert.equal(field.format, 'land-rows-v1');
    assert.equal(field.rows, region.rows.length);
    assert.equal(field.patches.length, region.fireKeys.size);
    for (const [key, row, column, columns, heat, out] of field.patches) {
      assert.equal(regionCellKey(...catalog.map(id, [(column + .5) / columns, (row + .5) / field.rows])), key);
      assert.equal(regionCellKey(...catalog.map(id, [(column + .01) / columns, (row + .99) / field.rows])), key);
      assert.equal(heat, 1);
      assert.equal(out, false);
    }
  }
});

test('top-right and bottom-left patches cool independently at their real input locations', () => {
  const catalog = new RegionCatalog();
  const top = catalog.map('kalimantan', [.9, .1]);
  const bottom = catalog.map('kalimantan', [.1, .9]);
  const records = [top, bottom].map(record);
  catalog.seed(records);
  const simulation = new RainSimulation().seed(records);
  const hot = phoneSpatialField(catalog, 'kalimantan', simulation);
  simulation.cells.get(regionCellKey(...top)).heat = .35;
  const next = phoneSpatialField(catalog, 'kalimantan', simulation);
  const topPatch = next.patches.find(patch => patch[0] === regionCellKey(...top));
  const bottomPatch = next.patches.find(patch => patch[0] === regionCellKey(...bottom));
  assert.ok((topPatch[2] + .5) / topPatch[3] > .8);
  assert.ok((topPatch[1] + .5) / next.rows < .2);
  assert.ok((bottomPatch[2] + .5) / bottomPatch[3] < .2);
  assert.ok((bottomPatch[1] + .5) / next.rows > .8);
  assert.equal(topPatch[4], .35);
  assert.equal(bottomPatch[4], 1);
  assert.equal(hot.patches.find(patch => patch[0] === topPatch[0])[4], 1, 'earlier packet is not mutated');
  close(phoneBrushSummary(catalog, 'kalimantan', simulation, top).heat, .35);
  close(phoneBrushSummary(catalog, 'kalimantan', simulation, bottom).heat, 1);
});

test('phone sound receives each source patch moisture without inventing cooling from touch', () => {
  const positions = [[110.125, -2.125], [110.375, -2.125]];
  const catalog = customCatalog(positions);
  const simulation = stateMap([
    { position: positions[0], heat: 1, surfaceWetness: .9, moisture: .876543 },
    { position: positions[1], heat: .3, surfaceWetness: .1, moisture: .123456 },
  ]);
  const before = JSON.stringify([...simulation.cells]);
  const field = phoneSpatialField(catalog, 'fixture', simulation);
  assert.deepEqual(field.patches.map(row => row.slice(4)), [[1, false, .9, .8765], [.3, false, .1, .1235]]);
  assert.equal(JSON.stringify([...simulation.cells]), before);
});

test('local averages include uninstantiated assigned land and exclude neighboring islands and ocean', () => {
  const positions = [[-.125, -.125], [.125, -.125], [-.125, .125], [.125, .125]];
  const catalog = customCatalog(positions, [positions[0], positions[1]]);
  const simulation = stateMap([
    { position: positions[0], surfaceWetness: 1, moisture: .8, heat: 0, extinguished: true },
    { position: positions[1], surfaceWetness: .2, moisture: .4, heat: .6 },
    { position: [.375, .125], surfaceWetness: 1, moisture: 1, heat: 1 },
  ]);
  const summary = phoneBrushSummary(catalog, 'fixture', simulation, [.125, .125]);
  close(summary.surfaceWetness, .3); // 1.2 / four equal-area land cells
  close(summary.moisture, .3);
  close(summary.heat, .3); // extinguished zero plus active .6, fire-only area
  assert.equal(summary.fireCells, 2);
  assert.equal(summary.extinguishedCells, 1);
});

test('partial circular overlap is area-weighted and uses the simulation brush radius', () => {
  const center = [110.125, -2.125];
  const edge = [center[0] + .75, center[1]];
  const catalog = customCatalog([center, edge]);
  const simulation = stateMap([
    { position: center, surfaceWetness: 1, moisture: 0, heat: 1 },
    { position: edge, surfaceWetness: 0, moisture: 1, heat: 0, extinguished: true },
  ]);
  // Independent numerical area reference (midpoint quadrature), rather than
  // mirroring the analytic primitive in the production measurement helper.
  const slices = 20000;
  const half = CELL_SIZE / 2;
  let edgeArea = 0;
  for (let i = 0; i < slices; i += 1) {
    const y = -half + (i + .5) * CELL_SIZE / slices;
    const right = Math.sqrt(BRUSH_RADIUS ** 2 - y ** 2);
    edgeArea += Math.max(0, Math.min(.75 + half, right) - (.75 - half)) * CELL_SIZE / slices;
  }
  const centerArea = CELL_SIZE ** 2;
  const summary = phoneBrushSummary(catalog, 'fixture', simulation, center);
  close(summary.surfaceWetness, centerArea / (centerArea + edgeArea));
  close(summary.moisture, edgeArea / (centerArea + edgeArea));
  close(summary.heat, centerArea / (centerArea + edgeArea));
  assert.notEqual(summary.heat, .5, 'partly covered edge patch must not count as a full cell');
});

test('no source fire under the brush yields zero heat without inventing extinguished patches', () => {
  const positions = [[.125, .125], [.375, .125]];
  const catalog = customCatalog(positions, []);
  const simulation = stateMap([{ position: positions[0], surfaceWetness: .4, moisture: .8, heat: 1, extinguished: true }]);
  const summary = phoneBrushSummary(catalog, 'fixture', simulation, positions[0]);
  assert.deepEqual(summary, { surfaceWetness: .2, moisture: .4, heat: 0, fireCells: 0, extinguishedCells: 0 });
});

test('reset, source changes and new heat update cached layouts and state without latching out', () => {
  const catalog = new RegionCatalog();
  const top = catalog.map('kalimantan', [.9, .1]);
  const bottom = catalog.map('kalimantan', [.1, .9]);
  const records = [top].map(record);
  catalog.seed(records);
  const simulation = new RainSimulation().seed(records);
  const firstKey = regionCellKey(...top);
  const cell = simulation.cells.get(firstKey);
  cell.extinguished = true; cell.heat = 0;
  assert.deepEqual(phoneSpatialField(catalog, 'kalimantan', simulation).patches[0].slice(4, 6), [0, true]);
  assert.equal(phoneBrushSummary(catalog, 'kalimantan', simulation, top).extinguishedCells, 1);
  simulation.reset();
  assert.deepEqual(phoneSpatialField(catalog, 'kalimantan', simulation).patches[0].slice(4, 6), [1, false]);
  catalog.seed([]); simulation.seed([]);
  assert.equal(phoneSpatialField(catalog, 'kalimantan', simulation).patches.length, 0);
  assert.equal(phoneBrushSummary(catalog, 'kalimantan', simulation, top).fireCells, 0);
  const newRecords = [bottom].map(record);
  catalog.seed(newRecords); simulation.seed(newRecords);
  const fresh = phoneSpatialField(catalog, 'kalimantan', simulation);
  assert.equal(fresh.patches.length, 1);
  assert.equal(fresh.patches[0][0], regionCellKey(...bottom));
  assert.deepEqual(fresh.patches[0].slice(4, 6), [1, false]);
  assert.equal(phoneBrushSummary(catalog, 'kalimantan', simulation, bottom).fireCells, 1);
});

test('measurement functions never step, seed, create cells or change water and geographic state', () => {
  const catalog = new RegionCatalog();
  const position = catalog.map('kalimantan', [.6, .4]);
  const records = [position].map(record);
  catalog.seed(records);
  const simulation = new RainSimulation().seed(records);
  simulation.step(.3, [{ path: [position], strength: .5, constraint: catalog.regions.get('kalimantan').constraint }]);
  const before = JSON.stringify(simulation.serialize());
  for (let i = 0; i < 300; i += 1) {
    phoneSpatialField(catalog, 'kalimantan', simulation);
    phoneBrushSummary(catalog, 'kalimantan', simulation, catalog.map('kalimantan', [i / 300, .4]));
  }
  assert.equal(JSON.stringify(simulation.serialize()), before);
});

test('invalid assignments and positions return no local measurement', () => {
  const catalog = new RegionCatalog();
  const simulation = new RainSimulation();
  assert.equal(phoneSpatialField(catalog, 'unknown', simulation), null);
  for (const position of [null, [], [1], [NaN, 0], [Infinity, 1], [0, 0], ['110', -2]]) {
    assert.equal(phoneBrushSummary(catalog, 'kalimantan', simulation, position), null);
  }
});


async function roomFixture() {
  const catalog = new RegionCatalog();
  const top = catalog.map('kalimantan', [.9, .1]);
  const bottom = catalog.map('kalimantan', [.1, .9]);
  const room = new SharedRoom({ records: [top, bottom].map(record), snapshotVersion: 'spatial-room-fixture', persistencePath: null, clock: () => 0 });
  await room.bootstrap();
  await room.setScene({ scene: 'participation' });
  const first = room.connect({ clientId: 'spatial-room-first' });
  const others = Array.from({ length: 7 }, (_, index) => room.connect({ clientId: `spatial-room-${index}` }));
  const sameIsland = others.find(welcome => welcome.assignment.id === first.assignment.id);
  assert.equal(first.assignment.id, 'kalimantan');
  assert.ok(sameIsland);
  room.simulation.cells.get(regionCellKey(...top)).heat = .25;
  room.simulation.cells.get(regionCellKey(...bottom)).heat = .8;
  const hold = (seq, holding, position = [.9, .1]) => room.hold(first.connectionId, {
    type: 'hold', epoch: room.epoch, seq, holding, start: holding, space: 'region', position,
  });
  return { room, first, sameIsland, top, bottom, hold };
}

test('SharedRoom shares the assigned spatial field while keeping held focus participant-specific', async () => {
  const { room, first, sameIsland, hold } = await roomFixture();
  assert.equal(room.phoneState(first.connectionId).focus, null);
  hold(1, true);
  const cache = new Map();
  const firstState = room.phoneState(first.connectionId, cache);
  const otherState = room.phoneState(sameIsland.connectionId, cache);
  assert.equal(firstState.region, otherState.region);
  assert.equal(firstState.region.spatial, otherState.region.spatial);
  assert.equal(cache.size, 1);
  assert.equal(firstState.region.spatial.format, 'land-rows-v1');
  assert.equal(firstState.region.spatial.patches.length, 2);
  assert.deepEqual(firstState.focus.position, [.9, .1]);
  assert.equal(firstState.focus.seq, 1);
  assert.equal(firstState.focus.heat, .25);
  assert.equal(otherState.focus, null);
  assert.equal(firstState.simulation, undefined);
  assert.equal(firstState.participants, undefined);
});

test('SharedRoom updates focus on motion and clears it on release, reset and reconnect', async () => {
  const { room, first, hold } = await roomFixture();
  hold(1, true);
  assert.equal(room.phoneState(first.connectionId).focus.heat, .25);
  hold(2, true, [.1, .9]);
  const moved = room.phoneState(first.connectionId).focus;
  assert.deepEqual(moved.position, [.1, .9]);
  assert.equal(moved.seq, 2);
  assert.equal(moved.heat, .8);
  hold(3, false, [.1, .9]);
  assert.equal(room.phoneState(first.connectionId).focus, null);
  hold(4, true);
  const oldEpoch = room.epoch;
  await room.reset();
  await room.setScene({ scene: 'participation' });
  assert.notEqual(room.epoch, oldEpoch);
  assert.equal(room.phoneState(first.connectionId).focus, null);
  assert.ok(room.phoneState(first.connectionId).region.spatial.patches.every(patch => patch[4] === 1 && patch[5] === false));
  hold(1, true);
  room.disconnect(first.connectionId);
  const rejoined = room.connect({ clientId: 'spatial-room-first' });
  assert.equal(rejoined.assignment.id, first.assignment.id);
  assert.equal(room.phoneState(rejoined.connectionId).focus, null);
  assert.equal(room.phoneState(rejoined.connectionId).own.holding, false);
});

test('SharedRoom spatial and focus reads do not spend water or alter simulation state', async () => {
  const { room, first, sameIsland, hold } = await roomFixture();
  hold(1, true);
  const before = JSON.stringify(room.simulation.serialize());
  const beforeOwn = JSON.stringify(room.actorState());
  for (let i = 0; i < 100; i += 1) {
    const cache = new Map();
    room.phoneState(first.connectionId, cache);
    room.phoneState(sameIsland.connectionId, cache);
  }
  assert.equal(JSON.stringify(room.simulation.serialize()), before);
  assert.equal(JSON.stringify(room.actorState()), beforeOwn);
  assert.equal(room.simulation.totalWater, 0);
});
