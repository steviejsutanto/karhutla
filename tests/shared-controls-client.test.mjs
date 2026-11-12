import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedConnection } from '../app/shared-client.js';

function environment(t) {
  const sockets = [], intervals = new Map(), timeouts = new Map(), session = new Map(), local = new Map(), clients = [];
  let nextTimer = 0, now = 0;
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = new URL(url); this.readyState = Socket.OPEN; this.handlers = new Map(); this.sent = []; sockets.push(this); }
    addEventListener(name, callback) { this.handlers.set(name, [...(this.handlers.get(name) || []), callback]); }
    emit(name, value) { for (const callback of this.handlers.get(name) || []) callback(value); }
    send(value) { this.sent.push(JSON.parse(value)); }
    message(value) { this.emit('message', { data: JSON.stringify(value) }); }
    close(code = 1000) { this.readyState = 3; this.emit('close', { code }); }
  }
  const storage = values => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) });
  const replacements = {
    WebSocket: Socket, location: { href: 'http://127.0.0.1:4173/operator-remote', protocol: 'http:' },
    localStorage: storage(local), sessionStorage: storage(session), performance: { now: () => now },
    setInterval: (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay }); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = ++nextTimer; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
  };
  const originals = new Map();
  for (const [key, value] of Object.entries(replacements)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const client of clients) client.destroy();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const connect = options => { const client = new SharedConnection(options); clients.push(client); return client; };
  const welcome = (client, epoch = 'controls-epoch') => client.socket.message({ type: 'welcome', role: 'operator', view: client.view,
    epoch, connectionId: 'controls-connection', participantNumber: 0 });
  const state = (client, extra = {}) => client.socket.message({ type: 'state', view: 'controls', epoch: 'controls-epoch',
    bootstrapAvailable: false, ready: true, simulation: { parameters: { fireReturnSeconds: 9 } },
    scene: { id: 'participation', audienceEnabled: true }, ...extra });
  return { sockets, intervals, timeouts, session, local, connect, welcome, state, at: value => { now = value; } };
}

test('controls view has a separate persistent operator identity and consumes self-contained state without baselines', t => {
  const f = environment(t), states = [];
  f.session.set('wildfire-operator-client-id', 'main-preview-identity');
  f.session.set('wildfire-operator-controls-client-id', 'remembered-controls-identity');
  const controls = f.connect({ role: 'operator', view: 'controls', onState: (value, meta) => states.push({ value, meta }) });
  const preview = f.connect({ role: 'operator' });
  assert.equal(controls.socket.url.searchParams.get('view'), 'controls');
  assert.equal(controls.socket.url.searchParams.get('role'), 'operator');
  assert.equal(controls.clientId, 'remembered-controls-identity');
  assert.equal(preview.clientId, 'main-preview-identity');
  assert.equal(preview.socket.url.searchParams.has('view'), false);
  f.welcome(controls); f.state(controls);
  assert.equal(controls.ready, true); assert.equal(controls.revision, null);
  assert.equal(states.length, 1); assert.equal(states[0].meta.reset, false);
  assert.equal(controls.begin([110, -2]), true, 'The transport retains ordinary authenticated operator permissions.');
  f.state(controls, { epoch: 'replacement-epoch' });
  assert.equal(states.at(-1).meta.reset, true);
  assert.equal(controls.epoch, 'replacement-epoch'); assert.equal(controls.holding, false);
  assert.equal(controls.socket.sent.some(value => value.type === 'resync'), false);
  assert.equal(controls.revision, null);
});

test('destroy releases a live gesture and cancels heartbeat, movement and obsolete socket callbacks', t => {
  const f = environment(t), updates = [], connections = [];
  const client = f.connect({ role: 'operator', view: 'controls', onState: value => updates.push(value), onConnection: value => connections.push(value) });
  f.welcome(client); f.state(client); client.begin([110, -2]);
  f.at(10); client.move([111, -2]);
  const oldSocket = client.socket, movement = [...f.timeouts.values()][0].callback;
  const heartbeat = [...f.intervals.values()][0].callback;
  const messages = updates.length, notifications = connections.length;
  client.destroy();
  assert.equal(oldSocket.sent.at(-1).holding, false);
  assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
  assert.equal(client.socket, null); assert.equal(client.connected, false); assert.equal(client.ready, false);
  oldSocket.message({ type: 'state', epoch: 'obsolete', bootstrapAvailable: false });
  movement(); heartbeat(); client.connect(); client.destroy();
  assert.equal(f.sockets.length, 1);
  assert.equal(updates.length, messages); assert.equal(connections.length, notifications);
  assert.equal(client.begin([110, -2]), false);
});

test('destroy cancels a pending reconnect and suppresses a retry callback that was already dispatched', t => {
  const f = environment(t);
  const client = f.connect({ role: 'operator', view: 'controls' });
  f.welcome(client); f.state(client);
  client.socket.close(1006);
  assert.equal(f.timeouts.size, 1);
  const reconnect = [...f.timeouts.values()][0].callback;
  client.destroy();
  assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
  reconnect();
  assert.equal(f.sockets.length, 1); assert.equal(client.reconnectTimer, null);
});

test('authorization teardown from the disconnect callback cannot schedule a new reconnect after destruction', t => {
  const f = environment(t);
  const client = f.connect({ role: 'operator', view: 'controls' });
  client.onConnection = status => { if (status === 'disconnected') client.destroy(); };
  client.socket.close(1006);
  assert.equal(client.destroyed, true);
  assert.equal(f.timeouts.size, 0); assert.equal(f.intervals.size, 0);
});
