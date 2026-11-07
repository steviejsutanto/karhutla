import test from 'node:test';
import assert from 'node:assert/strict';
import { createMainSoundControl } from '../app/main-sound-control.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
function mainState({ revision = 0, requestId = 0, requestedEnabled = false, statusRequestId = requestId,
  state = 'off', activated = false } = {}) {
  return { revision, requestId, requestedEnabled, status: { requestId: statusRequestId, state, activated } };
}
function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return { setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
        if (!next || next[1].at > end) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      now = end;
    }, count: () => timers.size };
}
function fixture({ remoteControl = false, initialState = 'off', warmed = false, enablePromise, request, report } = {}) {
  const calls = [], requests = [], reports = [], errors = [], timer = clock();
  const engine = { state: initialState, context: warmed ? { state: 'running' } : null, muted: initialState === 'muted',
    getMetrics() { return { state: this.state }; },
    enable() {
      calls.push('enable'); this.context ??= { state: 'running' }; this.muted = false; this.state = 'starting';
      return Promise.resolve(enablePromise).then(() => { if (!this.muted) this.state = 'ready'; return !this.muted; });
    },
    setMuted(value) { calls.push(['muted', value]); this.muted = value; this.state = value ? 'muted' : 'ready'; },
  };
  const control = createMainSoundControl({ engine, remoteControl,
    request: enabled => { requests.push(enabled); return request?.(enabled); },
    report: status => { reports.push(status); return report?.(status); },
    onError: value => errors.push(value), setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout });
  return { control, engine, calls, requests, reports, errors, timer };
}

test('a host gesture calls native enable synchronously and local toggles report actual state without a remote command', async t => {
  const f = fixture(); t.after(() => f.control.destroy());
  f.control.applyState(mainState(), 'show'); await settle();
  const started = f.control.toggle();
  assert.deepEqual(f.calls, ['enable'], 'Audio permission is consumed before the first asynchronous continuation.');
  await started; await settle();
  assert.equal(f.control.getState().status.state, 'ready'); assert.equal(f.control.getState().status.activated, true);
  assert.equal(f.control.getState().enabled, true); assert.deepEqual(f.requests, []);
  assert.equal(f.reports.at(-1).state, 'ready');
  await f.control.toggle(); await settle();
  assert.deepEqual(f.calls.at(-1), ['muted', true]);
  assert.equal(f.control.getState().enabled, false); assert.equal(f.reports.at(-1).state, 'muted');
});

test('a remote controller changes host intent while keeping its own engine and context untouched', async t => {
  const f = fixture({ remoteControl: true, request: enabled => mainState({ revision: 1, requestId: 1,
    requestedEnabled: enabled, statusRequestId: 0 }) });
  t.after(() => f.control.destroy()); f.control.applyState(mainState(), 'show');
  await f.control.toggle();
  assert.deepEqual(f.requests, [true]); assert.deepEqual(f.calls, []); assert.equal(f.engine.context, null);
  assert.equal(f.control.getState().pending, true); assert.equal(f.control.getState().enabled, true);
  f.control.applyState(mainState({ revision: 2, requestId: 1, requestedEnabled: true, state: 'ready', activated: true }), 'show');
  assert.equal(f.control.getState().pending, false); assert.equal(f.control.getState().status.state, 'ready');
  f.control.onStatus({ state: 'off' }); assert.equal(f.control.getState().status.state, 'ready');
  assert.deepEqual(f.reports, []);
});

test('a warmed host consumes new remote commands through the existing native enable and mute APIs', async t => {
  const f = fixture({ initialState: 'ready', warmed: true }); t.after(() => f.control.destroy());
  f.control.applyState(mainState({ state: 'ready', activated: true }), 'show');
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: false, statusRequestId: 0, state: 'ready', activated: true }), 'show');
  assert.deepEqual(f.calls, [['muted', true]]);
  f.control.applyState(mainState({ revision: 2, requestId: 2, requestedEnabled: true, statusRequestId: 1, state: 'muted', activated: true }), 'show');
  assert.deepEqual(f.calls, [['muted', true], 'enable']); await settle();
  assert.equal(f.control.getState().status.state, 'ready'); assert.equal(f.reports.at(-1).requestId, 2);
  f.control.applyState(mainState({ revision: 3, requestId: 2, requestedEnabled: true, state: 'ready', activated: true }), 'show');
  assert.equal(f.calls.length, 2, 'Repeated state packets never resume the same source bank again.');
});

