// Modal extinction bells and their dark room, owned by the Main output.
import {BELL_HARMONICS, OVERTONE_BELL_PITCHES, overtonePitchAtProgress, overtoneRegisterWeights} from './overtone-scale.js';
const BELL_BASE_PEAK = .038;
const registerPosition = harmonic => Math.log(harmonic / BELL_HARMONICS[0]) / Math.log(BELL_HARMONICS.at(-1) / BELL_HARMONICS[0]);
// A restrained downward register contour avoids the former upper-note boosts.
// These fixed gains preserve the strike dynamics; no count-based ducking or
// runtime loudness riding can make an individual bell disappear in a crowd.
export const BELL_HARMONIC_TRIM_DB = Object.freeze(Object.fromEntries(BELL_HARMONICS.map(harmonic => [harmonic, -4 * registerPosition(harmonic)])));
export const BELL_NOTE_TRIM_DB = BELL_HARMONIC_TRIM_DB; // Existing inspector key, now indexed by harmonic.
// Ratio, attack strength, and relative remaining modal gain at the end. The
// fundamental decays faster than the resonant inharmonic body instead of
// leaving a long, clean sine. The lower three modes now carry the body, with
// restrained upper resonances instead of the previous bright metallic edge.
// Their summed strength leaves room for the stronger reverberant return.
export const BELL_PARTIALS = Object.freeze([[1, .47, .004], [1.43, .47, .065], [2.17, .40, .035],
  [3.61, .22, .012], [5.17, .13, .003], [6.83, .07, .0005]].map(Object.freeze));
export function bellPitchParameters(harmonic) {
  const pitch=OVERTONE_BELL_PITCHES[BELL_HARMONICS.indexOf(harmonic)];
  if (!pitch) throw new RangeError('Bell harmonic must be an integer from 2 to 11.');
  return {...pitch, decaySeconds: 12 - 4 * registerPosition(harmonic),
    peak: BELL_BASE_PEAK * 10 ** (BELL_HARMONIC_TRIM_DB[harmonic] / 20)};
}
const MAX_BELLS = 8, MAX_RETIRING_BELLS = 8, BELL_ATTACK = .008, BELL_RELEASE = .08;
const REVERB_SECONDS = 3.2, REVERB_WET = .40;
const quietInteraction = () => ({ holding: false, patchKey: null, extinguished: false, eligible: true });
const disconnect = node => { try { node?.disconnect(); } catch { /* Already detached. */ } };
const stop = (node, at) => { try { node?.stop(at); } catch { /* Already stopped. */ } };

function bellRegisterProgress(extinctionProgress) {
  if (!Number.isFinite(extinctionProgress)) return .5; // Neutral isolated auditions.
  const descent = Math.max(0, Math.min(1, extinctionProgress / .45));
  // Begin below the former upper-register bias, then complete the descent
  // within the first 45% of the global fire being extinguished.
  return .6 + .4 * (1 - (1 - descent) ** 2);
}
function bellChoice(sample, extinctionProgress) {
  return bellPitchParameters(overtonePitchAtProgress(OVERTONE_BELL_PITCHES, sample, bellRegisterProgress(extinctionProgress)).harmonic);
}
function bellEnvelope(voice) {
  return [[BELL_ATTACK, voice.peak], [.10, voice.peak * .84], [.55, voice.peak * .42],
    [voice.decaySeconds * .55, voice.peak * .075], [voice.decaySeconds, .00001]];
}
function bellEnvelopeAt(voice, age) {
  if (age <= 0) return 0;
  if (age < BELL_ATTACK) return voice.peak * age / BELL_ATTACK;
  const points = bellEnvelope(voice);
  for (let index = 1; index < points.length; index++) {
    const [start, from] = points[index - 1], [end, to] = points[index];
    if (age < end) return from * (to / from) ** ((age - start) / (end - start));
  }
  return .00001 * Math.max(0, (voice.stopSeconds - .02 - age) / (BELL_RELEASE - .02));
}
function hold(parameter, at, value) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { parameter.cancelScheduledValues(at); parameter.setValueAtTime(value, at); }
}
function bellRoomImpulse(context) {
  // Darkened reflection clusters retain useful late energy. Normalizing a
  // dense noise tail by its absolute sum made the former room almost dry.
  // This static native-rate impulse keeps an absolute sum of one, so the
  // stronger return is still bounded at 40% of the coherent dry-source peak.
  const rate = context.sampleRate, frames = Math.ceil(REVERB_SECONDS * rate);
  const buffer = context.createBuffer(1, frames, rate), data = buffer.getChannelData(0);
  const pole = Math.exp(-2 * Math.PI * 1800 / rate), kernelFrames = Math.ceil(.004 * rate);
  const addReflection = (seconds, strength) => {
    const start = Math.round(seconds * rate);
    for (let index = 0; index < kernelFrames && start + index < frames; index++) {
      data[start + index] += strength * (1 - pole) * pole ** index * (1 - index / kernelFrames);
    }
  };
  for (const [seconds, strength] of [[.029, .20], [.053, -.15], [.089, .12], [.137, -.10], [.191, .08]]) addReflection(seconds, strength);
  let seed = 19790603;
  for (let cluster = 0; cluster < 29; cluster++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const seconds = .245 + cluster * .098 + (seed / 4294967296 - .5) * .025;
    const strength = .17 * Math.exp(-seconds / 1.1) * (1 - seconds / REVERB_SECONDS);
    for (const [delay, level] of [[0, .49], [.0023, -.24], [.0059, .13], [.0097, -.07], [.0151, .04], [.0217, -.03]]) {
      addReflection(seconds + delay, strength * level * (cluster % 2 ? -1 : 1));
    }
  }
  const absoluteSum = data.reduce((sum, value) => sum + Math.abs(value), 0);
  for (let index = 0; index < frames; index++) data[index] /= absoluteSum;
  return buffer;
}

