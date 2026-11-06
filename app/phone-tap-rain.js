// Quiet native rain follows the finger, independently of the selected ground.
export const PHONE_RAIN_TRIM = 10 ** (-4.5 / 20);
const ATTACK_SECONDS = .85, RELEASE_SECONDS = 2.5, RAIN_LEVEL = .024 * PHONE_RAIN_TRIM;
const START_LEAD_SECONDS = .025, ENVELOPE_STEPS = 64;
const ENVELOPE_SHAPE = Array.from({ length: ENVELOPE_STEPS + 1 }, (_, index) => {
  const progress = index / ENVELOPE_STEPS;
  return progress * progress * (3 - 2 * progress);
});
const MAX_BYTES = 1500000, MAX_SECONDS = 60, LOAD_TIMEOUT_MS = 12000;
const disconnect = node => { try { node?.disconnect(); } catch {} };
const stop = (node, at) => { try { node?.stop(at); } catch {} };
const quiet = () => ({ holding: false, eligible: true });

function sourceUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020]/.test(value)) throw new Error('The phone rain recording URL is invalid.');
  let parsed;
  try { parsed = new URL(value, globalThis.location?.href ?? 'https://local.invalid/'); }
  catch { throw new Error('The phone rain recording URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('The phone rain recording needs an HTTP or local URL.');
  return value;
}

function recordingGain(buffer) {
  let power = 0, count = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const sample = data[index];
      if (!Number.isFinite(sample)) throw new Error('The phone rain recording contains invalid samples.');
      peak = Math.max(peak, Math.abs(sample));
      if (index % 8 === 0) { power += sample * sample; count++; }
    }
  }
  const rms = Math.sqrt(power / Math.max(1, count));
  return { rms, peak, makeup: rms > .00001 ? Math.min(12, .085 / rms, peak > 0 ? .95 / peak : 1) : 1 };
}

function envelopeAt(voice, time) {
  const state = voice.envelope;
  const progress = Math.max(0, Math.min(1, (time - state.at) / state.seconds));
  const position = progress * ENVELOPE_STEPS, lower = Math.floor(position), upper = Math.min(ENVELOPE_STEPS, lower + 1);
  const shaped = ENVELOPE_SHAPE[lower] + (ENVELOPE_SHAPE[upper] - ENVELOPE_SHAPE[lower]) * (position - lower);
  return state.from + (state.to - state.from) * shaped;
}

function ramp(voice, at, to, seconds) {
  const parameter = voice.gain.gain, from = envelopeAt(voice, at);
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { parameter.cancelScheduledValues(at); parameter.setValueAtTime(from, at); }
  // Bounded native ramps give the fade a quiet, rounded entrance and endpoint.
  // Unlike a value curve, these can be interrupted inside their span on old
  // Safari by cancelling future points and restoring the evaluated gain.
  for (let index = 1; index <= ENVELOPE_STEPS; index++) {
    parameter.linearRampToValueAtTime(from + (to - from) * ENVELOPE_SHAPE[index], at + seconds * index / ENVELOPE_STEPS);
  }
  voice.envelope = { from, to, at, seconds };
}

