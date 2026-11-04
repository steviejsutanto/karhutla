import test from 'node:test';
import assert from 'node:assert/strict';
import { RegionCatalog } from './regions.mjs';
import { RainSimulation } from './simulation.js';
import { makeStudyLayout, studyGeoAt, studyPointForGeo, studyPatches, studyRegionSummary } from './study-state.mjs';
import { derivePeatState } from './visual-assets/peat-surface.js';
import { peatPhonePatches, peatPhoneAppearance } from './peat-phone.js';
import { createPerformanceServer } from './server.mjs';
import { countryMapRect, countryInputAt, countryGeo } from './country-view.mjs';
import { COUNTRY_BOUNDS, countryPosition } from './national-space.mjs';
import { orderedSectionPatches, sectionPointAt, sectionXForGeo } from './visual-assets/peat-section.js';
import { RainFeedback } from './visual-assets/rain-feedback.js';

test('landscape and portrait map rectangles keep the same geographic touch coordinates', () => {
  for (const [width, height] of [[844, 260], [568, 170], [320, 500], [1440, 800]]) {
    const rect = countryMapRect(width, height, 12);
    assert.ok(Math.abs(rect.width / rect.height - 48 / 19) < 1e-10);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    for (const position of [[0, 0], [1, 1], [.1, .2], [.8, .6]]) {
      const input = countryInputAt(rect, rect.x + rect.width * position[0], rect.y + rect.height * position[1]);
      const actual = countryGeo(input), expected = countryPosition(position);
      assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 1e-9));
    }
  }
});

test('national material layout locates distant islands without skipping sea gaps', () => {
  const layout = makeStudyLayout({ id: 'indonesia', name: 'Indonesia', format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: .25, patches: [['400,0', 100.125, .125], ['540,-8', 135.125, -1.875]], fireKeys: ['400,0', '540,-8'], landKeys: ['400,0', '540,-8', '440,0'] });
  assert.ok(studyPointForGeo(layout, [100.125, .125])[0] < .2);
  assert.ok(studyPointForGeo(layout, [135.125, -1.875])[0] > .8);
  assert.deepEqual(studyGeoAt(layout, [.5, .5]), [118, -2.5]);
  const cells = new Map([['400,0', { heat: 0, surfaceWetness: 1, extinguished: true }], ['540,-8', { heat: 1, surfaceWetness: 0, extinguished: false }]]);
  assert.equal(studyRegionSummary(layout, cells).wetness, 1 / 3);
  const patches = studyPatches(layout, cells);
  assert.equal(patches[0].extinguished, true); assert.equal(patches[1].heat, 1);
});

test('symbolic rain keeps the geographic footprint and phones omit the canopy', () => {
  const feedback = new RainFeedback();
  const calls = { curves: [], circles: [], drops: [] };
  const context = { save() {}, restore() {}, beginPath() {}, stroke() {},
    arc(...args) { calls.circles.push(args); }, moveTo() {}, lineTo(...args) { calls.drops.push(args); },
    quadraticCurveTo(...args) { calls.curves.push(args); } };
  feedback.draw(context, { x: 4, y: 12, radius: 9, now: 0, bounds: { left: 0, top: 0, right: 568, bottom: 320 } });
  assert.equal(calls.curves.length, 2);
  assert.deepEqual(calls.circles[0].slice(0, 3), [4, 12, 9]);
  assert.ok(calls.drops.length >= 14);
  calls.drops.length = 0;
  feedback.draw(context, { x: 300, y: 180, now: 0, preview: true });
  assert.equal(calls.drops.length, 0, 'Hover never falsely displays rain');
  calls.curves.length = 0; calls.circles.length = 0;
  feedback.draw(context, { x: 300, y: 180, now: 0, cloud: false, footprint: false });
  assert.equal(calls.curves.length, 0); assert.equal(calls.circles.length, 0);
});

test('abstract section exposes every country patch in a stable order and never maps depth to latitude', () => {
  const patches = [ { key:'540,-8', geo:[135.125,-1.875] }, { key:'400,1', geo:[100.125,.375] }, { key:'400,0', geo:[100.125,.125] } ];
  const ordered = orderedSectionPatches(patches);
  assert.deepEqual(ordered.map(p=>p.key), ['400,0','400,1','540,-8']);
  for (const [index, patch] of ordered.entries()) {
    const x = (index+.5)/ordered.length;
    assert.deepEqual(sectionPointAt(patches,x),patch.geo);
    assert.equal(sectionXForGeo(patches,patch.geo),x);
  }
  assert.deepEqual(sectionPointAt(patches,-1),ordered[0].geo);
  assert.deepEqual(sectionPointAt(patches,1),ordered.at(-1).geo);
  assert.equal(sectionPointAt([], .5),null);
  assert.equal(sectionXForGeo(patches,[NaN,0]),null);
});

