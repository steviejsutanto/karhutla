// Server-only island masks. A region is a set of the simulation's geographic
// patches touching the generalized Indonesian land boundary, not a new map.
import { readFileSync } from 'node:fs';
import { CELL_SIZE } from './simulation.js';

export const REGION_DEFINITIONS = Object.freeze([
  { id: 'sumatra', name: 'Sumatra', color: '#bdcbb5' },
  { id: 'java', name: 'Java', color: '#c6c1a4' },
  { id: 'kalimantan', name: 'Kalimantan', color: '#abc1b2' },
  { id: 'sulawesi', name: 'Sulawesi', color: '#bac5ce' },
  { id: 'nusa-tenggara', name: 'Bali & Nusa Tenggara', color: '#d1c0a6' },
  { id: 'maluku', name: 'Maluku', color: '#c6bbcb' },
  { id: 'papua', name: 'Papua', color: '#b4c5bd' },
].map(Object.freeze));

export const regionCellKey = (longitude, latitude) => `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;
export const normalizedPositionValid = point => Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1);

// Island grouping, evaluated only for Indonesian land patches. These seams
// follow sea gaps; the land mask supplies the actual shoreline constraint.
export function islandGroup(longitude, latitude) {
  if (longitude >= 130.75) return 'papua';
  if (latitude < -6 && longitude >= 114.5) return 'nusa-tenggara';
  if (longitude >= 125) return 'maluku';
  if (longitude >= 118.5) return 'sulawesi';
  if (latitude < -5.5 && longitude >= 105) return 'java';
  if (longitude >= 108) return 'kalimantan';
  return 'sumatra';
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const land = JSON.parse(readFileSync(new URL('../data/indonesia.geojson', import.meta.url), 'utf8'));
const geometries = land.type === 'FeatureCollection' ? land.features.map(feature => feature.geometry) : [land.geometry || land];
const baseCells = new Map();
function addBase(longitude, latitude) {
  if (longitude < 94 || longitude >= 142 || latitude < -12 || latitude >= 7) return;
  const x = Math.floor(longitude / CELL_SIZE), y = Math.floor(latitude / CELL_SIZE);
  baseCells.set(`${x},${y}`, [(x + .5) * CELL_SIZE, (y + .5) * CELL_SIZE]);
}
for (const geometry of geometries) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  for (const polygon of polygons) {
    const outer = polygon[0];
    const west = Math.min(...outer.map(point => point[0])), east = Math.max(...outer.map(point => point[0]));
    const south = Math.min(...outer.map(point => point[1])), north = Math.max(...outer.map(point => point[1]));
    for (let x = Math.floor(west / CELL_SIZE); x <= Math.floor(east / CELL_SIZE); x += 1) {
      for (let y = Math.floor(south / CELL_SIZE); y <= Math.floor(north / CELL_SIZE); y += 1) {
        const longitude = (x + .5) * CELL_SIZE, latitude = (y + .5) * CELL_SIZE;
        if (insideRing(longitude, latitude, outer) && !polygon.slice(1).some(hole => insideRing(longitude, latitude, hole))) addBase(longitude, latitude);
      }
    }
    // Include shoreline patches and islands narrower than one grid cell.
    for (let i = 1; i < outer.length; i += 1) {
      const a = outer[i - 1], b = outer[i];
      const divisions = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL_SIZE / 3)));
      for (let step = 0; step <= divisions; step += 1) addBase(a[0] + (b[0] - a[0]) * step / divisions, a[1] + (b[1] - a[1]) * step / divisions);
    }
  }
}

export class RegionCatalog {
  constructor(records = []) {
    this.regions = new Map(REGION_DEFINITIONS.map(definition => [definition.id, { ...definition, cells: new Map(), rows: [], fireKeys: new Set() }]));
    for (const [key, position] of baseCells) this.regions.get(islandGroup(...position)).cells.set(key, position);
    this.seed(records);
  }

  seed(records) {
    for (const region of this.regions.values()) region.fireKeys.clear();
    for (const record of records) {
      const { longitude, latitude } = record;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 94 || longitude >= 142 || latitude < -12 || latitude >= 7) continue;
      const key = regionCellKey(longitude, latitude), region = this.regions.get(islandGroup(longitude, latitude));
      const x = Math.floor(longitude / CELL_SIZE), y = Math.floor(latitude / CELL_SIZE);
      region.cells.set(key, [(x + .5) * CELL_SIZE, (y + .5) * CELL_SIZE]);
      region.fireKeys.add(key);
    }
    for (const region of this.regions.values()) {
      const rows = new Map();
      for (const position of region.cells.values()) {
        const y = position[1];
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(position);
      }
      region.rows = [...rows.values()].sort((a, b) => b[0][1] - a[0][1]);
      for (const row of region.rows) row.sort((a, b) => a[0] - b[0]);
      region.constraint = {
        allows: (longitude, latitude) => region.cells.has(regionCellKey(longitude, latitude)),
        project: position => this.project(region.id, position),
      };
    }
  }

  public(id) {
    const region = this.regions.get(id);
    return region ? { id: region.id, name: region.name, color: region.color } : null;
  }

  map(id, point) {
    const region = this.regions.get(id);
    if (!region || !normalizedPositionValid(point)) return null;
    // The whole screen is useful: y walks occupied land rows north-to-south;
    // x walks the land within that row west-to-east, skipping sea gaps.
    const row = region.rows[Math.min(region.rows.length - 1, Math.floor(point[1] * region.rows.length))];
    return [...row[Math.min(row.length - 1, Math.floor(point[0] * row.length))]];
  }

  project(id, position) {
    const region = this.regions.get(id);
    if (region.cells.has(regionCellKey(...position))) return position;
    let nearest = region.rows[0][0], distance = Infinity;
    for (const candidate of region.cells.values()) {
      const next = (position[0] - candidate[0]) ** 2 + (position[1] - candidate[1]) ** 2;
      if (next < distance) { nearest = candidate; distance = next; }
    }
    return nearest;
  }

  assign(connections) {
    const counts = new Map([...this.regions.keys()].map(id => [id, 0]));
    for (const participant of connections.values()) if (counts.has(participant.regionId)) counts.set(participant.regionId, counts.get(participant.regionId) + 1);
    return [...this.regions.values()].sort((a, b) => counts.get(a.id) - counts.get(b.id) || b.fireKeys.size - a.fireKeys.size)[0].id;
  }

  summary(id, simulation, connections) {
    const region = this.regions.get(id);
    const result = { surfaceWetness: 0, moisture: 0, heat: 0, fireCells: region.fireKeys.size, extinguishedCells: 0, activeCount: 0 };
    for (const key of region.cells.keys()) {
      const cell = simulation.cells.get(key);
      if (!cell) continue;
      result.surfaceWetness += cell.surfaceWetness;
      result.moisture += cell.moisture;
      if (region.fireKeys.has(key)) {
        result.heat += cell.heat;
        if (cell.extinguished) result.extinguishedCells += 1;
      }
    }
    result.surfaceWetness /= region.cells.size;
    result.moisture /= region.cells.size;
    result.heat /= Math.max(1, region.fireKeys.size);
    for (const participant of connections.values()) if (participant.regionId === id && participant.holding) result.activeCount += 1;
    return result;
  }
}
