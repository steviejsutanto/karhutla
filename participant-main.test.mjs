import test from 'node:test';
import assert from 'node:assert/strict';
import { RainSimulation } from './simulation.js';
import { SharedRoom } from './shared-room.mjs';
import { patchMidiPair } from './sound-engine.js';
import { countryPoint } from './country-view.mjs';
import { createParticipantSoundField, patchSoundVoices, participantSoundPosition, participantSoundActors, localParticipantSound, activeSoundParticipantCount } from './sound-participants.js';

test('sound headroom counts active people once even over many patches, excludes idle/sea and includes local audition', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125), patch(110.375, -2.125)]);
  const actor = { id: 'one', role: 'participant', holding: true, position: [110.125, -2.125] };
  const actors = [actor, { ...actor }, { ...actor, id: 'two' }, { ...actor, id: 'idle', holding: false },
    { ...actor, id: 'operator', role: 'operator' }, { ...actor, id: 'sea', position: [120, -10] }];
  assert.equal(activeSoundParticipantCount(actors, field), 2);
  assert.equal(patchSoundVoices(actors, field).filter(voice => voice.holding).length, 2);
  assert.equal(activeSoundParticipantCount(actors, field, { excludeId: 'one', localHolding: true, localPosition: actor.position }), 2);
  assert.equal(activeSoundParticipantCount(actors, field, { localHolding: true, localPosition: actor.position }), 3);
  assert.equal(activeSoundParticipantCount([], field), 0);
});

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
const patch = (longitude, latitude, heat = 1, moisture = 0, extinguished = false) => ({ longitude, latitude, heat, moisture, surfaceWetness: moisture, extinguished });

test('participant movement uses the same geographic country frame for national and legacy phones', () => {
  assert.deepEqual(participantSoundPosition([94, 7]), [0, 0]);
  assert.deepEqual(participantSoundPosition([142, -12]), [1, 1]);
  assert.deepEqual(participantSoundPosition([118, -2.5]), [.5, .5]);
  assert.deepEqual(participantSoundPosition([90, 10]), [0, 0]);
  assert.deepEqual(participantSoundPosition([150, -20]), [1, 1]);
  for (const invalid of [null, [], [110], [110, NaN], ['110', -2], [Number.MAX_VALUE, -2], [110, 91], { x: .5, y: .5 }]) assert.equal(participantSoundPosition(invalid), null);
});

test('thermal voice measurements match the actual circular rain footprint at partial cell overlaps', () => {
  const patches = [patch(110.125, -2.125, .9, .1), patch(110.875, -2.125, .2, .8), patch(111.125, -1.375, .6, .4)];
  const simulation = new RainSimulation().seed(patches);
  for (const value of patches) Object.assign(simulation.cells.get(`${Math.floor(value.longitude / .25)},${Math.floor(value.latitude / .25)}`), value);
  const field = createParticipantSoundField(patches);
  for (const position of [[110.125, -2.125], [110.2, -2.2], [110.8, -1.9], [111.3, -1.4]]) {
    const expected = simulation.sampleArea(...position), actual = field.at(position);
    assert.ok(expected.fireFraction > 0);
    close(actual.heat, expected.heat / expected.fireFraction);
    close(actual.moisture, expected.moisture / expected.fireFraction);
    close(actual.surfaceWetness, expected.surfaceWetness / expected.fireFraction);
  }
});

test('the voice measures a source edge overlapped by rain and excludes a diagonal outside the circle', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125, .3, .7), patch(130.125, -2.125)]);
  const halo = field.at([111.05, -2.125]);
  assert.equal(halo.sourceCount, 1);
  close(halo.heat, .3);
  // Both axis gaps are below the radius, but their diagonal lies outside it.
  const corner = field.at([111, -1.25]);
  assert.deepEqual(corner, field.global);
  close(corner.heat, .65);
});

