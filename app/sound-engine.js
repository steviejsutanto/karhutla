// Optional sound layer. This module never writes to the simulation and does no
// work requiring user activation until enable() is called from a gesture.
import { derivePeatDepthState } from '../visual-assets/peat-section.js';
import { computeSceneScore } from './scene-score.js';
import { PatchSoftToneAudio, patchMidi, patchResidueId, patchFrequencyForMidi } from './patch-soft-tones.js';
import { PhoneWeatherAudio } from './phone-weather.js';
import { PhoneTapRainAudio } from './phone-tap-rain.js';
import { MainQuenchAudio, normalizeQuenchSources } from './main-quench.js';
import { createRainAreaTracker } from './rain-area.js';
import { DragAshAudio } from './drag-ash.js';
import { countryPoint } from './country-view.mjs';
import { prepareRecording, recordingPreparation, copyRecordingPreparation, outputDynamics, OUTPUT_LIMIT_INPUT_RANGE, OUTPUT_LIMIT_CEILING, outputProtectionCurve } from './audio-loudness.js';
export { sampleMakeupGain } from './audio-loudness.js';
export { PATCH_PENTATONIC_MIDI, patchMidi, patchResidueId, patchSoftToneParameters, patchResidueEnvelope } from './patch-soft-tones.js';
export const SOUND_MACRO_DEFAULTS = Object.freeze({ haze: .35, forest: .5, ash: .25, rain: .15, moisture: .2 });
export const SOUND_MIXER_DEFAULTS = Object.freeze({ haze: 1, forest: 1, ash: 1, dragAsh: 1, rain: 1, moisture: 1, crickets: 1, chimes: 1, outDrone: 1, lowDrone: 1, bells: 1.6, quench: 1, blob: 1 });
export const SOUND_SAMPLE_URLS = Object.freeze({ crackle: '/audio-assets/fire-crackle.mp3', forest: '/audio-assets/burning-forest.mp3', crickets: '/audio-assets/crickets.mp3', roar: '/audio-assets/fire-roar.mp3', charcoal: '/audio-assets/charcoal.mp3', rain: '/audio-assets/rain.mp3' });

/** Request media playback on supported phones; acceptance cannot prove audibility. */
export function requestPlaybackAudioSession(navigatorObject = globalThis.navigator) {
  try {
    const session = navigatorObject?.audioSession;
    if (!session || typeof session.type !== 'string') return false;
    // Web Audio defaults to ambient on iOS. The supported playback category
    // permits sound in Silent Mode, and may pause other apps' media playback.
    // https://bugs.webkit.org/show_bug.cgi?id=237322#c6
    if (session.type !== 'playback') session.type = 'playback';
    return session.type === 'playback';
  } catch { return false; } // Unsupported/restricted implementations keep normal activation.
}

// Independent passages and spectral distances, rather than identical rain
// loops stacked at the same phase. These are constant-energy perspectives;
// no gain LFO or whole-bed pulse is added to the field recordings.
export const RAIN_PERSPECTIVES = Object.freeze([
  Object.freeze({ name: 'fine-near', level: .76, rate: 1.019, highpass: 350, lowpass: 10000, pan: -.58, motionHz: .017 }),
  Object.freeze({ name: 'broad-middle', level: .53, rate: .977, highpass: 50, lowpass: 6800, pan: .12, motionHz: .011 }),
  Object.freeze({ name: 'soft-far', level: .38, rate: 1, highpass: 80, lowpass: 3900, pan: .64, motionHz: .023 }),
]);

const clamp = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;
const smoothstep = (lo, hi, value) => { const x = clamp((value - lo) / (hi - lo)); return x * x * (3 - 2 * x); };
const LYDIAN_INTERVALS = Object.freeze([0, 2, 4, 6, 7, 9, 11]);
export const PARTICIPANT_MIDI = Object.freeze(Array.from({ length: 35 }, (_, index) => 36 + 12 * Math.floor(index / 7) + LYDIAN_INTERVALS[index % 7]));
export const PARTICIPANT_MIDI_PAIRS = Object.freeze(PARTICIPANT_MIDI.map((midi, index) => Object.freeze([midi, PARTICIPANT_MIDI[index + 1] ?? 96])));
const pitchLabel = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export const PARTICIPANT_PITCH_LABELS = Object.freeze(PARTICIPANT_MIDI_PAIRS.map(pair => pair.map(pitchLabel).join(' / ')));
export const PARTICIPANT_PARTIALS = Object.freeze([1, 2, 3, 4, 6, 8, 10, 12, 16]);
// Preserve the original five-partial RMS and its fundamental amplitude while
// sharing the upper-harmonic energy across a wider, brighter spectrum.
export const PARTICIPANT_GRAIN_AMPLITUDES = Object.freeze(PARTICIPANT_PARTIALS.map((_, index) => index ? .3 * Math.sqrt(4 / (PARTICIPANT_PARTIALS.length - 1)) : .3));
export const PARTICIPANT_ASH_RMS_RATIO = .045;
export const PHONE_CRACKLE_GAIN = 10 ** (7 / 20);
export const PHONE_CRICKET_RATE = .76;
export const TONE_REVERB_RETURN = .82 * 10 ** (6 / 20);
export const MAIN_DRONE_MIDI = Object.freeze([37, 44, 51]);
export const MAIN_DRONE_AMPLITUDES = Object.freeze([.72, .24, .34]);
export const MAIN_DRONE_LEVEL = .05;
export const MAIN_DRONE_OVERTONES = Object.freeze([0, 1, .1, .14, 0, .035]);
const AMBIANCE_IDS = Object.freeze(['haze', 'forest', 'ash', 'rain', 'moisture', 'crickets']);

/** Equal-power character interpolation, with gentle response at both ends. */
export function variationWeights(value, stops = [0, 1]) {
  const low = clamp(stops[0]), high = clamp(stops[1], 1);
  const position = high > low ? smoothstep(low, high, clamp(value)) : Number(clamp(value) >= high);
  if (position === 0) return [1, 0];
  if (position === 1) return [0, 1];
  return [Math.cos(position * Math.PI / 2), Math.sin(position * Math.PI / 2)];
}

/** FNV-1a is deliberately independent of Math.random and arrival order. */
export function patchHash(key) {
  let hash = 2166136261;
  for (const character of String(key)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/** A person's note belongs to their identity, never their location or heat. */
export function participantMidi(participant = {}) {
  const index = Number.isSafeInteger(participant.pitchIndex) ? participant.pitchIndex
    : patchHash(participant.id ?? 'participant');
  return PARTICIPANT_MIDI[((index % PARTICIPANT_MIDI.length) + PARTICIPANT_MIDI.length) % PARTICIPANT_MIDI.length];
}
export const participantFrequency = participant => 440 * 2 ** ((participantMidi(participant) - 69) / 12);
export const participantMidiPair = participant => PARTICIPANT_MIDI_PAIRS[PARTICIPANT_MIDI.indexOf(participantMidi(participant))];
export const audibleMoisture = value => .28 * clamp(value);

/** A piano-like struck attack and gradual ring; cool grains keep their bed. */
export function participantGrainParameters(background, variation = .5) {
  const random = clamp(variation);
  return background ? { duration: .16 + .08 * random, attack: null, interval: .045 + .02 * random }
    : { duration: .4 + .5 * random, attack: .001 + .003 * random, interval: (.14 + .24 * random) / 3 };
}

/** Compatibility list: production patches now have one D♭ pentatonic note. */
export const patchMidiPair = patch => Object.freeze([patchMidi(patch)]);

/** The same analytic envelope drives scheduling and interruption continuity. */
export function participantGrainEnvelopeAt(age, { duration, attack, background = false }) {
  if (age <= 0 || age >= duration) return 0;
  if (background) return Math.sin(Math.PI * age / duration) ** 2;
  if (age < attack) return age / attack;
  const tail = duration - .008, knee = attack + (tail - attack) * .32;
  if (age <= knee) return .38 ** ((age - attack) / (knee - attack));
  if (age <= tail) return .38 * (.008 / .38) ** ((age - knee) / (tail - knee));
  return .008 * (duration - age) / (duration - tail);
}
function scheduleGrainEnvelope(parameter, at, shape, peak) {
  const { duration, attack, background } = shape;
  if (background) {
    const window = Float32Array.from({ length: 128 }, (_, index) => peak * participantGrainEnvelopeAt(duration * index / 127, shape));
    window[0] = window[127] = 0; parameter.setValueCurveAtTime(window, at, duration);
  } else {
    parameter.setValueAtTime(0, at);
    const tail = duration - .008, knee = attack + (tail - attack) * .32;
    parameter.linearRampToValueAtTime(peak, at + attack);
    parameter.exponentialRampToValueAtTime(peak * .38, at + knee);
    parameter.exponentialRampToValueAtTime(peak * .008, at + tail);
    parameter.linearRampToValueAtTime(0, at + duration);
  }
}

/** Increasing distance removes presence and width before a short final tail. */
export function cricketRetreatParameters(elapsedMs = 0, durationMs = 60000) {
  const progress = clamp(elapsedMs / Math.max(1, durationMs)), travel = smoothstep(0, 1, progress);
  const distance = 2 + 88 * travel;
  return { progress, distance, gain: 1 / (1 + .075 * (distance - 2)),
    lowpass: 7200 * (.13 ** travel), highpass: 600 - 320 * travel, spread: 1 - .8 * travel,
    tail: 1 - smoothstep(Math.max(0, durationMs - 2200), durationMs, elapsedMs) };
}

/** Filtering reveals a fixed fundamental as the authoritative fire cools. */
export function participantToneParameters(participant = {}) {
  const heat = participant.extinguished ? 0 : clamp(participant.heat ?? participant.fireIntensity, 1);
  const fire = smoothstep(0, 1, heat);
  const raw = [1 - .92 * fire, .06 + .69 * fire, .025 + .72 * fire, .012 + .65 * fire, .006 + .47 * fire,
    .003 + .42 * fire, .002 + .35 * fire, .001 + .28 * fire, .0005 + .22 * fire];
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0));
  return { heat, fire, partialGains: raw.map(value => value / norm),
    highpassRatio: .24 + 1.95 * fire, lowpassRatio: 1.35 + 18.65 * fire,
    background: participant.extinguished === true };
}

/** Map the shared normalized map into a room in front of the listener. */
export function participantPosition(position = [.5, .5]) {
  const x = clamp(Array.isArray(position) ? position[0] : position?.x, .5);
  const y = clamp(Array.isArray(position) ? position[1] : position?.y, .5);
  return { x, y, world: [(x - .5) * 7, 0, -(.8 + 6 * y)], pan: (x - .5) * 1.8, distanceGain: 1 / (1 + .8 * y) };
}

const loopInformation = new WeakMap();
const grainBufferAsh = new WeakMap();
const grainBufferMix = new WeakMap();
/** Join recordings once, then let the audio clock loop them without JS timers. */
export function circularLoopBuffer(context, buffer, { cricket = false } = {}) {
  const rate = buffer.sampleRate, channels = buffer.numberOfChannels;
  const block = Math.max(8, Math.round(rate * .04)), energies = [];
  for (let start = 0; start + block <= buffer.length; start += block) {
    let energy = 0;
    for (let channel = 0; channel < channels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = start; index < start + block; index++) energy += data[index] ** 2;
    }
    energies.push(Math.sqrt(energy / (block * channels)));
  }
  let start = 0, end = buffer.length;
  // The older phone exports contain long fade guards. Remove only quiet edges;
  // new recordings with 5 ms guards retain their timing and natural dynamics.
  if (!cricket && energies.length > 12) {
    const typical = [...energies].sort((a, b) => a - b)[Math.floor(energies.length / 2)];
    while (start < rate * .2 && energies[Math.floor(start / block)] < typical * .7) start += block;
    while (buffer.length - end < rate * .4 && energies[Math.floor(end / block) - 1] < typical * .7) end -= block;
  }
  const available = end - start, overlap = Math.max(2, Math.min(Math.round(rate * (cricket ? .025 : .55)), Math.floor(available / 4)));
  const length = available - overlap, result = context.createBuffer(channels, length, rate);
  // Equal-power overlap keeps an uncorrelated fire bed at steady energy. A
  // correlation correction also avoids a bump when two ends are similar.
  let cross = 0, firstPower = 0, lastPower = 0;
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < overlap; index++) {
      const first = data[start + index], last = data[end - overlap + index];
      cross += first * last; firstPower += first ** 2; lastPower += last ** 2;
    }
  }
  const correlation = Math.max(-.5, Math.min(.95, cross / Math.sqrt(firstPower * lastPower || 1)));
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel), output = result.getChannelData(channel), core = available - 2 * overlap;
    output.set(data.subarray(start + overlap, end - overlap));
    for (let index = 0; index < overlap; index++) {
      const position = index / (overlap - 1), left = Math.cos(position * Math.PI / 2), right = Math.sin(position * Math.PI / 2);
      const norm = Math.sqrt(1 + 2 * correlation * left * right);
      output[core + index] = (data[end - overlap + index] * left + data[start + index] * right) / norm;
    }
  }
  loopInformation.set(result, { crossfadeSeconds: overlap / rate, trimStartSeconds: start / rate, trimEndSeconds: (buffer.length - end) / rate });
  return result;
}

/** Nonlinear timbre controls, kept pure for inspection and regression tests. */
export function macroParameters(values = {}) {
  const migrated = { ...values, forest: values.forest ?? values.charcoal ?? SOUND_MACRO_DEFAULTS.forest };
  const m = Object.fromEntries(Object.entries(SOUND_MACRO_DEFAULTS).map(([name, value]) => [name, clamp(migrated[name] ?? value, value)]));
  const { haze, forest, ash, rain } = m, moisture = audibleMoisture(m.moisture);
  const damp = 1 - .78 * moisture ** 1.35;
  return {
    macros: m,
    audibleMoisture: moisture,
    fireCutoff: Math.min(5800, 380 + 5200 * (1 - haze) ** 2.2 * damp + 850 * forest ** 3 * (1 - .5 * moisture)),
    fireResonance: .45 + .35 * haze ** 2,
    fireHighpass: 65 + 400 * ash ** 2.3,
    fireRate: .9 + .12 * forest ** 2 - .06 * moisture,
    charcoalCutoff: (650 + 2550 * (1 - ash) ** 1.7) * damp,
    charcoalRate: .86 + .18 * forest ** 1.6,
    saturation: .7 + 1.5 * forest ** 2.1,
    grainDensity: (.3 + 17 * forest ** 3) * (1 - .45 * moisture),
    grainDuration: .14 + .18 * (1 - ash) ** 2,
    ashHighpass: 650 + 6500 * ash ** 2,
    ashScatter: .08 + .85 * ash ** 2.5,
    rainCutoff: (850 + 11800 * rain ** .65) * (1 - .45 * moisture),
    rainRate: .68 + .68 * rain ** 1.7,
    rainScatter: .08 + .85 * rain ** 3,
    rainLevel: .125 * rain ** 1.45,
    delaySeconds: .17 + .47 * haze ** 1.6 + .09 * moisture ** 2,
    // Fire remains dry. Haze changes filtering rather than adding roomy tails.
    delaySend: 0,
    feedback: 0,
    damping: 900 + 9000 * (1 - moisture) ** 2,
    toneCutoff: 600 + 3400 * (1 - moisture) ** 1.5,
    // Smooth density changes affect transient texture as well as sample gain.
    fireLevel: .06 + .23 * forest ** 1.8,
    forestLevel: .025 + .26 * forest ** 2,
    charcoalLevel: .008 + .12 * forest ** 2,
    turbulenceLevel: .006 + .08 * forest ** 2.4,
    ashLevel: .004 + .014 * ash ** 1.8,
  };
}

/** Quiet, rounded fine crackle; no impulse attack, bass boom, or sharp fizz. */
export function dryFireTextureParameters(intensity, variation = .5, moisture = 0) {
  const level = clamp(intensity), random = clamp(variation), wet = clamp(moisture);
  return { attack: .022 + .038 * random, duration: .15 + .2 * random,
    gain: (.003 + .017 * level ** 2) * (.45 + .55 * random) * (1 - .5 * wet),
    highpass: 180 + 160 * random, lowpass: (1500 + 2000 * random) * (1 - .45 * wet),
    resonance: .35 };
}

/** Integrate the very same ember profile drawn through the side-view peat. */
export function patchDepthCooling(patch = {}) {
  let darkness = 0;
  for (let layer = 0; layer < 32; layer++) darkness += 1 - derivePeatDepthState(patch, (layer + .5) / 32).ember;
  return clamp(darkness / 32);
}

/** Authoritative global counts also work when a phone has only local patches. */
export function fireProgression({ sourceCount = 0, outCount = 0 } = {}) {
  const total = Number.isFinite(Number(sourceCount)) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(Number(sourceCount)))) : 0;
  const out = Number.isFinite(Number(outCount)) ? Math.max(0, Math.min(total, Math.trunc(Number(outCount)))) : 0;
  return { sourceCount: total, outCount: out, fraction: total ? out / total : 0 };
}

/** Count-based aftermath: a few out fires must not turn a burning map into insects. */
export function landscapeBlend(condition = {}) {
  const summary = fireProgression(condition), fraction = summary.fraction;
  return { ...summary, fireWeight: summary.sourceCount ? Math.sqrt(1 - fraction) : 0,
    cricketWeight: summary.sourceCount ? fraction ** 3 : 0 };
}

/** The hall's phone field starts in the distance. A partly extinguished map
 * must still sound like fire; close insects belong near full extinction. */
export function phoneCricketParameters(condition = {}) {
  const summary = fireProgression(condition), fraction = summary.fraction;
  return { ...summary, weight: summary.sourceCount ? smoothstep(.45, 1, fraction) ** 2 : 0,
    approach: smoothstep(.7, 1, fraction) };
}

function cricketPerspectiveWeights(value, count) {
  const position = clamp(value) * (count - 1), lower = Math.min(count - 2, Math.floor(position));
  const pair = variationWeights(value, [lower / (count - 1), (lower + 1) / (count - 1)]);
  const weights = Array(count).fill(0); weights[lower] = pair[0]; weights[lower + 1] = pair[1];
  return weights;
}

/** The same authoritative ground/fire summary drives every main-page macro. */
export function automaticSoundMacros(condition = {}) {
  const summary = fireProgression(condition), heat = clamp(condition.heat, summary.sourceCount ? 1 - summary.fraction : 0);
  const moisture = clamp(condition.moisture), wet = clamp(condition.surfaceWetness, moisture);
  return { haze: clamp(heat * (.3 + .7 * (1 - wet))), forest: heat ** .8,
    ash: clamp(.08 + .72 * (1 - heat) + .2 * moisture), rain: wet ** .8, moisture };
}

/** Phones share a discrete global macro state and never sound touch tones. */
export function phoneBedParameters(patches = [], _focusKey = null, { progression = null } = {}) {
  let count = 0, outCount = 0, heatSum = 0, moistureSum = 0;
  for (const patch of patches) {
    count++; if (patch.extinguished) outCount++;
    heatSum += patch.extinguished ? 0 : clamp(patch.heat); moistureSum += clamp(patch.moisture);
  }
  const summary = fireProgression(progression ?? { sourceCount: count, outCount });
  const heat = Number.isFinite(progression?.heat) ? clamp(progression.heat)
    : count && count === summary.sourceCount ? heatSum / count
      : summary.sourceCount > summary.outCount ? 1 : 0;
  const moisture = Number.isFinite(progression?.moisture) ? clamp(progression.moisture) : count ? moistureSum / count : 0;
  const { fireWeight } = landscapeBlend(summary), cricketWeight = phoneCricketParameters(summary).weight;
  return { gain: summary.sourceCount ? .04 * PHONE_CRACKLE_GAIN * fireWeight * (.65 + .35 * Math.sqrt(heat)) * (1 - .6 * moisture ** 1.2) : 0,
    cricketGain: summary.sourceCount ? .04 * cricketWeight : 0,
    cutoff: 600 + 6500 * (1 - moisture) ** 1.5 * (.5 + .5 * Math.sqrt(heat)),
    heat, moisture, activeFireCount: summary.sourceCount - summary.outCount, touchDucking: 1, fireWeight, cricketWeight,
    stage: progression?.stage ?? null, steps: progression?.steps ?? null, progression: summary };
}

