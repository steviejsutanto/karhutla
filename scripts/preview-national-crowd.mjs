// REHEARSAL ONLY: this fixture is intentionally hard-coded to the transient
// preview on loopback port 4185. It cannot target the real performance on 4173.
// Run: node scripts/preview-national-crowd.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { RegionCatalog } from '../regions.mjs';
import { NationalSpace, COUNTRY_BOUNDS } from '../national-space.mjs';

const ENDPOINT = new URL('ws://127.0.0.1:4185/ws');
if (ENDPOINT.hostname !== '127.0.0.1' || ENDPOINT.port !== '4185') throw new Error('Crowd preview must use the separate loopback rehearsal on port 4185.');
const COUNT = 50, DURATION_MS = 45000;
const peers = [], errors = [];
const runId = Date.now().toString(36);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let movementTimer = null, finishTimer = null, stopping = false, started = null, rounds = 0;
let stopResolve;
const stopped = new Promise(resolve => { stopResolve = resolve; });

class CrowdPeer {
  constructor(index, cluster) {
    this.index = index; this.cluster = cluster; this.position = normalize(cluster[0]);
    this.seq = 0; this.pending = new Map(); this.acks = 0; this.releaseAccepted = false;
    this.canSend = false; this.epoch = null;
    const url = new URL(ENDPOINT);
    url.searchParams.set('role', 'participant'); url.searchParams.set('scope', 'indonesia');
    url.searchParams.set('clientId', `national-preview-${runId}-${index}`);
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Phone ${index} could not join rehearsal.`)), 10000);
      this.socket.on('error', error => {
        errors.push({ index, message: error.message }); clearTimeout(timeout); reject(error);
      });
      this.socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (message.type === 'welcome') this.epoch = message.epoch;
        if (message.type === 'summary' && this.epoch && !message.bootstrapAvailable) {
          this.canSend = true; clearTimeout(timeout); resolve(this);
        }
        if (message.type === 'ack') {
          const pending = this.pending.get(message.seq);
          if (pending) {
            this.acks++; this.pending.delete(message.seq);
            if (pending.kind === 'release' && !message.holding) this.releaseAccepted = true;
          }
        }
        if (message.type === 'error') {
          if (errors.length < 100) errors.push({ index, message: message.message });
          // Ordered requests produce an ack or an error. Stop this synthetic
          // phone on rejection; never replay or restart an expired gesture.
          const oldest = this.pending.keys().next().value;
          if (oldest !== undefined) this.pending.delete(oldest);
          this.canSend = false;
        }
      });
      this.socket.on('close', () => {
        clearTimeout(timeout); this.canSend = false;
        // If a signal arrives while joining, reject the unsettled readiness
        // promise so the outer cleanup cannot hang waiting for a closed peer.
        reject(new Error(`Phone ${index} left rehearsal before readiness.`));
      });
    });
  }

  send(holding, kind) {
    if (!this.epoch || this.socket.readyState !== WebSocket.OPEN || (holding && !this.canSend)) return;
    const seq = this.seq++;
    this.pending.set(seq, { kind, at: performance.now() });
    this.socket.send(JSON.stringify({ type: 'hold', epoch: this.epoch, seq, start: kind === 'start',
      holding, space: 'country', position: this.position, path: [this.position] }));
  }
}

function normalize([, longitude, latitude]) {
  return [(longitude - COUNTRY_BOUNDS.west) / (COUNTRY_BOUNDS.east - COUNTRY_BOUNDS.west),
    (COUNTRY_BOUNDS.north - latitude) / (COUNTRY_BOUNDS.north - COUNTRY_BOUNDS.south)];
}
async function waitPending(timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (peers.some(peer => peer.pending.size) && performance.now() < deadline) await pause(25);
}

async function stop(reason) {
  if (stopping) return;
  stopping = true;
  clearInterval(movementTimer); clearTimeout(finishTimer);
  for (const peer of peers) peer.send(false, 'release');
  await waitPending(3000);
  for (const peer of peers) peer.socket.terminate();
  const report = {
    rehearsalOnly: true, target: ENDPOINT.href, reason, participantCount: peers.length,
    requestedDurationMs: DURATION_MS, elapsedMs: started === null ? null : Math.round(performance.now() - started),
    movementRounds: rounds, releaseAccepted: peers.filter(peer => peer.releaseAccepted).length,
    outstandingResponses: peers.reduce((sum, peer) => sum + peer.pending.size, 0), errors,
    note: 'Synthetic phones only. Every fixture socket is released then terminated; existing operator/phone connections and controls are untouched. No snapshots are fetched/refreshed and no saved state is read or written by this fixture. The rehearsal room itself is temporary.',
  };
  await writeFile(new URL('../output/coordination/national-preview-crowd.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ event: 'finished', ...report }));
  stopResolve();
}
process.once('SIGINT', () => stop('SIGINT').catch(error => { console.error(error); process.exitCode = 1; stopResolve(); }));
process.once('SIGTERM', () => stop('SIGTERM').catch(error => { console.error(error); process.exitCode = 1; stopResolve(); }));

try {
  console.log(JSON.stringify({ event: 'joining', rehearsalOnly: true, target: ENDPOINT.href, phones: COUNT, seconds: DURATION_MS / 1000 }));
  const snapshot = JSON.parse(await readFile(new URL('../data/fire-snapshot.json', import.meta.url), 'utf8'));
  const sources = new NationalSpace(new RegionCatalog(snapshot.records)).sourcePatches;
  if (!sources.length) throw new Error('The cached source snapshot has no source-containing land patches.');
  for (let index = 0; index < COUNT; index++) {
    const anchor = sources[Math.floor(index * sources.length / COUNT)];
    const cluster = sources.map(patch => ({ patch, distance: (patch[1] - anchor[1]) ** 2 + (patch[2] - anchor[2]) ** 2 }))
      .filter(item => item.distance <= 4).sort((a, b) => a.distance - b.distance).slice(0, 6).map(item => item.patch);
    peers.push(new CrowdPeer(index, cluster));
  }
  await Promise.all(peers.map(peer => peer.ready));
  for (const peer of peers) peer.send(true, 'start');
  await waitPending(5000);
  if (peers.some(peer => peer.pending.size) || errors.length) throw new Error('Some rehearsal start messages were not accepted.');
  started = performance.now();
  console.log(JSON.stringify({ event: 'ready', rehearsalOnly: true, target: ENDPOINT.href, phones: COUNT,
    holdsAccepted: peers.filter(peer => peer.acks > 0).length, durationSeconds: DURATION_MS / 1000,
    movementPattern: 'Cycle nearby actual source-containing land patches, geographically spread across Indonesia.' }));
  movementTimer = setInterval(() => {
    rounds++;
    for (const peer of peers) {
      peer.position = normalize(peer.cluster[rounds % peer.cluster.length]);
      peer.send(true, 'move');
    }
  }, 100);
  finishTimer = setTimeout(() => stop('deadline').catch(error => { console.error(error); process.exitCode = 1; stopResolve(); }), DURATION_MS);
  await stopped;
} catch (error) {
  errors.push({ message: error.message }); process.exitCode = 1;
  await stop('error');
} finally {
  if (!stopping) await stop('finished');
}
