import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { RainSimulation } from './simulation.js';
import { RegionCatalog, normalizedPositionValid } from './regions.mjs';
import { phoneSpatialField, phoneBrushSummary } from './phone-spatial.mjs';
import { NationalSpace, COUNTRY_ASSIGNMENT, countryPosition } from './national-space.mjs';
import { PerformanceScenes, DEFAULT_SOUND_SETTINGS, restoreSceneSettings, soundSettingsPatch } from './performance-scenes.mjs';
import { audienceRainStrength, scoreDurations, DEFAULT_RAIN_STRENGTH } from './scene-score.js';
import { birdEvent, BIRD_MIN_GAP_MS } from './scene-wildlife.js';
import { createSettingsPreset, validateSettingsPreset } from './settings-presets.mjs';
import { createRainSupply, advanceRainSupply, rainSupplyCapacity, rainSupplyState } from './rain-supply.mjs';

export const HOLD_LEASE_MS = 2000;
export const MAX_PATH_POINTS = 64;
const HOLD_BATCH_MS = 50;
const PENDING_PATH_LIMIT = MAX_PATH_POINTS + 2;
const MAX_PATH_LENGTH = 128;
const MAX_CONNECTIONS = 256;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positionValid = position => Array.isArray(position) && position.length === 2 && position.every(finite) && position[0] >= 94 && position[0] < 142 && position[1] >= -12 && position[1] < 7;
const rounded = number => Math.round(number * 10000) / 10000;
const identityKey = clientId => createHash('sha256').update(clientId).digest('hex');

function roomError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function appendPendingPath(previous, points) {
  const combined = [...previous, ...points];
  if (combined.length <= PENDING_PATH_LIMIT) return combined;
  // Keep the interval's starting point and latest endpoint while bounding the
  // work of a burst of motion. Intermediate points retain their path order.
  return Array.from({ length: PENDING_PATH_LIMIT }, (_, index) => combined[Math.round(index * (combined.length - 1) / (PENDING_PATH_LIMIT - 1))]);
}

export class SharedRoom extends EventEmitter {
  constructor({ records = [], snapshotVersion = null, strength = DEFAULT_RAIN_STRENGTH, persistencePath = null, clock = () => performance.now(), wallClock = () => Date.now() } = {}) {
    super();
    this.simulation = new RainSimulation().seed(records);
    this.regions = new RegionCatalog(records);
    this.national = new NationalSpace(this.regions);
    this.records = records;
    this.snapshotVersion = snapshotVersion;
    this.strength = finite(strength) && strength >= 0 && strength <= 1 ? strength : DEFAULT_RAIN_STRENGTH;
    this.persistencePath = persistencePath;
    this.clock = clock;
    this.wallClock = wallClock;
    this.lastAdvance = clock();
    this.scenes = new PerformanceScenes({ now: this.lastAdvance, wallNow: wallClock() });
    this.soundSettings = soundSettingsPatch(DEFAULT_SOUND_SETTINGS, {});
    this.epoch = randomUUID();
    this.bootstrapAvailable = true;
    this.bootstrapping = false;
    this.settingsImportInProgress = false;
    this.connections = new Map();
    this.actorRevision = 0;
    this.clientConnections = new Map();
    this.participantNumbers = new Map();
    this.participantRegions = new Map();
    this.nextParticipantNumber = 1;
    this.writeChain = Promise.resolve();
    this.phoneProgressCaches = new WeakMap();
    this.wildlifeRoster = null;
    this.rainSupplies = new Map();
  }

