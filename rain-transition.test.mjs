import test from 'node:test';
import assert from 'node:assert/strict';
import { RainContactTransitions, RainFeedback } from './visual-assets/rain-feedback.js';

function context() {
  const stack = [];
  return {
    segments: [], arcs: [], globalAlpha: .37, point: null,
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() { this.point = null; }, stroke() {},
    moveTo(x, y) { this.point = [x, y]; },
    lineTo(x, y) { if (this.point) this.segments.push([...this.point, x, y, this.globalAlpha]); this.point = [x, y]; },
    quadraticCurveTo() {},
    arc(x, y, radius) { this.arcs.push([x, y, radius, this.globalAlpha]); },
  };
}

const held = Object.freeze({ id: 'local', x: .2, y: .4, active: true, local: true, strength: .5 });
const feedback = new RainFeedback();
function draw(sample, now, overrides = {}) {
  const ctx = context();
  const result = feedback.draw(ctx, { ...sample, x: 180, y: 190, radius: 18, now,
    cloud: false, footprint: true, impact: false, ...overrides });
  return { ctx, result };
}

test('press acknowledges immediately with a precise footprint and a few drops, then fills smoothly', () => {
  const transitions = new RainContactTransitions();
  const initial = transitions.update([held], 1000)[0];
  const middle = transitions.sample(1075)[0], settled = transitions.sample(1150)[0];
  assert.ok(initial.envelope.opacity > 0 && initial.envelope.opacity < middle.envelope.opacity);
  assert.ok(middle.envelope.opacity < settled.envelope.opacity);
  assert.equal(settled.envelope.opacity, 1);
  const start = draw(initial, 1000), full = draw(settled, 1150);
  assert.ok(start.result.dropCount > 0, 'The first caller frame contains falling drops.');
  assert.ok(start.result.dropCount < full.result.dropCount, 'The entire rain column does not spawn at once.');
  assert.deepEqual(start.ctx.arcs[0].slice(0, 3), [180, 190, 18]);
  assert.ok(start.ctx.arcs[0][3] > .3, 'The exact target footprint acknowledges the press immediately.');
  assert.equal(start.ctx.globalAlpha, .37, 'Painting restores the caller’s opacity.');
  assert.equal(transitions.hasAnimation(2000), true, 'Held rain continues on the caller’s frame loop.');
  assert.deepEqual(held, { id: 'local', x: .2, y: .4, active: true, local: true, strength: .5 });
});

test('every caller start time produces immediate drops and the local contact keeps detailed-render priority', () => {
  for (let now = 0; now < 10000; now += 11) {
    const transitions = new RainContactTransitions();
    const sample = transitions.update([held], now)[0];
    assert.ok(draw(sample, now).result.dropCount > 0);
  }
  const transitions = new RainContactTransitions();
  const remote = Array.from({ length: 64 }, (_, index) => ({ id: `remote-${index}`, x: .5, y: .5 }));
  transitions.update(remote, 0);
  assert.equal(transitions.update([...remote, held], 1000)[0].sourceId, 'local');
  transitions.update(remote, 1100);
  assert.equal(transitions.sample(1100)[0].sourceId, 'local', 'The local release tail also keeps its visible feedback priority.');
});

test('release keeps its last rain location and drains existing drops downward without wrapping', () => {
  const transitions = new RainContactTransitions();
  transitions.update([held], 1000);
  const before = transitions.sample(1200)[0];
  const released = transitions.update([], 1200)[0];
  assert.equal(released.id, before.id);
  assert.equal(released.active, false);
  assert.deepEqual([released.x, released.y], [held.x, held.y]);
  const start = draw(released, 1200), halfway = draw(transitions.sample(1425)[0], 1425);
  assert.ok(halfway.result.dropCount > 0 && halfway.result.dropCount < start.result.dropCount);
  assert.ok(halfway.result.rainTop > start.result.rainTop + 15,
    'The released column clears from the top while remaining drops fall toward the ground.');
  let previous = released.envelope.opacity;
  for (const now of [1250, 1300, 1400, 1500, 1600]) {
    const sample = transitions.sample(now)[0];
    assert.ok(sample.envelope.opacity < previous); previous = sample.envelope.opacity;
  }
  assert.equal(transitions.hasAnimation(1649), true);
  assert.deepEqual(transitions.sample(1650), []);
  assert.equal(transitions.hasAnimation(1650), false);
});

