import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { countryPolygons, downloadSnapshotCsv, insideCountry, normalize, parseCsv, refreshSnapshot, SOURCE_URL } from '../scripts/fetch-snapshot.mjs';

const boundary = { type: 'Polygon', coordinates: [
  [[100, -5], [110, -5], [110, 5], [100, 5], [100, -5]],
  [[103, -1], [105, -1], [105, 1], [103, 1], [103, -1]],
] };
const header = 'latitude,longitude,acq_date,acq_time,satellite,frp,confidence,daynight,bright_ti4,bright_ti5,scan,track,version';
const row = (overrides = {}) => {
  const data = { latitude: '2', longitude: '106', acq_date: '2026-11-04', acq_time: '0525', satellite: 'N20', frp: '3.1',
    confidence: 'n', daynight: 'D', bright_ti4: '320', bright_ti5: '280', scan: '.4', track: '.5', version: '2.0NRT', ...overrides };
  return header.split(',').map(key => data[key]).join(',');
};
const csv = rows => Buffer.from(`\uFEFF${header}\r\n${rows.join('\r\n')}\r\n`);
const polygons = countryPolygons(boundary);

test('CSV preserves quoted commas, embedded newlines and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\r\n"one,two","a ""quote""\r\nline"\r\n\r\n'), [['a', 'b'], ['one,two', 'a "quote"\r\nline']]);
  for (const malformed of ['a,b\n"never closes,b', 'a,b\n"closed"extra,b', 'a,b\nun"quoted,b']) {
    assert.throws(() => parseCsv(malformed), /quoted field/i);
  }
});

test('country filtering includes outer boundaries and excludes hole boundaries', () => {
  assert.equal(insideCountry(100, 0, polygons), true);
  assert.equal(insideCountry(106, 2, polygons), true);
  assert.equal(insideCountry(103, 0, polygons), false);
  assert.equal(insideCountry(104, 0, polygons), false);
  assert.equal(insideCountry(111, 2, polygons), false);
  const multi = countryPolygons({ type: 'FeatureCollection', features: [{ geometry: { type: 'MultiPolygon', coordinates: [boundary.coordinates] } }] });
  assert.deepEqual(multi, polygons);
  for (const bad of [{}, { type: 'FeatureCollection', features: [] }, { type: 'Point', coordinates: [0, 0] }, { type: 'Polygon', coordinates: [[]] }]) {
    assert.throws(() => countryPolygons(bad), /boundary/);
  }
});

test('normalization validates, deduplicates, filters and preserves provenance fields and IDs', () => {
  const raw = csv([row(), row(), row({ latitude: '0', longitude: '104' }), row({ latitude: '2', longitude: '112' }),
    row({ latitude: '70' }), row({ latitude: 'NaN' }), row({ acq_date: '2026-02-29' }),
    row({ acq_date: '2026-11-03', satellite: '1', frp: 'bad', bright_ti4: 'Infinity' })]);
  const { records, stats } = normalize(raw, polygons);
  assert.deepEqual(stats, { downloadedRows: 8, boundingBoxRows: 6, outsideCountryRows: 2, invalidRows: 2, duplicateRows: 1, retainedRows: 2 });
  assert.equal(records[0].observedAt, '2026-11-03T05:25:00Z');
  assert.equal(records[0].satellite, 'NOAA-20');
  assert.equal(records[0].frp, null);
  assert.equal(records[0].brightness, null);
  const expectedId = createHash('sha256').update('N20|2026-11-04T05:25:00Z|2.0|106.0').digest('hex').slice(0, 16);
  assert.equal(records[1].id, `viirs-${expectedId}`);
  assert.equal(records[1].brightnessTi5, 280);
  assert.equal(records[1].instrument, 'VIIRS');
  assert.equal(records[1].dayNight, 'D');
  assert.equal(normalize(csv([row({ satellite: 'constructor' })]), polygons).records[0].satellite, 'constructor');
});

test('normalization preserves Python-compatible IDs for small coordinates and zero', () => {
  const { records } = normalize(csv([row({ latitude: '0.00001' }), row({ latitude: '-0' })]), []);
  for (const [latitude, identity] of [[0.00001, '1e-05'], [-0, '-0.0']]) {
    const expected = createHash('sha256').update(`N20|2026-11-04T05:25:00Z|${identity}|106.0`).digest('hex').slice(0, 16);
    assert.equal(records.find(record => Object.is(record.latitude, latitude)).id, `viirs-${expected}`);
  }
});

test('normalization rejects invalid dates, times and out-of-range coordinates', () => {
  const { records, stats } = normalize(csv([
    row({ acq_date: '2024-02-29', acq_time: '5' }), row({ acq_date: '2026-13-01' }), row({ acq_time: '2400' }),
    row({ acq_time: '0060' }), row({ latitude: '-91' }), row({ longitude: '190' }), row({ latitude: '0x2' }),
  ]), []);
  assert.equal(records.length, 1);
  assert.equal(records[0].observedAt, '2024-02-29T00:05:00Z');
  assert.equal(stats.invalidRows, 6);
});