// Keep this module and controller name stable for existing phone integrations.
export class PhoneWeatherAudio {
  constructor({ context, destination, onBell, makeSpatialPath, positionPath, random = Math.random }) {
    this.context = context; this.destination = destination;
    this.onBell = onBell;
    this.makeSpatialPath = makeSpatialPath; this.positionPath = positionPath;
    this.random = random;
    this.active = false; this.destroyed = false; this.interaction = quietInteraction(); this.extinctionProgress = null;
    this.suppressedUntilRelease = false; this.bellsTriggered = 0; this.lastBellMidi = null; this.lastBellHarmonic = null; this.lastBellDecay = null;
    this.bells = new Set(); this.retiringBells = new Set();
    this.reverb = null; this.retiringReverb = null; this.reverbImpulse = null;

  }

  update(value = {}) {
    if (this.destroyed) return;
    const previous = this.interaction;
    const next = { holding: value.holding === true, patchKey: value.patchKey == null ? null : String(value.patchKey), extinguished: value.extinguished === true, eligible: value.eligible !== false };
    const newGesture = next.holding && !previous.holding;
    if (!next.holding) this.suppressedUntilRelease = false;
    const bellEdge = next.holding && next.patchKey !== null && next.extinguished &&
      (newGesture || previous.holding && previous.patchKey === next.patchKey && !previous.extinguished);
    this.interaction = next;
    if (bellEdge) {
      // Consume hidden, muted and ineligible edges so packets cannot replay them.
      if (this.active && next.eligible && !this.suppressedUntilRelease) this._playBell();
    }
  }

  setActive(value) {
    if (this.destroyed) return;
    if (this.active === Boolean(value)) {
      return;
    }
    this.active = Boolean(value);
    if (!this.active) {
      this.suppressedUntilRelease ||= this.interaction.holding;
      this._stopBells(.04); this._flushReverb(.04);
    } else {
      // Resume may precede rendered audio time. Never uncover old voices or room history.
      for (const voice of [...this.retiringBells]) this._disposeBell(voice);
      this._disposeReverb(this.retiringReverb);
    }
  }

  // Legacy callers may still select a rain source. Phones never load or play it.
  setRainSource() { return Promise.resolve(false); }

  // Legacy configuration cannot reintroduce sample requests on a phone.
  setQuenchSources() { return Promise.resolve(false); }

