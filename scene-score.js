// Shared by the authority, the projection, phones, and the sound engine.
// All times are show-clock times: callers interpolate only while unpaused.
export const FINAL_RAIN_RAMP_MS = 60_000;
export const FOREST_RAIN_STRENGTH_MULTIPLIER = .6;
// Keep real rain delivery and its visual strength on the same scene rule.
export function audienceRainStrength(scene, strength = 0) {
  const value = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  return value * (scene?.id === 'forest-takeover' ? FOREST_RAIN_STRENGTH_MULTIPLIER : 1);
}
export const DEFAULT_SCORE_SETTINGS = Object.freeze({
  arrivalSeconds: 60,
  instructionsSeconds: 60,
  participationSeconds: 600,
  forestTakeoverSeconds: 60,
  soundTransitionSeconds: 12,
  forestRiseSeconds: 30,
  finalRainRiseSeconds: FINAL_RAIN_RAMP_MS / 1000,
  residueMorphSeconds: 8,
  residueFadeSeconds: 20,
  projectionFadeSeconds: 30,
  rainCricketOverlapSeconds: 30,
  paCricketOnlySeconds: 12,
  cricketHandoffSeconds: 12,
  phoneOnlySeconds: 15,
  phoneFadeSeconds: 60,
});
export const SCENE_DURATION_LIMITS = Object.freeze({
  arrivalSeconds: Object.freeze({ min: 1, max: 900 }),
  instructionsSeconds: Object.freeze({ min: 1, max: 900 }),
  participationSeconds: Object.freeze({ min: 1, max: 3600 }),
  forestTakeoverSeconds: Object.freeze({ min: 1, max: 900 }),
  soundTransitionSeconds: Object.freeze({ min: 1, max: 120 }),
  forestRiseSeconds: Object.freeze({ min: 1, max: 180 }),
  finalRainRiseSeconds: Object.freeze({ min: 10, max: 180 }),
  residueMorphSeconds: Object.freeze({ min: 1, max: 180 }),
  residueFadeSeconds: Object.freeze({ min: 1, max: 180 }),
  projectionFadeSeconds: Object.freeze({ min: 1, max: 180 }),
  rainCricketOverlapSeconds: Object.freeze({ min: 1, max: 180 }),
  paCricketOnlySeconds: Object.freeze({ min: 1, max: 120 }),
  cricketHandoffSeconds: Object.freeze({ min: 1, max: 120 }),
  phoneOnlySeconds: Object.freeze({ min: 0, max: 120 }),
  phoneFadeSeconds: Object.freeze({ min: 1, max: 300 }),
});
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const elapsed = value => Number.isFinite(value) ? Math.max(0, value) : 0;

// A shared slow entrance for rain sound, falling drops, and the water budget.
// The extra-flat ends let the forest remain present as sparse rain first arrives.
export function finalRainProgressAt(elapsedMs, durationMs = FINAL_RAIN_RAMP_MS) {
  const t = clamp(elapsed(elapsedMs) / Math.max(1, durationMs));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// The authority cools every remaining fire continuously with rain progress;
// its discrete out flags only change at the end. Prepare the cricket field
// during that final cooling, ready for the rain/cricket overlap that follows.
export function finalCricketProgressAt(rainProgress = 0) {
  return smooth(((Number.isFinite(rainProgress) ? rainProgress : 0) - .75) / .25);
}

export function scoreDurations(settings = {}) {
  const milliseconds = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SCORE_SETTINGS)) {
    const value = settings?.[key], { min, max } = SCENE_DURATION_LIMITS[key];
    milliseconds[key] = (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback) * 1000;
  }
  return { arrivalMs: milliseconds.arrivalSeconds,
    instructionsMs: milliseconds.instructionsSeconds,
    participationMs: milliseconds.participationSeconds,
    forestTakeoverMs: milliseconds.forestTakeoverSeconds,
    soundTransitionMs: milliseconds.soundTransitionSeconds,
    forestRiseMs: milliseconds.forestRiseSeconds,
    finalRainRiseMs: milliseconds.finalRainRiseSeconds,
    residueMorphMs: milliseconds.residueMorphSeconds,
    residueFadeMs: milliseconds.residueFadeSeconds,
    projectionFadeMs: milliseconds.projectionFadeSeconds,
    rainCricketOverlapMs: milliseconds.rainCricketOverlapSeconds,
    paCricketOnlyStartMs: Math.max(milliseconds.projectionFadeSeconds, milliseconds.rainCricketOverlapSeconds),
    paCricketOnlyMs: milliseconds.paCricketOnlySeconds,
    cricketHandoffMs: milliseconds.cricketHandoffSeconds,
    phoneOnlyMs: milliseconds.phoneOnlySeconds,
    phoneFadeMs: milliseconds.phoneFadeSeconds,
    afterglowDurationMs: Math.max(milliseconds.projectionFadeSeconds, milliseconds.rainCricketOverlapSeconds) + milliseconds.paCricketOnlySeconds + milliseconds.cricketHandoffSeconds + milliseconds.phoneOnlySeconds + milliseconds.phoneFadeSeconds };
}

