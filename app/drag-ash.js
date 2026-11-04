// Main-only movement feedback. The owner supplies already decoded, verified ash
// recordings and calls tick from its existing 60 ms audio scheduler.
export const DRAG_ASH_LIMITS = Object.freeze({ grains: 20, actors: 64, assets: 4,
  bufferSeconds: 32, minGrainSeconds: .028, maxGrainSeconds: .065, attackSeconds: .002,
  releaseSeconds: .45, lookAheadSeconds: .075, peak: .18, outputGain: .7,
  recordingRms: .18, recordingPeak: .7, maxRecordingGain: 16 });
const disconnect = node => { try { node?.disconnect(); } catch {} };
const stopSource = (source, at) => { try { source?.stop(at); } catch {} };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validPosition = value => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(Number.isFinite);
const normalizedPosition = value => value.slice(0, 2).map(value => clamp(value, 0, 1));
const windowAt = (fraction, attackFraction) => {
  if (fraction <= 0 || fraction >= 1) return 0;
  return fraction < attackFraction ? Math.sin(fraction / attackFraction * Math.PI / 2) ** 2
    : (1 - (fraction - attackFraction) / (1 - attackFraction)) ** 2.2;
};

function hold(parameter, at, value) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { parameter.cancelScheduledValues(at); parameter.setValueAtTime(value, at); }
}

export class DragAshAudio {
  constructor({ context, destination, getCandidates = () => [], makeSpatialPath, positionPath, random = Math.random }) {
    this.context = context; this.getCandidates = getCandidates;
    this.makeSpatialPath = makeSpatialPath; this.positionPath = positionPath; this.random = random;
    this.output = context.createGain(); this.output.gain.value = 0; this.output.connect(destination);
    this.active = false; this.destroyed = false; this.weight = 1; this.participantCount = 0;
    this.actors = new Map(); this.grains = new Set(); this.cache = new Map(); this.bank = [];
    this.recordingLevels = new WeakMap();
    this.scheduled = 0; this.skipped = 0; this.actorCursor = 0; this.crowdGain = 1; this.outputTarget = 0;
    this.lastAssetId = null; this.error = null;
  }

  configure({ active = this.active, weight = this.weight, participantCount = this.participantCount } = {}) {
    if (this.destroyed) return;
    this.weight = clamp(Number(weight) || 0, 0, 2);
    this.participantCount = clamp(Number(participantCount) || 0, 0, 4096);
    const enabled = Boolean(active);
    if (!enabled && this.active) this.stop();
    if (enabled && !this.active) {
      // Context time can have been suspended during a mute. Old scheduled
      // sources must never resume alongside a fresh gesture.
      for (const grain of [...this.grains]) this._disposeGrain(grain);
      this.actors.clear();
    }
    this.active = enabled; this._syncGain();
  }

  update({ contacts = [] } = {}, now = this.context.currentTime) {
    if (this.destroyed || !this.active || !Number.isFinite(now)) return;
    const seen = new Set();
    for (const contact of Array.isArray(contacts) ? contacts : []) {
      const id = contact?.id;
      if (!['string', 'number'].includes(typeof id) || seen.has(id)) continue;
      seen.add(id);
      const holding = contact.holding === true && validPosition(contact.position);
      const eligible = holding && contact.extinguished === true;
      let actor = this.actors.get(id);
      if (!actor) {
        if (!holding || this.actors.size >= DRAG_ASH_LIMITS.actors) continue;
        actor = { id, sampleAt: now, inputPosition: normalizedPosition(contact.position),
          position: normalizedPosition(contact.position), holding, eligible, speed: 0,
          strength: 0, lastMotionAt: -Infinity, nextAt: now + .004 };
        this.actors.set(id, actor);
        continue; // The first point is a tap/hold, never a movement event.
      }
      if (!holding) { actor.holding = false; actor.eligible = false; continue; }
      const position = normalizedPosition(contact.position), elapsed = now - actor.sampleAt;
      if (actor.holding && elapsed > .001 && elapsed <= .35) {
        const distance = Math.hypot(position[0] - actor.inputPosition[0], position[1] - actor.inputPosition[1]);
        const rawSpeed = distance / elapsed;
        const amount = 1 - Math.exp(-elapsed / .075);
        actor.speed += (Math.min(2, rawSpeed) - actor.speed) * amount;
        // Tiny input jitter and repeats do not refresh the release. Authority
        // comes from the current out-terrain lookup supplied by the owner.
        if (eligible && distance >= .0005 && rawSpeed >= .006) {
          // Contacts use the full 48-degree country width. Local movement
          // across one small cooled area must excite the grains as clearly
          // as a sweep across the whole map.
          actor.strength = clamp((actor.speed - .003) / .05, .2, 1);
          actor.lastMotionAt = now; actor.position = position;
          actor.geo = Array.isArray(contact.geo) ? contact.geo.slice(0, 2) : null;
          if (actor.nextAt < now - .06) actor.nextAt = now + .004;
        }
      } else actor.speed = 0;
      actor.inputPosition = position; actor.sampleAt = now; actor.holding = holding; actor.eligible = eligible;
    }
    for (const [id, actor] of this.actors) if (!seen.has(id)) { actor.holding = false; actor.eligible = false; }
    this._pruneActors(now); this._syncGain();
  }

