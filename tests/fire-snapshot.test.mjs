import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateFireSnapshot, MAX_FIRE_SNAPSHOT_BYTES, MAX_FIRE_SNAPSHOT_RECORDS } from '../app/fire-snapshot.mjs';
import { refreshSnapshot } from '../scripts/fetch-snapshot.mjs';

const bundled = JSON.parse(await readFile(new URL('../data/fire-snapshot.json', import.meta.url), 'utf8'));
function sample() {
  const value = structuredClone(bundled);
  value.records = value.records.slice(0, 2);
  value.observationStart = value.records[0].observedAt;
  value.observationEnd = value.records.at(-1).observedAt;
  value.counts = { downloadedRows: 12, boundingBoxRows: 6, outsideCountryRows: 3, invalidRows: 1, duplicateRows: 0, retainedRows: 2 };
  return value;
}
function rejects(value, pattern = /Invalid fire snapshot:/) {
  assert.throws(() => validateFireSnapshot(value), error => error.status === 400 && pattern.test(error.message));
}

test('the bundled snapshot round-trips without changing provenance, observations or caller objects', () => {
  const original = structuredClone(bundled), validated = validateFireSnapshot(original);
  assert.deepEqual(validated, bundled);
  assert.notEqual(validated, original);
  for (const key of ['source', 'geographicFilter', 'counts', 'notes', 'records']) assert.notEqual(validated[key], original[key]);
  assert.notEqual(validated.records[0], original.records[0]);
  assert.notEqual(validated.geographicFilter.prefilterBbox, original.geographicFilter.prefilterBbox);
  validated.records[0].frp = 0; validated.notes.push('Private copy.');
  assert.deepEqual(original, bundled);
  assert.equal(MAX_FIRE_SNAPSHOT_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_FIRE_SNAPSHOT_RECORDS, 50000);
});

test('fresh downloader output is accepted directly, including raw NASA confidence codes and nullable values', async t => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'karhutla-snapshot-schema-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, 'data'));
  await writeFile(path.join(rootDir, 'data/indonesia.geojson'), JSON.stringify({ type: 'Polygon', coordinates: [[[100, -5], [110, -5], [110, 5], [100, 5], [100, -5]]] }));
  const csv = 'latitude,longitude,acq_date,acq_time,satellite,frp,confidence,daynight,bright_ti4,bright_ti5,scan,track,version\n2,106,2026-11-04,0525,N20,,n,D,320,,.4,.5,2.0NRT\n';
  const value = await refreshSnapshot({ rootDir, fetchImpl: async () => new Response(csv), now: () => new Date('2026-11-04T12:00:00Z') });
  assert.deepEqual(validateFireSnapshot(value), value);
  assert.equal(value.records[0].frp, null);
  assert.equal(value.records[0].confidence, 'n');
});

test('an empty observation snapshot is valid and retains its actual source counts', () => {
  const value = sample(); value.records = []; value.observationStart = null; value.observationEnd = null;
  value.counts = { downloadedRows: 12, boundingBoxRows: 3, outsideCountryRows: 3, invalidRows: 2, duplicateRows: 0, retainedRows: 0 };
  assert.deepEqual(validateFireSnapshot(value), value);
  value.observationStart = bundled.observationStart;
  rejects(value, /no observations must have null/);
});

test('JSON settings, account data, HTML, raw CSV and unsupported fields fail without partial filtering', () => {
  for (const value of [null, [], 'latitude,longitude\n2,106', '<html>NASA unavailable</html>', 1,
    { version: 1, secret: 'private', pin: '123456' }, { schemaVersion: 1, soundSettings: {} }]) rejects(value);
  for (const [section, key] of [[null, 'settings'], ['source', 'secret'], ['geographicFilter', 'password'], ['counts', 'importedRows']]) {
    const value = sample(); (section ? value[section] : value)[key] = 'unrelated'; rejects(value, /unsupported field/);
  }
  const extraRecord = sample(); extraRecord.records[0].heat = .5; rejects(extraRecord, /unsupported field/);
  const wrongVersion = sample(); wrongVersion.schemaVersion = '1'; rejects(wrongVersion, /Schema version/);
  const many = sample(); many.records = Array(MAX_FIRE_SNAPSHOT_RECORDS + 1).fill(null); rejects(many, /observation limit/);
});

