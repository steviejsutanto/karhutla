import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneFireProgress, phoneMacroCondition, phonePatchAt, phoneSpatialPatches } from '../app/join.js';
import { nationalPhoneSoundPatchAt, nationalPhoneInteraction, peatPhonePatches } from '../app/peat-phone.js';
import { createParticipantSoundField, nationalPhoneSoundPatchAt as sharedSoundPatchAt, nationalPhoneInteraction as sharedInteraction } from '../app/sound-participants.js';
import { COUNTRY_BOUNDS, countryPoint } from '../app/country-view.mjs';

const field = (patches, rows = 4) => phoneSpatialPatches({ format: 'land-rows-v1', rows, patches });
const nationalField = patches => peatPhonePatches({ format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: .25, patches });

test('local audition and actual phones share the same authoritative focus through cooling, halo taps and release', () => {
  assert.equal(nationalPhoneSoundPatchAt, sharedSoundPatchAt);
  assert.equal(nationalPhoneInteraction, sharedInteraction);
  const rows = [['440,-8', 110.125, -1.875, .8, false], ['443,-8', 110.875, -1.875, 0, true]];
  const mainField = values => createParticipantSoundField(values.map(([key, longitude, latitude, heat, extinguished]) =>
    ({ key, longitude, latitude, heat, extinguished })));
  const position = countryPoint([110.35, -1.875]);
  let phoneFocus = null, previewFocus = null;
  for (const [values, holding] of [[rows, true], [rows.map(value => [ ...value.slice(0, 3), 0, true ]), true],
    [rows.map(value => [ ...value.slice(0, 3), 0, true ]), false], [rows.map(value => [ ...value.slice(0, 3), 0, true ]), true]]) {
    const phone = nationalPhoneInteraction(nationalField(values), position, { holding, eligible: true, preferredKey: phoneFocus });
    const preview = sharedInteraction(mainField(values).patches, position, { holding, eligible: true, preferredKey: previewFocus });
    assert.deepEqual(preview, phone);
    phoneFocus = phone.patchKey; previewFocus = preview.patchKey;
    assert.equal(preview.patchKey, holding ? '440,-8' : null);
  }
  const halo = countryPoint([111.8, -1.875]);
  assert.deepEqual(sharedInteraction(mainField(rows).patches, halo, { holding: true, eligible: true }),
    { holding: true, eligible: true, patchKey: '443,-8', extinguished: true });
  assert.equal(sharedInteraction(mainField(rows).patches, countryPoint([130, -8]), { holding: true, eligible: true }).patchKey, null);
});

test('phone gesture sound follows the selected authoritative patch through extinction and release', () => {
  const position = countryPoint([110.125, -1.875]);
  const hot = nationalField([['440,-8', 110.125, -1.875, .7, false], ['443,-8', 110.875, -1.875, 1, false]]);
  const held = nationalPhoneInteraction(hot, position, { holding: true, eligible: true });
  assert.deepEqual(held, { holding: true, eligible: true, patchKey: '440,-8', extinguished: false });
  const cooled = nationalField([['440,-8', 110.125, -1.875, 0, true], ['443,-8', 110.875, -1.875, 1, false]]);
  assert.deepEqual(nationalPhoneInteraction(cooled, position, { holding: true, eligible: true, preferredKey: held.patchKey }), { ...held, extinguished: true });
  assert.equal(nationalPhoneInteraction(cooled, countryPoint([110.6, -1.875]), { holding: true, eligible: true, preferredKey: held.patchKey }).patchKey, held.patchKey);
  assert.deepEqual(nationalPhoneInteraction(cooled, position, { holding: false, eligible: true, preferredKey: held.patchKey }), { holding: false, eligible: true, patchKey: null, extinguished: false });
  assert.equal(nationalPhoneInteraction(cooled, position, { holding: true, eligible: false }).eligible, false);
  assert.equal(nationalPhoneInteraction(cooled, countryPoint([130, -8]), { holding: true, eligible: true }).patchKey, null, 'sea does not borrow a distant patch bell');
});

