import test from 'node:test';
import assert from 'node:assert/strict';
import { createParticipantSoundField } from '../app/sound-participants.js';
import { createRainAreaTracker } from '../app/rain-area.js';
import { RainSimulation, BRUSH_RADIUS } from '../app/simulation.js';
import { SharedRoom } from '../app/shared-room.mjs';
import { stateFrame, statePacket, wireCellKey } from '../app/wire-state.mjs';
import { countryPoint } from '../app/country-view.mjs';

const patch = (longitude, latitude = -1.875, extinguished = false) => ({ longitude, latitude, heat: extinguished ? 0 : .8, extinguished });
const field = values => createParticipantSoundField(values);
const contact = (position = [110.125, -1.875], id = 'rain') => ({ id, position, holding: true });
const out = values => values.map(value => ({ ...value, heat: 0, extinguished: true }));
const cluster = () => Array.from({ length: 5 }, (_, x) => Array.from({ length: 5 }, (_, y) => patch(109.625 + x * .25, -2.375 + y * .25))).flat();
const wideCluster = () => Array.from({ length: 11 }, (_, x) => Array.from({ length: 11 }, (_, y) => patch(108.875 + x * .25, -3.125 + y * .25))).flat();
const insideBrush = (value, position) => Math.hypot(value.longitude - position[0], value.latitude - position[1]) <= BRUSH_RADIUS + 1e-12;

test('one complete real rain footprint creates one event after its final staggered extinction', () => {
  const tracker = createRainAreaTracker(), hot = cluster(), rain = [contact()];
  assert.deepEqual(tracker.update(field(hot), rain, 0), []);
  for (let count = 1; count < hot.length; count++) {
    const partial = hot.map((value, index) => index < count ? out([value])[0] : value);
    assert.deepEqual(tracker.update(field(partial), rain, count * .1), []);
  }
  const events = tracker.update(field(out(hot)), rain, 2.5);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].memberKeys, field(hot).patchesAt(rain[0].position).map(value => value.key).sort());
  assert.equal(events[0].key, events[0].memberKeys[0]);
  assert.deepEqual(events[0].position, field(hot).patches.find(value => value.key === events[0].key).position);
  for (let packet = 0; packet < 100; packet++) assert.deepEqual(tracker.update(field(out(hot)),
    [contact([110.125 + packet % 3 * .001, -1.875])], 2.6 + packet * .05), []);
});

test('overlapping audience and local brushes share a global area and wait for every footprint member', () => {
  const tracker = createRainAreaTracker(), hot = [patch(110.125), patch(111.125), patch(111.875)];
  const rain = [contact([110.125, -1.875], 'audience'), contact([111.125, -1.875], '__local')];
  tracker.update(field(hot), rain, 0);
  assert.deepEqual(tracker.update(field([out(hot)[0], out(hot)[1], hot[2]]), rain, .1), []);
  const events = tracker.update(field(out(hot)), rain, .2);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].memberKeys, field(hot).patches.map(value => value.key).sort());
  assert.deepEqual(tracker.update(field(out(hot)), [...rain].reverse(), .3), []);
});

test('distant independent rain areas each complete once', () => {
  const tracker = createRainAreaTracker(), hot = [patch(110.125), patch(120.125)];
  const rain = [contact(), contact([120.125, -1.875], 'far')];
  tracker.update(field(hot), rain, 0);
  assert.equal(tracker.update(field(out(hot)), rain, .1).length, 2);
});

test('release keeps an area briefly for the authoritative completion packet and expires stale areas', () => {
  for (const [delay, expected] of [[.1, 1], [2.1, 0]]) {
    const tracker = createRainAreaTracker(), hot = [patch(110.125)];
    tracker.update(field(hot), [contact()], 0);
    tracker.update(field(hot), [], .05);
    assert.equal(tracker.update(field(out(hot)), [], delay).length, expected);
    assert.deepEqual(tracker.update(field(out(hot)), [contact()], delay + .1), []);
  }
});

test('baseline out, reload, absent rainfall, and sea never claim an extinction', () => {
  const hot = [patch(110.125)], tracker = createRainAreaTracker();
  assert.deepEqual(tracker.update(field(out(hot)), [contact()], 0), []);
  assert.deepEqual(createRainAreaTracker().update(field(out(hot)), [contact()], 0), []);
  tracker.update(field(hot), [], .1);
  assert.deepEqual(tracker.update(field(out(hot)), [], .2), []);
  for (const position of [[130, -8], [NaN, 1], [181, 1], null]) {
    assert.deepEqual(tracker.update(field(hot), [contact(position)], .3), []);
  }
  assert.equal(tracker.getMetrics().areaCount, 0);
});

