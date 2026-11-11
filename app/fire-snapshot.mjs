// Shared by the browser preview and the server. Validation never fetches URLs
// or changes a snapshot, room, settings file, or source observation in place.
export const MAX_FIRE_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_FIRE_SNAPSHOT_RECORDS = 50000;
export const FIRE_SNAPSHOT_BBOX = Object.freeze([94.5, -11.5, 141.5, 6.5]);

const topKeys = ['schemaVersion', 'source', 'fetchedAt', 'observationStart', 'observationEnd', 'windowLabel', 'geographicFilter', 'counts', 'notes', 'records'];
const sourceKeys = ['name', 'url', 'documentationUrl', 'sensor', 'nominalResolutionMeters', 'frpUnit', 'brightnessUnit', 'rawFile', 'rawSha256'];
const filterKeys = ['country', 'iso3', 'method', 'boundary', 'boundarySource', 'approximate', 'prefilterBbox'];
const countKeys = ['downloadedRows', 'boundingBoxRows', 'outsideCountryRows', 'invalidRows', 'duplicateRows', 'retainedRows'];
const recordKeys = ['id', 'latitude', 'longitude', 'observedAt', 'frp', 'confidence', 'dayNight', 'satellite', 'instrument', 'brightness', 'brightnessTi5', 'scan', 'track', 'version'];
const numericLimits = { frp: 10000000, brightness: 10000, brightnessTi5: 10000, scan: 10000, track: 10000 };
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(message) { throw Object.assign(new Error(`Invalid fire snapshot: ${message}`), { status: 400 }); }
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label} must be a JSON object.`);
  const extra = Object.keys(value).find(key => !keys.includes(key));
  if (extra !== undefined) invalid(`${label} contains an unsupported field. Choose a fire snapshot JSON file, not a settings or account file.`);
  return value;
}
function text(value, label, max = 256, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
    || /<\s*\/?\s*[a-z!][^>]*>/i.test(value)) invalid(`${label} must be plain text${empty ? '' : ' and cannot be empty'}.`);
  return value;
}
function exact(value, expected, label) {
  if (value !== expected) invalid(`${label} must be ${expected}.`);
  return value;
}
function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) invalid(`${label} must be an ISO UTC timestamp ending in Z.`);
  const milliseconds = Date.parse(value), date = new Date(milliseconds);
  const canonical = Number.isFinite(milliseconds) ? date.toISOString() : '';
  const expected = value.includes('.') ? value.replace(/\.(\d+)Z$/, (_match, digits) => `.${digits.padEnd(3, '0')}Z`) : value.replace(/Z$/, '.000Z');
  if (canonical !== expected) invalid(`${label} is not a valid calendar date and time.`);
  return milliseconds;
}
function nasaURL(value, label, { source = false } = {}) {
  text(value, label, 2048);
  let url;
  try { url = new URL(value); } catch { invalid(`${label} must be a NASA FIRMS HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.hostname !== 'firms.modaps.eosdis.nasa.gov' || url.username || url.password || url.port || url.search || url.hash
    || (source && !/^\/data\/active_fire\/noaa-20-viirs-c2\/csv\/J1_VIIRS_C2_Global_24h\.csv$/.test(url.pathname))) {
    invalid(`${label} must identify the supported NASA FIRMS NOAA-20 source${source ? ' CSV' : ''} over HTTPS.`);
  }
  return value;
}
function sourceMetadata(value) {
  const source = object(value, sourceKeys, 'Source metadata');
  const name = text(source.name, 'Source name', 256);
  if (!/NASA\s+FIRMS/i.test(name) || !/NOAA-20/i.test(name) || !/VIIRS/i.test(name)) invalid('Source name must identify NASA FIRMS NOAA-20 VIIRS.');
  const result = { name, url: nasaURL(source.url, 'Source URL', { source: true }) };
  if (owns(source, 'documentationUrl')) result.documentationUrl = nasaURL(source.documentationUrl, 'Documentation URL');
  result.sensor = exact(source.sensor, 'VIIRS NOAA-20', 'Source sensor');
  if (owns(source, 'nominalResolutionMeters')) result.nominalResolutionMeters = exact(source.nominalResolutionMeters, 375, 'Nominal resolution');
  if (owns(source, 'frpUnit')) result.frpUnit = exact(source.frpUnit, 'MW', 'FRP unit');
  if (owns(source, 'brightnessUnit')) result.brightnessUnit = exact(source.brightnessUnit, 'K', 'Brightness unit');
  if (owns(source, 'rawFile')) {
    const file = text(source.rawFile, 'Raw source file', 256);
    if (!/^data\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.csv$/.test(file) || file.includes('..')) invalid('Raw source file must be a local data CSV reference.');
    result.rawFile = file;
  }
  if (owns(source, 'rawSha256')) {
    if (typeof source.rawSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(source.rawSha256)) invalid('Raw source checksum must be a SHA-256 hex string.');
    result.rawSha256 = source.rawSha256;
  }
  return result;
}
function geographicMetadata(value) {
  const filter = object(value, filterKeys, 'Geographic filter');
  exact(filter.country, 'Indonesia', 'Country'); exact(filter.iso3, 'IDN', 'Country code');
  exact(filter.method, 'point-in-polygon', 'Country filtering method');
  exact(filter.boundary, 'data/indonesia.geojson', 'Country boundary');
  if (typeof filter.approximate !== 'boolean') invalid('Country filter approximate flag must be true or false.');
  if (!Array.isArray(filter.prefilterBbox) || filter.prefilterBbox.length !== 4
    || filter.prefilterBbox.some((number, index) => number !== FIRE_SNAPSHOT_BBOX[index])) invalid('Country prefilter bounding box does not match Indonesia.');
  return { country: filter.country, iso3: filter.iso3, method: filter.method, boundary: filter.boundary,
    boundarySource: text(filter.boundarySource, 'Country boundary source', 256), approximate: filter.approximate, prefilterBbox: [...filter.prefilterBbox] };
}
function observation(value, index, ids, positions) {
  const label = `Observation ${index + 1}`, record = object(value, recordKeys, label);
  const id = text(record.id, `${label} ID`, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) invalid(`${label} ID contains unsupported characters.`);
  if (ids.has(id)) invalid(`${label} repeats an observation ID. Remove duplicate observations before importing.`);
  ids.add(id);
  const latitude = record.latitude, longitude = record.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || longitude < FIRE_SNAPSHOT_BBOX[0] || longitude > FIRE_SNAPSHOT_BBOX[2]
    || latitude < FIRE_SNAPSHOT_BBOX[1] || latitude > FIRE_SNAPSHOT_BBOX[3]) invalid(`${label} has coordinates outside the Indonesia bounding box.`);
  const time = timestamp(record.observedAt, `${label} time`);
  exact(record.satellite, 'NOAA-20', `${label} satellite`); exact(record.instrument, 'VIIRS', `${label} instrument`);
  const position = `${longitude}|${latitude}|${time}`;
  if (positions.has(position)) invalid(`${label} repeats the same satellite observation time and coordinates.`);
  positions.add(position);
  const result = { id, latitude, longitude, observedAt: record.observedAt };
  if (owns(record, 'frp')) result.frp = numeric(record.frp, numericLimits.frp, `${label} FRP`);
  if (owns(record, 'confidence')) result.confidence = text(record.confidence, `${label} confidence`, 32, { empty: true });
  if (owns(record, 'dayNight')) {
    if (!['D', 'N', ''].includes(record.dayNight)) invalid(`${label} day/night must be D, N or empty.`);
    result.dayNight = record.dayNight;
  }
  result.satellite = record.satellite; result.instrument = record.instrument;
  for (const key of ['brightness', 'brightnessTi5', 'scan', 'track']) if (owns(record, key)) result[key] = numeric(record[key], numericLimits[key], `${label} ${key}`);
  if (owns(record, 'version')) result.version = text(record.version, `${label} version`, 64, { empty: true });
  return { record: result, time };
}
function numeric(value, maximum, label) {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > maximum)) invalid(`${label} must be a finite non-negative number or null.`);
  return value;
}
function countsMetadata(value, retained) {
  const counts = object(value, countKeys, 'Row counts'), result = {};
  for (const key of countKeys) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) invalid(`Row count ${key} must be a non-negative integer.`);
    result[key] = counts[key];
  }
  if (result.retainedRows !== retained) invalid('Retained row count does not match the observations in this file.');
  const keptOrExcluded = result.retainedRows + result.outsideCountryRows + result.duplicateRows;
  const invalidInside = result.boundingBoxRows - keptOrExcluded;
  if (result.downloadedRows < result.boundingBoxRows || invalidInside < 0 || invalidInside > result.invalidRows
    || result.downloadedRows < keptOrExcluded + result.invalidRows) invalid('Downloaded, filtered and retained row counts are inconsistent.');
  return result;
}