test('a same-id hover preview cannot teleport the retained rain tail or create new drops', () => {
  const transitions = new RainContactTransitions();
  const rainId = transitions.update([held], 1000)[0].id;
  const preview = Object.freeze({ id: 'local', x: .8, y: .9, preview: true, local: true });
  const samples = transitions.update([preview], 1200);
  const tail = samples.find(sample => !sample.preview), hover = samples.find(sample => sample.preview);
  assert.equal(tail.id, rainId); assert.equal(tail.active, false);
  assert.deepEqual([tail.x, tail.y], [.2, .4]);
  assert.deepEqual([hover.x, hover.y], [.8, .9]);
  assert.equal(tail.sourceId, hover.sourceId); assert.notEqual(tail.id, hover.id);
  const rendered = draw(hover, 1200, { footprint: false });
  assert.equal(rendered.result.dropCount, 0); assert.equal(rendered.ctx.segments.length, 0);
  assert.equal(transitions.hasAnimation(2000), false, 'A settled hover sign needs no private animation loop.');
  assert.deepEqual(transitions.sample(2000).map(sample => sample.id), [hover.id]);
});

test('a rapid second press has a fresh attack while the first tail keeps its stable identity', () => {
  const transitions = new RainContactTransitions();
  const first = transitions.update([held], 1000)[0];
  transitions.update([], 1200);
  const next = transitions.update([{ ...held, x: .7, y: .6 }], 1300);
  assert.equal(next.length, 2);
  const tail = next.find(sample => !sample.active), active = next.find(sample => sample.active);
  assert.equal(tail.id, first.id); assert.deepEqual([tail.x, tail.y], [.2, .4]);
  assert.notEqual(active.id, first.id); assert.deepEqual([active.x, active.y], [.7, .6]);
  assert.equal(active.envelope.attackProgress, 0);
  assert.ok(active.envelope.opacity < tail.envelope.opacity);
  const later = transitions.sample(1400);
  assert.equal(later.find(sample => sample.active).id, active.id);
  transitions.clear();
  assert.deepEqual(transitions.sample(1400), []); assert.equal(transitions.hasAnimation(1400), false);
});

test('reduced motion gives immediate static acknowledgement and immediate release', () => {
  const transitions = new RainContactTransitions({ reducedMotion: true });
  const initial = transitions.update([held], 1000)[0];
  assert.equal(initial.envelope.opacity, 1); assert.equal(initial.envelope.attackProgress, 1);
  assert.equal(transitions.hasAnimation(1000), false);
  const first = draw(initial, 1000, { reducedMotion: true });
  const later = draw(transitions.sample(8000)[0], 8000, { reducedMotion: true });
  assert.deepEqual(later.ctx.segments, first.ctx.segments);
  assert.deepEqual(transitions.update([], 8000), []);
  assert.equal(transitions.hasAnimation(8000), false);
});

test('the visual contact budget includes release tails and prioritizes immediate local input', () => {
  const transitions = new RainContactTransitions();
  const crowd = Object.freeze(Array.from({ length: 1000 }, (_, index) => Object.freeze({
    id: `remote-${index}`, x: index / 1000, y: .5, active: true,
  })));
  assert.equal(transitions.update(crowd, 1000).length, 256);
  transitions.update([], 1200);
  const next = transitions.update([...crowd, held], 1250);
  assert.equal(next.length, 256); assert.ok(transitions.entries.size <= 256);
  assert.equal(next.find(sample => sample.sourceId === 'local').active, true);
  assert.ok(next.every(sample => Number.isFinite(sample.x) && Number.isFinite(sample.y)));
  assert.deepEqual(crowd[0], { id: 'remote-0', x: 0, y: .5, active: true });
});

test('explicit caller clocks and repeated snapshots are deterministic, with no rain from previews', () => {
  const transitions = new RainContactTransitions();
  transitions.set([{ id: 'preview', x: .5, y: .5, preview: true }], 1000);
  assert.deepEqual(transitions.sample(1075), transitions.sample(1075));
  const sample = transitions.sample(1150)[0];
  assert.equal(draw(sample, 1150).result.dropCount, 0);
  assert.equal(transitions.hasAnimation(1150), false);
  transitions.update([{ ...held, active: false }], 1200);
  assert.ok(transitions.sample(1200).every(contact => !contact.active));
});