test('empty space falls back to all source fires and extinction requires confirmed out flags', () => {
  const patches = [patch(110.125, -2.125, .9, .2), patch(130.125, -2.125, 0, 1, true)];
  const field = createParticipantSoundField(patches);
  close(field.at([110.125, -2.125]).heat, .9);
  assert.equal(field.at([130.125, -2.125]).extinguished, true);
  assert.equal(field.at([120, -8]).extinguished, false);
  close(field.at([120, -8]).heat, .45);
  assert.equal(field.at([120, -8]).sourceCount, 2);
  assert.equal(createParticipantSoundField([patch(110.125, -2.125, 0, 1)]).at([110.125, -2.125]).extinguished, false);
  assert.equal(createParticipantSoundField([]).global.extinguished, false);
});

test('sampling keeps packet endpoints immutable and deduplicates source records without inventing cooling', () => {
  const source = patch(110.125, -2.125, .75, .25), before = JSON.stringify(source);
  const field = createParticipantSoundField([source, { ...source }, { ...patch(110.375, -2.125), hasFire: false }]);
  const sample = field.at([110.125, -2.125]);
  assert.equal(sample.sourceCount, 1);
  assert.equal(JSON.stringify(source), before);
  source.heat = .1; source.moisture = 1;
  for (let i = 0; i < 100; i++) assert.deepEqual(field.at([110.125, -2.125]), sample);
  close(createParticipantSoundField([source]).at([110.125, -2.125]).heat, .1);
});

test('legacy audience-note helpers preserve identity while excluding other main pages and delayed local echoes', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125, .4, .6)]);
  const actors = [
    { id: 'phone-a', role: 'participant', number: 1, holding: true, position: [110.125, -2.125] },
    { id: 'phone-b', role: 'participant', number: 12, holding: false, position: [130, -8] },
    { id: 'other-main', role: 'operator', number: 0, holding: true, position: [110, -2] },
    { id: 'own-echo', role: 'participant', number: 3, holding: true, position: [110, -2] },
    { id: 'no-position', role: 'participant', number: 4, holding: true },
  ];
  const before = JSON.stringify(actors), mapped = participantSoundActors(actors, field, { excludeId: 'own-echo' });
  assert.deepEqual(mapped.map(({ id, number, holding }) => ({ id, number, holding })), [
    { id: 'phone-a', number: 1, holding: true }, { id: 'phone-b', number: 12, holding: false },
  ]);
  assert.deepEqual(mapped[0].position, participantSoundPosition(actors[0].position));
  close(mapped[0].heat, .4); close(mapped[0].moisture, .6);
  actors[0].position = [120, -5];
  const moved = participantSoundActors(actors, field, { excludeId: 'own-echo' });
  assert.equal(moved[0].id, mapped[0].id); assert.equal(moved[0].number, mapped[0].number);
  assert.notDeepEqual(moved[0].position, mapped[0].position);
  actors[0].position = [110.125, -2.125];
  assert.equal(JSON.stringify(actors), before);
});

test('legacy local-note helpers retain their stable identity and release position', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125, .4, .6)]);
  const start = localParticipantSound([110.125, -2.125], true, field);
  const moved = localParticipantSound([130, -8], true, field);
  const released = localParticipantSound([130, -8], false, field);
  assert.equal(start.id, '__local-operator'); assert.equal(moved.id, start.id);
  assert.equal(released.holding, false); assert.deepEqual(released.position, moved.position);
  assert.equal(Object.hasOwn(start, 'number'), false, 'The local test note never becomes a joined audience member.');
  assert.equal(localParticipantSound(null, false, field), null);
});

