import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSceneScore, computeScore, phoneRetreatGain, scoreDurations, finalRainProgressAt, finalCricketProgressAt, participationVisualProgress, PARTICIPATION_DRONE_HOLD_MS, FINAL_RAIN_RAMP_MS } from '../app/scene-score.js';

test('participation defaults to ten minutes while a saved custom duration remains valid', () => {
  assert.equal(scoreDurations().participationMs, 600000);
  assert.equal(scoreDurations({ participationSeconds: 300 }).participationMs, 300000);
  assert.equal(scoreDurations({ participationSeconds: 0 }).participationMs, 600000);
  assert.equal(scoreDurations().forestTakeoverMs, 60000);
});

test('phones enter throughout the PA handoff without a second slow ease-in', () => {
  const start = 42000, duration = 12000;
  for (const progress of [0, .0625, .125, .25, .5, .75, 1]) {
    const score = computeSceneScore({ id: 'afterglow', elapsedMs: start + duration * progress });
    assert.ok(Math.abs(score.mix.phoneCrickets - Math.sin(progress * Math.PI / 2)) < 1e-12);
    assert.ok(Math.abs(score.mix.mainCrickets - Math.cos(progress * Math.PI / 2)) < 1e-12);
  }
  assert.ok(computeSceneScore({ id: 'afterglow', elapsedMs: start + 1000 }).mix.phoneCrickets > .13);
});

test('participation retains the original gradual haze and phone field while its opening drone settles first', () => {
  for (const elapsedMs of [0, 1000, 6000, 12000, 60000]) {
    const score = computeSceneScore({ id: 'participation', elapsedMs });
    assert.equal(score.mix.mainHaze, .18 * score.mix.phoneField);
  }
  assert.equal(computeSceneScore({ id: 'participation', elapsedMs: 12000 }).mix.mainHaze, .18);
});

test('the opening Main drone reaches full level and holds for 4.8 seconds before the landscape reveal', () => {
  assert.equal(PARTICIPATION_DRONE_HOLD_MS, 4800);
  for (const soundTransitionSeconds of [1, 12, 75]) for (const participationOpening of [undefined, true]) {
    const scene = { id: 'participation', participationOpening, settings: { soundTransitionSeconds } };
    const rise = soundTransitionSeconds * 1000 * .4, revealStart = rise + 4800, finish = revealStart + rise;
    const at = time => computeSceneScore(scene, time);
    const visual = time => participationVisualProgress(scene, time);
    assert.equal(at(0).mix.mainDrone, 0); assert.equal(visual(0), 0);
    assert.ok(Math.abs(at(rise / 2).mix.mainDrone - .5) < 1e-12);
    for (const time of [rise, rise + 2400, revealStart - .001, revealStart]) {
      assert.equal(at(time).mix.mainDrone, 1); assert.equal(visual(time), 0);
    }
    assert.ok(visual(revealStart + .001) > 0, 'The reveal follows the full fixed hold even with a custom sound transition.');
    assert.equal(at(revealStart + rise / 2).mix.mainDrone, 1);
    assert.ok(Math.abs(visual(revealStart + rise / 2) - .5) < 1e-12);
    assert.equal(visual(finish), 1); assert.equal(visual(finish * 2), 1);
    let previous = 0;
    for (let step = 0; step <= 100; step++) {
      const time = finish * step / 100, value = visual(time);
      assert.ok(value >= previous && value <= 1);
      if (value > 0) assert.equal(at(time).mix.mainDrone, 1, 'The map cannot appear before the Main drone is fully established.');
      previous = value;
    }
    assert.equal(Object.hasOwn(at(rise), 'participationVisualProgress'), false, 'Visual timing adds no field to shared scene packets.');
  }
});

test('the separated opening retains existing other audio ramps and authoritative reentries', () => {
  for (const elapsedMs of [0, 1000, 4800, 6000, 7200, 9600, 12000, 60000]) {
    const opening = { id: 'participation', participationOpening: true, elapsedMs };
    const returning = { ...opening, participationOpening: false };
    const first = computeSceneScore(opening), repeat = computeSceneScore(returning);
    for (const key of Object.keys(first.mix).filter(key => key !== 'mainDrone')) assert.equal(first.mix[key], repeat.mix[key]);
    assert.equal(participationVisualProgress(returning), 1, 'A restarted or reverse-cued Participation never restores the instructions.');
    assert.equal(repeat.mix.mainDrone, repeat.mix.phoneField, 'Reentries retain their established gradual audio transfer.');
  }
  const paused = { id: 'participation', participationOpening: true, elapsedMs: 6000, paused: true };
  assert.equal(participationVisualProgress(paused), 0);
  assert.equal(participationVisualProgress({ ...paused, serverNow: Date.now() + 60000 }), 0);
  assert.equal(participationVisualProgress(paused, 12000), participationVisualProgress({ ...paused, elapsedMs: 12000 }));
});

