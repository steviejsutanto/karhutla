import test from 'node:test';
import assert from 'node:assert/strict';
import { stateFrame, statePacket, wireCellKey } from './wire-state.mjs';

const row = (longitude, moisture = 0) => [longitude, -2.125, moisture, moisture, 1, false, 0, true];
const frame = (revision, cells, epoch = 'a') => stateFrame({ type: 'state', epoch, simulation: { wireFormat: 'compact-v1', cells, totalWater: revision } }, revision);
const apply = (cells, packet) => {
  if (!packet.simulation.delta) cells.clear();
  for (const key of packet.simulation.removed) cells.delete(key);
  for (const value of packet.simulation.cells) cells.set(wireCellKey(value), value);
};

test('skipped frames coalesce all changes and removals relative to each display baseline', () => {
  const first = frame(1, [row(110.125), row(111.125)]);
  const intermediate = frame(2, [row(110.125, .2), row(111.125)]);
  const latest = frame(3, [row(110.125, .2), row(112.125, .4)]);
  const slow = statePacket(latest, first), fast = statePacket(latest, intermediate);
  assert.equal(slow.baseRevision, 1);
  assert.equal(fast.baseRevision, 2);
  assert.equal(slow.simulation.cells.length, 2);
  assert.equal(fast.simulation.cells.length, 1);
  for (const [baseline, delta] of [[first, slow], [intermediate, fast]]) {
    const cells = new Map(baseline.cells);
    apply(cells, delta);
    assert.deepEqual(cells, latest.cells);
  }
});

test('fresh display and reset epoch use full baseline, retaining even inactive remembered patches', () => {
  const old = frame(1, [row(110.125, .8), row(111.125)]);
  const reset = frame(2, [row(111.125)], 'reset');
  for (const previous of [null, old]) {
    const packet = statePacket(reset, previous);
    assert.equal(packet.baseRevision, null);
    assert.equal(packet.simulation.delta, false);
    assert.deepEqual(packet.simulation.cells, [row(111.125)]);
    const cells = new Map(old.cells);
    apply(cells, packet);
    assert.deepEqual(cells, reset.cells);
  }
});

test('unchanged frame carries settings and totals with no duplicate cell payload', () => {
  const first = frame(1, [row(110.125)]);
  const next = frame(2, [row(110.125)]);
  const packet = statePacket(next, first);
  assert.deepEqual(packet.simulation.cells, []);
  assert.equal(packet.simulation.totalWater, 2);
  assert.equal(first.state.simulation.cells.length, 1);
});
