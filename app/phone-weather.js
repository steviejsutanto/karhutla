// C/G extinction bells and their small room, owned by the main sound output.
// Keep the C/G identity in a clearly audible middle register. The previous
// C2–G7 lottery combined sub-bass-like fundamentals with very thin high notes
// whose peaks were almost 10 dB lower, so equal completion events varied widely.
const BELL_MIDI = Object.freeze([48, 55, 60, 67, 72, 79]); // C3/G3 through C5/G5.
const BELL_OCTAVES = Object.freeze([
  Object.freeze({ octave: 3, weight: .34, decaySeconds: 12, peak: .026 }),
  Object.freeze({ octave: 4, weight: .44, decaySeconds: 10, peak: .026 }),
  // A modest register trim offsets the Main HRTF's weaker upper strike. This
  // is fixed per note, independent of participants and simultaneous bells.
  Object.freeze({ octave: 5, weight: .22, decaySeconds: 8, peak: .026 * 10 ** (4 / 20) }),
]);
// The final value is relative partial energy at the end of the whole bell.
// Earlier short partial envelopes left only a clean fundamental after the strike.
const BELL_PARTIALS = Object.freeze([[1, 1, 1], [2.71, .24, .18], [4.13, .11, .1], [6.4, .055, .06]].map(Object.freeze));
const MAX_BELLS = 8, MAX_RETIRING_BELLS = 8, BELL_ATTACK = .028, BELL_RELEASE = .08;
const REVERB_SECONDS = 1.4, REVERB_WET = .18;
const quietInteraction = () => ({ holding: false, patchKey: null, extinguished: false, eligible: true });
const disconnect = node => { try { node?.disconnect(); } catch { /* Already detached. */ } };
const stop = (node, at) => { try { node?.stop(at); } catch { /* Already stopped. */ } };

function bellChoice() {
  let draw = Math.max(0, Math.min(1 - Number.EPSILON, Math.random()));
  for (let index = 0; index < BELL_OCTAVES.length; index++) {
    const octave = BELL_OCTAVES[index];
    if (draw < octave.weight || index === BELL_OCTAVES.length - 1) {
      return { ...octave, midi: BELL_MIDI[index * 2 + Number(draw >= octave.weight / 2)] };
    }
    draw -= octave.weight;
  }
}
function bellEnvelope(voice) {
  return [[BELL_ATTACK, voice.peak], [voice.decaySeconds * .15, voice.peak * .52], [voice.decaySeconds * .57, voice.peak * .13], [voice.decaySeconds, .00001]];
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
function smallRoomImpulse(context) {
  // Native convolution requires the context's sample rate. The absolute
  // impulse sum is one, bounding the wet contribution at 18% of the dry peak.
  const rate = context.sampleRate, frames = Math.ceil(REVERB_SECONDS * rate);
  const buffer = context.createBuffer(1, frames, rate), data = buffer.getChannelData(0);
  let seed = 19790603, filtered = 0, energy = 0;
  for (let index = Math.floor(.02 * rate); index < frames; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    filtered += .28 * ((seed / 2147483648 - 1) - filtered);
    data[index] = filtered * Math.exp(-5 * index / frames) * (1 - index / frames);
    energy += Math.abs(data[index]);
  }
  for (let index = 0; index < frames; index++) data[index] *= .16 / energy;
  for (const [seconds, level] of [[.017, .28], [.031, .22], [.053, .16], [.079, .11], [.113, .07]]) data[Math.round(seconds * rate)] += level;
  return buffer;
}

// Keep this module and controller name stable for existing phone integrations.
export class PhoneWeatherAudio {
  constructor({ context, destination, onBell, makeSpatialPath, positionPath }) {
    this.context = context; this.destination = destination;
    this.onBell = onBell;
    this.makeSpatialPath = makeSpatialPath; this.positionPath = positionPath;
    this.active = false; this.destroyed = false; this.interaction = quietInteraction();
    this.suppressedUntilRelease = false; this.bellsTriggered = 0; this.lastBellMidi = null; this.lastBellDecay = null;
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
  _playBell(patch = {}) {
    const at = this.context.currentTime;
    // Eight overlapping natural tails plus eight short overflow releases remain
    // bounded even under pathological packet bursts. Never cut a fading voice.
    if (this.bells.size + this.retiringBells.size >= MAX_BELLS + MAX_RETIRING_BELLS) return false;
    if (this.bells.size >= MAX_BELLS) this._retireBell(this.bells.values().next().value, BELL_RELEASE);
    const choice = bellChoice(), frequency = 440 * 2 ** ((choice.midi - 69) / 12);
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
    for (const [index, [ratio, amplitude, remaining]] of BELL_PARTIALS.entries()) {
      if (frequency * ratio >= this.context.sampleRate * .45) continue;
      const oscillator = this.context.createOscillator(), level = this.context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency * ratio; level.gain.value = amplitude;
      level.gain.setValueAtTime(amplitude, at);
      if (remaining < 1) level.gain.exponentialRampToValueAtTime(amplitude * remaining, at + voice.decaySeconds);
      oscillator.connect(level);
      const partial = { ratio, amplitude, remaining, oscillator, level };
      if (index) {
        // Slow native sine modulation gives each inharmonic partial its own
        // breath and slight pitch motion while the fundamental stays anchored.
        const motion = this.context.createGain(), modulator = this.context.createOscillator();
        const pitchDepth = this.context.createGain(), amplitudeDepth = this.context.createGain();
        motion.gain.value = 1; modulator.type = 'sine'; modulator.frequency.value = .09 + index * .067 + (voice.midi % 7) * .006;
        pitchDepth.gain.value = .5 + index * .75; amplitudeDepth.gain.value = .035 + index * .018;
        modulator.connect(pitchDepth); pitchDepth.connect(oscillator.detune);
        modulator.connect(amplitudeDepth); amplitudeDepth.connect(motion.gain);
        level.connect(motion); motion.connect(envelope);
        modulator.start(at); modulator.stop(at + voice.stopSeconds);
        Object.assign(partial, { motion, modulator, pitchDepth, amplitudeDepth });
        modulators.push(modulator); modulationNodes.push(motion, pitchDepth, amplitudeDepth);
      } else level.connect(envelope);
      oscillator.start(at); oscillator.stop(at + voice.stopSeconds); oscillators.push(oscillator); levels.push(level); partials.push(partial);
    }
    this.bells.add(voice); oscillators[0].onended = () => this._disposeBell(voice);
    this.bellsTriggered++; this.lastBellMidi = voice.midi; this.lastBellDecay = voice.decaySeconds;
    try { this.onBell?.({ at, midi: voice.midi, frequency, decaySeconds: voice.decaySeconds, peak: voice.peak, patchKey: voice.key }); } catch { /* Visual observers cannot interrupt audio. */ }
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
    this._disposeReverb(this.retiringReverb); this.reverbImpulse ??= smallRoomImpulse(this.context);
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
    return { active: this.active, interaction: { ...this.interaction }, rainGain: 0, rainLoopCount: 0,
      bellsTriggered: this.bellsTriggered, lastBellMidi: this.lastBellMidi, currentBellVoices: this.bells.size, bellVoices: this.bells.size,
      retiringBellVoices: this.retiringBells.size, bellDecaySeconds: this.lastBellDecay ?? BELL_OCTAVES[0].decaySeconds,
      bellDecayRangeSeconds: [8, 12], bellPitchMidi: [...BELL_MIDI], bellOctaveWeights: BELL_OCTAVES.map(value => ({ ...value })),
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