test('the five cues open phone sound at participation and reserve main crickets for the finale', () => {
  assert.equal(computeSceneScore, computeScore);
  const arrival = computeScore({ id: 'arrival', elapsedMs: 999999 });
  assert.equal(arrival.cue, 1); assert.equal(arrival.phase, 'title');
  assert.equal(arrival.mix.mainHaze, 1); assert.equal(arrival.phoneGain, 0);
  for (const id of ['instructions', 'participation']) for (const time of [0, 6000, 12000, 60000]) {
    const score = computeScore({ id, elapsedMs: time });
    assert.equal(score.mix.mainCrickets, 0);
    if (id === 'instructions') { assert.equal(score.phoneGain, 0); assert.equal(score.mix.phoneCrickets, 0); }
    else assert.equal(score.mix.phoneCrickets, score.mix.phoneField);
  }
  const instructions = computeScore({ id: 'instructions', elapsedMs: 6000 });
  assert.equal(instructions.mix.mainHaze, .5); assert.equal(instructions.mix.mainForest, .5);
  const participation = computeScore({ id: 'participation' }, 6000);
  assert.equal(participation.mix.mainForest, .5); assert.equal(participation.mix.mainDrone, 1);
  assert.equal(participation.mix.mainChimes, .5); assert.equal(participation.mix.phoneField, .5);
  const rain = computeScore({ id: 'final-rain', elapsedMs: 9000 });
  assert.equal(rain.cue, 5); assert.equal(rain.phase, 'rain');
  assert.equal(rain.mix.mainCrickets, rain.finalCricketProgress); assert.equal(rain.mix.mainCrickets, 0);
  assert.equal(rain.mix.phoneCrickets, 0);
  assert.ok(rain.mix.mainChimes > .08 && rain.mix.mainChimes < 1);
});

test('ending overlaps rain and PA crickets for thirty seconds, holds in darkness, then transfers and retreats on phones', () => {
  const at = time => computeScore({ id: 'afterglow', elapsedMs: time });
  assert.equal(at(0).afterglowDurationMs, 129000);
  assert.equal(at(0).mainAudioDurationMs, 54000); assert.equal(at(0).phoneRetreatStartMs, 69000);
  assert.equal(at(0).rainCricketOverlapDurationMs, 30000); assert.equal(at(0).paCricketOnlyStartMs, 30000);
  assert.equal(at(15000).phase, 'rain-cricket-overlap');
  assert.ok(Math.abs(at(15000).mainFieldGain - Math.SQRT1_2) < 1e-12); assert.equal(at(15000).mainGain, 1);
  assert.ok(Math.abs(at(15000).mix.mainCrickets - Math.SQRT1_2) < 1e-12); assert.equal(at(15000).mix.phoneCrickets, 0);
  assert.equal(at(30000).phase, 'pa-crickets'); assert.equal(at(30000).mix.mainCrickets, 1);
  assert.equal(at(30000).paCricketEntranceDurationMs, 0);
  for (let time = 0; time <= 30000; time += 100) {
    const score = at(time);
    assert.ok(Math.abs(score.mainFieldGain ** 2 + score.mix.mainCrickets ** 2 - 1) < 1e-12);
    assert.equal(score.mix.phoneCrickets, 0); assert.equal(score.mainGain, 1);
  }
  assert.equal(at(41999).mix.mainCrickets, 1); assert.equal(at(41999).mix.phoneCrickets, 0);
  assert.equal(at(42000).phase, 'cricket-handoff');
  for (let time = 42000; time < 54000; time += 100) {
    const score = at(time);
    assert.ok(Math.abs(score.mix.mainCrickets ** 2 + score.mix.phoneCrickets ** 2 - 1) < 1e-12);
    assert.equal(score.mainGain, 1);
  }
  for (const time of [30000, 32000, 42000, 53999, 54000, 68999, 69000, 99000, 128999, 129000]) {
    const score = at(time);
    for (const key of ['visualGain', 'projectionGain', 'phoneVisualGain', 'mainFieldGain']) assert.equal(score[key], 0);
    for (const key of ['mainForest', 'mainRain', 'mainDrone', 'mainChimes', 'mainOutDrone', 'mainOther', 'phoneField']) assert.equal(score.mix[key], 0);
  }
  assert.equal(at(54000).phase, 'phone-only'); assert.equal(at(54000).mainGain, 0);
  assert.equal(at(54000).mix.phoneCrickets, 1); assert.equal(at(68999).phoneGain, 1);
  assert.equal(at(69000).phase, 'phone-fade'); assert.equal(at(69000).phoneRetreatElapsedMs, 0);
  assert.equal(at(99000).phoneGain, 1 / 4.3);
  const gains = Array.from({ length: 601 }, (_, index) => at(69000 + index * 100).phoneGain);
  assert.ok(gains.every((value, index) => !index || value <= gains[index - 1]));
  assert.equal(gains.at(-1), 0); assert.equal(at(129000).phase, 'ended');
  assert.equal(at(129000).phoneRetreatElapsedMs, 60000);
  assert.ok(Object.values(at(129000).mix).every(value => value === 0));
  assert.equal(at(126800).phoneGain, phoneRetreatGain(57800, 60000));
  for (const boundary of [30000, 42000, 54000, 69000, 129000]) {
    const before = at(boundary - .001), after = at(boundary);
    for (const [key, gain] of [['mainCrickets', 'mainGain'], ['phoneCrickets', 'phoneGain']]) assert.ok(Math.abs(before.mix[key] * before[gain] - after.mix[key] * after[gain]) < 1e-6, `${key} remains continuous at ${boundary}`);
  }
});