export class PhoneTapRainAudio {
  constructor({ context, destination, fetchImpl, prepareLoop = buffer => buffer, loadTimeoutMs = LOAD_TIMEOUT_MS } = {}) {
    this.context = context; this.destination = destination;
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args)); this.prepareLoop = prepareLoop;
    this.loadTimeoutMs = Math.max(1, Math.min(15000, Number(loadTimeoutMs) || LOAD_TIMEOUT_MS));
    this.active = false; this.destroyed = false; this.interaction = quiet(); this.suppressedUntilRelease = false;
    this.sourceUrl = null; this.buffer = null; this.recording = null; this.request = null; this.attemptedSource = null;
    this.decodes = new Set(); this.voice = null; this.loopsStarted = 0; this.error = null;
    this.contextState = context?.state;
    this.contextStateListener = () => this._contextStateChanged();
    context?.addEventListener?.('statechange', this.contextStateListener);
  }

  setSource(value) {
    if (this.destroyed) return Promise.resolve(false);
    let url;
    try { url = sourceUrl(value); } catch (error) { this.error = error.message; return Promise.resolve(false); }
    if (url !== this.sourceUrl) {
      this._cancelLoad(); this._disposeAll(); this.sourceUrl = url; this.buffer = null; this.recording = null;
    }
    this.attemptedSource = null; this.error = null;
    return this.active ? this._ensureLoad() : Promise.resolve(true);
  }

  setActive(value) {
    if (this.destroyed) return;
    const active = Boolean(value), changed = active !== this.active;
    if (!active) {
      this.suppressedUntilRelease ||= this.interaction.holding;
      this._cancelLoad(); this._disposeAll();
    }
    this.active = active;
    if (changed && active) { this.attemptedSource = null; void this._ensureLoad(); }
  }

  update(value = {}) {
    if (this.destroyed) return;
    const previous = this.interaction, next = { holding: value.holding === true, eligible: value.eligible !== false };
    const fresh = next.holding && !previous.holding;
    this.interaction = next;
    if (!next.holding) this.suppressedUntilRelease = false;
    else if (!this.active || !next.eligible) this.suppressedUntilRelease = true;
    // Losing a current field/gesture is a normal end to this rain envelope.
    // Mute, hide and teardown still use setActive(false)/stop for immediate
    // silence, while a stale reading or ended scene gets the finite tail.
    if (!next.eligible) { this._cancelLoad(); this._release(); return; }
    if (fresh) this.attemptedSource = null;
    if (this.active) void this._ensureLoad();
    this._sync();
  }

  _wanted() { return this.active && this.context?.state !== 'closed' && this.interaction.holding && this.interaction.eligible && !this.suppressedUntilRelease; }
  _contextStateChanged() {
    const previous = this.contextState, next = this.context?.state;
    this.contextState = next;
    if (this.destroyed) return;
    if (next === 'closed') { this._cancelLoad(); this._disposeAll(); return; }
    if (next === 'running') { this._sync(); return; }
    if (previous !== 'running' || !this.voice) return;
    // A device interruption freezes audio time and can resume a long-held loop
    // at full gain. Leave that same source silent while frozen, then give its
    // legitimate continuing hold a fresh attack when audio actually resumes.
    const voice = this.voice, at = this.context.currentTime;
    this._cancelRelease(voice);
    voice.gain.gain.cancelScheduledValues(at); voice.gain.gain.setValueAtTime(0, at);
    voice.envelope = { from: 0, to: 0, at, seconds: ATTACK_SECONDS }; voice.contextPaused = true;
    if (!this._wanted()) this._dispose(voice);
  }
  _sync() {
    if (this.context?.state !== this.contextState) { this._contextStateChanged(); return; }
    if (this._wanted() && this.buffer) this._start();
    else this._release();
  }
  _ensureLoad() {
    if (this.destroyed || !this.active || !this.interaction.eligible || !this.sourceUrl) return Promise.resolve(false);
    if (this.buffer) { this._sync(); return Promise.resolve(true); }
    if (this.request) return this.request.promise;
    if (this.attemptedSource === this.sourceUrl) return Promise.resolve(false);
    return this._load();
  }
  _cancelLoad() {
    const request = this.request;
    if (!request) return;
    this.request = null; this.attemptedSource = null; request.controller.abort();
  }
  _load() {
    const request = { url: this.sourceUrl, controller: new AbortController() };
    const signal = request.controller.signal;
    const current = () => !this.destroyed && this.active && this.request === request && !signal.aborted;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    void aborted.catch(() => {});
    const abort = () => rejectAbort(new Error(request.timedOut ? 'The phone rain recording took too long to load.' : 'Phone rain loading cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    const bounded = operation => Promise.race([operation, aborted]);
    const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, this.loadTimeoutMs);
    this.request = request; this.attemptedSource = request.url; this.error = null;
    request.promise = (async () => {
      const response = await bounded(Promise.resolve().then(() => current() ? this.fetchImpl(request.url, { signal, cache: 'force-cache' }) : Promise.reject(new Error('Phone rain loading cancelled.'))));
      if (!current()) return false;
      if (!response?.ok) throw new Error(`Phone rain unavailable (${response?.status ?? 'network'}).`);
      if (Number(response.headers?.get?.('content-length')) > MAX_BYTES) throw new Error('The phone rain recording is too large.');
      const bytes = await bounded(Promise.resolve().then(() => response.arrayBuffer()));
      if (!current()) return false;
      if (!bytes?.byteLength || bytes.byteLength > MAX_BYTES) throw new Error('The phone rain recording is empty or too large.');
      // Decoding itself cannot be cancelled. One stale decode may finish,
      // while every later attempt still has a bounded deadline and allocation.
      while (this.decodes.size) await bounded(Promise.race([...this.decodes].map(job => job.catch(() => null))));
      if (!current()) return false;
      let job;
      job = Promise.resolve().then(() => current() ? this.context.decodeAudioData(bytes) : Promise.reject(new Error('Phone rain loading cancelled.'))).finally(() => this.decodes.delete(job));
      this.decodes.add(job);
      const decoded = await bounded(job);
      if (!current()) return false;
      if (!(decoded?.duration > .3 && decoded.duration <= MAX_SECONDS) || !(decoded.numberOfChannels >= 1 && decoded.numberOfChannels <= 2) || decoded.sampleRate !== this.context.sampleRate) throw new Error('The phone rain recording must be a short mono or stereo sound.');
      const buffer = await bounded(Promise.resolve().then(() => this.prepareLoop(decoded)));
      if (!current()) return false;
      if (!(buffer?.duration > .1 && buffer.duration <= MAX_SECONDS) || !(buffer.numberOfChannels >= 1 && buffer.numberOfChannels <= 2) || buffer.sampleRate !== this.context.sampleRate) throw new Error('The prepared phone rain loop is invalid.');
      this.recording = recordingGain(buffer); this.buffer = buffer; this.error = null;
      // A completed fetch cannot resurrect a released, muted or hidden hold.
      this._sync(); return true;
    })().catch(error => {
      if (this.request === request && !this.destroyed) this.error = error?.message ?? 'Phone rain could not load.';
      return false;
    }).finally(() => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (this.request === request) this.request = null;
    });
    return request.promise;
  }

  _start() {
    if (!this.buffer || !this._wanted()) return;
    if (this.voice) {
      if (this.voice.contextPaused) {
        if (this.context.state !== 'running') return;
        this.voice.contextPaused = false;
        ramp(this.voice, this.context.currentTime + START_LEAD_SECONDS, this.voice.peak, ATTACK_SECONDS);
      } else if (this.voice.releaseClock) {
        this._cancelRelease(this.voice);
        ramp(this.voice, this.context.currentTime, this.voice.peak, ATTACK_SECONDS);
      }
      return;
    }
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    const peak = RAIN_LEVEL * this.recording.makeup;
    source.buffer = this.buffer; source.loop = true; source.loopStart = 0; source.loopEnd = this.buffer.duration;
    // Start silent before connecting, then read the audio clock after graph
    // setup. Cold device setup must not spend the attack before playback starts.
    gain.gain.value = 0;
    source.connect(gain); gain.connect(this.destination);
    const at = this.context.currentTime + START_LEAD_SECONDS;
    gain.gain.setValueAtTime(0, at);
    const voice = { source, gain, peak, envelope: { from: 0, to: 0, at, seconds: ATTACK_SECONDS }, releaseClock: null, disposed: false, contextPaused: false };
    ramp(voice, at, peak, ATTACK_SECONDS);
    this.voice = voice; this.loopsStarted++;
    source.onended = () => this._dispose(voice);
    source.start(at, at % this.buffer.duration);
  }
  _release() {
    const voice = this.voice;
    if (!voice || voice.releaseClock) return;
    if (voice.contextPaused) { this._dispose(voice); return; }
    const at = this.context.currentTime;
    ramp(voice, at, 0, RELEASE_SECONDS);
    // Keep the recording's phase and one continuous envelope through re-presses.
    // A separate, inaudible native clock owns cleanup; the loop itself never has
    // an irreversible scheduled stop while the finger may return.
    const clock = this.context.createOscillator(); voice.releaseClock = clock;
    clock.onended = () => { if (voice.releaseClock === clock) this._dispose(voice); };
    clock.start(at); clock.stop(at + RELEASE_SECONDS);
  }
  _cancelRelease(voice) {
    const clock = voice.releaseClock;
    if (!clock) return;
    voice.releaseClock = null; clock.onended = null; stop(clock); disconnect(clock);
  }
  _dispose(voice) {
    if (!voice || voice.disposed) return;
    voice.disposed = true;
    if (this.voice === voice) this.voice = null;
    this._cancelRelease(voice); voice.source.onended = null;
    stop(voice.source); disconnect(voice.source); disconnect(voice.gain); voice.source.buffer = null;
  }
  _disposeAll() { this._dispose(this.voice); }
  stop() {
    if (this.destroyed) return;
    this.suppressedUntilRelease ||= this.interaction.holding; this._cancelLoad(); this._disposeAll();
  }
  reset() {
    if (this.destroyed) return;
    this.stop(); this.interaction = quiet(); this.suppressedUntilRelease = false; this.attemptedSource = null;
  }
  destroy() {
    if (this.destroyed) return;
    this.stop(); this.destroyed = true; this.active = false; this.buffer = null; this.recording = null;
    this.context?.removeEventListener?.('statechange', this.contextStateListener);
  }
  getMetrics() {
    return { active: this.active, interaction: { ...this.interaction }, suppressedUntilRelease: this.suppressedUntilRelease,
      sourceUrl: this.sourceUrl, loaded: Boolean(this.buffer), loading: Boolean(this.request), error: this.error, destroyed: this.destroyed,
      rainGain: this.voice ? envelopeAt(this.voice, this.context.currentTime) : 0, rainLevel: RAIN_LEVEL,
      rainLoopCount: Number(Boolean(this.voice)), retiringLoopCount: Number(Boolean(this.voice?.releaseClock)),
      loopsStarted: this.loopsStarted, attackSeconds: ATTACK_SECONDS, releaseSeconds: RELEASE_SECONDS,
      recordingRms: this.recording?.rms ?? 0, makeupGain: this.recording?.makeup ?? 1,
      outputRms: this.recording ? this.recording.rms * this.recording.makeup * RAIN_LEVEL : 0,
      pendingDecodes: this.decodes.size };
  }
}

export default PhoneTapRainAudio;
