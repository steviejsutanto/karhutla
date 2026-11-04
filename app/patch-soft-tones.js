import { derivePeatDepthState } from '../visual-assets/peat-section.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const hash = key => { let value = 2166136261; for (const character of String(key)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); } return value >>> 0; };
const PATCH_SCALE_STEPS = Object.freeze([0, 2, 4, 7, 9]);
export const PATCH_PENTATONIC_MIDI = Object.freeze(Array.from({ length: 31 }, (_, index) => 25 + Math.floor(index / 5) * 12 + PATCH_SCALE_STEPS[index % 5]));
// Keep D♭ and its octaves anchored; gently shade the other degrees toward
// simple harmonic ratios. The largest departure from equal tuning is 16 cents.
export const PATCH_PENTATONIC_RATIOS = Object.freeze([1, 9 / 8, 5 / 4, 3 / 2, 5 / 3]);
export const PATCH_TUNING_CENTS = Object.freeze(PATCH_PENTATONIC_RATIOS.map((ratio, index) => 1200 * Math.log2(ratio) - PATCH_SCALE_STEPS[index] * 100));
export function patchTuningCents(midi) {
  const degree = ((midi - 25) % 12 + 12) % 12;
  return PATCH_TUNING_CENTS[PATCH_SCALE_STEPS.indexOf(degree)] ?? 0;
}
export const patchFrequencyForMidi = midi => 440 * 2 ** ((midi - 69) / 12) * 2 ** (patchTuningCents(midi) / 1200);
// A quiet, stable two-octave body carries the lowest fundamentals on small
// speakers. It disappears before the middle register and adds < .5 dB RMS.
export const patchLowRegisterBodyLevel = frequency => .22 * (1 - smooth((frequency - 70) / 100));
export const PATCH_RESIDUE_IDS = Object.freeze(['ash', 'moisture', 'haze']);
// Full fire gives normal / minor-third-down / major-third-up equal shares.
// As real macro heat falls, new extinctions increasingly keep their normal rate.
export const patchResidueTransposeProbability = (globalHeat = 1) => 2 / 3 * clamp(globalHeat) ** 1.5;
export function patchResiduePitch(globalHeat = 1, sample) {
  const pitchHeat = clamp(globalHeat), transposeProbability = patchResidueTransposeProbability(pitchHeat);
  const unit = Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 1 - Number.EPSILON;
  const transposeSemitones = unit < transposeProbability / 2 ? -3 : unit < transposeProbability ? 4 : 0;
  return { pitchHeat, transposeProbability, transposeSemitones, transposeRatio: 2 ** (transposeSemitones / 12) };
}
// A sine's peak coefficient is not comparable to a recording's RMS. These
// levels put the rounded note and the filtered recording near .008 RMS.
export const PATCH_SOFT_TONE_LEVEL = .012;
export const PATCH_RESIDUE_LEVEL = .08;
export const PATCH_TEXTURE_SOURCE_LIMIT = 8;
export const PATCH_TEXTURE_ADMISSION_SECONDS = .1;
const TONE_RISE_SECONDS = .3;
// A completed short gesture can reach Main after its actor has released.
// Retain only the measured cooling edge, for one rounded finite response.
export const PATCH_COOLING_RESPONSE_SECONDS = 1.2;
// A completion bell ends the held note promptly. The editable material morph
// and fade keep their full duration, independently of this pitched exit.
export const PATCH_TONE_EXIT_SECONDS = 2.2;
const textureCutoff = id => id === 'ash' ? 5600 : id === 'haze' ? 3200 : 4400;
const textureTargetRms = id => id === 'ash' ? .11 : id === 'haze' ? .1 : .085;
// RMS matching preserves the morph; small listening trims account for the
// distinct droplet detail versus diffuse air and fine ash in the full mix.
export const PATCH_TEXTURE_TRIMS_DB = Object.freeze({ ash: 0, moisture: -2, haze: 1 });
export const patchTextureLevel = id => PATCH_RESIDUE_LEVEL * .1 / textureTargetRms(id) * 10 ** ((PATCH_TEXTURE_TRIMS_DB[id] ?? 0) / 20);
export const patchMidi = patch => PATCH_PENTATONIC_MIDI[hash(patch?.key ?? patch) % PATCH_PENTATONIC_MIDI.length];
export const patchResidueId = patch => PATCH_RESIDUE_IDS[hash(`${patch?.key ?? patch}:residue`) % PATCH_RESIDUE_IDS.length];
const materialUnit = (patch, property) => {
  // Avalanche nearby grid keys before deriving separate material dimensions.
  let value = hash(`${patch?.key ?? patch}:material:${property}`);
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
/** The normal base retains its small speed variation, phase and room per patch. */
export function patchResidueTreatment(patch) {
  const reverbSend = materialUnit(patch, 'room') < .6 ? .28 + .18 * materialUnit(patch, 'room-level') : 0;
  return { playbackRate: .965 + .07 * materialUnit(patch, 'speed'), phase: materialUnit(patch, 'phase'),
    cutoffRatio: .91 + .18 * materialUnit(patch, 'cutoff'), reverbSend, dryGain: Math.sqrt(1 - reverbSend ** 2) };
}
const TEXTURE_ASSIGNMENT_NEAR_SECONDS = 1.5;

/** The visual peat's confirmed cooling front reveals a single rounded note. */
export function patchSoftToneParameters(patch = {}, hazeOnlyBlend = 0) {
  let cooling = 0;
  // Exclude the wet skin: a finger immediately changes surface water, while
  // the deep front moves only with absorbed water and actual heat loss.
  for (let layer = 0; layer < 24; layer++) cooling += derivePeatDepthState(patch, .08 + (layer + .5) / 24 * .92).cooling;
  cooling = Math.min(cooling / 24, clamp(patch.moisture));
  // Early heat loss is physically small: a 300 ms default-strength gesture
  // changes heat by only .0002. Give that confirmed loss an audible rounded
  // reveal, while leaving deep focus on its complete original cooling front.
  // Even absorbed water cannot reveal pitch before heat actually decreases.
  const heatLoss = 1 - clamp(patch.heat ?? 1), progress = heatLoss > 0 ? clamp((cooling * .55 + heatLoss * .45) / .8) : 0;
  const emergence = patch.extinguished ? 1 : smooth(progress ** (1 / 6));
  // Amplitude reveals the cooling early, while focus follows the whole deep
  // front. Otherwise the square-root reveal also clears the haze too soon.
  const groundFocus = patch.extinguished ? 1 : smooth(progress), groundHaziness = (1 - groundFocus) ** .8;
  // During forest takeover the same cooling response becomes diffuse air.
  // This changes character only: real heat loss still owns its emergence,
  // admission and finite release. No periodic partial survives the full blend.
  const blend = clamp(hazeOnlyBlend), hazeMix = smooth(blend), periodic = 1 - hazeMix;
  const focus = groundFocus * periodic, haziness = groundHaziness + (1 - groundHaziness) * hazeMix;
  return { cooling, emergence, focus, haziness, gain: PATCH_SOFT_TONE_LEVEL * emergence,
    // A substantial filtered noise halo and rough upper become one stable
    // note. The fundamental itself never receives pitch modulation.
    fundamentalGain: (.4 + .6 * groundFocus) * periodic, hazeGain: .9 * haziness,
    upperBlurCents: 180 * haziness, harmonicGain: (.04 + .25 * groundHaziness) * periodic,
    cutoffRatio: 2.2 + 1.4 * (1 - emergence), hazeOnlyBlend: blend };

}

/** A finite equal-power tone → recording morph, then a complete fade to zero. */
export function patchResidueEnvelope(age, morphSeconds = 8, fadeSeconds = 20) {
  const morph = Math.max(.001, morphSeconds), fade = Math.max(.001, fadeSeconds), progress = smooth(age / morph);
  if (age < 0 || age >= morph + fade) return { tone: 0, texture: 0, done: age >= morph + fade };
  return { tone: Math.cos(progress * Math.PI / 2), texture: Math.sin(progress * Math.PI / 2) * (1 - smooth((age - morph) / fade)), done: false };
}

/** Match the actual mono, filtered recordings rather than their stereo peaks.
 * Web Audio low/high-pass Q is measured in dB (Web Audio 1.1 §BiquadFilterNode).
 * Only a constant gain is applied; the original fine grain stays intact.
 */
export function patchTextureRecordingParameters(buffer, id) {
  const data = buffer.getChannelData(0), cutoff = Math.min(textureCutoff(id), buffer.sampleRate * .49);
  const omega = 2 * Math.PI * cutoff / buffer.sampleRate, cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * 10 ** (.25 / 20)), denominator = 1 + alpha;
  const b0 = (1 - cosine) / (2 * denominator), b1 = (1 - cosine) / denominator, b2 = b0;
  const a1 = -2 * cosine / denominator, a2 = (1 - alpha) / denominator;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, power = 0, filteredPower = 0, peak = 0, filteredPeak = 0;
  for (const sample of data) {
    const output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = sample; y2 = y1; y1 = output;
    power += sample * sample; filteredPower += output * output;
    peak = Math.max(peak, Math.abs(sample)); filteredPeak = Math.max(filteredPeak, Math.abs(output));
  }
  const rms = Math.sqrt(power / Math.max(1, data.length)), filteredRms = Math.sqrt(filteredPower / Math.max(1, data.length));
  const targetRms = textureTargetRms(id);
  // Float buffers and filters retain headroom above unity. The finite envelope
  // and shared crowd gain keep the calibrated recording quiet. A 24 dB bound
  // prevents near-silence amplification.
  const makeupGain = filteredRms > .00001 ? Math.min(16, targetRms / filteredRms, filteredPeak > 0 ? 4 / filteredPeak : 1) : 1;
  return { rms, filteredRms, peak, filteredPeak, cutoff, targetRms, makeupGain,
    outputFilteredRms: filteredRms * makeupGain, outputFilteredPeak: filteredPeak * makeupGain };
}

