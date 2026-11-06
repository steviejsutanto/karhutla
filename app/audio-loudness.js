// Fixed makeup preserves score envelopes and stored trims. Main keeps more
// transient headroom; phones retain their existing gain and protection exactly.
export const OUTPUT_MAKEUP_DB = 12;
export const OUTPUT_MAKEUP_GAIN = 10 ** (OUTPUT_MAKEUP_DB / 20);
export const MAIN_OUTPUT_MAKEUP_DB = 9;
export const MAIN_OUTPUT_MAKEUP_GAIN = 10 ** (MAIN_OUTPUT_MAKEUP_DB / 20);
export const OUTPUT_LIMIT_KNEE = .72;
export const OUTPUT_LIMIT_CEILING = .96;
export const OUTPUT_LIMIT_INPUT_RANGE = 16;
const PHONE_DYNAMICS = Object.freeze({ makeupDb: OUTPUT_MAKEUP_DB, makeupGain: OUTPUT_MAKEUP_GAIN, peakKnee: OUTPUT_LIMIT_KNEE,
  transientMakeupDb: 3, transientKnee: .78, threshold: -1, knee: 1, ratio: 20, attack: .001, release: .08 });
const MAIN_DYNAMICS = Object.freeze({ makeupDb: MAIN_OUTPUT_MAKEUP_DB, makeupGain: MAIN_OUTPUT_MAKEUP_GAIN, peakKnee: .84,
  // A broad knee and moderate ratio manage actual signal energy, rather than
  // the number of phones. No automatic makeup or participant-count gain ride.
  transientMakeupDb: 1.5, transientKnee: .85, threshold: -6, knee: 6, ratio: 2, attack: .02, release: .2 });
export const outputDynamics = mode => mode === 'operator' ? MAIN_DYNAMICS : PHONE_DYNAMICS;
const preparation = new WeakMap();

/** Identity below the knee; a smooth, odd ceiling without a clipped corner. */
export function smoothPeakLimit(value, knee = OUTPUT_LIMIT_KNEE, ceiling = OUTPUT_LIMIT_CEILING) {
  const magnitude = Math.abs(value);
  return magnitude <= knee ? value : Math.sign(value) * (knee + (ceiling - knee) * Math.tanh((magnitude - knee) / (ceiling - knee)));
}

const outputCurves = new Map();
export function outputProtectionCurve(mode = 'phone') {
  // Scaling ahead of this node gives its native [-1, 1] input a +/-16 range.
  // The dense, symmetric curve remains linear at ordinary listening levels.
  const { peakKnee } = outputDynamics(mode);
  if (!outputCurves.has(peakKnee)) outputCurves.set(peakKnee, Float32Array.from({ length: 131073 }, (_, index) => smoothPeakLimit((2 * index / 131072 - 1) * OUTPUT_LIMIT_INPUT_RANGE, peakKnee)));
  return outputCurves.get(peakKnee);
}

export function measureRecording(buffer) {
  let power = 0, count = 0, peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const sample = data[index];
      if (!Number.isFinite(sample)) throw new Error('The recording contains invalid audio samples.');
      peak = Math.max(peak, Math.abs(sample));
      // Every peak is inspected. Strided energy keeps long stereo files cheap.
      if (index % 8 === 0) { power += sample * sample; count++; }
    }
  }
  return { rms: Math.sqrt(power / Math.max(1, count)), peak };
}

export function sampleMakeupGain(rms) {
  return Number.isFinite(rms) && rms > .00001 ? Math.max(.35, Math.min(18, .085 / rms)) : 1;
}

/** Fixed active-note energy keeps a slower insect pulse from gaining makeup
 * merely because it contains longer rests. This is measured once at decode. */
export function measureActiveNoteRms(buffer) {
  const frames = Math.max(1, Math.round((buffer.sampleRate || 32000) * .005));
  const length = buffer.getChannelData(0).length, blocks = [];
  let maximum = 0;
  for (let first = 0; first < length; first += frames) {
    const last = Math.min(length, first + frames);
    let power = 0, count = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = first; index < last; index++) { power += data[index] ** 2; count++; }
    }
    const mean = power / Math.max(1, count); maximum = Math.max(maximum, mean);
    blocks.push({ power, count, mean });
  }
  let power = 0, count = 0;
  for (const block of blocks) if (block.mean >= maximum * .01 && block.mean > 0) {
    power += block.power; count += block.count;
  }
  return Math.sqrt(power / Math.max(1, count));
}

/** A one-time, local crest reduction cannot duck another layer or pump rain. */
export function prepareRecording(buffer, { naturalRain = false, mode = 'phone', phoneCrickets = false } = {}) {
  const before = measureRecording(buffer);
  const activeNoteRms = phoneCrickets && mode === 'phone' && !naturalRain ? measureActiveNoteRms(buffer) : null;
  const target = sampleMakeupGain(activeNoteRms ?? before.rms);
  const previousGain = Math.min(target, before.peak > 0 ? .95 / before.peak : 1);
  const { transientMakeupDb, transientKnee } = outputDynamics(mode);
  // Only peak-constrained files need crest treatment. Main retains more of
  // their original transients, while its louder fixed output is preserved.
  const gain = naturalRain ? previousGain : Math.min(target, previousGain * 10 ** (transientMakeupDb / 20));
  const conditioned = !naturalRain && gain > previousGain * 1.000001;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      const value = data[index] * gain;
      data[index] = conditioned ? smoothPeakLimit(value, transientKnee, .95) : value;
    }
  }
  const after = measureRecording(buffer);
  preparation.set(buffer, { before, after, gain, previousGain, transientConditioned: conditioned, naturalRain,
    ...(activeNoteRms !== null ? { activeNoteRms, preparedActiveNoteRms: measureActiveNoteRms(buffer), phoneCrickets: true } : {}) });
  return buffer;
}

export const recordingPreparation = buffer => preparation.get(buffer) ?? null;
export function copyRecordingPreparation(from, to) {
  const info = preparation.get(from);
  if (info) preparation.set(to, { ...info, after: measureRecording(to) });
  return to;
}