  async initialize() {
    if (!this.persistencePath) return this;
    try {
      const payload = JSON.parse(await readFile(this.persistencePath, 'utf8'));
      // Pre-show text/audio settings can be saved before any simulation has
      // been authorized. That settings-only envelope cannot start a show.
      if (payload.schemaVersion === 1 && payload.settingsOnly === true) {
        if (finite(payload.strength) && payload.strength >= 0 && payload.strength <= 1) this.strength = payload.strength;
        if (payload.parameters) this.simulation.setParameters(payload.parameters);
        try { if (payload.sceneSettings) this.scenes.settings = restoreSceneSettings(this.scenes.settings, payload.sceneSettings); } catch { /* Optional settings only. */ }
        try { if (payload.soundSettings) this.soundSettings = soundSettingsPatch(this.soundSettings, payload.soundSettings); } catch { /* Optional settings only. */ }
        return this;
      }
      const restored = new RainSimulation();
      if (payload.schemaVersion !== 1 || !finite(payload.savedAt) || !finite(payload.strength) || payload.strength < 0 || payload.strength > 1 || !restored.restore(payload.simulation)) throw new Error('Saved shared state is invalid.');
      restored.advanceDry(Math.max(0, (this.wallClock() - payload.savedAt) / 1000));
      restored.seed(this.records);
      this.simulation = restored;
      this.strength = payload.strength;
      // Settings may return, but the show itself always opens in paused Arrival.
      try { if (payload.sceneSettings) this.scenes.settings = restoreSceneSettings(this.scenes.settings, payload.sceneSettings); } catch { /* Ignore invalid optional settings. */ }
      try { if (payload.soundSettings) this.soundSettings = soundSettingsPatch(this.soundSettings, payload.soundSettings); } catch { /* Ignore invalid optional settings. */ }
      this.bootstrapAvailable = false;
      // Older envelopes omit identities. Stable identities never restore a
      // connection, gesture, lease, or participant presence.
      const identities = Array.isArray(payload.identities) ? payload.identities.slice(0, 100000) : [];
      const usedNumbers = new Set();
      for (const entry of identities) {
        if (!Array.isArray(entry) || entry.length !== 3) continue;
        const [key, number, regionId] = entry;
        if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(number) || number < 1 || usedNumbers.has(number) || this.participantNumbers.has(key) || !this.regions.regions.has(regionId)) continue;
        this.participantNumbers.set(key, number);
        this.participantRegions.set(key, regionId);
        usedNumbers.add(number);
        this.nextParticipantNumber = Math.max(this.nextParticipantNumber, number + 1);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') this.emit('persistenceWarning', error);
    }
    this.lastAdvance = this.clock();
    return this;
  }

  connect({ clientId, role = 'participant', scope = 'region', connectionId = randomUUID() }) {
    if (typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) throw roomError('A valid clientId is required.');
    if (!['operator', 'participant', 'projection'].includes(role)) throw roomError('Unknown connection role.');
    if (!['region', 'indonesia'].includes(scope)) throw roomError('Unknown audience scope.');
    const national = role === 'participant' && scope === 'indonesia';
    const previousId = this.clientConnections.get(clientId);
    if (previousId && this.connections.get(previousId)?.role === 'operator' && role !== 'operator') throw roomError('This identity belongs to the local operator.', 403);
    if (this.connections.size >= MAX_CONNECTIONS && !previousId) throw roomError('The room is full. Please try again shortly.', 503);
    this.advance();
    if (previousId) {
      this.connections.delete(previousId);
      this.emit('replaced', previousId);
    }
    const identity = identityKey(clientId);
    let rainSupply = null;
    if (role === 'participant') {
      rainSupply = this.rainSupplies.get(identity) ?? createRainSupply(this.clock());
      rainSupply.touching = false; rainSupply.needsRelease = false;
      advanceRainSupply(rainSupply, this.clock(), this.rainCapacity());
      this.rainSupplies.set(identity, rainSupply);
    }
    if (role === 'participant' && !this.participantNumbers.has(identity)) {
      this.participantNumbers.set(identity, this.nextParticipantNumber++);
      this.participantRegions.set(identity, this.regions.assign(this.connections));
    }
    const regionId = national ? 'indonesia' : role === 'participant' ? this.participantRegions.get(identity) : null;
    const participant = {
      id: clientId, connectionId, role, scope: national ? 'indonesia' : 'region', number: role === 'participant' ? this.participantNumbers.get(identity) : 0, regionId,
      holding: false, position: national ? countryPosition([.5, .5]) : regionId ? this.regions.map(regionId, [.5, .5]) : [117, -2], screenPosition: regionId ? [.5, .5] : null, pendingPath: [], leaseUntil: 0, requiresFreshPress: false,
      pressSerial: 0, lastPressPosition: null,
      lastSeq: -1, tokens: 20, tokenAt: this.clock(),
      rainSupply,
    };
    this.connections.set(connectionId, participant);
    this.clientConnections.set(clientId, connectionId);
    this.actorRevision += 1;
    return { type: 'welcome', connectionId, participantNumber: participant.number, assignment: national ? COUNTRY_ASSIGNMENT : this.regions.public(regionId), role, scope: participant.scope, epoch: this.epoch, bootstrapAvailable: this.bootstrapAvailable,
      ...(rainSupply ? { rainSupply: rainSupplyState(rainSupply, this.rainCapacity()) } : {}) };
  }

  disconnect(connectionId) {
    const participant = this.connections.get(connectionId);
    if (!participant) return;
    this.advance();
    if (participant.rainSupply) { participant.rainSupply.touching = false; participant.rainSupply.needsRelease = false; }
    this.connections.delete(connectionId);
    this.actorRevision += 1;
    if (this.clientConnections.get(participant.id) === connectionId) this.clientConnections.delete(participant.id);
  }