test('score honors configured durations, explicit interpolation, and exact zero-length phone hold', () => {
  const settings = { soundTransitionSeconds: 8, projectionFadeSeconds: 4, rainCricketOverlapSeconds: 4, paCricketOnlySeconds: 2, cricketHandoffSeconds: 3, phoneOnlySeconds: 0, phoneFadeSeconds: 10 };
  assert.equal(computeScore({ id: 'instructions', settings }, 4000).mix.mainForest, .5);
  const at = time => computeScore({ id: 'afterglow', settings, elapsedMs: 0 }, time);
  assert.equal(at(0).afterglowDurationMs, 19000);
  assert.equal(at(3999).phase, 'rain-cricket-overlap'); assert.equal(at(4000).phase, 'pa-crickets');
  assert.equal(at(6000).phase, 'cricket-handoff');
  assert.equal(at(9000).phase, 'phone-fade'); assert.equal(at(9000).phoneGain, 1);
  assert.equal(at(19000).phase, 'ended');
  assert.equal(computeScore({ id: 'ended', settings }).phoneRetreatElapsedMs, 10000);
  assert.equal(scoreDurations({ projectionFadeSeconds: Infinity }).projectionFadeMs, 30000);
});

test('forest takeover rises smoothly to full forest while the drone fades completely out', () => {
  const at = elapsedMs => computeScore({ id: 'forest-takeover', elapsedMs });
  const start = at(0), middle = at(15000), end = at(30000);
  assert.equal(start.cue, 4); assert.equal(start.phase, 'forest-rise');
  assert.equal(start.phaseDurationMs, 30000); assert.equal(start.forestRiseDurationMs, 30000);
  assert.equal(start.mix.mainForest, 0); assert.equal(middle.mix.mainForest, .5);
  assert.equal(end.mix.mainForest, 1); assert.equal(end.forestTakeoverProgress, 1);
  assert.equal(start.mix.mainDrone, 1); assert.equal(middle.mix.mainDrone, .5); assert.equal(end.mix.mainDrone, 0);
  for (const [key, floor] of [['mainChimes', .3], ['mainOutDrone', .3], ['mainOther', .08]]) {
    assert.equal(start.mix[key], 1); assert.ok(Math.abs(middle.mix[key] - (1 + floor) / 2) < 1e-10);
    assert.ok(Math.abs(end.mix[key] - floor) < 1e-10);
  }
  for (const score of [start, middle, end, at(120000)]) {
    assert.equal(score.mainGain, 1); assert.equal(score.phoneGain, 1);
    assert.equal(score.mix.phoneField, 1); assert.equal(score.mix.phoneCrickets, 1);
    assert.equal(score.mix.mainCrickets, 0); assert.equal(score.visualGain, 1);
  }
  const samples = Array.from({ length: 61 }, (_, i) => at(i * 500).forestTakeoverProgress);
  assert.ok(samples.every((value, index) => !index || value > samples[index - 1]));
  assert.deepEqual(at(120000).mix, end.mix, 'Full forest waits for the operator’s fifth cue.');
  assert.equal(computeScore({ id: 'forest-takeover', settings: { forestRiseSeconds: 60 } }, 30000).forestTakeoverProgress, .5);
  for (const id of ['final-rain', 'afterglow', 'ended']) assert.equal(computeScore({ id }).cue, 5);
});