  _energy(actor, at) {
    const age = Math.max(0, at - actor.lastMotionAt);
    if (age >= DRAG_ASH_LIMITS.releaseSeconds) return 0;
    // Smoothstep release reaches exact silence on the audio clock, even if
    // no pointer-up arrives or an actor leaves authoritative out terrain.
    const remaining = 1 - age / DRAG_ASH_LIMITS.releaseSeconds;
    return actor.strength * remaining * remaining * (3 - 2 * remaining);
  }
  _pruneActors(now) {
    for (const [id, actor] of this.actors) if (!actor.holding && this._energy(actor, now) === 0) this.actors.delete(id);
  }

  _syncBank() {
    let candidates;
    try { candidates = this.getCandidates(); } catch (error) { this.error = error?.message ?? 'Ash recordings unavailable.'; candidates = []; }
    const next = [], used = new Set();
    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
      if (next.length >= DRAG_ASH_LIMITS.assets) break;
      const source = candidate?.buffer ?? candidate;
      const weight = candidate?.weight == null ? 1 : clamp(Number(candidate.weight) || 0, 0, 1);
      if (!weight || used.has(source) || !source || !Number.isFinite(source.duration) || source.duration < .25 ||
          !Number.isInteger(source.numberOfChannels) || source.numberOfChannels < 1 || source.numberOfChannels > 2 ||
          source.sampleRate !== this.context.sampleRate || !Number.isInteger(source.length) || source.length < 1 ||
          typeof source.getChannelData !== 'function') continue;
      used.add(source);
      let buffer = this.cache.get(source);
      if (!buffer) {
        const frames = Math.min(source.length, Math.floor(source.sampleRate * DRAG_ASH_LIMITS.bufferSeconds));
        // A private mono copy keeps grain calibration independent of the same
        // recording's ambient/after-extinction use. Never modify shared assets.
        buffer = this.context.createBuffer(1, frames, source.sampleRate);
        const output = buffer.getChannelData(0);
        for (let channel = 0; channel < source.numberOfChannels; channel++) {
          const input = source.getChannelData(channel);
          for (let frame = 0; frame < frames; frame++) output[frame] += input[frame] / source.numberOfChannels;
        }
        let power = 0, peak = 0;
        for (const sample of output) { power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        const rms = Math.sqrt(power / frames);
        const gain = rms > .00001 ? Math.min(DRAG_ASH_LIMITS.maxRecordingGain,
          DRAG_ASH_LIMITS.recordingRms / rms, DRAG_ASH_LIMITS.recordingPeak / Math.max(peak, .00001)) : 1;
        for (let frame = 0; frame < frames; frame++) output[frame] *= gain;
        this.recordingLevels.set(buffer, { inputRms: rms, inputPeak: peak, gain,
          outputRms: rms * gain, outputPeak: peak * gain });
      }
      next.push({ id: typeof candidate?.id === 'string' ? candidate.id : `ash-${index + 1}`, source, buffer, weight });
    }
    this.bank = next; this.cache = new Map(next.map(asset => [asset.source, asset.buffer]));
    if (next.length) this.error = null;
  }

