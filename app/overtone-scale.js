// One exact harmonic reference for the map tones and the Main bells.
export const OVERTONE_ROOT_MIDI = 37; // D-flat 2.
export const OVERTONE_ROOT_HZ = 440 * 2 ** ((OVERTONE_ROOT_MIDI - 69) / 12);
export const TONE_HARMONICS = Object.freeze(Array.from({ length: 29 }, (_, index) => index + 2));
export const BELL_HARMONICS = Object.freeze(Array.from({ length: 10 }, (_, index) => index + 2));

export function overtonePitch(harmonic) {
  if (!Number.isInteger(harmonic) || harmonic < 1 || harmonic > 64) throw new RangeError('Harmonic must be an integer from 1 to 64.');
  return Object.freeze({ harmonic, frequency: OVERTONE_ROOT_HZ * harmonic,
    midi: OVERTONE_ROOT_MIDI + 12 * Math.log2(harmonic) });
}
export const OVERTONE_TONE_PITCHES = Object.freeze(TONE_HARMONICS.map(overtonePitch));
export const OVERTONE_BELL_PITCHES = Object.freeze(BELL_HARMONICS.map(overtonePitch));

const unit = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : .5;
const registerTilt = progress => 4 * (1 - 2 * unit(progress));

// Bring the descent into the first half of participation: the distribution
// crosses its midpoint at about 21% out, rather than waiting until 50%.
export const toneRegisterProgress = extinctionProgress => 1 - (1 - unit(extinctionProgress)) ** 3;

// A continuous probability tilt keeps every harmonic available. Early draws
// favour the top of the range; later draws favour its bottom. Half-out is
// uniform. This changes new admissions, never a note already sounding.
export function overtoneRegisterWeights(pitches, extinctionProgress = .5) {
  const tilt = registerTilt(extinctionProgress), denominator = Math.max(1, pitches.length - 1);
  const weights = pitches.map((_, index) => Math.exp(tilt * index / denominator));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return weights.map(weight => weight / sum);
}

export function overtonePitchAtProgress(pitches, sample, extinctionProgress = .5) {
  if (!pitches.length) throw new RangeError('An overtone range is required.');
  const draw = Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0;
  const step = registerTilt(extinctionProgress) / Math.max(1, pitches.length - 1);
  // Invert the geometric cumulative weights without building a new table for
  // each geographic patch in a full-map update.
  const index = Math.abs(step) < 1e-10 ? Math.floor(draw * pitches.length)
    : Math.floor(Math.log1p(draw * Math.expm1(step * pitches.length)) / step);
  return pitches[Math.max(0, Math.min(pitches.length - 1, index))];
}

export function overtonePitchForKey(patch, extinctionProgress = null) {
  let value = 2166136261;
  for (const character of String(patch?.key ?? patch)) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  if (extinctionProgress === null) return OVERTONE_TONE_PITCHES[(value >>> 0) % OVERTONE_TONE_PITCHES.length];
  return overtonePitchAtProgress(OVERTONE_TONE_PITCHES, (value >>> 0) / 4294967296, toneRegisterProgress(extinctionProgress));
}