test('forest rise and after-extinction texture timings share bounded settings without changing the ending', () => {
  const defaults = scoreDurations();
  assert.equal(defaults.forestRiseMs, 30000); assert.equal(defaults.residueMorphMs, 8000); assert.equal(defaults.residueFadeMs, 20000);
  assert.equal(FINAL_RAIN_RAMP_MS, 52000); assert.equal(defaults.finalRainRiseMs, FINAL_RAIN_RAMP_MS);
  const configured = scoreDurations({ forestRiseSeconds: 60, finalRainRiseSeconds: 90, residueMorphSeconds: 12, residueFadeSeconds: 40 });
  assert.equal(configured.forestRiseMs, 60000); assert.equal(configured.residueMorphMs, 12000); assert.equal(configured.residueFadeMs, 40000);
  assert.equal(configured.finalRainRiseMs, 90000);
  assert.equal(configured.afterglowDurationMs, defaults.afterglowDurationMs);
  for (const invalid of [0, 181, NaN, Infinity, '30']) assert.equal(scoreDurations({ forestRiseSeconds: invalid }).forestRiseMs, 30000);
  for (const invalid of [9, 181, NaN, Infinity, '60']) assert.equal(scoreDurations({ finalRainRiseSeconds: invalid }).finalRainRiseMs, FINAL_RAIN_RAMP_MS);
});

test('the full forest hands off continuously to slowly rising rain over the shared default score', () => {
  const forest = computeScore({ id: 'forest-takeover', elapsedMs: 30000 });
  const start = computeScore({ id: 'final-rain', elapsedMs: 0 });
  assert.deepEqual(start.mix, { ...forest.mix, phoneCrickets: 0 }, 'Main forest/rain transfer continues while phone crickets wait for the dark reveal.');
  assert.equal(start.finalRainRampDurationMs, FINAL_RAIN_RAMP_MS);
  const samples = Array.from({ length: FINAL_RAIN_RAMP_MS / 100 + 1 }, (_, index) => computeScore({ id: 'final-rain', elapsedMs: index * 100 }));
  for (const [index, score] of samples.entries()) {
    assert.ok(Math.abs(score.mix.mainForest ** 2 + score.mix.mainRain ** 2 - 1) < 1e-12, 'Main forest/rain transfer keeps equal power.');
    assert.equal(score.mix.phoneField, 1); assert.equal(score.mix.phoneCrickets, 0);
    assert.equal(score.mix.mainDrone, 0, 'The drone stays absent throughout the forest/rain handoff.');
    assert.equal(score.finalRainProgress, finalRainProgressAt(index * 100));
    if (!index) continue;
    const previous = samples[index - 1];
    assert.ok(score.mix.mainForest <= previous.mix.mainForest);
    assert.ok(score.mix.mainRain >= previous.mix.mainRain);
    for (const key of ['mainOther', 'mainDrone', 'mainOutDrone', 'mainChimes']) {
      assert.ok(score.mix[key] >= previous.mix[key]);
      assert.ok(score.mix[key] - previous.mix[key] < .01, `${key} cannot jump at the fifth cue.`);
    }
  }
  assert.equal(samples[FINAL_RAIN_RAMP_MS / 200].finalRainProgress, .5);
  assert.ok(Math.abs(samples[FINAL_RAIN_RAMP_MS / 200].mix.mainForest - Math.SQRT1_2) < 1e-12);
  assert.ok(samples[10].finalRainProgress < .0001, 'The opening second remains very sparse and quiet.');
  assert.ok(samples[160].mix.mainForest > .96 && samples[160].mix.mainRain < .28, 'The old sixteen-second boundary is still early in the slow build.');
  assert.equal(samples.at(-1).mix.mainForest, 0); assert.equal(samples.at(-1).mix.mainRain, 1);
  assert.deepEqual(computeScore({ id: 'afterglow', elapsedMs: 0 }).mix, { ...samples.at(-1).mix, phoneField: 0 });
  const configured = computeScore({ id: 'final-rain', elapsedMs: 8000, settings: { finalRainRiseSeconds: 16 } });
  assert.equal(configured.finalRainProgress, .5); assert.equal(configured.finalRainRampDurationMs, 16000);
});