  hold(connectionId, message) {
    const participant = this.connections.get(connectionId);
    if (!participant) throw roomError('This connection is no longer active.');
    if (participant.role === 'projection') throw roomError('The projection is a read-only display.', 403);
    if (!message || message.type !== 'hold' || message.epoch !== this.epoch) throw roomError('The performance changed. Wait for its current state and press again.');
    if (!Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq <= participant.lastSeq) throw roomError('Hold sequence is stale.');
    if (typeof message.holding !== 'boolean') throw roomError('A hold must include a boolean holding state.');
    if (message.start !== undefined && typeof message.start !== 'boolean') throw roomError('A hold start flag must be a boolean.');
    if (this.bootstrapAvailable || this.bootstrapping) throw roomError('The operator must restore or start the shared performance first.', 409);
    if (message.holding && (!['participation', 'forest-takeover'].includes(this.scenes.id) || this.scenes.paused)) throw roomError('Rain input opens during Participation and Forest takeover.', 409);
    const audience = participant.role === 'participant', national = audience && participant.scope === 'indonesia';
    if (audience && message.space !== (national ? 'country' : 'region')) throw roomError(national ? 'Audience rain must use whole-country screen positions.' : 'Audience rain must use assigned-region screen positions.');
    const validate = audience ? normalizedPositionValid : positionValid;
    if ((message.holding || message.position !== undefined) && !validate(message.position)) throw roomError(audience ? 'Hold position is outside the assigned screen (0–1).' : 'Hold position is outside the map.');
    let points = message.path === undefined ? [] : message.path;
    if (!Array.isArray(points) || points.length > MAX_PATH_POINTS || !points.every(validate)) throw roomError(`Hold paths may contain at most ${MAX_PATH_POINTS} valid positions.`);
    const mapPoint = point => national ? countryPosition(point) : audience ? this.regions.map(participant.regionId, point) : point;
    const target = message.position ? mapPoint(message.position) : participant.position;
    if (audience) points = points.map(mapPoint);
    points = [participant.holding ? participant.position : target, ...points, target];
    let pathLength = 0;
    for (let index = 1; index < points.length; index += 1) pathLength += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    if (!audience && pathLength > MAX_PATH_LENGTH) throw roomError('Hold path is too long.');
    const now = this.clock();
    participant.tokens = Math.min(20, participant.tokens + Math.max(0, now - participant.tokenAt) / 100);
    participant.tokenAt = now;
    if (message.holding && participant.tokens < 1) throw roomError('Too many hold updates. Send at most ten per second.');
    if (message.holding) participant.tokens -= 1;
    // Final motion is integrated before a release, while the held interval is
    // still alive. It receives only elapsed server time, never a packet bonus.
    if (!message.holding && participant.holding && now < participant.leaseUntil) participant.pendingPath = appendPendingPath(participant.pendingPath, points);
    // Continuing motion updates its actor position immediately, but shares the
    // next 20 Hz physics step with other phones. Starts, releases and expired
    // leases still flush their exact boundary before changing any held state.
    const continuingHold = message.holding && participant.holding && message.start !== true && !participant.requiresFreshPress && now < participant.leaseUntil;
    if (!continuingHold || now - this.lastAdvance >= HOLD_BATCH_MS) this.advance(now);
    if (message.holding && participant.rainSupply?.needsRelease) {
      // An exhausted finger may remain down. Its heartbeats keep that touch
      // alive without rain or refill; only a real release permits recharging.
      participant.lastSeq = message.seq; participant.leaseUntil = now + HOLD_LEASE_MS;
      participant.rainSupply.touching = true;
      return { type: 'ack', epoch: this.epoch, seq: message.seq, holding: false, participantNumber: participant.number,
        rainSupply: rainSupplyState(participant.rainSupply, this.rainCapacity()) };
    }
    if (message.holding && participant.requiresFreshPress && message.start !== true) throw roomError('The hold expired. Lift your finger and press again.');
    if (message.holding && participant.rainSupply && participant.rainSupply.level <= 1e-9) {
      participant.rainSupply.needsRelease = true; participant.rainSupply.touching = true;
      participant.lastSeq = message.seq; participant.leaseUntil = now + HOLD_LEASE_MS;
      return { type: 'ack', epoch: this.epoch, seq: message.seq, holding: false, participantNumber: participant.number,
        rainSupply: rainSupplyState(participant.rainSupply, this.rainCapacity()) };
    }
    const newPress = message.holding && (message.start === true || !participant.holding);
    if (newPress || participant.holding !== message.holding || participant.position.some((value, index) => rounded(value) !== rounded(target[index]))) this.actorRevision += 1;
    participant.lastSeq = message.seq;
    if (newPress) { participant.pressSerial += 1; participant.lastPressPosition = [...target]; }
    participant.position = [...target];
    if (audience && message.position) participant.screenPosition = [...message.position];
    if (message.holding) {
      if (participant.rainSupply) participant.rainSupply.touching = true;
      participant.pendingPath = participant.holding ? appendPendingPath(participant.pendingPath, points) : [[...target]];
      participant.holding = true;
      participant.leaseUntil = now + HOLD_LEASE_MS;
      if (message.start === true) participant.requiresFreshPress = false;
    } else {
      if (participant.rainSupply) { participant.rainSupply.touching = false; participant.rainSupply.needsRelease = false; }
      participant.holding = false;
      participant.pendingPath = [];
      participant.leaseUntil = 0;
    }
    return { type: 'ack', epoch: this.epoch, seq: message.seq, holding: participant.holding, participantNumber: participant.number,
      ...(participant.rainSupply ? { rainSupply: rainSupplyState(participant.rainSupply, this.rainCapacity()) } : {}) };
  }