test('NASA sensor, country filter and HTTPS provenance must match the supported normalized format', () => {
  for (const mutate of [
    value => { value.source.sensor = 'MODIS'; },
    value => { value.source.name = 'An unrelated snapshot'; },
    value => { value.source.url = value.source.url.replace('https:', 'http:'); },
    value => { value.source.url = 'https://example.org/J1_VIIRS_C2_Global_24h.csv'; },
    value => { value.source.url = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/file.csv'; },
    value => { value.source.documentationUrl = 'javascript:alert(1)'; },
    value => { value.source.documentationUrl = 'https://user:password@firms.modaps.eosdis.nasa.gov/'; },
    value => { value.source.nominalResolutionMeters = 1000; },
    value => { value.source.frpUnit = 'kW'; },
    value => { value.source.brightnessUnit = 'C'; },
    value => { value.source.rawFile = '../private-key.json'; },
    value => { value.source.rawSha256 = 'not-a-checksum'; },
    value => { value.geographicFilter.country = 'Malaysia'; },
    value => { value.geographicFilter.iso3 = 'MYS'; },
    value => { value.geographicFilter.method = 'bounding-box'; },
    value => { value.geographicFilter.boundary = 'data/malaysia.geojson'; },
    value => { value.geographicFilter.prefilterBbox[2] = 180; },
    value => { value.geographicFilter.approximate = 'true'; },
  ]) { const value = sample(); mutate(value); rejects(value); }
});

test('timestamps use real UTC calendar dates and the metadata window matches all records regardless of order', () => {
  for (const time of ['2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z',
    '2026-01-01', '2026-01-01T00:00:00+00:00', 1700000000, null]) {
    const value = sample(); value.records[0].observedAt = time; rejects(value);
  }
  for (const key of ['fetchedAt', 'observationStart', 'observationEnd']) {
    const value = sample(); value[key] = 'invalid'; rejects(value);
  }
  const value = sample(); value.records[0].observedAt = '2024-02-29T00:05:00.1Z';
  value.observationStart = value.records[0].observedAt; value.records.reverse();
  assert.deepEqual(validateFireSnapshot(value), value);
  value.observationEnd = value.observationStart;
  rejects(value, /earliest and latest/);
  // The label describes NASA's rolling product, not a guaranteed 24-hour
  // retained observation span. Saved downloads can straddle that interval.
  const wide = sample();
  wide.records[0].observedAt = wide.observationStart = '2026-11-01T00:00:00Z';
  wide.records[1].observedAt = wide.observationEnd = '2026-11-02T03:00:00Z';
  assert.deepEqual(validateFireSnapshot(wide), wide);
});

test('coordinates, numeric observation fields and sensor identifiers are validated before any import', () => {
  for (const [key, values] of Object.entries({ latitude: [NaN, Infinity, null, '-2', -11.5001, 6.5001],
    longitude: [-Infinity, null, '110', 94.4999, 141.5001], frp: [NaN, Infinity, -1, '3'],
    brightness: [Infinity, -1, '300'], brightnessTi5: [NaN], scan: [-1], track: [Infinity],
    satellite: ['NPP', 'AQUA'], instrument: ['MODIS'], dayNight: ['day'], id: ['', 'a'.repeat(129), '<html>'],
  })) {
    for (const bad of values) { const value = sample(); value.records[0][key] = bad; rejects(value); }
  }
  const value = sample();
  for (const key of ['frp', 'brightness', 'brightnessTi5', 'scan', 'track']) value.records[0][key] = null;
  delete value.records[1].frp; delete value.records[1].brightness;
  delete value.source.rawFile; delete value.source.rawSha256;
  assert.deepEqual(validateFireSnapshot(value), value, 'Missing optional measurements/provenance stay missing instead of being invented.');
});

test('duplicate IDs and duplicate coordinate/time observations are rejected rather than silently dropped', () => {
  const sameID = sample(); sameID.records[1].id = sameID.records[0].id; rejects(sameID, /repeats an observation ID/);
  const samePosition = sample(); samePosition.records[1] = { ...samePosition.records[0], id: 'another-id', frp: 40 };
  rejects(samePosition, /same satellite observation/);
  samePosition.records[1].observedAt = samePosition.records[1].observedAt.replace(/Z$/, '.000Z');
  rejects(samePosition, /same satellite observation/);
  samePosition.records[1].observedAt = new Date(Date.parse(samePosition.records[0].observedAt) + 60000).toISOString(); samePosition.observationEnd = samePosition.records[1].observedAt;
  assert.deepEqual(validateFireSnapshot(samePosition), samePosition, 'The same pixel can be observed again at another time.');
});

test('row metadata must account for retained, excluded, duplicate and invalid rows', () => {
  for (const changes of [{ retainedRows: 3 }, { downloadedRows: 2 }, { boundingBoxRows: 1 },
    { boundingBoxRows: 8 }, { invalidRows: 0 }, { duplicateRows: -1 }, { retainedRows: '2' }, { downloadedRows: Infinity }]) {
    const value = sample(); Object.assign(value.counts, changes); rejects(value, /row count|Row count|counts are inconsistent/);
  }
});

test('text metadata stays bounded and rejects HTML instead of presenting an error page as source notes', () => {
  for (const mutate of [value => { value.notes = ['<script>alert(1)</script>']; },
    value => { value.windowLabel = '<h1>Download failed</h1>'; },
    value => { value.notes = Array(33).fill('Repeated note.'); },
    value => { value.notes = ['x'.repeat(2049)]; },
    value => { value.records[0].confidence = { text: 'high' }; },
  ]) { const value = sample(); mutate(value); rejects(value); }
});
