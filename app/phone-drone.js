// The Main chord travels to phones as a softly driven, band-limited voice.
// Six native oscillators, one static shaper, no worklet or per-sample JS.
const disconnect = node => { try { node?.disconnect(); } catch {} };
export const PHONE_DRONE_PITCH_SEMITONES = 16;
export const PHONE_DRONE_PITCH_RATIO = 2 ** (PHONE_DRONE_PITCH_SEMITONES / 12);
export const PHONE_DRONE_TRANSPOSITION_OFFSETS = Object.freeze([0, 3, 8, 12]);
export function phoneDroneTransposition(sample) {
  const unit = Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0;
  return PHONE_DRONE_TRANSPOSITION_OFFSETS[Math.floor(unit * PHONE_DRONE_TRANSPOSITION_OFFSETS.length)];
}
export const PHONE_DRONE_GAIN_TRIM = 10 ** (3 / 20);
export const PHONE_DRONE_MOVING_BANK_WEIGHT = .38;
export const PHONE_DRONE_BEAT_OFFSET_HZ = 1.4;
export const PHONE_DRONE_BEAT_SPREAD_HZ = .3;
export const PHONE_DRONE_HARMONICS = Object.freeze([0, 1, .18, .10, .04]);
export const phoneDroneFrequency = (frequencies, index, transpositionSemitones = 0) => Math.max(20,
  frequencies[index] * PHONE_DRONE_PITCH_RATIO * 2 ** (transpositionSemitones / 12) - (index < 3 ? 0 : PHONE_DRONE_BEAT_OFFSET_HZ + PHONE_DRONE_BEAT_SPREAD_HZ * (index - 3)));
export function phoneDroneWeight(scene, score) {
  if (scene?.id === 'forest-takeover') return score?.forestTakeoverProgress ?? 0;
  if (scene?.id === 'final-rain') return 1 - (score?.finalRainProgress ?? 0);
  return 0;
}
export class PhoneDroneAudio {
  constructor({ context, destination, random = Math.random }) {
    this.context = context; this.destination = destination; this.voice = null; this.retiring = new Set(); this.wave = null;
    // Choose once for this phone controller. Cues, mute and source retirement
    // never draw another register or turn the whole phone ensemble in unison.
    this.transpositionSemitones = phoneDroneTransposition(random());
  }
  update({ active, weight = 0, frequencies = [], amplitudes = [] }) {
    if (!active || weight <= 0) { this.stop(); return; }
    const c = this.context, now = c.currentTime;
    if (!this.voice) {
      const drive = c.createWaveShaper(), highpass = c.createBiquadFilter(), lowpass = c.createBiquadFilter(), gain = c.createGain();
      drive.curve = Float32Array.from({ length: 513 }, (_, i) => Math.tanh(2.8 * (2 * i / 512 - 1)) / Math.tanh(2.8));
      drive.oversample = 'none';
      highpass.type = 'highpass'; highpass.frequency.value = 150; highpass.Q.value = .35;
      lowpass.type = 'lowpass'; lowpass.frequency.value = 3500; lowpass.Q.value = .35;
      gain.gain.value = 0;
      drive.connect(highpass); highpass.connect(lowpass); lowpass.connect(gain); gain.connect(this.destination);
      const oscillators = [], partials = [];
      // One shared native wavetable adds phone-speaker harmonics without an
      // extra oscillator bank or a louder output trim. Default normalization
      // bounds the new waveform's peak just like the original sine.
      if (!this.wave && c.createPeriodicWave) this.wave = c.createPeriodicWave(
        new Float32Array(PHONE_DRONE_HARMONICS.length), Float32Array.from(PHONE_DRONE_HARMONICS));
      for (const [index, frequency] of frequencies.entries()) {
        const oscillator = c.createOscillator(), partial = c.createGain();
        oscillator.type = 'sine';
        if (this.wave && oscillator.setPeriodicWave) oscillator.setPeriodicWave(this.wave);
        oscillator.frequency.value = phoneDroneFrequency(frequencies, index, this.transpositionSemitones);
        // A stronger moving bank deepens beating. Its small fixed offsets
        // keep a clear slow pulse even where the Main banks reach unison.
        partial.gain.value = (amplitudes[index % 3] ?? .3) * (index < 3 ? 1 - PHONE_DRONE_MOVING_BANK_WEIGHT : PHONE_DRONE_MOVING_BANK_WEIGHT);
        oscillator.connect(partial); partial.connect(drive); oscillator.start(now + .02);
        oscillators.push(oscillator); partials.push(partial);
      }
      this.voice = { oscillators, partials, drive, highpass, lowpass, gain };
    }
    this.voice.gain.gain.setTargetAtTime(.032 * PHONE_DRONE_GAIN_TRIM * weight, now, .18);
    for (const [index, oscillator] of this.voice.oscillators.entries()) oscillator.frequency.setTargetAtTime(phoneDroneFrequency(frequencies, index, this.transpositionSemitones), now, 4);
  }
  stop() {
    if (!this.voice) return;
    // Retire outside the audio graph after a short native fade. No nodes
    // continue running after the transfer has finished or sound is disabled.
    const voice = this.voice, at = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setTargetAtTime(0, at, .025);
    for (const oscillator of voice.oscillators) { try { oscillator.stop(at + .18); } catch {} }
    voice.oscillators[0].onended = () => this._disposeVoice(voice);
    this.retiring.add(voice);
    // A suspended context does not deliver onended until it resumes. Keep at
    // most one short outgoing bank even through rapid mute/scene toggles.
    while (this.retiring.size > 1) this._disposeVoice(this.retiring.values().next().value);
    this.voice = null;
  }
  _disposeVoice(voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const oscillator of voice.oscillators) { try { oscillator.stop(); } catch {} }
    for (const node of [...voice.oscillators, ...voice.partials, voice.drive, voice.highpass, voice.lowpass, voice.gain]) disconnect(node);
    this.retiring.delete(voice);
  }
  destroy() { this.stop(); for (const voice of this.retiring) this._disposeVoice(voice); }
  getMetrics() { return { oscillatorCount: this.voice?.oscillators.length ?? 0, retiringOscillatorCount: [...this.retiring].reduce((sum, voice) => sum + voice.oscillators.length, 0), pitchSemitones: PHONE_DRONE_PITCH_SEMITONES + this.transpositionSemitones, basePitchSemitones: PHONE_DRONE_PITCH_SEMITONES, transpositionSemitones: this.transpositionSemitones, trimDb: 3, movingBankWeight: PHONE_DRONE_MOVING_BANK_WEIGHT, beatOffsetHz: PHONE_DRONE_BEAT_OFFSET_HZ, beatSpreadHz: PHONE_DRONE_BEAT_SPREAD_HZ, upperHarmonics: PHONE_DRONE_HARMONICS.slice(2), staticDrive: 2.8, distortion: 'static soft drive', oversample: 'none' }; }
}
