import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedConnection } from '../app/shared-client.js';

function storage(initial = []) {
  const values = new Map(initial);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

function fixture(t, role = 'participant') {
  const sockets = [], intervals = [], timeouts = [];
  const time = { now: 0 };
  class Socket {
    static OPEN = 1;
    constructor(url) {
      this.url = new URL(url);
      this.readyState = Socket.OPEN;
      this.handlers = new Map();
      this.sent = [];
      sockets.push(this);
    }
    addEventListener(name, handler) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(handler);
    }
    send(raw) {
      assert.equal(this.readyState, Socket.OPEN, 'Only an open connection may send input.');
      this.sent.push(JSON.parse(raw));
    }
    emit(name, event) { for (const handler of this.handlers.get(name) || []) handler(event); }
    message(message) { this.emit('message', { data: JSON.stringify(message) }); }
    close(code = 1006) { this.readyState = 3; this.emit('close', { code }); }
  }
  const local = storage(), session = storage();
  const replacements = {
    WebSocket: Socket,
    location: { href: 'http://127.0.0.1:4173/join', protocol: 'http:' },
    localStorage: local,
    sessionStorage: session,
    performance: { now: () => time.now },
    clearTimeout: timer => { const index = timeouts.indexOf(timer); if (index >= 0) timeouts.splice(index, 1); },
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout: (callback, delay) => { const timer = { callback, delay, at: time.now + delay }; timeouts.push(timer); return timer; },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const states = [], actors = [], bells = [], errors = [], statuses = [];
  const connection = new SharedConnection({ role, onBell: message => bells.push(message), onActors: message => actors.push(message), onState: (message, meta) => states.push({ message, meta }), onError: message => errors.push(message), onConnection: state => statuses.push(state) });
  const assignment = { id: 'sumatra', name: 'Sumatra', color: '#b5b9a2' };
  const welcome = (socket = connection.socket, epoch = 'epoch-1') => socket.message({ type: 'welcome', epoch, connectionId: `connection-${sockets.indexOf(socket)}`, participantNumber: role === 'participant' ? 1 : 0, assignment: role === 'participant' ? assignment : null });
  const summary = (extra = {}, socket = connection.socket) => socket.message({ type: 'summary', epoch: 'epoch-1', assignment, participantNumber: 1, bootstrapAvailable: false, own: { id: connection.clientId, holding: false }, region: { surfaceWetness: .2, moisture: .1, heat: .8, fireCells: 10, extinguishedCells: 0, activeCount: 0 }, ...extra });
  const baseline = (extra = {}, socket = connection.socket) => socket.message({ type: 'state', epoch: 'epoch-1', revision: 1, bootstrapAvailable: false, participants: [], simulation: { wireFormat: 'compact-v1', delta: false, totalWater: 0, cells: [[110.125, -2.125, 0, 0, 1, false, 0, true]] }, ...extra });
  const acknowledge = (holding = true, seq = connection.seq, epoch = connection.epoch) => connection.socket.message({ type: 'ack', epoch, seq, holding });
  return { connection, sockets, intervals, timeouts, local, session, states, actors, bells, errors, statuses, welcome, summary, baseline, acknowledge, assignment, time };
}

test('exhaustion stops rain while preserving the physical touch and sends a real release before refill', t => {
  const f = fixture(t); f.welcome(); f.summary({ rainSupply: { level: 1, needsRelease: false } });
  f.connection.begin([.5, .5]); f.acknowledge();
  f.summary({ rainSupply: { level: 0, needsRelease: true, touching: true } });
  assert.equal(f.connection.holding, false); assert.equal(f.connection.inputHeld, true);
  assert.deepEqual(f.errors, []);
  const count = f.connection.socket.sent.length;
  f.time.now = 1000; f.intervals[0].callback();
  assert.equal(f.connection.socket.sent.length, count + 1);
  assert.equal(f.connection.socket.sent.at(-1).holding, true, 'Keepalive tells the authority the finger remains down.');
  assert.equal(f.connection.begin([.6, .5]), false);
  f.connection.stop(); assert.equal(f.connection.socket.sent.at(-1).holding, false);
  assert.equal(f.connection.inputHeld, false);
  f.summary({ rainSupply: { level: .2, needsRelease: false, touching: false } });
  assert.equal(f.connection.begin([.5, .5]), true);
});

test('live phone mixer summaries reach the audio consumer without resetting an active gesture', t => {
  const f = fixture(t); f.welcome(); f.summary();
  f.connection.begin([.5, .5]); f.acknowledge();
  const settings = { phoneMixer: { overall: .8, crackle: .4, rain: 1.2, crickets: .7, birds: 1.5, drone: 1.8 } };
  const sent = f.connection.socket.sent.length;
  f.summary({ own: { id: f.connection.clientId, holding: true }, soundSettings: settings });
  assert.deepEqual(f.states.at(-1).message.soundSettings, settings);
  assert.equal(f.connection.holding, true);
  assert.equal(f.connection.inputHeld, true);
  assert.equal(f.connection.socket.sent.length, sent, 'A mixer broadcast is not a new input gesture.');
  assert.deepEqual(f.errors, []);
});

test('bell cues use their own current-epoch callback and Main-only publication without changing a held gesture', t => {
  const { connection, welcome, baseline, bells, errors } = fixture(t, 'operator');
  const detail = { eventId: 'bell-1', key: '400,0', position: [.3, .4], radiusDegrees: .85, wallAt: 1000 };
  assert.equal(connection.sendBellFeedback(detail), false); welcome(); baseline(); connection.begin([110.125, -2.125]);
  const seq = connection.seq; assert.equal(connection.sendBellFeedback(detail), true);
  assert.deepEqual(connection.socket.sent.at(-1), { type: 'bell', epoch: 'epoch-1', ...detail });
  assert.equal(connection.seq, seq); assert.equal(connection.holding, true);
  connection.socket.message({ type: 'bell', epoch: 'old', ...detail }); assert.equal(bells.length, 0);
  connection.socket.message({ type: 'bell', epoch: 'epoch-1', ...detail }); assert.equal(bells.length, 1); assert.equal(connection.holding, true);
  assert.deepEqual(errors, []);
});

test('display accepts a fresh baseline followed by contiguous deltas without reconstructing full packets', t => {
  const { connection, welcome, baseline, states } = fixture(t, 'operator');
  welcome();
  assert.equal(connection.canPour, false, 'A welcome alone is not a simulation baseline.');
  baseline();
  assert.equal(connection.canPour, true);
  const delta = { type: 'state', epoch: 'epoch-1', baseRevision: 1, revision: 2, bootstrapAvailable: false, participants: [], simulation: { wireFormat: 'compact-v1', delta: true, totalWater: .5, cells: [[110.125, -2.125, .2, .1, .99, false, 0, true]], removed: [] } };
  connection.socket.message(delta);
  assert.equal(connection.revision, 2);
  assert.deepEqual(states.at(-1), { message: delta, meta: { reset: false } });
  assert.equal(connection.socket.sent.length, 0, 'Receiving a contiguous delta requires no extra round-trip.');
});

test('a missing display delta releases a held input and requests a fresh baseline before accepting more rain', t => {
  const { connection, welcome, baseline, states, acknowledge, intervals } = fixture(t, 'operator');
  welcome(); baseline();
  assert.equal(connection.begin([110, -2]), true);
  acknowledge();
  const before = states.length;
  connection.socket.message({ type: 'state', epoch: 'epoch-1', baseRevision: 8, revision: 9, simulation: { delta: true, cells: [] } });
  assert.equal(states.length, before, 'An unusable delta must never reach the display.');
  assert.equal(connection.canPour, false);
  assert.equal(connection.holding, false);
  assert.equal(connection.acknowledged, false);
  assert.equal(connection.revision, null);
  assert.deepEqual(connection.socket.sent.slice(-2).map(message => [message.type, message.holding]), [['hold', false], ['resync', undefined]]);
  assert.equal(connection.begin([111, -3]), false);
  baseline({ revision: 10 });
  const sent = connection.socket.sent.length;
  intervals[0].callback();
  assert.equal(connection.socket.sent.length, sent, 'A fresh baseline cannot resume a previous gesture.');
  assert.equal(connection.begin([111, -3]), true);
  assert.equal(connection.socket.sent.at(-1).start, true);
});

test('a delta from another epoch requires resync and a new baseline reports the reset', t => {
  const { connection, welcome, baseline, states } = fixture(t, 'operator');
  welcome(); baseline();
  connection.socket.message({ type: 'state', epoch: 'epoch-2', baseRevision: 1, revision: 2, simulation: { delta: true, cells: [] } });
  assert.equal(connection.socket.sent.at(-1).type, 'resync');
  assert.equal(connection.canPour, false);
  baseline({ epoch: 'epoch-2', revision: 3 });
  assert.equal(connection.epoch, 'epoch-2');
  assert.equal(states.at(-1).meta.reset, true);
  assert.equal(connection.canPour, true);
});

test('phone summaries acknowledge readiness, detect expired rain, and clear holds on reset', t => {
  const { connection, welcome, summary, acknowledge, assignment, errors, states } = fixture(t);
  welcome(); summary();
  assert.deepEqual(connection.assignment, assignment);
  assert.equal(connection.canPour, true);
  connection.begin([.25, .75]);
  summary();
  assert.equal(connection.holding, true, 'A summary already in flight before the hold acknowledgment must not cancel the new press.');
  acknowledge();
  assert.equal(connection.acknowledged, true);
  summary();
  assert.equal(connection.holding, false);
  assert.equal(connection.acknowledged, false);
  assert.match(errors.at(-1), /stopped.*press again/i);
  connection.begin([.5, .5]);
  acknowledge();
  summary({ epoch: 'epoch-2' });
  assert.equal(connection.holding, false);
  assert.equal(connection.acknowledged, false);
  assert.equal(states.at(-1).meta.reset, true);
  acknowledge(true, 100, 'epoch-1');
  assert.equal(connection.acknowledged, false, 'A delayed acknowledgment from before reset cannot reactivate rain.');
});

test('reconnect retains identity but discards gesture, queued movement, and old connection messages', t => {
  const { connection, welcome, summary, acknowledge, sockets, timeouts, intervals } = fixture(t);
  welcome(); summary();
  connection.begin([.1, .9]);
  acknowledge();
  connection.move([.9, .1]);
  const oldSocket = connection.socket, identity = connection.clientId;
  oldSocket.close();
  assert.equal(connection.holding, false);
  assert.deepEqual(connection.pendingPath, []);
  assert.equal(connection.canPour, false);
  assert.equal(timeouts.length, 1);
  timeouts.shift().callback();
  assert.equal(sockets.length, 2);
  assert.equal(connection.socket.url.searchParams.get('clientId'), identity);
  welcome(); summary();
  oldSocket.message({ type: 'ack', epoch: 'epoch-1', seq: 999, holding: true });
  oldSocket.message({ type: 'summary', epoch: 'old-epoch', bootstrapAvailable: false });
  assert.equal(connection.epoch, 'epoch-1');
  assert.equal(connection.acknowledged, false);
  intervals[0].callback();
  assert.equal(connection.socket.sent.length, 0);
  assert.equal(connection.begin([.2, .3]), true);
  assert.equal(connection.socket.sent[0].start, true);
  assert.equal(connection.socket.sent[0].seq, 1);
});

test('duplicate-tab replacement stops contribution without starting a reconnect loop', t => {
  const { connection, welcome, summary, acknowledge, timeouts, intervals, errors } = fixture(t);
  welcome(); summary();
  connection.begin([.5, .5]); acknowledge();
  connection.socket.close(4001);
  assert.equal(connection.connected, false);
  assert.equal(connection.canPour, false);
  assert.equal(connection.holding, false);
  assert.equal(timeouts.length, 0);
  const sent = connection.socket.sent.length;
  intervals[0].callback();
  assert.equal(connection.socket.sent.length, sent);
  assert.match(errors.at(-1), /another tab/i);
});

test('phone holds use normalized region input, one gesture, bounded movement batches, and renew without a new press', t => {
  const { connection, welcome, summary, timeouts, time } = fixture(t);
  welcome(); summary();
  connection.begin([0, 1]);
  assert.deepEqual(connection.socket.sent[0].position, [0, 1]);
  assert.equal(connection.socket.sent[0].space, 'region');
  assert.equal(connection.socket.sent[0].start, true);
  assert.equal(connection.begin([1, 0]), false, 'A second finger cannot create a second held contribution.');
  assert.equal(connection.socket.sent.length, 1);
  for (let index = 0; index < 1000; index += 1) connection.move([index / 999, 1 - index / 999]);
  time.now = 100;
  timeouts.shift().callback();
  assert.equal(connection.socket.sent.length, 2);
  assert.equal(connection.socket.sent[1].space, 'region');
  assert.equal(connection.socket.sent[1].start, false);
  assert.ok(connection.socket.sent[1].path.length <= 64);
  assert.deepEqual(connection.socket.sent[1].position, [1, 0]);
  connection.stop();
  assert.equal(connection.socket.sent.at(-1).holding, false);
  assert.equal(connection.socket.sent.at(-1).space, 'region');
});

test('phone identity persists in local storage while operator identity stays in session storage', t => {
  const { connection, local, session } = fixture(t);
  const phoneKey = 'wildfire-participant-client-id', operatorKey = 'wildfire-operator-client-id';
  assert.equal(local.getItem(phoneKey), connection.clientId);
  assert.equal(session.getItem(phoneKey), null);
  const reopenedPhone = new SharedConnection({ role: 'participant' });
  assert.equal(reopenedPhone.clientId, connection.clientId);
  session.setItem(operatorKey, 'operator-session-identity');
  local.setItem(operatorKey, 'irrelevant-local-operator-identity');
  const operator = new SharedConnection({ role: 'operator' });
  assert.equal(operator.clientId, 'operator-session-identity');
  assert.equal(local.getItem(operatorKey), 'irrelevant-local-operator-identity');
});

test('late acknowledgments cannot mark a later gesture confirmed or re-enable released rain', t => {
  const { connection, welcome, summary, acknowledge } = fixture(t);
  welcome(); summary();
  connection.begin([.2, .2]);
  const oldGesture = connection.seq;
  connection.stop();
  connection.begin([.8, .8]);
  acknowledge(true, oldGesture);
  assert.equal(connection.acknowledged, false);
  acknowledge();
  assert.equal(connection.acknowledged, true);
  connection.stop();
  acknowledge(true, connection.seq + 100);
  assert.equal(connection.holding, false);
  assert.equal(connection.acknowledged, false);
});


test('lightweight actors update presence immediately without changing the simulation revision', t => {
  const { connection, welcome, baseline, acknowledge, actors, states, errors } = fixture(t, 'operator');
  welcome();
  const packet = { type: 'actors', epoch: 'epoch-1', participants: [{ id: 'phone', holding: true }], joinedCount: 1, activeCount: 1 };
  connection.socket.message(packet);
  assert.equal(actors.length, 0, 'Actors alone do not establish baseline readiness.');
  baseline({ revision: 12 });
  connection.socket.message(packet);
  assert.deepEqual(actors, [packet]);
  assert.equal(states.length, 1);
  assert.equal(connection.revision, 12);
  connection.begin([110, -2]); acknowledge();
  connection.socket.message({ ...packet, participants: [{ id: connection.clientId, holding: false }] });
  assert.equal(connection.holding, false, 'Authoritative expiry stops local intent even between full updates.');
  assert.match(errors.at(-1), /stopped/);
  connection.socket.message({ ...packet, epoch: 'obsolete' });
  assert.equal(actors.length, 2, 'Actor data from other epochs is ignored.');
});

test('movement after idle sends immediately; continuous movement coalesces at ten per second', t => {
  const { connection, welcome, summary, timeouts, time } = fixture(t);
  welcome(); summary(); connection.begin([.5, .5]);
  time.now = 220;
  connection.move([.1, .2]);
  assert.equal(connection.socket.sent.length, 2, 'No periodic poll delays movement after idle.');
  assert.equal(timeouts.length, 0);
  time.now = 230;
  connection.move([.2, .3]);
  connection.move([.4, .5]);
  assert.equal(connection.socket.sent.length, 2);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 90);
  time.now = 320; timeouts.shift().callback();
  assert.equal(connection.socket.sent.length, 3);
  assert.deepEqual(connection.socket.sent.at(-1).position, [.4, .5]);
  time.now = 330; connection.move([.8, .9]);
  assert.equal(timeouts.length, 1);
  connection.stop();
  assert.equal(timeouts.length, 0, 'Release cancels pending movement so it cannot revive the gesture.');
  assert.equal(connection.socket.sent.at(-1).holding, false);
  assert.deepEqual(connection.socket.sent.at(-1).position, [.8, .9]);
});