test('an actual member hot return re-arms the same area; reset and source removal clear history', () => {
  const tracker = createRainAreaTracker(), hot = [patch(110.125)], rain = [contact()];
  tracker.update(field(hot), rain, 0);
  const first = tracker.update(field(out(hot)), rain, .1)[0];
  tracker.update(field(hot), rain, .2);
  const second = tracker.update(field(out(hot)), rain, .3)[0];
  assert.ok(first && second); assert.notEqual(first.id, second.id);
  tracker.update(field([]), [], .4);
  assert.equal(tracker.getMetrics().areaCount + tracker.getMetrics().claimedPatchCount, 0);
  tracker.reset();
  assert.deepEqual(tracker.update(field(out(hot)), rain, .5), []);
  assert.equal(tracker.getMetrics().completedEvents, 0);
});

test('field and contact order do not change representatives or membership', () => {
  const hot = cluster(), rain = [contact(), contact([110.5, -1.875], 'another')];
  const run = (values, actors) => { const tracker = createRainAreaTracker(); tracker.update(field(values), actors, 0);
    return tracker.update(field(out(values)), actors, .1).map(({ key, memberKeys, position }) => ({ key, memberKeys, position })); };
  assert.deepEqual(run(hot, rain), run([...hot].reverse(), [...rain].reverse()));
});

test('the current footprint excludes hot cells left behind by a drag', () => {
  const tracker = createRainAreaTracker(), hot = [patch(109.375), patch(110.125), patch(110.875)];
  tracker.update(field(hot), [contact()], 0);
  const moved = [contact([110.8, -1.875])];
  tracker.update(field(hot), moved, .1);
  const events = tracker.update(field([hot[0], ...out(hot.slice(1))]), moved, .2);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].memberKeys, ['440,-8', '443,-8']);
  assert.deepEqual(events[0].brushPosition, countryPoint(moved[0].position), 'Completion follows the final brush, not the original grouping anchor.');
});

test('a released moved brush retains its final location for the late bell confirmation', () => {
  const tracker = createRainAreaTracker(), hot = [patch(109.375), patch(110.125), patch(110.875)];
  tracker.update(field(hot), [contact()], 0);
  const moved = [contact([110.8, -1.875])];
  tracker.update(field(hot), moved, .1);
  tracker.update(field(hot), [], .15);
  const events = tracker.update(field([hot[0], ...out(hot.slice(1))]), [], .2);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].brushPosition, countryPoint(moved[0].position));
});

test('overlapping brushes center their shared completion between current contacts regardless of order', () => {
  const hot = cluster(), first = contact(), second = contact([110.5, -1.875], 'another');
  const run = contacts => { const tracker = createRainAreaTracker(); tracker.update(field(hot), contacts, 0);
    return tracker.update(field(out(hot)), contacts, .1)[0]; };
  const event = run([first, second]);
  assert.deepEqual(event.brushPosition, countryPoint([110.3125, -1.875]));
  assert.deepEqual(run([second, first]).brushPosition, event.brushPosition);
});

test('many rapid contacts keep only bounded source-backed areas and no delayed event queue', () => {
  const tracker = createRainAreaTracker(), hot = cluster();
  for (let tick = 0; tick < 1000; tick++) {
    const longitude = 109.3 + (tick % 30) * .05;
    tracker.update(field(hot), [contact([longitude, -2.5 + tick % 15 * .1], String(tick))], tick * .01);
    const metrics = tracker.getMetrics();
    assert.ok(metrics.areaCount <= metrics.maxAreas);
    assert.ok(metrics.claimedPatchCount <= metrics.sourceCount);
  }
  assert.deepEqual(tracker.update(field(out(hot)), [], 20), []);
  assert.equal(tracker.getMetrics().areaCount, 0);
});

test('real held rain completes every source center without waiting for unreachable tangential cell slivers', () => {
  for (const strength of [.1, .5]) for (const position of [[110.1, -1.9], [110.19, -1.94]]) {
    const simulation = new RainSimulation().seed(wideCluster()), tracker = createRainAreaTracker(), rain = [contact(position)];
    const snapshot = () => field([...simulation.cells.values()]);
    const expected = snapshot().patches.filter(value => insideBrush(value, position)).map(value => value.key).sort();
    const events = tracker.update(snapshot(), rain, 0);
    for (let tick = 1; tick <= 450; tick++) {
      simulation.step(.1, [{ from: position, to: position, strength }]);
      const current = snapshot(), next = tracker.update(current, rain, tick / 10);
      // Every source in the actual circle must still be confirmed out. This is
      // neither an average heat threshold nor an early first-cell completion.
      if (current.patches.some(value => insideBrush(value, position) && !value.extinguished)) assert.deepEqual(next, []);
      events.push(...next);
    }
    assert.equal(events.length, 1, `one complete held area at ${position}, strength ${strength}`);
    assert.deepEqual(events[0].memberKeys, expected);
    const fringe = snapshot().patchesAt(position).filter(value => !insideBrush(value, position) && !value.extinguished);
    assert.ok(fringe.length > 0, 'Real tangential fire cells remain unfinished outside the visible source-center area.');
    assert.equal(tracker.getMetrics().completedEvents, 1);
  }
});