test('phones use the shared macro stage and wetness independently of local heat or rain focus', () => {
  const condition = { stage: 3, steps: 8, sourceCount: 711, outCount: 270, heat: .42, moisture: .31 };
  for (const region of [{ heat: 0, moisture: 1, fireCells: 10, extinguishedCells: 10 },
    { heat: .9, moisture: 0, fireCells: 20, extinguishedCells: 0 }]) {
    for (const focus of [null, { heat: 0, moisture: 1 }, { heat: 1, moisture: 0 }]) {
      assert.equal(phoneMacroCondition({ soundCondition: condition, fireProgress: { sourceCount: 711, outCount: 270 }, region, focus }), condition);
    }
  }
});

test('phone macro conditions fall back to explicit global counts and then older region counts', () => {
  const counts = { sourceCount: 711, outCount: 140 };
  assert.equal(phoneMacroCondition({ fireProgress: counts, region: { fireCells: 10, extinguishedCells: 10 } }), counts);
  assert.deepEqual(phoneMacroCondition({ region: { fireCells: 0, extinguishedCells: 0 } }), { sourceCount: 0, outCount: 0 });
  assert.equal(phoneMacroCondition({}), undefined);
  assert.equal(phoneMacroCondition(null), undefined);
});

test('malformed explicit macro conditions cannot become a complete regional or global fallback', () => {
  for (const condition of [null, undefined, {}, { stage: 9, steps: 8 }, { stage: 8, steps: 8, sourceCount: 3, outCount: 0 }]) {
    assert.equal(phoneMacroCondition({ soundCondition: condition, fireProgress: { sourceCount: 3, outCount: 3 },
      region: { fireCells: 3, extinguishedCells: 3 } }), condition);
  }
});

test('phone sound follows global progression even when its own island is all out', () => {
  const global = { sourceCount: 711, outCount: 140 };
  assert.equal(phoneFireProgress({ fireProgress: global, region: { fireCells: 10, extinguishedCells: 10 } }), global);
  assert.deepEqual(phoneFireProgress({ fireProgress: { sourceCount: 711, outCount: 711 },
    region: { fireCells: 0, extinguishedCells: 0 } }), { sourceCount: 711, outCount: 711 });
});

test('phone sound supports older packets and preserves the empty-snapshot counts', () => {
  assert.deepEqual(phoneFireProgress({ region: { fireCells: 711, extinguishedCells: 140 } }), { sourceCount: 711, outCount: 140 });
  assert.deepEqual(phoneFireProgress({ region: { fireCells: 0, extinguishedCells: 0 } }), { sourceCount: 0, outCount: 0 });
  assert.equal(phoneFireProgress({ region: {} }), undefined);
  assert.equal(phoneFireProgress({}), undefined);
  assert.equal(phoneFireProgress(null), undefined);
});

test('malformed explicit global progress is never replaced by an empty or complete regional fallback', () => {
  for (const value of [null, undefined, {}, { sourceCount: -1, outCount: 0 },
    { sourceCount: 3, outCount: 4 }, { sourceCount: '3', outCount: 3 }]) {
    for (const region of [{ fireCells: 0, extinguishedCells: 0 }, { fireCells: 3, extinguishedCells: 3 }]) {
      assert.equal(phoneFireProgress({ fireProgress: value, region }), value);
    }
  }
});

test('phone sound selects the containing fire and stays silent across empty space', () => {
  const patches = field([
    ['440,-8', 0, 0, 4, .8, false],
    ['442,-8', 0, 2, 4, .2, false],
    ['444,-10', 3, 3, 4, 0, true],
  ]);
  assert.equal(phonePatchAt(patches, [.1, .1]), '440,-8');
  assert.equal(phonePatchAt(patches, [.6, .1]), '442,-8');
  for (const position of [[.3, .1], [.49, .1], [.6, .5], [.9, .5]]) {
    assert.equal(phonePatchAt(patches, position), null, `empty space at ${position}`);
  }
  // Extinguished patches retain the key whose tone continues on the main page.
  assert.equal(phonePatchAt(patches, [.9, .9]), '444,-10');
  assert.equal(phonePatchAt([], [.5, .5]), null);
});