test('unexpected, malformed and invalid UTF-8 downloads cannot replace a snapshot', () => {
  for (const bad of [Buffer.from('<html>temporary failure</html>'), csv([`${row()},extra`]), Buffer.from([0xff])]) {
    assert.throws(() => normalize(bad, polygons));
  }
});

test('download accepts bounded HTTPS responses and validates redirected protocols', async () => {
  const requests = [];
  const raw = await downloadSnapshotCsv(SOURCE_URL, { fetchImpl: async (url, options) => {
    requests.push([url, options.redirect]);
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://example.org/data.csv' } })
      : new Response('hello');
  } });
  assert.equal(raw.toString(), 'hello');
  assert.deepEqual(requests.map(entry => entry[1]), ['manual', 'manual']);
  await assert.rejects(downloadSnapshotCsv(SOURCE_URL, { fetchImpl: async () => new Response(null, {
    status: 302, headers: { location: 'http://example.org/data.csv' },
  }) }), /requires HTTPS/);
  await assert.rejects(downloadSnapshotCsv('http://example.org', { fetchImpl: async () => { throw new Error('must not fetch'); } }), /requires HTTPS/);
});

test('download rejects HTTP failures, advertised sizes, streamed size excess and deadlines', async () => {
  await assert.rejects(downloadSnapshotCsv(SOURCE_URL, { fetchImpl: async () => new Response('bad', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(downloadSnapshotCsv(SOURCE_URL, { maxBytes: 2, fetchImpl: async () => new Response('hello', {
    headers: { 'content-length': '5' },
  }) }), /size limit/);
  await assert.rejects(downloadSnapshotCsv(SOURCE_URL, { maxBytes: 2, fetchImpl: async () => new Response('hello') }), /size limit/);
  await assert.rejects(downloadSnapshotCsv(SOURCE_URL, { timeoutMs: 5, fetchImpl: async (_url, { signal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
  }), /deadline/);
});

async function fixture(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'karhutla-refresh-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, 'data'));
  await writeFile(path.join(rootDir, 'data/indonesia.geojson'), JSON.stringify(boundary));
  await writeFile(path.join(rootDir, 'data/fire-snapshot.json'), '{"previous":true}\n');
  await writeFile(path.join(rootDir, 'data/raw-noaa20-24h.csv'), 'previous raw');
  return rootDir;
}

test('refresh writes a complete verifiable snapshot and raw data without temporary leftovers', async t => {
  const rootDir = await fixture(t), raw = csv([row()]);
  const snapshot = await refreshSnapshot({ rootDir, fetchImpl: async () => new Response(raw), now: () => new Date('2026-11-04T12:00:00.900Z') });
  assert.equal(snapshot.source.url, SOURCE_URL);
  assert.equal(snapshot.source.rawSha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(snapshot.fetchedAt, '2026-11-04T12:00:00Z');
  assert.equal(snapshot.geographicFilter.method, 'point-in-polygon');
  assert.equal(snapshot.notes.length, 5);
  assert.deepEqual(JSON.parse(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8')), snapshot);
  assert.deepEqual(await readFile(path.join(rootDir, 'data/raw-noaa20-24h.csv')), raw);
  assert.equal((await readdir(path.join(rootDir, 'data'))).some(name => name.endsWith('.tmp')), false);
});

test('failed download, malformed CSV and invalid boundary retain both previous files', async t => {
  const rootDir = await fixture(t);
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => new Response('unusable'),
    async () => new Response(csv([`${row()},extra`]))]) {
    await assert.rejects(refreshSnapshot({ rootDir, fetchImpl }));
    assert.equal(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8'), '{"previous":true}\n');
    assert.equal(await readFile(path.join(rootDir, 'data/raw-noaa20-24h.csv'), 'utf8'), 'previous raw');
  }
  await writeFile(path.join(rootDir, 'data/indonesia.geojson'), '{}');
  await assert.rejects(refreshSnapshot({ rootDir, fetchImpl: async () => { throw new Error('must not fetch'); } }), /boundary/);
  assert.equal(await readFile(path.join(rootDir, 'data/fire-snapshot.json'), 'utf8'), '{"previous":true}\n');
});

test('offline CSV reprocessing uses the raw file timestamp and does not download', async t => {
  const rootDir = await fixture(t), fromCsv = path.join(rootDir, 'data/raw-noaa20-24h.csv');
  await writeFile(fromCsv, csv([row()]));
  const stamp = new Date('2026-11-01T01:23:45Z');
  await utimes(fromCsv, stamp, stamp);
  const snapshot = await refreshSnapshot({ rootDir, fromCsv, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(snapshot.fetchedAt, '2026-11-01T01:23:45Z');
  assert.equal(snapshot.records.length, 1);
});