test('patch voices keep each authoritative endpoint and out flag with no audience or touch', () => {
  const field = createParticipantSoundField([
    patch(110.125, -2.125, .4, .8, true),
    patch(110.375, -2.125, 0, 1, false),
    patch(110.625, -2.125, .9, .1, false),
  ]);
  assert.equal(field.at([110.375, -2.125]).extinguished, false, 'The legacy brush summary sees mixed neighbors.');
  const voices = patchSoundVoices([], field);
  assert.deepEqual(voices.map(({ id, key, heat, moisture, extinguished, holding, sourceCount }) =>
    ({ id, key, heat, moisture, extinguished, holding, sourceCount })), [
    { id: 'patch:440,-9', key: '440,-9', heat: .4, moisture: .8, extinguished: true, holding: false, sourceCount: 1 },
    { id: 'patch:441,-9', key: '441,-9', heat: 0, moisture: 1, extinguished: false, holding: false, sourceCount: 1 },
    { id: 'patch:442,-9', key: '442,-9', heat: .9, moisture: .1, extinguished: false, holding: false, sourceCount: 1 },
  ]);
  assert.deepEqual(patchSoundVoices(null, field), voices);
  assert.equal(voices[0].surfaceWetness, .8);
  assert.equal(Object.hasOwn(voices[0], 'number'), false);
  assert.equal(Object.hasOwn(voices[0], 'pitchIndex'), false, 'The engine derives pitch from the patch key.');
});

test('the complete audience gates each overlapping patch once, including simultaneous touches', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125), patch(130.125, -2.125, 0, 1, true)]);
  const actors = Array.from({ length: 256 }, (_, index) => ({
    id: `phone-${index}`, role: 'participant', number: index + 1,
    holding: true, position: [110.125, -2.125],
  }));
  const before = JSON.stringify(actors), voices = patchSoundVoices(actors, field);
  assert.equal(voices.length, 2, 'Crowd size never becomes voice count.');
  assert.deepEqual(voices.map(voice => voice.holding), [true, false]);
  actors[0].holding = false;
  assert.equal(patchSoundVoices(actors, field)[0].holding, true, 'Other people keep the same patch held.');
  actors[0].holding = true;
  assert.equal(JSON.stringify(actors), before);
  assert.deepEqual(patchSoundVoices([], field).map(voice => voice.holding), [false, false]);
  assert.equal(patchSoundVoices([], field)[1].extinguished, true, 'An out patch remains present after everyone disconnects.');
});

test('patch identity, pitches and center stay fixed through movement, release, disconnect and snapshot reload', () => {
  const patches = [patch(110.125, -2.125), patch(130.125, -2.125, .2, .7, true)];
  const field = createParticipantSoundField(patches);
  const actor = { id: 'phone', role: 'participant', number: 1, holding: true, position: [110.125, -2.125] };
  const fixed = voices => voices.map(voice => ({ id: voice.id, key: voice.key, position: voice.position, pitches: patchMidiPair(voice) }));
  const initial = patchSoundVoices([actor], field), identity = fixed(initial);
  assert.deepEqual(initial.map(voice => voice.position), patches.map(value => countryPoint([value.longitude, value.latitude])));
  actor.position = [130.125, -2.125]; actor.number = 999;
  const moved = patchSoundVoices([actor], field);
  assert.deepEqual(moved.map(voice => voice.holding), [false, true]);
  assert.deepEqual(fixed(moved), identity);
  actor.holding = false;
  assert.deepEqual(fixed(patchSoundVoices([actor], field)), identity);
  assert.deepEqual(fixed(patchSoundVoices([], field)), identity);
  const reloaded = createParticipantSoundField(JSON.parse(JSON.stringify([...patches].reverse())));
  assert.deepEqual(patchSoundVoices([], reloaded), patchSoundVoices([], field));
  assert.deepEqual(fixed(patchSoundVoices([{ ...actor, id: 'new-phone', number: 3 }], reloaded)), identity);
  assert.deepEqual(patchSoundVoices([], createParticipantSoundField()), [], 'Removing source patches removes their descriptors.');
});

test('patch touch uses the exact brush edge and never assigns a country-wide voice to sea or invalid coordinates', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125, .3, .7), patch(130.125, -2.125)]);
  const actor = position => ({ id: 'phone', role: 'participant', holding: true, position });
  assert.deepEqual(field.patchesAt([111.05, -2.125]).map(value => value.key), ['440,-9']);
  assert.deepEqual(patchSoundVoices([actor([111.05, -2.125])], field).map(value => value.holding), [true, false]);
  for (const position of [[111, -1.25], [120, -8], [90, 10], null, [], [NaN, -2], ['110', -2]]) {
    assert.deepEqual(field.patchesAt(position), []);
    assert.deepEqual(patchSoundVoices([actor(position)], field).map(value => value.holding), [false, false]);
  }
});

