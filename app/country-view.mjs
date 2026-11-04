// One geographic frame for projection and phones, including the sea gaps.
// This is a schematic equirectangular view of the existing country geometry.
export const COUNTRY_BOUNDS = Object.freeze({ west: 94, east: 142, north: 7, south: -12 });
export const COUNTRY_ASPECT = 48 / 19;
const clamp = value => Math.max(0, Math.min(1, value));

// The main operator display keeps the original app's geographic scale and
// center. Phone navigation continues to use countryMapRect below.
export function operatorMapScale(width, height, zoom = 1) {
  const safeWidth = Number.isFinite(width) ? width : 0, safeHeight = Number.isFinite(height) ? height : 0;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(Number.EPSILON, Math.min((safeWidth - 65) / 49, (safeHeight - 90) / 22)) * safeZoom;
}

export function operatorMapRect(width, height, { zoom = 1, panX = 0, panY = 0 } = {}) {
  const safeWidth = Number.isFinite(width) ? width : 0, safeHeight = Number.isFinite(height) ? height : 0;
  const scale = operatorMapScale(safeWidth, safeHeight, zoom);
  return {
    x: safeWidth / 2 - 24 * scale + (Number.isFinite(panX) ? panX : 0),
    y: safeHeight / 2 - 9.9 * scale + (Number.isFinite(panY) ? panY : 0),
    width: 48 * scale, height: 19 * scale,
  };
}

// The projection gives this surface the clear space above the section ground.
// Fit the complete country inside it, with equal breathing room above/below;
// operator pan/zoom and phone navigation keep their separate frames.
export function studyMapRect(width, height) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const shortEdge = Math.min(safeWidth, safeHeight);
  const padding = Math.min(34, Math.max(24, shortEdge * .09), shortEdge * .2);
  const scale = Math.min((safeWidth - padding * 2) / 48, (safeHeight - padding * 2) / 19);
  return { x: safeWidth / 2 - 24 * scale, y: safeHeight / 2 - 9.5 * scale,
    width: 48 * scale, height: 19 * scale };
}

export function countryMapRect(width, height, padding = 0) {
  const availableWidth = Math.max(1, width - padding * 2), availableHeight = Math.max(1, height - padding * 2);
  const mapWidth = Math.min(availableWidth, availableHeight * COUNTRY_ASPECT), mapHeight = mapWidth / COUNTRY_ASPECT;
  return { x: (width - mapWidth) / 2, y: (height - mapHeight) / 2, width: mapWidth, height: mapHeight };
}
export function countryGeo(point) {
  return [Math.min(142 - .0001, 94 + clamp(point[0]) * 48), Math.min(7 - .0001, 7 - clamp(point[1]) * 19)];
}
export function countryPoint(point) {
  return [clamp((point[0] - 94) / 48), clamp((7 - point[1]) / 19)];
}
export function countryInputAt(rect, x, y) {
  return [clamp((x - rect.x) / rect.width), clamp((y - rect.y) / rect.height)];
}
export function traceCountryPath(target, geojson, rect) {
  const features = geojson?.type === 'FeatureCollection' ? geojson.features : [geojson];
  for (const feature of features || []) {
    const geometry = feature.geometry || feature;
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
    for (const polygon of polygons) for (const ring of polygon) {
      ring.forEach((point, index) => {
        const x = rect.x + (point[0] - 94) / 48 * rect.width;
        const y = rect.y + (7 - point[1]) / 19 * rect.height;
        if (index === 0) target.moveTo(x, y); else target.lineTo(x, y);
      });
      target.closePath();
    }
  }
}
export function countryPath(geojson, rect) {
  const path = new Path2D(); traceCountryPath(path, geojson, rect); return path;
}
