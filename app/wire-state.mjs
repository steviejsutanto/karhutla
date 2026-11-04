import { CELL_SIZE } from './simulation.js';

export const wireCellKey = row => `${Math.floor(row[0] / CELL_SIZE)},${Math.floor(row[1] / CELL_SIZE)}`;
const equalRow = (a, b) => a && a.length === b.length && b.every((value, index) => value === a[index]);

// Frames are immutable shared baselines. A slow display diffs from its own last
// sent frame, so skipping intermediate updates never loses a cell change.
export function stateFrame(state, revision) {
  return { state, revision, cells: new Map(state.simulation.cells.map(row => [wireCellKey(row), row])) };
}

export function statePacket(frame, previous = null) {
  const full = !previous || previous.state.epoch !== frame.state.epoch;
  const cells = full ? frame.state.simulation.cells : [];
  const removed = [];
  if (!full) {
    for (const [key, row] of frame.cells) if (!equalRow(previous.cells.get(key), row)) cells.push(row);
    for (const key of previous.cells.keys()) if (!frame.cells.has(key)) removed.push(key);
  }
  return { ...frame.state, revision: frame.revision, baseRevision: full ? null : previous.revision,
    simulation: { ...frame.state.simulation, delta: !full, cells, removed } };
}