test('a cold host acknowledges remote enable with a first-gesture instruction and never creates audio', async t => {
  const f = fixture(); t.after(() => f.control.destroy()); f.control.applyState(mainState(), 'show');
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: true, statusRequestId: 0 }), 'show');
  await settle(); assert.deepEqual(f.calls, []); assert.equal(f.engine.context, null);
  assert.equal(f.control.getState().status.state, 'needs-gesture');
  assert.deepEqual(f.reports.at(-1), { requestId: 1, state: 'needs-gesture', activated: false });
  await f.control.toggle(); assert.deepEqual(f.calls, ['enable']);
});

test('initial and new-epoch baselines never replay old enable commands, and stale revisions cannot roll back state', async t => {
  const f = fixture({ initialState: 'ready', warmed: true }); t.after(() => f.control.destroy());
  f.control.applyState(mainState({ revision: 8, requestId: 4, requestedEnabled: true, state: 'ready', activated: true }), 'old');
  await settle(); assert.deepEqual(f.calls, []);
  f.control.applyState(mainState({ revision: 7, requestId: 3, requestedEnabled: false }), 'old');
  assert.equal(f.control.getState().requestId, 4);
  f.control.applyState(mainState({ revision: 0, requestId: 0, requestedEnabled: false }), 'new');
  await settle(); assert.deepEqual(f.calls, []); assert.equal(f.control.getState().requestId, 0);
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: false, statusRequestId: 0 }), 'new');
  assert.deepEqual(f.calls, [['muted', true]]);
});

test('remote toggle follows actual host state after a local change rather than its last requested value', async t => {
  const f = fixture({ remoteControl: true, request: enabled => mainState({ revision: 2, requestId: 1,
    requestedEnabled: enabled, statusRequestId: 0, state: 'ready', activated: true }) });
  t.after(() => f.control.destroy());
  f.control.applyState(mainState({ revision: 1, requestedEnabled: false, state: 'ready', activated: true }), 'show');
  assert.equal(f.control.getState().enabled, true); await f.control.toggle(); assert.deepEqual(f.requests, [false]);
});

test('a failed remote request rolls its optimistic toggle back to the confirmed host status', async t => {
  const pending = deferred(), f = fixture({ remoteControl: true, request: () => pending.promise });
  t.after(() => f.control.destroy()); f.control.applyState(mainState({ state: 'ready', activated: true }), 'show');
  const change = f.control.toggle(); assert.equal(f.control.getState().enabled, false); assert.equal(f.control.getState().pending, true);
  pending.reject(new Error('Connection lost')); assert.equal(await change, false);
  assert.equal(f.control.getState().enabled, true); assert.equal(f.control.getState().pending, false);
  assert.deepEqual(f.errors, ['Connection lost']);
});

test('a newer remote mute wins over an earlier unresolved native enable', async t => {
  const pending = deferred(), f = fixture({ initialState: 'ready', warmed: true, enablePromise: pending.promise });
  t.after(() => f.control.destroy()); f.control.applyState(mainState({ state: 'ready', activated: true }), 'show');
  f.engine.setMuted(true); f.control.onStatus({ state: 'muted' }); f.calls.length = 0;
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: true, statusRequestId: 0 }), 'show');
  assert.equal(f.control.getState().pending, true);
  f.control.applyState(mainState({ revision: 2, requestId: 2, requestedEnabled: false, statusRequestId: 0 }), 'show');
  assert.equal(f.control.getState().enabled, false); pending.resolve(); await settle();
  assert.deepEqual(f.calls, ['enable', ['muted', true]]);
  assert.equal(f.control.getState().status.state, 'muted'); assert.equal(f.control.getState().pending, false);
});

