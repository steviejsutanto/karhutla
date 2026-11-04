import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePeatAtmosphereState, PeatSection } from '../visual-assets/peat-section.js';
import { RainFeedback } from '../visual-assets/rain-feedback.js';
import { SurfaceHeat } from '../visual-assets/surface-heat.js';

function drawingContext() {
  const segments = [], circles = [];
  let point = null;
  const stack = [];
  return {
    segments, circles,
    globalAlpha: 1,
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop() || {}); }, beginPath() { point = null; }, stroke() {},
    moveTo(x, y) { point = [x, y]; },
    lineTo(x, y) { if (point) segments.push([...point, x, y]); point = [x, y]; },
    arc(...values) { circles.push(values); }, quadraticCurveTo() {},
  };
}

test('hot dry haze is restless while a wet surface retains heat with visibly calmer air', () => {
  const dry = derivePeatAtmosphereState({ heat: 1, surfaceWetness: 0 });
  const wet = derivePeatAtmosphereState({ heat: 1, surfaceWetness: 1 });
  assert.equal(dry.heat, wet.heat, 'Atmosphere does not remove authoritative deep heat.');
  assert.ok(dry.agitation > .9);
  assert.equal(wet.agitation, 0);
  assert.equal(wet.turbulence, 0);
  assert.ok(wet.drift < dry.drift * .15);
  assert.ok(wet.density > 0 && wet.density < dry.density * .3, 'Quiet residual heat remains visible.');
});

test('local rain calms its own atmosphere immediately without cooling another patch', () => {
  const patch = Object.freeze({ heat: .9, surfaceWetness: 0, moisture: .1, extinguished: false });
  const original = { ...patch };
  const dry = derivePeatAtmosphereState(patch);
  const touched = derivePeatAtmosphereState({ ...patch, contact: 1 });
  const untouched = derivePeatAtmosphereState(patch);
  assert.equal(touched.heat, patch.heat);
  assert.ok(touched.agitation < dry.agitation * .1);
  assert.ok(touched.density < dry.density);
  assert.deepEqual(untouched, dry, 'A local decorative response cannot calm neighboring state.');
  assert.deepEqual(patch, original);
  assert.equal(derivePeatAtmosphereState({ ...patch, surfaceWetness: 1, contact: 0 }).agitation, 0, 'Received wetness keeps the air quiet after contact feedback ends.');
});

test('reduced motion freezes haze movement while retaining wetness and extinction feedback', () => {
  for (const surfaceWetness of [0, .4, 1]) {
    const still = derivePeatAtmosphereState({ heat: .8, surfaceWetness, reducedMotion: true });
    const moving = derivePeatAtmosphereState({ heat: .8, surfaceWetness });
    assert.equal(still.agitation, 0);
    assert.equal(still.turbulence, 0);
    assert.equal(still.drift, 0);
    assert.equal(still.density, moving.density);
  }
  const out = derivePeatAtmosphereState({ heat: 1, extinguished: true, contact: 0 });
  assert.equal(out.heat, 0); assert.equal(out.density, 0);
  assert.equal(out.agitation, 0); assert.equal(out.drift, 0);
});

test('side-view rain keeps its drops while omitting the horizontal impact line', () => {
  const feedback = new RainFeedback(), context = drawingContext();
  feedback.draw(context, { x: 200, y: 200, radius: 18, now: 250, cloud: false, footprint: false, impact: false });
  assert.ok(context.segments.length >= 14, 'Rain remains visible.');
  assert.equal(context.circles.length, 0);
  assert.equal(context.segments.some(([x0, y0, x1, y1]) => y0 === 201 && y1 === 201 && x0 < 200 && x1 > 200), false);
});

test('removing the section impact does not remove the exact geographic phone footprint', () => {
  const feedback = new RainFeedback(), context = drawingContext();
  feedback.draw(context, { x: 200, y: 200, radius: 18, now: 250, cloud: false, footprint: true, impact: false });
  assert.ok(context.segments.length >= 14);
  assert.deepEqual(context.circles[0].slice(0, 3), [200, 200, 18]);
  const preview = drawingContext();
  feedback.draw(preview, { x: 200, y: 200, now: 250, preview: true, cloud: false, footprint: false, impact: false });
  assert.equal(preview.segments.length, 0, 'Hover never falsely suggests falling rain.');
});