test('national phone field validates source coordinates and independently cooled patches', () => {
  const field = { format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: .25, patches: [['400,0', 100.125, .125, 0, true], ['540,-8', 135.125, -1.875, 1, false]] };
  const patches = peatPhonePatches(field);
  assert.equal(patches.length, 2); assert.equal(patches[0].state, 'out'); assert.equal(patches[1].state, 'hot');
  assert.equal(peatPhonePatches({ ...field, patches: [['wrong', 100.125, .125, 1, false]] }), null);
  assert.equal(peatPhonePatches({ ...field, bounds: { ...COUNTRY_BOUNDS, west: 95 } }), null);
  const wetField = { ...field, patches: [['400,0', 100.125, .125, .4, false, .8, .6], ['540,-8',135.125,-1.875,1,false,0,0]] };
  const wet = peatPhonePatches(wetField);
  assert.deepEqual(wet[0].geo, [100.125,.125]);
  assert.equal(wet[0].surfaceWetness,.8); assert.equal(wet[0].moisture,.6);
  assert.equal(peatPhonePatches({ ...field, patches: [['400,0',100.125,.125,.4,false,1.01,.5]] }), null);

});

test('study screen coordinates agree with the authoritative phone mapping across all regions and edges', () => {
  const catalog = new RegionCatalog([{ longitude: 114.125, latitude: -.125 }]);
  for (const region of catalog.regions.values()) {
    const layout = makeStudyLayout({ id: region.id, name: region.name, rows: region.rows, fireKeys: [...region.fireKeys] });
    for (const x of [0, .01, .27, .5, .82, 1]) for (const y of [0, .01, .27, .5, .82, 1]) {
      const geo = studyGeoAt(layout, [x, y]);
      assert.deepEqual(geo, catalog.map(region.id, [x, y]));
      assert.deepEqual(studyGeoAt(layout, studyPointForGeo(layout, geo)), geo);
    }
  }
});

test('study preserves independent heat and extinction patches and averages the entire region', () => {
  const layout = makeStudyLayout({ id: 'test', name: 'Test', rows: [[[110.125, -.125], [110.375, -.125]], [[110.125, -.375]]], fireKeys: ['440,-1', '441,-1'] });
  const cells = new Map([['440,-1', { heat: 1, surfaceWetness: .9, extinguished: false }], ['441,-1', { heat: 0, surfaceWetness: .3, extinguished: true }]]);
  const patches = studyPatches(layout, cells);
  assert.deepEqual(patches.map(p => [p.heat, p.extinguished]), [[1, false], [0, true]]);
  const summary = studyRegionSummary(layout, cells);
  assert.equal(summary.heat, .5); assert.ok(Math.abs(summary.wetness - .4) < 1e-10);
  assert.equal(summary.out, 1); assert.equal(summary.total, 2);
});

test('wet material quiets its surface while residual embers persist; only out removes all glow', () => {
  const hot = derivePeatState({ heat: 1, surfaceWetness: 0 });
  const wet = derivePeatState({ heat: 1, surfaceWetness: 1 });
  const out = derivePeatState({ heat: 1, surfaceWetness: 1, extinguished: true });
  assert.ok(hot.agitation > wet.agitation); assert.equal(wet.surface, 0); assert.ok(wet.ember > 0);
  assert.equal(out.ember, 0); assert.equal(out.surface, 0); assert.equal(out.smoke, 0);
});

test('phone field keeps cooled and hot areas independent and rejects false extinction', () => {
  const field = { format: 'land-rows-v1', rows: 2, patches: [['a', 0, 0, 2, .8, false], ['b', 1, 0, 1, 0, true]] };
  assert.deepEqual(peatPhonePatches(field).map(p => [p.top, p.opacity, p.state]), [[0, .8240000000000001, 'hot'], [.5, 0, 'out']]);
  assert.equal(peatPhoneAppearance(.8, true), null);
  assert.equal(peatPhonePatches({ ...field, patches: [...field.patches, field.patches[0]] }), null);
});

test('study routes and layout are read-only views of the current authoritative room', async t => {
  const instance = await createPerformanceServer({ port: 0, persistencePath: null, autoTick: false, records: [{ longitude: 114.125, latitude: -.125 }] });
  t.after(() => instance.close());
  await instance.room.bootstrap({ state: null, strength: .5 });
  const before = JSON.stringify(instance.room.simulation.serialize());
  const address = await instance.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const layoutResponse = await fetch(`${base}/api/study-region?region=kalimantan`);
  assert.equal(layoutResponse.status, 200);
  const data = await layoutResponse.json();
  const layout = makeStudyLayout(data);
  assert.equal(layout.id, 'kalimantan'); assert.equal(layout.fireKeys.size, 1);
  assert.equal(JSON.stringify(instance.room.simulation.serialize()), before);
  assert.equal((await fetch(`${base}/api/study-region?region=unknown`)).status, 400);
  assert.equal((await fetch(`${base}/api/study-region`, { method: 'POST' })).status, 405);
  for (const [pathname, type] of [['/study', 'text/html'], ['/study/phone', 'text/html'], ['/study-state.mjs', 'text/javascript'], ['/visual-assets/peat-section.js', 'text/javascript'], ['/visual-assets/surface-heat.js', 'text/javascript'], ['/visual-assets/surface-heat-atlas.webp', 'image/webp'], ['/visual-assets/peat-material-phone.webp', 'image/webp'], ['/visual-assets/peat-smoke.webp', 'image/webp']]) {
    const response = await fetch(base + pathname);
    assert.equal(response.status, 200, pathname); assert.ok(response.headers.get('content-type').includes(type));
  }
  const qr = await fetch(`${base}/api/qr.svg?view=peat`);
  assert.equal(qr.status, 200); assert.ok((await qr.text()).includes('<svg'));
});
