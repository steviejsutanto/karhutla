import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROGRAM_NOTES, PERFORMANCE_SCENES, sceneAllowsRain, sceneClock, sceneRemaining, sceneInstruction, scenePresentation, scenePhaseReadout, applySharedSound } from '../app/performance-view.js';

test('audience water remains open during running participation and forest takeover', () => {
  for (const id of PERFORMANCE_SCENES) {
    for (const paused of [false, true]) assert.equal(sceneAllowsRain({ id, paused }), ['participation', 'forest-takeover'].includes(id) && !paused);
  }
  assert.equal(sceneAllowsRain(null), false);
});
test('scene readouts use authoritative elapsed time and never show negative countdowns', () => {
  assert.equal(sceneClock({ elapsedMs: 125_900 }), '02:05');
  assert.equal(sceneClock({ elapsedMs: -1 }), '00:00');
  assert.equal(sceneRemaining({ id: 'afterglow', elapsedMs: 15_500 }), 15);
  assert.equal(sceneRemaining({ id: 'afterglow', elapsedMs: 30_500 }), 12);
  assert.equal(sceneRemaining({ id: 'afterglow', elapsedMs: 60_500 }), 9);
  assert.equal(sceneRemaining({ id: 'afterglow', elapsedMs: 129_500 }), 0);
  assert.match(sceneInstruction({ id: 'arrival', paused: true }), /speaker button/);
  assert.match(sceneInstruction({ id: 'final-rain' }), /whole landscape/);
  assert.equal(sceneInstruction({ id: 'ended' }), '');
});
test('title and programme remain separate from the second cue instructions', () => {
  const arrival = scenePresentation({ id: 'arrival', paused: true });
  const instructions = scenePresentation({ id: 'instructions' });
  assert.equal(arrival.opening, true); assert.equal(arrival.showProgramNotes, true); assert.equal(arrival.showInstructions, false);
  assert.equal(instructions.opening, true); assert.equal(instructions.showProgramNotes, false); assert.equal(instructions.showInstructions, true);
  assert.equal(instructions.cueScene, 'instructions');
  assert.equal(scenePresentation({ id: 'participation' }).opening, false);
  assert.doesNotMatch(DEFAULT_PROGRAM_NOTES, /Sound on|hold over|media volume/i);
  assert.match(sceneInstruction({ id: 'arrival' }), /Sound begins shortly/);
  assert.match(sceneInstruction({ id: 'instructions', paused: true }), /comfortable/);
});
test('projection and phones become completely black before phone cricket retreat starts', () => {
  for (const phone of [false, true]) {
    const fading = scenePresentation({ id: 'afterglow', elapsedMs: 15_000 }, { phone });
    assert.equal(fading.phase, 'rain-cricket-overlap'); assert.ok(fading.gain > 0 && fading.gain < 1); assert.equal(fading.blackout, false);
    for (const elapsedMs of [30_000, 44_999, 45_000, 90_000, 105_000]) {
      const dark = scenePresentation({ id: 'afterglow', elapsedMs }, { phone });
      assert.equal(dark.gain, 0); assert.equal(dark.blackout, true); assert.equal(dark.cueScene, 'final-rain');
    }
    assert.equal(scenePresentation({ id: 'ended' }, { phone }).blackout, true);
  }
  const phonesOnly = scenePresentation({ id: 'afterglow', elapsedMs: 54_000 });
  assert.equal(phonesOnly.mainGain, 0); assert.equal(phonesOnly.phoneGain, 1);
  assert.match(scenePhaseReadout({ id: 'afterglow', elapsedMs: 54_000 }), /Phones only.*All screens black.*15 s remaining/);
  assert.match(scenePhaseReadout({ id: 'afterglow', elapsedMs: 69_000 }), /Phones fading.*60 s remaining/);
});
test('late joins, paused scenes and custom timing use the received show clock', () => {
  const scene = { id: 'afterglow', elapsedMs: 8_000, paused: true, settings: { projectionFadeSeconds: 5, rainCricketOverlapSeconds: 5, paCricketOnlySeconds: 1, cricketHandoffSeconds: 1, phoneOnlySeconds: 4, phoneFadeSeconds: 10 } };
  assert.equal(scenePresentation(scene).phase, 'phone-only');
  assert.equal(sceneRemaining(scene), 3);
  assert.deepEqual(scenePresentation(scene), scenePresentation({ ...scene, serverNow: Date.now() + 60_000 }), 'wall time never advances a paused or received presentation');
  assert.match(scenePhaseReadout({ id: 'instructions', elapsedMs: 12_000 }), /Participation in 48 s/);
});
test('shared controls restore automation after manual macros and leave phone volume local', () => {
  const calls = [], engine = { setMacros: value => calls.push(['macros', value]), setAutomation: value => calls.push(['auto', value]), setLevel: value => calls.push(['level', value]) };
  const macros = { haze: .3 }, settings = { automation: false, macros, level: .2 };
  applySharedSound(engine, settings);
  assert.deepEqual(calls, [['macros', macros], ['auto', false], ['level', .2]]);
  calls.length = 0;
  applySharedSound(engine, settings, { phone: true });
  assert.deepEqual(calls, [['macros', macros], ['auto', true]]);
  calls.length = 0;
  applySharedSound(engine, { ...settings, macros: { ...macros } }, { phone: true });
  assert.deepEqual(calls, [], 'unchanged packets do not reapply or reschedule sound controls');
  applySharedSound(engine, { ...settings, automation: true }, { phone: false });
  assert.deepEqual(calls, [['macros', macros], ['auto', true], ['level', .2]]);
});

