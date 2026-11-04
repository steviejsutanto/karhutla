import test from 'node:test';
import assert from 'node:assert/strict';
import { createBellRelay } from './bell-relay.mjs';

function fixture() {
  let clock = 10000;
  const messages = [], scene = { id: 'participation', paused: false };
  const room = { epoch: 'e1', bootstrapAvailable: false, national: { fireKeys: new Set(['400,0']) },
    simulation: { totalWater: 12, cells: new Map([['400,0', { extinguished: true, heat: 0 }]]) }, sceneState: () => scene };
  const relay = createBellRelay({ room, deliver: message => messages.push(message), now: () => clock });
  const event = (extra = {}) => ({ type: 'bell', epoch: room.epoch, eventId: 'bell-one', key: '400,0', position: [.3, .4], radiusDegrees: .85, wallAt: clock + 20, ...extra });
  return { room, messages, scene, relay, event, advance: ms => { clock += ms; } };
}
test('only Main can relay a current out-source bell, retaining the brush anchor and exact onset clock without changing simulation', () => {
  const { room, messages, relay, event } = fixture();
  const before = structuredClone(room.simulation);
  for (const role of ['participant', 'projection']) assert.throws(() => relay.publish(role, event()));
  assert.equal(relay.publish('operator', event()), true);
  assert.deepEqual(messages, [{ ...event(), serverNow: 10000 }]);
  assert.deepEqual(room.simulation, before);
  assert.equal(relay.publish('operator', event()), false, 'A duplicate cannot pulse twice.');
});
test('bell feedback rejects stale, malformed, hot-source and ineligible-scene cues', () => {
  const { room, scene, relay, event, messages } = fixture();
  for (const patch of [{ epoch: 'old' }, { key: 'missing' }, { position: [NaN, .5] }, { position: [1.2, .5] }, { radiusDegrees: 3 },
    { wallAt: 7000 }, { eventId: '<html>' }, { extra: true }, { eventId: '' }]) assert.throws(() => relay.publish('operator', event(patch)));
  room.simulation.cells.get('400,0').extinguished = false; assert.throws(() => relay.publish('operator', event()));
  room.simulation.cells.get('400,0').extinguished = true; scene.paused = true; assert.throws(() => relay.publish('operator', event()));
  scene.paused = false; scene.id = 'final-rain'; assert.throws(() => relay.publish('operator', event()));
  assert.equal(messages.length, 0);
  scene.id = 'forest-takeover'; assert.equal(relay.publish('operator', event()), true);
});
test('ephemeral visual traffic stays bounded and an epoch reset permits fresh identities without replaying history', () => {
  const { room, messages, relay, event, advance } = fixture();
  for (let index = 0; index < 20; index++) assert.equal(relay.publish('operator', event({ eventId: `bell-${index}` })), true);
  assert.equal(relay.publish('operator', event({ eventId: 'overflow' })), false);
  advance(1001); assert.equal(relay.publish('operator', event({ eventId: 'overflow' })), true);
  room.epoch = 'e2'; assert.equal(relay.publish('operator', event({ eventId: 'bell-0' })), true);
  assert.equal(messages.length, 22);
});