test('projection accepts full and actor packets while never enabling input', t => {
  const { connection, welcome, baseline, states, actors } = fixture(t, 'projection');
  welcome(); baseline({ scene: { id: 'participation', audienceEnabled: true } });
  assert.equal(connection.socket.url.searchParams.get('role'), 'projection');
  assert.equal(states.length, 1); assert.equal(connection.canPour, false);
  assert.equal(connection.begin([110, -2]), false);
  connection.socket.message({ type: 'actors', epoch: 'epoch-1', participants: [], joinedCount: 0, activeCount: 0 });
  assert.equal(actors.length, 1); assert.equal(connection.socket.sent.length, 0);
});

test('scene changes clear local gestures and prevent input until participation resumes', t => {
  const { connection, welcome, summary, acknowledge } = fixture(t);
  welcome(); summary({ scene: { id: 'arrival', audienceEnabled: false } });
  assert.equal(connection.canPour, false);
  summary({ scene: { id: 'participation', audienceEnabled: true } });
  assert.equal(connection.begin([.5, .5]), true); acknowledge();
  summary({ scene: { id: 'participation', paused: true, audienceEnabled: false } });
  assert.equal(connection.holding, false); assert.equal(connection.canPour, false);
  summary({ scene: { id: 'participation', paused: false, audienceEnabled: true } });
  assert.equal(connection.holding, false); assert.equal(connection.begin([.5, .5]), true);
});