  ring(patch = {}) {
    if (!this.active || this.destroyed) return false;
    return this._playBell(patch);
  }
  setExtinctionProgress(value) {
    this.extinctionProgress = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
  }
  _playBell(patch = {}) {
    const at = this.context.currentTime;
    // Eight overlapping natural tails plus eight short overflow releases remain
    // bounded even under pathological packet bursts. Never cut a fading voice.
    if (this.bells.size + this.retiringBells.size >= MAX_BELLS + MAX_RETIRING_BELLS) return false;
    if (this.bells.size >= MAX_BELLS) this._retireBell(this.bells.values().next().value, BELL_RELEASE);
    const choice = bellChoice(this.random(), this.extinctionProgress), frequency = choice.frequency;
    const envelope = this.context.createGain(), oscillators = [], levels = [], partials = [], modulators = [], modulationNodes = [];
    const space = this.makeSpatialPath?.(this.destination);
    if (space) this.positionPath?.(space, patch.position ?? [.5, .5]);
    const voice = { ...choice, envelope, oscillators, levels, partials, modulators, modulationNodes, space, key: patch.key ?? null, at, stopSeconds: choice.decaySeconds + BELL_RELEASE };
    envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(voice.peak, at + BELL_ATTACK);
    for (const [seconds, level] of bellEnvelope(voice).slice(1)) envelope.gain.exponentialRampToValueAtTime(level, at + seconds);
    envelope.gain.linearRampToValueAtTime(0, at + voice.stopSeconds - .02); envelope.connect(space?.input ?? this.destination);
    const room = this._ensureReverb(at);
    if (room) {
      envelope.connect(room.send); room.tailUntil = Math.max(room.tailUntil, at + voice.stopSeconds + REVERB_SECONDS);
      stop(room.clock, room.tailUntil);
    }
    for (const [ratio, amplitude, remaining] of BELL_PARTIALS) {
      if (frequency * ratio >= this.context.sampleRate * .45) continue;
      const oscillator = this.context.createOscillator(), level = this.context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency * ratio; level.gain.value = amplitude;
      level.gain.setValueAtTime(amplitude, at);
      if (remaining < 1) level.gain.exponentialRampToValueAtTime(amplitude * remaining, at + voice.decaySeconds);
      oscillator.connect(level);
      const partial = { ratio, amplitude, remaining, oscillator, level };
      level.connect(envelope);
      oscillator.start(at); oscillator.stop(at + voice.stopSeconds); oscillators.push(oscillator); levels.push(level); partials.push(partial);
    }
    this.bells.add(voice); oscillators[0].onended = () => this._disposeBell(voice);
    this.bellsTriggered++; this.lastBellMidi = voice.midi; this.lastBellHarmonic = voice.harmonic; this.lastBellDecay = voice.decaySeconds;
    try { this.onBell?.({ at, harmonic: voice.harmonic, midi: voice.midi, frequency, decaySeconds: voice.decaySeconds, peak: voice.peak, patchKey: voice.key }); } catch { /* Visual observers cannot interrupt audio. */ }
    return true;
  }

  _retireBell(voice, seconds) {
    if (!voice || !this.bells.delete(voice)) return;
    this.retiringBells.add(voice); const now = this.context.currentTime;
    hold(voice.envelope.gain, now, bellEnvelopeAt(voice, now - voice.at)); voice.envelope.gain.linearRampToValueAtTime(0, now + seconds);
    for (const oscillator of [...voice.oscillators, ...voice.modulators]) stop(oscillator, now + seconds);
  }
  _stopBells(seconds = .04) { for (const voice of [...this.bells]) this._retireBell(voice, seconds); }
  _disposeBell(voice) {
    if (!voice || voice.disposed) return;
    voice.disposed = true; this.bells.delete(voice); this.retiringBells.delete(voice);
    for (const oscillator of [...voice.oscillators, ...voice.modulators]) { oscillator.onended = null; stop(oscillator); disconnect(oscillator); }
    for (const level of [...voice.levels, ...voice.modulationNodes]) disconnect(level);
    disconnect(voice.envelope);
    for (const node of voice.space?.nodes ?? []) disconnect(node);
  }