test('local preview touches patches in either view while excluding delayed self echoes and other operators', () => {
  const field = createParticipantSoundField([patch(110.125, -2.125), patch(130.125, -2.125)]);
  const actors = [
    { id: 'own-echo', role: 'participant', holding: true, position: [130.125, -2.125] },
    { id: 'other-main', role: 'operator', holding: true, position: [130.125, -2.125] },
    { role: 'participant', holding: true, position: [130.125, -2.125] },
  ];
  const options = { excludeId: 'own-echo', localPosition: [110.125, -2.125], localHolding: true };
  const voices = patchSoundVoices(actors, field, options);
  assert.deepEqual(voices.map(voice => voice.holding), [true, false]);
  assert.deepEqual(patchSoundVoices(actors, field, { ...options, localHolding: false }).map(voice => voice.holding), [false, false]);
  assert.deepEqual(patchSoundVoices(actors, field, { ...options, localPosition: [120, -8] }).map(voice => voice.holding), [false, false]);
});

test('field source descriptors are canonical immutable snapshots without render-time interpolation', () => {
  const source = { ...patch(110.125, -2.125, .75, .25), key: 'untrusted-label' };
  const before = JSON.stringify(source);
  const field = createParticipantSoundField([source, { ...source }, { ...patch(110.375, -2.125), hasFire: false }, patch(NaN, 0)]);
  assert.equal(JSON.stringify(source), before);
  assert.equal(field.patches.length, 1);
  assert.equal(field.patches[0].key, '440,-9');
  assert.deepEqual(field.patches[0].position, countryPoint([110.125, -2.125]));
  assert.ok(Object.isFrozen(field.patches) && Object.isFrozen(field.patches[0]) && Object.isFrozen(field.patches[0].position));
  source.heat = .1; source.moisture = 1; source.longitude = 130.125;
  const voice = patchSoundVoices([], field)[0];
  assert.equal(voice.heat, .75); assert.equal(voice.moisture, .25);
  assert.equal(voice.key, '440,-9');
  assert.throws(() => { field.patches[0].position[0] = 1; }, TypeError);
});

test('authoritative room packets preserve independent out drones with zero actors across a client reload', async () => {
  const records = [patch(110.125, -2.125), patch(110.375, -2.125)];
  const simulation = new RainSimulation().seed(records);
  Object.assign(simulation.cells.get('440,-9'), { heat: 0, moisture: 1, surfaceWetness: .8, extinguished: true });
  const room = new SharedRoom({ records, clock: () => 0 });
  await room.initialize();
  await room.bootstrap({ state: simulation.serialize(), strength: .5 });
  const before = JSON.stringify(room.simulation.serialize());
  const mapPacket = packet => {
    const patches = packet.simulation.cells.map(([longitude, latitude, surfaceWetness, moisture, heat, extinguished, , hasFire]) =>
      ({ longitude, latitude, surfaceWetness, moisture, heat, extinguished, hasFire }));
    return patchSoundVoices(packet.participants, createParticipantSoundField(patches));
  };
  const packet = room.wireState(), voices = mapPacket(packet);
  assert.deepEqual(voices.map(voice => [voice.id, voice.holding, voice.extinguished]), [
    ['patch:440,-9', false, true], ['patch:441,-9', false, false],
  ]);
  assert.deepEqual(mapPacket(JSON.parse(JSON.stringify(packet))), voices);
  for (let index = 0; index < 20; index++) assert.deepEqual(mapPacket(room.wireState()), voices);
  assert.equal(JSON.stringify(room.simulation.serialize()), before, 'Reading sound never cools or changes the authority.');
});
