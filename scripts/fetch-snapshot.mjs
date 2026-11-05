#!/usr/bin/env node
// Runtime-only NASA refresh: Node's built-in HTTPS, CSV parsing and file APIs.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMain } from './is-main.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SOURCE_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv';
const DOCUMENTATION_URL = 'https://firms.modaps.eosdis.nasa.gov/active_fire/';
export const BBOX = Object.freeze([94.5, -11.5, 141.5, 6.5]);
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isoUTC = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function downloadSnapshotCsv(url = SOURCE_URL, { fetchImpl = fetch, timeoutMs = 60_000, maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);
  let next = new URL(url);
  try {
    for (let redirects = 0; redirects <= 10; redirects++) {
      if (next.protocol !== 'https:') throw new Error('NASA download requires HTTPS, including redirects.');
      const response = await fetchImpl(next.href, { signal: controller.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) throw new Error('NASA download returned a redirect without a destination.');
        next = new URL(location, next);
        continue;
      }
      if (!response.ok) throw new Error(`NASA download returned HTTP ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (length > maxBytes) { await response.body?.cancel(); throw new Error('NASA response exceeds the download size limit.'); }
      if (!response.body) throw new Error('NASA returned an empty response.');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new Error('NASA response exceeds the download size limit.');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, bytes);
    }
    throw new Error('NASA download exceeded the redirect limit.');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('NASA download exceeded its deadline; prior snapshot was retained.', { cause: error });
    throw new Error(`NASA download failed: ${error.message}; prior snapshot was retained.`, { cause: error });
  } finally { clearTimeout(deadline); }
}

export function pointInRing(x, y, ring) {
  let inside = false;
  let previous = ring.at(-1);
  for (const current of ring) {
    const [ax, ay] = previous, [bx, by] = current;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && Math.min(ax, bx) - 1e-10 <= x && x <= Math.max(ax, bx) + 1e-10
      && Math.min(ay, by) - 1e-10 <= y && y <= Math.max(ay, by) + 1e-10) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    previous = current;
  }
  return inside;
}

export function countryPolygons(document) {
  const geometries = document?.type === 'FeatureCollection' ? document.features?.map(feature => feature.geometry)
    : document?.type === 'Feature' ? [document.geometry] : [document];
  if (!Array.isArray(geometries) || !geometries.length) throw new Error('Country boundary must contain polygons.');
  const result = [];
  for (const geometry of geometries) {
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) throw new Error('Country boundary must contain polygons.');
    const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    if (!Array.isArray(polygons)) throw new Error('Invalid country boundary coordinates.');
    for (const rings of polygons) {
      if (!Array.isArray(rings) || !rings.length || rings.some(ring => !Array.isArray(ring) || ring.length < 3
        || ring.some(point => !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])))) {
        throw new Error('Invalid country boundary ring.');
      }
      const outer = rings[0];
      const bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of outer) {
        bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
      }
      result.push({ bbox, rings });
    }
  }
  if (!result.length) throw new Error('Country boundary must contain polygons.');
  return result;
}

export function insideCountry(longitude, latitude, polygons) {
  return polygons.some(({ bbox: [west, south, east, north], rings }) =>
    west <= longitude && longitude <= east && south <= latitude && latitude <= north
    && pointInRing(longitude, latitude, rings[0]) && !rings.slice(1).some(hole => pointInRing(longitude, latitude, hole)));
}

// Quoted commas, escaped quotes and embedded newlines are part of a field.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, closedQuote = false;
  const finishRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = []; field = ''; closedQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (quoted) {
      if (character === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
    } else if (character === ',') { row.push(field); field = ''; closedQuote = false; }
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else if (character === '"' && field === '' && !closedQuote) quoted = true;
    else {
      if (closedQuote || character === '"') throw new Error('Malformed quoted field in NASA CSV; prior snapshot was retained.');
      field += character;
    }
  }
  if (quoted) throw new Error('Unclosed quoted field in NASA CSV; prior snapshot was retained.');
  if (field !== '' || row.length || closedQuote) finishRow();
  return rows;
}

function number(value) {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Preserve the existing Python downloader's IDs, including integer coordinates
// represented as "1.0" and small coordinates represented as "1e-05".
function coordinateIdentity(value) {
  if (Object.is(value, -0)) return '-0.0';
  if (Number.isInteger(value)) return `${value}.0`;
  if (Math.abs(value) < 0.0001) return value.toExponential().replace(/e([+-])(\d)$/, (_match, sign, digit) => `e${sign}0${digit}`);
  return String(value);
}

function observationTime(day, time) {
  if (typeof day !== 'string' || typeof time !== 'string') return null;
  const date = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(day);
  const clock = /^(\d{2})(\d{2})$/.exec(time.trim().padStart(4, '0'));
  if (!date || !clock) return null;
  const [, year, month, dayOfMonth] = date.map(Number), [, hour, minute] = clock.map(Number);
  if (year < 1 || month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 || hour > 23 || minute > 59) return null;
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, dayOfMonth);
  instant.setUTCHours(hour, minute, 0, 0);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== dayOfMonth) return null;
  return isoUTC(instant);
}

export function normalize(raw, polygons) {
  const csv = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, '');
  const [header, ...rows] = parseCsv(csv);
  const required = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'frp'];
  if (!header || !required.every(name => header.includes(name)) || new Set(header).size !== header.length) {
    throw new Error('Response is not the expected NASA VIIRS CSV; prior snapshot was retained.');
  }
  const records = [], seen = new Set();
  const stats = { downloadedRows: 0, boundingBoxRows: 0, outsideCountryRows: 0, invalidRows: 0, duplicateRows: 0 };
  for (const fields of rows) {
    stats.downloadedRows++;
    if (fields.length !== header.length) throw new Error('NASA CSV row has the wrong number of fields; prior snapshot was retained.');
    const row = Object.fromEntries(header.map((name, i) => [name, fields[i]]));
    const latitude = number(row.latitude), longitude = number(row.longitude);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      stats.invalidRows++; continue;
    }
    if (!(BBOX[0] <= longitude && longitude <= BBOX[2] && BBOX[1] <= latitude && latitude <= BBOX[3])) continue;
    stats.boundingBoxRows++;
    if (polygons.length && !insideCountry(longitude, latitude, polygons)) { stats.outsideCountryRows++; continue; }
    const observedAt = observationTime(row.acq_date, row.acq_time);
    if (!observedAt) { stats.invalidRows++; continue; }
    const identity = `${row.satellite}|${observedAt}|${coordinateIdentity(latitude)}|${coordinateIdentity(longitude)}`;
    if (seen.has(identity)) { stats.duplicateRows++; continue; }
    seen.add(identity);
    records.push({ id: `viirs-${sha256(identity).slice(0, 16)}`, latitude, longitude, observedAt, frp: number(row.frp),
      confidence: row.confidence ?? 'unknown', dayNight: row.daynight ?? '', satellite: ['N20', '1'].includes(row.satellite) ? 'NOAA-20' : row.satellite,
      instrument: 'VIIRS', brightness: number(row.bright_ti4), brightnessTi5: number(row.bright_ti5), scan: number(row.scan), track: number(row.track), version: row.version ?? '' });
  }
  records.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
  stats.retainedRows = records.length;
  return { records, stats };
}

async function atomicWrite(filename, content) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: 'wx' }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}

export async function refreshSnapshot({ rootDir = ROOT, fromCsv, boundaryPath, fetchImpl, now = () => new Date(), downloadOptions = {} } = {}) {
  const data = path.join(rootDir, 'data');
  const boundary = boundaryPath || path.join(data, 'indonesia.geojson');
  let country;
  try { country = JSON.parse(await readFile(boundary, 'utf8')); }
  catch (error) { throw new Error('Country boundary missing or invalid; restore data/indonesia.geojson before fetching.', { cause: error }); }
  const polygons = countryPolygons(country);
  const raw = fromCsv ? await readFile(fromCsv) : await downloadSnapshotCsv(SOURCE_URL, { ...downloadOptions, ...(fetchImpl ? { fetchImpl } : {}) });
  const fetchedAt = fromCsv ? (await stat(fromCsv)).mtime : now();
  const { records, stats } = normalize(raw, polygons);
  const snapshot = {
    schemaVersion: 1,
    source: { name: 'NASA FIRMS — NOAA-20 VIIRS Collection 2', url: SOURCE_URL, documentationUrl: DOCUMENTATION_URL,
      sensor: 'VIIRS NOAA-20', nominalResolutionMeters: 375, frpUnit: 'MW', brightnessUnit: 'K',
      rawFile: 'data/raw-noaa20-24h.csv', rawSha256: sha256(raw) },
    fetchedAt: isoUTC(fetchedAt), observationStart: records[0]?.observedAt ?? null, observationEnd: records.at(-1)?.observedAt ?? null,
    windowLabel: 'NASA rolling 24-hour snapshot',
    geographicFilter: { country: 'Indonesia', iso3: 'IDN', method: 'point-in-polygon', boundary: 'data/indonesia.geojson',
      boundarySource: 'Natural Earth 1:10m', approximate: true, prefilterBbox: [...BBOX] },
    counts: stats,
    notes: [
      'This is a fixed snapshot of a rolling 24-hour source, not a live feed.',
      'Each detection marks a satellite pixel containing a thermal anomaly; it is not a distinct wildfire, fire perimeter, or burned-area estimate.',
      'Detections may include agricultural burning, industrial heat, or volcanoes. Clouds and satellite overpass timing can hide fires.',
      'Only NOAA-20 is included, avoiding overlap between different satellites; multiple detections may still belong to the same fire.',
      'A generalized Natural Earth 1:10m boundary filters detections to Indonesia; tiny islands and some coastal detections may be omitted.',
    ], records,
  };
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  await mkdir(data, { recursive: true });
  const rawPath = path.join(data, 'raw-noaa20-24h.csv');
  if (!fromCsv || path.resolve(fromCsv) !== path.resolve(rawPath)) await atomicWrite(rawPath, raw);
  await atomicWrite(path.join(data, 'fire-snapshot.json'), serialized);
  return snapshot;
}

async function main() {
  const { values } = parseArgs({ options: { 'from-csv': { type: 'string' }, boundary: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('Usage: node scripts/fetch-snapshot.mjs [--from-csv FILE] [--boundary FILE]\nFetch the public NASA NOAA-20 rolling 24-hour CSV. No API key or Python is needed.');
    return;
  }
  const snapshot = await refreshSnapshot({ fromCsv: values['from-csv'], boundaryPath: values.boundary });
  console.log(JSON.stringify({ records: snapshot.records.length, fetchedAt: snapshot.fetchedAt,
    observationStart: snapshot.observationStart, observationEnd: snapshot.observationEnd, counts: snapshot.counts }, null, 2));
}

if (isMain(import.meta)) {
  main().catch(error => { console.error(`Snapshot refresh failed: ${error.message}`); process.exitCode = 1; });
}