// Match the natural retreat of the cricket field: distance first, with a short
// final tail. This is the phone master, not an additional layer attenuation.
export function phoneRetreatGain(elapsedMs = 0, durationMs = 60_000) {
  const duration = Math.max(1, durationMs), time = elapsed(elapsedMs);
  const travel = smooth(time / duration), tailStart = Math.max(0, duration - 2200);
  const tail = 1 - smooth((time - tailStart) / (duration - tailStart));
  return 1 / (1 + 6.6 * travel) * tail;
}

/** Compute the five-cue score from an authoritative scene and show-clock time.
 * Mix weights exclude role masters: apply mainGain/phoneGain exactly once.
 * Phone crickets follow real fire progress from participation onward; the
 * projection introduces its crickets only in the fifth cue.
 */
export function computeSceneScore(scene = {}, elapsedMs = scene?.elapsedMs) {
  const id = scene?.id ?? 'arrival', time = elapsed(elapsedMs);
  const durations = scoreDurations(scene?.settings);
  const { soundTransitionMs, forestRiseMs, finalRainRiseMs, projectionFadeMs, rainCricketOverlapMs, paCricketOnlyStartMs, paCricketOnlyMs, cricketHandoffMs, phoneOnlyMs, phoneFadeMs, afterglowDurationMs } = durations;
  const transfer = smooth(time / soundTransitionMs);
  const mix = { mainHaze: 0, mainForest: 0, mainRain: 1, mainDrone: 0, mainChimes: 0, mainOutDrone: 0, mainOther: 1,
    phoneField: 0, mainCrickets: 0, phoneCrickets: 0 };
  const score = { cue: 1, phase: 'title', phaseElapsedMs: time, phaseDurationMs: 0,
    afterglowDurationMs, soundTransitionDurationMs: soundTransitionMs, forestRiseDurationMs: forestRiseMs, forestTakeoverProgress: 0, mainFadeDurationMs: rainCricketOverlapMs,
    finalRainProgress: 0, finalCricketProgress: 0, finalRainRampDurationMs: finalRainRiseMs,
    mainAudioDurationMs: paCricketOnlyStartMs + paCricketOnlyMs + cricketHandoffMs,
    phoneRetreatStartMs: paCricketOnlyStartMs + paCricketOnlyMs + cricketHandoffMs + phoneOnlyMs,
    projectionFadeDurationMs: projectionFadeMs, rainCricketOverlapDurationMs: rainCricketOverlapMs, paCricketOnlyStartMs,
    paCricketOnlyDurationMs: paCricketOnlyMs, paCricketEntranceDurationMs: 0, cricketHandoffDurationMs: cricketHandoffMs, phoneOnlyDurationMs: phoneOnlyMs,
    visualGain: 1, projectionGain: 1, mainGain: 1, mainFieldGain: 1, phoneGain: 0, phoneVisualGain: 1,
    phoneRetreatElapsedMs: 0, phoneRetreatDurationMs: phoneFadeMs, mix };
  if (id === 'instructions') {
    Object.assign(score, { cue: 2, phase: 'instructions', phaseDurationMs: soundTransitionMs });
    mix.mainHaze = 1 - transfer; mix.mainForest = transfer;
  } else if (id === 'participation') {
    Object.assign(score, { cue: 3, phase: 'participation', phaseDurationMs: soundTransitionMs, phoneGain: 1 });
    mix.mainForest = 1 - transfer;
    mix.mainHaze = .18 * transfer;
    mix.mainDrone = mix.mainOutDrone = mix.mainChimes = mix.phoneField = mix.phoneCrickets = transfer;
  } else if (id === 'forest-takeover') {
    const progress = smooth(time / forestRiseMs), remainingMain = .08 + .92 * (1 - progress);
    Object.assign(score, { cue: 4, phase: 'forest-rise', phaseDurationMs: forestRiseMs,
      forestTakeoverProgress: progress, phoneGain: 1 });
    mix.mainForest = progress;
    mix.mainRain = 0;
    mix.mainDrone = 1 - progress;
    mix.mainOutDrone = mix.mainChimes = .3 + .7 * (1 - progress);
    mix.mainOther = remainingMain;
    mix.phoneField = mix.phoneCrickets = 1;
  } else if (id === 'final-rain' || id === 'afterglow') {
    Object.assign(score, { cue: 5, phase: 'rain', phoneGain: 1 });
    const rainProgress = id === 'final-rain' ? finalRainProgressAt(time, finalRainRiseMs) : 1;
    score.finalRainProgress = rainProgress;
    score.finalCricketProgress = finalCricketProgressAt(rainProgress);
    // Main crickets arrive as the fully risen rain recedes in afterglow.
    // Phone crickets wait for the later transfer after the dark PA-only hold.
    mix.mainForest = rainProgress === 1 ? 0 : Math.cos(rainProgress * Math.PI / 2);
    mix.mainRain = Math.sin(rainProgress * Math.PI / 2);
    mix.mainOutDrone = mix.mainChimes = .3 + .7 * rainProgress;
    mix.mainOther = .08 + .92 * rainProgress;
    mix.phoneField = id === 'final-rain' ? 1 : 0;
    if (id === 'afterglow') {
      const handoffStart = paCricketOnlyStartMs + paCricketOnlyMs;
      const phoneOnlyStart = handoffStart + cricketHandoffMs;
      const retreatStart = phoneOnlyStart + phoneOnlyMs;
      const fade = 1 - smooth(time / projectionFadeMs);
      const overlap = smooth(time / rainCricketOverlapMs);
      const fieldGain = overlap === 1 ? 0 : Math.cos(overlap * Math.PI / 2);
      Object.assign(score, { visualGain: fade, projectionGain: fade, mainFieldGain: fieldGain, phoneVisualGain: fade });
      mix.mainCrickets = Math.sin(overlap * Math.PI / 2);
      if (time >= rainCricketOverlapMs) {
        for (const key of ['mainHaze', 'mainForest', 'mainRain', 'mainDrone', 'mainChimes', 'mainOutDrone', 'mainOther']) mix[key] = 0;
      }
      if (time < rainCricketOverlapMs) {
        Object.assign(score, { phase: 'rain-cricket-overlap', phaseDurationMs: rainCricketOverlapMs });
      } else if (time < paCricketOnlyStartMs) {
        Object.assign(score, { phase: 'projection-fade', phaseDurationMs: projectionFadeMs });
      } else if (time < handoffStart) {
        Object.assign(score, { phase: 'pa-crickets', phaseElapsedMs: time - paCricketOnlyStartMs, phaseDurationMs: paCricketOnlyMs });
      } else if (time < phoneOnlyStart) {
        // A direct equal-power arc reveals the quieter phone field from the
        // beginning, rather than holding it near zero with another ease-in.
        const progress = clamp((time - handoffStart) / cricketHandoffMs);
        Object.assign(score, { phase: 'cricket-handoff', phaseElapsedMs: time - handoffStart, phaseDurationMs: cricketHandoffMs });
        mix.mainCrickets = Math.cos(progress * Math.PI / 2);
        mix.phoneCrickets = Math.sin(progress * Math.PI / 2);
      } else if (time < retreatStart) {
        Object.assign(score, { phase: 'phone-only', phaseElapsedMs: time - phoneOnlyStart, phaseDurationMs: phoneOnlyMs, mainGain: 0 });
        mix.mainCrickets = 0; mix.phoneCrickets = 1;
      } else if (time < afterglowDurationMs) {
        const retreatElapsed = time - retreatStart;
        Object.assign(score, { phase: 'phone-fade', phaseElapsedMs: retreatElapsed, phaseDurationMs: phoneFadeMs,
          mainGain: 0, phoneRetreatElapsedMs: retreatElapsed, phoneGain: phoneRetreatGain(retreatElapsed, phoneFadeMs) });
        mix.mainCrickets = 0; mix.phoneCrickets = 1;
      } else {
        Object.assign(score, { phase: 'ended', phaseElapsedMs: time - afterglowDurationMs,
          mainGain: 0, phoneGain: 0, phoneRetreatElapsedMs: phoneFadeMs });
        for (const key of Object.keys(mix)) mix[key] = 0;
      }
    }
  } else if (id === 'ended') {
    Object.assign(score, { cue: 5, phase: 'ended', visualGain: 0, projectionGain: 0, mainGain: 0, mainFieldGain: 0,
      phoneGain: 0, phoneVisualGain: 0, phoneRetreatElapsedMs: phoneFadeMs });
    mix.mainOther = 0;
    mix.mainRain = 0;
  } else {
    mix.mainHaze = 1;
  }
  return score;
}

export const computeScore = computeSceneScore;