test('participant rain colors and numbers remain stable across moves, releases, and both screen sizes', async () => {
  const { participantRainIdentity } = await import('./visual-assets/participant-identity.js');
  const identity = participantRainIdentity(23);
  assert.deepEqual(participantRainIdentity('23'), identity);
  assert.notDeepEqual(participantRainIdentity(24), identity);
  assert.equal(participantRainIdentity(null), null);
  assert.equal(participantRainIdentity(-1), null);
  const transitions = new RainContactTransitions();
  transitions.update([{ ...held, ...identity }], 1000);
  transitions.update([{ ...held, ...identity, x: .8 }], 1100);
  const sample = transitions.update([], 1200)[0];
  assert.equal(sample.color, identity.color); assert.equal(sample.label, '23');
  for (const right of [320, 1920]) {
    const ctx = context(), labels = [], colors = [];
    ctx.fillText = (text, x, y) => labels.push({ text, x, y, color: ctx.fillStyle });
    Object.defineProperty(ctx, 'strokeStyle', { set(value) { colors.push(value); } });
    feedback.draw(ctx, { ...sample, x: right - 10, y: 180, radius: 18, now: 1220, bounds: { left: 0, top: 0, right } });
    assert.equal(labels[0].text, '23'); assert.equal(labels[0].color, identity.color);
    assert.ok(labels[0].x > 0 && labels[0].x < right);
    assert.ok(colors.every(color => color === identity.color));
  }
});

test('source confirmation steam stays anchored, fades without a flash, and has a fixed event budget', async () => {
  const { ExtinctionFeedback } = await import('./visual-assets/extinction-feedback.js');
  const cues = new ExtinctionFeedback({ maxEvents: 4 }), rect = { x: 20, y: 10, width: 1000, height: 400 };
  const source = Object.freeze({ key: '400,0', x: .25, y: .4, now: 1000, wallAt: 5000 });
  cues.trigger(source);
  assert.equal(cues.trigger(source), null, 'Repeated packets do not restart one confirmation.');
  const frames = [];
  for (const now of [1000, 1150, 1500, 2200]) {
    const ctx = context(); ctx.rings = [];
    ctx.ellipse = (x, y, rx, ry) => ctx.rings.push([x, y, rx, ry, ctx.globalAlpha, ctx.strokeStyle]);
    ctx.bezierCurveTo = () => {};
    cues.draw(ctx, { rect, now }); frames.push(ctx.rings[0]);
    assert.deepEqual(ctx.rings[0].slice(0, 2), [270, 170]);
    assert.ok(ctx.rings[0][4] > 0 && ctx.rings[0][4] < .6, 'Confirmation remains a quiet accent.');
    assert.equal(ctx.globalAlpha, .37);
  }
  assert.ok(frames[1][2] < frames[3][2]);
  assert.ok(frames[3][4] < frames[1][4]);
  assert.equal(cues.hasAnimation(2500), false);
  assert.deepEqual(source, { key: '400,0', x: .25, y: .4, now: 1000, wallAt: 5000 });
  for (let i = 0; i < 100; i++) cues.trigger({ key: i, x: .5, y: .5, now: 3000 });
  assert.equal(cues.events.size, 4);
});