test('shared main mixer reaches the fallback audio path while phone levels stay local', () => {
  const calls = [], engine = { setMixer: value => calls.push(value) };
  const mixer = { chimes: .6, outDrone: 1.5, lowDrone: 1.2 };
  applySharedSound(engine, { mixer });
  assert.deepEqual(calls, [mixer]);
  applySharedSound(engine, { mixer: { ...mixer } });
  assert.equal(calls.length, 1);
  applySharedSound(engine, { mixer }, { phone: true });
  assert.equal(calls.length, 1, 'main mixer never changes phone output');
});


test('forest takeover has its own fourth cue, countdown and rain instruction before the fifth-cue finale', () => {
  assert.deepEqual(PERFORMANCE_SCENES, ['arrival', 'instructions', 'participation', 'forest-takeover', 'final-rain', 'afterglow', 'ended']);
  const scene = { id: 'forest-takeover', elapsedMs: 15000, settings: { forestRiseSeconds: 60 } };
  const view = scenePresentation(scene);
  assert.equal(view.cue, 4); assert.equal(view.cueScene, 'forest-takeover'); assert.equal(view.opening, false);
  assert.equal(sceneRemaining(scene), 45);
  assert.match(scenePhaseReadout(scene), /Forest takeover.*Final rain in 45 s/);
  assert.match(scenePhaseReadout({ ...scene, elapsedMs: 60000 }), /Final rain in 0 s/);
  assert.match(sceneInstruction(scene), /Keep bringing rain/);
  assert.match(sceneInstruction({ ...scene, paused: true }), /paused/);
  assert.match(scenePhaseReadout({ id: 'participation' }), /Soft tones.*Main bells/);
  for (const id of ['final-rain', 'afterglow', 'ended']) {
    assert.equal(scenePresentation({ id }).cueScene, 'final-rain');
    assert.equal(scenePresentation({ id }).cue, 5);
  }
});

test('forest restoration finishes before the independent automatic scene countdown', () => {
  const scene = { id: 'forest-takeover', elapsedMs: 30000,
    forestRestorationProgress: 1, forestRestorationComplete: true, forestRestorationRemainingMs: 0,
    autoAdvanceRemainingMs: 30000 };
  assert.equal(scenePresentation(scene).cueScene, 'forest-takeover');
  assert.equal(sceneAllowsRain(scene), true);
  assert.equal(sceneRemaining(scene), 30);
  assert.match(scenePhaseReadout(scene), /Rain cools; fire keeps returning.*Final rain in 30 s.*Automatic/);
  assert.match(scenePhaseReadout({ ...scene, paused: true }), /Timer paused/);
  assert.equal(sceneRemaining({ id: 'arrival', elapsedMs: 10000 }), 50);
  assert.equal(sceneRemaining({ id: 'instructions', elapsedMs: 10000 }), 50);
  assert.equal(sceneRemaining({ id: 'participation', elapsedMs: 10000 }), 590);
});