  rainCapacity() { return rainSupplyCapacity(this.simulation.parameters, this.strength); }

  _advanceScenesAt(now, wallNow) {
    const beforeId = this.scenes.id;
    const rainWasOpen = this.scenes.state(now, wallNow).audienceEnabled;
    this.scenes.advance({ now, wallNow, ...this.globalSound().fireProgress });
    const afterId = this.scenes.id;
    if (afterId === beforeId) return;
    if (beforeId === 'forest-takeover') {
      this.simulation.endForestRestoration();
    }
    if (afterId === 'forest-takeover') this.simulation.beginForestRestoration(this.national.fireKeys);
    if (beforeId === 'final-rain') this.simulation.endFinalRainCooling();
    if (afterId === 'final-rain') this.simulation.beginFinalRainCooling(this.national.fireKeys);
    if (rainWasOpen && !this.scenes.state(now, wallNow).audienceEnabled) this._clearHolds({ requireFreshPress: true, resetSequence: false });
  }

  advance(now = this.clock()) {
    if (!finite(now) || now <= this.lastAdvance) return;
    if (this.bootstrapAvailable || this.bootstrapping || this.scenes.paused) {
      for (const participant of this.connections.values()) if (participant.rainSupply)
        advanceRainSupply(participant.rainSupply, now, this.rainCapacity());
      this.lastAdvance = now;
      return;
    }
    let cursor = this.lastAdvance;
    this._advanceScenesAt(cursor, this.wallClock() - (now - cursor));
    // Discover each boundary after entering its scene. Even a single delayed
    // tick therefore restores the forest, starts rain, and measures its water
    // at the same authority times as frequent audience state packets.
    while (cursor < now) {
      let end = Math.min(now, this.scenes.nextBoundaryAt(cursor) ?? now);
      for (const participant of this.connections.values()) {
        if ((participant.holding || participant.rainSupply?.touching) && participant.leaseUntil > cursor) end = Math.min(end, participant.leaseUntil);
        if (participant.holding && participant.rainSupply)
          end = Math.min(end, cursor + participant.rainSupply.level * this.rainCapacity() * 1000);
      }
      const strokes = [];
      for (const participant of this.connections.values()) {
        if (!participant.holding || participant.leaseUntil <= cursor) continue;
        const points = participant.pendingPath.length ? participant.pendingPath : [participant.position];
        const constraint = participant.scope === 'indonesia' ? this.national.constraint : participant.regionId ? this.regions.regions.get(participant.regionId).constraint : null;
        strokes.push({ path: points, strength: audienceRainStrength(this.scenes, this.strength), ...(constraint ? { constraint } : {}) });
        participant.pendingPath = [];
      }
      if (this.scenes.id === 'forest-takeover') {
        // Rain retains ordinary cooling and its measured water budget while
        // the source fires keep returning throughout this scene.
        this.simulation.step((end - cursor) / 1000, strokes);
        this.simulation.restoreForest(this.scenes.state(end, this.wallClock()).forestRestorationProgress);
      } else if (this.scenes.id === 'final-rain') {
        this.simulation.stepFinalRain((end - cursor) / 1000,
          this.scenes.rainfallBetween(cursor, end) / (end - cursor), this.scenes.rainIntensityAt(end));
      } else this.simulation.step((end - cursor) / 1000, strokes);
      for (const participant of this.connections.values()) if (participant.rainSupply) {
        advanceRainSupply(participant.rainSupply, end, this.rainCapacity(), participant.holding);
        if (participant.holding && participant.rainSupply.level === 0) {
          participant.holding = false; participant.pendingPath = []; participant.requiresFreshPress = true;
          this.actorRevision += 1;
        }
      }
      this._advanceScenesAt(end, this.wallClock() - (now - end));
      cursor = end;
      for (const participant of this.connections.values()) {
        if ((participant.holding || participant.rainSupply?.touching) && participant.leaseUntil <= end) {
          participant.holding = false;
          participant.pendingPath = [];
          participant.leaseUntil = 0;
          participant.requiresFreshPress = true;
          if (participant.rainSupply) { participant.rainSupply.touching = false; participant.rainSupply.needsRelease = false; }
          this.actorRevision += 1;
        }
      }
    }
    this.lastAdvance = now;
  }

