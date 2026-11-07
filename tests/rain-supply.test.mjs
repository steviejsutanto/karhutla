import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedRoom } from '../app/shared-room.mjs';
import { BRUSH_RADIUS, CELL_SIZE } from '../app/simulation.js';
import { rainSupplyCapacity, createRainSupply, advanceRainSupply, rainSupplyState, RAIN_REFILL_SECONDS, RAIN_SUPPLY_FACTOR } from '../app/rain-supply.mjs';

const area = Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2;
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
async function fixture() {
  const time = { now: 0 };
  const room = new SharedRoom({ records: [{ longitude: 110.125, latitude: -2.125 }], clock: () => time.now, wallClock: () => 100000 + time.now });
  await room.bootstrap(); await room.setScene({ scene: 'participation' });
  const phone = room.connect({ clientId: 'rain-supply-phone', scope: 'indonesia' });
  let seq = 0;
  const hold = (holding, start = false) => room.hold(phone.connectionId, { type: 'hold', epoch: room.epoch, seq: seq++, holding, start, space: 'country', position: [.336, .48] });
  const advance = milliseconds => { time.now += milliseconds; room.advance(); };
  return { room, time, phone, hold, advance, supply: () => room.phoneState(phone.connectionId).rainSupply };
}

test('a full supply increases 1.5 times to 50.25 seconds and automatically refills in twelve idle seconds', () => {
  const capacity = rainSupplyCapacity(); assert.equal(capacity, 33.5 * 1.5); assert.equal(RAIN_REFILL_SECONDS, 12);
  const supply = createRainSupply(); supply.touching = true;
  advanceRainSupply(supply, capacity * 1000, capacity, true);
  assert.equal(supply.level, 0); assert.equal(supply.needsRelease, true);
  advanceRainSupply(supply, 60000, capacity, false); assert.equal(supply.level, 0, 'A finger still down cannot refill.');
  supply.touching = false; supply.needsRelease = false;
  advanceRainSupply(supply, 66000, capacity); close(supply.level, .5);
  advanceRainSupply(supply, 72000, capacity); assert.equal(supply.level, 1);
});

test('custom capacities also increase 1.5 times and the phone protocol keeps clean millisecond values', () => {
  assert.equal(RAIN_SUPPLY_FACTOR, 1.005);
  const cases = [
    { parameters: undefined, strength: .54, oldCapacity: 33.5, expected: 50.25 },
    { parameters: { rainResponseSeconds: 10, deepCoolingSeconds: 30, extinctionHoldSeconds: 8 }, strength: .45, oldCapacity: 67, expected: 100.5 },
    { parameters: { deepCoolingSeconds: 240, extinctionHoldSeconds: 60, rainResponseSeconds: 20 }, strength: .45, oldCapacity: 425.45, expected: 638.175 },
  ];
  for (const { parameters, strength, oldCapacity, expected } of cases) {
    const capacity = rainSupplyCapacity(parameters, strength);
    assert.equal(capacity, expected); close(capacity, oldCapacity * 1.5);
    const state = rainSupplyState(createRainSupply(), capacity);
    assert.equal(JSON.parse(JSON.stringify(state)).capacitySeconds, expected);
    assert.ok(JSON.stringify(state).includes(`"capacitySeconds":${expected}`));
    assert.equal(state.rechargeSeconds, 12);
  }
});

test('the authority exhausts the fractional final quarter second without adding water afterward', async () => {
  const f = await fixture(); f.hold(true, true);
  assert.equal(f.room.rainCapacity(), 50.25);
  for (let index = 0; index < 100; index++) { f.advance(500); f.hold(true); }
  assert.equal(f.room.phoneState(f.phone.connectionId).own.holding, true);
  f.advance(250);
  assert.equal(f.supply().level, 0); assert.equal(f.supply().needsRelease, true);
  assert.equal(f.room.phoneState(f.phone.connectionId).own.holding, false);
  const water = f.room.simulation.totalWater; close(water, area * .54 * 50.25);
  for (let index = 0; index < 4; index++) { f.advance(500); f.hold(true, true); }
  assert.equal(f.supply().level, 0); close(f.room.simulation.totalWater, water);
});

test('authority stops at the exact empty boundary, heartbeats cannot restart or recharge, release recharges automatically', async () => {
  const f = await fixture(); f.hold(true, true);
  const capacity = f.room.rainCapacity();
  for (let index = 0; index < capacity * 2; index++) { f.advance(500); f.hold(true); }
  assert.equal(f.supply().level, 0); assert.equal(f.supply().needsRelease, true);
  assert.equal(f.room.phoneState(f.phone.connectionId).own.holding, false);
  const water = f.room.simulation.totalWater; close(water, area * .54 * capacity);
  for (let index = 0; index < 20; index++) { f.advance(500); assert.equal(f.hold(true, true).holding, false); }
  assert.equal(f.supply().level, 0); assert.equal(f.room.simulation.totalWater, water);
  f.hold(false); f.advance(6000); close(f.supply().level, .5);
  f.advance(6000); assert.equal(f.supply().level, 1);
  assert.equal(f.room.simulation.totalWater, water);
  assert.equal(f.hold(true, true).holding, true);
});

test('a delayed tick cannot pour past the remaining supply or grant a packet water bonus', async () => {
  const f = await fixture(), participant = f.room.connections.get(f.phone.connectionId);
  participant.rainSupply.level = .01;
  f.hold(true, true);
  for (let i = 0; i < 10; i++) f.hold(true);
  assert.equal(participant.rainSupply.level, .01); assert.equal(f.room.simulation.totalWater, 0);
  f.advance(1500);
  close(f.room.simulation.totalWater, area * .54 * f.room.rainCapacity() * .01);
  assert.equal(f.supply().level, 0); assert.equal(f.supply().touching, true);
  assert.equal(f.room.phoneState(f.phone.connectionId).own.holding, false);
});

test('reconnecting retains the used supply and idle offline time refills without a reset exploit', async () => {
  const f = await fixture(); f.hold(true, true);
  for (let i = 0; i < 20; i++) { f.advance(500); f.hold(true); }
  close(f.supply().level, 1 - 10 / f.room.rainCapacity(), 1e-4);
  const replacement = f.room.connect({ clientId: 'rain-supply-phone', scope: 'indonesia' });
  close(replacement.rainSupply.level, 1 - 10 / f.room.rainCapacity(), 1e-4);
  f.room.disconnect(replacement.connectionId); f.advance(1200);
  const rejoined = f.room.connect({ clientId: 'rain-supply-phone', scope: 'indonesia' });
  close(rejoined.rainSupply.level, 1 - 10 / f.room.rainCapacity() + .1, 1e-4);
  assert.equal(rejoined.rainSupply.touching, false);
});

test('pause releases rain and idle refill continues without adding water', async () => {
  const f = await fixture(); f.hold(true, true);
  for (let i = 0; i < 20; i++) { f.advance(500); f.hold(true); }
  await f.room.setScene({ action: 'pause' });
  const water = f.room.simulation.totalWater; f.advance(12000);
  assert.equal(f.supply().level, 1); assert.equal(f.supply().touching, false);
  assert.equal(f.room.simulation.totalWater, water);
});