function surfaceOptions(overrides = {}) {
  return { width: 1000, height: 400, activity: new Float32Array(120).fill(1),
    embers: new Float32Array(120).fill(.7), calm: new Float32Array(120),
    surfaceAt: x => 110 + Math.sin(x * 11) * 3, ...overrides };
}

test('surface heat stays bounded and becomes slower and smaller under local calm', async () => {
  const hot = new SurfaceHeat({ emitterCount: 1000000 }), quiet = new SurfaceHeat({ emitterCount: 1000000 });
  await Promise.all([hot.ready(), quiet.ready()]);
  const hotContext = drawingContext(), quietContext = drawingContext();
  const hotOptions = surfaceOptions(), quietOptions = surfaceOptions({ calm: new Float32Array(120).fill(1) });
  const initialActivity = [...hotOptions.activity];
  hot.draw(hotContext, { ...hotOptions, now: 0 }); quiet.draw(quietContext, { ...quietOptions, now: 0 });
  const hotStats = hot.draw(hotContext, { ...hotOptions, now: 100 });
  const quietStats = quiet.draw(quietContext, { ...quietOptions, now: 100 });
  assert.ok(hot.emitters.length <= 96 && hotStats.visibleEmitters <= 96);
  assert.ok(hotStats.visibleEmitters > 0 && quietStats.visibleEmitters > 0, 'Calming retains an ember texture.');
  assert.ok(quietStats.agitation < hotStats.agitation * .1);
  assert.ok(quietStats.phaseAdvance < hotStats.phaseAdvance * .1);
  assert.ok(quietStats.motionPixels < hotStats.motionPixels * .1);
  assert.deepEqual([...hotOptions.activity], initialActivity, 'Animation cannot alter received surface activity.');
});

test('reduced-motion surface heat remains in the same place across caller clock changes', () => {
  const renderer = new SurfaceHeat(), context = drawingContext(), options = surfaceOptions({ reducedMotion: true });
  renderer.draw(context, { ...options, now: 0 });
  const initial = context.segments.map(segment => [...segment]);
  context.segments.length = 0;
  const stats = renderer.draw(context, { ...options, now: 10000 });
  assert.ok(initial.length > 0);
  assert.deepEqual(context.segments, initial);
  assert.equal(stats.motionPixels, 0); assert.equal(stats.phaseAdvance, 0);
});

test('surface heat emits nothing for extinguished ground and cannot jump after a hidden interval', () => {
  const renderer = new SurfaceHeat(), context = drawingContext(), hot = surfaceOptions();
  renderer.draw(context, { ...hot, now: 0 });
  const resumed = renderer.draw(context, { ...hot, now: 86400000 });
  assert.ok(resumed.phaseAdvance > 0 && resumed.phaseAdvance <= 96 * .15 * 1.9, 'A resumed frame advances a bounded visual interval.');
  context.segments.length = 0;
  const cold = surfaceOptions({ activity: new Float32Array(120), embers: new Float32Array(120) });
  const stats = renderer.draw(context, { ...cold, now: 86400100 });
  assert.equal(stats.visibleEmitters, 0); assert.equal(context.segments.length, 0);
});

function motionSection() {
  const section = Object.create(PeatSection.prototype), bins = 96;
  Object.assign(section, { reducedMotion: false, motionBins: bins, contacts: [], stats: {},
    contactTargets: new Float32Array(bins), contactCalm: new Float32Array(bins),
    sectionCalm: new Float32Array(bins), sectionDensity: new Float32Array(bins), sectionAgitation: new Float32Array(bins),
    sectionPhaseX: new Float64Array(bins), sectionPhaseY: new Float64Array(bins), sectionPhase: new Float64Array(bins),
    patches: Array.from({length: bins}, (_, index) => Object.freeze({ key: String(index), heat: 1, extinguished: false,
      memory: Object.freeze({ haze: 1, wet: 0 }) })) });
  return section;
}