  actorState() {
    const participants = [...this.connections.values()].map(participant => ({ id: participant.id, number: participant.number, role: participant.role, regionId: participant.regionId, holding: participant.holding, position: participant.position.map(rounded),
      pressSerial: participant.pressSerial, pressPosition: participant.lastPressPosition?.map(rounded) ?? null }));
    return {
      type: 'actors', epoch: this.epoch, actorRevision: this.actorRevision, participants,
      joinedCount: participants.filter(participant => participant.role === 'participant').length,
      activeCount: participants.filter(participant => participant.role === 'participant' && participant.holding).length,
    };
  }

  wireState() {
    return {
      ...this.actorState(), type: 'state',
      simulation: { wireFormat: 'compact-v1', parameters: { ...this.simulation.parameters }, totalWater: rounded(this.simulation.totalWater), cells: [...this.simulation.cells.values()].map(cell => [cell.longitude, cell.latitude, rounded(cell.surfaceWetness), rounded(cell.moisture), rounded(cell.heat), cell.extinguished, rounded(cell.settledFor), cell.hasFire]) },
      strength: this.strength,
      bootstrapAvailable: this.bootstrapAvailable, snapshotVersion: this.snapshotVersion,
      ...this.globalSound(), scene: this.sceneState(), soundSettings: this.soundSettingsState(),
    };
  }

  sceneState() { return this.scenes.state(this.clock(), this.wallClock()); }

  soundSettingsState() { return { ...this.soundSettings, macros: { ...this.soundSettings.macros }, mixer: { ...this.soundSettings.mixer } }; }

  globalSound() {
    let outCount = 0, heat = 0, moisture = 0, surfaceWetness = 0;
    // Only the current snapshot's source cells define the shared condition.
    // Confirmed out fires contribute zero heat, including stale stored values.
    for (const key of this.national.fireKeys) {
      const cell = this.simulation.cells.get(key);
      if (cell?.extinguished === true) outCount++;
      else heat += cell?.heat ?? 0;
      moisture += cell?.moisture ?? 0;
      surfaceWetness += cell?.surfaceWetness ?? 0;
    }
    const sourceCount = this.national.fireKeys.size;
    return { fireProgress: { sourceCount, outCount }, soundCondition: {
      stage: sourceCount ? Math.floor(outCount * 8 / sourceCount) : 0, steps: 8, sourceCount, outCount,
      heat: sourceCount ? rounded(heat / sourceCount) : 0, moisture: sourceCount ? rounded(moisture / sourceCount) : 0,
      surfaceWetness: sourceCount ? rounded(surfaceWetness / sourceCount) : 0,
    } };
  }

