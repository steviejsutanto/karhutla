import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app/peat-study.js', import.meta.url), 'utf8');
const noop = () => {};
function functions(first, next) {
  const start = source.indexOf(`function ${first}(`), end = source.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('silent remote previews skip sound fields and patch voices while local Main keeps them', () => {
  const functionsSource = functions('syncStudySound', 'touchSoundAt');
  for (const remoteControl of [false, true]) {
    const calls = [];
    const patch = { key: '440,-8', longitude: 110.125, latitude: -1.875, heat: 1 };
    const context = { remoteControl, layout: { fireKeys: new Set([patch.key]) }, soundCells: new Map([[patch.key, patch]]),
      sound: { setPatches() { calls.push('patches'); }, setRainAreaContacts() { calls.push('areas'); }, setAudienceParticipationCount() { calls.push('count'); }, setPatchVoices() { calls.push('voices'); } },
      createParticipantSoundField() { calls.push('field'); return {}; }, activeSoundParticipantCount: () => 0, patchSoundVoices: () => [],
      connection: null, localSoundGeo: null, localSoundHolding: false, actors: [], operatorPreview: false,
    };
    vm.runInNewContext(`let soundField; ${functionsSource}\nsyncStudySound(); syncSoundParticipants();`, context);
    if (remoteControl) assert.deepEqual(calls, []);
    else for (const operation of ['patches', 'field', 'areas', 'count', 'voices']) assert.ok(calls.includes(operation), operation);
  }
});

test('only remote previews select economy renderers with bounded pixels and density', async () => {
  const start = source.indexOf('async function initialize() {'), end = source.indexOf('  const assetLoad =', start);
  assert.ok(start >= 0 && end > start);
  for (const remoteControl of [false, true]) {
    const options = [];
    class Renderer { constructor(_canvas, value) { options.push(value); } }
    const context = { remoteControl, reduced: { matches: false }, PeatSurface: Renderer, PeatSection: Renderer, canvas: {}, sectionCanvas: {} };
    vm.runInNewContext(`let renderer, sectionRenderer; ${source.slice(start, end)} }\nglobalThis.ready = initialize();`, context);
    await context.ready;
    assert.equal(options.length, 2);
    for (const value of options) {
      assert.equal(value.quality, remoteControl ? 'economy' : 'auto');
      assert.equal(value.maxPixelRatio, remoteControl ? 1 : undefined);
      assert.equal(value.maxPixels, remoteControl ? 640 * 360 : undefined);
    }
  }
});

function preview({ remoteControl = true, operatorPreview = true } = {}) {
  const callbacks = new Map(), events = new Map(), counts = { scenes: 0, contacts: 0, rain: 0 };
  let nextFrame = 0;
  const parent = {}, context = {
    remoteControl, operatorPreview,
    window: { parent, addEventListener(name, callback) { events.set(name, callback); } }, location: { origin: 'http://venue.test' },
    document: { hidden: false, body: { dataset: {} } },
    requestAnimationFrame(callback) { const id = ++nextFrame; callbacks.set(id, callback); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    performance: { now: () => 0 },
    assetsReady: true, layout: {}, connection: null, actors: [{ holding: true }], reduced: { matches: false },
    renderer: { hasContactAnimation: () => false, setPatches: noop, setWetCells: noop, draw() { counts.scenes++; return { drawMs: 1 }; } },
    sectionRenderer: { width: 100, height: 50, setPatches: noop, surfaceYAt: () => 0, draw: () => ({ drawMs: 1 }), drawAtmosphere: noop },
    canvas: { dataset: {} }, sectionCanvas: { dataset: {} }, atmosphereCanvas: { dataset: {} }, finalRainCanvas: { dataset: {} },
    atmosphereContext: { setTransform: noop, clearRect: noop }, finalRainContext: { setTransform: noop, clearRect: noop },
    studyPatches: () => [], orderedSectionPatches: values => values, updateCalming: noop, contactPoints: () => [],
    interpolate: noop, record: noop, percentile: () => 0, updateRegionalReadings: noop, studyCellKey: () => '', studyGeoAt: () => [0, 0],
    drawFinalSectionRain() { counts.rain++; return { intensity: 0, visualGain: 0, drops: 0 }; },
  };
  const listenerStart = source.indexOf("window.addEventListener('message', event => {"), listenerEnd = source.indexOf('\n});', listenerStart);
  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart);
  const listener = source.slice(listenerStart, listenerEnd + 4);
  const renderFunctions = functions('requestFrame', 'begin');
  vm.runInNewContext(`
    let previewRenderingVisible = true, remoteFrameRequest = null, frameStarted = true;
    let dirty = true, contactDirty = true, lastScene = -Infinity, lastContactFrame = -Infinity, lastReadout = -Infinity;
    let sectionPatches = [], sectionIndex, atmosphereCalmAreas = [], finalRainMotionMs = 0, finalRainLastFrame = null, finalRainLastPaint = -Infinity;
    const cells = new Map(), transitions = new Map(), lastPosition = [.5,.5];
    const atmosphereScale = 1, atmosphereWidth = 100, atmosphereHeight = 100, sectionScale = 1, currentScene = { paused: false };
    const metrics = { sceneDraws: 0, sceneMs: [], sectionMs: [], atmosphereMs: [], combinedMs: [], contactMs: [] };
    function drawFeedback(now) { lastContactFrame = now; contactDirty = false; globalThis.countContact(); }
    ${renderFunctions}
    ${listener}
    requestFrame();
  `, Object.assign(context, { countContact: () => counts.contacts++ }));
  return { callbacks, counts,
    message(visible, overrides = {}) { events.get('message')({ origin: context.location.origin, source: parent, data: { type: 'wildfire-preview-visibility', visible }, ...overrides }); },
    pump(now) { const [id, callback] = callbacks.entries().next().value || []; if (callback) { callbacks.delete(id); callback(now); } },
    rain(now) { context.drawFinalRain(now); },
  };
}

test('only a boolean visibility message from the owning same-origin remote page suspends rendering', () => {
  const page = preview();
  assert.equal(page.callbacks.size, 1);
  page.message(false, { origin: 'http://other.test' });
  page.message(false, { source: {} });
  page.message('false');
  assert.equal(page.callbacks.size, 1);
  page.message(false);
  assert.equal(page.callbacks.size, 0);
  page.pump(100); page.rain(100);
  assert.deepEqual(page.counts, { scenes: 0, contacts: 0, rain: 0 });
  page.message(true); page.message(true);
  assert.equal(page.callbacks.size, 1, 'Resume starts exactly one animation loop.');
  page.pump(200);
  assert.deepEqual(page.counts, { scenes: 1, contacts: 1, rain: 1 });
  assert.equal(page.callbacks.size, 1);
});

test('host and standalone projection ignore remote visibility control', () => {
  for (const options of [{ remoteControl: false }, { operatorPreview: false }]) {
    const page = preview(options);
    page.message(false);
    assert.equal(page.callbacks.size, 1);
    page.pump(0);
    assert.equal(page.counts.scenes, 1);
  }
});

test('remote rendering uses 10 fps scenes and rain, with contacts capped at 20 fps', () => {
  const remote = preview(), host = preview({ remoteControl: false });
  for (let now = 0; now <= 200; now += 10) { remote.pump(now); host.pump(now); }
  assert.deepEqual(remote.counts, { scenes: 3, contacts: 5, rain: 3 });
  assert.deepEqual(host.counts, { scenes: 5, contacts: 6, rain: 5 }, 'Local rendering retains the existing 24 fps/30 fps cadences.');
});