  tick(now = this.context.currentTime) {
    if (this.destroyed || !Number.isFinite(now)) return;
    for (const grain of [...this.grains]) if (now >= grain.endAt) this._disposeGrain(grain);
    this._pruneActors(now);
    if (!this.active || this.weight === 0) return;
    this._syncBank();
    if (!this.bank.length) return;
    const actors = [...this.actors.values()].filter(actor => this._energy(actor, now) > .002);
    if (!actors.length) { this._syncGain(); return; }
    // Existing overlapping grains follow the drag, then retain the last out
    // location for their release. No path ever follows into burning terrain.
    for (const grain of this.grains) {
      const actor = this.actors.get(grain.actorId);
      if (actor) { grain.position = [...actor.position]; this.positionPath(grain.space, grain.position); }
    }
    const start = this.actorCursor++ % actors.length;
    for (let round = 0; round < 3; round++) for (let index = 0; index < actors.length; index++) {
      const actor = actors[(start + index) % actors.length];
      if (actor.nextAt < now) actor.nextAt = now + .004;
      if (actor.nextAt >= now + DRAG_ASH_LIMITS.lookAheadSeconds) continue;
      if (this.grains.size >= DRAG_ASH_LIMITS.grains) { this.skipped++; continue; }
      const at = actor.nextAt, energy = this._energy(actor, at);
      actor.nextAt += .04 + .025 * this._random();
      if (energy > .002) this._scheduleGrain(actor, at, energy);
    }
    this._syncGain();
  }

  _random() { return clamp(Number(this.random()) || 0, 0, .999999); }
  _scheduleGrain(actor, at, energy) {
    const total = this.bank.reduce((sum, asset) => sum + asset.weight, 0);
    let choice = this._random() * total;
    const asset = this.bank.find(asset => (choice -= asset.weight) < 0) ?? this.bank.at(-1);
    const duration = DRAG_ASH_LIMITS.minGrainSeconds +
      (DRAG_ASH_LIMITS.maxGrainSeconds - DRAG_ASH_LIMITS.minGrainSeconds) * this._random();
    const rate = .82 + .36 * this._random(), attackFraction = DRAG_ASH_LIMITS.attackSeconds / duration;
    const offset = this._random() * Math.max(0, asset.buffer.duration - duration * rate);
    const source = this.context.createBufferSource(), envelope = this.context.createGain();
    source.buffer = asset.buffer; source.loop = false; source.playbackRate.value = rate;
    const peak = DRAG_ASH_LIMITS.peak * energy;
    const values = Float32Array.from({ length: 65 }, (_, index) => peak * windowAt(index / 64, attackFraction));
    envelope.gain.setValueAtTime(0, at); envelope.gain.setValueCurveAtTime(values, at, duration);
    const space = this.makeSpatialPath(this.output), position = [...actor.position];
    // Both the source buffer and the spatial input are explicitly mono.
    space.input.channelCount = 1; space.input.channelCountMode = 'explicit'; space.input.channelInterpretation = 'speakers';
    this.positionPath(space, position); source.connect(envelope); envelope.connect(space.input);
    const grain = { source, envelope, space, actorId: actor.id, position, at, duration, endAt: at + duration + .005,
      offset, rate, peak, attackFraction, assetId: asset.id, energy, disposed: false };
    this.grains.add(grain); this.scheduled++; this.lastAssetId = asset.id;
    source.onended = () => this._disposeGrain(grain);
    source.start(at, offset, duration * rate); source.stop(grain.endAt);
  }