test('a disconnected controller cannot send commands and a missing host acknowledgement times out', async t => {
  const f = fixture({ remoteControl: true }); t.after(() => f.control.destroy());
  assert.equal(await f.control.toggle(), false); assert.deepEqual(f.requests, []);
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: true, statusRequestId: 0 }), 'show');
  assert.equal(f.control.getState().pending, true); f.timer.advance(8000);
  assert.equal(f.control.getState().pending, false); assert.equal(f.control.getState().status.state, 'unavailable');
  assert.match(f.errors.at(-1), /host did not respond/);
  f.control.applyState(mainState({ revision: 2, requestId: 1, requestedEnabled: true, state: 'ready', activated: true }), 'show');
  assert.equal(f.control.getState().status.state, 'ready'); assert.equal(f.control.getState().pending, false);
  f.control.setConnected(false); assert.equal(await f.control.toggle(), false);
});

test('reconnection rearms the timeout for a command still waiting on its host', async t => {
  const f = fixture({ remoteControl: true }); t.after(() => f.control.destroy());
  const waiting = mainState({ revision: 1, requestId: 1, requestedEnabled: true, statusRequestId: 0 });
  f.control.applyState(waiting, 'show'); f.timer.advance(1000); f.control.setConnected(false);
  f.control.setConnected(true); f.control.applyState(waiting, 'show'); f.timer.advance(8000);
  assert.equal(f.control.getState().pending, false); assert.equal(f.control.getState().status.state, 'unavailable');
});

test('an unresolved native start is bounded and cannot leave host controls stuck starting forever', async t => {
  const pending = deferred(), f = fixture({ initialState: 'ready', warmed: true, enablePromise: pending.promise });
  t.after(() => f.control.destroy()); f.control.applyState(mainState({ state: 'ready', activated: true }), 'show');
  f.control.applyState(mainState({ revision: 1, requestId: 1, requestedEnabled: true, statusRequestId: 0 }), 'show');
  f.timer.advance(8000); await settle();
  assert.equal(f.control.getState().pending, false); assert.notEqual(f.control.getState().status.state, 'starting');
  assert.equal(f.engine.muted, true, 'A late browser resume cannot reopen a timed-out start.');
  pending.resolve(); await settle(); assert.notEqual(f.control.getState().status.state, 'ready');
});

test('old-epoch request and status responses cannot overwrite a new server baseline', async t => {
  const requestResponse = deferred(), remote = fixture({ remoteControl: true, request: () => requestResponse.promise });
  t.after(() => remote.control.destroy()); remote.control.applyState(mainState(), 'old');
  const change = remote.control.toggle(); remote.control.applyState(mainState(), 'new');
  requestResponse.resolve(mainState({ revision: 99, requestId: 8, requestedEnabled: true, state: 'ready', activated: true }));
  await change; assert.equal(remote.control.getState().requestId, 0); assert.equal(remote.control.getState().pending, false);
  let reportCount = 0;
  const statusResponse = deferred(), host = fixture({ report: () => ++reportCount === 1 ? statusResponse.promise : undefined }); t.after(() => host.control.destroy());
  host.control.applyState(mainState(), 'old'); await settle(); host.control.applyState(mainState(), 'new');
  statusResponse.resolve(mainState({ revision: 99, requestId: 8, requestedEnabled: true, state: 'ready', activated: true }));
  await settle(); assert.equal(host.control.getState().requestId, 0); assert.deepEqual(host.calls, []);
});

test('host status reports serialize so a delayed starting acknowledgement cannot overwrite later ready', async t => {
  const starting = deferred(); let server = mainState();
  const commit = payload => {
    server = { ...server, revision: server.revision + 1, status: { ...payload } };
    return server;
  };
  const f = fixture({ report: payload => payload.state === 'starting'
    ? starting.promise.then(() => commit(payload)) : commit(payload) });
  t.after(() => f.control.destroy()); f.control.applyState(server, 'show'); await settle();
  f.control.onStatus({ state: 'starting' }); await settle();
  assert.equal(f.reports.at(-1).state, 'starting');
  f.control.onStatus({ state: 'ready' }); await settle();
  assert.deepEqual(f.reports.map(value => value.state), ['off', 'starting'],
    'The newer ready report waits while the earlier status write is still in flight.');
  assert.equal(f.control.getState().status.state, 'ready', 'The host UI retains its latest actual engine status.');
  starting.resolve(); await settle();
  assert.deepEqual(f.reports.map(value => value.state), ['off', 'starting', 'ready']);
  assert.equal(server.status.state, 'ready'); assert.equal(server.status.activated, true);
  assert.equal(f.control.getState().status.state, 'ready');
});