test('phone sound boundaries match the server bins, including nonbinary fractions', () => {
  const patches = field([
    ['west', 0, 0, 2, 1, false],
    ['east', 0, 1, 2, 1, false],
    ['south', 1, 1, 2, 1, false],
  ], 2);
  assert.equal(phonePatchAt(patches, [0, 0]), 'west');
  assert.equal(phonePatchAt(patches, [.5, 0]), 'east');
  assert.equal(phonePatchAt(patches, [.5, .5]), 'south');
  assert.equal(phonePatchAt(patches, [1, 1]), 'south');
  assert.equal(phonePatchAt(patches, [0, .5]), null);

  const fractional = field([
    ['before', 2, 2, 5, 1, false],
    ['after', 3, 3, 5, 1, false],
  ], 5);
  assert.equal(phonePatchAt(fractional, [.6, .6]), 'after');
  assert.equal(phonePatchAt(fractional, [.6, .5]), null);
  assert.equal(phonePatchAt(fractional, [.5, .6]), null);
});

test('phone sound keeps authoritative heat and out fields separate from appearance', () => {
  const rows = [
    ['440,-8', 0, 0, 2, .1234, false],
    ['441,-8', 0, 1, 2, 0, true],
  ];
  const patches = field(rows);
  assert.deepEqual(patches.map(({ key, heat, extinguished }) => ({ key, heat, extinguished })), [
    { key: '440,-8', heat: .1234, extinguished: false },
    { key: '441,-8', heat: 0, extinguished: true },
  ]);
  assert.notEqual(patches[0].warm, patches[0].heat);
  assert.equal(patches[1].state, 'out');
  assert.deepEqual(rows[0], ['440,-8', 0, 0, 2, .1234, false]);
});

test('invalid phone sound coordinates cannot choose or latch a fire', () => {
  const patches = field([['440,-8', 0, 0, 1, 1, false]], 1);
  for (const position of [null, [], [.5], [.5, .5, .5], [NaN, .5], [Infinity, .5], [-.01, .5], [1.01, .5], [.5, -.01], [.5, 1.01], ['.5', .5]]) {
    assert.equal(phonePatchAt(patches, position), null);
  }
  assert.equal(phonePatchAt(null, [.5, .5]), null);
});

test('phone sound accepts per-patch moisture and retains support for older six-value packets', () => {
  const [wet] = field([['440,-8', 0, 0, 1, 1, false, .8, .95]], 1);
  assert.equal(wet.heat, 1);
  assert.equal(wet.surfaceWetness, .8);
  assert.equal(wet.moisture, .95);
  const [old] = field([['440,-8', 0, 0, 1, 1, false]], 1);
  assert.equal(old.moisture, 0);
  for (const value of [NaN, Infinity, -.1, 1.1, '1']) {
    assert.equal(field([['440,-8', 0, 0, 1, 1, false, .8, value]], 1), null);
  }
});

test('national phone sound keeps halo taps on a source actually overlapped by the rain circle', () => {
  const patches = nationalField([['440,-8', 110.125, -1.875, .6, false]]);
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.3, -1.875])), '440,-8');
  // The source center is outside the radius, but part of its real cell is in it.
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([111.05, -1.875])), '440,-8');
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.825, -1.175])), '440,-8');
});

test('national phone sound never selects a source beyond the actual circular rain footprint', () => {
  const patches = nationalField([['440,-8', 110.125, -1.875, .6, false]]);
  for (const geo of [[111.1, -1.875], [111.1001, -1.875], [111.025, -.975], [120, -5]]) {
    assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint(geo), '440,-8'), null, `outside footprint at ${geo}`);
  }
});

