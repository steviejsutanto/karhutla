// Read-only phone views of the authoritative geographic simulation. No water,
// time, hold, or persistence state is changed by these measurement functions.
import { CELL_SIZE, BRUSH_RADIUS } from './simulation.js';

const layoutCache = new WeakMap();
const MAX_CACHED_FOOTPRINTS = 256;
const round = value => Math.round(value * 10000) / 10000;
const keyFor = (longitude, latitude) => `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;

function layoutFor(region) {
  let cached = layoutCache.get(region);
  // RegionCatalog.seed replaces rows even when a changed source snapshot keeps
  // the same geographic cells. This also invalidates source-fire membership.
  if (cached?.rows === region.rows) return cached;
  const patches = [];
  for (let row = 0; row < region.rows.length; row += 1) {
    const positions = region.rows[row];
    for (let column = 0; column < positions.length; column += 1) {
      const key = keyFor(...positions[column]);
      if (region.fireKeys.has(key)) patches.push(Object.freeze([key, row, column, positions.length]));
    }
  }
  cached = { rows: region.rows, patches: Object.freeze(patches), footprints: new Map() };
  layoutCache.set(region, cached);
  return cached;
}

/**
 * Only source-fire patches for the assigned island, in the exact land-row
 * coordinates used by RegionCatalog.map. A tuple is
 * [cellKey, row, column, columnsInRow, heat, extinguished, surfaceWetness,
 * moisture]. Current clients also accept older servers' six-value tuples.
 * Its normalized box
 * is [column/columnsInRow, row/rows, 1/columnsInRow, 1/rows]. Keeping the layout
 * as integer fractions avoids rounding a hotspot into a neighboring input cell.
 */
export function phoneSpatialField(catalog, regionId, simulation) {
  const region = catalog?.regions?.get(regionId);
  if (!region || !simulation?.cells) return null;
  const layout = layoutFor(region);
  return {
    format: 'land-rows-v1',
    rows: region.rows.length,
    patches: layout.patches.map(([key, row, column, columns]) => {
      const cell = simulation.cells.get(key);
      return [key, row, column, columns, round(cell?.heat ?? 0), Boolean(cell?.extinguished),
        round(cell?.surfaceWetness ?? 0), round(cell?.moisture ?? 0)];
    }),
  };
}

// Same analytic circle/rectangle overlap as simulation.footprint, without its
// water normalization. Average weights normalize only inside the assigned land
// mask; these weights are readouts, never extra or concentrated input water.
function circlePrimitive(x, y) {
  const sign = Math.sign(x) * Math.sign(y);
  const a = Math.min(Math.abs(x), BRUSH_RADIUS);
  const b = Math.min(Math.abs(y), BRUSH_RADIUS);
  const crossing = Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - b ** 2));
  if (a <= crossing) return sign * a * b;
  const integral = value => .5 * (value * Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - value ** 2)) + BRUSH_RADIUS ** 2 * Math.asin(value / BRUSH_RADIUS));
  return sign * (crossing * b + integral(a) - integral(crossing));
}

function weightsFor(region, position) {
  const layout = layoutFor(region);
  const cacheKey = `${position[0]},${position[1]}`;
  if (layout.footprints.has(cacheKey)) {
    const weights = layout.footprints.get(cacheKey);
    layout.footprints.delete(cacheKey);
    layout.footprints.set(cacheKey, weights);
    return weights;
  }
  const [longitude, latitude] = position;
  const weights = [];
  for (let x = Math.floor((longitude - BRUSH_RADIUS) / CELL_SIZE); x <= Math.floor((longitude + BRUSH_RADIUS) / CELL_SIZE); x += 1) {
    for (let y = Math.floor((latitude - BRUSH_RADIUS) / CELL_SIZE); y <= Math.floor((latitude + BRUSH_RADIUS) / CELL_SIZE); y += 1) {
      const key = `${x},${y}`;
      if (!region.cells.has(key)) continue;
      const x0 = x * CELL_SIZE - longitude, x1 = x0 + CELL_SIZE;
      const y0 = y * CELL_SIZE - latitude, y1 = y0 + CELL_SIZE;
      const area = Math.max(0, circlePrimitive(x1, y1) - circlePrimitive(x0, y1) - circlePrimitive(x1, y0) + circlePrimitive(x0, y0));
      if (area >= 1e-12) weights.push(Object.freeze([key, area]));
    }
  }
  Object.freeze(weights);
  layout.footprints.set(cacheKey, weights);
  if (layout.footprints.size > MAX_CACHED_FOOTPRINTS) layout.footprints.delete(layout.footprints.keys().next().value);
  return weights;
}

/**
 * Average current state under the circular brush, clipped to the assigned
 * island. Wetness/moisture include uninstantiated land cells as zero. Heat is
 * averaged over current source-fire area only, including extinguished zeroes,
 * matching the whole-island summary's fire-only denominator. Counts enumerate
 * source fire patches with positive overlap, rather than fractional patches.
 */
export function phoneBrushSummary(catalog, regionId, simulation, position) {
  const region = catalog?.regions?.get(regionId);
  if (!region || !simulation?.cells || !Array.isArray(position) || position.length !== 2 ||
      !position.every(Number.isFinite) || !region.cells.has(keyFor(...position))) return null;
  let landArea = 0, fireArea = 0;
  const summary = { surfaceWetness: 0, moisture: 0, heat: 0, fireCells: 0, extinguishedCells: 0 };
  for (const [key, area] of weightsFor(region, position)) {
    const cell = simulation.cells.get(key);
    landArea += area;
    summary.surfaceWetness += (cell?.surfaceWetness ?? 0) * area;
    summary.moisture += (cell?.moisture ?? 0) * area;
    if (region.fireKeys.has(key)) {
      fireArea += area;
      summary.heat += (cell?.heat ?? 0) * area;
      summary.fireCells += 1;
      if (cell?.extinguished) summary.extinguishedCells += 1;
    }
  }
  if (!landArea) return null;
  summary.surfaceWetness = round(summary.surfaceWetness / landArea);
  summary.moisture = round(summary.moisture / landArea);
  summary.heat = fireArea ? round(summary.heat / fireArea) : 0;
  return summary;
}
