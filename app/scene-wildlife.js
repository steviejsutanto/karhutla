import { scoreDurations, phoneRetreatGain } from './scene-score.js';
import { PHONE_CRICKET_LEVEL } from './phone-crickets.js';
const disconnect = node => { try { node?.disconnect(); } catch {} };
const stop = node => { try { node?.stop(); } catch {} };
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const hash = value => { let x = (value + 1) | 0; x = Math.imul(x ^ x >>> 16, 0x45d9f3b); x = Math.imul(x ^ x >>> 16, 0x45d9f3b); return (x ^ x >>> 16) >>> 0; };
export const ORANGUTAN_INTERVAL_MS = 27000;
// Brief bird calls balanced against the insect field. Recordings are prepared by
// their active call body, so silent edges cannot amplify a very short call.
export const PHONE_BIRD_RELATIVE_DB = 8.5;
export const PHONE_BIRD_LEVEL = PHONE_CRICKET_LEVEL * 10 ** (PHONE_BIRD_RELATIVE_DB / 20);
export const BIRD_MIN_GAP_MS = 4000;
export const BIRD_MAX_GAP_MS = 8000;
const LOCAL_WILDLIFE_URL = /^\/audio-assets\/v3\/[a-z0-9-]+\.mp3(?:\?v=[a-f0-9]{12})?$/;
const ORANGUTAN_URL = /\/[^/]*orangutan[^/]*\.mp3(?:\?|$)/;
const LEGACY_COO_URL = /\/rainforest-bird-low-[ab]-v25\.mp3(?:\?|$)/;

// Strip the other role's recording before either the engine or controller
// retains it. The phone source bank can never contain the Main animal voice.
export function wildlifeSourcesForRole(value, mode = 'phone') {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (mode === 'operator') {
    return typeof value.orangutan === 'string' && LOCAL_WILDLIFE_URL.test(value.orangutan)
      ? { orangutan: value.orangutan } : undefined;
  }
  return Array.isArray(value.birds) && value.birds.length > 0 && value.birds.length <= 3 &&
    new Set(value.birds).size === value.birds.length && value.birds.every(url =>
      typeof url === 'string' && LOCAL_WILDLIFE_URL.test(url) && !ORANGUTAN_URL.test(url) && !LEGACY_COO_URL.test(url))
    ? { birds: [...value.birds] } : undefined;
}

// Main alone gets a small, dark room tail. Its wet path joins before the
// existing wildlife gain, so both trims and the final retreat still govern it.
function orangutanReverb(context, input, output) {
  if (!context.createConvolver || !context.createBuffer || !context.sampleRate) return null;
  const convolver = context.createConvolver(), filter = context.createBiquadFilter(), gain = context.createGain();
  const seconds = 1.65, buffer = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel); let seed = 59173 + channel * 1937, low = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      low = .72 * low + .28 * (seed / 4294967296 * 2 - 1);
      const time = i / context.sampleRate;
      data[i] = low * smooth(time / .035) * Math.exp(-time / .36) * (1 - smooth((time - 1.3) / .35));
    }
  }
  convolver.buffer = buffer; convolver.normalize = true;
  filter.type = 'lowpass'; filter.frequency.value = 1400; filter.Q.value = .35;
  gain.gain.value = .12;
  input.connect(convolver); convolver.connect(filter); filter.connect(gain); gain.connect(output);
  return { convolver, filter, gain, seconds };
}