const curveValue = (curve, progress) => {
  const position = clamp(progress) * (curve.length - 1), index = Math.floor(position);
  return curve[index] + (curve[Math.min(index + 1, curve.length - 1)] - curve[index]) * (position - index);
};

const disconnect = node => { try { node?.disconnect(); } catch {} };
const stop = (node, at) => { try { node?.stop(at); } catch {} };
const voiceSources = voice => [...voice.oscillators, ...(voice.modulators || []), ...(voice.bodyOscillator ? [voice.bodyOscillator] : []), ...(voice.hazeSource ? [voice.hazeSource] : [])];

// Keep analytic targets because AudioParam.value is not a reliable way to
// recover the instantaneous value during an interrupted Safari target ramp.
const targets = new WeakMap();
function valueAt(parameter, now) {
  const state = targets.get(parameter);
  return state ? state.value + (state.from - state.value) * Math.exp(-Math.max(0, now - state.at) / state.seconds) : parameter.value;
}
function approach(parameter, value, now, seconds = .3) {
  const previous = targets.get(parameter); if (previous?.value === value && previous.seconds === seconds) return;
  const from = valueAt(parameter, now);
  if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
  else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(from, now); }
  parameter.setTargetAtTime(value, now, seconds); targets.set(parameter, { value, from, at: now, seconds });
}

