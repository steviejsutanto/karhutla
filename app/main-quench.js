// Main-only woodfire quench one-shots. No interaction is queued while loading.
const MAX_QUENCHES = 8, MAX_QUENCH_ASSETS = 4, MAX_QUENCH_BYTES = 1500000, MAX_QUENCH_SECONDS = 4;
const QUENCH_PEAK = .16, QUENCH_ATTACK = .008, QUENCH_RELEASE = .08, LOAD_TIMEOUT_MS = 12000;
const disconnect = node => { try { node?.disconnect(); } catch {} };
const stop = (node, at) => { try { node?.stop(at); } catch {} };
const loadError = message => new Error(message);
function hold(parameter, at, value) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { parameter.cancelScheduledValues(at); parameter.setValueAtTime(value, at); }
}
function quenchEnvelopeAt(voice, age) {
  if (age <= 0 || age >= voice.duration) return 0;
  return QUENCH_PEAK * Math.min(1, age / QUENCH_ATTACK, (voice.duration - age) / QUENCH_RELEASE);
}
export function normalizeQuenchSources(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_QUENCH_ASSETS) throw loadError('Choose up to four quench recordings.');
  const seen = new Set(), ids = new Set();
  return entries.map((entry, index) => {
    const url = typeof entry === 'string' ? entry : entry?.url;
    const id = typeof entry === 'string' ? `quench-${index + 1}` : entry?.id ?? `quench-${index + 1}`;
    if (typeof url !== 'string' || !url || url.length > 2048 || url !== url.trim() || /[\u0000-\u0020]/.test(url)) throw loadError('A quench recording URL is invalid.');
    let parsed;
    try { parsed = new URL(url, globalThis.location?.href ?? 'https://local.invalid/'); } catch { throw loadError('A quench recording URL is invalid.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || seen.has(url)) throw loadError('Quench recordings need unique HTTP or local URLs.');
    if (typeof id !== 'string' || !id || id.length > 128 || ids.has(id)) throw loadError('Quench recording IDs must be unique.');
    seen.add(url); ids.add(id); return Object.freeze({ id, url });
  });
}

export class MainQuenchAudio {
  constructor({ context, destination, fetchImpl, makeSpatialPath, positionPath, loadTimeoutMs = LOAD_TIMEOUT_MS, avoidImmediateRepeat = false }) {
    this.context = context; this.destination = destination;
    this.makeSpatialPath = makeSpatialPath; this.positionPath = positionPath;
    this.output = context.createGain(); this.output.gain.value = 0; this.output.connect(destination);
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.loadTimeoutMs = Math.max(1, Math.min(15000, Number(loadTimeoutMs) || LOAD_TIMEOUT_MS));
    this.active = false; this.destroyed = false; this.weight = 1; this.participantCount = 0; this.crowdGain = 1;
    this.avoidImmediateRepeat = avoidImmediateRepeat === true;
    this.quenches = new Set(); this.retiringQuenches = new Set(); this.quenchesTriggered = 0; this.lastQuenchAssetId = null;
    this.quenchEntries = []; this.quenchBank = []; this.quenchBankKey = ''; this.quenchDesiredKey = ''; this.quenchAttemptedKey = null;
    this.quenchRequest = null; this.quenchCache = new Map(); this.quenchDecodes = new Set(); this.quenchError = null; this.quenchAssetErrors = {};
  }
  configure({ active = this.active, weight = this.weight, participantCount = this.participantCount } = {}) {
    this.weight = Math.max(0, Math.min(2, Number(weight) || 0));
    this.participantCount = Math.max(0, Math.min(4096, Number(participantCount) || 0));
    this.setActive(active); this._syncGain();
  }
  setActive(value) {
    if (this.destroyed) return;
    const active = Boolean(value);
    if (!active) {
      this._cancelQuenchLoad(); this._stopQuenches(.04);
      // The shared room is flushed by the owning Main engine. Prevent dying
      // sources from writing old shot history back into that fresh room.
      const now = this.context.currentTime;
      this.output.gain.cancelScheduledValues(now); this.output.gain.setValueAtTime(0, now);
      this.outputTarget = 0; this.outputEnvelope = { from: 0, value: 0, at: now, seconds: .012 };
    }
    if (active && !this.active) for (const voice of [...this.retiringQuenches]) this._disposeQuench(voice);
    this.active = active;
    if (active) this._ensureQuenchLoad();
    this._syncGain();
  }
  _syncGain() {
    // Blend only the small pool of overlapping recordings. More connected or
    // holding listeners cannot make one unchanged quench/blob quieter.
    const count = Math.max(1, this.quenches.size + this.retiringQuenches.size);
    this.crowdGain = 1 / Math.sqrt(count);
    const value = this.active ? this.weight * this.crowdGain : 0, now = this.context.currentTime;
    if (this.outputTarget === value) return;
    const previous = this.outputTarget ?? 0; this.outputTarget = value;
    const state = this.outputEnvelope;
    const from = state ? state.value + (state.from - state.value) * Math.exp(-Math.max(0, now - state.at) / state.seconds) : 0;
    const seconds = value < previous ? .012 : .08;
    hold(this.output.gain, now, from);
    this.output.gain.setTargetAtTime(value, now, seconds);
    this.outputEnvelope = { from, value, at: now, seconds };
  }
  trigger(patch) {
    if (this.destroyed || !this.active || !patch || !this.quenchBank.length) return false;
    const now = this.context.currentTime;
    if (this.burstAt == null || now - this.burstAt >= .08) { this.burstAt = now; this.burstCount = 0; }
    if (this.burstCount >= MAX_QUENCHES) return false;
    this.burstCount++;
    return Boolean(this._playQuench(now, patch));
  }
  setSources(entries) {
    if (this.destroyed) return Promise.resolve(false);
    let normalized;
    try { normalized = normalizeQuenchSources(entries); } catch (error) { this.quenchError = error.message; return Promise.resolve(false); }
    const key = JSON.stringify(normalized);
    if (this.quenchRequest?.key === key) return this.quenchRequest.promise;
    this._cancelQuenchLoad(); this.quenchEntries = normalized; this.quenchDesiredKey = key;
    if (!normalized.length) {
      this.quenchBank = []; this.quenchBankKey = key; this.quenchCache.clear(); this.quenchError = null; this.quenchAssetErrors = {};
      this._stopQuenches(.04); return Promise.resolve(true);
    }
    if (this.quenchBankKey === key) { this.quenchError = null; this.quenchAssetErrors = {}; return Promise.resolve(true); }
    return this.active ? this._loadQuenchBank() : Promise.resolve(true);
  }

  _ensureQuenchLoad() {
    if (this.quenchEntries.length && !this.quenchRequest && this.quenchAttemptedKey !== this.quenchDesiredKey && this.quenchBankKey !== this.quenchDesiredKey) void this._loadQuenchBank();
  }
  _cancelQuenchLoad() {
    const request = this.quenchRequest;
    if (!request) return;
    this.quenchRequest = null; this.quenchAttemptedKey = null; request.controller.abort();
  }
  _loadQuenchBank() {
    const request = { key: this.quenchDesiredKey, entries: this.quenchEntries, controller: new AbortController() };
    const signal = request.controller.signal, current = () => !this.destroyed && this.quenchRequest === request && !signal.aborted;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    // Cached banks may finish without entering a race; cancellation must still
    // be a handled promise in that case.
    void aborted.catch(() => {});
    const abort = () => rejectAbort(loadError(request.timedOut ? 'Quench recordings took too long to load.' : 'Quench loading cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    const bounded = operation => Promise.race([operation, aborted]);
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, this.loadTimeoutMs);
    this.quenchRequest = request; this.quenchAttemptedKey = request.key; this.quenchError = null; this.quenchAssetErrors = {};
    const outcomes = new Array(request.entries.length); let next = 0;
    const load = async entry => {
      const cached = this.quenchCache.get(entry.url); if (cached) return { ...entry, buffer: cached };
      if (!current()) throw loadError('Quench loading cancelled.');
      const response = await bounded(Promise.resolve().then(() => {
        if (!current()) throw loadError('Quench loading cancelled.');
        return this.fetchImpl(entry.url, { signal, cache: 'force-cache' });
      }));
      if (!current()) throw loadError('Quench loading cancelled.');
      if (!response?.ok) throw loadError(`Quench recording unavailable (${response?.status ?? 'network'}).`);
      const advertised = Number(response.headers?.get?.('content-length'));
      if (advertised > MAX_QUENCH_BYTES) throw loadError('Quench recording is too large.');
      const bytes = await bounded(Promise.resolve().then(() => response.arrayBuffer()));
      if (!current()) throw loadError('Quench loading cancelled.');
      if (!bytes?.byteLength || bytes.byteLength > MAX_QUENCH_BYTES) throw loadError('Quench recording is empty or too large.');
      // Native decoding cannot be aborted. Keep at most two native decodes,
      // including stale ones, and never let late completion populate the bank.
      while (this.quenchDecodes.size >= 2) await bounded(Promise.race([...this.quenchDecodes].map(job => job.catch(() => null))));
      if (!current()) throw loadError('Quench loading cancelled.');
      let job;
      job = Promise.resolve().then(() => {
        if (!current()) throw loadError('Quench loading cancelled.');
        return this.context.decodeAudioData(bytes);
      }).finally(() => this.quenchDecodes.delete(job));
      this.quenchDecodes.add(job);
      const buffer = await bounded(job);
      if (!current()) throw loadError('Quench loading cancelled.');
      if (!(buffer?.duration > .05 && buffer.duration <= MAX_QUENCH_SECONDS) || !(buffer.numberOfChannels >= 1 && buffer.numberOfChannels <= 2) || buffer.sampleRate !== this.context.sampleRate) throw loadError('Quench recording must be a short mono or stereo sound.');
      return { ...entry, buffer };
    };
    const worker = async () => {
      while (next < request.entries.length && !signal.aborted) {
        const index = next++;
        try { outcomes[index] = { value: await load(request.entries[index]) }; }
        catch (error) { outcomes[index] = { error: error?.message ?? 'Quench recording could not load.' }; }
      }
    };
    request.promise = Promise.all([worker(), worker()]).then(() => {
      if (this.destroyed || this.quenchRequest !== request) return false;
      this.quenchRequest = null;
      const bank = outcomes.flatMap(result => result?.value ? [result.value] : []);
      this.quenchAssetErrors = Object.fromEntries(request.entries.flatMap((entry, index) => outcomes[index]?.value ? [] : [[entry.id, outcomes[index]?.error ?? 'Quench recording took too long to load.']]));
      if (bank.length && !signal.aborted) {
        // Swap once after the bank settles; never play a delayed old gesture.
        this.quenchBank = bank; this.quenchBankKey = request.key; this.quenchCache = new Map(bank.map(entry => [entry.url, entry.buffer])); this.quenchError = null; return true;
      }
      this.quenchError = Object.values(this.quenchAssetErrors)[0] ?? 'Quench recordings could not load.'; return false;
    }).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
    return request.promise;
  }

  _playQuench(at, patch) {
    if (!this.quenchBank.length) return null;
    if (this.quenches.size >= MAX_QUENCHES) this._retireQuench(this.quenches.values().next().value, .02);
    while (this.quenches.size + this.retiringQuenches.size >= MAX_QUENCHES + 1) this._disposeQuench(this.retiringQuenches.values().next().value);
    const choices = this.avoidImmediateRepeat && this.quenchBank.length > 1
      ? this.quenchBank.filter(asset => asset.id !== this.lastQuenchAssetId) : this.quenchBank;
    const asset = choices[Math.min(choices.length - 1, Math.floor(Math.random() * choices.length))];
    const source = this.context.createBufferSource(), envelope = this.context.createGain(), duration = asset.buffer.duration;
    source.buffer = asset.buffer; source.loop = false;
    envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(QUENCH_PEAK, at + QUENCH_ATTACK);
    envelope.gain.setValueAtTime(QUENCH_PEAK, at + Math.max(QUENCH_ATTACK, duration - QUENCH_RELEASE)); envelope.gain.linearRampToValueAtTime(0, at + duration);
    const space = this.makeSpatialPath(this.output);
    this.positionPath(space, patch.position);
    source.connect(envelope); envelope.connect(space.input);
    const voice = { source, envelope, at, duration, assetId: asset.id, key: patch.key, position: [...patch.position], space }; this.quenches.add(voice);
    source.onended = () => this._disposeQuench(voice); source.start(at); source.stop(at + duration + .01);
    this._syncGain(); this.quenchesTriggered++; this.lastQuenchAssetId = asset.id; return asset.id;
  }
  _retireQuench(voice, seconds) {
    if (!voice || !this.quenches.delete(voice)) return;
    this.retiringQuenches.add(voice); const now = this.context.currentTime;
    hold(voice.envelope.gain, now, quenchEnvelopeAt(voice, now - voice.at)); voice.envelope.gain.linearRampToValueAtTime(0, now + seconds); stop(voice.source, now + seconds);
  }
  _stopQuenches(seconds = .04) { for (const voice of [...this.quenches]) this._retireQuench(voice, seconds); }
  _disposeQuench(voice) {
    if (!voice || voice.disposed) return;
    voice.disposed = true; this.quenches.delete(voice); this.retiringQuenches.delete(voice);
    voice.source.onended = null; stop(voice.source); disconnect(voice.source); disconnect(voice.envelope); voice.source.buffer = null;
    for (const node of voice.space.nodes) disconnect(node);
    this._syncGain();
  }

  stop() { if (!this.destroyed) { this._cancelQuenchLoad(); this._stopQuenches(.04); } }
  reset() { this.setActive(false); this.burstAt = null; this.burstCount = 0; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.active = false; this._cancelQuenchLoad();
    for (const voice of [...this.quenches, ...this.retiringQuenches]) this._disposeQuench(voice);
    this.quenchBank = []; this.quenchCache.clear(); disconnect(this.output);
  }
  getMetrics() {
    return { active: this.active, loaded: this.quenchBank.length > 0, loading: Boolean(this.quenchRequest), assetCount: this.quenchBank.length,
      assetIds: this.quenchBank.map(entry => entry.id), currentAssetId: this.lastQuenchAssetId, triggered: this.quenchesTriggered,
      currentVoices: this.quenches.size, retiringVoices: this.retiringQuenches.size, maxVoices: MAX_QUENCHES, gain: QUENCH_PEAK,
      crowdGain: this.crowdGain, participantCount: this.participantCount, weight: this.weight,
      voices: [...this.quenches].map(voice => ({ key: voice.key, position: [...voice.position], assetId: voice.assetId, at: voice.at })),
      pendingDecodes: this.quenchDecodes.size, cacheEntries: this.quenchCache.size, error: this.quenchError, assetErrors: { ...this.quenchAssetErrors } };
  }
}
