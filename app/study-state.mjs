// Both study screens use the existing phone land-row mapping. No state is
// predicted here: these functions only locate authoritative model patches.
import { COUNTRY_BOUNDS, countryGeo, countryPoint } from './country-view.mjs';
const clamp = n => Math.max(0, Math.min(1, n));
export const studyCellKey = (longitude, latitude) => `${Math.floor(longitude / .25)},${Math.floor(latitude / .25)}`;

export function makeStudyLayout(data) {
  if (data?.format === 'country-v1') {
    if (data.id !== 'indonesia' || data.cellSize !== .25 || !data.bounds || Object.keys(COUNTRY_BOUNDS).some(key => data.bounds[key] !== COUNTRY_BOUNDS[key]) || !Array.isArray(data.patches) || !Array.isArray(data.fireKeys) || !Array.isArray(data.landKeys)) throw new Error('Invalid country layout.');
    const locations = new Map();
    for (const [key, longitude, latitude] of data.patches) {
      if (typeof key !== 'string' || !Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 94 || longitude >= 142 || latitude < -12 || latitude >= 7 || key !== studyCellKey(longitude, latitude) || locations.has(key)) throw new Error('Invalid country patch.');
      locations.set(key, { key, x: (longitude - .125 - 94) / 48, y: (7 - latitude - .125) / 19, width: .25 / 48, height: .25 / 19, geo: [longitude, latitude] });
    }
    const fireKeys = new Set(data.fireKeys);
    if ([...fireKeys].some(key => !locations.has(key))) throw new Error('Source patch is missing from the country layout.');
    return { ...data, locations, fireKeys, landKeys: new Set(data.landKeys) };
  }
  if (!data || typeof data.id !== 'string' || typeof data.name !== 'string' ||
      !Array.isArray(data.rows) || !data.rows.length || data.rows.length > 512 || !Array.isArray(data.fireKeys)) throw new Error('Invalid regional layout.');
  const locations = new Map();
  data.rows.forEach((row, y) => {
    if (!Array.isArray(row) || !row.length || row.length > 512) throw new Error('Invalid regional row.');
    row.forEach((geo, x) => {
      if (!Array.isArray(geo) || geo.length !== 2 || !geo.every(Number.isFinite)) throw new Error('Invalid geographic patch.');
      locations.set(studyCellKey(...geo), { key: studyCellKey(...geo), x: x / row.length, y: y / data.rows.length, width: 1 / row.length, height: 1 / data.rows.length, geo });
    });
  });
  const fireKeys = new Set(data.fireKeys);
  if ([...fireKeys].some(key => !locations.has(key))) throw new Error('Source patch is outside its region.');
  return { ...data, locations, fireKeys };
}

export function studyGeoAt(layout, point) {
  if (!layout || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
  if (layout.format === 'country-v1') return countryGeo(point);
  const row = layout.rows[Math.min(layout.rows.length - 1, Math.floor(clamp(point[1]) * layout.rows.length))];
  return [...row[Math.min(row.length - 1, Math.floor(clamp(point[0]) * row.length))]];
}

export function studyPointForGeo(layout, point) {
  if (!layout || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return null;
  if (layout.format === 'country-v1') return countryPoint(point);
  const box = layout.locations.get(studyCellKey(...point));
  return box ? [box.x + box.width / 2, box.y + box.height / 2] : null;
}

export function studyPatches(layout, cells) {
  if (!layout) return [];
  return [...layout.fireKeys].map(key => {
    const box = layout.locations.get(key), cell = cells.get(key);
    return { ...box, heat: cell?.heat ?? 0, surfaceWetness: cell?.surfaceWetness ?? 0, moisture: cell?.moisture ?? 0, extinguished: Boolean(cell?.extinguished) };
  });
}

export function studyRegionSummary(layout, cells) {
  let heat = 0, wetness = 0, out = 0;
  if (!layout) return { heat, wetness, out, total: 0 };
  const landKeys = layout.landKeys || layout.locations;
  for (const key of landKeys.keys()) wetness += cells.get(key)?.surfaceWetness || 0;
  for (const key of layout.fireKeys) { const cell = cells.get(key); heat += cell?.heat || 0; if (cell?.extinguished) out++; }
  return { heat: heat / Math.max(1, layout.fireKeys.size), wetness: wetness / Math.max(1, landKeys.size), out, total: layout.fireKeys.size };
}
