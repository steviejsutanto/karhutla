import test from 'node:test';
import assert from 'node:assert/strict';
import { finalRainProgressAt } from '../app/scene-score.js';
import { drawFinalSectionRain } from '../visual-assets/final-rain.js';

function recordingContext() {
  const stack = [];
  return {
    segments: [], clips: [], arcs: 0, curves: 0, globalAlpha: .37, activeClip: null,
    save() { stack.push({ globalAlpha: this.globalAlpha, activeClip: this.activeClip }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() { this.point = null; }, stroke() {},
    rect(x, y, width, height) { this.pendingClip = [x, y, width, height]; },
    clip() { this.activeClip = this.pendingClip; this.clips.push(this.activeClip); },
    moveTo(x, y) { this.point = [x, y]; },
    lineTo(x, y) { this.segments.push({ from: this.point, to: [x, y], alpha: this.globalAlpha, clip: this.activeClip }); this.point = [x, y]; },
    arc() { this.arcs++; }, quadraticCurveTo() { this.curves++; },
  };
}

function capture(options = {}) {
  const context = recordingContext();
  const result = drawFinalSectionRain(context, { width: 1200, height: 500, surfaceYAt: () => 160,
    intensity: 1, now: 1400, ...options });
  return { context, result };
}

test('finale covers the side-view sky with native small rain and no contact rectangles, canopy or footprint', () => {
  const surfaceYAt = x => 140 + Math.sin(x * 20) * 9;
  const { context, result } = capture({ surfaceYAt });
  assert.equal(context.segments.length, result.drops);
  assert.ok(result.drops > 850); assert.equal(result.columns, 1);
  assert.deepEqual(context.clips, [[0, 0, 1200, 500]]);
  for (const { from, to, clip } of context.segments) {
    assert.equal(clip.join(), '0,0,1200,500');
    assert.ok(Math.hypot(to[0] - from[0], to[1] - from[1]) <= 9.1);
    assert.ok(from[1] >= 0 && to[1] <= surfaceYAt(from[0] / 1200), 'Drops end above the actual wavy ground.');
  }
  assert.ok(context.segments.some(({ from }) => from[1] < 12), 'Rain reaches the upper sky without a common 28 px start row.');
  assert.equal(context.curves, 0); assert.equal(context.arcs, 0);
  assert.equal(context.globalAlpha, .37); assert.equal(context.activeClip, null);
});

test('rain density and opacity grow with the authoritative intensity and completely clear at zero', () => {
  const samples = [0, .05, .25, .5, 1].map(intensity => {
    const { context, result } = capture({ intensity });
    return { ...result, ink: context.segments.reduce((sum, segment) => sum + segment.alpha, 0) };
  });
  assert.equal(samples[0].drops, 0); assert.equal(samples[0].columns, 0);
  for (let index = 1; index < samples.length; index++) {
    assert.ok(samples[index].ink > samples[index - 1].ink);
    assert.ok(samples[index].drops > samples[index - 1].drops);
  }
});

test('one continuous field has no density steps at former contact-row boundaries', () => {
  const bands = new Array(12).fill(0), locations = [];
  for (let frame = 0; frame < 10; frame++) {
    const { context } = capture({ now: frame * 317 });
    for (const { from, to, alpha } of context.segments) {
      if (from[1] >= 20 && from[1] < 140) bands[Math.floor((from[1] - 20) / 10)]++;
      if (!frame) locations.push({ x: from[0], y: from[1], bottom: to[1], alpha });
    }
  }
  assert.ok(Math.max(...bands) / Math.min(...bands) < 1.35,
    'Independent fall phases maintain density through every interior horizontal band.');
  assert.ok(new Set(locations.map(mark => mark.y.toFixed(5))).size > locations.length * .99);
  for (let tenth = 0; tenth < 10; tenth++) {
    assert.ok(locations.some(mark => Math.floor(mark.x / 120) === tenth));
  }
  const edge = locations.filter(({ x, y, bottom }) => x < 4 || x > 1196 || y < 4 || bottom > 156);
  assert.ok(edge.length > 20);
  assert.ok(edge.every(({ alpha }) => alpha < .14), 'Top, ground and lateral edges are feathered, never hard rectangles.');
});

test('individual drops move at distinct speeds rather than synchronized cohorts', () => {
  const before = capture({ now: 5000 }).context.segments;
  const after = capture({ now: 5001 }).context.segments;
  const speeds = [];
  for (const { from: start } of before) {
    const match = after.find(({ from }) => Math.abs(from[0] - start[0]) < .01
      && from[1] > start[1] && from[1] - start[1] < .2);
    if (match) speeds.push((match.from[1] - start[1]) * 1000);
  }
  assert.ok(speeds.length > 800);
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > 100);
  assert.notDeepEqual(capture({ now: 5000 }).context.segments, capture({ now: 5100 }).context.segments);
});

test('rain is deterministic, reduced-motion stable, and bounded at large resolutions', () => {
  assert.deepEqual(capture().context.segments, capture().context.segments);
  assert.deepEqual(capture({ now: 0, reducedMotion: true }).context.segments, capture({ now: 99000, reducedMotion: true }).context.segments);
  const { context, result } = capture({ width: 12000, height: 4000, surfaceYAt: () => 1600 });
  assert.ok(result.drops <= 4096); assert.equal(result.drops, context.segments.length);
  for (let tenth = 0; tenth < 10; tenth++) {
    assert.ok(context.segments.some(({ from }) => Math.floor(from[0] / 1200) === tenth));
  }
});


test('the gentle first rain is visible alongside its sound without becoming the full finale early', () => {
  const first = capture({ intensity: finalRainProgressAt(5_000) });
  const full = capture();
  const ink = marks => marks.reduce((sum, mark) => sum + mark.alpha, 0);
  const earlyInk = ink(first.context.segments), fullInk = ink(full.context.segments);
  assert.ok(first.result.drops >= 100, 'The first five seconds contain a sparse field across the sky.');
  assert.ok(first.context.segments.some(mark => mark.alpha >= .01), 'Small strokes remain perceptible during the quiet sound entrance.');
  assert.ok(earlyInk > fullInk * .003 && earlyInk < fullInk * .02, 'The opening remains much lighter than the final continuous field.');
  assert.equal(first.result.intensity, finalRainProgressAt(5_000), 'Only visual visibility is remapped; the shared cooling intensity is unchanged.');
});