test('shared authority delta frames preserve one completion through a fast drag, sparse coast and real reheating', async () => {
  let milliseconds = 0, revision = 0, sequence = 0, previousFrame = null;
  // This source-backed edge has only a few fires under the circular rain;
  // ordinary land and sea cells created by the authority are not extra fires.
  const records = wideCluster().filter(value => value.longitude >= 110.125);
  const room = new SharedRoom({ records, clock: () => milliseconds, wallClock: () => 100000 + milliseconds });
  await room.initialize(); await room.bootstrap({ state: null, strength: .5 });
  await room.setScene({ scene: 'participation' });
  const phone = room.connect({ clientId: 'area-drag', role: 'participant', scope: 'indonesia' });
  const tracker = createRainAreaTracker(), deliveredCells = new Map(), events = [];
  const lastOut = new Map(), returnCycles = new Map(), soundedCycles = new Map();
  const send = (position, holding = true, start = false) => room.hold(phone.connectionId,
    { type: 'hold', epoch: room.epoch, seq: sequence++, holding, start, space: 'country', position: countryPoint(position) });
  const observe = () => {
    const frame = stateFrame(room.wireState(), ++revision), packet = statePacket(frame, previousFrame);
    previousFrame = frame;
    if (!packet.simulation.delta) deliveredCells.clear();
    for (const key of packet.simulation.removed) deliveredCells.delete(key);
    for (const row of packet.simulation.cells) deliveredCells.set(wireCellKey(row), row);
    const current = field([...deliveredCells.values()].map(([longitude, latitude, surfaceWetness, moisture, heat, extinguished, , hasFire]) =>
      ({ longitude, latitude, surfaceWetness, moisture, heat, extinguished, hasFire })));
    for (const patch of current.patches) {
      if (lastOut.get(patch.key) === true && !patch.extinguished) returnCycles.set(patch.key, (returnCycles.get(patch.key) || 0) + 1);
      lastOut.set(patch.key, patch.extinguished);
    }
    for (const event of tracker.update(current, packet.participants, milliseconds / 1000)) {
      assert.ok(event.memberKeys.every(key => current.patches.find(patch => patch.key === key)?.extinguished));
      assert.ok(event.memberKeys.some(key => soundedCycles.get(key) !== (returnCycles.get(key) || 0)),
        'A repeated area sound requires a real intervening fire return.');
      for (const key of event.memberKeys) soundedCycles.set(key, returnCycles.get(key) || 0);
      events.push(event);
    }
    return current;
  };
  const target = [109.3, -1.9];
  send([110.19, -1.94], true, true); observe();
  // Sweep quickly past land, entirely away from fire, then return to a tiny
  // coastal overlap. No abandoned hot footprint may block the current area.
  for (const position of [[108, -3], [109.29, -1.9], target]) { milliseconds += 100; send(position); room.advance(); observe(); }
  for (let tick = 1; tick <= 450; tick++) {
    milliseconds += 100;
    if (tick % 5 === 0) send(target);
    room.advance(); observe();
  }
  assert.equal(events.length, 1);
  const completedMembers = events[0].memberKeys;
  assert.ok(completedMembers.length > 0);
  assert.ok(completedMembers.every(key => room.simulation.cells.get(key)?.extinguished));
  assert.ok(completedMembers.every(key => insideBrush(room.simulation.cells.get(key), target)));
  for (let tap = 0; tap < 5; tap++) {
    send(target, false); observe(); send(target, true, true); observe(); milliseconds += 100; room.advance(); observe();
  }
  assert.equal(events.length, 1, 'Already-out repeat taps do not create another event.');
  // Rest between the two real cooling passages. The same finite phone tank
  // must refill through an actual release rather than gain a reset exception.
  send(target, false); observe();
  milliseconds += 12000; room.advance(); observe();
  assert.equal(room.phoneState(phone.connectionId).rainSupply.level, 1);
  await room.setScene({ scene: 'forest-takeover' }); observe();
  send(target, true, true); observe();
  for (let tick = 1; tick <= 450; tick++) {
    milliseconds += 100;
    if (tick % 5 === 0) send(target);
    room.advance(); observe();
  }
  assert.ok(events.length >= 2, 'Continuous authoritative fire return allows fresh, real extinction cycles.');
  assert.equal(tracker.getMetrics().completedEvents, events.length);
});
