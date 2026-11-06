import http from 'node:http';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { SharedRoom } from './shared-room.mjs';
import { stateFrame, statePacket } from './wire-state.mjs';
import { createBellRelay } from './bell-relay.mjs';
import { isMain } from '../scripts/is-main.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([
  ['/operator', ['app/operator.html', 'text/html; charset=utf-8']],
  ['/operator/', ['app/operator.html', 'text/html; charset=utf-8']],
  ['/operator.html', ['app/operator.html', 'text/html; charset=utf-8']],
  ['/operator.js', ['app/operator.js', 'text/javascript; charset=utf-8']],
  ['/operator.css', ['app/operator.css', 'text/css; charset=utf-8']],
  ['/performance-view.js', ['app/performance-view.js', 'text/javascript; charset=utf-8']],
  ['/audience-instructions.js', ['app/audience-instructions.js', 'text/javascript; charset=utf-8']],
  ['/scene-score.js', ['app/scene-score.js', 'text/javascript; charset=utf-8']],
  ['/projection', ['app/peat-study.html', 'text/html; charset=utf-8']],
  ['/projection/', ['app/peat-study.html', 'text/html; charset=utf-8']],
  ['/audience', ['app/peat-phone.html', 'text/html; charset=utf-8']],
  ['/audience/', ['app/peat-phone.html', 'text/html; charset=utf-8']],
  ['/sound-engine.js', ['app/sound-engine.js', 'text/javascript; charset=utf-8']],
  ['/phone-crickets.js', ['app/phone-crickets.js', 'text/javascript; charset=utf-8']],
  ['/phone-drone.js', ['app/phone-drone.js', 'text/javascript; charset=utf-8']],
  ['/main-spatial.js', ['app/main-spatial.js', 'text/javascript; charset=utf-8']],
  ['/scene-wildlife.js', ['app/scene-wildlife.js', 'text/javascript; charset=utf-8']],
  ['/audio-loudness.js', ['app/audio-loudness.js', 'text/javascript; charset=utf-8']],
  ['/patch-soft-tones.js', ['app/patch-soft-tones.js', 'text/javascript; charset=utf-8']],
  ['/phone-weather.js', ['app/phone-weather.js', 'text/javascript; charset=utf-8']],
  ['/phone-tap-rain.js', ['app/phone-tap-rain.js', 'text/javascript; charset=utf-8']],
  ['/main-quench.js', ['app/main-quench.js', 'text/javascript; charset=utf-8']],
  ['/drag-ash.js', ['app/drag-ash.js', 'text/javascript; charset=utf-8']],
  ['/rain-area.js', ['app/rain-area.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/participant-identity.js', ['visual-assets/participant-identity.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/extinction-feedback.js', ['visual-assets/extinction-feedback.js', 'text/javascript; charset=utf-8']],
  ['/sound-controls.js', ['app/sound-controls.js', 'text/javascript; charset=utf-8']],
  ['/sound-controls.css', ['app/sound-controls.css', 'text/css; charset=utf-8']],
  ['/sound-library.js', ['app/sound-library.js', 'text/javascript; charset=utf-8']],
  ['/sound-participants.js', ['app/sound-participants.js', 'text/javascript; charset=utf-8']],
  ['/sound-lab', ['app/sound-lab.html', 'text/html; charset=utf-8']],
  ['/sound-lab/', ['app/sound-lab.html', 'text/html; charset=utf-8']],
  ['/sound-lab.js', ['app/sound-lab.js', 'text/javascript; charset=utf-8']],
  ['/sound-lab.css', ['app/sound-lab.css', 'text/css; charset=utf-8']],
  ['/audio-assets/v3/manifest.json', ['audio-assets/v3/manifest.json', 'application/json; charset=utf-8']],
  ['/audio-assets/manifest.json', ['audio-assets/manifest.json', 'application/json; charset=utf-8']],
  ['/audio-assets/ATTRIBUTION.md', ['audio-assets/ATTRIBUTION.md', 'text/plain; charset=utf-8']],
  ['/audio-assets/fire-crackle.mp3', ['audio-assets/fire-crackle.mp3', 'audio/mpeg']],
  ['/audio-assets/fire-roar.mp3', ['audio-assets/fire-roar.mp3', 'audio/mpeg']],
  ['/audio-assets/charcoal.mp3', ['audio-assets/charcoal.mp3', 'audio/mpeg']],
  ['/audio-assets/rain.mp3', ['audio-assets/rain.mp3', 'audio/mpeg']],
  ['/audio-assets/burning-forest.mp3', ['audio-assets/burning-forest.mp3', 'audio/mpeg']],
  ['/audio-assets/crickets.mp3', ['audio-assets/crickets.mp3', 'audio/mpeg']],
  ['/country-view.mjs', ['app/country-view.mjs', 'text/javascript; charset=utf-8']],
  ['/app/country-view.mjs', ['app/country-view.mjs', 'text/javascript; charset=utf-8']],
  ['/data/indonesia-overview.geojson', ['data/indonesia-overview.geojson', 'application/geo+json']],
  ['/visual-assets/rain-feedback.js', ['visual-assets/rain-feedback.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/final-rain.js', ['visual-assets/final-rain.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/rain-cloud.webp', ['visual-assets/rain-cloud.webp', 'image/webp']],
  ['/study', ['app/peat-study.html', 'text/html; charset=utf-8']],
  ['/study/', ['app/peat-study.html', 'text/html; charset=utf-8']],
  ['/study/phone', ['app/peat-phone.html', 'text/html; charset=utf-8']],
  ['/study/phone/', ['app/peat-phone.html', 'text/html; charset=utf-8']],
  ['/peat-study.js', ['app/peat-study.js', 'text/javascript; charset=utf-8']],
  ['/peat-study.css', ['app/peat-study.css', 'text/css; charset=utf-8']],
  ['/peat-phone.js', ['app/peat-phone.js', 'text/javascript; charset=utf-8']],
  ['/phone-magnifier.js', ['app/phone-magnifier.js', 'text/javascript; charset=utf-8']],
  ['/peat-phone.css', ['app/peat-phone.css', 'text/css; charset=utf-8']],
  ['/study-state.mjs', ['app/study-state.mjs', 'text/javascript; charset=utf-8']],
  ['/visual-assets/surface-heat.js', ['visual-assets/surface-heat.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/surface-heat-atlas.webp', ['visual-assets/surface-heat-atlas.webp', 'image/webp']],
  ['/visual-assets/peat-section.js', ['visual-assets/peat-section.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/peat-surface.js', ['visual-assets/peat-surface.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/peat-material.png', ['visual-assets/peat-material.png', 'image/png']],
  ['/visual-assets/peat-smoke.png', ['visual-assets/peat-smoke.png', 'image/png']],
  ['/visual-assets/peat-material.webp', ['visual-assets/peat-material.webp', 'image/webp']],
  ['/visual-assets/peat-material-phone.webp', ['visual-assets/peat-material-phone.webp', 'image/webp']],
  ['/visual-assets/peat-smoke.webp', ['visual-assets/peat-smoke.webp', 'image/webp']],
  ['/', ['app/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['app/index.html', 'text/html; charset=utf-8']],
  ['/join', ['app/join.html', 'text/html; charset=utf-8']],
  ['/join/', ['app/join.html', 'text/html; charset=utf-8']],
  ['/join.js', ['app/join.js', 'text/javascript; charset=utf-8']],
  ['/join.css', ['app/join.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['app/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app/app.js', 'text/javascript; charset=utf-8']],
  ['/shared-client.js', ['app/shared-client.js', 'text/javascript; charset=utf-8']],
  ['/simulation.js', ['app/simulation.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['app/favicon.svg', 'image/svg+xml']],
  ['/visual-assets/', ['visual-assets/index.html', 'text/html; charset=utf-8']],
  ['/visual-assets/index.html', ['visual-assets/index.html', 'text/html; charset=utf-8']],
  ['/visual-assets/preview.css', ['visual-assets/preview.css', 'text/css; charset=utf-8']],
  ['/visual-assets/preview.js', ['visual-assets/preview.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/renderer.js', ['visual-assets/renderer.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/map-forest.js', ['visual-assets/map-forest.js', 'text/javascript; charset=utf-8']],
  ['/visual-assets/map-weather.js', ['visual-assets/map-weather.js', 'text/javascript; charset=utf-8']],
  ['/data/indonesia.geojson', ['data/indonesia.geojson', 'application/geo+json']],
  ['/data/surrounding-land.geojson', ['data/surrounding-land.geojson', 'application/geo+json']],
  ['/data/geography-metadata.json', ['data/geography-metadata.json', 'application/json']],
  ['/data/fire-snapshot.json', ['data/fire-snapshot.json', 'application/json']],
]);
for (const name of ['asset-sheet.png', 'rainfall.png', 'surface-fire.png', 'embers.png', 'out-burned-remains.png', 'forest-transition-spritesheet.png', 'rainfall.gif', 'forest-transition.gif', 'wildfire-lofi-assets.zip']) {
  const type = name.endsWith('.zip') ? 'application/zip' : name.endsWith('.gif') ? 'image/gif' : 'image/png';
  staticFiles.set(`/visual-assets/exports/${name}`, [`visual-assets/exports/${name}`, type]);
}

function sendJSON(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const normalizeIP = value => (value || '').replace(/^::ffff:/, '');
const loopback = address => address === '::1' || /^127\./.test(address);
const privateIP = address => /^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);

export function localNetworkInfo(interfaces = os.networkInterfaces()) {
  const addresses = [];
  const ownAddresses = new Set(['127.0.0.1', '::1']);
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      ownAddresses.add(normalizeIP(entry.address));
      if (entry.internal || !['IPv4', 4].includes(entry.family) || /^169\.254\./.test(entry.address)) continue;
      const physical = /^(en\d|eth\d|wlan\d|wi-?fi)/i.test(name);
      const virtual = /^(utun|tun|tap|tailscale|wg|docker|veth|bridge|br-)/i.test(name);
      addresses.push({ address: entry.address, name, score: (privateIP(entry.address) ? 0 : 4) + (physical ? 0 : virtual ? 3 : 1) });
    }
  }
  addresses.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return { addresses: [...new Set(addresses.map(entry => entry.address))], ownAddresses };
}

async function jsonBody(request, maxBytes = 8 * 1024 * 1024) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Expected a valid JSON body.'), { status: 400 }); }
}

export async function createPerformanceServer(options = {}) {
  const root = options.rootDir || workspaceRoot;
  const configuredPort = options.port ?? Number(process.env.PORT || 4173);
  const lanEnabled = options.lanEnabled ?? false;
  const network = localNetworkInfo(options.networkInterfaces);
  const refreshNetwork = () => {
    const current = localNetworkInfo(options.networkInterfaces);
    // Wi-Fi/Ethernet addresses can change while the performance keeps running.
    // Keep published references current without replacing the server or room.
    network.addresses.splice(0, network.addresses.length, ...current.addresses);
    network.ownAddresses.clear();
    for (const address of current.ownAddresses) network.ownAddresses.add(address);
    return network;
  };
  const persistencePath = options.persistencePath === undefined ? path.join(root, 'data/performance-state.json') : options.persistencePath;
  let savedSnapshot = null;
  try { savedSnapshot = JSON.parse(await readFile(path.join(root, 'data/fire-snapshot.json'), 'utf8')); }
  catch { /* The operator can fetch the first snapshot later. */ }
  const room = new SharedRoom({
    records: options.records ?? savedSnapshot?.records ?? [],
    snapshotVersion: options.snapshotVersion ?? savedSnapshot?.fetchedAt ?? null,
    persistencePath, clock: options.clock, wallClock: options.wallClock,
  });
  room.on('persistenceWarning', error => console.warn('Shared state could not be restored:', error.message));
  await room.initialize();
  let activeRefresh = null;
  let closed = false;
  const sockets = new Map();
  const bellRelay = createBellRelay({ room, deliver: event => {
    const payload = JSON.stringify(event);
    for (const connection of sockets.values()) if (connection.readyState === WebSocket.OPEN && connection.bufferedAmount < 65536) connection.send(payload);
  } });
  const operatorAllowed = (request, currentNetwork = refreshNetwork()) => {
    const address = normalizeIP(request.socket.remoteAddress);
    return loopback(address) || currentNetwork.ownAddresses.has(address);
  };
  const sameOrigin = request => !request.headers.origin || request.headers.origin === `http://${request.headers.host}`;
  const readOnlyRequest = request => {
    if (request.headers['x-wildfire-role'] === 'projection' || request.headers['x-wildfire-role'] === 'participant') return true;
    // A projection opened on the host is still a display. Its browser fetches
    // carry the page location even though its IP also belongs to the operator.
    try { return /^\/(?:projection|study|audience)(?:\/|$)/.test(new URL(request.headers.referer).pathname); }
    catch { return false; }
  };
  const port = () => server.address()?.port || configuredPort;
  const session = request => {
    const currentNetwork = refreshNetwork();
    const joinUrls = lanEnabled && currentNetwork.addresses.length ? currentNetwork.addresses.map(address => `http://${address}:${port()}/join`) : [`http://127.0.0.1:${port()}/join`];
    const audienceUrls = joinUrls.map(value => { const url = new URL(value); url.pathname = '/audience'; return url.href; });
    return { joinUrl: joinUrls[0], joinUrls, audienceUrl: audienceUrls[0], audienceUrls, scene: room.sceneState(), soundSettings: room.soundSettingsState(), lanEnabled, bootstrapAvailable: room.bootstrapAvailable, strength: room.strength, operatorAllowed: operatorAllowed(request, currentNetwork), networkAvailable: !lanEnabled || currentNetwork.addresses.length > 0 };
  };
  let revision = 0, lastPhoneBroadcast = -Infinity;
  const ACTOR_INTERVAL_MS = 1000 / 30;
  let actorTimer = null, lastActorPublish = -Infinity;
  const needsActors = connection => ['operator', 'projection'].includes(connection.role) && connection.readyState === WebSocket.OPEN
    && connection.baseline?.state.epoch === room.epoch && connection.actorRevisionSent !== room.actorRevision;
  const scheduleActors = () => {
    if (closed || actorTimer || ![...sockets.values()].some(needsActors)) return;
    const delay = ACTOR_INTERVAL_MS - (performance.now() - lastActorPublish);
    if (delay > 0) {
      actorTimer = setTimeout(() => { actorTimer = null; scheduleActors(); }, Math.ceil(delay));
      actorTimer.unref();
      return;
    }
    let serialized = null, blocked = false;
    for (const connection of sockets.values()) {
      if (!needsActors(connection)) continue;
      // Motion is disposable: never queue it behind a larger state update.
      // Once the socket clears, send the latest positions, not a saved packet.
      if (connection.stateSending || connection.actorSending || connection.bufferedAmount > 0) { blocked = true; continue; }
      if (!serialized) {
        serialized = JSON.stringify(room.actorState());
        lastActorPublish = performance.now();
      }
      connection.actorSending = true;
      connection.actorRevisionSent = room.actorRevision;
      connection.send(serialized, error => {
        connection.actorSending = false;
        if (error) connection.actorRevisionSent = -1;
        scheduleActors();
      });
    }
    if (blocked && !actorTimer) {
      actorTimer = setTimeout(() => { actorTimer = null; scheduleActors(); }, Math.ceil(ACTOR_INTERVAL_MS));
      actorTimer.unref();
    }
  };
  const makeFrame = () => stateFrame(room.wireState(), ++revision);
  const sendUpdate = (connection, packet, frame = null) => {
    // One in-flight update per socket; control acknowledgments go immediately.
    // Never enqueue obsolete states behind a slow or suspended display.
    if (connection.readyState !== WebSocket.OPEN || connection.stateSending || connection.actorSending || connection.bufferedAmount > 64 * 1024) return false;
    connection.stateSending = true;
    connection.send(JSON.stringify(packet), error => {
      connection.stateSending = false;
      if (error) connection.baseline = null;
      scheduleActors();
    });
    if (frame) {
      connection.baseline = frame;
      connection.actorRevisionSent = frame.state.actorRevision;
    }
    return true;
  };
  const broadcast = ({ forcePhone = false } = {}) => {
    const now = performance.now();
    const phonesDue = forcePhone || options.autoTick === false || now - lastPhoneBroadcast >= 480;
    let frame = null, summaries = null;
    for (const [connectionId, connection] of sockets) {
      if (connection.readyState !== WebSocket.OPEN || connection.stateSending || connection.actorSending || connection.bufferedAmount > 64 * 1024) continue;
      if (connection.role === 'participant') {
        if (!phonesDue) continue;
        summaries ??= new Map();
        sendUpdate(connection, room.phoneState(connectionId, summaries));
      } else {
        frame ??= makeFrame();
        sendUpdate(connection, statePacket(frame, connection.baseline), frame);
      }
    }
    if (phonesDue) lastPhoneBroadcast = now;
    scheduleActors();
  };
  const snapshot = async () => JSON.parse(await readFile(path.join(root, 'data/fire-snapshot.json'), 'utf8'));
  function refreshSnapshot() {
    if (activeRefresh) return activeRefresh;
    activeRefresh = new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/fetch-snapshot.mjs'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '', timedOut = false;
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 110_000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', async code => {
        clearTimeout(timer);
        if (code !== 0) {
          console.error('Snapshot refresh failed:', stderr || `exit ${code}`);
          reject(new Error(timedOut ? 'The NASA download timed out. Please try again.' : 'Could not download a fresh NASA snapshot. Please try again.'));
          return;
        }
        try {
          const current = await snapshot();
          room.seed(current.records, current.fetchedAt);
          await room.persist();
          broadcast({ forcePhone: true });
          resolve(current);
        } catch (error) { reject(error); }
      });
    }).finally(() => { activeRefresh = null; });
    return activeRefresh;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Preserve the page path on same-origin fetches so a host-local projection
    // remains read-only. Cross-origin requests receive no referrer at all.
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/api/session') {
        if (request.method !== 'GET') return sendJSON(response, 405, { error: 'Use GET.' });
        return sendJSON(response, 200, session(request));
      }
      if (url.pathname === '/api/scene' && request.method === 'GET') return sendJSON(response, 200, room.sceneState());
      if (url.pathname === '/api/sound-settings' && request.method === 'GET') return sendJSON(response, 200, room.soundSettingsState());
      if (url.pathname === '/api/settings/export') {
        if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return sendJSON(response, 405, { error: 'Use GET.' }); }
        if (!operatorAllowed(request) || readOnlyRequest(request)) return sendJSON(response, 403, { error: 'Only the operator page on the host computer can export settings.' });
        if (!sameOrigin(request)) return sendJSON(response, 403, { error: 'Open the local prototype to export settings.' });
        return sendJSON(response, 200, room.exportSettingsPreset());
      }
      if (url.pathname === '/api/qr.svg') {
        if (request.method !== 'GET') return sendJSON(response, 405, { error: 'Use GET.' });
        const join = new URL(session(request).joinUrl);
        if (url.searchParams.get('view') === 'peat') join.pathname = '/study/phone';
        if (url.searchParams.get('view') === 'audience') join.pathname = '/audience';
        const svg = await QRCode.toString(join.href, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 });
        response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(svg);
      }
      if (url.pathname === '/api/study-region') {
        if (request.method !== 'GET') return sendJSON(response, 405, { error: 'Use GET.' });
        if (!operatorAllowed(request)) return sendJSON(response, 403, { error: 'Open the study on the operator computer.' });
        if (url.searchParams.get('region') === 'indonesia') return sendJSON(response, 200, room.national.layout(room.snapshotVersion));
        const region = room.regions.regions.get(url.searchParams.get('region') || 'kalimantan');
        if (!region) return sendJSON(response, 400, { error: 'Unknown study region.' });
        // A read-only view of the exact phone coordinate mapping. Fetching this
        // layout never seeds/resets the simulation or modifies saved progress.
        return sendJSON(response, 200, {
          id: region.id, name: region.name, rows: region.rows, fireKeys: [...region.fireKeys],
          snapshotVersion: room.snapshotVersion,
          regions: [...room.regions.regions.values()].map(item => ({ id: item.id, name: item.name, fireCells: item.fireKeys.size })),
        });
      }
      if (['/api/bootstrap', '/api/reset', '/api/strength', '/api/parameters', '/api/snapshot/refresh', '/api/firms/refresh', '/api/scene', '/api/sound-settings', '/api/settings/import'].includes(url.pathname)) {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          return sendJSON(response, 405, { error: 'Use POST.' });
        }
        if (!operatorAllowed(request) || readOnlyRequest(request)) return sendJSON(response, 403, { error: 'Only the operator page on the host computer can change performance settings.' });
        if (!sameOrigin(request)) return sendJSON(response, 403, { error: 'Open the local prototype to change performance settings.' });
        if (!(request.headers['content-type'] || '').startsWith('application/json')) return sendJSON(response, 415, { error: 'Expected application/json.' });
        const body = await jsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJSON(response, 400, { error: 'Expected a JSON object.' });
        if (['/api/snapshot/refresh', '/api/firms/refresh'].includes(url.pathname)) {
          try { return sendJSON(response, 200, await refreshSnapshot()); }
          catch (error) { return sendJSON(response, 502, { error: error.message }); }
        }
        let state;
        if (url.pathname === '/api/bootstrap') state = await room.bootstrap(body);
        else if (url.pathname === '/api/reset') state = await room.reset();
        else if (url.pathname === '/api/parameters') state = await room.setParameters(body.parameters);
        else if (url.pathname === '/api/scene') state = await room.setScene(body);
        else if (url.pathname === '/api/sound-settings') state = await room.setSoundSettings(body);
        else if (url.pathname === '/api/settings/import') state = await room.importSettingsPreset(body);
        else state = await room.setStrength(body.strength);
        broadcast({ forcePhone: true });
        return sendJSON(response, 200, state);
      }
      if (url.pathname === '/api/snapshot') {
        if (request.method !== 'GET') return sendJSON(response, 405, { error: 'Use GET.' });
        try {
          const current = await snapshot();
          // Reconcile snapshots also refreshed by the local command-line helper.
          if (current.fetchedAt !== room.snapshotVersion) {
            room.seed(current.records, current.fetchedAt);
            await room.persist();
            broadcast({ forcePhone: true });
          }
          return sendJSON(response, 200, current);
        }
        catch { return sendJSON(response, 404, { error: 'No saved snapshot yet. Fetch one to begin.' }); }
      }
      if (url.pathname === '/api/health') return sendJSON(response, 200, { status: 'ok', refreshing: Boolean(activeRefresh), authorityReady: !room.bootstrapAvailable, bootstrapAvailable: room.bootstrapAvailable });
      if (!['GET', 'HEAD'].includes(request.method)) return sendJSON(response, 405, { error: 'Method not allowed.' });
      const file = staticFiles.get(url.pathname) || (/^\/audio-assets\/v3\/[a-z0-9-]+\.mp3$/.test(url.pathname) ? [url.pathname.slice(1), 'audio/mpeg'] : null);
      if (!file) return sendJSON(response, 404, { error: 'Not found.' });
      try {
        const content = await readFile(path.join(root, file[0]));
        response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch { sendJSON(response, 404, { error: 'File unavailable.' }); }
    } catch (error) {
      if (!response.headersSent) sendJSON(response, error.status || 500, { error: error.message || 'Request failed.' });
      else response.end();
    }
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const rejectUpgrade = (status, message) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${message}`); };
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1'); }
    catch { return rejectUpgrade('400 Bad Request', 'Invalid URL.'); }
    if (url.pathname !== '/ws') return rejectUpgrade('404 Not Found', 'Not found.');
    if (!sameOrigin(request)) return rejectUpgrade('403 Forbidden', 'Connection origin is not allowed.');
    const role = url.searchParams.get('role') || 'participant';
    const scope = url.searchParams.get('scope') || 'region';
    const clientId = url.searchParams.get('clientId');
    if (!['operator', 'participant', 'projection'].includes(role) || !clientId || !/^[a-zA-Z0-9_-]{1,128}$/.test(clientId)) return rejectUpgrade('400 Bad Request', 'Invalid role or clientId.');
    if (!['region', 'indonesia'].includes(scope)) return rejectUpgrade('400 Bad Request', 'Invalid audience scope.');
    if (role === 'operator' && !operatorAllowed(request)) return rejectUpgrade('403 Forbidden', 'Operator access is local to the host computer.');
    socket.setNoDelay(true);
    webSockets.handleUpgrade(request, socket, head, connection => {
      let welcome;
      try { welcome = room.connect({ clientId, role, scope }); }
      catch (error) { connection.close(1008, error.message.slice(0, 120)); return; }
      const connectionId = welcome.connectionId;
      sockets.set(connectionId, connection);
      connection.role = role;
      connection.baseline = null;
      connection.stateSending = false;
      connection.actorSending = false;
      connection.actorRevisionSent = -1;
      connection.isAlive = true;
      connection.on('pong', () => { connection.isAlive = true; });
      connection.on('error', () => {});
      connection.on('message', (raw, binary) => {
        try {
          if (binary) throw new Error('Only JSON control messages are accepted.');
          const message = JSON.parse(raw.toString());
          if (message.type === 'bell') {
            // A visual cue never participates in hold acknowledgments, water,
            // persistence, or input-error recovery.
            try { bellRelay.publish(connection.role, message); }
            catch { /* Invalid or late visual-only cues are consumed. */ }
            return;
          }
          if (message.type === 'resync') {
            connection.baseline = null;
            broadcast({ forcePhone: true });
            return;
          }
          const ack = room.hold(connectionId, message);
          if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(ack));
          scheduleActors();
        } catch (error) {
          if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      });
      connection.on('close', () => { sockets.delete(connectionId); room.disconnect(connectionId); scheduleActors(); });
      connection.send(JSON.stringify(welcome));
      if (role === 'participant') sendUpdate(connection, room.phoneState(connectionId));
      else {
        const frame = makeFrame();
        sendUpdate(connection, statePacket(frame), frame);
      }
      scheduleActors();
    });
  });
  room.on('replaced', connectionId => sockets.get(connectionId)?.close(4001, 'This participant joined in another tab.'));
  const timers = [];
  const tick = () => { room.advance(); scheduleActors(); };
  if (options.autoTick !== false) {
    // Publish immediately after every second simulation step. Independent
    // timers drift relative to each other and can publish a state almost one
    // 50ms tick old, adding that age to the display's existing network wait.
    // Rates remain 20Hz simulation / 10Hz state; no additional water step.
    let ticksSinceBroadcast = 0;
    timers.push(setInterval(() => {
      tick();
      if (++ticksSinceBroadcast === 2) {
        ticksSinceBroadcast = 0;
        broadcast();
      }
    }, 50));
    timers.push(setInterval(() => room.persist().catch(error => console.error('Shared state save failed:', error.message)), 5000));
    timers.push(setInterval(() => {
      for (const socket of sockets.values()) {
        if (!socket.isAlive) { socket.terminate(); continue; }
        socket.isAlive = false;
        socket.ping();
      }
    }, 15000));
    for (const timer of timers) timer.unref();
  }
  return {
    server, room, network, broadcast, tick,
    listen(listenPort = configuredPort) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, lanEnabled ? '0.0.0.0' : '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(actorTimer);
      for (const timer of timers) clearInterval(timer);
      for (const connectionId of [...room.connections.keys()]) room.disconnect(connectionId);
      for (const socket of sockets.values()) socket.terminate();
      await room.persist();
      await new Promise(resolve => webSockets.close(resolve));
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

if (isMain(import.meta)) {
  const lanEnabled = process.argv.includes('--lan') || process.env.LAN === '1';
  const instance = await createPerformanceServer({ lanEnabled });
  const address = await instance.listen();
  console.log(`Operator: http://127.0.0.1:${address.port}/operator`);
  console.log(`Projection: http://127.0.0.1:${address.port}/projection`);
  if (lanEnabled) {
    if (instance.network.addresses.length) console.log(`Audience: http://${instance.network.addresses[0]}:${address.port}/audience`);
    else console.warn('No LAN IPv4 address found. Connect this computer to Wi-Fi or Ethernet.');
  } else console.log('Audience phones: restart with --lan or LAN=1 to enable local Wi-Fi access.');
  const shutdown = async () => { await instance.close(); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
