import { BRUSH_RADIUS, CELL_SIZE } from './simulation.js';
import { countryPoint } from './country-view.mjs';

export const RAIN_AREA_RECENT_SECONDS = 2;
const validPosition = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) &&
  Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const intersects = (left, right) => { for (const key of left) if (right.has(key)) return true; return false; };

/** Observe rain footprints without changing the water simulation. A confirmed
 * area completion owns one event, independently of the people touching it.
 * The caller consumes returned events immediately, including while inaudible.
 */
export function createRainAreaTracker({ recentSeconds = RAIN_AREA_RECENT_SECONDS } = {}) {
  const recent = Number.isFinite(recentSeconds) ? Math.max(0, Math.min(10, recentSeconds)) : RAIN_AREA_RECENT_SECONDS;
  const areas = new Map(), buckets = new Map(), claimed = new Set();
  let previous = new Map(), serial = 0, eventSerial = 0, sourceCount = 0;
  const bucketKey = position => `${Math.floor(position[0] / BRUSH_RADIUS)},${Math.floor(position[1] / BRUSH_RADIUS)}`;
  const remove = area => {
    areas.delete(area.id);
    const bucket = buckets.get(area.bucket);
    bucket?.delete(area.id); if (!bucket?.size) buckets.delete(area.bucket);
  };
  const add = (position, members, now) => {
    const area = { id: ++serial, anchor: [...position], brushAnchor: [...position], bucket: bucketKey(position), members,
      hotSeen: new Set(), completedMembers: null, lastSeen: now, expiresAt: now + recent, active: false,
      nextMembers: new Set(), contactIds: new Set(), nextContactIds: new Set(), nextPositions: new Map() };
    areas.set(area.id, area);
    if (!buckets.has(area.bucket)) buckets.set(area.bucket, new Set());
    buckets.get(area.bucket).add(area.id);
    return area;
  };
  const nearby = (position, members, now, contactId) => {
    const x = Math.floor(position[0] / BRUSH_RADIUS), y = Math.floor(position[1] / BRUSH_RADIUS);
    let nearest = null, nearestDistance = Infinity;
    for (let bx = x - 3; bx <= x + 3; bx++) for (let by = y - 3; by <= y + 3; by++) {
      for (const id of buckets.get(`${bx},${by}`) || []) {
        const area = areas.get(id), distance = distanceSquared(area.anchor, position);
        if (now > area.expiresAt && !area.contactIds.has(contactId)) continue;
        const radius = area.completedMembers ? BRUSH_RADIUS : BRUSH_RADIUS * 2 + Math.SQRT2 * CELL_SIZE;
        if (distance > radius ** 2 || area.completedMembers && !intersects(members, area.members)) continue;
        if (distance < nearestDistance || distance === nearestDistance && area.id < nearest.id) { nearest = area; nearestDistance = distance; }
      }
    }
    return nearest;
  };

  return Object.freeze({
    update(field, contacts = [], nowSeconds = 0) {
      const now = Number.isFinite(nowSeconds) ? nowSeconds : 0;
      const sources = new Map((field?.patches || []).filter(patch => patch && typeof patch.key === 'string').map(patch => [patch.key, patch]));
      sourceCount = sources.size;
      const returned = new Set();
      for (const [key, patch] of sources) if (!patch.extinguished) {
        claimed.delete(key);
        if (previous.get(key)?.extinguished === true) returned.add(key);
      }
      for (const key of claimed) if (!sources.has(key)) claimed.delete(key);
      for (const area of [...areas.values()]) {
        if (![...area.members].some(key => sources.has(key))) { remove(area); continue; }
        area.active = false; area.nextMembers.clear(); area.nextContactIds.clear(); area.nextPositions.clear();
        for (const key of area.hotSeen) if (!sources.has(key)) area.hotSeen.delete(key);
        if (area.completedMembers && intersects(area.completedMembers, returned)) {
          area.completedMembers = null; area.hotSeen.clear();
        }
      }

      // Stable ordering makes both grouping and the representative independent
      // of network participant order. A source fire belongs to the visible rain
      // area when its center is inside the brush. The water simulation still
      // wets partly intersected cells, but a tangential sliver may receive less
      // water than it loses and can never reach the confirmed-out threshold.
      const active = Array.isArray(contacts) ? contacts.filter(contact => contact?.holding === true && validPosition(contact.position)) : [];
      active.sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')) || a.position[0] - b.position[0] || a.position[1] - b.position[1]);
      for (const contact of active) {
        const patches = field?.patchesAt?.(contact.position) || [];
        const members = new Set(patches.filter(patch => sources.has(patch.key) &&
          (patch.longitude - contact.position[0]) ** 2 + (patch.latitude - contact.position[1]) ** 2 <= BRUSH_RADIUS ** 2 + 1e-12)
          .map(patch => patch.key));
        if (!members.size) continue;
        const contactId = String(contact.id ?? '');
        let area = nearby(contact.position, members, now, contactId);
        if (!area) {
          // Already-out snapshots and out-ground taps never create an event
          // candidate, even if this browser has just joined the performance.
          if (![...members].some(key => sources.get(key).extinguished === false)) continue;
          area = add(contact.position, members, now);
        }
        area.active = true; area.lastSeen = now; area.expiresAt = now + recent;
        area.nextContactIds.add(contactId);
        area.nextPositions.set(contactId, contact.position);
        for (const key of members) {
          area.nextMembers.add(key);
          if (!area.completedMembers && sources.get(key).extinguished === false) area.hotSeen.add(key);
        }
      }

      const events = [];
      for (const area of [...areas.values()]) {
        // An uninterrupted hold may span sparse packets. A released or absent
        // contact still expires before a late completion can create a sound.
        if (!area.active && now > area.expiresAt) { remove(area); continue; }
        area.contactIds = new Set(area.nextContactIds);
        if (area.active) {
          area.members = new Set(area.nextMembers);
          // The stable bucket anchor identifies this shared cooling lifecycle;
          // its visible footprint follows the brushes that actually completed
          // it. Retain the final position during a late release confirmation.
          const positions = [...area.nextPositions.values()];
          area.brushAnchor = [0, 1].map(axis => positions.reduce((sum, position) => sum + position[axis], 0) / positions.length);
        }
        if (area.completedMembers || !area.hotSeen.size || !area.members.size) continue;
        const memberKeys = [...area.members].filter(key => sources.has(key)).sort();
        if (!memberKeys.length || !memberKeys.every(key => sources.get(key).extinguished === true)) continue;
        // Global patch claims cover overlapping people/nearby anchors. A real
        // hot return clears the claim; time and repeated taps never do.
        const eligible = memberKeys.some(key => area.hotSeen.has(key) && !claimed.has(key));
        area.completedMembers = new Set(memberKeys);
        if (!eligible) continue;
        for (const key of memberKeys) claimed.add(key);
        const key = memberKeys[0], representative = sources.get(key);
        events.push(Object.freeze({ id: `rain-area:${area.id}:${++eventSerial}`, key,
          memberKeys: Object.freeze(memberKeys), position: Object.freeze([...(representative.position || [.5, .5])]),
          brushPosition: Object.freeze(countryPoint(area.brushAnchor)),
          at: now, expiresAt: now + recent }));
      }

      // Anchors are separated geographically, while claims contain at most the
      // live source count. Also cap unusual sparse/coastal arrangements so a
      // frantic drag cannot retain an unbounded gesture history.
      const maximum = Math.max(1, sourceCount * 4);
      if (areas.size > maximum) {
        const oldest = [...areas.values()].sort((a, b) => Number(a.active) - Number(b.active) ||
          Number(!a.completedMembers) - Number(!b.completedMembers) || a.lastSeen - b.lastSeen || a.id - b.id);
        for (const area of oldest.slice(0, areas.size - maximum)) remove(area);
      }
      previous = sources;
      return events;
    },
    reset() { areas.clear(); buckets.clear(); claimed.clear(); previous.clear(); serial = eventSerial = sourceCount = 0; },
    getMetrics() { return { sourceCount, areaCount: areas.size, claimedPatchCount: claimed.size,
      pendingAreaCount: [...areas.values()].filter(area => !area.completedMembers).length,
      completedEvents: eventSerial, recentSeconds: recent, maxAreas: Math.max(1, sourceCount * 4) }; },
  });
}
