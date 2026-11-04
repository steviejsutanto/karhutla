// The national phone view uses one ordinary geographic rectangle. Unlike the
// legacy island-row instrument, it preserves the sea gaps between islands.
// This module is server-only; it never advances or predicts the simulation.
import { CELL_SIZE } from './simulation.js';
import { normalizedPositionValid, regionCellKey } from './regions.mjs';

export const COUNTRY_BOUNDS = Object.freeze({ west: 94, east: 142, north: 7, south: -12 });
export const COUNTRY_ASSIGNMENT = Object.freeze({ id: 'indonesia', name: 'Indonesia' });
const round = value => Math.round(value * 10000) / 10000;
const inside = position => [
  Math.max(COUNTRY_BOUNDS.west, Math.min(COUNTRY_BOUNDS.east - .0001, position[0])),
  Math.max(COUNTRY_BOUNDS.south, Math.min(COUNTRY_BOUNDS.north - .0001, position[1])),
];

export function countryPosition(point) {
  if (!normalizedPositionValid(point)) return null;
  return inside([
    COUNTRY_BOUNDS.west + point[0] * (COUNTRY_BOUNDS.east - COUNTRY_BOUNDS.west),
    COUNTRY_BOUNDS.north - point[1] * (COUNTRY_BOUNDS.north - COUNTRY_BOUNDS.south),
  ]);
}

export class NationalSpace {
  constructor(catalog) {
    this.catalog = catalog;
    this.constraint = {
      allows: (longitude, latitude) => this.cells.has(regionCellKey(longitude, latitude)),
      // The cloud remains over the requested geographic position, including
      // sea. Never redirect its rain to a distant island.
      project: position => inside(position),
    };
    this.refresh();
  }

  refresh() {
    this.cells = new Map();
    this.fireKeys = new Set();
    for (const region of this.catalog.regions.values()) {
      for (const [key, position] of region.cells) this.cells.set(key, position);
      for (const key of region.fireKeys) this.fireKeys.add(key);
    }
    this.sourcePatches = [...this.fireKeys].map(key => Object.freeze([key, ...this.cells.get(key)]));
  }

  layout(snapshotVersion = null) {
    return {
      ...COUNTRY_ASSIGNMENT, format: 'country-v1', bounds: COUNTRY_BOUNDS,
      cellSize: CELL_SIZE, fireKeys: [...this.fireKeys], landKeys: [...this.cells.keys()], patches: this.sourcePatches,
      snapshotVersion,
    };
  }

  spatial(simulation) {
    return {
      format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: CELL_SIZE,
      patches: this.sourcePatches.map(([key, longitude, latitude]) => {
        const cell = simulation.cells.get(key);
        return [key, longitude, latitude, round(cell?.heat ?? 0), Boolean(cell?.extinguished), round(cell?.surfaceWetness ?? 0), round(cell?.moisture ?? 0)];
      }),
    };
  }

  summary(simulation, connections) {
    const summary = { surfaceWetness: 0, moisture: 0, heat: 0, fireCells: this.fireKeys.size, extinguishedCells: 0, activeCount: 0 };
    for (const key of this.cells.keys()) {
      const cell = simulation.cells.get(key);
      if (!cell) continue;
      summary.surfaceWetness += cell.surfaceWetness;
      summary.moisture += cell.moisture;
      if (this.fireKeys.has(key)) {
        summary.heat += cell.heat;
        if (cell.extinguished) summary.extinguishedCells++;
      }
    }
    summary.surfaceWetness /= Math.max(1, this.cells.size);
    summary.moisture /= Math.max(1, this.cells.size);
    summary.heat /= Math.max(1, this.fireKeys.size);
    for (const participant of connections.values()) if (participant.role === 'participant' && participant.holding) summary.activeCount++;
    return summary;
  }
}