  _syncGain() {
    if (this.destroyed) return;
    const now = this.context.currentTime;
    const moving = [...this.actors.values()].filter(actor => this._energy(actor, now) > .002).length;
    this.crowdGain = 1 / Math.sqrt(Math.max(1, this.participantCount, moving));
    // Recordings have their own bounded peak. The global pool, independent
    // trim and crowd normalization retain headroom for sharper grain attacks.
    const value = this.active ? DRAG_ASH_LIMITS.outputGain * this.weight * this.crowdGain : 0;
    if (this.outputTarget === value) return;
    const state = this.outputEnvelope;
    const from = state ? state.value + (state.from - state.value) * Math.exp(-Math.max(0, now - state.at) / state.seconds) : 0;
    hold(this.output.gain, now, from);
    const seconds = value < this.outputTarget ? .015 : .08;
    this.output.gain.setTargetAtTime(value, now, seconds);
    this.outputTarget = value; this.outputEnvelope = { from, value, at: now, seconds };
  }

  _disposeGrain(grain) {
    if (!grain || grain.disposed) return;
    grain.disposed = true; this.grains.delete(grain); grain.source.onended = null;
    stopSource(grain.source); disconnect(grain.source); grain.source.buffer = null;
    disconnect(grain.envelope); for (const node of grain.space.nodes ?? [grain.space.input]) disconnect(node);
  }
  stop() {
    if (this.destroyed) return;
    this.actors.clear(); const now = this.context.currentTime;
    for (const grain of [...this.grains]) {
      if (grain.at >= now) { this._disposeGrain(grain); continue; }
      if (grain.fading) continue;
      const value = grain.peak * windowAt((now - grain.at) / grain.duration, grain.attackFraction);
      // Curve automation must be removed from its start on implementations
      // without cancelAndHoldAtTime before inserting a release ramp.
      if (typeof grain.envelope.gain.cancelAndHoldAtTime === 'function') hold(grain.envelope.gain, now, value);
      else { grain.envelope.gain.cancelScheduledValues(grain.at); grain.envelope.gain.setValueAtTime(value, now); }
      grain.envelope.gain.linearRampToValueAtTime(0, now + .04);
      grain.endAt = now + .045; grain.fading = true; stopSource(grain.source, grain.endAt);
    }
  }
  reset() { if (!this.destroyed) { this.configure({ active: false }); this.stop(); this.actorCursor = 0; } }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.active = false; this.actors.clear();
    for (const grain of [...this.grains]) this._disposeGrain(grain);
    this.bank = []; this.cache.clear(); disconnect(this.output);
  }
  getMetrics() {
    const now = this.context.currentTime;
    return { active: this.active, loaded: this.bank.length > 0, assetCount: this.bank.length,
      assetIds: this.bank.map(asset => asset.id), cacheEntries: this.cache.size,
      recordingLevels: this.bank.map(asset => ({ id: asset.id, ...this.recordingLevels.get(asset.buffer) })),
      monoBufferBytes: [...new Set(this.cache.values())].reduce((sum, buffer) => sum + buffer.length * 4, 0),
      scheduled: this.scheduled, skipped: this.skipped, currentGrains: this.grains.size,
      maxGrains: DRAG_ASH_LIMITS.grains, trackedActors: this.actors.size,
      movingActors: [...this.actors.values()].filter(actor => this._energy(actor, now) > .002).length,
      grainSeconds: [DRAG_ASH_LIMITS.minGrainSeconds, DRAG_ASH_LIMITS.maxGrainSeconds],
      attackSeconds: DRAG_ASH_LIMITS.attackSeconds,
      releaseSeconds: DRAG_ASH_LIMITS.releaseSeconds, crowdGain: this.crowdGain, weight: this.weight,
      participantCount: this.participantCount, gain: this.outputTarget, currentAssetId: this.lastAssetId, error: this.error,
      actors: [...this.actors.values()].map(actor => ({ id: actor.id, position: [...actor.position],
        speed: actor.speed, energy: this._energy(actor, now), holding: actor.holding, extinguished: actor.eligible })),
      grains: [...this.grains].map(grain => ({ actorId: grain.actorId, position: [...grain.position], assetId: grain.assetId,
        at: grain.at, duration: grain.duration, offset: grain.offset, rate: grain.rate, peak: grain.peak, mono: true, fading: Boolean(grain.fading) })) };
  }
}