// One fixed gain per decoded recording, preserving its original dynamics.
// Main retains its original whole-phrase preparation. Phone bird calls use the
// span between 10%-peak crossings; quiet padding cannot boost their body.
export function normalizeWildlifeRecording(buffer, { activeBody = false } = {}) {
  let peak = 0, power = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (const value of data) {
      if (!Number.isFinite(value)) throw new Error('Wildlife recording has invalid samples.');
      peak = Math.max(peak, Math.abs(value)); power += value * value; count++;
    }
  }
  const rms = Math.sqrt(power / Math.max(1, count));
  let bodyRms = rms;
  if (activeBody && peak > .00001) {
    let first = Infinity, last = -1;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++) if (Math.abs(data[index]) >= peak * .1) {
        first = Math.min(first, index); last = Math.max(last, index);
      }
    }
    let bodyPower = 0, bodyCount = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = first; index <= last; index++) { bodyPower += data[index] ** 2; bodyCount++; }
    }
    bodyRms = Math.sqrt(bodyPower / Math.max(1, bodyCount));
  }
  const gain = Math.min(bodyRms > .00001 ? Math.min(16, .085 / bodyRms) : 1, peak > 0 ? .90 / peak : 1);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) data[index] *= gain;
  }
  return { rms, peak, bodyRms, activeBody, gain, outputRms: rms * gain, outputBodyRms: bodyRms * gain, outputPeak: peak * gain };
}

export function wildlifeEnvelope(scene, elapsedMs, tailLevel = 1) {
  if (scene?.id !== 'afterglow') return 0;
  const d = scoreDurations(scene.settings), handoff = d.paCricketOnlyStartMs + d.paCricketOnlyMs;
  const phoneOnly = handoff + d.cricketHandoffMs, retreat = phoneOnly + d.phoneOnlyMs;
  const entrance = smooth((elapsedMs - d.rainCricketOverlapMs * .4) / (d.rainCricketOverlapMs * .6));
  const tail = Number.isFinite(tailLevel) ? Math.max(0, Math.min(2, tailLevel)) : 1;
  const transfer = 1 + (.16 * tail - 1) * smooth((elapsedMs - handoff) / d.cricketHandoffMs);
  return entrance * transfer * phoneRetreatGain(Math.max(0, elapsedMs - retreat), d.phoneFadeMs);
}

// One brief bird recording at a time across the room. Each complete call can
// contain several syllables; irregular rests and changing material keep the
// ensemble from forming a repeating pattern or multiplying with phone count.
export function birdEvent(index, scene, count = 1) {
  const d = scoreDurations(scene?.settings), start = d.paCricketOnlyStartMs + d.paCricketOnlyMs;
  const wallStart = Number(scene?.startedAt), seed = hash(Number.isFinite(wallStart) ? Math.floor(wallStart) : 0);
  // Let the phone insect bed finish its transfer and native entrance first;
  // an early bird otherwise stands above crickets that are still fading in.
  let atMs = start + d.cricketHandoffMs + 4000 + hash(seed ^ 0x5e19) % 4000;
  for (let previous = 1; previous <= index; previous++)
    atMs += BIRD_MIN_GAP_MS + hash(seed ^ Math.imul(previous, 19349663)) % (BIRD_MAX_GAP_MS - BIRD_MIN_GAP_MS + 1);
  let asset = hash(seed ^ 0x6b17) % 3;
  for (let previous = 1; previous <= index; previous++)
    asset = (asset + 1 + hash(seed ^ Math.imul(previous, 73856093)) % 2) % 3;
  return { atMs, slot: (index + 3) % Math.max(1, count), asset, variant: asset, rate: 1 };
}

