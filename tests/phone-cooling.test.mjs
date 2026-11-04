import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneAtmosphere, phoneSpatialPatches } from '../app/join.js';
import { SharedRoom } from '../app/shared-room.mjs';

const summary = (heat, extra = {}) => ({ heat, fireCells: 10, extinguishedCells: 0, ...extra });
const records = [
  { longitude: 110.125, latitude: -2.125 },
  { longitude: 110.625, latitude: -2.125 },
];

async function fixture() {
  // Entirely in memory: these checks neither read nor write the live performance.
  const room = new SharedRoom({ records, snapshotVersion: 'phone-fixture-1', persistencePath: null, clock: () => 0 });
  await room.bootstrap({ state: null, strength: .5 });
  const welcome = room.connect({ clientId: 'phone-color-fixture' });
  return { room, welcome, packet: () => room.phoneState(welcome.connectionId) };
}

test('authoritative cooling progressively removes hot and warm layers', () => {
  const heats = [1, .85, .7, .5, .35, .2, .1, .01, 0];
  const appearances = heats.map(heat => phoneAtmosphere(summary(heat)));
  assert.equal(appearances[0].state, 'hot');
  assert.equal(appearances[4].state, 'cooling');
  assert.equal(appearances.at(-1).state, 'low');
  for (let i = 1; i < appearances.length; i += 1) {
    assert.ok(appearances[i].hot <= appearances[i - 1].hot, `hot layer increased at heat ${heats[i]}`);
    assert.ok(appearances[i].warm <= appearances[i - 1].warm, `warm layer increased at heat ${heats[i]}`);
  }
  assert.ok(appearances[0].hot > appearances[4].hot);
  assert.ok(appearances[4].warm > appearances.at(-1).warm);
  for (const appearance of appearances) {
    assert.ok(Number.isFinite(appearance.hot) && appearance.hot >= 0 && appearance.hot <= 1);
    assert.ok(Number.isFinite(appearance.warm) && appearance.warm >= 0 && appearance.warm <= 1);
  }
});

test('equal average heat is not reduced a second time by extinguished counts', () => {
  const allCooling = phoneAtmosphere(summary(.2));
  const mostOut = phoneAtmosphere(summary(.2, { extinguishedCells: 8 }));
  assert.deepEqual(mostOut, allCooling);
});

test('wetness, moisture, and active gestures cannot impersonate fire cooling', () => {
  const dry = phoneAtmosphere(summary(.8, { surfaceWetness: 0, moisture: 0, activeCount: 0 }));
  const pouring = phoneAtmosphere(summary(.8, { surfaceWetness: 1, moisture: 1, activeCount: 30 }));
  assert.deepEqual(pouring, dry);
});

test('zero or rounded near-zero heat retains an ember and never claims surviving patches are out', () => {
  for (const heat of [0, .00001, .0001]) {
    const appearance = phoneAtmosphere(summary(heat, { extinguishedCells: 9 }));
    assert.equal(appearance.state, 'low');
    assert.match(appearance.label, /patches remain/);
    assert.ok(appearance.warm > 0);
    assert.equal(appearance.hot, 0);
  }
});

test('empty snapshots and completed regions share quiet colors but have different meanings', () => {
  const empty = phoneAtmosphere(summary(0, { fireCells: 0, extinguishedCells: 0 }));
  const out = phoneAtmosphere(summary(0, { extinguishedCells: 10 }));
  assert.equal(empty.state, 'empty');
  assert.match(empty.label, /snapshot/);
  assert.equal(out.state, 'out');
  assert.match(out.label, /All fire patches out/);
  assert.notEqual(empty.label, out.label);
  for (const appearance of [empty, out]) assert.deepEqual([appearance.hot, appearance.warm], [0, 0]);
});

test('malformed summaries cannot become a successful extinction or invalid opacity', () => {
  const invalid = [
    null, undefined, {},
    summary(NaN), summary(Infinity), summary(-.01), summary(1.01), summary('0'),
    summary(0, { fireCells: -1 }), summary(0, { fireCells: .5 }),
    summary(0, { fireCells: Number.MAX_SAFE_INTEGER + 1 }),
    summary(0, { extinguishedCells: -1 }), summary(0, { extinguishedCells: 1.5 }),
    summary(0, { extinguishedCells: 11 }), summary(0, { extinguishedCells: '10' }),
    summary(.5, { fireCells: 0, extinguishedCells: 0 }),
  ];
  for (const value of invalid) assert.equal(phoneAtmosphere(value), null);
  const inconsistent = phoneAtmosphere(summary(.5, { extinguishedCells: 10 }));
  assert.notEqual(inconsistent.state, 'out');
  assert.ok(inconsistent.warm > 0);
});

test('real region summaries include extinguished zeroes without duplicating their reduction', async () => {
  const { room, packet } = await fixture();
  const cells = [...room.simulation.cells.values()].filter(cell => cell.hasFire);
  assert.equal(cells.length, 2);
  cells[0].heat = 0; cells[0].extinguished = true;
  cells[1].heat = .8;
  const message = packet();
  assert.equal(message.type, 'summary');
  assert.equal(message.region.fireCells, 2);
  assert.equal(message.region.extinguishedCells, 1);
  assert.equal(message.region.heat, .4);
  assert.deepEqual(phoneAtmosphere(message.region), phoneAtmosphere(summary(.4)));
  cells[1].heat = .00001;
  const rounded = packet();
  assert.equal(rounded.region.heat, 0);
  assert.equal(phoneAtmosphere(rounded.region).state, 'low');
});