test('national phone sound retains overlapping focus while direct selection overrides it', () => {
  const patches = nationalField([
    ['440,-8', 110.125, -1.875, .6, false],
    ['443,-8', 110.875, -1.875, .3, false],
  ]);
  const between = countryPoint([110.6, -1.875]);
  assert.equal(nationalPhoneSoundPatchAt(patches, between), '443,-8', 'fresh halo tap selects the closest overlapped active source');
  assert.equal(nationalPhoneSoundPatchAt(patches, between, '440,-8'), '440,-8', 'small movement preserves the existing fire');
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.875, -1.875]), '440,-8'), '443,-8', 'direct new fire wins');
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([111.2, -1.875]), '440,-8'), '443,-8', 'focus releases when the old fire leaves the circle');
});

test('national phone sound stays on a direct or retained extinguished patch without restarting a neighbor', () => {
  const patches = nationalField([
    ['440,-8', 110.125, -1.875, 0, true],
    ['443,-8', 110.875, -1.875, .3, false],
  ]);
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.125, -1.875]), '443,-8'), '440,-8');
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.6, -1.875]), '440,-8'), '440,-8');
  assert.equal(nationalPhoneSoundPatchAt(patches, countryPoint([110.875, -1.875]), '440,-8'), '443,-8');
  assert.equal(nationalPhoneSoundPatchAt([patches[0]], countryPoint([110.6, -1.875])), '440,-8', 'a fresh cooled-ground tap keeps its bell anywhere within the rain footprint');
});

test('national phone sound keeps nearest cooled sources available after every fire in the brush is out', () => {
  const patches = nationalField([
    ['440,-8', 110.125, -1.875, 0, true],
    ['443,-8', 110.875, -1.875, 0, true],
  ]);
  for (let index = 0; index < 100; index++) {
    const position = countryPoint([index % 2 ? 111.2 : 110.3, -1.875]);
    const interaction = nationalPhoneInteraction(patches, position, { holding: true, eligible: true });
    assert.equal(interaction.patchKey, index % 2 ? '443,-8' : '440,-8');
    assert.equal(interaction.extinguished, true);
    assert.equal(nationalPhoneInteraction(patches, position, { holding: false, eligible: true }).patchKey, null);
  }
  const mixed = [{ ...patches[0] }, { ...patches[1], extinguished: false }];
  assert.equal(nationalPhoneSoundPatchAt(mixed, countryPoint([110.3, -1.875])), '440,-8', 'a farther active source cannot steal a cooled-ground tap');
});

test('national phone sound uses declared source geography and rejects invalid coordinates or legacy rows', () => {
  const [patch] = nationalField([['440,-8', 110.125, -1.875, .6, false]]);
  const position = countryPoint([110.125, -1.875]);
  assert.equal(nationalPhoneSoundPatchAt([{ key: patch.key, geo: patch.geo, extinguished: false }], position), patch.key);
  assert.equal(nationalPhoneSoundPatchAt([{ key: patch.key, longitude: patch.longitude, latitude: patch.latitude, extinguished: false }], position), patch.key);
  assert.equal(nationalPhoneSoundPatchAt(field([['440,-8', 0, 0, 1, .6, false]], 1), position), null);
  assert.equal(nationalPhoneSoundPatchAt([{ ...patch, key: '441,-8' }], position), null);
  assert.equal(nationalPhoneSoundPatchAt([{ ...patch, geo: [NaN, -1.875] }], position), null);
  for (const invalid of [null, [], [.5], [.5, .5, .5], [NaN, .5], [Infinity, .5], [-.01, .5], [1.01, .5], [.5, -.01], [.5, 1.01], ['.5', .5]]) {
    assert.equal(nationalPhoneSoundPatchAt([patch], invalid, patch.key), null);
  }
  assert.equal(nationalPhoneSoundPatchAt(null, position, patch.key), null);
  assert.equal(nationalPhoneSoundPatchAt([], position, patch.key), null);
});
