// Procedural rain is immediate contact feedback; it never predicts cooling.
// The main view uses a small canopy mark. Phones omit it entirely.
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

// Visual contact lifetimes are independent of input and the water model. The
// caller supplies every timestamp; no timer or animation loop is created here.
export class RainContactTransitions {
  constructor({ attackMs = 150, releaseMs = 450, maxContacts = 256, reducedMotion = false } = {}) {
    this.attackMs = Math.max(1, Number.isFinite(attackMs) ? attackMs : 150);
    this.releaseMs = Math.max(1, Number.isFinite(releaseMs) ? releaseMs : 450);
    this.maxContacts = Math.max(1, Math.min(256, Math.round(Number.isFinite(maxContacts) ? maxContacts : 256)));
    this.reducedMotion = Boolean(reducedMotion);
    this.entries = new Map(); this.activeKeys = new Map(); this.serial = 0;
  }

  _envelope(entry, now) {
    const attackProgress = this.reducedMotion ? 1 : clamp((now - entry.startedAt) / this.attackMs);
    const attack = smooth(attackProgress);
    const enteringOpacity = .25 + attack * .75;
    const enteringFootprint = .55 + attack * .45;
    const enteringCloud = entry.contact.preview ? .4 + attack * .6 : .55 + attack * .45;
    const releasing = entry.releasedAt !== null;
    const releaseProgress = releasing ? this.reducedMotion ? 1 : clamp((now - entry.releasedAt) / this.releaseMs) : 0;
    const remaining = 1 - smooth(releaseProgress);
    return { opacity: releasing ? entry.releaseOpacity * remaining : enteringOpacity,
      footprintOpacity: releasing ? entry.releaseFootprint * remaining : enteringFootprint,
      cloudOpacity: releasing ? entry.releaseCloud * remaining : enteringCloud,
      attackProgress, releaseProgress, releasing, startedAt: entry.startedAt, releasedAt: entry.releasedAt,
      rainHead: releasing ? entry.releaseHead : .12 + attack * .88 };
  }

  update(contacts, now = performance.now(), { reducedMotion = this.reducedMotion } = {}) {
    this.reducedMotion = Boolean(reducedMotion);
    this.sample(now);
    const incoming = new Map();
    for (const [index, contact] of (Array.isArray(contacts) ? contacts : []).entries()) {
      if (!contact || contact.active === false || !Number.isFinite(contact.x) || !Number.isFinite(contact.y)) continue;
      const sourceId = String(contact.sourceId ?? contact.id ?? contact.key ?? (contact.local ? 'local' : `contact-${index}`));
      const kind = contact.preview ? 'preview' : 'rain';
      incoming.set(`${sourceId}:${kind}`, { ...contact, sourceId });
    }
    const candidates = [...incoming].sort((a, b) => Number(Boolean(b[1].local)) - Number(Boolean(a[1].local)) || a[0].localeCompare(b[0]))
      .slice(0, this.maxContacts);
    const wanted = new Set(candidates.map(([key]) => key));
    for (const [key, visualId] of this.activeKeys) {
      if (wanted.has(key)) continue;
      const entry = this.entries.get(visualId);
      this.activeKeys.delete(key);
      if (!entry) continue;
      // A preview never leaves falling rain. Remove its sign when a real press
      // takes over; the new contact supplies an immediate static footprint.
      if (entry.contact.preview && incoming.has(`${entry.contact.sourceId}:rain`)) {
        this.entries.delete(visualId); continue;
      }
      const envelope = this._envelope(entry, now);
      entry.releasedAt = now; entry.releaseOpacity = envelope.opacity;
      entry.releaseFootprint = envelope.footprintOpacity; entry.releaseCloud = envelope.cloudOpacity;
      entry.releaseHead = envelope.rainHead;
    }
    for (const [key, contact] of candidates) {
      let visualId = this.activeKeys.get(key), entry = this.entries.get(visualId);
      if (!entry) {
        visualId = `${key}:${++this.serial}`;
        entry = { id: visualId, key, contact, startedAt: now, releasedAt: null };
        this.entries.set(visualId, entry); this.activeKeys.set(key, visualId);
      } else entry.contact = contact;
    }
    if (this.entries.size > this.maxContacts) {
      const excess = [...this.entries.values()].sort((a, b) =>
        Number(b.releasedAt !== null) - Number(a.releasedAt !== null) ||
        Number(Boolean(a.contact.local)) - Number(Boolean(b.contact.local)) || a.startedAt - b.startedAt);
      for (const entry of excess.slice(0, this.entries.size - this.maxContacts)) {
        this.entries.delete(entry.id);
        if (this.activeKeys.get(entry.key) === entry.id) this.activeKeys.delete(entry.key);
      }
    }
    return this.sample(now);
  }

