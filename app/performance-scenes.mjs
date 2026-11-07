import { computeSceneScore, DEFAULT_SCORE_SETTINGS, SCENE_DURATION_LIMITS, scoreDurations, finalRainProgressAt, FINAL_RAIN_RAMP_MS } from './scene-score.js';
import { DEFAULT_PROGRAM_NOTES } from './performance-view.js';
import { PHONE_MIXER_DEFAULTS, phoneMixerPatch } from './phone-mixer.mjs';

export const AFTERGLOW_DURATION_MS = scoreDurations().afterglowDurationMs;
export { FINAL_RAIN_RAMP_MS };
// Compatibility export for the default. Custom finales use the rain/cricket
// overlap duration, independently of how long the projection takes to fade.
export const FINAL_RAIN_RELEASE_MS = scoreDurations().rainCricketOverlapMs;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const CLOCK_EPSILON_MS = 0.000001;
// Integral of the same smootherstep envelope used in the public scene state.
// Its units are milliseconds of full rain, independent of update frequency.
export function finalRainIntegral(elapsedMs, durationMs = FINAL_RAIN_RAMP_MS) {
  const duration = Math.max(1, durationMs), elapsed = Math.max(0, elapsedMs), t = clamp(elapsed / duration);
  return duration * (t ** 6 - 3 * t ** 5 + 2.5 * t ** 4) + Math.max(0, elapsed - duration);
}
export const SCENE_IDS = Object.freeze(['arrival', 'instructions', 'participation', 'forest-takeover', 'final-rain', 'afterglow', 'ended']);
const LABELS = Object.freeze({ arrival: 'Arrival', instructions: 'Instructions', participation: 'Participation', 'forest-takeover': 'Forest takeover', 'final-rain': 'Final rain', afterglow: 'Afterglow', ended: 'Ended' });
export const DEFAULT_SCENE_SETTINGS = Object.freeze({
  wifiName: '', wifiPassword: '',
  programNotes: DEFAULT_PROGRAM_NOTES,
  ...DEFAULT_SCORE_SETTINGS,
});
export const DEFAULT_SOUND_SETTINGS = Object.freeze({ automation: true, macros: Object.freeze({ haze: .35, forest: .5, ash: .25, rain: .15, moisture: .2 }), mixer: Object.freeze({ haze: 1, forest: 1, ash: 1, rain: 1, moisture: 1, crickets: 1, orangutan: 1, orangutanTail: 1, chimes: 1, outDrone: 1, lowDrone: 1, bells: 1.6, quench: 1, blob: 1, dragAsh: 1 }), phoneMixer: PHONE_MIXER_DEFAULTS, level: .55, localPitchIndex: null });
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const object = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function sceneSettingsPatch(settings, patch) {
  if (!only(patch, Object.keys(DEFAULT_SCENE_SETTINGS))) throw error('Unknown scene setting.');
  const limits = { wifiName: 64, wifiPassword: 128, programNotes: 12000 };
  for (const [key, value] of Object.entries(patch)) {
    if (SCENE_DURATION_LIMITS[key]) {
      const { min, max } = SCENE_DURATION_LIMITS[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw error(`Invalid ${key}: choose between ${min} and ${max} seconds.`);
    } else if (typeof value !== 'string' || value.length > limits[key] || value.includes('\0')) throw error(`Invalid ${key}.`);
  }
  return { ...settings, ...patch };
}

const LEGACY_PROGRAM_NOTES = new Set([
  'Below the ash is a participatory sound and image performance about shared attention, rain, and the heat held beneath a landscape.\n\nSatellite fire locations become a changing field of peat and embers. Together, our rain cools the ground; the sounds of fire give way to insects, then recede into silence.',
  'A shared landscape of fire, rain, and listening.\n\nTouch and hold the landscape to bring rain. Move slowly while holding. Together, sustained attention cools the ground beneath the flames.\n\nTurn Sound on and adjust your phone’s media volume to a comfortable listening level. Keep this page open and listen as the landscape changes. Your phone joins the room with its own voice.',
  'A shared landscape of fire, rain, and listening.\n\nTouch and hold the landscape to bring rain. Move slowly while holding. Together, sustained attention cools the ground beneath the flames.\n\nTurn on sound, keep this page open, and listen as the landscape changes. Your phone joins the room with its own voice.',
]);

// Only exact built-in defaults migrate. User-authored programme text survives.
export function restoreSceneSettings(settings, saved) {
  const restored = sceneSettingsPatch(settings, saved);
  if (LEGACY_PROGRAM_NOTES.has(restored.programNotes)) restored.programNotes = DEFAULT_SCENE_SETTINGS.programNotes;
  return restored;
}

export function soundSettingsPatch(settings, patch) {
  if (!only(patch, ['automation', 'macros', 'mixer', 'phoneMixer', 'level', 'localPitchIndex'])) throw error('Unknown sound setting.');
  if (patch.automation !== undefined && typeof patch.automation !== 'boolean') throw error('Sound automation must be on or off.');
  if (patch.level !== undefined && !unit(patch.level)) throw error('Sound level must be between zero and one.');
  if (patch.localPitchIndex !== undefined && patch.localPitchIndex !== null && (!Number.isSafeInteger(patch.localPitchIndex) || patch.localPitchIndex < 0 || patch.localPitchIndex > 34)) throw error('Choose a pitch between zero and thirty-four.');
  if (patch.macros !== undefined && (!only(patch.macros, Object.keys(DEFAULT_SOUND_SETTINGS.macros)) || !Object.values(patch.macros).every(unit))) throw error('Sound macros must be between zero and one.');
  if (patch.mixer !== undefined && (!only(patch.mixer, Object.keys(DEFAULT_SOUND_SETTINGS.mixer)) || !Object.values(patch.mixer).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2))) throw error('Sound mixer levels must be between zero and two.');
  // Main speaker balances remain independent of the scene's automated macros.
  // Older saves receive unity for mixer channels they predate.
  return { ...settings, ...patch, automation: patch.automation ?? (patch.macros ? false : settings.automation), macros: { ...settings.macros, ...patch.macros }, mixer: { ...DEFAULT_SOUND_SETTINGS.mixer, ...settings.mixer, ...patch.mixer }, phoneMixer: phoneMixerPatch(settings.phoneMixer, patch.phoneMixer) };
}

