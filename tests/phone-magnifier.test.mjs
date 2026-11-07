import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneMagnifier, magnifierCrop, magnifierLayout, MAGNIFIER_ZOOM } from '../app/phone-magnifier.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('a normal phone lens sits wholly above the finger with a clear gap', () => {
  const lens = magnifierLayout({ width: 390, height: 844, x: 190, y: 420 });
  assert.equal(lens.placement, 'above'); assert.equal(lens.size, 124);
  assert.equal(lens.top + lens.size, 420 - 36);
  close(lens.left + lens.size / 2, 190);
});

test('screen edges and landscape top touches choose a bounded side lens', () => {
  for (const [width, height] of [[390, 844], [320, 640], [844, 390], [568, 320]]) {
    for (const [x, y] of [[1, 1], [width - 1, 1], [width / 2, 40], [1, height - 1], [width - 1, height - 1]]) {
      const lens = magnifierLayout({ width, height, x, y });
      assert.ok(lens.left >= 12 && lens.left + lens.size <= width - 12);
      assert.ok(lens.top >= 12 && lens.top + lens.size <= height - 88);
      if (y === 40) assert.ok(['left', 'right'].includes(lens.placement));
    }
  }
});

test('bounded source crops keep the selected point at the lens crosshair even at canvas edges', () => {
  for (const [x, y] of [[320, 180], [0, 0], [640, 360], [0, 360], [640, 0]]) {
    const crop = magnifierCrop({ x, y, width: 640, height: 360, size: 124 });
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 640 && crop.y + crop.height <= 360);
    close((x - crop.x) * MAGNIFIER_ZOOM + crop.targetX, 62);
    close((y - crop.y) * MAGNIFIER_ZOOM + crop.targetY, 62);
    close(crop.targetWidth / crop.width, MAGNIFIER_ZOOM);
    close(crop.targetHeight / crop.height, MAGNIFIER_ZOOM);
  }
});