test('accepted press snapshots retain short released retaps and ignore held motion or old history', async () => {
  const { participantPressEvents } = await import('./visual-assets/extinction-feedback.js');
  const base = { id: 'phone', role: 'participant', pressSerial: 0, pressPosition: null, holding: false, position: [110.125,-2.125] };
  const tapped = { ...base, pressSerial: 3, pressPosition: [110.125,-2.125], position: [135.125,-1.875] };
  assert.deepEqual(participantPressEvents([base],[tapped]), [{ actorId: 'phone', count: 3, position: [110.125,-2.125], pressSerial: 3 }], 'Three fully released presses use their retained source, not the later pointer location.');
  assert.deepEqual(participantPressEvents([tapped],[{ ...tapped, holding: true, position: [112,-2] }]), [], 'Renewals and moves do not replay accepted presses.');
  assert.deepEqual(participantPressEvents([tapped],[{ ...tapped, pressSerial: 5, holding: true }])[0].count, 2);
  assert.equal(participantPressEvents([base],[{ ...tapped, pressSerial: 100 }])[0].count, 4, 'One coalesced packet has a bounded catch-up budget.');
  assert.deepEqual(participantPressEvents([base],[tapped], { baselineReady: false }), [], 'A new epoch or reloaded projection never replays old snapshots.');
  assert.deepEqual(participantPressEvents([],[tapped]), [], 'An actor first observed after reconnect establishes a baseline.');
  assert.deepEqual(participantPressEvents([tapped],[base]), [], 'A reset counter never runs backward into old history.');
  assert.deepEqual(participantPressEvents([base],[{ ...base, pressSerial: 1, pressPosition: [110.125,-2.125] }])[0].count, 1, 'The first new accepted press after reset is visible.');
  assert.deepEqual(participantPressEvents([base],[{ ...tapped, pressSerial: 4, pressPosition: [NaN,0] }]), []);
  const legacy = { id: 'legacy', role: 'participant', holding: false, position: [110.125,-2.125] };
  assert.equal(participantPressEvents([legacy],[{ ...legacy, holding: true }])[0].count, 1, 'Older senders retain their held-edge feedback.');
  assert.deepEqual(participantPressEvents([{ ...legacy, holding: true }],[{ ...legacy, holding: true, position: [135,-2] }]), []);
});

test('actual Main bells pulse the exact geographic brush and deduplicate after the pulse expires', async () => {
  const { ExtinctionFeedback } = await import('./visual-assets/extinction-feedback.js');
  const cues = new ExtinctionFeedback(), rect = { x: 20, y: 10, width: 960, height: 380 };
  const message = Object.freeze({ eventId: 'main:1', key: '400,0', position: Object.freeze([.25,.4]),
    radiusDegrees: .85, wallAt: 8_000_000, serverNow: 8_000_025 });
  const event = cues.triggerBell(message, { now: 1000 });
  assert.equal(event.at, 975, 'Age uses venue-relative time, without depending on the phone wall clock.');
  const ctx = context(); ctx.rings = [];
  ctx.ellipse = (x,y,rx,ry) => ctx.rings.push([x,y,rx,ry,ctx.globalAlpha,ctx.strokeStyle]);
  cues.draw(ctx, { rect, now: 1100 });
  assert.deepEqual(ctx.rings[0].slice(0,4), [260,162,17,17], 'The first ring matches the .85-degree rain footprint exactly.');
  assert.ok(ctx.rings[0][4] > .5, 'A played bell has an unmistakable temporary brush accent.');
  assert.ok(ctx.rings[1][2] > ctx.rings[0][2]);
  assert.equal(ctx.globalAlpha, .37);
  assert.equal(cues.triggerBell(message, { now: 1100 }), null);
  assert.equal(cues.hasAnimation(2600), true, 'One final clean frame clears an expired pulse, including on a static reduced-motion map.');
  assert.equal(cues.draw(ctx, { rect, now: 2600 }), 0);
  assert.equal(cues.hasAnimation(2600), false);
  assert.equal(cues.triggerBell({ ...message, serverNow: message.wallAt }, { now: 3000 }), null, 'A later replay of the same event does not flash again.');
  assert.equal(cues.total, 1);
});

test('bell brush feedback rejects malformed and stale events and keeps reduced-motion rings still', async () => {
  const { ExtinctionFeedback } = await import('./visual-assets/extinction-feedback.js');
  const cues = new ExtinctionFeedback(), base = { eventId: 'main:2', position: [.5,.5], radiusDegrees: .85, wallAt: 5000, serverNow: 5000 };
  for (const change of [{ position: [NaN,.5] }, { position: [2,.5] }, { radiusDegrees: 0 }, { radiusDegrees: Infinity },
    { serverNow: NaN }, { wallAt: undefined }, { serverNow: 6500 }]) {
    assert.equal(cues.triggerBell({ ...base, ...change }, { now: 1000 }), null);
  }
  cues.triggerBell(base, { now: 1000 });
  const frames = [];
  for (const now of [1020,1250,1700]) {
    const ctx = context(); ctx.rings = [];
    ctx.ellipse = (x,y,rx,ry) => ctx.rings.push([x,y,rx,ry]);
    cues.draw(ctx, { rect: { x: 0, y: 0, width: 480, height: 190 }, now, reducedMotion: true });
    frames.push(ctx.rings);
  }
  assert.deepEqual(frames[0], frames[1]); assert.deepEqual(frames[1], frames[2]);
});