// The show clock is intentionally ephemeral. Restoring the fire simulation
// never resumes a finale or opens a performance while the operator is away.
export class PerformanceScenes {
  constructor({ now = 0, wallNow = Date.now(), settings = {} } = {}) {
    this.id = 'arrival'; this.paused = true; this.elapsed = 0; this.anchor = now;
    this.startedAt = wallNow; this.allOutAt = null; this.revision = 0;
    this.rainReleaseIntensity = 0;
    this.pendingFinalRain = false;
    this.participationOpening = false;
    this.settings = sceneSettingsPatch(DEFAULT_SCENE_SETTINGS, settings);
  }
  elapsedAt(now) { return this.elapsed + (this.paused ? 0 : Math.max(0, now - this.anchor)); }
  rainIntensityAt(now) {
    const elapsed = this.elapsedAt(now);
    if (this.id === 'final-rain') return finalRainProgressAt(elapsed, scoreDurations(this.settings).finalRainRiseMs);
    if (this.id === 'afterglow') return this.rainReleaseIntensity * computeSceneScore({ id: 'afterglow', elapsedMs: elapsed, settings: this.settings }).mainFieldGain;
    return 0;
  }
  rainfallBetween(from, to) {
    if (this.id !== 'final-rain' || this.paused || to <= from) return 0;
    const duration = scoreDurations(this.settings).finalRainRiseMs;
    return finalRainIntegral(this.elapsedAt(to), duration) - finalRainIntegral(this.elapsedAt(from), duration);
  }
  enter(id, now, wallNow, paused = false) {
    this.rainReleaseIntensity = id === 'afterglow' ? this.rainIntensityAt(now) : 0;
    this.participationOpening = id === 'participation' && ['arrival', 'instructions'].includes(this.id);
    this.id = id; this.paused = paused; this.elapsed = 0; this.anchor = now; this.startedAt = wallNow;
    this.pendingFinalRain = false;
    if (id === 'afterglow') this.allOutAt = wallNow;
    else if (id !== 'ended') this.allOutAt = null;
    this.revision++;
  }
  update(body, { now, wallNow, sourceCount, outCount }) {
    if (!only(body, ['scene', 'action', 'settings']) || (body.scene !== undefined && body.action !== undefined)) throw error('Choose a scene or a scene action.');
    const settings = body.settings === undefined ? this.settings : sceneSettingsPatch(this.settings, body.settings);
    if (body.scene !== undefined && !SCENE_IDS.includes(body.scene)) throw error('Unknown performance scene.');
    if (body.action !== undefined && !['pause', 'resume', 'restart', 'finish'].includes(body.action)) throw error('Unknown scene action.');
    // An empty snapshot still completes the full rain cue. It cannot skip
    // directly from an uninitialized opening into the ending.
    const emptyFinalRain = this.id === 'final-rain' && sourceCount === 0 && outCount === 0;
    if (body.scene === 'afterglow' && !(sourceCount > 0 && outCount === sourceCount) && !emptyFinalRain) throw error('Afterglow begins only after every source fire is out.', 409);
    if (body.scene === 'afterglow' && this.id === 'final-rain' && this.elapsedAt(now) < scoreDurations(settings).finalRainRiseMs - CLOCK_EPSILON_MS) throw error('Afterglow begins only after the final rain has fully risen.', 409);
    if (body.scene !== undefined) this.enter(body.scene, now, wallNow);
    else if (body.action === 'restart') this.enter('arrival', now, wallNow, true);
    else if (body.action === 'finish') this.enter('ended', now, wallNow);
    else if (body.action === 'pause' && !this.paused) { this.elapsed = this.elapsedAt(now); this.anchor = now; this.paused = true; this.revision++; }
    else if (body.action === 'resume' && this.paused) { this.anchor = now; this.paused = false; this.revision++; }
    if (body.settings !== undefined) { this.settings = settings; this.revision++; }
    return this.state(now, wallNow);
  }
  timedScene() {
    const durations = scoreDurations(this.settings);
    return ({ arrival: [durations.arrivalMs, 'instructions'], instructions: [durations.instructionsMs, 'participation'],
      participation: [durations.participationMs, 'forest-takeover'],
      'forest-takeover': [Math.max(durations.forestTakeoverMs, durations.forestRiseMs), 'final-rain'] })[this.id] ?? null;
  }
  nextBoundaryAt(now) {
    const timed = this.timedScene(), durations = scoreDurations(this.settings);
    const duration = timed?.[0] ?? (this.id === 'final-rain' ? durations.finalRainRiseMs : this.id === 'afterglow' ? durations.afterglowDurationMs : null);
    if (this.paused || duration === null) return null;
    const remaining = duration - this.elapsedAt(now);
    return remaining > CLOCK_EPSILON_MS ? now + remaining : null;
  }
  advance({ now, wallNow, sourceCount, outCount }) {
    if (this.paused) return;
    // Carry elapsed overrun into each following cue. A sleeping browser or a
    // late authority tick cannot lengthen the show or skip the next countdown.
    for (let transitions = 0; transitions < SCENE_IDS.length; transitions++) {
      const timed = this.timedScene();
      if (!timed || this.elapsedAt(now) < timed[0] - CLOCK_EPSILON_MS) break;
      const overrun = Math.max(0, this.elapsedAt(now) - timed[0]);
      this.enter(timed[1], now - overrun, wallNow - overrun);
    }
    const durations = scoreDurations(this.settings);
    if (this.id === 'final-rain' && this.elapsedAt(now) >= durations.finalRainRiseMs - CLOCK_EPSILON_MS && sourceCount >= 0 && outCount === sourceCount) {
      const overrun = Math.max(0, this.elapsedAt(now) - durations.finalRainRiseMs);
      this.enter('afterglow', now - overrun, wallNow - overrun);
    }
    if (this.id === 'afterglow' && this.elapsedAt(now) >= durations.afterglowDurationMs - CLOCK_EPSILON_MS) {
      const overrun = Math.max(0, this.elapsedAt(now) - durations.afterglowDurationMs);
      this.enter('ended', now - overrun, wallNow - overrun);
    }
  }
  state(now, wallNow) {
    const elapsedMs = this.elapsedAt(now);
    const score = computeSceneScore({ id: this.id, elapsedMs, settings: this.settings });
    const timed = this.timedScene();
    const forestComplete = this.id === 'forest-takeover' && elapsedMs >= score.forestRiseDurationMs - CLOCK_EPSILON_MS;
    return { id: this.id, label: LABELS[this.id], paused: this.paused, startedAt: this.startedAt, serverNow: wallNow,
      elapsedMs, ...score, participationOpening: this.participationOpening, fade: score.visualGain,
      autoAdvance: true, nextScene: timed?.[1] ?? null,
      autoAdvanceDurationMs: timed?.[0] ?? 0, autoAdvanceRemainingMs: timed ? Math.max(0, timed[0] - elapsedMs) : 0,
      pendingFinalRain: this.pendingFinalRain,
      forestRestorationProgress: forestComplete ? 1 : this.id === 'forest-takeover' ? score.forestTakeoverProgress : 0,
      forestRestorationComplete: forestComplete,
      forestRestorationRemainingMs: this.id === 'forest-takeover' && !forestComplete ? Math.max(0, score.forestRiseDurationMs - elapsedMs) : 0,
      rainIntensity: this.rainIntensityAt(now),
      globalRain: this.id === 'final-rain' && !this.paused, audienceEnabled: ['participation', 'forest-takeover'].includes(this.id) && !this.paused,
      allOutAt: this.allOutAt, revision: this.revision, settings: { ...this.settings } };
  }
}