export function validateFireSnapshot(value) {
  const snapshot = object(value, topKeys, 'File');
  exact(snapshot.schemaVersion, 1, 'Schema version');
  const source = sourceMetadata(snapshot.source);
  timestamp(snapshot.fetchedAt, 'Fetch time');
  const filter = geographicMetadata(snapshot.geographicFilter);
  if (!Array.isArray(snapshot.records)) invalid('Observations must be a records array. Choose the exported fire snapshot JSON, not raw NASA CSV.');
  if (snapshot.records.length > MAX_FIRE_SNAPSHOT_RECORDS) invalid(`This file exceeds the ${MAX_FIRE_SNAPSHOT_RECORDS.toLocaleString('en-US')} observation limit.`);
  const ids = new Set(), positions = new Set(), records = [];
  let start = Infinity, end = -Infinity;
  for (let index = 0; index < snapshot.records.length; index++) {
    const next = observation(snapshot.records[index], index, ids, positions);
    records.push(next.record); start = Math.min(start, next.time); end = Math.max(end, next.time);
  }
  if (records.length) {
    if (timestamp(snapshot.observationStart, 'Observation start') !== start || timestamp(snapshot.observationEnd, 'Observation end') !== end) invalid('Observation start/end must match the earliest and latest records in this file.');
  } else if (snapshot.observationStart !== null || snapshot.observationEnd !== null) invalid('A snapshot with no observations must have null observation start and end.');
  if (!Array.isArray(snapshot.notes) || snapshot.notes.length > 32) invalid('Source notes must be a list of up to 32 plain-text notes.');
  const notes = snapshot.notes.map((note, index) => text(note, `Source note ${index + 1}`, 2048));
  return { schemaVersion: 1, source, fetchedAt: snapshot.fetchedAt,
    observationStart: snapshot.observationStart, observationEnd: snapshot.observationEnd,
    windowLabel: text(snapshot.windowLabel, 'Observation window label', 256), geographicFilter: filter,
    counts: countsMetadata(snapshot.counts, records.length), notes, records };
}