function fixture(options = {}) {
  const calls = [];
  const context = { setTransform() {}, fillRect() {}, drawImage(...args) { calls.push(args); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const source = { width: 1280, height: 720 }, canvas = { width: 0, height: 0, getContext: () => context };
  const label = { textContent: '' }, element = { hidden: false, style: {}, dataset: {}, querySelector: () => label };
  return { calls, source, canvas, element, label, lens: new PhoneMagnifier({ element, canvas, source, pixelRatio: 3, ...options }) };
}

function frames() {
  const pending = new Map(); let serial = 0;
  return { pending, requestFrame(callback) { const id = ++serial; pending.set(id, callback); return id; },
    cancelFrame(id) { pending.delete(id); },
    paint(at) { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(at); } };
}

test('a first immediate drag paints its latest crop on the next frame without waiting for the idle refresh', () => {
  const clock = frames(), f = fixture(clock);
  const state = { touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  f.lens.show(state, 0);
  for (let index = 1; index <= 12; index++) f.lens.show({ ...state,
    touch: { x: 300 + index * 4, y: 250 }, point: { x: 300 + index * 4, y: 200 } }, index);
  assert.equal(clock.pending.size, 1, 'Fast input coalesces into one small crop copy.');
  assert.equal(f.calls.length, 1, 'Pointer updates do not redraw the full source or repeat crop copies synchronously.');
  assert.equal(f.element.style.transform, 'translate(286px, 90px)', 'Lens geometry follows the latest finger position immediately.');
  clock.paint(16.7);
  assert.equal(f.calls.length, 2, 'The moved crop paints before the former 41.7 ms idle refresh.');
  const [, x, y, width, height] = f.calls.at(-1);
  close(x + width / 2, 348 * 2); close(y + height / 2, 200 * 2);
  assert.equal(clock.pending.size, 0); assert.equal(f.canvas.width, 186);
  assert.deepEqual(JSON.parse(f.element.dataset.sourcePoint), [348, 200]);
});

test('release flushes the latest queued drag once and cancellation leaves no animation work', () => {
  const clock = frames(), f = fixture(clock);
  const state = { touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  f.lens.show(state, 0); f.lens.show({ ...state, point: { x: 330, y: 200 } }, 1);
  f.lens.release();
  assert.equal(clock.pending.size, 0); assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(f.element.dataset.sourcePoint), [330, 200]);
  clock.paint(16.7); assert.equal(f.calls.length, 2, 'No old callback can repaint a released lens.');
  f.lens.show(state, 20); f.lens.show({ ...state, point: { x: 350, y: 200 } }, 21);
  assert.equal(clock.pending.size, 1); const count = f.calls.length;
  f.lens.hide(); clock.paint(33.4);
  assert.equal(clock.pending.size, 0); assert.equal(f.calls.length, count); assert.equal(f.element.hidden, true);
});

test('high-refresh phones get the first moved crop next frame but sustained copying stays within 60 Hz', () => {
  const clock = frames(), f = fixture(clock);
  const state = { touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  f.lens.show(state, 0);
  f.lens.show({ ...state, point: { x: 310, y: 200 } }, 1); clock.paint(8.33);
  assert.equal(f.calls.length, 2, 'The first move does not wait for a 60 Hz budget to open.');
  for (let index = 2; index <= 120; index++) {
    f.lens.show({ ...state, point: { x: 310 + index, y: 200 } }, index * (1000 / 120) - 1);
    clock.paint(index * (1000 / 120));
    assert.ok(clock.pending.size <= 1);
  }
  assert.ok(f.calls.length <= 62, 'A 120 Hz screen cannot double the ongoing crop work.');
  f.lens.hide(); assert.equal(clock.pending.size, 0);
});

test('lens copies only a small source region at bounded pixel density, never another viewport', () => {
  const f = fixture();
  assert.equal(MAGNIFIER_ZOOM, 2); assert.equal(f.label.textContent, '2×'); assert.equal(f.element.dataset.zoom, '2');
  f.lens.show({ touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 }, 0);
  assert.equal(f.element.hidden, false); assert.equal(f.canvas.width, 186); assert.equal(f.canvas.height, 186);
  assert.equal(f.calls.length, 1); const [source, x, y, width, height, targetX, targetY, targetWidth, targetHeight] = f.calls[0];
  assert.equal(source, f.source); close(width, 124 / 2 * 2); close(height, 124 / 2 * 2);
  assert.ok(width < source.width / 10 && height < source.height / 5);
  close(x + width / 2, 600); close(y + height / 2, 400);
  assert.equal(targetX, 0); assert.equal(targetY, 0); close(targetWidth, 124); close(targetHeight, 124);
});

test('fast pointer updates reuse one small surface and cap painting; hide stops all copying', () => {
  const f = fixture(), state = { touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  f.lens.show(state, 0);
  for (let now = 1; now <= 1000; now++) f.lens.show({ ...state, touch: { x: 300 + now / 100, y: 250 } }, now);
  assert.ok(f.calls.length <= 25); assert.equal(f.canvas.width, 186);
  const count = f.calls.length; f.lens.hide(); f.lens.draw(2000);
  assert.equal(f.element.hidden, true); assert.equal(f.lens.active, false); assert.equal(f.calls.length, count);
  assert.throws(() => new PhoneMagnifier({ element: f.element, canvas: f.source, source: f.source }), /separate source/);
});

test('a quick tap keeps one frozen lens briefly; a new press or cancellation clears its sole timer', t => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout, pending = new Map();
  let serial = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++serial; pending.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => pending.delete(id);
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const f = fixture(), state = { touch: { x: 300, y: 250 }, point: { x: 300, y: 200 }, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  f.lens.show(state, 0); f.lens.release();
  assert.equal(f.element.hidden, false); assert.equal(f.lens.active, false); assert.equal(f.lens.lingering, true);
  assert.equal(pending.size, 1); assert.equal([...pending.values()][0].delay, 450);
  const frames = f.calls.length; f.lens.draw(500); assert.equal(f.calls.length, frames, 'Released lenses do not repaint.');
  f.lens.show(state, 600); assert.equal(pending.size, 0); assert.equal(f.lens.lingering, false);
  f.lens.release(); [...pending.values()][0].callback();
  assert.equal(f.element.hidden, true); assert.equal(pending.size, 0);
});