test('real summaries return from out to hot after reset and reconnect without latching completion', async () => {
  const { room, welcome, packet } = await fixture();
  for (const cell of room.simulation.cells.values()) {
    cell.heat = 0; cell.extinguished = true;
  }
  assert.equal(phoneAtmosphere(packet().region).state, 'out');
  const oldEpoch = packet().epoch;
  await room.reset();
  assert.notEqual(packet().epoch, oldEpoch);
  const resetAppearance = phoneAtmosphere(packet().region);
  assert.equal(resetAppearance.state, 'hot');
  assert.ok(resetAppearance.hot > 0 && resetAppearance.warm > 0);
  room.disconnect(welcome.connectionId);
  const reconnected = room.connect({ clientId: 'phone-color-fixture' });
  assert.equal(reconnected.assignment.id, welcome.assignment.id);
  const next = room.phoneState(reconnected.connectionId);
  assert.deepEqual(phoneAtmosphere(next.region), resetAppearance);
  assert.equal(next.own.holding, false);
  assert.equal(room.simulation.totalWater, 0);
});

test('changed source snapshots replace the current regional meaning without retaining out or empty states', async () => {
  const { room, welcome, packet } = await fixture();
  for (const cell of room.simulation.cells.values()) {
    cell.heat = 0; cell.extinguished = true;
  }
  assert.equal(phoneAtmosphere(packet().region).state, 'out');
  room.seed([], 'phone-fixture-empty');
  assert.equal(packet().snapshotVersion, 'phone-fixture-empty');
  assert.equal(phoneAtmosphere(packet().region).state, 'empty');
  room.seed([{ longitude: 111.125, latitude: -2.125 }], 'phone-fixture-new');
  const next = packet();
  assert.equal(next.snapshotVersion, 'phone-fixture-new');
  assert.equal(next.assignment.id, welcome.assignment.id);
  assert.equal(next.region.fireCells, 1);
  assert.equal(next.region.extinguishedCells, 0);
  assert.equal(phoneAtmosphere(next.region).state, 'hot');
});

const field = (patches, rows = 4) => ({ format: 'land-rows-v1', rows, patches });

test('spatial patches occupy the exact normalized row and column fractions', () => {
  const patches = phoneSpatialPatches(field([
    ['north-west', 0, 0, 2, 1, false],
    ['south-east', 3, 2, 3, .3, false],
  ]));
  assert.deepEqual(patches.map(({ key, left, top, width, height }) => ({ key, left, top, width, height })), [
    { key: 'north-west', left: 0, top: 0, width: .5, height: .25 },
    { key: 'south-east', left: 2 / 3, top: .75, width: 1 / 3, height: .25 },
  ]);
  for (const patch of patches) {
    assert.ok(patch.left >= 0 && patch.top >= 0);
    assert.ok(patch.left + patch.width <= 1 && patch.top + patch.height <= 1);
  }
});

test('cooling one geographic patch leaves the unrelated patch hot', () => {
  const initial = phoneSpatialPatches(field([
    ['a', 1, 0, 2, 1, false], ['b', 1, 1, 2, 1, false],
  ]));
  const cooling = phoneSpatialPatches(field([
    ['a', 1, 0, 2, .15, false], ['b', 1, 1, 2, 1, false],
  ]));
  assert.ok(cooling[0].hot < initial[0].hot);
  assert.ok(cooling[0].warm < initial[0].warm);
  assert.deepEqual(cooling[1], initial[1]);
  const out = phoneSpatialPatches(field([
    ['a', 1, 0, 2, 0, true], ['b', 1, 1, 2, 1, false],
  ]));
  assert.equal(out[0].state, 'out');
  assert.deepEqual([out[0].hot, out[0].warm], [0, 0]);
  assert.deepEqual(out[1], initial[1]);
});

test('empty or replaced spatial layouts do not retain patches from an earlier snapshot', () => {
  const oldField = field([['old-fire', 1, 0, 2, 0, true]]);
  const prior = phoneSpatialPatches(oldField);
  assert.deepEqual(phoneSpatialPatches(field([])), []);
  const replacement = phoneSpatialPatches(field([['new-fire', 0, 1, 4, 1, false]], 2));
  assert.deepEqual(replacement.map(patch => patch.key), ['new-fire']);
  assert.equal(replacement[0].state, 'hot');
  assert.equal(replacement[0].top, 0);
  assert.equal(replacement[0].width, .25);
  assert.equal(replacement[0].height, .5);
  assert.deepEqual(phoneSpatialPatches(oldField), prior);
});

test('malformed spatial fields are rejected as a whole before they can paint invalid geometry', () => {
  const good = ['a', 0, 0, 2, .5, false];
  const invalid = [
    null, {}, { ...field([]), format: 'unknown' },
    field([], 0), field([], -1), field([], 513), field([], 2.5), field([], NaN),
    { ...field([]), patches: {} }, field(new Array(10001).fill(good)),
    field([good, good]), field([null]), field([good.slice(0, 5)]),
    field([[1, 0, 0, 2, .5, false]]),
    field([['a', -1, 0, 2, .5, false]]), field([['a', 4, 0, 2, .5, false]]),
    field([['a', .5, 0, 2, .5, false]]),
    field([['a', 0, -1, 2, .5, false]]), field([['a', 0, 2, 2, .5, false]]),
    field([['a', 0, .5, 2, .5, false]]),
    field([['a', 0, 0, 0, .5, false]]), field([['a', 0, 0, 513, .5, false]]),
    field([['a', 0, 0, 2.5, .5, false]]),
    field([['a', 0, 0, 2, NaN, false]]), field([['a', 0, 0, 2, 1.1, false]]),
    field([['a', 0, 0, 2, .5, 1]]),
  ];
  for (const value of invalid) assert.equal(phoneSpatialPatches(value), null);
});