test('final rain reports the configured slow forest-to-heavy-rain transition from the show clock', () => {
  const start = { id: 'final-rain', elapsedMs: 0 };
  assert.equal(sceneRemaining(start), 60);
  assert.match(scenePhaseReadout(start), /Burning forest → heavy rain.*0%.*60 s remaining/);
  assert.equal(sceneRemaining({ ...start, elapsedMs: 30_000 }), 30);
  assert.match(scenePhaseReadout({ ...start, elapsedMs: 30_000 }), /50%.*30 s remaining/);
  assert.equal(sceneRemaining({ ...start, elapsedMs: 60_000 }), 0);
  assert.match(scenePhaseReadout({ ...start, elapsedMs: 60_000 }), /Heavy rain.*Transition complete/);
  const configured = { ...start, settings: { finalRainRiseSeconds: 90 }, elapsedMs: 45_000, paused: true };
  assert.equal(sceneRemaining(configured), 45);
  assert.match(scenePhaseReadout(configured), /50%.*45 s remaining/);
  assert.doesNotMatch(scenePhaseReadout({ id: 'participation' }), /phone rain/i);
  assert.match(sceneInstruction({ id: 'participation' }), /C or G bell/);
});


test('ending readout describes rain/cricket overlap and waits for independent blackout before the PA-only hold', () => {
  assert.match(scenePhaseReadout({ id: 'afterglow', elapsedMs: 15000 }), /Rain → PA crickets.*Screens fading.*15 s remaining/);
  assert.match(scenePhaseReadout({ id: 'afterglow', elapsedMs: 30000 }), /PA crickets alone.*All screens black.*12 s remaining/);
  const settings = { rainCricketOverlapSeconds: 10, projectionFadeSeconds: 30 };
  assert.match(scenePhaseReadout({ id: 'afterglow', settings, elapsedMs: 15000 }), /PA crickets.*Screens fading.*Rain stopped.*15 s remaining/);
  const earlyBlack = { rainCricketOverlapSeconds: 30, projectionFadeSeconds: 10 };
  assert.match(scenePhaseReadout({ id: 'afterglow', settings: earlyBlack, elapsedMs: 15000 }), /Rain → PA crickets.*All screens black.*15 s remaining/);
});


test('only an authoritative opening entrance reveals the QR and phone welcome during scene 3', () => {
  for (const phone of [false, true]) {
    const opening = { id: 'participation', participationOpening: true, elapsedMs: 0 };
    assert.equal(scenePresentation(opening, { phone }).landscapeEntranceGain, 0);
    assert.equal(scenePresentation(opening, { phone }).openingOverlayGain, 1);
    const midpoint = scenePresentation({ ...opening, elapsedMs: 6_000 }, { phone });
    assert.equal(midpoint.landscapeEntranceGain, .5); assert.equal(midpoint.openingOverlayGain, .5);
    assert.equal(scenePresentation({ ...opening, elapsedMs: 12_000 }, { phone }).openingOverlayGain, 0);
    for (const elapsedMs of [0, 100, 6_000, 12_000]) {
      const returned = { id: 'participation', participationOpening: false, elapsedMs };
      const current = scenePresentation(returned, { phone });
      assert.equal(current.landscapeEntranceGain, 1, 'A direct scene return keeps the complete landscape.');
      assert.equal(current.openingOverlayGain, 0, 'QR and welcome stay hidden after scene 4 or a scene 3 restart.');
      assert.deepEqual(current, scenePresentation(JSON.parse(JSON.stringify(returned)), { phone }), 'A fresh browser with the same authority packet makes the same choice.');
    }
  }
});