  set(contacts, now, options) { return this.update(contacts, now, options); }

  sample(now = performance.now(), { reducedMotion = this.reducedMotion } = {}) {
    this.reducedMotion = Boolean(reducedMotion);
    const samples = [];
    for (const [id, entry] of this.entries) {
      const envelope = this._envelope(entry, now);
      if (envelope.releasing && envelope.releaseProgress >= 1) {
        this.entries.delete(id);
        if (this.activeKeys.get(entry.key) === id) this.activeKeys.delete(entry.key);
        continue;
      }
      samples.push({ ...entry.contact, id, sourceId: entry.contact.sourceId,
        active: !envelope.releasing, envelope });
    }
    return samples.sort((a, b) => Number(Boolean(b.local)) - Number(Boolean(a.local)) ||
      Number(b.active) - Number(a.active) || a.id.localeCompare(b.id));
  }

  hasAnimation(now = performance.now()) {
    if (this.reducedMotion) { this.sample(now); return false; }
    return this.sample(now).some(contact => contact.envelope.releasing || contact.envelope.attackProgress < 1 || !contact.preview);
  }

  clear() { this.entries.clear(); this.activeKeys.clear(); }
}

export class RainFeedback {
  ready() { return Promise.resolve(this); }
  draw(context, { x, y, radius = 18, now = performance.now(), strength = .5, active = true, tail = 1, reducedMotion = false, local = true, preview = false, bounds = null, cloud = true, footprint = true, impact = true, opacity = 1, envelope = null, color = null, label = '', bold = false } = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const baseAlpha = preview ? .55 : active ? 1 : clamp(tail);
    const alpha = baseAlpha * clamp(envelope?.opacity ?? opacity);
    if (!alpha) return null;
    const width = Math.max(34, Math.min(64, radius * 2.3 + 22));
    const length = Math.max(34, Math.min(88, radius * 2 + 34));
    const left = bounds?.left ?? -Infinity, right = bounds?.right ?? Infinity;
    const top = bounds?.top ?? -Infinity;
    const canopyX = Math.max(left + width / 2 + 3, Math.min(right - width / 2 - 3, x));
    const canopyY = Math.max(top + (bold ? 22 : 10), y - length);
    const bottom = Math.max(canopyY + 4, y - 3);
    const time = reducedMotion ? 0 : now / 1000;
    context.save(); context.globalAlpha = baseAlpha * clamp(envelope?.cloudOpacity ?? envelope?.opacity ?? opacity);
    context.lineCap = 'round'; context.lineWidth = local ? 1.7 : 1.1;
    context.strokeStyle = color || '#f4ddbf';
    if (cloud) {
      if (bold) {
        // Filled, light canopy and a dark keyline survive both bright orange
        // smoke and black terrain. Identity color is retained inside the sign.
        context.beginPath(); context.moveTo(canopyX - width / 2, canopyY + 6);
        context.quadraticCurveTo(canopyX - width * .57, canopyY - 3, canopyX - width * .32, canopyY - 4);
        context.quadraticCurveTo(canopyX - width * .27, canopyY - 17, canopyX - width * .04, canopyY - 11);
        context.quadraticCurveTo(canopyX + width * .2, canopyY - 20, canopyX + width * .32, canopyY - 6);
        context.quadraticCurveTo(canopyX + width * .57, canopyY - 8, canopyX + width / 2, canopyY + 6);
        context.closePath(); context.fillStyle = color || '#eaf9fc'; context.fill();
        context.strokeStyle = '#101b22'; context.lineWidth = 5; context.stroke();
        context.strokeStyle = '#f1fcff'; context.lineWidth = 1.5; context.stroke();
      } else {
      // Two offset, open arcs read as a suspended weather sign, not a bitmap.
      context.beginPath();
      context.moveTo(canopyX - width / 2, canopyY + 4);
      context.quadraticCurveTo(canopyX - width * .1, canopyY - 6, canopyX + width * .26, canopyY);
      context.moveTo(canopyX - width * .23, canopyY + 7);
      context.quadraticCurveTo(canopyX + width * .12, canopyY + 1, canopyX + width / 2, canopyY + 4);
      context.stroke();
      }
      if (label && context.fillText) {
        const onRight = canopyX + width / 2 + 32 < right;
        context.fillStyle = bold ? '#f4fdff' : color || '#f4ddbf'; context.font = `600 ${bold ? 12 : 10}px ui-monospace, monospace`;
        context.textAlign = onRight ? 'left' : 'right'; context.textBaseline = 'middle';
        if (bold && context.strokeText) {
          context.strokeStyle = '#101b22'; context.lineWidth = 4;
          context.strokeText(String(label), canopyX + (onRight ? 1 : -1) * (width / 2 + 6), canopyY + 1);
        }
        context.fillText(String(label), canopyX + (onRight ? 1 : -1) * (width / 2 + (bold ? 6 : 5)), canopyY + (bold ? 1 : 3));
      }
    }
    const count = Math.round(14 + clamp(strength) * 10);
    const head = clamp(envelope?.rainHead ?? 1);
    const releasing = !reducedMotion && envelope?.releasing && Number.isFinite(envelope.releasedAt);
    const releaseProgress = releasing ? clamp(envelope.releaseProgress) : 0;
    let dropCount = 0, rainTop = Infinity, rainBottom = -Infinity;
    context.globalAlpha = alpha;
    context.strokeStyle = color || (local ? '#fff0d8' : '#d9cec4');
    context.lineWidth = local ? 1.3 : .9;
    context.beginPath();
    for (let index = 0; index < (preview ? 0 : count); index++) {
      const speed = 1.5 + (index % 3) * .17;
      const epoch = Number.isFinite(envelope?.startedAt) ? envelope.startedAt / 1000 : 0;
      const originTime = reducedMotion ? 0 : Math.max(0, (releasing ? envelope.releasedAt / 1000 : time) - epoch);
      const originPhase = (index * .61803398875 + originTime * speed) % 1;
      // No new drops spawn after release: the last cohort moves down and exits
      // at the bottom, leaving a growing clear space beneath the weather sign.
      const phase = releasing ? originPhase + releaseProgress : originPhase;
      if (phase >= 1 || (!releasing && phase > head) || (releasing && originPhase > head)) continue;
      const spread = ((index * .754877666) % 1 - .5) * width * .85;
      const dropY = canopyY + 10 + phase * Math.max(4, bottom - canopyY - 10);
      const dropX = canopyX + spread + (x - canopyX) * phase;
      context.moveTo(dropX, dropY);
      context.lineTo(dropX - .8, Math.min(bottom, dropY + 5 + (index % 3) * 2));
      dropCount++; rainTop = Math.min(rainTop, dropY); rainBottom = Math.max(rainBottom, dropY);
    }
    if (bold) {
      context.strokeStyle = '#101b22'; context.lineWidth = 3.5; context.stroke();
      context.strokeStyle = color || '#eaf9fc'; context.lineWidth = 1.7;
    }
    context.stroke();
    if (footprint) {
      context.strokeStyle = color || (local ? '#f7d6ad' : '#c4a58c');
      context.globalAlpha = baseAlpha * clamp(envelope?.footprintOpacity ?? envelope?.opacity ?? opacity) * .72; context.lineWidth = local ? 1.3 : .8;
      context.beginPath(); context.arc(x, y, Math.max(2, radius), 0, Math.PI * 2);
      if (bold) {
        context.strokeStyle = '#101b22'; context.lineWidth = 4; context.stroke();
        context.strokeStyle = color || '#eaf9fc'; context.lineWidth = 2;
      }
      context.stroke();
    } else if (impact && !preview) {
      context.globalAlpha = alpha * .55;
      context.beginPath(); context.moveTo(x - width * .32, y + 1); context.lineTo(x + width * .32, y + 1); context.stroke();
    }
    context.restore();
    return { left: Math.min(canopyX - width / 2 - 3, x - radius - 3), top: canopyY - (bold ? 20 : 8), right: Math.max(canopyX + width / 2 + 3, x + radius + 3), bottom: y + (footprint ? radius + 3 : 4),
      dropCount, rainTop: dropCount ? rainTop : null, rainBottom: dropCount ? rainBottom : null, releaseProgress };
  }
}
