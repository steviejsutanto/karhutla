import test from 'node:test';
import assert from 'node:assert/strict';
import { mountProjectionFullscreen } from '../app/projection-fullscreen.js';

function target() {
  const events = new Map();
  return {
    addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
    removeEventListener(name, listener) { events.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of events.get(name) ?? []) listener(); },
    count(name) { return events.get(name)?.size ?? 0; },
  };
}
function fixture(t, { pathname = '/projection', search = '?fullscreen=1', embedded = false, hidden = false, denied = false } = {}) {
  const calls = [], changes = [], errors = [], attributes = new Map();
  const document = { ...target(), fullscreenElement: null, hidden };
  const window = {}; window.top = embedded ? {} : window;
  const stage = { dataset: {}, async requestFullscreen() {
    calls.push(['enter', this]);
    if (denied) throw new DOMException('User gesture required', 'NotAllowedError');
    document.fullscreenElement = this; document.dispatch('fullscreenchange');
  } };
  document.exitFullscreen = async () => { calls.push(['exit']); document.fullscreenElement = null; document.dispatch('fullscreenchange'); };
  const button = { ...target(), disabled: false, title: '', setAttribute(name, value) { attributes.set(name, value); } };
  const control = mountProjectionFullscreen({ stage, button, document, window, location: { pathname, search },
    beforeChange: () => calls.push(['end-gesture']), onChange: value => changes.push(value), onError: message => errors.push(message) });
  t.after(() => control.destroy());
  return { stage, button, document, calls, changes, errors, attributes, control,
    allow() { denied = false; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('ready opts into the exact stage once, drives sizing from native state, and Escape stays out', async t => {
  const f = fixture(t);
  assert.deepEqual(f.calls, [], 'Mount does not request fullscreen before Projection assets are ready.');
  assert.equal(f.stage.dataset.fullscreen, 'false');
  assert.equal(await f.control.ready(), true);
  assert.deepEqual(f.calls, [['end-gesture'], ['enter', f.stage]]);
  assert.equal(f.document.fullscreenElement, f.stage); assert.equal(f.stage.dataset.fullscreen, 'true');
  assert.deepEqual(f.changes, [true]); assert.equal(f.attributes.get('aria-label'), 'Exit projection fullscreen');
  f.document.fullscreenElement = null; f.document.dispatch('fullscreenchange');
  assert.equal(f.stage.dataset.fullscreen, 'false'); assert.deepEqual(f.changes, [true, false]);
  await f.control.ready(); f.document.dispatch('fullscreenchange');
  assert.equal(f.calls.length, 2, 'Escape/fullscreenchange and repeated ready calls do not retry automatically.');
  f.button.dispatch('click'); await settle();
  assert.equal(f.document.fullscreenElement, f.stage, 'A real manual click can enter after Escape.');
  assert.deepEqual(f.changes, [true, false, true]);
  await f.control.toggle(); assert.equal(f.document.fullscreenElement, null);
  assert.deepEqual(f.calls.at(-1), ['exit']); assert.deepEqual(f.changes, [true, false, true, false]);
});

test('ordinary routes, operator previews, and embedded pages never request automatic fullscreen', async t => {
  for (const options of [{ search: '' }, { search: '?fullscreen=0' }, { pathname: '/study' },
    { pathname: '/operator' }, { search: '?fullscreen=1&operator-preview=1' },
    { search: '?fullscreen=1&operator-preview=0' }, { embedded: true }]) {
    const f = fixture(t, options); await f.control.ready();
    assert.deepEqual(f.calls, [], JSON.stringify(options));
    assert.equal(f.stage.dataset.fullscreen, 'false'); assert.equal(f.button.disabled, false);
  }
  const trailingSlash = fixture(t, { pathname: '/projection/' });
  assert.equal(await trailingSlash.control.ready(), true);
});

test('a native permission rejection keeps a clear manual recovery action and never fakes fullscreen', async t => {
  const f = fixture(t, { denied: true });
  assert.equal(await f.control.ready(), false);
  assert.equal(f.document.fullscreenElement, null); assert.equal(f.stage.dataset.fullscreen, 'false');
  assert.equal(f.button.disabled, false); assert.match(f.button.title, /unavailable.*Click to enter/i);
  assert.equal(f.attributes.get('aria-label'), 'Enter projection fullscreen');
  assert.deepEqual(f.errors, ['Fullscreen unavailable. Click the fullscreen button to try again.']);
  assert.deepEqual(f.changes, []);
  await f.control.ready(); assert.equal(f.calls.length, 2, 'A denied automatic attempt is not retried.');
  f.allow(); f.button.dispatch('click'); await settle();
  assert.equal(f.document.fullscreenElement, f.stage); assert.equal(f.stage.dataset.fullscreen, 'true');
  assert.deepEqual(f.changes, [true]); assert.equal(f.button.title, 'Exit projection fullscreen');
  assert.equal(f.button.disabled, false);
});

test('hidden ready pages wait for visibility once, and destruction removes deferred work', async t => {
  const f = fixture(t, { hidden: true });
  await f.control.ready(); await f.control.ready();
  assert.deepEqual(f.calls, []); assert.equal(f.document.count('visibilitychange'), 1);
  f.document.dispatch('visibilitychange'); assert.deepEqual(f.calls, []);
  f.document.hidden = false; f.document.dispatch('visibilitychange'); await settle();
  assert.equal(f.document.fullscreenElement, f.stage); assert.equal(f.document.count('visibilitychange'), 0);
  f.document.fullscreenElement = null; f.document.dispatch('fullscreenchange');
  f.document.dispatch('visibilitychange'); await settle(); assert.equal(f.calls.length, 2);
  const stopped = fixture(t, { hidden: true }); await stopped.control.ready(); stopped.control.destroy();
  stopped.document.hidden = false; stopped.document.dispatch('visibilitychange'); stopped.button.dispatch('click');
  await settle(); assert.deepEqual(stopped.calls, []); assert.equal(stopped.document.count('fullscreenchange'), 0);
});

test('manual intent supersedes deferred automatic work, and an unrelated fullscreen element is not claimed', async t => {
  const f = fixture(t, { hidden: true }); await f.control.ready();
  await f.control.toggle(); await f.control.toggle();
  f.document.hidden = false; f.document.dispatch('visibilitychange'); await f.control.ready();
  assert.equal(f.document.fullscreenElement, null); assert.equal(f.calls.length, 4);
  const other = fixture(t); other.document.fullscreenElement = {};
  other.document.dispatch('fullscreenchange'); assert.equal(other.stage.dataset.fullscreen, 'false');
  assert.equal(await other.control.ready(), false); assert.deepEqual(other.calls, []); assert.deepEqual(other.changes, []);
});

test('a resolved native call without the stage entering fullscreen is not reported as success', async t => {
  const f = fixture(t); f.stage.requestFullscreen = async () => {};
  assert.equal(await f.control.ready(), false); assert.equal(f.stage.dataset.fullscreen, 'false');
  assert.deepEqual(f.changes, []); assert.equal(f.errors.length, 1); assert.equal(f.button.disabled, false);
});