const automation = new WeakMap();
function holdParameter(param, now, fallback = param.value) {
  const previous = automation.get(param);
  const current = previous ? previous.value + (previous.from - previous.value) * Math.exp(-Math.max(0, now - previous.at) / previous.smoothing) : fallback;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
  else { param.cancelScheduledValues(now); param.setValueAtTime(current, now); }
  automation.delete(param);
  return current;
}
function target(param, value, now, smoothing = .12, fallback = param?.value) {
  if (!param || !Number.isFinite(value)) return;
  const previous = automation.get(param);
  if (previous?.value === value && previous.smoothing === smoothing) return;
  // cancelAndHoldAtTime is absent in some older iOS releases.
  const from = holdParameter(param, now, fallback);
  param.setTargetAtTime(value, now, smoothing);
  automation.set(param, { from, value, at: now, smoothing });
}
function disconnect(node) { try { node?.disconnect(); } catch { /* Already detached. */ } }
function stop(node, at) { try { node?.stop(at); } catch { /* Already stopped. */ } }
function curveFor(amount) {
  const curve = new Float32Array(512), drive = Math.max(.1, amount), scale = Math.tanh(drive);
  for (let index = 0; index < curve.length; index++) curve[index] = Math.tanh((2 * index / (curve.length - 1) - 1) * drive) / scale;
  return curve;
}
const FADE_IN = Float32Array.from({ length: 32 }, (_, index) => Math.sin(index / 31 * Math.PI / 2));
const FADE_OUT = Float32Array.from(FADE_IN).reverse();
const PARTICIPANT_MINIMUM_GATE_SECONDS = .65;
const PARTICIPANT_ATTACK_SECONDS = .8;
const PARTICIPANT_RELEASE_SECONDS = 1.65;
const TONE_GRAIN_LIMIT = 256;
const TONE_GRAINS_PER_VOICE = 20;
const PATCH_BACKGROUND_GRAIN_LIMIT = 96;
const PATCH_BACKGROUND_RATE = 200;
const TONE_DIRECT_POWER = .0016;

