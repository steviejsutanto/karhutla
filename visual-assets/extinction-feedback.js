// Packet-confirmed visual punctuation. This has no access to simulation or
// audio state: the caller chooses a real source and supplies the event clock.
const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const pressSerialValid = value => Number.isSafeInteger(value) && value >= 0;
const pointValid = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

// Snapshot coalescing can hide an entire short press/release. Accepted venue
// press counters survive that loss; motion and release never advance them.
// The first observed state is a baseline, so reloads cannot replay history.
export function participantPressEvents(previous, current, { baselineReady = true, maxMissed = 4 } = {}) {
  if (!baselineReady) return [];
  const before = previous instanceof Map ? previous : new Map((previous || []).map(actor => [actor.id, actor]));
  const events = [], limit = Math.max(1, Math.min(4, Math.floor(maxMissed)));
  for (const actor of current || []) {
    if (actor?.role !== 'participant' || actor.id == null) continue;
    const old = before.get(actor.id);
    if (pressSerialValid(actor.pressSerial)) {
      if (!old || !pressSerialValid(old.pressSerial) || !pointValid(actor.pressPosition)) continue;
      const count = Math.min(limit, Math.max(0, actor.pressSerial - old.pressSerial));
      if (count) events.push({ actorId: actor.id, count, position: [...actor.pressPosition], pressSerial: actor.pressSerial });
    } else if (actor.holding === true && old?.holding !== true && pointValid(actor.position)) {
      events.push({ actorId: actor.id, count: 1, position: [...actor.position], pressSerial: null });
    }
  }
  return events;
}

export class ExtinctionFeedback {
  constructor({ maxEvents = 64, durationMs = 1500 } = {}) {
    this.maxEvents = Math.max(1, Math.min(64, Math.floor(maxEvents)));
    this.durationMs = Math.max(200, durationMs);
    this.events = new Map(); this.serial = 0; this.total = 0; this.last = null;
    this.bellEvents = new Set(); this.bellNeedsClear = false;
  }
  trigger({ key, x, y, now = performance.now(), wallAt = Date.now(), reason = 'out' } = {}) {
    if (key == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    // Repeated snapshots cannot restart an in-flight confirmation. A fresh
    // tap has its own key supplied by the caller and can sound again.
    if (this.events.has(String(key))) return null;
    this.sample(now);
    const event = { key: String(key), x, y, at: now, wallAt, reason, serial: ++this.serial, firstPaintWallAt: null };
    this.events.set(event.key, event); this.total++; this.last = event;
    while (this.events.size > this.maxEvents) this.events.delete(this.events.keys().next().value);
    return event;
  }
  // This route accepts only a relayed, admitted Main bell. A patch becoming
  // out, a phone press, and a held rain packet cannot create this pulse.
  triggerBell(message, { now = performance.now() } = {}) {
    const { eventId, position, radiusDegrees = .85, wallAt, serverNow } = message || {};
    if (eventId == null || !pointValid(position) || position.some(value => value < 0 || value > 1) ||
        !Number.isFinite(radiusDegrees) || radiusDegrees <= 0 || radiusDegrees > 4 ||
        !Number.isFinite(wallAt) || !Number.isFinite(serverNow)) return null;
    const key = `bell:${String(eventId)}`;
    if (this.bellEvents.has(key)) return null;
    // Relative server time works on phones whose own clock differs from the
    // venue laptop. Late joins do not receive history; stale echoes fade out.
    const age = Math.max(0, serverNow - wallAt);
    if (age >= this.durationMs) return null;
    const event = this.trigger({ key, x: position[0], y: position[1], now: now - age, wallAt, reason: 'bell' });
    if (!event) return null;
    event.eventId = String(eventId); event.radiusDegrees = radiusDegrees;
    this.bellNeedsClear = true;
    this.bellEvents.add(key);
    while (this.bellEvents.size > 256) this.bellEvents.delete(this.bellEvents.values().next().value);
    return event;
  }
  sample(now = performance.now()) {
    for (const [key, event] of this.events) if (now - event.at >= this.durationMs) this.events.delete(key);
    return [...this.events.values()];
  }
  hasAnimation(now = performance.now()) { return this.sample(now).length > 0 || this.bellNeedsClear; }
  clear() { this.events.clear(); this.bellEvents.clear(); this.bellNeedsClear = false; this.last = null; }
  draw(context, { rect, now = performance.now(), reducedMotion = false } = {}) {
    const events = this.sample(now);
    this.bellNeedsClear = events.some(event => event.reason === 'bell');
    if (!rect || !events.length) return 0;
    context.save(); context.lineCap = 'round'; context.lineWidth = 1.1;
    for (const event of events) {
      const age = clamp((now - event.at) / this.durationMs), progress = reducedMotion ? .55 : smooth(age);
      const opacity = (.24 + .35 * smooth(age / .12)) * (1 - smooth((age - .12) / .88));
      const x = rect.x + event.x * rect.width, y = rect.y + event.y * rect.height;
      if (event.reason === 'bell') {
        const radiusX = rect.width * event.radiusDegrees / 48;
        const radiusY = rect.height * event.radiusDegrees / 19;
        const envelope = (1 - smooth(age)) * (.56 + .36 * smooth(age / .06));
        // The inner ring is the actual rain footprint. A second narrow ring
        // opens gently around it, then both disappear with the bell tail.
        context.lineWidth = 2;
        context.strokeStyle = '#ffe2a1'; context.globalAlpha = envelope;
        context.beginPath(); context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2); context.stroke();
        const spread = reducedMotion ? 1.14 : 1.05 + .36 * progress;
        context.lineWidth = 1.15;
        context.strokeStyle = '#b9e6e3'; context.globalAlpha = envelope * .62;
        context.beginPath(); context.ellipse(x, y, radiusX * spread, radiusY * spread, 0, 0, Math.PI * 2); context.stroke();
        if (event.firstPaintWallAt === null) event.firstPaintWallAt = Date.now();
        continue;
      }
      const radius = (8 + progress * 15) * Math.min(1.2, Math.max(.8, rect.width / 1200));
      // Muted copper becomes blue-gray steam; the quiet ring stays centered
      // on the exact source rather than suggesting another cooling brush.
      const cool = smooth(age / .7), red = Math.round(198 - 37 * cool), green = Math.round(157 + 37 * cool), blue = Math.round(127 + 65 * cool);
      context.strokeStyle = `rgb(${red} ${green} ${blue})`; context.globalAlpha = opacity;
      context.beginPath(); context.ellipse(x, y, radius, radius * .4, 0, 0, Math.PI * 2); context.stroke();
      context.globalAlpha = opacity * .72;
      for (let i = -1; i <= 1; i++) {
        const xx = x + i * 5, lift = reducedMotion ? 5 : progress * 13;
        context.beginPath(); context.moveTo(xx, y - 3 - lift);
        context.bezierCurveTo(xx - 4, y - 9 - lift, xx + 5, y - 13 - lift, xx + 1, y - 19 - lift); context.stroke();
      }
      if (event.firstPaintWallAt === null) event.firstPaintWallAt = Date.now();
    }
    context.restore();
    return events.length;
  }
}