  phoneState(connectionId, regionalSummaries = new Map()) {
    const participant = this.connections.get(connectionId);
    if (!participant || participant.role !== 'participant') return null;
    let globalSound = this.phoneProgressCaches.get(regionalSummaries);
    if (!globalSound) {
      globalSound = this.globalSound();
      // The broadcaster already shares this Map for one update. Cache outside
      // its region entries so the global scan runs only once for that update.
      this.phoneProgressCaches.set(regionalSummaries, globalSound);
    }
    if (!regionalSummaries.has(participant.regionId)) {
      const national = participant.scope === 'indonesia';
      const summary = national ? this.national.summary(this.simulation, this.connections) : this.regions.summary(participant.regionId, this.simulation, this.connections);
      for (const key of ['surfaceWetness', 'moisture', 'heat']) summary[key] = rounded(summary[key]);
      summary.spatial = national ? this.national.spatial(this.simulation) : phoneSpatialField(this.regions, participant.regionId, this.simulation);
      regionalSummaries.set(participant.regionId, summary);
    }
    let joinedCount = 0, activeCount = 0;
    for (const actor of this.connections.values()) if (actor.role === 'participant') { joinedCount += 1; if (actor.holding) activeCount += 1; }
    const scene = this.sceneState();
    let soundSlot, soundPhoneCount, birdEvents = [];
    if (scene.id === 'afterglow') {
      // Freeze the ensemble for this finale. Re-ranking a current bird event
      // after a join or disconnect could make two phones play the same call.
      // A disconnected slot stays quiet; a returning identity keeps its slot.
      if (!this.wildlifeRoster || this.wildlifeRoster.startedAt !== scene.startedAt) {
        const phones = [...this.connections.values()].filter(actor => actor.role === 'participant')
          .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
        this.wildlifeRoster = { startedAt: scene.startedAt, slots: new Map(phones.map((actor, slot) => [actor.id, slot])), birdOwners: new Map() };
      }
      soundSlot = this.wildlifeRoster.slots.get(participant.id) ?? -1;
      soundPhoneCount = this.wildlifeRoster.slots.size;
      // Freeze each call's owner shortly before its preload window, rather
      // than excluding every phone that joined after the ending began.
      // Once assigned, a disconnect leaves a quiet gap; it cannot double a call.
      const phones = [...this.connections.values()].filter(actor => actor.role === 'participant')
        .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
      const duration = scoreDurations(scene.settings).afterglowDurationMs;
      for (let index = 0; index < Math.ceil(duration / BIRD_MIN_GAP_MS); index++) {
        const event = birdEvent(index, scene, 1);
        if (event.atMs >= duration - 2000) break;
        if (!this.wildlifeRoster.birdOwners.has(index) && event.atMs - scene.elapsedMs <= 12000) {
          const owner = scene.elapsedMs <= event.atMs + 1000 && phones.length ? phones[(index + 3) % phones.length].id : null;
          this.wildlifeRoster.birdOwners.set(index, owner);
        }
        if (this.wildlifeRoster.birdOwners.get(index) === participant.id) birdEvents.push(index);
      }
    } else {
      this.wildlifeRoster = null;
      soundSlot = [...this.connections.values()].filter(actor => actor.role === 'participant')
        .sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)).findIndex(actor => actor === participant);
      soundPhoneCount = joinedCount;
    }
    const focus = participant.holding && participant.scope !== 'indonesia' ? phoneBrushSummary(this.regions, participant.regionId, this.simulation, participant.position) : null;
    return {
      focus: focus ? { ...focus, position: [...participant.screenPosition], seq: participant.lastSeq } : null,
      type: 'summary', epoch: this.epoch, assignment: participant.scope === 'indonesia' ? COUNTRY_ASSIGNMENT : this.regions.public(participant.regionId), participantNumber: participant.number,
      own: { id: participant.id, number: participant.number, holding: participant.holding, position: participant.position.map(rounded) },
      soundSlot, soundPhoneCount, birdEvents,
      rainSupply: rainSupplyState(participant.rainSupply, this.rainCapacity()),
      region: regionalSummaries.get(participant.regionId), ...globalSound, joinedCount, activeCount,
      strength: this.strength, bootstrapAvailable: this.bootstrapAvailable, snapshotVersion: this.snapshotVersion,
      scene, soundSettings: this.soundSettingsState(),
    };
  }

  _clearHolds({ requireFreshPress = false, resetSequence = true } = {}) {
    this.actorRevision += 1;
    for (const participant of this.connections.values()) {
      participant.holding = false;
      if (participant.rainSupply) { participant.rainSupply.touching = false; participant.rainSupply.needsRelease = false; }
      participant.pendingPath = [];
      participant.leaseUntil = 0;
      if (resetSequence) { participant.lastSeq = -1; participant.pressSerial = 0; participant.lastPressPosition = null; }
      participant.requiresFreshPress = requireFreshPress;
    }
  }

  async bootstrap({ state = null, strength = this.strength } = {}) {
    this._assertSettingsEditable();
    if (!this.bootstrapAvailable || this.bootstrapping) throw roomError('The shared performance has already been initialized.', 409);
    if (!finite(strength) || strength < 0 || strength > 1) throw roomError('Rain strength must be between zero and one.');
    const simulation = new RainSimulation(this.simulation.parameters);
    if (state !== null && !simulation.restore(state)) throw roomError('The saved browser state is invalid.');
    simulation.seed(this.records);
    this.bootstrapping = true;
    try {
      await this._writeEnvelope(this._envelope(simulation, strength));
      this.simulation = simulation;
      this.strength = strength;
      this.bootstrapAvailable = false;
      this.epoch = randomUUID();
      this._clearHolds();
      this.lastAdvance = this.clock();
    } finally { this.bootstrapping = false; }
    return this.wireState();
  }

  async reset() {
    this._assertSettingsEditable();
    if (this.bootstrapAvailable) return this._startFreshPerformance({ action: 'restart' });
    this.advance();
    this.simulation.reset();
    this.scenes.enter('arrival', this.clock(), this.wallClock(), true);
    this._clearHolds();
    this.epoch = randomUUID();
    await this.persist();
    return this.wireState();
  }

  async setStrength(strength) {
    this._assertSettingsEditable();
    if (!finite(strength) || strength < 0 || strength > 1) throw roomError('Rain strength must be between zero and one.');
    this.advance();
    this.strength = strength;
    if (!this.bootstrapAvailable) await this.persist();
    return this.wireState();
  }

  async setParameters(parameters) {
    this._assertSettingsEditable();
    const validator = new RainSimulation(this.simulation.parameters);
    if (!validator.setParameters(parameters)) throw roomError('Performance timing parameters are invalid.');
    this.advance();
    this.simulation.setParameters(parameters);
    if (!this.bootstrapAvailable) await this.persist();
    return this.wireState();
  }

  async setScene(body) {
    this._assertSettingsEditable();
    // Choosing a cue or starting the clock is the operator's authorization to
    // initialize a fresh install. Browsing and preparing settings still leave
    // the previous browser-save migration available until that deliberate act.
    if (this.bootstrapAvailable && (['resume', 'restart'].includes(body?.action)
      || (body?.scene !== undefined && !['afterglow', 'ended'].includes(body.scene)))) return this._startFreshPerformance(body);
    this.advance();
    const before = this.scenes.revision, beforeId = this.scenes.id, rainWasOpen = this.scenes.state(this.clock(), this.wallClock()).audienceEnabled;
    this.scenes.update(body, { now: this.clock(), wallNow: this.wallClock(), ...this.globalSound().fireProgress });
    if (body.settings !== undefined && body.scene === undefined) {
      const timed = this.scenes.timedScene();
      if (timed && this.scenes.elapsedAt(this.clock()) > timed[0]) { this.scenes.elapsed = timed[0]; this.scenes.anchor = this.clock(); }
      if (timed) this._advanceScenesAt(this.clock(), this.wallClock());
    }
    if (body.scene === 'forest-takeover') this.simulation.beginForestRestoration(this.national.fireKeys);
    if (this.scenes.id === 'forest-takeover') {
      const restoration = this.scenes.state(this.clock(), this.wallClock());
      this.simulation.restoreForest(restoration.forestRestorationProgress);
    }
    if (beforeId === 'forest-takeover' && this.scenes.id !== 'forest-takeover') this.simulation.endForestRestoration();
    if (this.scenes.id === 'final-rain') {
      if (beforeId !== 'final-rain' || body.scene === 'final-rain') this.simulation.beginFinalRainCooling(this.national.fireKeys);
      this.simulation.coolFinalRain(this.scenes.rainIntensityAt(this.clock()));
      // A shortened duration may complete at this edit. Begin the release at
      // that exact boundary, without manufacturing another tick of full rain.
      if (body.settings !== undefined) {
        const duration = this.scenes.state(this.clock(), this.wallClock()).finalRainRampDurationMs;
        if (this.scenes.elapsedAt(this.clock()) > duration) { this.scenes.elapsed = duration; this.scenes.anchor = this.clock(); }
      }
      this.scenes.advance({ now: this.clock(), wallNow: this.wallClock(), ...this.globalSound().fireProgress });
    }
    if (this.scenes.id !== 'final-rain') this.simulation.endFinalRainCooling();
    const keepsRainOpen = body.scene !== undefined && rainWasOpen && this.scenes.state(this.clock(), this.wallClock()).audienceEnabled;
    if (this.scenes.revision !== before && (body.scene !== undefined || body.action !== undefined) && !keepsRainOpen) this._clearHolds({ requireFreshPress: true, resetSequence: false });
    this.lastAdvance = this.clock();
    if (this.bootstrapAvailable && body.settings !== undefined) await this._writeSettings();
    else await this.persist();
    return this.wireState();
  }

  async _startFreshPerformance(body) {
    this._assertSettingsEditable();
    const simulation = new RainSimulation(this.simulation.parameters).seed(this.records);
    const scenes = new PerformanceScenes({ now: this.clock(), wallNow: this.wallClock(), settings: this.scenes.settings });
    scenes.revision = this.scenes.revision;
    // Validate the complete command on detached state before a save or any
    // in-memory initialization. Invalid cues must not consume migration.
    scenes.update(body, { now: this.clock(), wallNow: this.wallClock(), sourceCount: this.national.fireKeys.size, outCount: 0 });
    if (scenes.id === 'forest-takeover') simulation.beginForestRestoration(this.national.fireKeys);
    if (scenes.id === 'final-rain') {
      simulation.beginFinalRainCooling(this.national.fireKeys);
      simulation.coolFinalRain(0);
    }
    const envelope = { ...this._envelope(simulation), sceneSettings: { ...scenes.settings } };
    this.bootstrapping = true;
    try {
      await this._writeEnvelope(envelope, () => {
        this.simulation = simulation;
        this.scenes = scenes;
        // A slow save must not use up the opening of the selected cue.
        this.scenes.anchor = this.clock();
        this.scenes.startedAt = this.wallClock();
        this.bootstrapAvailable = false;
        this.epoch = randomUUID();
        this._clearHolds();
        this.lastAdvance = this.clock();
      });
    } finally { this.bootstrapping = false; }
    return this.wireState();
  }

  async setSoundSettings(patch) {
    this._assertSettingsEditable();
    this.soundSettings = soundSettingsPatch(this.soundSettings, patch);
    if (this.bootstrapAvailable) await this._writeSettings();
    else await this.persist();
    return this.wireState();
  }

  exportSettingsPreset() {
    return createSettingsPreset({ strength: this.strength, parameters: this.simulation.parameters,
      sceneSettings: this.scenes.settings, soundSettings: this.soundSettings });
  }

  _assertSettingsEditable() {
    if (this.settingsImportInProgress) throw roomError('A settings import is still being saved. Try this change again when it finishes.', 409);
    if (this.bootstrapping) throw roomError('The performance is being initialized. Try this change again when it finishes.', 409);
  }

  async importSettingsPreset(preset) {
    this._assertSettingsEditable();
    if (this.bootstrapping) throw roomError('The performance is being initialized. Import settings when it finishes.', 409);
    const next = validateSettingsPreset(preset);
    this.settingsImportInProgress = true;
    // Save first so a failed write cannot leave a partially applied import.
    // Read the landscape when this write reaches the queue, preserving any
    // ordinary simulation progress while earlier saves finish.
    try {
      await this._writeEnvelope(() => this.bootstrapAvailable
        ? { schemaVersion: 1, settingsOnly: true, strength: next.strength, parameters: next.parameters,
          sceneSettings: next.sceneSettings, soundSettings: next.soundSettings }
        : { ...this._envelope(), strength: next.strength,
          simulation: { ...this.simulation.serialize(), parameters: next.parameters },
          sceneSettings: next.sceneSettings, soundSettings: next.soundSettings }, () => {
        this.strength = next.strength;
        this.simulation.setParameters(next.parameters);
        this.scenes.settings = next.sceneSettings;
        this.scenes.revision += 1;
        this.soundSettings = next.soundSettings;
      });
    } finally {
      this.settingsImportInProgress = false;
    }
    return this.wireState();
  }

  seed(records, snapshotVersion = null) {
    this._assertSettingsEditable();
    this.advance();
    this.records = records;
    this.snapshotVersion = snapshotVersion;
    this.simulation.seed(records);
    this.simulation.endForestRestoration();
    this.simulation.endFinalRainCooling();
    this.regions.seed(records);
    this.national.refresh();
    this.scenes.enter('arrival', this.clock(), this.wallClock(), true);
    this._clearHolds({ requireFreshPress: true, resetSequence: false });
  }

  _envelope(simulation = this.simulation, strength = this.strength) {
    return { schemaVersion: 1, savedAt: this.wallClock(), strength, simulation: simulation.serialize(), sceneSettings: { ...this.scenes.settings }, soundSettings: this.soundSettingsState(), identities: [...this.participantNumbers].map(([key, number]) => [key, number, this.participantRegions.get(key)]) };
  }

  _writeSettings() {
    return this._writeEnvelope(() => ({ schemaVersion: 1, settingsOnly: true, strength: this.strength,
      parameters: { ...this.simulation.parameters }, sceneSettings: { ...this.scenes.settings }, soundSettings: this.soundSettingsState() }));
  }

  _writeEnvelope(envelope, commit) {
    if (!this.persistencePath) { commit?.(); return Promise.resolve(); }
    const save = this.writeChain.catch(() => {}).then(async () => {
      const serialized = JSON.stringify(typeof envelope === 'function' ? envelope() : envelope);
      await mkdir(path.dirname(this.persistencePath), { recursive: true });
      const temporary = `${this.persistencePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.persistencePath);
        commit?.();
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    });
    this.writeChain = save;
    return save;
  }

  persist() {
    if (this.bootstrapAvailable || this.bootstrapping) return Promise.resolve();
    this.advance();
    return this._writeEnvelope(() => this._envelope());
  }
}