export class PatchSoftToneAudio {
  constructor({ context, destination, textureDestination = destination, textureReverbDestination = null, makeSpatialPath, prepareLoop, getTextureCandidates, maxVoices = 32, areaMode = false, random = Math.random } = {}) {
    this.context = context; this.destination = destination; this.textureDestination = textureDestination;
    this.textureReverbDestination = textureReverbDestination;
    this.makeSpatialPath = makeSpatialPath; this.prepareLoop = prepareLoop; this.getTextureCandidates = getTextureCandidates;
    this.maxVoices = Math.max(1, maxVoices); this.patches = new Map(); this.voices = new Map(); this.tails = new Set(); this.handoffTails = new Set(); this.morphVoices = new Map();
    this.residues = new Map(); this.textureSources = new Set(); this.loopBuffers = new WeakMap(); this.textureRecordings = new Map(); this.hazeBuffer = null;
    this.textureAssignments = new Map(); this.recentTextureAssignments = [];
    this.random = typeof random === 'function' ? random : Math.random; this.globalHeat = 1;
    this.areaMode = areaMode === true; this.areaEventIds = new Set(); this.areaHotKeys = new Set(); this.areaCompletedKeys = new Set();
    this.lastTextureAdmissionAt = -Infinity;
    // Count changes act on both materials, including recordings that were
    // scheduled earlier. Keep spatial paths upstream of these shared gains.
    this.toneCrowd = context.createGain(); this.textureCrowd = context.createGain();
    this.toneCrowd.gain.value = this.textureCrowd.gain.value = 1;
    this.toneCrowd.connect(destination); this.textureCrowd.connect(textureDestination);
    this.textureReverbCrowd = textureReverbDestination ? context.createGain() : null;
    if (this.textureReverbCrowd) { this.textureReverbCrowd.gain.value = 1; this.textureReverbCrowd.connect(textureReverbDestination); }
    this.participantCount = 0; this.normalizationCount = 1; this.crowdTargetGain = 1;
    this.textureNormalizationCount = 1; this.textureCrowdTargetGain = 1;
    this.enabled = false; this.toneWeight = 1; this.textureWeight = 1; this.hazeOnlyBlend = 0; this.mixer = { chimes: 1, outDrone: 1 }; this.recentCooling = new Map(); this.allowReleasedCooling = true;
    this.morphSeconds = 8; this.fadeSeconds = 20; this.servedTransitions = 0; this.admissionSequence = 0;
  }
  configure({ enabled = this.enabled, toneWeight = 1, textureWeight = 1, hazeOnlyBlend = this.hazeOnlyBlend, globalHeat = this.globalHeat, mixer = this.mixer, morphSeconds = 8, fadeSeconds = 20, participantCount = this.participantCount, allowReleasedCooling = this.allowReleasedCooling } = {}) {
    if (this.enabled && !enabled) this.stop();
    this.enabled = enabled; this.toneWeight = clamp(toneWeight); this.textureWeight = clamp(textureWeight); this.hazeOnlyBlend = clamp(hazeOnlyBlend); this.mixer = mixer;
    this.allowReleasedCooling = allowReleasedCooling === true; this.globalHeat = clamp(globalHeat);
    if (!this.enabled || this.toneWeight <= 0 || !this.allowReleasedCooling) this.recentCooling.clear();
    this.participantCount = Number.isFinite(Number(participantCount)) ? Math.max(0, Math.floor(Number(participantCount))) : 0;
    this.morphSeconds = Math.max(1, Math.min(180, Number(morphSeconds) || 8)); this.fadeSeconds = Math.max(1, Math.min(180, Number(fadeSeconds) || 20));
  }
  setPatches(values = []) {
    const now = this.context.currentTime, next = new Map(), newResidues = [];
    // Multiple holding identities on one patch still produce one pitch and
    // one extinction edge. Crowd headroom counts those identities separately.
    for (const value of new Map(Array.from(values, value => [String(value.key), value])).values()) {
      const key = String(value.key), previous = this.patches.get(key);
      const patch = { ...value, key, midi: patchMidi(key), position: previous?.position ?? [...(value.position ?? [.5, .5])] };
      next.set(key, patch);
      // Only in-session, authoritative heat loss admits a released patch.
      // Initial cooled snapshots, wet skin, repeated packets and reheating
      // cannot excite or extend it; no actor history or water is invented.
      if (this.enabled && this.allowReleasedCooling && this.toneWeight > 0 && previous && !previous.extinguished && !patch.extinguished &&
          Number.isFinite(patch.heat) && Number.isFinite(previous.heat) && patch.heat < previous.heat) {
        this.recentCooling.set(key, now + PATCH_COOLING_RESPONSE_SECONDS);
      }
      // The first full snapshot establishes a quiet baseline. In-session out
      // edges alone create a lifecycle, and an out patch cannot replay it.
      if (this.areaMode && !patch.extinguished) {
        this.areaCompletedKeys.delete(key);
        if (this.enabled) this.areaHotKeys.add(key);
      }
      if (!this.areaMode && previous && !previous.extinguished && patch.extinguished && this.enabled) {
        const residue = { key, patch, id: patchResidueId(key), at: now, endAt: now + this.morphSeconds + this.fadeSeconds,
          treatment: this._residueTreatment(key), morphSeconds: this.morphSeconds, fadeSeconds: this.fadeSeconds,
          windowsScheduled: 0, lastServed: -Infinity, assignedUrl: null, selected: null };
        this.residues.set(key, residue); newResidues.push(residue);
        const voice = this.voices.get(key);
        if (voice) this._morphVoice(voice, patch, residue, now);
      }
      if (!this.areaMode && !patch.extinguished && previous?.extinguished) this._cancelResidue(key, .3);
    }
    // Assign every extinction edge before native-voice admission. A crowded
    // queue and a packet's insertion order cannot choose its recording later.
    for (const residue of newResidues.sort((a, b) => a.key.localeCompare(b.key))) this._assignTexture(residue, now);
    for (const key of this.patches.keys()) if (!next.has(key)) this._cancelResidue(key);
    if (this.areaMode) {
      for (const key of this.areaHotKeys) if (!next.has(key)) this.areaHotKeys.delete(key);
      for (const key of this.areaCompletedKeys) if (!next.has(key)) this.areaCompletedKeys.delete(key);
      for (const residue of [...this.residues.values()]) if (residue.memberKeys?.some(key => !next.get(key)?.extinguished)) {
        this._cancelResidue(residue.key, residue.memberKeys.every(key => next.has(key)) ? .3 : 0);
      }
    }
    for (const key of this.recentCooling.keys()) if (!next.has(key) || next.get(key).extinguished) this.recentCooling.delete(key);
    this.patches = next; this.tick();
  }
  /** One area event morphs its existing notes into one spatial material. The
   * identity is consumed even while muted, so enabling cannot replay it. */
  triggerAreaExtinction(event = {}) {
    if (!this.areaMode || event.id == null) return false;
    const eventId = String(event.id);
    if (this.areaEventIds.has(eventId)) return false;
    this.areaEventIds.add(eventId);
    while (this.areaEventIds.size > Math.max(512, this.patches.size * 4)) this.areaEventIds.delete(this.areaEventIds.values().next().value);
    const now = this.context.currentTime, key = String(event.key ?? '');
    const memberKeys = [...new Set(Array.isArray(event.memberKeys) ? event.memberKeys.map(String) : [])].sort();
    if (!this.enabled || Number.isFinite(event.expiresAt) && now > event.expiresAt || !memberKeys.includes(key) ||
        !memberKeys.length || !memberKeys.every(member => this.patches.get(member)?.extinguished === true) ||
        !memberKeys.some(member => this.areaHotKeys.has(member) && !this.areaCompletedKeys.has(member))) return false;
    for (const member of memberKeys) { this.areaCompletedKeys.add(member); this.areaHotKeys.delete(member); }
    this._cancelResidue(key, .08);
    const canonical = this.patches.get(key), patch = { ...canonical, position: [...canonical.position] };
    const residue = { key, patch, memberKeys, eventId, id: patchResidueId(key), at: now,
      endAt: now + this.morphSeconds + this.fadeSeconds, treatment: this._residueTreatment(key),
      morphSeconds: this.morphSeconds, fadeSeconds: this.fadeSeconds,
      windowsScheduled: 0, lastServed: -Infinity, assignedUrl: null, selected: null };
    this.residues.set(key, residue);
    for (const member of memberKeys) {
      const voice = this.voices.get(member) || [...this.tails, ...this.handoffTails]
        .filter(candidate => candidate.key === member && !candidate.disposed && candidate.disposeAt > now)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      if (voice) this._morphVoice(voice, this.patches.get(member), residue, now);
    }
    this._assignTexture(residue, now); this.tick();
    return true;
  }
  _residueTreatment(key) {
    // Draw once at the admitted extinction, even if its recording is absent or
    // queued. Native windows and later macro changes retain this material clock.
    const base = patchResidueTreatment(key), pitch = patchResiduePitch(this.globalHeat, this.random());
    return { ...base, ...pitch, basePlaybackRate: base.playbackRate, playbackRate: base.playbackRate * pitch.transposeRatio };
  }
  _morphVoice(voice, patch, residue, now) {
    const from = this._voiceGainAt(voice, now);
    // Morph notes have their own finite bank; outgoing material cannot reserve
    // every place needed by a new held footprint.
    if (this.morphVoices.size >= this.maxVoices && !this.morphVoices.has(voice.key)) {
      const oldest = this.morphVoices.values().next().value;
      this.morphVoices.delete(oldest.key); this._releaseVoice(oldest, now, .08);
    }
    this.voices.delete(voice.key); this.tails.delete(voice); this.handoffTails.delete(voice);
    delete voice.release; voice.oscillators[0].onended = null;
    voice.residue = residue; voice.morphFrom = from; this.morphVoices.set(voice.key, voice);
    const shape = patchSoftToneParameters(patch, this.hazeOnlyBlend); voice.patch = patch;
    voice.emergence = shape.emergence; voice.targetGain = shape.gain;
    this._toneCharacter(voice, shape, now, .25);
    // Remove an earlier release/curve before scheduling the finite native
    // morph. A just-released tone can join continuously after a late packet.
    voice.gain.gain.cancelScheduledValues(voice.morphCurveAt ?? now); voice.gain.gain.setValueAtTime(from, now);
    voice.morphCurveAt = now + .02; voice.toneMorphSeconds = Math.min(PATCH_TONE_EXIT_SECONDS, residue.morphSeconds);
    voice.morphCurve = Float32Array.from({ length: 257 }, (_, i) => {
      // Start at the actual live amplitude, including an unfinished attack.
      // A bell never swells that note or waits for a long material setting.
      return from * Math.cos(smooth(i / 256) * Math.PI / 2);
    });
    voice.morphCurve[voice.morphCurve.length - 1] = 0;
    voice.gain.gain.setValueCurveAtTime(voice.morphCurve, voice.morphCurveAt, voice.toneMorphSeconds);
    targets.delete(voice.gain.gain); voice.disposeAt = voice.morphCurveAt + voice.toneMorphSeconds;
    for (const oscillator of voiceSources(voice)) stop(oscillator, voice.disposeAt);
    voice.oscillators[0].onended = () => this._disposeVoice(voice);
  }
  _position(space, position) {
    const [x, y] = position.map(clamp), panner = space.panner;
    if (space.mode === 'HRTF') {
      const world = [(x - .5) * 7, 0, -(.8 + 6 * y)];
      if (panner.positionX) [panner.positionX.value, panner.positionY.value, panner.positionZ.value] = world;
      else panner.setPosition?.(...world);
      space.distance.gain.value = 1;
    } else { if (panner?.pan) panner.pan.value = (x - .5) * 1.8; space.distance.gain.value = 1 / (1 + .8 * y); }
  }
  _makeVoice(patch, now) {
    const c = this.context, filter = c.createBiquadFilter(), gain = c.createGain(), mixer = c.createGain(), space = this.makeSpatialPath(this.toneCrowd);
    // -3 dB is approximately Butterworth Q in Web Audio's low-pass domain.
    // It avoids a resonant energy bump that would upset the recording match.
    filter.type = 'lowpass'; filter.Q.value = -3; gain.gain.value = 0; mixer.gain.value = this.mixer.chimes * this.toneWeight;
    filter.connect(gain); gain.connect(mixer); mixer.connect(space.input); this._position(space, patch.position);
    const frequency = patchFrequencyForMidi(patch.midi), shape = patchSoftToneParameters(patch, this.hazeOnlyBlend), oscillators = [], partials = [];
    filter.frequency.value = frequency * shape.cutoffRatio;
    for (const ratio of [1, 2]) {
      const oscillator = c.createOscillator(), partial = c.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency * ratio;
      partial.gain.value = ratio === 1 ? shape.fundamentalGain : shape.harmonicGain; oscillator.connect(partial); partial.connect(filter); oscillator.start(now + .02); oscillators.push(oscillator); partials.push(partial);
    }
    const bodyLevel = patchLowRegisterBodyLevel(frequency);
    let bodyOscillator = null, bodyGain = null;
    if (bodyLevel > 0) {
      bodyOscillator = c.createOscillator(); bodyGain = c.createGain();
      bodyOscillator.type = 'sine'; bodyOscillator.frequency.value = frequency * 4;
      bodyGain.gain.value = bodyLevel * shape.fundamentalGain;
      // Bypass the fundamental's low-pass to retain this quiet audible octave.
      // It shares the complete emergence, spatial, mixer and release path.
      bodyOscillator.connect(bodyGain); bodyGain.connect(gain); bodyOscillator.start(now + .02);
    }
    // The upper's audible roughness leaves the assigned fundamental fixed.
    const blurOscillator = c.createOscillator(), upperBlur = c.createGain();
    blurOscillator.type = 'triangle'; blurOscillator.frequency.value = 21 + 22 * materialUnit(patch, 'upper-grain');
    upperBlur.gain.value = shape.upperBlurCents;
    blurOscillator.connect(upperBlur); upperBlur.connect(oscillators[1].detune); blurOscillator.start(now + .02);
    // A shared, local noise buffer makes haze audible instead of relying on
    // a barely perceptible vibrato. Each bounded tone owns only its source and
    // band-pass; no fetches or places in the finite material pool are needed.
    const hazeSource = c.createBufferSource(), hazeFilter = c.createBiquadFilter(), hazeGain = c.createGain();
    if (!this.hazeBuffer) {
      const sampleRate = Math.min(12000, c.sampleRate), length = Math.ceil(sampleRate * 1.37);
      this.hazeBuffer = c.createBuffer(1, length, sampleRate);
      const data = this.hazeBuffer.getChannelData(0); let state = 0x5ab37de9;
      for (let index = 0; index < data.length; index++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; data[index] = (state >>> 0) / 2147483648 - 1; }
    }
    const hazeFrequency = Math.max(70, Math.min(2600, frequency * 1.7));
    // Approximate band-pass noise power matching keeps low assigned notes
    // just as grainy as high ones without making their halo excessively loud.
    const hazeMakeup = .6 / Math.sqrt(Math.PI * hazeFrequency / (3 * this.hazeBuffer.sampleRate));
    hazeSource.buffer = this.hazeBuffer; hazeSource.loop = true;
    hazeSource.playbackRate.value = .97 + .06 * materialUnit(patch, 'haze-speed');
    hazeFilter.type = 'bandpass'; hazeFilter.frequency.value = hazeFrequency; hazeFilter.Q.value = 1;
    hazeGain.gain.value = hazeMakeup * shape.hazeGain;
    hazeSource.connect(hazeFilter); hazeFilter.connect(hazeGain); hazeGain.connect(gain);
    hazeSource.start(now + .02, this.hazeBuffer.duration * materialUnit(patch, 'haze-phase'));
    return { key: patch.key, midi: patch.midi, frequency, position: patch.position, patch, filter, gain, mixer, space, oscillators, partials,
      modulators: [blurOscillator], upperBlur, upperBlurCents: shape.upperBlurCents, hazeSource, hazeFilter, hazeGain, hazeMakeup, haziness: shape.haziness, focus: shape.focus, hazeOnlyBlend: shape.hazeOnlyBlend, startedAt: now,
      bodyLevel, bodyOscillator, bodyGain,
      admission: ++this.admissionSequence, nodes: [filter, gain, mixer, ...oscillators, ...partials, ...(bodyOscillator ? [bodyOscillator, bodyGain] : []), blurOscillator, upperBlur, hazeSource, hazeFilter, hazeGain, ...space.nodes] };
  }
  _toneCharacter(voice, shape, now, seconds = .55) {
    voice.upperBlurCents = shape.upperBlurCents; voice.haziness = shape.haziness; voice.focus = shape.focus; voice.hazeOnlyBlend = shape.hazeOnlyBlend;
    approach(voice.upperBlur.gain, shape.upperBlurCents, now, seconds);
    approach(voice.partials[0].gain, shape.fundamentalGain, now, seconds);
    approach(voice.partials[1].gain, shape.harmonicGain, now, seconds);
    if (voice.bodyGain) approach(voice.bodyGain.gain, voice.bodyLevel * shape.fundamentalGain, now, seconds);
    approach(voice.hazeGain.gain, shape.hazeGain * voice.hazeMakeup, now, seconds);
    approach(voice.filter.frequency, voice.frequency * shape.cutoffRatio, now, seconds);
  }
  _disposeVoice(voice) {
    if (voice.disposed) return; voice.disposed = true;
    this.tails.delete(voice); this.handoffTails.delete(voice); if (this.morphVoices.get(voice.key) === voice) this.morphVoices.delete(voice.key);
    for (const oscillator of voiceSources(voice)) { oscillator.onended = null; stop(oscillator); }
    for (const node of voice.nodes) disconnect(node);
  }
  _releaseVoice(voice, now, seconds = 1.2) {
    if (voice.disposed) return;
    const from = this._voiceGainAt(voice, now);
    if (from < .000001) { this._disposeVoice(voice); return; }
    // Old Safari needs the original curve start removed, followed by the
    // analytically evaluated current amplitude, before a continuous release.
    if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
    else voice.gain.gain.cancelScheduledValues(voice.morphCurveAt ?? now);
    voice.gain.gain.setValueAtTime(from, now); voice.gain.gain.linearRampToValueAtTime(0, now + seconds); targets.delete(voice.gain.gain);
    voice.release = { at: now, from, seconds }; voice.disposeAt = now + seconds + .01;
    for (const oscillator of voiceSources(voice)) stop(oscillator, voice.disposeAt);
    voice.oscillators[0].onended = () => this._disposeVoice(voice); this.tails.add(voice);
    this._reserveReleaseBank(now);
  }
  _reserveReleaseBank(now) {
    while (this.tails.size > this.maxVoices) {
      const voice = [...this.tails].sort((a, b) => this._voiceGainAt(a, now) - this._voiceGainAt(b, now))[0];
      this.tails.delete(voice);
      // The short handoff bank finishes before any replacement oscillator
      // starts (20 ms lead). It preserves a continuous last eight milliseconds
      // without letting release or morph notes reserve the foreground bank.
      this._shortenTail(voice, now, .008); this.handoffTails.add(voice);
      while (this.handoffTails.size > this.maxVoices) {
        const quietest = [...this.handoffTails].sort((a, b) => this._voiceGainAt(a, now) - this._voiceGainAt(b, now))[0];
        this._disposeVoice(quietest);
      }
    }
  }
  _voiceGainAt(voice, now) {
    if (voice.release) return voice.release.from * Math.max(0, 1 - (now - voice.release.at) / voice.release.seconds);
    if (voice.residue) return voice.morphCurve ? curveValue(voice.morphCurve, (now - voice.morphCurveAt) / voice.toneMorphSeconds)
      : voice.morphFrom * patchResidueEnvelope(now - voice.residue.at, voice.residue.morphSeconds, voice.residue.fadeSeconds).tone;
    return valueAt(voice.gain.gain, now);
  }
  _shortenTail(voice, now, seconds = .08) {
    const remaining = Math.max(0, 1 - (now - voice.release.at) / voice.release.seconds), from = voice.release.from * remaining;
    voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(from, now); voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
    voice.release = { at: now, from, seconds }; voice.disposeAt = now + seconds + .001;
    for (const oscillator of voiceSources(voice)) stop(oscillator, voice.disposeAt);
  }
  tick() {
    const now = this.context.currentTime;
    for (const voice of [...this.tails, ...this.handoffTails, ...this.morphVoices.values()]) if (now >= voice.disposeAt) this._disposeVoice(voice);
    for (const source of [...this.textureSources]) if (now >= source.endAt) this._disposeTexture(source);
    for (const [key, residue] of this.residues) if (now >= residue.endAt) this._cancelResidue(key);
    if (!this.enabled) return;
    for (const [key, until] of this.recentCooling) if (now >= until) this.recentCooling.delete(key);
    const desired = [...this.patches.values()].filter(patch => (patch.holding || this.recentCooling.has(patch.key)) &&
      (!patch.extinguished || this.areaMode && this.voices.has(patch.key)) && this.toneWeight > 0)
      .sort((a, b) => (this.voices.has(a.key) ? 0 : 1) - (this.voices.has(b.key) ? 0 : 1) || a.key.localeCompare(b.key)).slice(0, this.maxVoices);
    const keys = new Set(desired.map(patch => patch.key));
    for (const [key, voice] of this.voices) if (!keys.has(key)) { this._releaseVoice(voice, now); this.voices.delete(key); }
    // Active admission has its own reservation. Existing release tails never
    // consume all 32 foreground places when the audience moves at once.
    for (const patch of desired) if (!this.voices.has(patch.key)) {
      this.voices.set(patch.key, this._makeVoice(patch, now));
    }
    for (const [key, voice] of this.voices) {
      const patch = this.patches.get(key), shape = patchSoftToneParameters(patch, this.hazeOnlyBlend); voice.patch = patch; voice.emergence = shape.emergence;
      voice.targetGain = shape.gain;
      approach(voice.gain.gain, voice.targetGain, Math.max(now, voice.startedAt + .02), voice.targetGain > valueAt(voice.gain.gain, now) ? TONE_RISE_SECONDS : .6);
      this._toneCharacter(voice, shape, now);
      approach(voice.mixer.gain, this.mixer.chimes * this.toneWeight, now, .12);
    }
    for (const voice of [...this.morphVoices.values(), ...this.tails, ...this.handoffTails]) {
      // A scene change also reaches already outgoing voices, without touching
      // their native release/morph envelope or extending their stop time.
      if (voice.hazeOnlyBlend !== this.hazeOnlyBlend) this._toneCharacter(voice, patchSoftToneParameters(voice.patch, this.hazeOnlyBlend), now);
      approach(voice.mixer.gain, this.mixer.chimes * this.toneWeight, now, .12);
    }
    for (const source of this.textureSources) approach(source.mixer.gain, this.mixer.outDrone * this.textureWeight, now, .12);
    this._scheduleTextures(now);
    this._updateCrowdGain(now);
  }
  _updateCrowdGain(now) {
    const keys = new Set([...this.voices.values(), ...this.tails, ...this.handoffTails, ...this.morphVoices.values()].map(voice => voice.key));
    for (const source of this.textureSources) keys.add(source.residue.key);
    this.normalizationCount = Math.max(1, this.participantCount, keys.size);
    this.crowdTargetGain = 1 / Math.sqrt(this.normalizationCount);
    // Pending lifecycles own no native source. The small texture pool keeps
    // its own headroom instead of being buried by a much larger tone crowd.
    this.textureNormalizationCount = Math.max(1, this.textureSources.size);
    this.textureCrowdTargetGain = 1 / Math.sqrt(this.textureNormalizationCount);
    // Keep attenuation fast enough for the rounded voice attack. Recovery
    // remains deliberately slower when the audience shrinks.
    for (const bus of [this.toneCrowd, this.textureCrowd, this.textureReverbCrowd].filter(Boolean)) {
      const gain = bus === this.toneCrowd ? this.crowdTargetGain : this.textureCrowdTargetGain;
      const seconds = gain < valueAt(bus.gain, now) ? .35 : 2.4;
      approach(bus.gain, gain, now, seconds);
    }
  }
  _loopBuffer(buffer, id, url) {
    const cached = this.loopBuffers.get(buffer)?.get(id); if (cached) return cached;
    const c = this.context, mono = c.createBuffer(1, buffer.length, buffer.sampleRate), data = mono.getChannelData(0);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const input = buffer.getChannelData(channel); for (let i = 0; i < data.length; i++) data[i] += input[i] / buffer.numberOfChannels; }
    const result = this.prepareLoop(mono), shape = patchTextureRecordingParameters(result, id), output = result.getChannelData(0);
    for (let index = 0; index < output.length; index++) output[index] *= shape.makeupGain;
    const entries = this.loopBuffers.get(buffer) ?? new Map(); entries.set(id, result); this.loopBuffers.set(buffer, entries);
    this.textureRecordings.set(url, { id, url, ...shape }); return result;
  }
  _assignTexture(residue, now) {
    const candidates = [...this.getTextureCandidates(residue.id)].sort((a, b) => a.url.localeCompare(b.url));
    if (!candidates.length) return;
    const previous = this.textureAssignments.get(residue.key);
    let url = candidates.find(candidate => candidate.url === previous)?.url;
    this.recentTextureAssignments = this.recentTextureAssignments.filter(entry => now - entry.at < TEXTURE_ASSIGNMENT_NEAR_SECONDS);
    if (!url) {
      // Prefer an unused recording among nearby extinctions of this material.
      // The per-key tie-break remains stable when the other candidates load
      // later; configured URLs participate before their buffers are decoded.
      const counts = new Map(candidates.map(candidate => [candidate.url, 0]));
      for (const entry of this.recentTextureAssignments) if (counts.has(entry.url)) counts.set(entry.url, counts.get(entry.url) + 1);
      const minimum = Math.min(...counts.values()), first = hash(`${residue.key}:recording`) % candidates.length;
      for (let offset = 0; offset < candidates.length; offset++) {
        const candidate = candidates[(first + offset) % candidates.length];
        if (counts.get(candidate.url) === minimum) { url = candidate.url; break; }
      }
      this.textureAssignments.set(residue.key, url);
    }
    residue.assignedUrl = url;
    this.recentTextureAssignments.push({ key: residue.key, url, at: residue.at });
  }
  _scheduleTextures(now) {
    if (this.textureWeight <= 0) return;
    const available = [...this.residues.values()].filter(residue => residue.endAt > now + .08);
    if (!available.length) return;
    // An ordinary morph owns one continuous native envelope through silence.
    // A larger audience shares finite, staggered windows in a fair queue.
    // If a new burst arrives, retire long windows with a smooth native fade
    // so they cannot reserve the entire pool until their original deadline.
    const pending = available.filter(residue => !residue.windowsScheduled).length;
    const crowded = available.length > PATCH_TEXTURE_SOURCE_LIMIT;
    if (crowded && pending) for (const source of this.textureSources) {
      if (!source.windowed && !source.release && source.endAt > now + 1) {
        const stagger = hash(`${source.residue.key}:handoff`) / 4294967296;
        this._releaseTexture(source, now, .3 + stagger * .6);
      }
    }
    // Repeated packets and multiple scheduler calls share one audio clock.
    // Never fill the native bank with near-coincident recording onsets.
    if (now + .02 + 1e-9 < this.lastTextureAdmissionAt + PATCH_TEXTURE_ADMISSION_SECONDS) return;
    const order = available.sort((a, b) => a.lastServed - b.lastServed || a.at - b.at || a.key.localeCompare(b.key));
    for (const residue of order) {
      if (this.textureSources.size >= PATCH_TEXTURE_SOURCE_LIMIT) break;
      if ([...this.textureSources].some(source => source.residue === residue)) continue;
      if (!residue.selected) {
        if (!residue.assignedUrl) this._assignTexture(residue, now);
        const selected = this.getTextureCandidates(residue.id).find(candidate => candidate.url === residue.assignedUrl);
        // Assignment includes configured endpoints that are still loading.
        // Network completion order cannot change a patch's chosen recording.
        if (!selected?.buffer) continue;
        residue.selected = selected;
      }
      const remaining = residue.endAt - now;
      const stagger = .8 + .4 * hash(`${residue.key}:${residue.windowsScheduled}:window`) / 4294967296;
      const duration = crowded ? Math.min(remaining - .02, Math.max(.2, Math.min(4, remaining * PATCH_TEXTURE_SOURCE_LIMIT / available.length * .6)) * stagger) : remaining - .02;
      if (this._makeTexture(residue, now + .02, duration, crowded)) break;
    }
  }
  _makeTexture(residue, plannedAt, duration, windowed = false) {
    const c = this.context, buffer = this._loopBuffer(residue.selected.buffer, residue.id, residue.selected.url);
    // Preparing a long recording can cross render quanta. Establish the lead
    // after that work while preserving the original extinction deadline.
    const at = Math.max(plannedAt, c.currentTime + .02); duration = Math.min(duration, residue.endAt - at);
    if (duration <= .02 || at + 1e-9 < this.lastTextureAdmissionAt + PATCH_TEXTURE_ADMISSION_SECONDS) return false;
    const source = c.createBufferSource(), gain = c.createGain(), mixer = c.createGain(), filter = c.createBiquadFilter();
    const treatment = residue.treatment, dry = c.createGain(), wet = this.textureReverbCrowd && treatment.reverbSend ? c.createGain() : null;
    // Split only after positioning so a patch's direct material and room send
    // share a location. The room itself is shared by the complete installation.
    const space = this.makeSpatialPath(dry);
    dry.gain.value = wet ? treatment.dryGain : 1; dry.connect(this.textureCrowd);
    if (wet) { wet.gain.value = treatment.reverbSend; space.distance.connect(wet); wet.connect(this.textureReverbCrowd); }
    source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = buffer.duration; source.playbackRate.value = treatment.playbackRate;
    filter.type = 'lowpass'; filter.frequency.value = Math.min(textureCutoff(residue.id) * treatment.cutoffRatio, c.sampleRate * .49); filter.Q.value = .25;
    const edge = Math.min(.24, duration * .24), curveLength = Math.max(129, Math.ceil(duration * 80) + 1), curve = Float32Array.from({ length: curveLength }, (_, i) => {
      const age = duration * i / (curveLength - 1), window = windowed ? Math.min(smooth(age / edge), smooth((duration - age) / edge)) : smooth(age / .04);
      return patchTextureLevel(residue.id) * window * patchResidueEnvelope(at + age - residue.at, residue.morphSeconds, residue.fadeSeconds).texture;
    });
    curve[0] = curve[curve.length - 1] = 0; gain.gain.value = 0; gain.gain.setValueCurveAtTime(curve, at, duration);
    mixer.gain.value = this.mixer.outDrone * this.textureWeight;
    source.connect(filter); filter.connect(gain); gain.connect(mixer); mixer.connect(space.input); this._position(space, residue.patch.position);
    const record = { source, gain, mixer, filter, space, dry, wet, residue, at, duration, curve, windowed, endAt: at + duration + .01,
      nodes: [source, gain, mixer, filter, dry, ...(wet ? [wet] : []), ...space.nodes] };
    this.textureSources.add(record); source.onended = () => this._disposeTexture(record);
    // Follow one continuous material clock if crowd windows are interrupted.
    // A patch-specific rate prevents identical loops from drifting in lockstep.
    const phase = (treatment.phase * buffer.duration + (at - residue.at) * treatment.playbackRate) % buffer.duration;
    source.start(at, phase); source.stop(at + duration); residue.lastServed = at; residue.windowsScheduled++; this.servedTransitions++;
    this.lastTextureAdmissionAt = at; return true;
  }
  _disposeTexture(record) {
    this.textureSources.delete(record); record.source.onended = null; stop(record.source); for (const node of record.nodes) disconnect(node);
  }
  _textureGainAt(source, now) {
    if (source.release) return source.release.from * Math.max(0, 1 - (now - source.release.at) / source.release.seconds);
    return now >= source.at ? curveValue(source.curve, (now - source.at) / source.duration) : 0;
  }
  _releaseTexture(source, now, seconds) {
    const from = this._textureGainAt(source, now), end = Math.min(now + seconds, source.at + source.duration);
    if (from < .000001 || end <= now) { this._disposeTexture(source); return; }
    if (source.gain.gain.cancelAndHoldAtTime) source.gain.gain.cancelAndHoldAtTime(now);
    else source.gain.gain.cancelScheduledValues(source.at);
    source.gain.gain.setValueAtTime(from, now); source.gain.gain.linearRampToValueAtTime(0, end);
    source.endAt = end + .01; source.release = { at: now, from, seconds: end - now }; stop(source.source, end);
  }
  _cancelResidue(key, releaseSeconds = 0) {
    this.residues.delete(key);
    const now = this.context.currentTime;
    for (const voice of [...this.morphVoices.values()]) if (voice.residue?.key === key) {
      this.morphVoices.delete(voice.key);
      if (releaseSeconds > 0) this._releaseVoice(voice, now, releaseSeconds); else this._disposeVoice(voice);
    }
    for (const source of [...this.textureSources]) if (source.residue.key === key) {
      const from = this._textureGainAt(source, now);
      if (releaseSeconds <= 0 || from < .000001) { this._disposeTexture(source); continue; }
      this._releaseTexture(source, now, releaseSeconds);
    }
  }
  stop() {
    for (const voice of [...this.voices.values(), ...this.tails, ...this.handoffTails, ...this.morphVoices.values()]) this._disposeVoice(voice);
    this.voices.clear(); this.tails.clear(); this.handoffTails.clear(); this.morphVoices.clear();
    for (const source of [...this.textureSources]) this._disposeTexture(source);
    this.residues.clear(); this.recentCooling.clear(); this.lastTextureAdmissionAt = -Infinity; this.areaHotKeys.clear();
  }
  reset() { this.stop(); this.patches.clear(); this.loopBuffers = new WeakMap(); this.textureRecordings.clear(); this.recentTextureAssignments = []; this.servedTransitions = 0; this.participantCount = 0;
    this.areaEventIds.clear(); this.areaHotKeys.clear(); this.areaCompletedKeys.clear(); }
  getMetrics() {
    return { scale: 'D♭ major pentatonic', tuning: 'D♭-anchored just intonation', character: 'filtered noise and rough uppers to focused pitch', tuningCents: [...PATCH_TUNING_CENTS], singlePitch: true, areaMode: this.areaMode, consumedAreaEvents: this.areaEventIds.size,
      activeCount: this.voices.size, releaseCount: this.tails.size + this.handoffTails.size, morphToneCount: this.morphVoices.size,
      maxActiveVoices: this.maxVoices, maxNativeVoices: this.maxVoices * 4, textureSourceCount: this.textureSources.size, textureSourceLimit: PATCH_TEXTURE_SOURCE_LIMIT,
      textureAdmissionSeconds: PATCH_TEXTURE_ADMISSION_SECONDS,
      coolingResponseSeconds: PATCH_COOLING_RESPONSE_SECONDS, recentCoolingCount: this.recentCooling.size, allowReleasedCooling: this.allowReleasedCooling, hazeOnlyBlend: this.hazeOnlyBlend,
      globalHeat: this.globalHeat, transposeProbability: patchResidueTransposeProbability(this.globalHeat),
      residueCount: this.residues.size, morphSeconds: this.morphSeconds, toneExitSeconds: Math.min(PATCH_TONE_EXIT_SECONDS, this.morphSeconds), fadeSeconds: this.fadeSeconds, servedTransitions: this.servedTransitions,
      participantCount: this.participantCount, normalizationCount: this.normalizationCount, crowdGain: valueAt(this.toneCrowd.gain, this.context.currentTime), crowdTargetGain: this.crowdTargetGain,
      textureNormalizationCount: this.textureNormalizationCount, textureCrowdGain: valueAt(this.textureCrowd.gain, this.context.currentTime), textureCrowdTargetGain: this.textureCrowdTargetGain,
      tonePeakLevel: PATCH_SOFT_TONE_LEVEL, textureRmsLevel: PATCH_RESIDUE_LEVEL * .1,
      textureRmsLevels: Object.fromEntries(PATCH_RESIDUE_IDS.map(id => [id, textureTargetRms(id) * patchTextureLevel(id)])),
      pendingResidues: [...this.residues.values()].filter(residue => !residue.windowsScheduled).length,
      recordings: [...this.textureRecordings.values()].map(recording => ({ ...recording })),
      voices: [...this.voices.values(), ...this.morphVoices.values()].map(voice => ({ key: voice.key, midi: voice.midi, frequency: voice.frequency, tuningCents: patchTuningCents(voice.midi), position: [...voice.position], emergence: voice.emergence, focus: voice.focus, haziness: voice.haziness, targetGain: voice.targetGain, hazeOnlyBlend: voice.hazeOnlyBlend, currentFundamentalGain: valueAt(voice.partials[0].gain, this.context.currentTime), currentHarmonicGain: valueAt(voice.partials[1].gain, this.context.currentTime), currentBodyGain: voice.bodyGain ? valueAt(voice.bodyGain.gain, this.context.currentTime) : 0, upperBlurCents: voice.upperBlurCents, currentUpperBlurCents: valueAt(voice.upperBlur.gain, this.context.currentTime), currentHazeGain: valueAt(voice.hazeGain.gain, this.context.currentTime) / voice.hazeMakeup })),
      residues: [...this.residues.values()].map(residue => ({ key: residue.key, memberKeys: residue.memberKeys, eventId: residue.eventId, texture: residue.id, url: residue.selected?.url ?? residue.assignedUrl,
        ...residue.treatment, windowsScheduled: residue.windowsScheduled, at: residue.at, endAt: residue.endAt })) };
  }
}