  _ensureReverb(at) {
    if (this.reverb?.tailUntil > at) return this.reverb;
    // An audio-thread clock may already have ended before its queued JS event.
    // A stopped oscillator cannot be extended to own a newly struck room tail.
    this._disposeReverb(this.reverb);
    this._disposeReverb(this.retiringReverb); this.reverbImpulse ??= bellRoomImpulse(this.context);
    const send = this.context.createGain(), convolver = this.context.createConvolver(), output = this.context.createGain(), clock = this.context.createOscillator();
    send.gain.value = REVERB_WET; output.gain.value = 1; convolver.normalize = false; convolver.buffer = this.reverbImpulse;
    send.connect(convolver); convolver.connect(output); output.connect(this.destination);
    const room = { send, convolver, output, clock, tailUntil: at, disposed: false };
    clock.onended = () => this._disposeReverb(room); clock.start(at); this.reverb = room; return room;
  }
  _flushReverb(seconds) {
    if (!this.reverb) return;
    this._disposeReverb(this.retiringReverb); const room = this.reverb, now = this.context.currentTime;
    this.reverb = null; this.retiringReverb = room; room.send.gain.setValueAtTime(0, now);
    room.output.gain.setValueAtTime(1, now); room.output.gain.linearRampToValueAtTime(0, now + seconds);
    room.tailUntil = now + seconds; stop(room.clock, room.tailUntil);
  }
  _disposeReverb(room) {
    if (!room || room.disposed) return;
    room.disposed = true; room.clock.onended = null; stop(room.clock);
    for (const node of [room.send, room.convolver, room.output, room.clock]) disconnect(node);
    room.convolver.buffer = null;
    if (this.reverb === room) this.reverb = null;
    if (this.retiringReverb === room) this.retiringReverb = null;
  }

  stop() {
    if (this.destroyed) return;
    this.suppressedUntilRelease ||= this.interaction.holding;
    this._stopBells(); this._flushReverb(.04);
  }
  reset() { if (this.destroyed) return; this.stop(); this.interaction = quietInteraction(); this.suppressedUntilRelease = false; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.active = false;
    for (const voice of [...this.bells, ...this.retiringBells]) this._disposeBell(voice);
    this._disposeReverb(this.reverb); this._disposeReverb(this.retiringReverb); this.reverbImpulse = null;
  }
  getMetrics() {
    const progress = bellRegisterProgress(this.extinctionProgress);
    const weights = overtoneRegisterWeights(OVERTONE_BELL_PITCHES, progress);
    return { active: this.active, interaction: { ...this.interaction }, rainGain: 0, rainLoopCount: 0,
      bellsTriggered: this.bellsTriggered, lastBellMidi: this.lastBellMidi, lastBellHarmonic: this.lastBellHarmonic,
      currentBellVoices: this.bells.size, bellVoices: this.bells.size,
      retiringBellVoices: this.retiringBells.size, bellDecaySeconds: this.lastBellDecay ?? 12,
      bellAttackSeconds: BELL_ATTACK, bellDecayRangeSeconds: [8, 12], bellPitchMidi: OVERTONE_BELL_PITCHES.map(pitch => pitch.midi),
      bellHarmonics: [...BELL_HARMONICS], bellFrequencies: OVERTONE_BELL_PITCHES.map(pitch => pitch.frequency),
      extinctionProgress: this.extinctionProgress, bellRegisterProgress: progress,
      bellHarmonicWeights: BELL_HARMONICS.map((harmonic, index) => ({...bellPitchParameters(harmonic), weight: weights[index]})),
      bellNoteTrimsDb: { ...BELL_NOTE_TRIM_DB },
      bellPartials: BELL_PARTIALS.map(([ratio, amplitude, remaining]) => ({ ratio, amplitude, remaining })),
      maxBellVoices: MAX_BELLS, maxRetiringBellVoices: MAX_RETIRING_BELLS,
      bellReverb: { active: Boolean(this.reverb), wet: REVERB_WET, durationSeconds: REVERB_SECONDS,
        graphCount: Number(Boolean(this.reverb)) + Number(Boolean(this.retiringReverb)),
        tailRemainingSeconds: Math.max(0, (this.reverb?.tailUntil ?? this.retiringReverb?.tailUntil ?? 0) - this.context.currentTime),
        impulseFrames: this.reverbImpulse?.length ?? 0, impulseSampleRate: this.reverbImpulse?.sampleRate ?? 0 },
      loaded: false, sourceUrl: null, loading: false, error: null, destroyed: this.destroyed };
  }
}

export default PhoneWeatherAudio;