test('section rain slows only its local plume and integrates motion without a phase jump', () => {
  const rain = motionSection(), dry = motionSection(), center = 24, far = 74;
  rain.setContacts([{ x: .25, radius: .05, strength: 1, active: true }]);
  rain._updateSectionMotion(0); dry._updateSectionMotion(0);
  assert.equal(rain.sectionPhaseY[center], 0, 'A changed rain target must not teleport the noise phase.');
  for (let step = 0; step < 8; step++) { rain._updateSectionMotion(.125); dry._updateSectionMotion(.125); }
  assert.ok(rain.sectionCalm[center] > .9);
  assert.ok(rain.sectionAgitation[center] < dry.sectionAgitation[center] * .02);
  assert.ok(rain.sectionPhaseY[center] < dry.sectionPhaseY[center] * .3);
  assert.equal(rain.sectionCalm[far], 0);
  assert.equal(rain.sectionPhaseY[far], dry.sectionPhaseY[far], 'Another hot patch retains its motion.');
  assert.equal(rain.patches[center].heat, 1);
  const previous = rain.sectionPhaseY[center];
  rain.setContacts([]); rain._updateSectionMotion(0);
  assert.equal(rain.sectionPhaseY[center], previous, 'Release also changes speed without resetting position.');
});

function sharedAir() {
  const section = Object.create(PeatSection.prototype), width = 64, height = 32, cells = width * height;
  Object.assign(section, { reducedMotion: false, stats: {}, airGridWidth: width, airGridHeight: height,
    atmosphere: { width: 480, height: 192 },
    airSampleX: new Float64Array(cells), airSampleY: new Float64Array(cells),
    airMix: new Float32Array(cells), airQuiet: new Float32Array(cells),
    airHeatLine: new Float32Array(width).fill(1), airCalmTargets: new Float32Array(cells), airCalm: new Float32Array(cells),
    airPhase: new Float64Array(cells), airPhaseX: new Float64Array(cells), airPhaseY: new Float64Array(cells), lastAtmosphereMotionAt: null });
  return section;
}

test('shared haze calms the actual two-dimensional rain area while surrounding air keeps drifting', () => {
  const rain = sharedAir(), dry = sharedAir(), center = 16 * 64 + 16, far = 16 * 64 + 48, above = 2 * 64 + 16;
  const area = [{ x: .25, y: .5, radiusX: .1, radiusY: .12, strength: 1 }];
  for (const now of [0, 250, 500, 750, 1000]) { rain._updateSharedMotion(area, now); dry._updateSharedMotion([], now); }
  assert.ok(rain.airCalm[center] > .9);
  assert.ok(rain.airPhaseY[center] < dry.airPhaseY[center] * .3);
  assert.equal(rain.airCalm[far], 0); assert.equal(rain.airPhaseY[far], dry.airPhaseY[far]);
  assert.equal(rain.airCalm[above], 0); assert.equal(rain.airPhaseY[above], dry.airPhaseY[above], 'Shared haze must use map y, not only source-strip x.');
  const before = rain.airPhaseY[center];
  rain._updateSharedMotion([], 1000);
  assert.equal(rain.airPhaseY[center], before, 'Changing the calm mask cannot jump the drift phase.');
});

test('confirmed-out ground retains its existing air tail instead of cutting haze at the packet boundary', () => {
  const section = motionSection();
  section._updateSectionMotion(0);
  const before = [...section.sectionDensity];
  section.patches = section.patches.map(patch => ({ ...patch, heat: 0, extinguished: true }));
  section._updateSectionMotion(0);
  assert.deepEqual([...section.sectionDensity], before, 'The source target can reach zero without discarding retained haze.');
  section.patches = section.patches.map(patch => ({ ...patch, memory: { haze: .4, wet: 0 } }));
  section._updateSectionMotion(.1);
  assert.ok(section.sectionDensity.every((density, i) => density > 0 && density < before[i]));
  section.patches = section.patches.map(patch => ({ ...patch, memory: { haze: 0, wet: 0 } }));
  section._updateSectionMotion(.1);
  assert.ok(section.sectionDensity.every(density => density === 0));
});
