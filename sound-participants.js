// Read-only sound measurements of the server's source-fire cells. Patch keys
// and centers own the sound; an audience gesture only gates overlapping cells.
import { CELL_SIZE, BRUSH_RADIUS } from './simulation.js';
import { COUNTRY_BOUNDS, countryGeo, countryPoint } from './country-view.mjs';

const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const validPosition = position => Array.isArray(position) && position.length === 2 && position.every(Number.isFinite) && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
const keyAt = (longitude, latitude) => `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;

export function participantSoundPosition(position) {
  return validPosition(position) ? countryPoint(position) : null;
}

// The same analytic circle/cell intersection used by the rain simulation.
// Weighting source cells by their actual overlap also includes coastal edges
// and a fire whose center lies just outside the circular brush.
function circlePrimitive(x, y) {
  const sign = Math.sign(x) * Math.sign(y);
  const a = Math.min(Math.abs(x), BRUSH_RADIUS), b = Math.min(Math.abs(y), BRUSH_RADIUS);
  const crossing = Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - b ** 2));
  if (a <= crossing) return sign * a * b;
  const integral = value => .5 * (value * Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - value ** 2)) + BRUSH_RADIUS ** 2 * Math.asin(value / BRUSH_RADIUS));
  return sign * (crossing * b + integral(a) - integral(crossing));
}

function addSample(summary, patch, weight) {
  summary.area += weight;
  summary.sourceCount += 1;
  summary.heat += (patch.extinguished ? 0 : clamp(patch.heat)) * weight;
  summary.moisture += clamp(patch.moisture) * weight;
  summary.surfaceWetness += clamp(patch.surfaceWetness) * weight;
  summary.extinguished &&= patch.extinguished === true;
}
const emptySummary = () => ({ area: 0, sourceCount: 0, heat: 0, moisture: 0, surfaceWetness: 0, extinguished: true });
function finish(summary) {
  return Object.freeze({ heat: summary.area ? clamp(summary.heat / summary.area) : 0,
    moisture: summary.area ? clamp(summary.moisture / summary.area) : 0,
    surfaceWetness: summary.area ? clamp(summary.surfaceWetness / summary.area) : 0,
    extinguished: summary.sourceCount > 0 && summary.extinguished, sourceCount: summary.sourceCount });
}

/** Snapshot the packet endpoints and build a bounded geographic lookup. */
export function createParticipantSoundField(patches = []) {
  const sources = new Map();
  for (const patch of patches) {
    if (!patch || !validPosition([patch.longitude, patch.latitude]) || patch.hasFire === false) continue;
    const { longitude, latitude } = patch, key = keyAt(longitude, latitude);
    sources.set(key, Object.freeze({ id: `patch:${key}`, key, longitude, latitude,
      position: Object.freeze(countryPoint([longitude, latitude])),
      heat: clamp(patch.heat), moisture: clamp(patch.moisture), surfaceWetness: clamp(patch.surfaceWetness),
      extinguished: patch.extinguished === true, sourceCount: 1 }));
  }
  const sourcePatches = Object.freeze([...sources.values()].sort((a, b) => a.key.localeCompare(b.key)));
  const globalSummary = emptySummary();
  for (const source of sources.values()) addSample(globalSummary, source, 1);
  const global = finish(globalSummary);

  // The lookup visits only cells within the real rain brush, even with the
  // full audience present. Empty water/sea coordinates never touch a fallback.
  function forEachOverlap(position, visit) {
    if (!validPosition(position)) return;
    const [longitude, latitude] = position;
    for (let x = Math.floor((longitude - BRUSH_RADIUS) / CELL_SIZE); x <= Math.floor((longitude + BRUSH_RADIUS) / CELL_SIZE); x++) {
      for (let y = Math.floor((latitude - BRUSH_RADIUS) / CELL_SIZE); y <= Math.floor((latitude + BRUSH_RADIUS) / CELL_SIZE); y++) {
        const source = sources.get(`${x},${y}`);
        if (!source) continue;
        const x0 = x * CELL_SIZE - longitude, x1 = x0 + CELL_SIZE, y0 = y * CELL_SIZE - latitude, y1 = y0 + CELL_SIZE;
        const area = Math.max(0, circlePrimitive(x1, y1) - circlePrimitive(x0, y1) - circlePrimitive(x1, y0) + circlePrimitive(x0, y0));
        if (area >= 1e-12) visit(source, area);
      }
    }
  }
  return Object.freeze({
    global, patches: sourcePatches,
    patchesAt(position) {
      const result = [];
      forEachOverlap(position, source => result.push(source));
      return result;
    },
    // Legacy audience-note measurements retain their historical fallback.
    // Production patch voices below use individual endpoints and patchesAt.
    at(position) {
      const summary = emptySummary();
      forEachOverlap(position, (source, area) => addSample(summary, source, area));
      return summary.sourceCount ? finish(summary) : global;
    },
  });
}

/** Every source patch survives release/disconnect so its confirmed-out drone
 * can continue with no audience. The engine hashes key for its fixed pitches. */
export function patchSoundVoices(actors, field, { localPosition = null, localHolding = false, excludeId = null } = {}) {
  const touched = new Set();
  const touch = position => {
    for (const patch of field.patchesAt(position)) touched.add(patch.key);
  };
  for (const actor of actors || []) {
    if (!actor || actor.role !== 'participant' || actor.id == null || actor.id === excludeId || actor.holding !== true) continue;
    touch(actor.position);
  }
  if (localHolding === true) touch(localPosition);
  return field.patches.map(patch => ({ id: patch.id, key: patch.key, position: patch.position,
    holding: touched.has(patch.key), heat: patch.heat, moisture: patch.moisture,
    surfaceWetness: patch.surfaceWetness, extinguished: patch.extinguished, sourceCount: 1 }));
}

/** Count people actually touching the sound field, rather than joined idle
 * phones or the number of patches underneath one broad brush. */
export function activeSoundParticipantCount(actors, field, { localPosition = null, localHolding = false, excludeId = null } = {}) {
  const identities = new Set();
  for (const actor of actors || []) {
    if (!actor || actor.role !== 'participant' || actor.id == null || actor.id === excludeId || actor.holding !== true) continue;
    if (field.patchesAt(actor.position).length) identities.add(actor.id);
  }
  return identities.size + Number(localHolding === true && field.patchesAt(localPosition).length > 0);
}

/** Server actors use real geography even when their phones use a row view. */
export function participantSoundActors(actors, field, { excludeId = null } = {}) {
  const result = [];
  for (const actor of actors || []) {
    if (actor.role !== 'participant' || actor.id === excludeId || actor.id == null) continue;
    const position = participantSoundPosition(actor.position);
    if (!position) continue;
    result.push({ id: actor.id, number: actor.number, holding: actor.holding === true,
      position, ...field.at(actor.position) });
  }
  return result;
}

export function localParticipantSound(position, holding, field) {
  const normalized = participantSoundPosition(position);
  return normalized ? { id: '__local-operator', holding: holding === true,
    position: normalized, ...field.at(position) } : null;
}

// The crackle/cricket bed follows the macro map; local bells use
// this authoritative patch focus beneath the actual rain footprint.
export function nationalPhoneSoundPatchAt(patches, position, preferredKey = null) {
  if (!Array.isArray(patches) || !Array.isArray(position) || position.length !== 2 || !position.every(unit)) return null;
  const [longitude, latitude] = countryGeo(position);
  const directKey = `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;
  const halfCell = CELL_SIZE / 2;
  let preferred = null, nearest = null, nearestDistance = Infinity;
  for (const patch of patches) {
    if (!patch || typeof patch.key !== 'string' || typeof patch.extinguished !== 'boolean') continue;
    const geo = Array.isArray(patch.geo) && patch.geo.length === 2 ? patch.geo : [patch.longitude, patch.latitude];
    const [centerX, centerY] = geo;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) ||
        centerX < COUNTRY_BOUNDS.west || centerX >= COUNTRY_BOUNDS.east || centerY <= COUNTRY_BOUNDS.south || centerY > COUNTRY_BOUNDS.north) continue;
    const column = Math.floor(centerX / CELL_SIZE), row = Math.floor(centerY / CELL_SIZE);
    if (patch.key !== `${column},${row}` || Math.abs(centerX / CELL_SIZE - column - .5) > 1e-6 ||
        Math.abs(centerY / CELL_SIZE - row - .5) > 1e-6) continue;
    // A direct choice overrides retained focus, including an extinguished
    // source: touching an out patch must never restart a neighboring note.
    if (patch.key === directKey) return patch.key;
    const deltaX = longitude - centerX, deltaY = latitude - centerY;
    const edgeX = Math.max(0, Math.abs(deltaX) - halfCell), edgeY = Math.max(0, Math.abs(deltaY) - halfCell);
    // Closest point on the actual cell rectangle must be inside the circle.
    // A tiny tolerance excludes tangencies after geographic round trips.
    if (edgeX ** 2 + edgeY ** 2 >= BRUSH_RADIUS ** 2 - 1e-12) continue;
    if (patch.key === preferredKey) preferred = patch.key;
    // Cooled sources remain real tap targets throughout the whole rain brush.
    // Excluding them here made repeated taps go silent after the fire went out.
    const distance = deltaX ** 2 + deltaY ** 2;
    if (distance < nearestDistance || (distance === nearestDistance && patch.key < nearest)) {
      nearest = patch.key; nearestDistance = distance;
    }
  }
  return preferred ?? nearest;
}

export function nationalPhoneInteraction(patches, position, { holding = false, eligible = false, preferredKey = null } = {}) {
  const patchKey = holding ? nationalPhoneSoundPatchAt(patches, position, preferredKey) : null;
  const patch = patchKey == null ? null : patches.find(value => value.key === patchKey);
  return { holding: holding === true, eligible: eligible === true,
    patchKey, extinguished: patch?.extinguished === true };
}