export class SceneWildlifeAudio {
  constructor({ context, destination, mode = 'phone', fetchImpl = globalThis.fetch }) {
    this.context = context; this.mode = mode; this.fetchImpl = fetchImpl;
    this.sources = null; this.buffers = new Map(); this.preparation = new Map(); this.requests = new Map(); this.errors = new Map();
    this.shots = new Set(); this.seen = new Set(); this.resumeEvents = new Set(); this.slot = -1; this.count = 1; this.eventIndices = null; this.sceneKey = null;
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = mode === 'operator' ? 1800 : 4200;
    this.filter.Q.value = .35; this.gain = context.createGain(); this.gain.gain.value = 0;
    this.presence = null;
    this.filter.connect(this.gain);
    this.reverb = mode === 'operator' ? orangutanReverb(context, this.filter, this.gain) : null;
    this.reverbDirty = false;
    this.gain.connect(destination); this.active = false; this.destroyed = false;
  }
  setSources(value) {
    const sources = wildlifeSourcesForRole(value, this.mode);
    if (sources === undefined) return false;
    if (JSON.stringify(sources) !== JSON.stringify(this.sources)) { this.stop(); this.buffers.clear(); this.preparation.clear(); this.errors.clear(); this.sources = sources; }
    return true;
  }
  setAudience({ slot, count, events } = {}) {
    this.slot = Number.isSafeInteger(slot) && slot >= 0 ? slot : -1;
    this.count = Number.isSafeInteger(count) && count > 0 ? count : 1;
    this.eventIndices = Array.isArray(events) && events.length <= 128 && events.every(index => Number.isSafeInteger(index) && index >= 0 && index < 128)
      ? new Set(events) : null;
  }
  _load(url) {
    const allowed = this.mode === 'operator' ? url === this.sources?.orangutan
      : this.sources?.birds.includes(url) && !ORANGUTAN_URL.test(url) && !LEGACY_COO_URL.test(url);
    if (!allowed) return;
    if (!url || this.buffers.has(url) || this.requests.has(url) || this.errors.has(url)) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    const request = { controller }; this.requests.set(url, request);
    Promise.resolve().then(async () => {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Wildlife recording unavailable.');
      const declared = Number(response.headers?.get?.('content-length'));
      if (declared > 500000) throw new Error('Wildlife recording too large.');
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 500000) throw new Error('Wildlife recording is empty or too large.');
      const buffer = await this.context.decodeAudioData(bytes);
      if (!(buffer.duration > 0 && buffer.duration <= 20) || !(buffer.numberOfChannels >= 1 && buffer.numberOfChannels <= 2)) throw new Error('Wildlife recording exceeds its mobile budget.');
      if (!this.destroyed && !controller.signal.aborted && this.requests.get(url) === request) {
        this.preparation.set(url, normalizeWildlifeRecording(buffer, { activeBody: this.mode === 'phone' })); this.buffers.set(url, buffer);
      }
    }).catch(error => { if (!controller.signal.aborted) this.errors.set(url, error.message); })
      .finally(() => { clearTimeout(timer); if (this.requests.get(url) === request) this.requests.delete(url); });
  }
  update({ active, scene, elapsedMs = 0, level = 1, tailLevel = 1 }) {
    const key = scene?.id === 'afterglow' ? `afterglow:${scene.startedAt ?? 0}` : null;
    if (key !== this.sceneKey) { this.stop(); this.seen.clear(); this.sceneKey = key; }
    this.active = Boolean(active && key && this.sources && !this.destroyed);
    if (!this.active) { this.stop(); return; }
    const now = this.context.currentTime, d = scoreDurations(scene.settings);
    // Main has its own pre-protection gain: its faint orangutan tail survives
    // the existing cricket master reaching zero during the phone-only phase.
    const weight = this.mode === 'operator' ? .035 * level * wildlifeEnvelope(scene, elapsedMs, tailLevel) : PHONE_BIRD_LEVEL;
    this.gain.gain.setTargetAtTime(weight, now, .12);
    if (scene.paused) {
      // Freeze one-shot transport; resumption picks up its show-clock offset.
      this._clearShots(true); this._clearReverbHistory(); return;
    }
    const events = [];
    if (this.mode === 'operator') {
      const first = d.rainCricketOverlapMs * .55;
      for (let index = 0; first + index * ORANGUTAN_INTERVAL_MS < d.afterglowDurationMs; index++)
        events.push({ id: `orangutan:${index}`, atMs: first + index * ORANGUTAN_INTERVAL_MS, url: this.sources.orangutan, rate: 1 });
    } else if (this.slot >= 0 || this.eventIndices) {
      for (let index = 0; index < Math.ceil(d.afterglowDurationMs / BIRD_MIN_GAP_MS); index++) {
        const event = birdEvent(index, scene, this.count);
        if (event.atMs >= d.afterglowDurationMs - 2000) break;
        if (this.eventIndices ? this.eventIndices.has(index) : event.slot === this.slot)
          events.push({ ...event, id: `bird:${index}`, url: this.sources.birds[event.asset % this.sources.birds.length] });
      }
    }
    for (const event of events) {
      if (this.seen.has(event.id)) continue;
      const age = (elapsedMs - event.atMs) / 1000;
      if (age < -12) continue;
      this._load(event.url);
      const buffer = this.buffers.get(event.url);
      if (age < 0 || !buffer) continue;
      const offset = (event.sourceOffset ?? 0) + age * event.rate;
      const remaining = (event.durationSeconds ?? buffer.duration / event.rate) - age;
      if (offset >= buffer.duration || remaining <= 0 || age > 1 && !this.resumeEvents.has(event.id)) { this.seen.add(event.id); this.resumeEvents.delete(event.id); continue; }
      const source = this.context.createBufferSource(), envelope = this.context.createGain();
      source.buffer = buffer; source.loop = false; source.playbackRate.value = event.rate;
      const at = now + .02, duration = Math.min(remaining, (buffer.duration - offset) / event.rate);
      const release = this.mode === 'phone' ? Math.min(.08, duration / 4) : .65;
      envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(1, at + Math.min(this.mode === 'phone' ? .025 : .3, duration / 3));
      envelope.gain.setValueAtTime(1, at + Math.max(duration / 3, duration - release)); envelope.gain.linearRampToValueAtTime(0, at + duration);
      source.connect(envelope); envelope.connect(this.filter);
      const shot = { source, envelope, id: event.id, variant: event.variant ?? null, sourceOffset: offset, durationSeconds: duration };
      source.onended = () => { disconnect(source); disconnect(envelope); this.shots.delete(shot); };
      this.shots.add(shot); this.seen.add(event.id); this.resumeEvents.delete(event.id); source.start(at, offset); source.stop(at + duration + .01);
      if (this.reverb) this.reverbDirty = true;
    }
  }
  _clearShots(resume = false) {
    for (const shot of this.shots) {
      if (resume) { this.seen.delete(shot.id); this.resumeEvents.add(shot.id); }
      stop(shot.source); disconnect(shot.source); disconnect(shot.envelope);
    }
    if (!resume) { for (const id of this.resumeEvents) this.seen.add(id); this.resumeEvents.clear(); }
    this.shots.clear();
  }
  stop() {
    this.active = false;
    this._clearShots();
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear();
    this._clearReverbHistory();
    this.gain.gain.setTargetAtTime(0, this.context.currentTime, .025);
  }
  _clearReverbHistory() {
    if (!this.reverb || !this.reverbDirty) return;
    const previous = this.reverb.convolver, impulse = previous.buffer;
    // Suspending a context freezes a convolver's delay history. Replace only
    // after a real phrase, so unmuting never replays its old room tail and an
    // inactive scheduler does not continually allocate fresh audio nodes.
    try { this.filter.disconnect(previous); } catch {}
    disconnect(previous); previous.buffer = null;
    const convolver = this.context.createConvolver(); convolver.buffer = impulse; convolver.normalize = true;
    this.filter.connect(convolver); convolver.connect(this.reverb.filter); this.reverb.convolver = convolver;
    this.reverbDirty = false;
  }
  destroy() {
    this.stop(); this.destroyed = true; this.buffers.clear(); this.preparation.clear();
    disconnect(this.filter); disconnect(this.presence); disconnect(this.gain);
    if (this.reverb) { for (const node of [this.reverb.convolver, this.reverb.filter, this.reverb.gain]) disconnect(node); this.reverb.convolver.buffer = null; this.reverb = null; }
  }
  getMetrics() { return { active: this.active, slot: this.slot, phoneCount: this.count, playing: this.shots.size,
    decodedBytes: [...this.buffers.values()].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0),
    errors: Object.fromEntries(this.errors), preparation: Object.fromEntries(this.preparation), scheduled: [...this.seen],
    reverb: this.reverb ? { seconds: this.reverb.seconds, wet: .12, lowpass: 1400 } : null,
    birdLevel: PHONE_BIRD_LEVEL, birdRelativeToCricketsDb: PHONE_BIRD_RELATIVE_DB, birdPresenceHz: null,
    birdLowpassHz: this.mode === 'phone' ? 4200 : null }; }
}