export class WildfireSound {
  constructor({ mode = 'phone', onStatus = () => {}, onBell = () => {}, maxVoices = 32, level = .55, sampleUrls = {}, contextFactory, fetchImpl, document: documentObject, areaClock = () => Date.now() / 1000 } = {}) {
    this.mode = mode === 'operator' ? 'operator' : 'phone';
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.onBell = typeof onBell === 'function' ? onBell : () => {};
    this.maxVoices = Math.max(1, Math.min(32, Math.trunc(Number(maxVoices) || 32)));
    this.level = clamp(level, .55);
    this.macros = { ...SOUND_MACRO_DEFAULTS };
    this.mixer = { ...SOUND_MIXER_DEFAULTS }; this.mixerNodes = new Map();
    this.automationEnabled = true;
    this.scene = null; this.sceneReceivedAt = 0; this.sceneGainSchedule = null; this.sceneMasterEnvelope = null; this.mainDrone = null; this.finalRainForest = null;
    this.urls = { ...SOUND_SAMPLE_URLS, ...sampleUrls };
    this.contextFactory = contextFactory ?? (() => { const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext; if (!Ctor) throw new Error('This browser does not support Web Audio.'); return new Ctor({ latencyHint: 'interactive' }); });
    this.fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.document = documentObject ?? globalThis.document;
    this.hidden = Boolean(this.document?.hidden);
    this.enabled = false; this.muted = false; this.destroyed = false;
    this.state = 'off'; this.message = 'Sound is off.';
    this.context = null; this.patches = new Map(); this.voices = new Map(); this.tails = new Set(); this.layers = new Map(); this.progression = null;
    this.patchVoiceMode = false; this.patchVoices = new Map(); this.backgroundPatches = []; this.patchBackgroundCursor = 0; this.nextPatchBackgroundGrain = 0;
    this.patchSoftTones = null; this.phoneWeather = null; this.phoneInteraction = null; this.localBells = null; this.localInteraction = null; this.audienceParticipationCount = 0;
    this.mainQuench = null; this.mainQuenchSources = []; this.quenchEventIds = new Set(); this.localQuenchSerial = 0; this.localBellAudition = false; this.lastBellEvent = null;
    this.mainBlob = null; this.mainBlobSources = []; this.pendingBlobs = []; this.lastBlobAt = -Infinity; this.blobObserved = 0; this.blobDropped = 0;
    this.dragAsh = null; this.bellFeedbackPatch = null; this.bellFeedbackSerial = 0;
    this.bellFeedbackSession = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.phoneRain = null; this.phoneRainSource = null; this.residueSources = new Map(); this.residueRequests = new Map();
    this.mainEventBurstAt = -Infinity; this.mainEventBurstCount = 0;
    this.rainAreaMode = false; this.rainAreaField = null; this.rainAreaContacts = []; this.rainAreaClock = areaClock;
    this.rainAreaTracker = createRainAreaTracker(); this.pendingRainAreas = []; this.lastRainAreaAt = -Infinity; this.rainAreaEvents = 0;
    this.participants = new Map(); this.participantActivity = new Map(); this.localParticipant = null; this.participantAssignments = new Map(); this.localPitchIndex = null; this.localAutoPitchIndex = null;
    this.loadedSamples = new Set(); this.failedSamples = new Set(); this.pendingSamples = new Set();
    this.sourceRequests = new Map(); this.sourceErrors = new Map();
    this.variations = new Map(); this.cricketLayers = null; this.manualSources = new Set(); this.bufferCache = new Map();
    this.touchedKey = null; this.lastVisitedKey = null; this.timer = null; this.suspendTimer = null; this.fetchController = null; this.generation = 0; this.epoch = null;
    this.pendingToneKey = null;
    this.lastSaturation = null; this.tickSequence = 0; this.nextGrain = 0; this.grains = new Set(); this.aggregateHeat = 0;
    this.toneGrains = new Set(); this.toneGrainBuffers = new Map(); this.nextToneGrain = 0; this.toneGrainCursor = 0;
    this.retiredToneSpaces = new Set();
    const entropy = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0];
    this.randomState = (entropy ?? (Date.now() ^ Math.floor(Math.random() * 4294967296))) >>> 0 || 17307;
    this.gust = .5;
    // Main keeps sounding when the operator switches to the projection tab.
    // Phones still release/mute when their screen is hidden.
    this._visibilityListener = () => { if (this.mode === 'phone') this.setHidden(Boolean(this.document.hidden)); };
    this.document?.addEventListener?.('visibilitychange', this._visibilityListener);
  }

  getMetrics() {
    const soft = this.patchSoftTones?.getMetrics();
    return { mode: this.mode, enabled: this.enabled, muted: this.muted, hidden: this.hidden, state: this.state,
      message: this.message, contextState: this.context?.state ?? 'unavailable', masterLevel: this.level,
      macros: { ...this._effectiveMacros() }, automation: { enabled: this.automationEnabled, manualMacros: { ...this.macros }, effectiveMacros: { ...this._effectiveMacros() }, condition: this._soundCondition() },
      mixer: { ...this.mixer },
      scene: this.scene ? { ...this.scene, effectiveFade: this._sceneGain(), fieldFade: this._fieldSceneGain() } : null,
      sceneScore: this._sceneScore(),
      outputGains: { main: this.mode === 'operator' ? this._outputGain() : 0, phone: this.mode === 'phone' ? this._outputGain() : 0, field: this._fieldSceneGain() },
      loudness: { ...outputDynamics(this.mode), peakCeiling: OUTPUT_LIMIT_CEILING, gainReductionDb: this.compressor?.reduction ?? 0 },
      preparedRecordings: Object.fromEntries([...this.layers].map(([id, layer]) => [id, [ ...(layer.buffer ? [{ url: layer.currentUrl, ...recordingPreparation(layer.buffer) }] : []), ...[...layer.variationSlots.values()].filter(slot => slot.buffer).map(slot => ({ url: slot.currentUrl, ...recordingPreparation(slot.buffer) })) ]])),
      mainDrone: this.mode === 'operator' ? { gain: this._mainDroneGain(), coolingProgress: this._droneProgress(), separationSemitones: this._droneTransposition(), frequencies: this._droneFrequencies(), harmonicLevels: [...MAIN_DRONE_AMPLITUDES], banks: [this._droneFrequencies().slice(0, 3), this._droneFrequencies().slice(3)], oscillatorCount: this.mainDrone?.oscillators.length ?? 0 } : null,
      loadedSamples: [...this.loadedSamples], failedSamples: [...this.failedSamples], samplePending: [...this.pendingSamples],
      selectedSources: { ...this.urls }, currentSources: Object.fromEntries([...this.layers].map(([id, layer]) => [id, layer.currentUrl ?? null])),
      sourceErrors: Object.fromEntries(this.sourceErrors), sourceModes: Object.fromEntries(AMBIANCE_IDS.map(id => [id, this._usesVariations(id) ? 'automatic' : 'manual'])),
      variationWeights: Object.fromEntries([...this.variations].map(([id, entries]) => [id, entries.map((entry, index) => ({ url: entry.url, at: entry.at, weight: this._variationWeights(id)[index], audibleWeight: this.layers.get(id)?.variationSlots.get(entry.url)?.weight ?? 0 }))])),
      currentVariationSources: Object.fromEntries([...this.layers].filter(([, layer]) => this._usesVariations(layer.id)).map(([id, layer]) => [id, [...layer.variationSlots.values()].filter(slot => slot.buffer).map(slot => slot.currentUrl)])),
      sampleLoops: Object.fromEntries([...this.layers].map(([id, layer]) => [id, [...layer.sources].map(record => ({ url: record.url, nativeLoop: Boolean(record.source.loop), loopDuration: record.source.loop ? record.buffer.duration : null, phase: record.phase ?? 0, perspective: record.perspective?.name ?? null, playbackRate: record.source.playbackRate.value, ...loopInformation.get(record.buffer) }))])),
      decodedBytes: [...new Set([...this.bufferCache.values()].map(entry => entry.buffer))].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0),
      voiceCount: this.patchVoiceMode ? soft?.activeCount ?? 0 : this.voices.size,
      releasingVoiceCount: this.patchVoiceMode ? soft?.releaseCount ?? 0 : this.tails.size,
      activeSources: [...this.layers.values()].reduce((sum, layer) => sum + layer.sources.size + Number(Boolean(layer.fallbackSource)), 0) + this.grains.size + this.toneGrains.size + (soft?.textureSourceCount ?? 0) + (this.dragAsh?.grains.size ?? 0),
      touchedKey: this.touchedKey, pendingToneKey: null, patches: this.patches.size, degraded: this.failedSamples.size > 0,
      progression: this._progression(),
      phoneBed: this.mode === 'phone' ? this._phoneBed() : null,
      phoneWeather: this.phoneWeather?.getMetrics() ?? null,
      phoneRain: this.phoneRain?.getMetrics() ?? null,
      mainBells: this.mode === 'operator' ? this.localBells?.getMetrics() ?? null : null,
      mainQuench: this.mainQuench?.getMetrics() ?? null,
      mainBlob: this.mainBlob ? { ...this.mainBlob.getMetrics(), pending: this.pendingBlobs.length, observed: this.blobObserved, dropped: this.blobDropped } : null,
      dragAsh: this.dragAsh?.getMetrics() ?? null,
      localBells: this.localBells?.getMetrics() ?? null,
      lastBellEvent: this.lastBellEvent ? { ...this.lastBellEvent } : null,
      rainAreas: { enabled: this.rainAreaMode, ...this.rainAreaTracker.getMetrics(), pending: this.pendingRainAreas.length, triggered: this.rainAreaEvents },
      softTones: this.patchSoftTones?.getMetrics() ?? null,
      cricketGain: this._cricketGain(), cricketRetreat: this._cricketRetreat(), cricketLayers: this.cricketLayers?.map(entry => ({ ...entry })) ?? [], landscapeBlend: landscapeBlend(this._progression()),
      participantCount: this.patchVoiceMode ? this.audienceParticipationCount : this.participants.size + Number(Boolean(this.localParticipant)),
      parkedParticipants: Math.max(0, this._desiredParticipants().length - (this.patchVoiceMode ? soft?.activeCount ?? 0 : this.voices.size)),
      patchVoices: this.patchVoiceMode ? { logicalCount: this.patchVoices.size, heldCount: [...this.patchVoices.values()].filter(patch => patch.holding && !patch.extinguished).length,
        extinguishedCount: this.backgroundPatches.length, nativeCount: soft?.activeCount ?? 0, audibleCount: (soft?.activeCount ?? 0) + (soft?.residueCount ?? 0),
        backgroundGrainCount: 0, pendingBackgroundCount: soft?.pendingResidues ?? 0,
        patches: [...this.patchVoices.values()].map(patch => ({ id: patch.id, key: patch.key, midi: patch.midi, midiPair: [...patch.midiPair], texture: patch.texture,
          position: [...patch.position], holding: patch.holding, extinguished: patch.extinguished })) } : null,
      localPitchIndex: this.localPitchIndex ?? this.localAutoPitchIndex,
      toneGranular: this.mode === 'operator' ? { grainCount: this.toneGrains.size, maxGrains: TONE_GRAIN_LIMIT, maxGrainsPerVoice: TONE_GRAINS_PER_VOICE,
        mono: true, activeGrainSeconds: [.4, .9], activeIntervalSeconds: [.14 / 3, .38 / 3], attackSeconds: [.001, .004], activeDecay: { kneeFraction: .32, kneeAmplitude: .38, tailAmplitude: .008 }, outGrainSeconds: [.16, .24], ashMix: PARTICIPANT_ASH_RMS_RATIO, ashMixUnit: 'tone-rms-ratio',
        bufferMixes: [...this.toneGrainBuffers].map(([midi, buffer]) => ({ midi, ...grainBufferMix.get(buffer) })),
        voices: [...this.voices.values()].map(voice => ({ id: voice.key, midiPair: [...voice.midiPair], grainCount: [...this.toneGrains].filter(grain => grain.voice === voice).length, nextAt: voice.nextGrainAt, extinguished: voice.extinguished })),
        grains: [...this.toneGrains].map(grain => ({ id: grain.participantId, midi: grain.midi, frequency: grain.frequency, attack: grain.attack, duration: grain.duration, background: grain.background, position: [...grain.voice.position], envelopeAt80ms: participantGrainEnvelopeAt(.08, grain), peak: grain.peak })),
        frequencies: [...new Set([...this.voices.values()].map(voice => voice.frequency))].sort((a, b) => a - b), directGainPower: TONE_DIRECT_POWER,
        bufferCount: this.toneGrainBuffers.size,
        bufferBytes: [...this.toneGrainBuffers.values()].reduce((sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0) } : null,
      toneReverb: this.mode === 'operator' ? { enabled: Boolean(this.toneReverb), seconds: this.toneReverb?.buffer?.duration ?? 0, returnGain: this.toneReverbReturn?.gain.value ?? 0, retiredSpaces: this.retiredToneSpaces.size } : null,
      frequencies: [...this.voices.values()].map(voice => ({ key: voice.key, id: voice.key, number: voice.participant.number, midi: voice.midi, midiPair: [...voice.midiPair],
        frequency: voice.frequency, frequencies: voice.midiPair.map(midi => 440 * 2 ** ((midi - 69) / 12)), partials: voice.partials, partialGains: [...voice.partialGains], gain: voice.targetGain,
        position: [...voice.position], spatialMode: voice.spatialMode, extinguished: voice.extinguished, kind: voice.kind })),
    };
  }

  _status(state, message) {
    this.state = state; this.message = message;
    try { this.onStatus(this.getMetrics()); } catch { /* A UI callback cannot stop audio cleanup. */ }
  }
  _report() {
    if (this.destroyed || !this.enabled) this._status('off', 'Sound is off.');
    else if (this.muted) this._status('muted', 'Sound muted.');
    else if (this.hidden) this._status('suspended', 'Sound paused while this page is hidden.');
    else if (this.context?.state !== 'running') this._status('suspended', 'Sound paused. Tap Sound on to resume.');
    else this._status('ready', this.failedSamples.size ? 'Sound on · a recording could not load; the previous sound or fallback remains.' : this.pendingSamples.size ? 'Sound on · loading selected recordings.' : 'Sound on.');
  }

  /** Call directly in a click/pointer handler. resume precedes every await. */
  enable() {
    if (this.destroyed) return Promise.resolve(false);
    this.enabled = true; this.muted = false;
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    let resumed;
    try {
      if (this.mode === 'phone') requestPlaybackAudioSession();
      if (!this.context || this.context.state === 'closed') {
        this.context = this.contextFactory();
        // iOS activation must be consumed before fetching or promise continuations.
        resumed = this.context.resume();
        this._buildGraph();
        this.context.onstatechange = () => {
          if (!this.context || this.destroyed) return;
          if (this.context.state === 'running' && this.enabled && !this.muted && !this.hidden) this._startScheduler();
          else { this._stopScheduler(); this.pendingBlobs = []; this.mainBlob?.setActive(false); this.dragAsh?.configure({ active: false }); }
          this._report();
        };
      } else resumed = this.context.resume();
      this._status('starting', 'Starting sound…');
      const context = this.context;
      // Synthesized texture is immediately available; samples are optional.
      this._startSources(); this._applyParameters();
      this._loadSamples();
      return Promise.resolve(resumed).then(() => {
        if (this.destroyed || !this.enabled || context !== this.context) return false;
        if (this.hidden || this.muted) { this._pause(); return false; }
        this._applySceneGain();
        this._ensureTouchedVoice(); this._startScheduler(); this._report();
        return context.state === 'running';
      }).catch(error => { if (!this.destroyed) this._status('error', `Sound could not start: ${error?.message ?? 'tap to try again'}`); return false; });
    } catch (error) {
      this._status('error', `Sound unavailable: ${error?.message ?? 'unsupported browser'}`);
      return Promise.resolve(false);
    }
  }

  setLevel(value) {
    this.level = clamp(value, this.level);
    this._applySceneGain();
    return this.level;
  }
  /** Main-output trims stay separate from timbre controls and scene masks. */
  setMixer(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
    const entries = Object.entries(values);
    if (entries.some(([name, value]) => !Object.hasOwn(SOUND_MIXER_DEFAULTS, name) || !Number.isFinite(value))) return false;
    for (const [name, value] of entries) this.mixer[name] = Math.max(0, Math.min(2, value));
    this._applyMixer(); return true;
  }
  _applyMixer() {
    if (this.mode !== 'operator' || !this.context) return;
    const now = this.context.currentTime;
    for (const [name, node] of this.mixerNodes) target(node.gain, this.mixer[name], now, .06);
    for (const voice of [...this.voices.values(), ...this.tails]) {
      const value = this.mixer[voice.extinguished ? 'outDrone' : 'chimes'];
      target(voice.directMixer.gain, value, now, .06); target(voice.grainMixer.gain, value, now, .06);
    }
    for (const grain of this.toneGrains) if (grain.standalone) target(grain.mixer.gain, this.mixer.outDrone, now, .06);
    this._syncPatchSoftTones(); this._syncMainQuench(); this._syncLocalBells();
  }
  /** Scene pause freezes its fade; it does not mute a user's enabled sound. */
  setSceneState(value) {
    if (value == null) { this.scene = null; this.finalRainForest = null; this._applySceneGain(); this._applyParameters(); this._updateVoices(); return true; }
    if (!value || !['arrival', 'instructions', 'participation', 'forest-takeover', 'final-rain', 'afterglow', 'ended'].includes(value.id)) return false;
    for (const field of ['elapsedMs', 'afterglowDurationMs', 'fade', 'rainIntensity', 'mainFadeDurationMs', 'phoneOnlyDurationMs', 'phoneFadeDurationMs', 'instructionsCrossfadeMs', 'participationCrossfadeMs']) if (value[field] !== undefined && (!Number.isFinite(value[field]) || value[field] < 0)) return false;
    if (value.fade > 1 || value.rainIntensity > 1 || value.afterglowDurationMs === 0) return false;
    if (this.mode === 'operator' && value.id === 'final-rain' && this.scene?.id !== 'final-rain') {
      // Preserve the outgoing forest before the new authoritative rain/map
      // snapshot can replace it. A mid-cue join starts from the same full,
      // dry takeover endpoint and evaluates the current score progress.
      this.finalRainForest = this.scene?.id === 'forest-takeover' ? { ...this._effectiveMacros() }
        : { ...automaticSoundMacros({ heat: 1, moisture: 0, surfaceWetness: 0 }), forest: 1 };
    } else if (!['final-rain', 'afterglow'].includes(value.id)) this.finalRainForest = null;
    if (this.mode === 'operator' && this.context &&
      (value.id === 'ended' && this.scene?.id !== 'ended' || value.paused === true && this.scene?.paused !== true)) this._clearToneReverb(true);
    this.scene = { ...value, paused: value.paused === true };
    if (this.scene.paused || !['participation', 'forest-takeover'].includes(this.scene.id)) this.pendingRainAreas = [];
    if (!this._blobSceneEligible()) this.pendingBlobs = [];
    this.sceneReceivedAt = this.context?.currentTime ?? 0;
    this._applySceneGain(); this._applyParameters(); this._updateVoices(); return true;
  }
  _sceneElapsed(at = this.context?.currentTime ?? 0) {
    if (!this.scene) return 0;
    const duration = this.scene.afterglowDurationMs ?? computeSceneScore(this.scene, 0).afterglowDurationMs;
    const elapsed = this.scene.elapsedMs ?? (1 - clamp(this.scene.fade, 1)) * duration;
    return elapsed + (this.scene.paused ? 0 : Math.max(0, at - this.sceneReceivedAt) * 1000);
  }
  _cricketRetreat() {
    const score = this._sceneScore();
    return cricketRetreatParameters(this.mode === 'phone' ? score?.phoneRetreatElapsedMs ?? 0 : 0, score?.phoneRetreatDurationMs ?? 60000);
  }
  _sceneScore() { return this.scene ? computeSceneScore(this.scene, this._sceneElapsed()) : null; }
  _sceneGain() {
    const score = this._sceneScore();
    return score ? this.mode === 'operator' ? score.mainGain : score.phoneGain : 1;
  }
  _fieldSceneGain() {
    if (this.scene?.id === 'ended') return 0;
    // Main insects bypass this bus so the PA can linger after the image and
    // rain are gone. Each non-cricket path fades here exactly once.
    return this.mode === 'operator' ? this._sceneScore()?.mainFieldGain ?? 1 : 1;
  }
  _outputGain() { return this.enabled && !this.muted && !this.hidden ? this.level * this._sceneGain() : 0; }
  _holdSceneMaster(now) {
    const envelope = this.sceneMasterEnvelope;
    if (envelope && typeof this.master.gain.cancelAndHoldAtTime !== 'function') {
      // Old Safari cannot place a new event inside an active value curve.
      // Cancel its start event, then restore the evaluated show-clock value.
      const score = computeSceneScore(envelope.scene, envelope.elapsed + (now - envelope.at) * 1000);
      this.master.gain.cancelScheduledValues(envelope.at);
      this.master.gain.setValueAtTime(envelope.level * (this.mode === 'operator' ? score.mainGain : score.phoneGain), now);
      automation.delete(this.master.gain);
    } else holdParameter(this.master.gain, now);
    this.sceneMasterEnvelope = null;
  }
  _holdSceneField(now) {
    const envelope = this.sceneFieldEnvelope;
    if (envelope && typeof this.fieldBus.gain.cancelAndHoldAtTime !== 'function') {
      const value = computeSceneScore(envelope.scene, envelope.elapsed + (now - envelope.at) * 1000).mainFieldGain;
      this.fieldBus.gain.cancelScheduledValues(envelope.at);
      this.fieldBus.gain.setValueAtTime(value, now); automation.delete(this.fieldBus.gain);
    } else holdParameter(this.fieldBus.gain, now);
    this.sceneFieldEnvelope = null;
  }
  _applySceneField(schedule) {
    if (this.sceneFieldSchedule === schedule) return;
    this.sceneFieldSchedule = schedule;
    const now = this.context.currentTime, value = this._fieldSceneGain();
    this._holdSceneField(now);
    if (this.mode === 'operator' && this.scene?.id === 'afterglow' && !this.scene.paused && value > 0) {
      const elapsed = this._sceneElapsed(now), duration = this._sceneScore().rainCricketOverlapDurationMs;
      const remaining = Math.max(0, duration - elapsed);
      if (remaining > 0) {
        const values = Float32Array.from({ length: 257 }, (_, i) => computeSceneScore(this.scene, elapsed + remaining * i / 256).mainFieldGain);
        const freshNow = this.context.currentTime, at = freshNow + .02, end = now + remaining / 1000;
        this.fieldBus.gain.setValueAtTime(value, freshNow);
        if (end > at) this.fieldBus.gain.setValueCurveAtTime(values, at, end - at);
        else this.fieldBus.gain.linearRampToValueAtTime(0, Math.max(end, freshNow + 1 / this.context.sampleRate));
        this.sceneFieldEnvelope = { scene: this.scene, elapsed: this._sceneElapsed(freshNow), at: freshNow };
        return;
      }
    }
    if (value === 0 || this.scene?.paused) this.fieldBus.gain.setValueAtTime(value, now);
    else target(this.fieldBus.gain, value, now, .08);
  }
  _applySceneGain() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime, value = this._outputGain();
    const schedule = JSON.stringify([this.scene, this.sceneReceivedAt, this.level, this.enabled, this.muted, this.hidden]);
    this._applySceneField(schedule);
    if (this.sceneGainSchedule === schedule) return;
    this.sceneGainSchedule = schedule;
    if (!this.scene) { if (this.sceneMasterEnvelope) this._holdSceneMaster(now); target(this.master.gain, value, now, .035); return; }
    const score = this._sceneScore();
    if (this.scene.id === 'afterglow' && !this.scene.paused && value > 0) {
      // Place the complete envelope on the audio clock once per authoritative
      // snapshot. A delayed UI/scheduler frame cannot leave the projection
      // audible after its exact blackout, or end the phone hold early.
      const elapsed = this._sceneElapsed(now);
      const duration = this.mode === 'operator' ? score.mainAudioDurationMs : score.afterglowDurationMs;
      const delay = this.mode === 'phone' ? Math.max(0, score.phoneRetreatStartMs - elapsed) : 0;
      const remaining = Math.max(0, duration - elapsed - delay);
      if (remaining > 0) {
        const endAt = now + (delay + remaining) / 1000;
        const envelope = Float32Array.from({ length: 257 }, (_, index) => {
          const future = computeSceneScore(this.scene, elapsed + delay + remaining * index / 256);
          return this.level * (this.mode === 'operator' ? future.mainGain : future.phoneGain);
        });
        // Preparing the curve can cross an audio render quantum. Read the
        // clock afterward and leave a short lead so the browser never clamps
        // its start forward while retaining the original show deadline.
        const freshNow = this.context.currentTime;
        const curveAt = Math.max(now + delay / 1000, freshNow + .02);
        this._holdSceneMaster(freshNow);
        this.master.gain.setValueAtTime(this._outputGain(), freshNow);
        if (endAt - curveAt > 1 / this.context.sampleRate) {
          this.master.gain.setValueCurveAtTime(envelope, curveAt, endAt - curveAt);
        } else {
          // A snapshot received in the last few milliseconds needs only the
          // short final ramp, rather than a curve starting beyond its end.
          this.master.gain.linearRampToValueAtTime(0, Math.max(endAt, freshNow + 1 / this.context.sampleRate));
        }
        // The curve's final zero holds indefinitely. An additional endpoint
        // event can fall inside the curve through floating-point rounding.
        this.sceneMasterEnvelope = { scene: this.scene, elapsed: this._sceneElapsed(freshNow), at: freshNow, level: this.level };
        return;
      }
    }
    this._holdSceneMaster(now);
    if (value === 0 || this.scene.paused) this.master.gain.setValueAtTime(value, now);
    else target(this.master.gain, value, now, .035);
  }
  setMuted(value) {
    this.muted = Boolean(value);
    if (this.muted) { this.pendingToneKey = null; this.touchedKey = null; this._clearParticipantActivity(); }
    if (!this.enabled || !this.context) { this._report(); return; }
    if (this.muted || this.hidden) this._pause(); else this._resume();
    this._report();
  }
  setHidden(value) {
    const hidden = Boolean(value);
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (hidden) { this.pendingToneKey = null; this.touchedKey = null; this._clearParticipantActivity(); }
    if (this.enabled && this.context) { if (hidden || this.muted) this._pause(); else this._resume(); }
    this._report();
  }
  _pause() {
    this.pendingRainAreas = [];
    this.pendingBlobs = []; this.mainBlob?.setActive(false);
    this.dragAsh?.configure({ active: false });
    this._stopScheduler(); clearTimeout(this.suspendTimer);
    this.phoneRain?.setActive(false); this.phoneWeather?.setActive(false); this.localBells?.setActive(false); this.mainQuench?.setActive(false); this.patchSoftTones?.configure({ enabled: false });
    this.sceneGainSchedule = null;
    this._clearToneReverb(true);
    if (!this.context) return;
    const context = this.context;
    this._holdSceneMaster(context.currentTime);
    target(this.master.gain, 0, context.currentTime, .025);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.destroyed && context === this.context && (!this.enabled || this.muted || this.hidden)) Promise.resolve(context.suspend()).then(() => this._report()).catch(() => this._report());
    }, 140);
  }
  _resume() {
    if (!this.context || this.destroyed) return;
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    // Like enable(), call resume synchronously if this is a mute-button gesture.
    const context = this.context;
    try {
      const resumed = context.resume();
      Promise.resolve(resumed).then(() => {
        if (context !== this.context || this.destroyed || !this.enabled || this.muted || this.hidden) return;
        this._applySceneGain();
        this._startSources(); this._ensureTouchedVoice(); this._startScheduler(); this._report();
      }).catch(() => this._report());
    } catch { this._report(); }
  }

  setMacro(name, value) {
    if (name === 'charcoal') name = 'forest';
    if (!(name in SOUND_MACRO_DEFAULTS)) return false;
    this.automationEnabled = false;
    this.macros[name] = clamp(value, this.macros[name]); this._applyParameters(); return true;
  }
  setMacros(values = {}) {
    this.automationEnabled = false;
    if (values.forest == null && values.charcoal != null) values = { ...values, forest: values.charcoal };
    for (const name of Object.keys(SOUND_MACRO_DEFAULTS)) if (name in values) this.macros[name] = clamp(values[name], this.macros[name]);
    this._applyParameters();
  }
  setAutomation(value) { this.automationEnabled = Boolean(value); this._applyParameters(); return this.automationEnabled; }
  _soundCondition() {
    const summary = this._progression(); let heat = 0, moisture = 0, surfaceWetness = 0;
    for (const patch of this.patches.values()) { heat += patch.extinguished ? 0 : patch.heat; moisture += patch.moisture; surfaceWetness += patch.surfaceWetness; }
    const count = this.patches.size;
    return { ...summary, heat: summary.heat ?? (count && count === summary.sourceCount ? heat / count : summary.sourceCount ? 1 - summary.fraction : 0),
      moisture: summary.moisture ?? (count ? moisture / count : 0), surfaceWetness: summary.surfaceWetness ?? (count ? surfaceWetness / count : 0) };
  }
  _effectiveMacros() {
    let macros = this.automationEnabled ? automaticSoundMacros(this._soundCondition()) : this.macros;
    if (this.automationEnabled && this.scene && ['arrival', 'instructions', 'participation'].includes(this.scene.id)) {
      // The opening is a composed haze/forest transition. An initially cold
      // map must not remove these layers before the audience can participate.
      macros = { ...macros, haze: 1, forest: 1, ash: 0, rain: 0, moisture: 0 };
    }
    if (this.mode === 'operator' && this.scene?.id === 'forest-takeover') {
      const progress = this._sceneScore().forestTakeoverProgress;
      const warm = automaticSoundMacros({ heat: 1, moisture: 0, surfaceWetness: 0 });
      macros = { ...macros };
      // Match the real ground restoration and retain that endpoint even when
      // a new packet's wet condition arrives just before its scene update.
      for (const id of ['haze', 'forest', 'ash', 'moisture']) macros[id] += (warm[id] - macros[id]) * progress;
    }
    if (this.mode === 'operator' && this.scene?.id === 'final-rain') {
      const progress = this._sceneScore().finalRainProgress;
      const from = this.finalRainForest ?? { ...macros, forest: 1, moisture: 0 };
      macros = { ...macros };
      for (const id of ['haze', 'forest', 'ash', 'moisture']) macros[id] = from[id] + (macros[id] - from[id]) * progress;
    }
    return Number.isFinite(this.scene?.rainIntensity) && ['final-rain', 'afterglow', 'ended'].includes(this.scene.id) ? { ...macros, rain: this.scene.id === 'ended' ? 0 : this.scene.rainIntensity } : macros;
  }

  /** Select only the requested alternative. Never starts or resumes audio. */
  setLayerSource(id, url) {
    const supported = this.mode === 'phone' ? ['crackle', 'crickets'] : [...AMBIANCE_IDS, 'roar', 'charcoal'];
    if (this.destroyed || !supported.includes(id) || typeof url !== 'string' || !url.trim() || url.length > 2048) return Promise.resolve(false);
    const selected = url.trim();
    if (this.manualSources.has(id) && this.urls[id] === selected && this.layers.get(id)?.buffer && this.layers.get(id)?.currentUrl === selected && !this.sourceRequests.has(id)) return Promise.resolve(true);
    this.manualSources.add(id); this._abortLayerRequests(id);
    this.urls[id] = selected; this._clearLayerErrors(id);
    // A superseded decode may finish, but it cannot replace this selection.
    if (!this.context || !this.enabled || (id === 'crickets' && !this._cricketsWanted())) return Promise.resolve(true);
    return this._requestLayer(id);
  }
  setForestSource(url) { return this.setLayerSource('forest', url); }

  /** Configure two generated character endpoints without activating audio. */
  setLayerVariations(id, entries) {
    if (this.destroyed || !AMBIANCE_IDS.includes(id) || (this.mode === 'phone' && id !== 'crickets') || !Array.isArray(entries) || entries.length !== 2) return Promise.resolve(false);
    const normalized = entries.map(entry => ({ url: typeof entry?.url === 'string' ? entry.url.trim() : '', at: clamp(entry?.at) })).sort((a, b) => a.at - b.at);
    if (normalized.some(entry => !entry.url || entry.url.length > 2048) || normalized[0].url === normalized[1].url || normalized[0].at >= normalized[1].at) return Promise.resolve(false);
    this.variations.set(id, normalized);
    if (id === 'crickets') this.cricketLayers = null;
    if (this.manualSources.has(id)) return Promise.resolve(true);
    this._abortLayerRequests(id); this._clearLayerErrors(id);
    if (!this.context || !this.enabled) return Promise.resolve(true);
    this._syncVariationSlots(this.layers.get(id)); this._applyParameters();
    return this._loadVariationLayer(id);
  }
  /** Several perspectives of a real insect chorus, mixed at constant energy. */
  setCricketLayers(entries) {
    if (this.destroyed || !Array.isArray(entries) || entries.length < 2 || entries.length > (this.mode === 'phone' ? 3 : 6)) return Promise.resolve(false);
    const normalized = entries.map((entry, index) => ({ id: entry?.id ?? `cricket-${index}`, url: typeof entry?.url === 'string' ? entry.url.trim() : '', depth: clamp(entry?.depth, index / (entries.length - 1)), at: index / (entries.length - 1) }));
    if (normalized.some(entry => !entry.url || entry.url.length > 2048) || new Set(normalized.map(entry => entry.url)).size !== normalized.length) return Promise.resolve(false);
    this.cricketLayers = normalized; this.variations.set('crickets', normalized);
    this.manualSources.delete('crickets'); this._abortLayerRequests('crickets'); this._clearLayerErrors('crickets');
    if (!this.context || !this.enabled) return Promise.resolve(true);
    this._syncVariationSlots(this.layers.get('crickets')); this._applyParameters();
    return this._loadVariationLayer('crickets');
  }
  /** Return a manually selected layer to its configured automatic character. */
  clearLayerSource(id) {
    if (this.destroyed || !this.variations.has(id)) return Promise.resolve(false);
    this.manualSources.delete(id); this._abortLayerRequests(id); this._clearLayerErrors(id);
    if (!this.context || !this.enabled) return Promise.resolve(true);
    this._syncVariationSlots(this.layers.get(id)); this._applyParameters();
    return this._loadVariationLayer(id);
  }
  _usesVariations(id) { return this.variations.has(id) && !this.manualSources.has(id); }
  _playingVariations(layer) { return this.variations.has(layer.id) && (this._usesVariations(layer.id) || !layer.buffer) && [...layer.variationSlots.values()].some(slot => slot.buffer); }
  _clearLayerErrors(id) {
    this.failedSamples.delete(id);
    for (const key of this.sourceErrors.keys()) if (key === id || key.startsWith(`${id}:`)) this.sourceErrors.delete(key);
  }
  _variationWeights(id) {
    const entries = this.variations.get(id);
    if (!entries) return [];
    let value = this._effectiveMacros()[id];
    if (id === 'crickets' && this.cricketLayers) return this.mode === 'phone'
      ? cricketPerspectiveWeights(this._phoneCrickets().approach, entries.length)
      : entries.map(() => 1 / Math.sqrt(entries.length));
    if (id === 'crickets') value = this._progression().fraction;
    if (id === 'moisture') value = audibleMoisture(value);
    return variationWeights(value, entries.map(entry => entry.at));
  }
  _abortLayerRequests(id) {
    for (const [key, request] of this.sourceRequests) if (request.id === id || key === id) {
      request.controller.abort(); this.sourceRequests.delete(key); this.pendingSamples.delete(key);
    }
  }

  /** Feed complete latest authoritative patches, not pointer-water estimates. */
  setPatches(patches = []) {
    const next = new Map(); let totalHeat = 0;
    for (const patch of patches) {
      if (!patch || patch.key == null || !Number.isFinite(Number(patch.heat))) continue;
      const key = String(patch.key), normalized = { key, heat: clamp(patch.heat), extinguished: patch.extinguished === true,
        surfaceWetness: clamp(patch.surfaceWetness), moisture: clamp(patch.moisture) };
      next.set(key, normalized); totalHeat += normalized.extinguished ? 0 : normalized.heat;
    }
    this.patches = next; this.aggregateHeat = next.size ? totalHeat / next.size : 0;
    if (!this.context) return;
    this._ensureTouchedVoice(); this._updateVoices(); this._applyParameters();
  }
  /** Count-only older senders remain valid; current senders include a macro stage. */
  setProgression(value) {
    if (value === undefined) this.progression = null;
    else {
      if (!value || !Number.isSafeInteger(value.sourceCount) || !Number.isSafeInteger(value.outCount) || value.sourceCount < 0 || value.outCount < 0 || value.outCount > value.sourceCount) return false;
      const hasStage = value.stage !== undefined || value.steps !== undefined;
      if (hasStage && (!Number.isSafeInteger(value.stage) || !Number.isSafeInteger(value.steps) || value.steps < 1 || value.steps > 16 || value.stage < 0 || value.stage > value.steps)) return false;
      if (hasStage && value.stage !== (value.sourceCount ? Math.floor(value.outCount * value.steps / value.sourceCount) : 0)) return false;
      for (const field of ['heat', 'moisture', 'surfaceWetness', 'activeFireFraction']) if (value[field] !== undefined && (!Number.isFinite(value[field]) || value[field] < 0 || value[field] > 1)) return false;
      this.progression = { ...fireProgression(value), ...(hasStage ? { stage: value.stage, steps: value.steps } : {}) };
      for (const field of ['heat', 'moisture', 'surfaceWetness', 'activeFireFraction']) if (value[field] !== undefined) this.progression[field] = value[field];
    }
    this._applyParameters(); return true;
  }
  setMacroCondition(value) {
    if (value === undefined) return this.setProgression(undefined);
    if (value && (value.stage !== undefined || value.steps !== undefined) && (!Number.isFinite(value.heat) || !Number.isFinite(value.moisture))) return false;
    return this.setProgression(value);
  }
  /** Complete authoritative source cells; actors may excite them but never own them. */
  setPatchVoices(values = []) {
    const switching = !this.patchVoiceMode, next = new Map();
    this.patchVoiceMode = true;
    if (Array.isArray(values)) for (const value of values) {
      if (!value || value.key == null || String(value.key).length > 200) continue;
      const key = String(value.key), id = `patch:${key}`, previous = this.patchVoices.get(id), pose = participantPosition(value.position);
      const midiPair = patchMidiPair({ key });
      next.set(id, { id, key, midi: midiPair[0], midiPair, position: previous?.position ?? [pose.x, pose.y],
        holding: value.holding === true, heat: clamp(value.heat, 1), moisture: clamp(value.moisture), surfaceWetness: clamp(value.surfaceWetness),
        extinguished: value.extinguished === true, sourceCount: 1, local: value.local === true,
        texture: patchResidueId(key), grainSequence: 0, grainsScheduled: 0, lastGrainAt: null });
    }
    const previousPatches = this.patchVoices;
    this.patchVoices = next;
    this._syncMainQuench();
    this._observePatchBlobs(previousPatches);
    for (const patch of next.values()) if (!this.rainAreaMode && patch.extinguished && previousPatches.get(patch.id)?.extinguished === false) {
      this.triggerPatchQuench({ key: patch.key });
    }
    this.backgroundPatches = [...next.values()].filter(patch => patch.extinguished).sort((a, b) => a.key.localeCompare(b.key));
    if (switching) { this.participantActivity.clear(); for (const voice of this.voices.values()) this._retireVoice(voice, .12); this.voices.clear(); }
    for (const id of this.participantActivity.keys()) if (!next.has(id)) this.participantActivity.delete(id);
    for (const grain of [...this.toneGrains]) if (grain.standalone && !next.get(grain.participantId)?.extinguished) this._fadeToneGrain(grain, .12);
    this._updateVoices();
    this._observeRainAreas();
  }
  /** Contacts and field are read-only geography; the simulation owns all out flags. */
  setRainAreaContacts(field, contacts = []) {
    if (this.mode !== 'operator' || this.destroyed || !field || typeof field.patchesAt !== 'function' || !Array.isArray(field.patches) || !Array.isArray(contacts)) return false;
    this.rainAreaMode = true; this.rainAreaField = field;
    if (this.patchSoftTones) this.patchSoftTones.areaMode = true;
    this.rainAreaContacts = contacts.filter(contact => contact && contact.holding === true && Array.isArray(contact.position) && contact.position.length === 2 && contact.position.every(Number.isFinite))
      .map(contact => ({ id: String(contact.id), holding: true, position: [...contact.position] }));
    this._syncDragAsh();
    return true;
  }
  _syncDragAsh() {
    if (!this.dragAsh) return;
    const active = this.context?.state === 'running' && this.enabled && !this.muted && !this.hidden &&
      (!this.scene || ['participation', 'forest-takeover'].includes(this.scene.id) && !this.scene.paused) && this._sceneGain() > 0;
    this.dragAsh.configure({ active, weight: this.mixer.dragAsh * (this._sceneScore()?.mix.mainChimes ?? 1), participantCount: this.audienceParticipationCount });
    if (!active) return;
    this.dragAsh.update({ contacts: this.rainAreaContacts.map(contact => ({ id: contact.id, holding: true,
      position: countryPoint(contact.position), geo: [...contact.position],
      extinguished: (this.rainAreaField?.patchesAt(contact.position) ?? []).some(patch => patch.extinguished &&
        (patch.longitude - contact.position[0]) ** 2 + (patch.latitude - contact.position[1]) ** 2 <= .85 ** 2 + 1e-12) })) });
  }
  _rainAreasAudible() {
    return this.enabled && !this.muted && !this.hidden && (!this.scene || ['participation', 'forest-takeover'].includes(this.scene.id) && !this.scene.paused);
  }
  _observeRainAreas() {
    if (!this.rainAreaMode || !this.rainAreaField) return;
    const eligible = !this.scene || ['participation', 'forest-takeover'].includes(this.scene.id) && !this.scene.paused;
    const events = this.rainAreaTracker.update(this.rainAreaField, eligible ? this.rainAreaContacts : [], this.rainAreaClock());
    if (!this._rainAreasAudible()) { this.pendingRainAreas = []; return; }
    this.pendingRainAreas.push(...events);
    if (this.pendingRainAreas.length > 32) this.pendingRainAreas.splice(32);
    this._drainRainAreas();
  }
  _drainRainAreas() {
    if (!this.context || !this._rainAreasAudible()) return;
    const wallNow = this.rainAreaClock(), now = this.context.currentTime;
    this.pendingRainAreas = this.pendingRainAreas.filter(event => event.expiresAt >= wallNow && event.memberKeys.every(key => this.patchVoices.get(`patch:${key}`)?.extinguished));
    if (!this.pendingRainAreas.length || now < this.lastRainAreaAt + .1 - 1e-9) return;
    const event = this.pendingRainAreas.shift(), patch = this.patchVoices.get(`patch:${event.key}`);
    if (!patch) return;
    this.lastRainAreaAt = now; this.rainAreaEvents++;
    this.patchSoftTones?.triggerAreaExtinction({ ...event, at: now, expiresAt: now + Math.max(0, event.expiresAt - wallNow) });
    this._playExtinctionEvent(patch, event);
  }
  /** One-shot phone out bells share the complete phone master. */
  setPhoneInteraction(value = null) {
    this.phoneInteraction = value && typeof value === 'object' ? { holding: value.holding === true,
      patchKey: value.patchKey == null ? null : String(value.patchKey), extinguished: value.extinguished === true, eligible: value.eligible !== false } : null;
    this._syncPhoneWeather(); return true;
  }
  /** Main-only quench recordings; configuration never asks a phone to fetch. */
  setMainQuenchSources(entries = []) {
    if (this.mode !== 'operator' || this.destroyed || !Array.isArray(entries) || entries.length > 4) return Promise.resolve(false);
    try { this.mainQuenchSources = normalizeQuenchSources(entries); } catch { return Promise.resolve(false); }
    return this.mainQuench ? this.mainQuench.setSources(this.mainQuenchSources) : Promise.resolve(true);
  }
  // Legacy callers are safe on phones, and existing Main integrations migrate.
  setPhoneQuenchSources(entries = []) { return this.setMainQuenchSources(entries); }
  /** Independent per-patch plops; the coupled bell/quench/material stays per area. */
  setMainBlobSources(entries = []) {
    if (this.mode !== 'operator' || this.destroyed || !Array.isArray(entries) || entries.length > 4) return Promise.resolve(false);
    try { this.mainBlobSources = normalizeQuenchSources(entries); } catch { return Promise.resolve(false); }
    return this.mainBlob ? this.mainBlob.setSources(this.mainBlobSources) : Promise.resolve(true);
  }
  _blobSceneEligible() {
    return !this.scene || !this.scene.paused && ['participation', 'forest-takeover', 'final-rain', 'afterglow'].includes(this.scene.id) && this._fieldSceneGain() > 0;
  }
  _syncMainBlob() {
    if (!this.mainBlob) return;
    const active = this.context?.state === 'running' && this.enabled && !this.muted && !this.hidden && this._blobSceneEligible() && this._sceneGain() > 0;
    this.mainBlob.configure({ active, weight: this.mixer.blob * (this._sceneScore()?.mix.mainOutDrone ?? 1),
      participantCount: this.audienceParticipationCount });
    if (!active) this.pendingBlobs = [];
  }
  _observePatchBlobs(previous) {
    if (this.mode !== 'operator') return;
    const edges = [...this.patchVoices.values()].filter(patch => patch.extinguished && previous.get(patch.id)?.extinguished === false);
    this.blobObserved += edges.length;
    // Observing authoritative edges even while silent prevents old out terrain,
    // reloads, repeated taps, or unmuting from creating delayed new strikes.
    if (!this.mainBlob?.active || !this.mainBlob.quenchBank.length) { this.blobDropped += edges.length; return; }
    const expiresAt = this.rainAreaClock() + 4;
    edges.sort((a, b) => patchHash(`${a.key}:blob`) - patchHash(`${b.key}:blob`));
    this.pendingBlobs.push(...edges.map(patch => ({ key: patch.key, expiresAt })));
    if (this.pendingBlobs.length > 64) { this.blobDropped += this.pendingBlobs.length - 64; this.pendingBlobs.length = 64; }
    this._drainPatchBlobs();
  }
  _drainPatchBlobs() {
    if (!this.mainBlob?.active || !this.context) return;
    const wallNow = this.rainAreaClock(), now = this.context.currentTime;
    const fresh = this.pendingBlobs.filter(event => event.expiresAt > wallNow && this.patchVoices.get(`patch:${event.key}`)?.extinguished);
    this.blobDropped += this.pendingBlobs.length - fresh.length; this.pendingBlobs = fresh;
    // Short recordings overlap naturally, but rapid mass extinction cannot
    // create hundreds of simultaneous sources or an unbounded delayed chorus.
    if (!fresh.length || now < this.lastBlobAt + .1 - 1e-9 || !this.mainBlob.quenchBank.length) return;
    const event = this.pendingBlobs.shift(), patch = this.patchVoices.get(`patch:${event.key}`);
    this.lastBlobAt = now;
    if (!this.mainBlob.trigger(patch)) this.blobDropped++;
  }
  _syncMainQuench() {
    this._syncDragAsh();
    this._syncMainBlob();
    if (!this.mainQuench) return;
    const score = this._sceneScore();
    const eligible = !this.scene || !this.scene.paused && ['participation', 'forest-takeover', 'final-rain'].includes(this.scene.id);
    this.mainQuench.configure({ active: this.enabled && !this.muted && !this.hidden && eligible && this._sceneGain() > 0,
      weight: this.mixer.quench * (score?.mix.mainOutDrone ?? 1),
      participantCount: Math.max(this.audienceParticipationCount, this.patchSoftTones?.normalizationCount ?? 0) });
  }
  /** Accepted fresh out-ground presses, with a stable event ID from feedback. */
  triggerPatchQuench({ key, eventId } = {}) {
    if (this.mode !== 'operator' || this.destroyed || key == null || this.rainAreaMode) return false;
    if (eventId != null) {
      const id = String(eventId); if (this.quenchEventIds.has(id)) return false;
      this.quenchEventIds.add(id);
      while (this.quenchEventIds.size > 512) this.quenchEventIds.delete(this.quenchEventIds.values().next().value);
    }
    const patch = this.patchVoices.get(`patch:${String(key)}`);
    if (!patch?.extinguished) return false;
    return this._playExtinctionEvent(patch);
  }
  _playExtinctionEvent(patch, area = null) {
    this._syncMainQuench(); this._syncLocalBells();
    if (!this.localBells?.active) return false;
    const now = this.context.currentTime;
    if (now - this.mainEventBurstAt >= .08) { this.mainEventBurstAt = now; this.mainEventBurstCount = 0; }
    if (this.mainEventBurstCount++ >= 8) return false;
    this.bellFeedbackPatch = { key: patch.key, position: area?.brushPosition ?? patch.position };
    let rang;
    try { rang = this.localBells.ring(patch); } finally { this.bellFeedbackPatch = null; }
    this.mainQuench?.trigger(patch); this._syncLocalBells();
    return rang;
  }
  // Main owns extinction bells; this legacy switch no longer creates phone audio.
  setLocalBellAudition(value) { this.localBellAudition = Boolean(value); }
  _makeBellController() {
    return new PhoneWeatherAudio({ context: this.context, destination: this.mainBellBus,
      makeSpatialPath: destination => this._makeSpatialPath(destination),
      positionPath: (space, position) => this._positionQuenchPath(space, position),
      onBell: voice => {
        const patch = this.bellFeedbackPatch;
        const event = { ...voice, eventId: `bell-${this.bellFeedbackSession}-${++this.bellFeedbackSerial}`, key: patch?.key ?? voice.patchKey,
          position: [...(patch?.position ?? this.patchVoices.get(`patch:${voice.patchKey}`)?.position ?? [.5, .5])], radiusDegrees: .85,
          origin: 'main', wallAt: Date.now() + Math.max(0, voice.at - this.context.currentTime) * 1000 };
        this.lastBellEvent = event;
        try { this.onBell(event); } catch {}
        const target = this.document?.defaultView;
        if (target?.dispatchEvent && target.CustomEvent) target.dispatchEvent(new target.CustomEvent('wildfire-bell', { detail: event }));
      } });
  }
  setLocalInteraction(value = null) {
    if (this.mode !== 'operator' || this.destroyed) return false;
    const previous = this.localInteraction;
    this.localInteraction = value && typeof value === 'object' ? { holding: value.holding === true,
      patchKey: value.patchKey == null ? null : String(value.patchKey), extinguished: value.extinguished === true, eligible: value.eligible !== false } : null;
    const next = this.localInteraction;
    if (!this.rainAreaMode && next?.holding && !previous?.holding && next.extinguished && next.eligible) {
      this.triggerPatchQuench({ key: next.patchKey, eventId: `local:${++this.localQuenchSerial}` });
    }
    return true;
  }
  _syncLocalBells() {
    if (!this.localBells || !this.context) return;
    const score = this._sceneScore();
    const eligible = !this.scene || !this.scene.paused && ['participation', 'forest-takeover', 'final-rain'].includes(this.scene.id);
    const active = this.enabled && !this.muted && !this.hidden && eligible && this._sceneGain() > 0;
    this.localBells.setActive(active);
    const count = Math.max(1, this.localBells.bells.size);
    target(this.mainBellBus.gain, active ? this.mixer.bells * (score?.mix.mainOutDrone ?? 1) / Math.sqrt(count) : 0, this.context.currentTime, active ? .08 : .015);
  }
  setPhoneRainSource(url) {
    if (this.mode !== 'phone' || this.destroyed || typeof url !== 'string' || !url.trim() || url.length > 2048) return Promise.resolve(false);
    this.phoneRainSource = url;
    return this.phoneRain ? this.phoneRain.setSource(url) : Promise.resolve(true);
  }
  _syncPhoneWeather() {
    if (!this.phoneRain) return;
    const eligible = !this.scene || !this.scene.paused && ['participation', 'forest-takeover', 'final-rain'].includes(this.scene.id);
    this.phoneRain.setActive(this.enabled && !this.muted && !this.hidden && eligible && this._sceneGain() > 0);
    this.phoneRain.update({ ...(this.phoneInteraction ?? { holding: false }), eligible: eligible && this.phoneInteraction?.eligible !== false });
  }
  _patchTextureCandidates(id) {
    const layer = this.layers.get(id); if (!layer) return [];
    const extra = (this.residueSources.get(id) ?? []).map(entry => ({ url: entry.url, buffer: entry.buffer }));
    if (!this._usesVariations(id) && layer.buffer) return [...new Map([...extra, { url: layer.currentUrl ?? this.urls[id] ?? id, buffer: layer.buffer }].map(entry => [entry.url, entry])).values()];
    const wanted = new Set((this.variations.get(id) ?? []).map(entry => entry.url));
    return [...new Map([...extra, ...[...layer.variationSlots.values()].filter(slot => !wanted.size || wanted.has(slot.currentUrl)).map(slot => ({ url: slot.currentUrl, buffer: slot.buffer }))].map(entry => [entry.url, entry])).values()];
  }
  setResidueSources(sources = {}) {
    if (this.mode !== 'operator' || this.destroyed) return Promise.resolve(false);
    const signature = JSON.stringify(sources);
    if (this.residueSignature === signature) return this._loadResidueSources();
    const next = new Map();
    for (const id of ['ash', 'moisture', 'haze']) {
      const entries = sources[id] ?? [];
      if (!Array.isArray(entries) || entries.length > 6 || entries.some(entry => typeof entry?.url !== 'string' || entry.url.length > 2048 || !entry.url.trim())) return Promise.resolve(false);
      next.set(id, entries.map(entry => ({ ...entry, buffer: this.residueSources.get(id)?.find(old => old.url === entry.url)?.buffer ?? this.bufferCache.get(entry.url)?.buffer ?? null })));
    }
    for (const request of this.residueRequests.values()) request.controller.abort();
    this.residueRequests.clear(); this.residueSignature = signature; this.residueSources = next;
    return this._loadResidueSources();
  }
  _loadResidueSources() {
    if (this.mode !== 'operator' || !this.enabled || !this.context || this.destroyed) return Promise.resolve(true);
    const generation = this.generation, context = this.context, pending = [];
    for (const [id, entries] of this.residueSources) for (const entry of entries) {
      if (entry.buffer) continue;
      if ((this.variations.get(id) ?? []).some(endpoint => endpoint.url === entry.url)) continue;
      if (entry.failedGeneration === generation) continue;
      const key = `residue:${id}:${entry.url}`;
      if (this.residueRequests.has(key)) { pending.push(this.residueRequests.get(key).promise); continue; }
      const controller = new AbortController(), request = { controller };
      const current = () => !this.destroyed && this.enabled && this.generation === generation && this.context === context && !controller.signal.aborted && this.residueRequests.get(key) === request && this.residueSources.get(id)?.includes(entry);
      this.residueRequests.set(key, request);
      const timer = setTimeout(() => controller.abort(), 12000);
      request.promise = Promise.resolve().then(() => {
        if (!current()) return null;
        const cached = this.bufferCache.get(entry.url)?.buffer;
        if (cached) return cached;
        return this.fetchImpl(entry.url, { signal: controller.signal, cache: 'force-cache' }).then(async response => {
          if (!response.ok || !current()) return null;
          const bytes = await response.arrayBuffer();
          if (!current() || bytes.byteLength > 4000000) return null;
          const buffer = await context.decodeAudioData(bytes);
          return current() ? this._prepareBuffer(buffer, id) : null;
        });
      }).then(buffer => {
        if (!buffer || !current()) return false;
        entry.buffer = buffer; this._cacheBuffer(entry.url, buffer); return true;
      }).then(success => { if (!success) entry.failedGeneration = generation; return success; }).catch(() => { entry.failedGeneration = generation; return false; }).finally(() => { clearTimeout(timer); if (this.residueRequests.get(key) === request) this.residueRequests.delete(key); });
      pending.push(request.promise);
    }
    return Promise.all(pending).then(results => results.every(Boolean));
  }
  _syncPatchSoftTones() {
    if (!this.patchSoftTones || !this.patchVoiceMode) return;
    const score = this._sceneScore();
    this.patchSoftTones.configure({ enabled: this.enabled && !this.muted && !this.hidden && this._sceneGain() > 0,
      allowReleasedCooling: !this.scene || ['participation', 'forest-takeover'].includes(this.scene.id),
      globalHeat: this._soundCondition().heat,
      // The takeover removes clear pitch but retains a hazy cooling response.
      // Finale tails keep their outgoing character; returning to cue 3 clears
      // the haze through the same smooth voice controls.
      hazeOnlyBlend: this.scene?.id === 'forest-takeover' ? score.forestTakeoverProgress
        : ['final-rain', 'afterglow'].includes(this.scene?.id) ? this.patchSoftTones.hazeOnlyBlend : 0,
      toneWeight: score?.mix.mainChimes ?? 1, textureWeight: score?.mix.mainOutDrone ?? 1, mixer: this.mixer,
      morphSeconds: this.scene?.settings?.residueMorphSeconds, fadeSeconds: this.scene?.settings?.residueFadeSeconds,
      participantCount: this.audienceParticipationCount });
    this.patchSoftTones.setPatches(this.patchVoices.values());
    if (this.patchSoftTones.enabled) target(this.toneReverbReturn.gain, TONE_REVERB_RETURN, this.context.currentTime, .45);
    this._syncMainQuench();
  }
  setAudienceParticipationCount(value = 0) {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(4096, Math.floor(value))) : 0;
    if (next === this.audienceParticipationCount) return;
    this.audienceParticipationCount = next;
    this._syncPatchSoftTones(); this._syncMainQuench();
  }
  _normalizeParticipant(value, local = false) {
    if (!value || value.id == null || String(value.id).length > 200) return null;
    const id = String(value.id), pose = participantPosition(value.position);
    const explicit = local && this.localPitchIndex != null ? this.localPitchIndex : Number.isSafeInteger(value.pitchIndex) ? value.pitchIndex : null;
    // The actor's persistent client ID survives release and reconnect. Its
    // display number and arrival order never determine its random scale pair.
    const assigned = this.participantAssignments.get(id) ?? participantMidi({ id });
    this.participantAssignments.set(id, assigned);
    const midi = explicit == null ? assigned : participantMidi({ pitchIndex: explicit });
    if (local) this.localAutoPitchIndex = PARTICIPANT_MIDI.indexOf(assigned);
    return { id, number: value.number, midi, holding: value.holding === true, position: [pose.x, pose.y],
      heat: clamp(value.heat ?? value.fireIntensity, 1), moisture: clamp(value.moisture), surfaceWetness: clamp(value.surfaceWetness), extinguished: value.extinguished === true, local };
  }
  setParticipants(values = []) {
    const next = new Map();
    if (Array.isArray(values)) for (const value of values.slice(0, 256)) {
      const participant = this._normalizeParticipant(value);
      if (participant) next.set(participant.id, participant);
    }
    if (!this.patchVoiceMode) for (const id of this.participantActivity.keys()) if (!next.has(id) && id !== this.localParticipant?.id) this.participantActivity.delete(id);
    this.participants = next; this._updateVoices();
  }
  setLocalParticipant(value) {
    if (this.localParticipant && (value == null || String(value.id) !== this.localParticipant.id)) this.participantActivity.delete(this.localParticipant.id);
    this.localParticipant = value == null ? null : this._normalizeParticipant(value, true);
    this._updateVoices();
  }
  setLocalPitchIndex(value = null) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value >= PARTICIPANT_MIDI.length)) return false;
    this.localPitchIndex = value; this.localAutoPitchIndex = null;
    if (this.localParticipant) this.localParticipant = this._normalizeParticipant(this.localParticipant, true);
    this._updateVoices(); return true;
  }
  _clearParticipantActivity() {
    this.participantActivity.clear();
    // A paused page must not revive a completed tap on return. Current held
    // identities can resume; already released notes and tails are discarded.
    const current = this.patchVoiceMode ? this.patchVoices : new Map([...this.participants, ...(this.localParticipant ? [[this.localParticipant.id, this.localParticipant]] : [])]);
    for (const voice of [...this.voices.values()]) {
      const participant = current.get(voice.key);
      if (!participant || !participant.holding && !participant.extinguished) { this._disposeVoice(voice); this.voices.delete(voice.key); }
    }
    for (const voice of [...this.tails]) this._disposeVoice(voice);
  }
  _desiredParticipants() {
    const now = this.context?.currentTime ?? 0;
    return (this.patchVoiceMode ? [...this.patchVoices.values()].filter(patch => !patch.extinguished) : [...this.participants.values(), ...(this.localParticipant ? [this.localParticipant] : [])])
      .filter(participant => participant.holding || participant.extinguished || now < (this.participantActivity.get(participant.id) ?? -Infinity))
      .filter(participant => this._participantSceneWeight(participant) > 0)
      .sort((a, b) => Number(b.local) - Number(a.local) || Number(b.holding) - Number(a.holding) || (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  }
  _participantSceneWeight(participant) {
    if (this.patchVoiceMode && this._sceneGain() <= 0) return 0;
    const score = this._sceneScore();
    return score ? clamp(participant.extinguished ? score.mix.mainOutDrone : score.mix.mainChimes) : 1;
  }
  _progression() {
    if (this.progression) return this.progression;
    let outCount = 0; for (const patch of this.patches.values()) if (patch.extinguished) outCount++;
    return fireProgression({ sourceCount: this.patches.size, outCount });
  }
  _phoneBed() {
    const bed = phoneBedParameters(this.patches.values(), this.touchedKey ?? this.lastVisitedKey, { touching: this.touchedKey != null, progression: this._progression() });
    if (['final-rain', 'afterglow'].includes(this.scene?.id)) {
      const progress = this._sceneScore()?.finalRainProgress ?? 0;
      const currentFire = landscapeBlend(this._progression()).fireWeight;
      // Actual cooling is continuous even though confirmed out flags arrive
      // together at the end. Do not step the phone bed at that boundary.
      bed.gain *= currentFire > 0 ? Math.sqrt(1 - progress) / currentFire : 0;
      bed.cricketWeight = this._phoneCrickets().weight; bed.cricketGain = .04 * bed.cricketWeight;
    }
    return bed;
  }
  // Retained for older phone clients; these only adjust the field bed.
  touch(key) {
    this.touchedKey = key == null ? null : String(key);
    if (this.touchedKey && this.patches.has(this.touchedKey)) this.lastVisitedKey = this.touchedKey;
    this._applyParameters();
  }
  release() { this.touchedKey = null; this.pendingToneKey = null; this._applyParameters(); }

  reset(epoch) {
    if (epoch !== undefined && epoch === this.epoch) return;
    this.rainAreaTracker.reset(); this.pendingRainAreas = []; this.rainAreaContacts = []; this.lastRainAreaAt = -Infinity; this.rainAreaEvents = 0;
    this.epoch = epoch ?? null; this.touchedKey = null; this.lastVisitedKey = null; this.pendingToneKey = null; this.patches.clear(); this.patchVoices.clear(); this.backgroundPatches = []; this.patchBackgroundCursor = 0; this.nextPatchBackgroundGrain = 0; this.participants.clear(); this.participantActivity.clear(); this.localParticipant = null; this.localAutoPitchIndex = null; this.aggregateHeat = 0; this.progression = null;
    this.pendingBlobs = []; this.lastBlobAt = -Infinity; this.blobObserved = 0; this.blobDropped = 0; this.mainBlob?.reset();
    this.dragAsh?.reset();
    for (const voice of [...this.voices.values()]) this._retireVoice(voice, .22);
    this.voices.clear();
    this._fadeToneGrains(.22); this.toneGrainBuffers.clear(); this.nextToneGrain = 0;
    this._clearToneReverb(true);
    this.mainEventBurstAt = -Infinity; this.mainEventBurstCount = 0; this.mainQuench?.reset(); this.quenchEventIds.clear(); this.localQuenchSerial = 0; this.patchSoftTones?.reset(); this.phoneRain?.reset(); this.phoneWeather?.reset(); this.localBells?.reset(); this.phoneInteraction = null; this.localInteraction = null; this.finalRainForest = null; this.audienceParticipationCount = 0; this.lastBellEvent = null;
    this._applyParameters();
  }
  disable() {
    this.participantActivity.clear();
    this.enabled = false; this.generation++;
    this.pendingBlobs = []; this.mainBlob?.setActive(false); this.mainBlob?.stop();
    this.dragAsh?.stop();
    this.phoneRain?.setActive(false); this.phoneWeather?.setActive(false); this.phoneRain?.stop(); this.phoneWeather?.stop(); this.localBells?.setActive(false); this.localBells?.stop(); this.mainQuench?.setActive(false); this.mainQuench?.stop(); this.patchSoftTones?.stop();
    this.pendingToneKey = null; this.touchedKey = null;
    this.fetchController?.abort(); this.fetchController = null; this.pendingSamples.clear();
    for (const request of this.residueRequests.values()) request.controller.abort();
    this.residueRequests.clear();
    for (const request of this.sourceRequests.values()) request.controller.abort();
    this.sourceRequests.clear();
    this._stopScheduler(); this._stopSources(); this._pause(); this._report();
    // Releasing decoded recordings matters on phones; the browser HTTP cache
    // still makes a later explicit enable inexpensive.
    this.bufferCache.clear(); this.loadedSamples.clear();
    for (const layer of this.layers.values()) { layer.buffer = null; for (const slot of layer.variationSlots.values()) slot.buffer = null; }
  }
  destroy() {
    if (this.destroyed) return;
    this.disable(); this.destroyed = true;
    this.mainBlob?.destroy();
    this.dragAsh?.destroy();
    this.phoneRain?.destroy(); this.phoneWeather?.destroy(); this.localBells?.destroy(); this.mainQuench?.destroy(); this.patchSoftTones?.stop();
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    this.document?.removeEventListener?.('visibilitychange', this._visibilityListener);
    for (const voice of this.tails) this._disposeVoice(voice);
    this.tails.clear();
    const context = this.context;
    if (context) { context.onstatechange = null; try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closed. */ } }
    this.context = null; this._status('off', 'Sound is off.');
  }

  _buildGraph() {
    this.sceneFieldSchedule = null; this.sceneFieldEnvelope = null; this.sceneGainSchedule = null; this.sceneMasterEnvelope = null;
    this.sceneCricketSchedule = null; this.sceneCricketEnvelope = null;
    this.mainBlob?.destroy(); this.mainBlob = null; this.pendingBlobs = [];
    this.dragAsh?.destroy(); this.dragAsh = null; this.mainDroneWave = null;
    this.phoneRain?.destroy(); this.phoneRain = null; this.localBells?.destroy(); this.localBells = null; this.mainQuench?.destroy(); this.mainQuench = null;
    const c = this.context;
    this.mix = c.createGain(); this.mix.gain.value = .8;
    // Each role's master follows its complete score envelope. Every main
    // return, including insects and reverb, reaches that common master.
    this.fieldBus = c.createGain(); this.fieldBus.gain.value = 1; this.fieldBus.connect(this.mix);
    if (this.mode === 'operator') {
      for (const name of [...AMBIANCE_IDS, 'lowDrone']) {
        const node = c.createGain(); node.gain.value = this.mixer[name];
        node.connect(name === 'crickets' ? this.mix : this.fieldBus); this.mixerNodes.set(name, node);
      }
    }
    this.master = c.createGain(); this.master.gain.value = 0;
    const dynamics = outputDynamics(this.mode);
    this.outputMakeup = c.createGain(); this.outputMakeup.gain.value = dynamics.makeupGain;
    this.compressor = c.createDynamicsCompressor();
    // Main's quieter drive and gentler attack preserve dense-mix transients.
    // Both roles keep a high-threshold safety stage above the ordinary field.
    for (const name of ['threshold', 'knee', 'ratio', 'attack', 'release']) this.compressor[name].value = dynamics[name];
    // Native compression can overshoot on a sudden crowd. A smooth sample
    // ceiling catches that first peak; the quiet field stays strictly linear.
    this.outputHeadroom = c.createGain(); this.outputHeadroom.gain.value = 1 / OUTPUT_LIMIT_INPUT_RANGE;
    this.outputSafety = c.createWaveShaper(); this.outputSafety.curve = outputProtectionCurve(this.mode); this.outputSafety.oversample = 'none';
    this.highpass = c.createBiquadFilter(); this.highpass.type = 'highpass'; this.highpass.frequency.value = 28;
    this.mix.connect(this.highpass); this.highpass.connect(this.master); this.master.connect(this.outputMakeup);
    this.outputMakeup.connect(this.compressor); this.compressor.connect(this.outputHeadroom); this.outputHeadroom.connect(this.outputSafety); this.outputSafety.connect(c.destination);
    if (this.mode === 'operator') {
      this.toneBus = c.createGain(); this.toneBus.gain.value = .8; this.toneBus.connect(this.fieldBus);
      // Only the tone layer enters this space. Fire and other field recordings
      // keep their direct path to mix, with no reverb send.
      this.toneGrainBus = c.createGain(); this.toneGrainBus.gain.value = 1;
      this.toneGrainDirect = c.createGain(); this.toneGrainDirect.gain.value = .95;
      this.toneGrainReverbSend = c.createGain(); this.toneGrainReverbSend.gain.value = .07;
      this.toneReverbSend = c.createGain(); this.toneReverbSend.gain.value = .15;
      this.toneReverbFilter = c.createBiquadFilter(); this.toneReverbFilter.type = 'lowpass'; this.toneReverbFilter.frequency.value = 4600; this.toneReverbFilter.Q.value = .35;
      this.toneReverb = c.createConvolver(); this.toneReverb.normalize = false; this.toneReverb.buffer = this._makeToneImpulse();
      this.toneReverbReturn = c.createGain(); this.toneReverbReturn.gain.value = TONE_REVERB_RETURN;
      this.toneGrainBus.connect(this.toneGrainDirect); this.toneGrainDirect.connect(this.fieldBus);
      this.toneGrainBus.connect(this.toneGrainReverbSend); this.toneGrainReverbSend.connect(this.toneReverbFilter);
      this.toneBus.connect(this.toneReverbSend); this.toneReverbSend.connect(this.toneReverbFilter);
      this.toneReverbFilter.connect(this.toneReverb); this.toneReverb.connect(this.toneReverbReturn); this.toneReverbReturn.connect(this.fieldBus);
    }
    if (this.mode === 'operator') {
      this.delaySend = c.createGain(); this.delay = c.createDelay(1.1); this.damping = c.createBiquadFilter(); this.damping.type = 'lowpass';
      this.feedback = c.createGain(); this.delayReturn = c.createGain(); this.delayReturn.gain.value = .2;
      this.toneBus.connect(this.delaySend); this.delaySend.connect(this.delay); this.delay.connect(this.damping);
      this.damping.connect(this.feedback); this.feedback.connect(this.delay); this.damping.connect(this.delayReturn); this.delayReturn.connect(this.fieldBus);
    }
    this.noiseBuffer = this._makeNoiseBuffer(4);
    this.impulseBuffer = this._makeNoiseBuffer(.22);
    const definitions = this.mode === 'phone' ? [{ id: 'crackle', highpass: 100, lowpass: 5500 }] : [
      { id: 'forest', highpass: 85, lowpass: 10000 }, { id: 'roar', highpass: 35, lowpass: 7000 }, { id: 'charcoal', highpass: 170, lowpass: 3500 }, { id: 'rain', highpass: 160, lowpass: 8500 },
      { id: 'haze', highpass: 220, lowpass: 9000 }, { id: 'ash', highpass: 400, lowpass: 10500 }, { id: 'moisture', highpass: 110, lowpass: 7000 },
    ];
    definitions.push({ id: 'crickets', highpass: 600, lowpass: 7000 });
    for (const definition of definitions) {
      const highpass = c.createBiquadFilter(); highpass.type = 'highpass'; highpass.frequency.value = definition.highpass;
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = definition.lowpass;
      const shaper = c.createWaveShaper(); shaper.curve = null; shaper.oversample = 'none';
      const gain = c.createGain(); gain.gain.value = 0;
      const sampleGate = c.createGain(); sampleGate.gain.value = 1; sampleGate.connect(highpass);
      const presence = this.mode === 'phone' && definition.id === 'crackle' ? c.createBiquadFilter() : null;
      if (presence) { presence.type = 'peaking'; presence.frequency.value = 750; presence.Q.value = .65; presence.gain.value = 2.8; }
      const distantBody = this.mode === 'operator' && definition.id === 'forest' ? c.createBiquadFilter() : null;
      const distantAir = distantBody ? c.createBiquadFilter() : null;
      if (distantBody) { distantBody.type = 'lowshelf'; distantBody.frequency.value = 240; distantBody.gain.value = 5; distantAir.type = 'highshelf'; distantAir.frequency.value = 1800; distantAir.gain.value = -9; }
      highpass.connect(filter);
      if (distantBody) { filter.connect(distantBody); distantBody.connect(distantAir); distantAir.connect(shaper); }
      else { filter.connect(presence ?? shaper); if (presence) presence.connect(shaper); }
      shaper.connect(gain);
      const mixerId = ['roar', 'charcoal'].includes(definition.id) ? 'forest' : definition.id;
      gain.connect(this.mode === 'operator' ? this.mixerNodes.get(mixerId) : definition.id === 'crickets' ? this.mix : this.fieldBus);
      filter.Q.value = .35; highpass.Q.value = .35;
      this.layers.set(definition.id, { ...definition, highpass, filter, presence, distantBody, distantAir, shaper, gain, sampleGate, sources: new Set(), variationSlots: new Map(), fallbackSource: null, fallbackGain: null, buffer: null, currentUrl: null, nextAt: 0, sequence: 0 });
      this._syncVariationSlots(this.layers.get(definition.id));
    }
    if (this.mode === 'operator') {
      this.ashFilter = c.createBiquadFilter(); this.ashFilter.type = 'highpass';
      this.ashGain = c.createGain(); this.ashGain.gain.value = 0;
      this.ashFilter.connect(this.ashGain); this.ashGain.connect(this.mixerNodes.get('ash'));
      this.turbulenceFilter = c.createBiquadFilter(); this.turbulenceFilter.type = 'lowpass'; this.turbulenceFilter.Q.value = .35;
      this.turbulenceGain = c.createGain(); this.turbulenceGain.gain.value = 0;
      this.turbulenceFilter.connect(this.turbulenceGain); this.turbulenceGain.connect(this.mixerNodes.get('forest'));
      this.textureDryBus = c.createGain(); this.textureDryBus.gain.value = .8; this.textureDryBus.connect(this.fieldBus);
      this.dragAsh = new DragAshAudio({ context: c, destination: this.textureDryBus,
        getCandidates: () => this._patchTextureCandidates('ash'), makeSpatialPath: destination => this._makeSpatialPath(destination),
        positionPath: (space, position) => this._positionQuenchPath(space, position) });
      this.patchSoftTones = new PatchSoftToneAudio({ context: c, destination: this.toneBus, textureDestination: this.textureDryBus, textureReverbDestination: this.toneReverbFilter, areaMode: this.rainAreaMode,
        maxVoices: this.maxVoices, makeSpatialPath: destination => this._makeSpatialPath(destination),
        prepareLoop: buffer => circularLoopBuffer(c, buffer), getTextureCandidates: id => this._patchTextureCandidates(id) });
      this.mainQuench = new MainQuenchAudio({ context: c, destination: this.toneBus, fetchImpl: this.fetchImpl,
        makeSpatialPath: destination => this._makeSpatialPath(destination), positionPath: (space, position) => this._positionQuenchPath(space, position) });
      this.mainQuench.setSources(this.mainQuenchSources);
      this.mainBlob = new MainQuenchAudio({ context: c, destination: this.toneBus, fetchImpl: this.fetchImpl, avoidImmediateRepeat: true,
        makeSpatialPath: destination => this._makeSpatialPath(destination), positionPath: (space, position) => this._positionQuenchPath(space, position) });
      this.mainBlob.setSources(this.mainBlobSources);
      // Existing out cells establish a quiet baseline on first enable.
      this.patchSoftTones.setPatches(this.patchVoices.values());
      this.mainBellBus = c.createGain(); this.mainBellBus.gain.value = 1; this.mainBellBus.connect(this.fieldBus);
      this.localBells = this._makeBellController();
    } else {
      this.phoneRain = new PhoneTapRainAudio({ context: c, destination: this.fieldBus, fetchImpl: this.fetchImpl, prepareLoop: buffer => circularLoopBuffer(c, buffer) });
      if (this.phoneRainSource) this.phoneRain.setSource(this.phoneRainSource);
    }
  }
  _makeNoiseBuffer(seconds) {
    const c = this.context, buffer = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate), data = buffer.getChannelData(0);
    let seed = 130507, low = 0;
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1; low = .97 * low + .03 * white;
      // The short circular crossfade below removes a hard boundary in fallback.
      data[index] = .4 * white + 1.9 * low;
    }
    const blend = Math.min(512, Math.floor(data.length / 8));
    for (let index = 0; index < blend; index++) {
      const mix = index / blend, first = data[index], last = data[data.length - blend + index];
      data[index] = last * (1 - mix) + first * mix;
    }
    data[0] = data[data.length - 1];
    return buffer;
  }
  _makeToneImpulse() {
    const c = this.context, duration = 3.8, buffer = c.createBuffer(2, Math.ceil(c.sampleRate * duration), c.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel); let seed = 31771 + channel * 9937, low = 0, power = 0;
      for (let index = 0; index < data.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        low = .62 * low + .38 * (seed / 2147483648 - 1);
        const time = index / c.sampleRate, onset = smoothstep(.035, .11, time);
        data[index] = low * onset * Math.exp(-time / .82) * (1 - smoothstep(3.4, duration, time));
        power += data[index] ** 2;
      }
      const scale = .9 / Math.sqrt(power || 1);
      for (let index = 0; index < data.length; index++) data[index] *= scale;
    }
    return buffer;
  }
  _disposeToneSpace(space) {
    clearTimeout(space.timer); disconnect(space.convolver); disconnect(space.gain); this.retiredToneSpaces.delete(space);
  }
  _clearToneReverb(immediate = false) {
    if (!this.toneReverb || !this.context) return;
    while (this.retiredToneSpaces.size >= 2) this._disposeToneSpace(this.retiredToneSpaces.values().next().value);
    const old = { convolver: this.toneReverb, gain: this.toneReverbReturn };
    if (immediate) {
      // Suspension freezes AudioContext time. Disconnect its old convolution
      // history now so an immediate resume cannot uncover a completed shot.
      old.gain.gain.cancelScheduledValues(this.context.currentTime); old.gain.gain.setValueAtTime(0, this.context.currentTime);
      this._disposeToneSpace(old);
      for (const space of [...this.retiredToneSpaces]) this._disposeToneSpace(space);
    } else {
      target(old.gain.gain, 0, this.context.currentTime, .035);
      this.retiredToneSpaces.add(old); old.timer = setTimeout(() => this._disposeToneSpace(old), 300);
    }
    disconnect(this.toneReverbFilter);
    this.toneReverb = this.context.createConvolver(); this.toneReverb.normalize = false; this.toneReverb.buffer = old.convolver.buffer;
    this.toneReverbReturn = this.context.createGain(); this.toneReverbReturn.gain.value = 0;
    this.toneReverbFilter.connect(this.toneReverb); this.toneReverb.connect(this.toneReverbReturn); this.toneReverbReturn.connect(this.fieldBus);
  }
  _startSources() {
    if (!this.context || !this.enabled || this.destroyed) return;
    const now = this.context.currentTime;
    for (const layer of this.layers.values()) {
      if (layer.id === 'crickets') continue; // A real recording, never fake chirps.
      if (!this.urls[layer.id] && !this.variations.has(layer.id)) continue;
      if (this.variations.has('forest') && ['roar', 'charcoal'].includes(layer.id)) continue;
      if (!layer.fallbackSource && !this._hasRecording(layer)) {
        const source = this.context.createBufferSource(), gain = this.context.createGain();
        source.buffer = this.noiseBuffer; source.loop = true;
        source.playbackRate.value = layer.id === 'roar' ? .54 : layer.id === 'charcoal' ? .83 : 1;
        gain.gain.value = this._hasRecording(layer) ? 0 : layer.id === 'rain' ? .45 : .32;
        source.connect(gain); gain.connect(layer.highpass); source.start(now);
        source.onended = () => { disconnect(source); disconnect(gain); if (layer.fallbackSource === source) layer.fallbackSource = null; };
        layer.fallbackSource = source; layer.fallbackGain = gain;
      }
      if (layer.nextAt < now) layer.nextAt = now + .035;
    }
    if (this.mode === 'operator' && !this.ashSource) {
      const source = this.context.createBufferSource(); source.buffer = this.noiseBuffer; source.loop = true; source.playbackRate.value = 1.13;
      source.connect(this.ashFilter); source.connect(this.turbulenceFilter); source.start(); source.onended = () => disconnect(source); this.ashSource = source;
    }
  }
  _loadSamples() {
    if (!this.context || !this.enabled || this.destroyed) return;
    this._loadResidueSources();
    for (const [id, layer] of this.layers) {
      if (this.variations.has('forest') && ['roar', 'charcoal'].includes(id)) continue;
      if (id === 'crickets' && !this._cricketsWanted()) continue;
      if (this._usesVariations(id)) { this._loadVariationLayer(id); continue; }
      if (this.urls[id] && (!layer.buffer || layer.currentUrl !== this.urls[id]) && !this.pendingSamples.has(id) && !this.failedSamples.has(id)) this._requestLayer(id);
    }
  }
  _requestLayer(id) {
    const context = this.context, layer = this.layers.get(id), url = this.urls[id], generation = this.generation;
    if (!context || !layer || !this.enabled || this.destroyed) return Promise.resolve(false);
    const cached = this.bufferCache.get(url)?.buffer;
    if (cached) {
      this._replaceLayerBuffer(layer, cached, url); this.loadedSamples.add(id); this.failedSamples.delete(id); this.sourceErrors.delete(id);
      this._applyParameters(); this._tick(); this._report(); return Promise.resolve(true);
    }
    const controller = new AbortController(), signal = controller.signal, request = { controller, url, id };
    this.sourceRequests.get(id)?.controller.abort();
    this.sourceRequests.set(id, request); this.pendingSamples.add(id);
    const isCurrent = () => !this.destroyed && this.enabled && generation === this.generation && context === this.context && !signal.aborted && this.sourceRequests.get(id) === request && this.urls[id] === url;
    const result = Promise.resolve().then(() => {
      if (!isCurrent()) return null;
      return this.fetchImpl(url, { signal, cache: 'force-cache' });
    }).then(response => {
        if (!response || !isCurrent()) return null;
        if (!response.ok) throw new Error(`Recording unavailable (${response.status}).`);
        return response.arrayBuffer();
      }).then(bytes => {
        if (!bytes || !isCurrent()) return null;
        return context.decodeAudioData(bytes);
      }).then(buffer => {
        if (!buffer || !isCurrent()) return false;
        if (!(buffer.duration > .05)) throw new Error('Recording is empty.');
        this._replaceLayerBuffer(layer, this._prepareBuffer(buffer, id), url);
        this._cacheBuffer(url, layer.buffer);
        this.loadedSamples.add(id); this.pendingSamples.delete(id);
        this.failedSamples.delete(id); this.sourceErrors.delete(id); this.sourceRequests.delete(id);
        this._applyParameters(); this._tick(); this._report();
        return true;
      }).catch(error => {
        if (!isCurrent()) return false;
        this.pendingSamples.delete(id); this.failedSamples.add(id);
        this.sourceRequests.delete(id); this.sourceErrors.set(id, { url, message: error?.message ?? 'Recording could not load.' });
        this._report();
        return false;
      });
    request.promise = result; return result;
  }
  _replaceLayerBuffer(layer, buffer, url) {
    const now = this.context.currentTime;
    // Keep the old recording until replacement decode succeeds, then fade its
    // scheduled windows instead of cutting or reconnecting the whole graph.
    for (const record of layer.sources) {
      holdParameter(record.envelope.gain, now, this._sampleEnvelopeValue(record, now));
      record.envelope.gain.linearRampToValueAtTime(0, now + .8);
      stop(record.source, now + .82);
    }
    while (layer.sources.size > 4) this._disposeSampleSource(layer, layer.sources.values().next().value);
    layer.buffer = buffer; layer.currentUrl = url; layer.nextAt = now + .035;
    for (const slot of layer.variationSlots.values()) { target(slot.mixGain.gain, 0, now, .24); slot.buffer = null; }
    if (layer.fallbackGain) { target(layer.fallbackGain.gain, 0, now + .2, .35); stop(layer.fallbackSource, now + 1.2); }
  }
  _disposeSampleSource(layer, record) {
    layer.sources.delete(record); record.source.onended = null; stop(record.source); disconnect(record.source); disconnect(record.envelope);
    for (const oscillator of record.modulators ?? []) stop(oscillator);
    for (const node of record.nodes ?? []) disconnect(node);
  }
  _sampleEnvelopeValue(record, now) {
    const age = now - record.at;
    if (age <= 0) return 0;
    if (age < record.fade) return Math.sin(age / record.fade * Math.PI / 2);
    if (record.source.loop) return 1;
    if (age > record.duration - record.fade) return Math.cos(Math.min(1, (age - record.duration + record.fade) / record.fade) * Math.PI / 2);
    return 1;
  }

  _hasRecording(layer) { return Boolean(layer.buffer || [...layer.variationSlots.values()].some(slot => slot.buffer)); }
  _prepareBuffer(buffer, id) {
    const seconds = this.mode === 'phone' ? 20 : 32;
    const frames = Math.min(buffer.length, Math.ceil(buffer.sampleRate * seconds));
    const channelLimit = this.mode === 'phone' ? 1 : 2;
    if (buffer.length > frames || buffer.numberOfChannels > channelLimit) {
      const bounded = this.context.createBuffer(Math.min(channelLimit, buffer.numberOfChannels), frames, buffer.sampleRate);
      if (channelLimit === 1) {
        const output = bounded.getChannelData(0);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const input = buffer.getChannelData(channel);
          for (let frame = 0; frame < frames; frame++) output[frame] += input[frame] / buffer.numberOfChannels;
        }
      } else for (let channel = 0; channel < bounded.numberOfChannels; channel++) bounded.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, frames));
      buffer = bounded;
    }
    buffer = prepareRecording(buffer, { naturalRain: id === 'rain', mode: this.mode });
    return this.mode === 'phone' || id === 'crickets' || id === 'rain'
      ? copyRecordingPreparation(buffer, circularLoopBuffer(this.context, buffer, { cricket: id === 'crickets' })) : buffer;
  }
  _cacheBuffer(url, buffer) {
    this.bufferCache.delete(url); this.bufferCache.set(url, { buffer });
    const limit = this.mode === 'phone' ? 4 : 18;
    const pinned = new Set();
    for (const layer of this.layers.values()) { if (layer.buffer) pinned.add(layer.currentUrl); for (const slot of layer.variationSlots.values()) if (slot.buffer) pinned.add(slot.currentUrl); }
    while (this.bufferCache.size > limit) this.bufferCache.delete([...this.bufferCache.keys()].find(key => !pinned.has(key)) ?? this.bufferCache.keys().next().value);
  }
  _syncVariationSlots(layer) {
    if (!layer) return;
    const entries = this.variations.get(layer.id) ?? [], wanted = new Set(entries.map(entry => entry.url));
    // During a palette refresh retain at most two old endpoints until a new
    // one succeeds. A failed/newer request cannot silence the working texture.
    const previous = [...layer.variationSlots].filter(([url, slot]) => !wanted.has(url) && slot.buffer && (!slot.retireAt || slot.retireAt > this.context.currentTime)).sort((a, b) => b[1].weight - a[1].weight).slice(0, 2).map(([url]) => url);
    for (const [url, slot] of layer.variationSlots) if (!wanted.has(url) && !previous.includes(url)) this._disposeVariationSlot(layer, url, slot);
    for (const entry of entries) if (!layer.variationSlots.has(entry.url)) {
      const mixGain = this.context.createGain(); mixGain.gain.value = 0;
      let space = null;
      if (layer.id === 'crickets') {
        const highpass = this.context.createBiquadFilter(), filter = this.context.createBiquadFilter(), distance = this.context.createGain();
        highpass.type = 'highpass'; highpass.Q.value = .35; filter.type = 'lowpass'; filter.Q.value = .35;
        const panner = this.mode === 'operator' && typeof this.context.createStereoPanner === 'function' ? this.context.createStereoPanner() : null;
        mixGain.connect(highpass); highpass.connect(filter); filter.connect(panner ?? distance); if (panner) panner.connect(distance); distance.connect(layer.sampleGate);
        space = { highpass, filter, panner, distance };
      } else mixGain.connect(layer.sampleGate);
      layer.variationSlots.set(entry.url, { buffer: this.bufferCache.get(entry.url)?.buffer ?? null, currentUrl: entry.url, mixGain, space, weight: 0, nextAt: this.context.currentTime + .035, sequence: 0 });
    }
    for (const entry of entries) { const slot = layer.variationSlots.get(entry.url); slot.retireAt = null; if (!slot.buffer) slot.buffer = this.bufferCache.get(entry.url)?.buffer ?? null; }
  }
  _disposeVariationSlot(layer, url, slot) {
    for (const record of [...layer.sources]) if (record.slot === slot) this._disposeSampleSource(layer, record);
    disconnect(slot.mixGain); for (const node of Object.values(slot.space ?? {})) disconnect(node); layer.variationSlots.delete(url);
  }
  _loadVariationLayer(id) {
    const layer = this.layers.get(id);
    if (!layer || !this._usesVariations(id) || !this.enabled || this.destroyed || (id === 'crickets' && !this._cricketsWanted())) return Promise.resolve(true);
    this._syncVariationSlots(layer);
    if (this.variations.get(id).some(entry => layer.variationSlots.get(entry.url)?.buffer)) this._activateVariations(layer);
    const requests = [];
    for (const entry of this.variations.get(id)) {
      const key = `${id}:${entry.url}`, slot = layer.variationSlots.get(entry.url);
      if (slot.buffer) continue;
      if (this.sourceRequests.has(key)) { requests.push(this.sourceRequests.get(key).promise); continue; }
      if (this.sourceErrors.has(key)) continue;
      requests.push(this._requestVariation(layer, slot, key));
    }
    return Promise.all(requests).then(results => results.every(Boolean));
  }
  _requestVariation(layer, slot, key) {
    const context = this.context, generation = this.generation, controller = new AbortController();
    const request = { id: layer.id, url: slot.currentUrl, controller }, signal = controller.signal;
    this.sourceRequests.set(key, request); this.pendingSamples.add(key);
    const isCurrent = () => !this.destroyed && this.enabled && generation === this.generation && context === this.context && !signal.aborted && this.sourceRequests.get(key) === request && this._usesVariations(layer.id) && layer.variationSlots.get(slot.currentUrl) === slot;
    request.promise = Promise.resolve().then(() => isCurrent() ? this.fetchImpl(slot.currentUrl, { signal, cache: 'force-cache' }) : null).then(response => {
      if (!response || !isCurrent()) return null;
      if (!response.ok) throw new Error(`Recording unavailable (${response.status}).`);
      return response.arrayBuffer();
    }).then(bytes => bytes && isCurrent() ? context.decodeAudioData(bytes) : null).then(buffer => {
      if (!buffer || !isCurrent()) return false;
      if (!(buffer.duration > .05)) throw new Error('Recording is empty.');
      slot.buffer = this._prepareBuffer(buffer, layer.id); slot.nextAt = context.currentTime + .035; this._cacheBuffer(slot.currentUrl, slot.buffer);
      this.loadedSamples.add(layer.id); this.pendingSamples.delete(key); this.sourceRequests.delete(key); this.sourceErrors.delete(key);
      if (![...this.sourceErrors].some(([name]) => name.startsWith(`${layer.id}:`))) this.failedSamples.delete(layer.id);
      this._activateVariations(layer);
      if (layer.fallbackGain) { target(layer.fallbackGain.gain, 0, context.currentTime, .4); stop(layer.fallbackSource, context.currentTime + 1.2); }
      this._applyParameters(); this._tick(); this._report(); return true;
    }).catch(error => {
      if (!isCurrent()) return false;
      this.pendingSamples.delete(key); this.sourceRequests.delete(key); this.failedSamples.add(layer.id);
      this.sourceErrors.set(key, { url: slot.currentUrl, message: error?.message ?? 'Recording could not load.' }); this._applyParameters(); this._report(); return false;
    });
    return request.promise;
  }
  _fadeSampleRecords(layer, predicate) {
    const now = this.context.currentTime;
    for (const record of layer.sources) if (predicate(record)) { target(record.envelope.gain, 0, now, .15, this._sampleEnvelopeValue(record, now)); stop(record.source, now + .82); }
  }
  _activateVariations(layer) {
    if (layer.buffer) { this._fadeSampleRecords(layer, record => !record.slot); layer.buffer = null; }
    const wanted = new Set(this.variations.get(layer.id).map(entry => entry.url));
    for (const slot of layer.variationSlots.values()) if (!wanted.has(slot.currentUrl) && !slot.retireAt) {
      slot.retireAt = this.context.currentTime + .82; slot.weight = 0; target(slot.mixGain.gain, 0, this.context.currentTime, .15);
      this._fadeSampleRecords(layer, record => record.slot === slot);
    }
  }
  _applyVariationWeights(layer) {
    const entries = this.variations.get(layer.id);
    if (!entries || (!this._usesVariations(layer.id) && !this._playingVariations(layer))) return;
    const weights = this._variationWeights(layer.id), slots = entries.map(entry => layer.variationSlots.get(entry.url));
    let energy = slots.reduce((sum, slot, index) => sum + (slot?.buffer ? weights[index] ** 2 : 0), 0);
    const hasAny = slots.some(slot => slot?.buffer);
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]; if (!slot) continue;
      slot.weight = slot.buffer ? this.mode === 'phone' && layer.id === 'crickets' ? weights[index]
        : energy > .000001 ? weights[index] / Math.sqrt(energy) : 1 / Math.sqrt(slots.filter(value => value?.buffer).length) : 0;
      target(slot.mixGain.gain, slot.weight, this.context.currentTime, .3);
    }
    if (hasAny && layer.fallbackGain) target(layer.fallbackGain.gain, 0, this.context.currentTime, .4);
  }

  _applyParameters() {
    if (!this.context || !this.master) return;
    const c = this.context, now = c.currentTime, m = this._effectiveMacros(), p = macroParameters(m), score = this._sceneScore();
    const cricketGain = this._cricketGain();
    for (const layer of this.layers.values()) this._applyVariationWeights(layer);
    this._applyCricketPerspective();
    if (this._cricketsWanted() && this.enabled) this._loadSamples();
    if (this.mode === 'operator') {
      target(this.delay.delayTime, p.delaySeconds, now, .3);
      target(this.delaySend.gain, 0, now);
      target(this.feedback.gain, 0, now);
      target(this.delayReturn.gain, 0, now, .08);
      target(this.damping.frequency, p.damping, now);
    }
    const activity = score && ['arrival', 'instructions', 'participation'].includes(this.scene.id) ? 1 : this._progression().sourceCount ? Math.sqrt(this._soundCondition().heat) : 0;
    if (this.mode === 'phone') {
      const layer = this.layers.get('crackle');
      const bed = this._phoneBed();
      target(layer.gain.gain, bed.gain * (score?.mix.phoneField ?? 1), now, score ? .12 : .35);
      target(layer.filter.frequency, bed.cutoff, now, .5);
      this._syncPhoneWeather();
      return;
    }
    this._syncLocalBells(); this._syncMainQuench();
    const wet = p.audibleMoisture;
    const forest = this.layers.get('forest'), roar = this.layers.get('roar'), charcoal = this.layers.get('charcoal'), rain = this.layers.get('rain');
    const generatedForest = this.variations.has('forest') && this._hasRecording(forest);
    const generatedRain = this.variations.has('rain') && this._hasRecording(rain);
    const forestWeight = score?.mix.mainForest ?? 1;
    const mainOtherWeight = score?.mix.mainOther ?? 1;
    // The composed 4→5 handoff owns forest amplitude. Heat can reach zero in
    // an incoming rain snapshot without collapsing that outgoing sound.
    const forestActivity = ['forest-takeover', 'final-rain'].includes(this.scene?.id) ? 1 : activity;
    const rainWeight = score ? Number(['final-rain', 'afterglow'].includes(this.scene.id)) : 1;
    const mainRainWeight = score?.mix.mainRain ?? 1;
    this._applyMainDrone();
    const legacyBlend = generatedForest ? 0 : forest.buffer ? .35 : 1;
    target(forest.gain.gain, (generatedForest ? .07 + .17 * smoothstep(0, 1, m.forest) : p.forestLevel) * forestActivity * (1 - .3 * wet) * forestWeight, now, score ? .08 : .4);
    target(forest.filter.frequency, (1500 + 900 * m.forest ** 2) * (1 - .28 * wet), now, .65);
    target(forest.highpass.frequency, 35, now, .65);
    target(roar.gain.gain, p.fireLevel * forestActivity * legacyBlend * forestWeight, now, score ? .08 : .3); target(roar.filter.frequency, p.fireCutoff, now, .2);
    target(roar.filter.Q, p.fireResonance, now); target(roar.highpass.frequency, p.fireHighpass, now);
    target(charcoal.gain.gain, p.charcoalLevel * forestActivity * legacyBlend * forestWeight, now); target(charcoal.filter.frequency, p.charcoalCutoff, now);
    // The score already supplies the composed forest/rain crossfade. Applying
    // the macro gain again hid the first half of a slow rainfall arrival.
    const composedRain = score && ['final-rain', 'afterglow'].includes(this.scene.id);
    target(rain.gain.gain, (composedRain ? .125 : p.rainLevel) * rainWeight * mainRainWeight, now, .65); target(rain.filter.frequency, generatedRain ? 10000 * (1 - .3 * wet) : p.rainCutoff, now, .65);
    this._applyRainPerspectives(rain, m.rain, now);
    // The location rain recording can contain wildlife. At intense fire levels
    // use broadband synthetic rain instead, with no recorded insects/birds.
    target(rain.sampleGate.gain, generatedRain ? 1 : 1 - m.forest ** 3, now, .3);
    if (rain.fallbackGain) target(rain.fallbackGain.gain, generatedRain ? 0 : rain.buffer ? .45 * m.forest ** 3 : .45, now, .4);
    // Keep the generated storm's low thunder in the broad/far perspectives.
    target(rain.highpass.frequency, generatedRain ? 55 : 120 + 900 * wet ** 2, now, .65);
    const haze = this.layers.get('haze'), ash = this.layers.get('ash'), moisture = this.layers.get('moisture');
    target(haze.gain.gain, this._hasRecording(haze) ? (.006 + .04 * smoothstep(0, 1, m.haze)) * (score ? score.mix.mainHaze : activity) : 0, now, score ? .08 : .5);
    target(haze.filter.frequency, 9000 - 2800 * wet, now, .65);
    target(ash.gain.gain, this._hasRecording(ash) ? .035 * m.ash ** 1.2 * activity * forestWeight * mainOtherWeight : 0, now, .45);
    target(ash.filter.frequency, 10500 - 3000 * wet, now, .65);
    target(moisture.gain.gain, this._hasRecording(moisture) ? .035 * smoothstep(0, 1, wet) * rainWeight * mainRainWeight : 0, now, .8);
    target(moisture.filter.frequency, 7000 - 2500 * wet, now, .8);
    target(this.ashFilter.frequency, p.ashHighpass, now); target(this.ashGain.gain, this._hasRecording(ash) ? 0 : p.ashLevel * activity * forestWeight * mainOtherWeight, now);
    target(this.turbulenceFilter.frequency, 450 + 2800 * m.forest ** 2 * (1 - .55 * wet), now);
    target(this.turbulenceGain.gain, generatedForest ? 0 : p.turbulenceLevel * forestActivity * forestWeight, now);
    if (this.lastSaturation !== p.saturation) { charcoal.shaper.curve = curveFor(p.saturation); this.lastSaturation = p.saturation; }
  }
  _mainDroneGain() {
    return MAIN_DRONE_LEVEL * (this._sceneScore()?.mix.mainDrone ?? 0);
  }
  _droneProgress() { return smoothstep(0, 1, Math.max(this._progression().fraction, 1 - this._soundCondition().heat)); }
  _droneRatio() { return .75 ** this._droneProgress(); }
  _droneTransposition() { return 12 * Math.log2(this._droneRatio()); }
  _droneFrequencies() { const original = MAIN_DRONE_MIDI.map(patchFrequencyForMidi); return [...original, ...original.map(frequency => frequency * this._droneRatio())]; }
  _applyMainDrone() {
    if (this.mode !== 'operator' || !this.context) return;
    const level = this._mainDroneGain();
    if (level > 0 && !this.mainDrone && this.enabled) {
      const c = this.context, filter = c.createBiquadFilter(), gain = c.createGain();
      filter.type = 'lowpass'; filter.frequency.value = 360; filter.Q.value = .35;
      gain.gain.value = 0; filter.connect(gain); gain.connect(this.mixerNodes.get('lowDrone'));
      const oscillators = [], partials = [], frequencies = this._droneFrequencies(), at = c.currentTime + .02;
      if (!this.mainDroneWave && c.createPeriodicWave) this.mainDroneWave = c.createPeriodicWave(
        new Float32Array(MAIN_DRONE_OVERTONES.length), Float32Array.from(MAIN_DRONE_OVERTONES), { disableNormalization: true });
      for (const [index, frequency] of frequencies.entries()) {
        const oscillator = c.createOscillator(), partial = c.createGain();
        if (this.mainDroneWave && oscillator.setPeriodicWave) oscillator.setPeriodicWave(this.mainDroneWave);
        else oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        // At unison, two half-level copies reproduce the original chord.
        partial.gain.value = MAIN_DRONE_AMPLITUDES[index % 3] * .5;
        oscillator.connect(partial); partial.connect(filter); oscillator.start(at);
        oscillators.push(oscillator); partials.push(partial);
      }
      this.mainDrone = { oscillators, partials, filter, gain };
    }
    if (this.mainDrone) {
      target(this.mainDrone.gain.gain, level, this.context.currentTime, .12);
      for (const [index, oscillator] of this.mainDrone.oscillators.entries()) target(oscillator.frequency, this._droneFrequencies()[index], this.context.currentTime, 4);
    }
  }
  _stopMainDrone() {
    if (!this.mainDrone) return;
    for (const oscillator of this.mainDrone.oscillators) { stop(oscillator); disconnect(oscillator); }
    for (const partial of this.mainDrone.partials) disconnect(partial);
    disconnect(this.mainDrone.filter); disconnect(this.mainDrone.gain); this.mainDrone = null;
  }
  _cricketGain() {
    if (this.scene?.id === 'ended') return 0;
    const blend = landscapeBlend(this._progression());
    const score = this._sceneScore(), sceneWeight = score ? this.mode === 'phone' ? score.mix.phoneCrickets : score.mix.mainCrickets : 1;
    // The score's phone master already contains the distance and final tail.
    // Perspective below changes bandwidth/width without multiplying it again.
    const finale = ['final-rain', 'afterglow'].includes(this.scene?.id);
    return (this.mode === 'phone' ? .04 * this._phoneCrickets().weight : .045 * (finale ? 1 : blend.cricketWeight)) * sceneWeight;
  }
  _cricketsWanted() {
    return this._cricketGain() > 0 || ['final-rain', 'afterglow'].includes(this.scene?.id) && (this._sceneScore()?.finalCricketProgress ?? 0) > 0;
  }
  _phoneCrickets() {
    const actual = phoneCricketParameters(this._progression());
    if (!['final-rain', 'afterglow'].includes(this.scene?.id)) return actual;
    const progress = this._sceneScore()?.finalCricketProgress ?? 0;
    // Finale uses its smooth cooling score, avoiding a binary all-out jump.
    return { ...actual, weight: progress, approach: progress };
  }
  _holdSceneCrickets(parameter, now) {
    const envelope = this.sceneCricketEnvelope;
    if (envelope && typeof parameter.cancelAndHoldAtTime !== 'function') {
      const score = computeSceneScore(envelope.scene, envelope.elapsed + (now - envelope.at) * 1000);
      const value = this.mode === 'phone' ? .04 * score.mix.phoneCrickets : .045 * score.mix.mainCrickets;
      parameter.cancelScheduledValues(envelope.at);
      parameter.setValueAtTime(value, now); automation.delete(parameter);
    } else holdParameter(parameter, now);
    this.sceneCricketEnvelope = null;
  }
  _applySceneCrickets(parameter, now) {
    if (this.scene?.id !== 'afterglow') {
      if (this.sceneCricketEnvelope) this._holdSceneCrickets(parameter, now);
      this.sceneCricketSchedule = null;
      target(parameter, this._cricketGain(), now, .9);
      return;
    }
    // Both ends of the PA/phone transfer run on their audio clocks. Repeated
    // target smoothing formerly delayed the already quiet phone entrance.
    const schedule = JSON.stringify([this.scene, this.sceneReceivedAt]);
    if (this.sceneCricketSchedule === schedule) return;
    this.sceneCricketSchedule = schedule;
    this._holdSceneCrickets(parameter, now);
    const value = this._cricketGain(), elapsed = this._sceneElapsed(now);
    const remaining = Math.max(0, this._sceneScore().mainAudioDurationMs - elapsed);
    if (!this.scene.paused && remaining > 0) {
      const values = Float32Array.from({ length: 513 }, (_, index) => {
        const score = computeSceneScore(this.scene, elapsed + remaining * index / 512);
        return this.mode === 'phone' ? .04 * score.mix.phoneCrickets : .045 * score.mix.mainCrickets;
      });
      const freshNow = this.context.currentTime, at = freshNow + .02, end = now + remaining / 1000;
      parameter.setValueAtTime(value, freshNow);
      if (end - at > 1 / this.context.sampleRate) parameter.setValueCurveAtTime(values, at, end - at);
      else parameter.linearRampToValueAtTime(values.at(-1), Math.max(end, freshNow + 1 / this.context.sampleRate));
      this.sceneCricketEnvelope = { scene: this.scene, elapsed: this._sceneElapsed(freshNow), at: freshNow };
      return;
    }
    parameter.setValueAtTime(value, now);
  }
  _applyCricketPerspective() {
    const layer = this.layers.get('crickets'); if (!layer || !this.context) return;
    const now = this.context.currentTime, retreat = this._cricketRetreat();
    this._applySceneCrickets(layer.gain.gain, now);
    target(layer.highpass.frequency, retreat.highpass, now, .25);
    target(layer.filter.frequency, retreat.lowpass, now, .4);
    const entries = this.variations.get('crickets') ?? [];
    for (const [index, entry] of entries.entries()) {
      const slot = layer.variationSlots.get(entry.url); if (!slot?.space) continue;
      const depth = entry.depth ?? index / Math.max(1, entries.length - 1), space = slot.space;
      if (this.mode === 'phone') {
        target(space.highpass.frequency, 400 + 600 * depth, now, .8);
        target(space.filter.frequency, (9000 - 3000 * depth) * (.18 ** smoothstep(0, 1, retreat.progress)), now, 1.4);
        target(space.distance.gain, 1 - .48 * depth, now, 1.2);
        continue;
      }
      target(space.highpass.frequency, 340 + 200 * depth, now, .3);
      target(space.filter.frequency, (9000 - 3000 * depth) * (.18 ** smoothstep(0, 1, retreat.progress)), now, .4);
      target(space.distance.gain, 1 / (1 + .32 * depth), now, .25);
      if (space.panner?.pan) target(space.panner.pan, ((index % 2 ? 1 : -1) * (.75 - .4 * depth)) * retreat.spread, now, .4);
    }
  }
  _startScheduler() {
    if (this.timer || this.destroyed || !this.enabled || this.muted || this.hidden || this.context?.state !== 'running') return;
    this._tick(); this.timer = setInterval(() => this._tick(), this.mode === 'operator' ? 60 : 160);
  }
  _stopScheduler() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  _tick() {
    if (!this.context || !this.enabled || this.muted || this.hidden || this.destroyed || this.context.state !== 'running') return;
    const now = this.context.currentTime, m = this._effectiveMacros(), p = macroParameters(m);
    this._applySceneGain();
    this._drainRainAreas();
    this._drainPatchBlobs();
    this.dragAsh?.tick(now);
    if (this.scene) this._applyParameters(); else this._applyCricketPerspective();
    for (const layer of this.layers.values()) {
      if (this.variations.has('forest') && this._hasRecording(this.layers.get('forest')) && ['roar', 'charcoal'].includes(layer.id)) continue;
      // Cricket recordings remain silent and unscheduled until authoritative
      // extinction makes their aftermath bed eligible.
      if (layer.id === 'crickets' && !this._cricketsWanted()) continue;
      if (this._playingVariations(layer)) {
        for (const [url, slot] of layer.variationSlots) if (slot.retireAt && slot.retireAt <= now) this._disposeVariationSlot(layer, url, slot);
        const slots = [...layer.variationSlots.values()].filter(slot => slot.buffer && !slot.retireAt);
        if (slots.length) {
          for (const slot of slots) {
            if (slot.nextAt < now) slot.nextAt = now + .025;
            if (slot.nextAt < now + .65) this._scheduleSample(layer, 1, slot.nextAt, slot);
          }
          continue;
        }
      }
      if (!layer.buffer) continue;
      const rate = layer.id === 'roar' || layer.id === 'forest' ? p.fireRate : layer.id === 'charcoal' ? p.charcoalRate : layer.id === 'rain' ? p.rainRate : 1;
      // Skip missed windows after suspension rather than creating a source burst.
      if (layer.nextAt < now) layer.nextAt = now + .025;
      if (layer.nextAt < now + .65) this._scheduleSample(layer, this.variations.has(layer.id) ? 1 : rate, layer.nextAt);
    }
    if (this.mode === 'operator') this._scheduleTexture(p, now);
    this._ensureTouchedVoice(); this._updateVoices();
    if (this.mode === 'operator' && !this.patchVoiceMode) this._scheduleToneGrains(now);
  }
  _scheduleSample(layer, rate, at, slot = layer) {
    if (this.mode === 'operator' && layer.id === 'rain') return this._scheduleRainPerspectives(layer, at, slot);
    const c = this.context, source = c.createBufferSource(), envelope = c.createGain();
    const nativeLoop = this.mode === 'phone' || layer.id === 'crickets' || layer.id === 'rain';
    if (nativeLoop) {
      // A prepared circular buffer has no file fade at each lap. A single
      // native loop cannot drift or develop gaps when a mobile timer is late.
      source.buffer = slot.buffer; source.playbackRate.value = this.mode === 'phone' && layer.id === 'crickets' ? PHONE_CRICKET_RATE : 1; source.loop = true;
      source.loopStart = 0; source.loopEnd = slot.buffer.duration;
      envelope.gain.setValueAtTime(0, at); envelope.gain.setValueCurveAtTime(FADE_IN, at, layer.id === 'crickets' ? .22 : .4);
      source.connect(envelope); envelope.connect(slot === layer ? layer.sampleGate : slot.mixGain);
      while (layer.sources.size >= (slot === layer ? 6 : 8)) this._disposeSampleSource(layer, layer.sources.values().next().value);
      const record = { source, envelope, buffer: slot.buffer, url: slot.currentUrl, at, fade: layer.id === 'crickets' ? .22 : .4, duration: Infinity, slot: slot === layer ? null : slot }; layer.sources.add(record);
      source.onended = () => { layer.sources.delete(record); disconnect(source); disconnect(envelope); };
      const phase = layer.id === 'crickets' ? (patchHash(slot.currentUrl ?? layer.id) / 4294967296) * slot.buffer.duration : 0;
      source.start(at, phase); slot.nextAt = Infinity;
      return;
    }
    // Long overlapping windows preserve continuous fire. Gentle irregular rate
    // changes avoid the explosive effect of fast, isolated granular snippets.
    if (this.mode === 'operator' && !this.variations.has(layer.id)) rate *= .96 + .08 * this._random();
    const window = 4.5 + 4 * this._random();
    const water = ['rain', 'moisture'].includes(layer.id) && this.variations.has(layer.id);
    const duration = Math.max(.05, Math.min(window, slot.buffer.duration / rate)), fade = Math.min(water ? 2.2 : 1.6, duration * (water ? .38 : .28));
    const availableOffset = Math.max(0, slot.buffer.duration - duration * rate);
    const offset = availableOffset * this._random();
    source.buffer = slot.buffer; source.playbackRate.value = rate;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.setValueCurveAtTime(FADE_IN, at, fade);
    envelope.gain.setValueAtTime(1, at + duration - fade);
    envelope.gain.setValueCurveAtTime(FADE_OUT, at + duration - fade, fade);
    source.connect(envelope); envelope.connect(slot === layer ? layer.sampleGate : slot.mixGain);
    while (layer.sources.size >= (slot === layer ? 6 : 8)) this._disposeSampleSource(layer, layer.sources.values().next().value);
    const record = { source, envelope, buffer: slot.buffer, url: slot.currentUrl, at, duration, fade, slot: slot === layer ? null : slot }; layer.sources.add(record);
    source.onended = () => { layer.sources.delete(record); disconnect(source); disconnect(envelope); };
    source.start(at, offset); source.stop(at + duration);
    slot.nextAt = at + duration - fade;
  }
  _scheduleRainPerspectives(layer, at, slot) {
    const c = this.context, power = Math.sqrt(RAIN_PERSPECTIVES.reduce((sum, perspective) => sum + perspective.level ** 2, 0));
    const slotIndex = [...layer.variationSlots.values()].indexOf(slot);
    for (const [index, perspective] of RAIN_PERSPECTIVES.entries()) {
      const source = c.createBufferSource(), envelope = c.createGain(), level = c.createGain();
      const highpass = c.createBiquadFilter(), filter = c.createBiquadFilter();
      const panner = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
      source.buffer = slot.buffer; source.loop = true; source.loopStart = 0; source.loopEnd = slot.buffer.duration;
      source.playbackRate.value = perspective.rate;
      highpass.type = 'highpass'; highpass.frequency.value = perspective.highpass; highpass.Q.value = .35;
      filter.type = 'lowpass'; filter.frequency.value = Math.min(c.sampleRate * .43, perspective.lowpass); filter.Q.value = .35;
      if (panner) panner.pan.value = Math.max(-.8, Math.min(.8, perspective.pan * (slotIndex % 2 ? -1 : 1)));
      level.gain.value = 0;
      envelope.gain.setValueAtTime(0, at); envelope.gain.setValueCurveAtTime(FADE_IN, at, 1.8);
      source.connect(highpass); highpass.connect(filter); filter.connect(envelope); envelope.connect(level);
      level.connect(panner ?? (slot === layer ? layer.sampleGate : slot.mixGain));
      if (panner) panner.connect(slot === layer ? layer.sampleGate : slot.mixGain);
      const modulators = [], nodes = [highpass, filter, level, ...(panner ? [panner] : [])];
      if (panner) {
        const motion = c.createOscillator(), amount = c.createGain();
        motion.type = 'sine'; motion.frequency.value = perspective.motionHz * (slotIndex % 2 ? 1.13 : 1);
        amount.gain.value = .11; motion.connect(amount); amount.connect(panner.pan); motion.start(at);
        modulators.push(motion); nodes.push(motion, amount);
      }
      const phase = patchHash(`${slot.currentUrl ?? 'rain'}:${index}:passage`) / 4294967296 * slot.buffer.duration;
      const record = { source, envelope, buffer: slot.buffer, url: slot.currentUrl, at, fade: 1.8, duration: Infinity,
        slot: slot === layer ? null : slot, perspective, perspectiveIndex: index, perspectiveGain: level, perspectiveLevel: perspective.level / power,
        phase, nodes, modulators };
      // Two endpoints normally use six loops. Keep room for replacement
      // fades, and retire obsolete endpoints before an unchanged passage.
      while (layer.sources.size >= 12) {
        const wanted = new Set((this.variations.get('rain') ?? []).map(entry => entry.url));
        const obsolete = [...layer.sources].find(record => record.slot?.retireAt || !wanted.has(record.url));
        this._disposeSampleSource(layer, obsolete ?? layer.sources.values().next().value);
      }
      layer.sources.add(record); source.onended = () => this._disposeSampleSource(layer, record);
      source.start(at, phase);
    }
    slot.nextAt = Infinity;
    this._applyRainPerspectives(layer, this._effectiveMacros().rain, c.currentTime);
  }
  _applyRainPerspectives(layer, intensity, now) {
    // Fine close drops arrive first, broader and more distant rain joins
    // gradually. Their independent passages keep the full field irregular.
    const depth = [1, smoothstep(.04, .8, intensity), smoothstep(.22, 1, intensity)];
    for (const record of layer.sources) if (record.perspectiveGain) {
      target(record.perspectiveGain.gain, record.perspectiveLevel * depth[record.perspectiveIndex], now, 1.2);
    }
  }
  _random() {
    let value = this.randomState; value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.randomState = value >>> 0; return this.randomState / 4294967296;
  }
  _scheduleTexture(p, now) {
    // Bounded look-ahead avoids interval-dependent density and catch-up bursts.
    this.nextGrain = Math.max(now + .01, this.nextGrain);
    const m = this._effectiveMacros(), score = this._sceneScore();
    const activity = (score && ['arrival', 'instructions', 'participation', 'forest-takeover', 'final-rain'].includes(this.scene.id) ? 1 : Math.sqrt(this._soundCondition().heat)) * (score?.mix.mainForest ?? 1);
    const generatedForest = this.variations.has('forest') && this._hasRecording(this.layers.get('forest'));
    while (!generatedForest && activity > .001 && this.nextGrain < now + .24 && this.grains.size < 12) {
      const variation = this._random(); this.tickSequence++;
      const shape = dryFireTextureParameters(m.forest, variation, audibleMoisture(m.moisture)), at = this.nextGrain, duration = shape.duration;
      const source = this.context.createBufferSource(), filter = this.context.createBiquadFilter(), lowpass = this.context.createBiquadFilter(), envelope = this.context.createGain();
      source.buffer = this.noiseBuffer; source.playbackRate.value = .85 + this._random() * .3;
      filter.type = 'highpass'; filter.frequency.value = shape.highpass; filter.Q.value = shape.resonance;
      lowpass.type = 'lowpass'; lowpass.frequency.value = shape.lowpass; lowpass.Q.value = shape.resonance;
      envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(activity * shape.gain, at + shape.attack);
      envelope.gain.exponentialRampToValueAtTime(.0001, at + duration);
      source.connect(filter); filter.connect(lowpass); lowpass.connect(envelope); envelope.connect(this.mixerNodes.get('forest'));
      const record = { source, filter, lowpass, envelope }; this.grains.add(record);
      source.onended = () => { this.grains.delete(record); disconnect(source); disconnect(filter); disconnect(lowpass); disconnect(envelope); };
      source.start(at, this._random() * 2); source.stop(at + duration + .01);
      this.nextGrain += (1 / p.grainDensity) * (.18 + this._random() ** 2 * 2.8);
    }
    this.gust = .78 * this.gust + .22 * this._random();
    if (!this._hasRecording(this.layers.get('ash'))) target(this.ashGain.gain, p.ashLevel * (.3 + p.ashScatter * this._random()) * activity * (score?.mix.mainOther ?? 1), now, .11);
    if (!generatedForest) target(this.turbulenceGain.gain, p.turbulenceLevel * activity * (.5 + .7 * this.gust), now, .18 + .35 * this._random());
    target(this.turbulenceFilter.frequency, (500 + 2800 * m.forest ** 2) * (.5 + .5 * this.gust), now, .3);
  }

  _toneGrainBuffer(voice, midi = voice.midi) {
    const ashLayer = this.layers.get('ash');
    const ash = ashLayer?.buffer ?? [...(ashLayer?.variationSlots.values() ?? [])].filter(slot => slot.buffer).sort((a, b) => b.weight - a.weight)[0]?.buffer ?? null;
    const cached = this.toneGrainBuffers.get(midi);
    if (cached && grainBufferAsh.get(cached) === ash) return cached;
    // The ash recording is downmixed into each exact-pitch MONO buffer before
    // any spatial path. Pitch buffers are shared, never participant routes.
    const rate = Math.min(24000, this.context.sampleRate), buffer = this.context.createBuffer(1, Math.ceil(rate * 1.4), rate), data = buffer.getChannelData(0);
    const fundamental = 440 * 2 ** ((midi - 69) / 12);
    for (const [partialIndex, partial] of PARTICIPANT_PARTIALS.entries()) {
      const frequency = fundamental * partial;
      if (frequency >= rate * .45) continue;
      const step = 2 * Math.PI * frequency / rate, phase = partial * .71;
      const rotationSin = Math.sin(step), rotationCos = Math.cos(step); let sine = Math.sin(phase), cosine = Math.cos(phase);
      for (let index = 0; index < data.length; index++) {
        data[index] += sine * PARTICIPANT_GRAIN_AMPLITUDES[partialIndex];
        const nextSine = sine * rotationCos + cosine * rotationSin;
        cosine = cosine * rotationCos - sine * rotationSin; sine = nextSine;
      }
    }
    const toneRms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    let ashRms = 0;
    if (ash) {
      const channels = Array.from({ length: ash.numberOfChannels }, (_, channel) => ash.getChannelData(channel));
      const offset = patchHash(midi) % ash.length;
      const material = new Float32Array(data.length); let power = 0;
      for (let index = 0; index < data.length; index++) {
        const position = (offset + index * ash.sampleRate / rate) % ash.length, left = Math.floor(position), right = (left + 1) % ash.length, fraction = position - left;
        let sample = 0; for (const channel of channels) sample += channel[left] + (channel[right] - channel[left]) * fraction;
        material[index] = sample / channels.length; power += material[index] ** 2;
      }
      const materialRms = Math.sqrt(power / material.length);
      // Normalize the actual mono fragment, not the file's raw gain: quiet
      // location recordings then contribute audible, consistently small ash.
      const gain = materialRms > .000001 ? toneRms * PARTICIPANT_ASH_RMS_RATIO / materialRms : 0;
      ashRms = materialRms * gain;
      for (let index = 0; index < data.length; index++) data[index] += material[index] * gain;
    }
    grainBufferAsh.set(buffer, ash);
    grainBufferMix.set(buffer, { toneRms, ashRms, ashRmsRatio: toneRms ? ashRms / toneRms : 0 });
    this.toneGrainBuffers.set(midi, buffer); return buffer;
  }
  _scheduleToneGrains(now) {
    const voices = [...this.voices.values()];
    if (voices.length || this.backgroundPatches.length) target(this.toneReverbReturn.gain, TONE_REVERB_RETURN, now, .45);
    const normalization = 1 / Math.sqrt(Math.max(1, voices.length + this.tails.size));
    const activeLimit = this.patchVoiceMode ? TONE_GRAIN_LIMIT - PATCH_BACKGROUND_GRAIN_LIMIT : TONE_GRAIN_LIMIT;
    let activeCount = [...this.toneGrains].filter(grain => !grain.standalone).length;
    const counts = new Map(); for (const grain of this.toneGrains) counts.set(grain.voice, (counts.get(grain.voice) ?? 0) + 1);
    // Rotating admission shares the finite grain budget even with long rings.
    const order = voices.map((_, index) => voices[(index + this.toneGrainCursor) % voices.length]);
    this.toneGrainCursor = (this.toneGrainCursor + 1) % Math.max(1, voices.length);
    for (const voice of order) {
      voice.nextGrainAt = Math.max(now + .008, voice.nextGrainAt ?? now + .008);
      let count = counts.get(voice) ?? 0;
      while (voice.nextGrainAt < now + .18 && count < TONE_GRAINS_PER_VOICE && activeCount < activeLimit && this.toneGrains.size < TONE_GRAIN_LIMIT) {
        const at = voice.nextGrainAt, background = voice.extinguished;
        const shape = { ...participantGrainParameters(background, this._random()), background };
        // Longer piano rings overlap at the existing dense strike rate. Lower
        // peaks retain headroom without shortening their audible decay.
        const peak = (background ? .022 : .0065) * normalization;
        const source = this.context.createBufferSource(), envelope = this.context.createGain();
        const midi = voice.midiPair[voice.grainSequence++ % 2];
        source.buffer = this._toneGrainBuffer(voice, midi); source.playbackRate.value = 1;
        scheduleGrainEnvelope(envelope.gain, at, shape, peak);
        source.connect(envelope); envelope.connect(voice.grainGate);
        const record = { source, envelope, highpass: voice.grainHighpass, lowpass: voice.grainLowpass, voice, participantId: voice.key, midi,
          frequency: 440 * 2 ** ((midi - 69) / 12), at, ...shape, peak, mono: true, ashMixed: Boolean(grainBufferAsh.get(source.buffer)) };
        this.toneGrains.add(record); count++; activeCount++;
        source.onended = () => this._disposeToneGrain(record);
        source.start(at, this._random() * Math.max(0, source.buffer.duration - shape.duration - .01)); source.stop(at + shape.duration + .01);
        voice.nextGrainAt += shape.interval;
      }
    }
    if (this.patchVoiceMode) this._schedulePatchBackgroundGrains(now);
  }
  _schedulePatchBackgroundGrains(now) {
    const patches = this.backgroundPatches, sceneWeight = patches.length ? this._participantSceneWeight(patches[0]) : 0;
    if (!patches.length || sceneWeight <= 0) { this.nextPatchBackgroundGrain = now; return; }
    this.nextPatchBackgroundGrain = Math.max(now + .008, this.nextPatchBackgroundGrain);
    let count = [...this.toneGrains].filter(grain => grain.standalone).length;
    // The cloud's density and power saturate together. Logical patch count
    // never attenuates it; every cell takes turns at its own pitch and place.
    const density = Math.min(12, patches.length), normalization = 1 / Math.sqrt(density);
    while (this.nextPatchBackgroundGrain < now + .18 && count < PATCH_BACKGROUND_GRAIN_LIMIT && this.toneGrains.size < TONE_GRAIN_LIMIT) {
      const patch = patches[this.patchBackgroundCursor % patches.length];
      this.patchBackgroundCursor = (this.patchBackgroundCursor + 1) % patches.length;
      const shape = { ...participantGrainParameters(true, this._random()), background: true }, at = this.nextPatchBackgroundGrain;
      this._makePatchBackgroundGrain(patch, at, shape, .022 * normalization, sceneWeight); count++;
      this.nextPatchBackgroundGrain += Math.max(1 / PATCH_BACKGROUND_RATE, shape.interval / density);
    }
  }
  _makePatchBackgroundGrain(patch, at, shape, peak, sceneWeight) {
    const c = this.context, source = c.createBufferSource(), envelope = c.createGain(), gate = c.createGain(), mixer = c.createGain();
    const highpass = c.createBiquadFilter(), lowpass = c.createBiquadFilter(), space = this._makeSpatialPath(this.toneGrainBus);
    const midi = patch.midiPair[patch.grainSequence++ % 2], frequency = 440 * 2 ** ((midi - 69) / 12), tone = participantToneParameters(patch);
    source.buffer = this._toneGrainBuffer(patch, midi); source.playbackRate.value = 1;
    highpass.type = 'highpass'; highpass.Q.value = .45; highpass.frequency.value = 440 * 2 ** ((patch.midi - 69) / 12) * tone.highpassRatio;
    lowpass.type = 'lowpass'; lowpass.Q.value = .45; lowpass.frequency.value = Math.min(c.sampleRate * .45, 440 * 2 ** ((patch.midi - 69) / 12) * tone.lowpassRatio);
    gate.gain.value = .9 * sceneWeight; mixer.gain.value = this.mixer.outDrone;
    const pose = participantPosition(patch.position), panner = space.panner;
    if (space.mode === 'HRTF') {
      if (panner.positionX) [panner.positionX.value, panner.positionY.value, panner.positionZ.value] = pose.world;
      else panner.setPosition?.(...pose.world);
      space.distance.gain.value = 1;
    } else { if (panner?.pan) panner.pan.value = pose.pan; space.distance.gain.value = pose.distanceGain; }
    scheduleGrainEnvelope(envelope.gain, at, shape, peak);
    source.connect(envelope); envelope.connect(highpass); highpass.connect(lowpass); lowpass.connect(gate); gate.connect(mixer); mixer.connect(space.input);
    const record = { source, envelope, highpass, lowpass, gate, mixer, space, voice: patch, participantId: patch.id, midi, frequency, at, ...shape, peak,
      standalone: true, mono: true, ashMixed: Boolean(grainBufferAsh.get(source.buffer)), nodes: [highpass, lowpass, gate, mixer, ...space.nodes] };
    this.toneGrains.add(record); patch.grainsScheduled++; patch.lastGrainAt = at;
    source.onended = () => this._disposeToneGrain(record);
    source.start(at, this._random() * Math.max(0, source.buffer.duration - shape.duration - .01)); source.stop(at + shape.duration + .01);
  }
  _disposeToneGrain(record) {
    this.toneGrains.delete(record); record.source.onended = null;
    stop(record.source); disconnect(record.source); disconnect(record.envelope);
    for (const node of record.nodes ?? []) disconnect(node);
  }
  _fadeToneGrain(record, seconds) {
    if (!this.context || record.fading) return;
    const now = this.context.currentTime;
    if (record.at > now) { this._disposeToneGrain(record); return; }
    const current = record.peak * participantGrainEnvelopeAt(now - record.at, record);
    if (typeof record.envelope.gain.cancelAndHoldAtTime === 'function') holdParameter(record.envelope.gain, now, current);
    else {
      // Removing the original curve start avoids old Safari's curve overlap
      // restriction while restoring the exact currently evaluated amplitude.
      record.envelope.gain.cancelScheduledValues(record.at); record.envelope.gain.setValueAtTime(current, now);
    }
    record.fading = true;
    record.envelope.gain.linearRampToValueAtTime(0, now + seconds); stop(record.source, now + seconds + .01);
  }
  _fadeToneGrains(seconds) { for (const record of [...this.toneGrains]) this._fadeToneGrain(record, seconds); }

  _drainVoiceTails(now = this.context?.currentTime ?? 0) {
    // AudioContext time pauses with the app. A late JS callback can only clean
    // an envelope that has already reached zero on that same audio clock.
    for (const voice of this.tails) if (now >= voice.disposeAt) this._disposeVoice(voice);
  }
  _ensureTouchedVoice() { this._syncParticipantVoices(); }
  _makeSpatialPath(destination) {
    const c = this.context, input = c.createGain(), distance = c.createGain();
    // Explicit mono before each voice's panner gives one precise location.
    input.channelCount = 1; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';
    let panner, mode;
    if (typeof c.createPanner === 'function') {
      try {
        panner = c.createPanner(); panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
        panner.refDistance = 2.5; panner.maxDistance = 18; panner.rolloffFactor = .65; mode = 'HRTF';
      } catch { /* Older implementations still have a stereo fallback. */ }
    }
    if (!panner && typeof c.createStereoPanner === 'function') { panner = c.createStereoPanner(); mode = 'stereo'; }
    if (panner) { input.connect(panner); panner.connect(distance); } else { input.connect(distance); mode = 'distance'; }
    distance.connect(destination);
    return { input, panner, distance, mode, nodes: [input, panner, distance].filter(Boolean) };
  }
  _positionQuenchPath(path, position) {
    const pose = participantPosition(position), panner = path.panner;
    if (path.mode === 'HRTF') {
      if (panner.positionX) [panner.positionX.value, panner.positionY.value, panner.positionZ.value] = pose.world;
      else panner.setPosition?.(...pose.world);
      path.distance.gain.value = 1;
    } else {
      if (panner?.pan) panner.pan.value = pose.pan;
      path.distance.gain.value = pose.distanceGain;
    }
  }
  _positionVoice(voice, position, initial = false) {
    const pose = participantPosition(position), now = this.context.currentTime;
    voice.position = [pose.x, pose.y];
    for (const path of [voice.directSpace, voice.grainSpace]) {
      const panner = path.panner;
      if (path.mode === 'HRTF') {
        if (panner.positionX) for (const [parameter, value] of [[panner.positionX, pose.world[0]], [panner.positionY, pose.world[1]], [panner.positionZ, pose.world[2]]]) {
          if (initial) parameter.value = value; else target(parameter, value, now, .065);
        }
        else if (typeof panner.setPosition === 'function') {
          // Legacy PannerNode has no AudioParams: ease its room coordinates
          // on each scheduler tick instead of jumping at pointer-event rate.
          const previous = path.world ?? pose.world, elapsed = Math.max(0, now - (path.poseAt ?? now));
          const amount = initial ? 1 : 1 - Math.exp(-elapsed / .065);
          path.world = previous.map((value, index) => value + (pose.world[index] - value) * amount); path.poseAt = now;
          panner.setPosition(...path.world);
        }
        target(path.distance.gain, 1, now, .065);
      } else {
        if (panner?.pan) { if (initial) panner.pan.value = pose.pan; else target(panner.pan, pose.pan, now, .065); }
        if (initial) path.distance.gain.value = pose.distanceGain; else target(path.distance.gain, pose.distanceGain, now, .065);
      }
    }
    // Patch positions stay fixed; spectral targets follow authoritative heat.
    // Legacy participant voices retain their supplied moving position.
    const shape = participantToneParameters(voice.participant);
    target(voice.grainHighpass.frequency, voice.frequency * shape.highpassRatio, now, .15);
    target(voice.grainLowpass.frequency, Math.min(this.context.sampleRate * .45, voice.frequency * shape.lowpassRatio), now, .15);
  }
  _makeToneVoice(participant) {
    const c = this.context, midi = participant.midi, frequency = 440 * 2 ** ((midi - 69) / 12);
    const filter = c.createBiquadFilter(), gain = c.createGain(), envelope = c.createGain();
    const grainGate = c.createGain(), grainEnvelope = c.createGain(), grainHighpass = c.createBiquadFilter(), grainLowpass = c.createBiquadFilter();
    const directMixer = c.createGain(), grainMixer = c.createGain();
    directMixer.gain.value = grainMixer.gain.value = this.mixer[participant.extinguished ? 'outDrone' : 'chimes'];
    const directSpace = this._makeSpatialPath(this.toneBus), grainSpace = this._makeSpatialPath(this.toneGrainBus);
    filter.type = 'lowpass'; filter.frequency.value = Math.min(c.sampleRate * .45, frequency * 20); filter.Q.value = .35; gain.gain.value = 0;
    const oscillators = [], partialNodes = [], partials = [];
    for (const partial of PARTICIPANT_PARTIALS) {
      if (frequency * partial >= c.sampleRate * .45) continue;
      const oscillator = c.createOscillator(), level = c.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency * partial; level.gain.value = 0;
      oscillator.connect(level); level.connect(filter); oscillators.push(oscillator); partialNodes.push(level); partials.push(partial); oscillator.start();
    }
    filter.connect(gain); gain.connect(envelope); envelope.connect(directMixer); directMixer.connect(directSpace.input);
    grainHighpass.type = 'highpass'; grainHighpass.Q.value = .45;
    grainLowpass.type = 'lowpass'; grainLowpass.Q.value = .45;
    grainGate.gain.value = 0; grainGate.connect(grainHighpass); grainHighpass.connect(grainLowpass); grainLowpass.connect(grainEnvelope); grainEnvelope.connect(grainMixer); grainMixer.connect(grainSpace.input);
    for (const [node, seconds] of [[envelope, PARTICIPANT_ATTACK_SECONDS], [grainEnvelope, participant.extinguished ? PARTICIPANT_ATTACK_SECONDS : .018]]) { node.gain.value = 0; node.gain.setValueCurveAtTime(FADE_IN, c.currentTime, seconds); }
    const voice = { key: participant.id, kind: this.patchVoiceMode ? 'patch' : participant.local ? 'local-participant' : 'participant', participant, midi, midiPair: PARTICIPANT_MIDI_PAIRS[PARTICIPANT_MIDI.indexOf(midi)], grainSequence: patchHash(participant.id) % 2, frequency, partials,
      fundamental: oscillators[0], oscillators, partialNodes, partialGains: [], filter, gain, envelope, grainGate, grainEnvelope, grainHighpass, grainLowpass, directMixer, grainMixer, directSpace, grainSpace,
      spatialMode: directSpace.mode, nodes: [filter, gain, envelope, grainGate, grainEnvelope, grainHighpass, grainLowpass, directMixer, grainMixer, ...oscillators, ...partialNodes, ...directSpace.nodes, ...grainSpace.nodes],
      attackSeconds: PARTICIPANT_ATTACK_SECONDS, grainAttackSeconds: participant.extinguished ? PARTICIPANT_ATTACK_SECONDS : .018, startedAt: c.currentTime, lastTouched: c.currentTime, targetGain: 0, extinguished: participant.extinguished };
    this._positionVoice(voice, participant.position, true); return voice;
  }
  _syncParticipantVoices() {
    if (this.mode !== 'operator' || !this.enabled || !this.context) return;
    if (this.patchVoiceMode) { this._syncPatchSoftTones(); return; }
    if (this.muted || this.hidden) { this._clearParticipantActivity(); return; }
    const now = this.context.currentTime; this._drainVoiceTails(now);
    if (this.context.state === 'running') for (const participant of (this.patchVoiceMode ? this.patchVoices.values() : [...this.participants.values(), ...(this.localParticipant ? [this.localParticipant] : [])])) {
      if (participant.holding) this.participantActivity.set(participant.id, now + PARTICIPANT_MINIMUM_GATE_SECONDS);
      else if (now >= (this.participantActivity.get(participant.id) ?? -Infinity)) this.participantActivity.delete(participant.id);
    }
    const desired = new Map(this._desiredParticipants().slice(0, this.maxVoices).map(participant => [participant.id, participant]));
    for (const voice of [...this.voices.values()]) {
      const participant = desired.get(voice.key);
      if (!participant || participant.midi !== voice.midi) { this._retireVoice(voice, this._participantSceneWeight(voice.participant) === 0 ? .08 : PARTICIPANT_RELEASE_SECONDS); this.voices.delete(voice.key); }
      else { voice.participant = participant; desired.delete(voice.key); }
    }
    for (const participant of desired.values()) {
      // Full equal-power tails count against the admission budget. Large
      // audiences retain all identities in state while DSP remains bounded.
      if (this.voices.size + this.tails.size >= this.maxVoices) break;
      this.voices.set(participant.id, this._makeToneVoice(participant));
    }
  }
  _updateVoices() {
    if (!this.context) return;
    if (this.patchVoiceMode) { this._syncPatchSoftTones(); return; }
    this._drainVoiceTails(); this._syncParticipantVoices();
    if (this.mode !== 'operator') return;
    const now = this.context.currentTime, normalization = 1 / Math.sqrt(Math.max(1, this.voices.size + this.tails.size));
    for (const grain of this.toneGrains) if (grain.standalone) target(grain.gate.gain, .9 * this._participantSceneWeight(grain.voice), now, .12);
    for (const voice of this.voices.values()) {
      const participant = voice.participant, shape = participantToneParameters(participant);
      voice.extinguished = participant.extinguished;
      const sceneWeight = this._participantSceneWeight(participant);
      voice.targetGain = TONE_DIRECT_POWER * normalization * (shape.background ? .9 : 1) * sceneWeight;
      voice.partialGains = shape.partialGains;
      target(voice.gain.gain, voice.targetGain, now, .6);
      target(voice.grainGate.gain, (shape.background ? .9 : 1) * sceneWeight, now, .12);
      const mixerGain = this.mixer[shape.background ? 'outDrone' : 'chimes'];
      target(voice.directMixer.gain, mixerGain, now, .06); target(voice.grainMixer.gain, mixerGain, now, .06);
      for (let index = 0; index < voice.partialNodes.length; index++) target(voice.partialNodes[index].gain, shape.partialGains[PARTICIPANT_PARTIALS.indexOf(voice.partials[index])], now, .6);
      this._positionVoice(voice, participant.position);
    }
  }
  _voiceEnvelopeValue(voice, now, grain = false) {
    if (voice.retiredAt != null) return (grain ? voice.grainReleaseFrom : voice.releaseFrom) * Math.cos(Math.min(1, Math.max(0, now - voice.retiredAt) / voice.releaseSeconds) * Math.PI / 2);
    return Math.sin(Math.min(1, Math.max(0, now - voice.startedAt) / (grain ? voice.grainAttackSeconds : voice.attackSeconds)) * Math.PI / 2);
  }
  _retireVoice(voice, fade) {
    if (!voice || !this.context || this.tails.has(voice)) return;
    const now = this.context.currentTime, from = this._voiceEnvelopeValue(voice, now), grainFrom = this._voiceEnvelopeValue(voice, now, true);
    if (typeof voice.envelope.gain.cancelAndHoldAtTime === 'function') holdParameter(voice.envelope.gain, now, from);
    else {
      // Older Safari cannot truncate an in-progress value curve at now.
      // Cancel its start event, then restore the evaluated value at now.
      voice.envelope.gain.cancelScheduledValues(voice.startedAt);
      voice.envelope.gain.setValueAtTime(from, now);
    }
    voice.envelope.gain.setValueCurveAtTime(Float32Array.from(FADE_OUT, value => value * from), now, fade);
    if (typeof voice.grainEnvelope.gain.cancelAndHoldAtTime === 'function') holdParameter(voice.grainEnvelope.gain, now, grainFrom);
    else { voice.grainEnvelope.gain.cancelScheduledValues(voice.startedAt); voice.grainEnvelope.gain.setValueAtTime(grainFrom, now); }
    voice.grainEnvelope.gain.setValueCurveAtTime(Float32Array.from(FADE_OUT, value => value * grainFrom), now, fade);
    voice.targetGain = 0; voice.retiredAt = now; voice.releaseFrom = from; voice.grainReleaseFrom = grainFrom; voice.releaseSeconds = fade; voice.disposeAt = now + fade + .02;
    voice.fundamental.onended = () => this._disposeVoice(voice);
    this.tails.add(voice);
    for (const oscillator of voice.oscillators) stop(oscillator, voice.disposeAt);

  }
  _disposeVoice(voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    this.tails.delete(voice); voice.fundamental.onended = null;
    for (const oscillator of voice.oscillators) stop(oscillator);
    for (const grain of [...this.toneGrains]) if (grain.voice === voice) this._disposeToneGrain(grain);
    for (const node of voice.nodes) disconnect(node);
  }
  _stopSources() {
    this.pendingBlobs = []; this.mainBlob?.stop();
    this.dragAsh?.stop();
    this._stopMainDrone();
    this.patchSoftTones?.stop(); this.phoneRain?.stop(); this.phoneWeather?.stop(); this.localBells?.stop(); this.mainQuench?.stop();
    for (const voice of this.voices.values()) this._disposeVoice(voice);
    this.voices.clear();
    for (const voice of [...this.tails]) this._disposeVoice(voice);
    for (const layer of this.layers.values()) {
      stop(layer.fallbackSource); disconnect(layer.fallbackSource); disconnect(layer.fallbackGain); layer.fallbackSource = null; layer.fallbackGain = null;
      for (const record of [...layer.sources]) this._disposeSampleSource(layer, record);
      layer.sources.clear(); layer.nextAt = 0;
      for (const slot of layer.variationSlots.values()) { slot.nextAt = 0; slot.weight = 0; automation.delete(slot.mixGain.gain); slot.mixGain.gain.value = 0; }
    }
    stop(this.ashSource); disconnect(this.ashSource); this.ashSource = null;
    for (const record of this.grains) { stop(record.source); disconnect(record.source); disconnect(record.filter); disconnect(record.lowpass); disconnect(record.envelope); }
    this.grains.clear(); this.nextGrain = 0;
    for (const record of [...this.toneGrains]) this._disposeToneGrain(record);
    this.toneGrainBuffers.clear(); this.nextToneGrain = 0; this.nextPatchBackgroundGrain = 0;
    for (const space of [...this.retiredToneSpaces]) this._disposeToneSpace(space);
    // Reset the convolution history so re-enabling cannot revive an old round.
    if (this.toneReverb) { const buffer = this.toneReverb.buffer; this.toneReverb.buffer = null; this.toneReverb.buffer = buffer; }
  }
}

export const createWildfireSound = options => new WildfireSound(options);
export default WildfireSound;