test('final cricket assets prepare during late cooling and enter smoothly with receding rain before the dark PA hold', () => {
  assert.equal(finalCricketProgressAt(.75), 0); assert.equal(finalCricketProgressAt(.875), .5); assert.equal(finalCricketProgressAt(1), 1);
  assert.equal(finalCricketProgressAt(-1), 0); assert.equal(finalCricketProgressAt(2), 1);
  for (const invalid of [NaN, Infinity, undefined]) assert.equal(finalCricketProgressAt(invalid), 0);
  for (const seconds of [10, 16, 60, 90, 180]) {
    const settings = { finalRainRiseSeconds: seconds }, duration = seconds * 1000;
    let previous = 0;
    for (let step = 0; step <= 1000; step++) {
      const score = computeScore({ id: 'final-rain', settings, elapsedMs: duration * step / 1000 });
      assert.equal(score.finalCricketProgress, finalCricketProgressAt(score.finalRainProgress));
      assert.ok(score.finalCricketProgress >= previous && score.finalCricketProgress - previous < .008);
      assert.equal(score.mix.mainCrickets, 0); assert.equal(score.mix.phoneCrickets, 0);
      previous = score.finalCricketProgress;
    }
    const afterglow = computeScore({ id: 'afterglow', settings, elapsedMs: 0 });
    assert.equal(afterglow.finalCricketProgress, 1);
    for (const time of [0, 1, 15000, 29999, 30000]) {
      const score = computeScore({ id: 'afterglow', settings, elapsedMs: time });
      assert.equal(score.mix.phoneCrickets, 0);
      assert.ok(Math.abs(score.mainFieldGain ** 2 + score.mix.mainCrickets ** 2 - 1) < 1e-12);
      assert.equal(score.mix.mainCrickets > 0, time > 0);
    }
    const reveal = computeScore({ id: 'afterglow', settings, elapsedMs: 34000 });
    assert.equal(reveal.mix.mainCrickets, 1); assert.equal(reveal.mix.phoneCrickets, 0);
    assert.equal(reveal.mainFieldGain, 0); assert.equal(reveal.visualGain, 0);
  }
});


test('rain/cricket overlap and visual fade are independent, and the full dark PA hold starts after both', () => {
  for (const [overlapSeconds, visualSeconds] of [[10, 180], [180, 10], [30, 30]]) {
    const settings = { rainCricketOverlapSeconds: overlapSeconds, projectionFadeSeconds: visualSeconds };
    const at = elapsedMs => computeScore({ id: 'afterglow', settings, elapsedMs });
    const overlapEnd = overlapSeconds * 1000, visualEnd = visualSeconds * 1000, holdStart = Math.max(overlapEnd, visualEnd);
    assert.equal(at(0).mainFadeDurationMs, overlapEnd);
    assert.equal(at(0).mainAudioDurationMs, holdStart + 24000);
    assert.equal(at(0).phoneRetreatStartMs, holdStart + 39000);
    assert.equal(at(0).afterglowDurationMs, holdStart + 99000);
    assert.equal(at(overlapEnd).mainFieldGain, 0); assert.equal(at(overlapEnd).mix.mainCrickets, 1);
    assert.equal(at(visualEnd).visualGain, 0);
    assert.equal(at(holdStart).phase, 'pa-crickets'); assert.equal(at(holdStart).phaseElapsedMs, 0);
    assert.equal(at(holdStart).mix.mainCrickets, 1); assert.equal(at(holdStart).mix.phoneCrickets, 0);
    assert.equal(at(holdStart + 11999).phase, 'pa-crickets');
    assert.equal(at(holdStart + 12000).phase, 'cricket-handoff');
    for (const elapsedMs of [overlapEnd, visualEnd, holdStart, holdStart + 12000, holdStart + 24000]) {
      const before = at(elapsedMs - .001), after = at(elapsedMs);
      assert.ok(Math.abs(before.mainFieldGain - after.mainFieldGain) < 1e-6);
      for (const [key, master] of [['mainCrickets', 'mainGain'], ['phoneCrickets', 'phoneGain']]) assert.ok(Math.abs(before.mix[key] * before[master] - after.mix[key] * after[master]) < 1e-6);
    }
    for (let elapsedMs = 0; elapsedMs < holdStart + 12000; elapsedMs += 500) assert.equal(at(elapsedMs).mix.phoneCrickets, 0);
  }
  for (const invalid of [0, 181, NaN, Infinity, '30']) assert.equal(scoreDurations({ rainCricketOverlapSeconds: invalid }).rainCricketOverlapMs, 30000);
});
