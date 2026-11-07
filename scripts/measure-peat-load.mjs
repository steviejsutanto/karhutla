// Isolated loopback load study. Never changes a real save or refreshes sources.
// Usage: node scripts/measure-peat-load.mjs [output JSON path]
//        --counts 10,50,100,200 --phase-seconds 3 --output report.json
//        --national --counts 50 --phase-seconds 30 --output national-report.json
//        --national --sweep --counts 50 --phase-seconds 20 --output sweep-report.json
//        --national --cycle --counts 50 --phase-seconds 180 --output soak-report.json
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createPerformanceServer } from '../app/server.mjs';

const configuration = { counts: [10, 50, 100, 200], durationMs: 3000, output: null, national: false, sweep: false, cycle: false };
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  const [option, inline] = argument.split('=', 2);
  if (['--national', '--sweep', '--cycle'].includes(option) && inline === undefined) configuration[option.slice(2)] = true;
  else if (['--counts', '--phase-seconds', '--output'].includes(option)) {
    const value = inline ?? arguments_[++index];
    if (value === undefined) throw new Error(`Missing value for ${option}`);
    if (option === '--counts') configuration.counts = value.split(',').map(Number);
    else if (option === '--phase-seconds') configuration.durationMs = Number(value) * 1000;
    else configuration.output = value;
  } else if (!argument.startsWith('-') && !configuration.output) configuration.output = argument;
  else throw new Error(`Unknown argument: ${argument}`);
}
if (!configuration.counts.length || configuration.counts.some(count => !Number.isSafeInteger(count) || count < 1 || count > 254)) throw new Error('Counts must be integers from 1 through 254 (plus two displays).');
if (!Number.isFinite(configuration.durationMs) || configuration.durationMs < 1000 || configuration.durationMs > 900000) throw new Error('Phase seconds must be from 1 through 900.');
if (configuration.durationMs > 30000 && !configuration.cycle) throw new Error('Use --cycle for runs over 30 seconds so rainwater can recharge.');
if (configuration.sweep && !configuration.national) throw new Error('--sweep requires --national.');
const durationMs = configuration.durationMs;
const movementIntervalMs = 100;
const counts = configuration.counts;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
function statistics(values) {
  if (!values.length) return { count: 0, mean: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return { count: sorted.length, mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length), median: round(quantile(.5)), p95: round(quantile(.95)), max: round(sorted.at(-1)) };
}

class Peer {
  constructor(url, role, phase) {
    this.role = role;
    this.phase = phase;
    this.pending = new Map();
    this.sequence = 0;
    this.acknowledgments = [];
    this.rejections = [];
    this.initialBytes = 0;
    this.activeBytes = 0;
    this.activeMessages = {};
    this.errors = [];
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting ${role}`)), 15000);
      this.socket.on('error', error => { this.errors.push(error.message); clearTimeout(timer); reject(error); });
      this.socket.on('message', raw => {
        const now = performance.now();
        const message = JSON.parse(raw.toString());
        if (phase.measuring) {
          this.activeBytes += raw.length;
          this.activeMessages[message.type] = (this.activeMessages[message.type] || 0) + 1;
        } else this.initialBytes += raw.length;
        if (message.type === 'welcome') {
          this.welcome = message;
          clearTimeout(timer);
          resolve(this);
        } else if (message.type === 'ack') {
          const pending = this.pending.get(message.seq);
          if (pending) {
            this.acknowledgments.push({ kind: pending.kind, holding: message.holding, milliseconds: now - pending.at });
            this.pending.delete(message.seq);
          }
        } else if (message.type === 'error') {
          this.errors.push(message.message);
          // WebSocket messages preserve order: each hold produces either its
          // sequence-bearing ack or an error. The oldest still-pending request
          // is therefore the rejected one; errors intentionally have no seq.
          const sequence = this.pending.keys().next().value;
          const pending = this.pending.get(sequence);
          if (pending) {
            this.rejections.push({ seq: sequence, kind: pending.kind, milliseconds: now - pending.at, message: message.message });
            this.pending.delete(sequence);
          }
        }
      });
    });
  }

  hold(position, holding, kind) {
    if (this.socket.readyState !== WebSocket.OPEN) { this.errors.push(`Cannot send ${kind}: socket closed`); return; }
    const sequence = this.sequence++;
    this.pending.set(sequence, { at: performance.now(), kind });
    this.socket.send(JSON.stringify({ type: 'hold', epoch: this.welcome.epoch, seq: sequence, holding,
      start: kind === 'start', space: this.phase.national ? 'country' : 'region', position, path: [position] }));
  }
}

async function waitForAcknowledgments(peers, timeoutMs = 15000) {
  const deadline = performance.now() + timeoutMs;
  while (peers.some(peer => peer.pending.size) && performance.now() < deadline) await pause(20);
  return peers.reduce((sum, peer) => sum + peer.pending.size, 0);
}

async function measure(participantCount) {
  const phase = { measuring: false, national: configuration.national };
  const peers = [];
  const advance = { scheduled: [], control: [], other: [] };
  let insideControl = false;
  let driftTimer;
  let memoryTimer;
  const memoryStart = process.memoryUsage();
  let peakRss = memoryStart.rss;
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  const instance = await createPerformanceServer({ port: 0, persistencePath: null });
  const originalAdvance = instance.room.advance.bind(instance.room);
  instance.room.advance = (...args) => {
    const start = performance.now();
    try { return originalAdvance(...args); }
    finally {
      if (phase.measuring) advance[insideControl ? 'control' : args.length ? 'other' : 'scheduled'].push(performance.now() - start);
    }
  };
  const originalHold = instance.room.hold.bind(instance.room);
  instance.room.hold = (...args) => {
    insideControl = true;
    try { return originalHold(...args); } finally { insideControl = false; }
  };
  try {
    // Exercise the actual show gate: bootstrap alone leaves paused Arrival,
    // which rejects every hold and gives deceptively cheap load measurements.
    await instance.room.setScene({ scene: 'participation', settings: { participationSeconds: 3600 } });
    const address = await instance.listen();
    const base = `ws://127.0.0.1:${address.port}/ws`;
    const operator = new Peer(`${base}?role=operator&clientId=peat-load-${participantCount}-operator`, 'operator', phase);
    peers.push(operator);
    await operator.ready;
    const projection = new Peer(`${base}?role=projection&clientId=peat-load-${participantCount}-projection`, 'projection', phase);
    peers.push(projection);
    await projection.ready;
    for (let index = 0; index < participantCount; index++) {
      peers.push(new Peer(`${base}?role=participant&clientId=peat-load-${participantCount}-${index}${configuration.national ? '&scope=indonesia' : ''}`, 'participant', phase));
    }
    await Promise.all(peers.map(peer => peer.ready));
    await pause(250); // Exclude connection/layout assignment bursts from active samples.
    const audience = peers.filter(peer => peer.role === 'participant');
    const sourcePatches = instance.room.national.sourcePatches;
    if (configuration.national && !sourcePatches.length) throw new Error('National land-target load measurement requires source-containing land patches.');
    // A nationally normalized sine wave spends much of its time over sea and
    // would understate physics cost. Each national participant instead walks
    // actual source-containing land patches near its geographically spread
    // anchor. Points retain real sea gaps; the shared model handles any sea
    // crossed between nearby islands, with no destination teleporting.
    const countryBounds = instance.room.national.layout().bounds;
    const normalized = ([, longitude, latitude]) => [
      (longitude - countryBounds.west) / (countryBounds.east - countryBounds.west),
      (countryBounds.north - latitude) / (countryBounds.north - countryBounds.south),
    ];
    const sourceClusters = configuration.national ? audience.map((_, index) => {
      const anchor = sourcePatches[Math.floor(index * sourcePatches.length / participantCount)];
      const candidates = sourcePatches.map(patch => ({ patch, distance: (patch[1] - anchor[1]) ** 2 + (patch[2] - anchor[2]) ** 2 }))
        .filter(item => item.distance <= 4).sort((a, b) => a.distance - b.distance).slice(0, 6);
      return candidates.map(item => item.patch);
    }) : null;
    const positions = audience.map((_, index) => configuration.national ? normalized(sourceClusters[index][0]) : [.15 + (index % 9) * .075, .15 + (index % 7) * .09]);
    const movementDistances = [];
    const drift = [];
    let previousDriftTick = performance.now();
    driftTimer = setInterval(() => {
      const now = performance.now();
      drift.push(Math.max(0, now - previousDriftTick - 50));
      previousDriftTick = now;
    }, 50);
    loopDelay.enable();
    memoryTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
    phase.measuring = true;
    const started = performance.now();
    const cpuStarted = process.cpuUsage();
    audience.forEach((peer, index) => peer.hold(positions[index], true, 'start'));
    const startPending = await waitForAcknowledgments(audience);
    const initialHeld = [...instance.room.connections.values()].filter(peer => peer.holding).length;
    const movementStarted = performance.now();
    let movementRounds = 0;
    let activeMovementRounds = 0, rainActive = true, cycleReleases = 0;
    let skippedMovementRounds = 0;
    let nextMovement = movementStarted + movementIntervalMs;
    while (performance.now() < movementStarted + durationMs) {
      await pause(Math.max(0, nextMovement - performance.now()));
      const now = performance.now();
      if (now >= movementStarted + durationMs) break;
      // Coalesce late samples, as the actual client does; never replay a backlog.
      const missed = Math.max(0, Math.floor((now - nextMovement) / movementIntervalMs));
      skippedMovementRounds += missed;
      nextMovement += (missed + 1) * movementIntervalMs;
      movementRounds++;
      // Long runs alternate twenty seconds of active rain with twelve seconds
      // of rest. Without real releases a phone's exhausted supply stays empty.
      const shouldRain = !configuration.cycle || (now - movementStarted) % 32000 < 20000;
      if (!shouldRain) {
        if (rainActive) { audience.forEach((peer, index) => peer.hold(positions[index], false, 'release')); cycleReleases++; }
        rainActive = false;
        continue;
      }
      const kind = rainActive ? 'move' : 'start';
      rainActive = true;
      activeMovementRounds++;
      audience.forEach((peer, index) => {
        if (configuration.national) {
          const cluster = sourceClusters[index];
          const next = normalized(configuration.sweep
            ? sourcePatches[(index * 7 + movementRounds * Math.floor(sourcePatches.length / 2)) % sourcePatches.length]
            : cluster[movementRounds % cluster.length]);
          const deltaX = (next[0] - positions[index][0]) * (countryBounds.east - countryBounds.west);
          const deltaY = (next[1] - positions[index][1]) * (countryBounds.north - countryBounds.south);
          movementDistances.push(Math.hypot(deltaX, deltaY));
          positions[index] = next;
        } else {
          const angle = (now - movementStarted) / 1000 * 1.2 + index * .31;
          positions[index] = [.5 + .35 * Math.sin(angle), .5 + .35 * Math.cos(angle * .73)];
        }
        peer.hold(positions[index], true, kind);
      });
    }
    const movementElapsedMs = performance.now() - movementStarted;
    audience.forEach((peer, index) => peer.hold(positions[index], false, 'release'));
    const pending = await waitForAcknowledgments(audience);
    const finished = performance.now();
    const cpu = process.cpuUsage(cpuStarted);
    phase.measuring = false;
    loopDelay.disable();
    clearInterval(driftTimer);
    clearInterval(memoryTimer);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    const ack = audience.flatMap(peer => peer.acknowledgments);
    const elapsedMs = finished - started;
    const errors = peers.flatMap((peer, index) => peer.errors.map(message => ({ role: peer.role, peer: index, message })));
    const audienceBytes = audience.reduce((sum, peer) => sum + peer.activeBytes, 0);
    const result = {
      scope: configuration.national ? 'indonesia' : 'region',
      movementPattern: configuration.sweep ? 'Alternate far-apart source-containing land patches across the country at 10 Hz; intentional stress case.' : configuration.national ? 'Geographically spread source-patch anchors; cycle through up to six nearest source-containing land patches within two degrees of each anchor.' : 'Legacy assigned-island normalized sine/cosine path.',
      ...(configuration.national ? { nationalTargets: { sourcePatches: sourcePatches.length, anchorCount: new Set(sourceClusters.map(cluster => cluster[0][0])).size,
        ...(configuration.sweep ? {} : { maximumAnchorRadiusDegrees: 2, clusterSizes: statistics(sourceClusters.map(cluster => cluster.length)) }), movementDistanceDegrees: statistics(movementDistances) } } : {}),
      participantCount, operatorCount: 1, projectionCount: 1, observedServerConnections: instance.room.connections.size,
      sceneAtEnd: instance.room.scenes.id, strength: instance.room.strength, totalWaterAtEnd: instance.room.simulation.totalWater,
      initialHeld, activeMovementRounds, cycleReleases,
      memory: { startRss: memoryStart.rss, peakRss, end: process.memoryUsage() },
      snapshotRecords: instance.room.records.length, modelCellsAtEnd: instance.room.simulation.cells.size,
      durationMs: round(elapsedMs), movementWindowMs: round(movementElapsedMs),
      intendedMovementHzPerPhone: 10, movementRounds, skippedMovementRounds,
      realizedMovementHzPerPhone: round(activeMovementRounds * 1000 / movementElapsedMs),
      acknowledgments: {
        allMs: statistics(ack.map(sample => sample.milliseconds)),
        startMs: statistics(ack.filter(sample => sample.kind === 'start').map(sample => sample.milliseconds)),
        movementMs: statistics(ack.filter(sample => sample.kind === 'move').map(sample => sample.milliseconds)),
        releaseMs: statistics(ack.filter(sample => sample.kind === 'release').map(sample => sample.milliseconds)),
        pendingAfterStart: startPending, pendingAfterRelease: pending,
      },
      rejectedControls: {
        count: audience.reduce((sum, peer) => sum + peer.rejections.length, 0),
        responseMs: statistics(audience.flatMap(peer => peer.rejections.map(sample => sample.milliseconds))),
      },
      advanceComputeMs: Object.fromEntries(Object.entries(advance).map(([kind, values]) => [kind, statistics(values)])),
      timerDrift50Ms: statistics(drift),
      eventLoopDelayMs: { mean: round(loopDelay.mean / 1e6), p95: round(loopDelay.percentile(95) / 1e6), max: round(loopDelay.max / 1e6) },
      combinedServerAndClientsCpuMs: { user: round(cpu.user / 1000), system: round(cpu.system / 1000), total: round((cpu.user + cpu.system) / 1000) },
      incomingPayload: {
        allAudienceBytes: audienceBytes,
        audienceBytesPerSecond: round(audienceBytes * 1000 / elapsedMs),
        meanPerPhoneBytesPerSecond: round(audienceBytes * 1000 / elapsedMs / participantCount),
        operatorBytes: operator.activeBytes,
        operatorBytesPerSecond: round(operator.activeBytes * 1000 / elapsedMs),
        operatorMessageCounts: operator.activeMessages,
        operatorStateHz: round((operator.activeMessages.state || 0) * 1000 / elapsedMs),
        projectionBytesPerSecond: round(projection.activeBytes * 1000 / elapsedMs),
        projectionStateHz: round((projection.activeMessages.state || 0) * 1000 / elapsedMs),
        audienceMessageCounts: audience.reduce((counts, peer) => {
          for (const [type, count] of Object.entries(peer.activeMessages)) counts[type] = (counts[type] || 0) + count;
          return counts;
        }, {}),
      },
      heldAtEnd: [...instance.room.connections.values()].filter(peer => peer.holding).length,
      errors,
    };
    result.valid = initialHeld === participantCount && !errors.length && pending === 0 && startPending === 0
      && result.totalWaterAtEnd > 0 && result.heldAtEnd === 0
      && result.observedServerConnections === participantCount + 2
      && operator.activeMessages.state > 0 && projection.activeMessages.state > 0
      && ack.filter(sample => sample.kind !== 'release').every(sample => sample.holding === true);
    if (!result.valid) process.exitCode = 1;
    console.log(JSON.stringify({ phase: participantCount, scope: result.scope, movementHz: result.realizedMovementHzPerPhone,
      ackP95Ms: result.acknowledgments.allMs.p95, releaseP95Ms: result.acknowledgments.releaseMs.p95,
      scheduledAdvanceP95Ms: result.advanceComputeMs.scheduled.p95,
      controlAdvanceP95Ms: result.advanceComputeMs.control.p95, loopDelayP95Ms: result.eventLoopDelayMs.p95,
      pending, errors: errors.length, heldAtEnd: result.heldAtEnd, valid: result.valid }));
    return result;
  } finally {
    phase.measuring = false;
    clearInterval(driftTimer);
    clearInterval(memoryTimer);
    loopDelay.disable();
    for (const peer of peers) peer.socket.terminate();
    await instance.close();
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  configuration: { counts, phaseSeconds: durationMs / 1000, intendedMovementHzPerPhone: 10, scope: configuration.national ? 'indonesia' : 'region', sweep: configuration.sweep, cycle: configuration.cycle },
  machine: { platform: process.platform, architecture: process.arch, cpuModel: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, node: process.version },
  method: `One isolated createPerformanceServer({port:0,persistencePath:null}) per phase, current saved source snapshot, explicit Participation cue, one operator and one projection WebSocket, unique audience WebSockets. ${configuration.sweep ? 'National scope with far-apart source-patch sweeping as an intentional stress case.' : configuration.national ? 'National scope: all phones receive the shared sparse whole-country heat field. Touch positions cycle through actual source-containing land patches within two degrees of geographically distributed source anchors; each cluster uses up to six nearest source patches.' : 'Legacy regional scope: each phone uses the original assigned-island sine/cosine path.'} Audience sockets move at an intended 10 Hz while holding during a ${durationMs / 1000} s window, coalescing overdue movement batches, then release. ${configuration.cycle ? 'Each cycle holds for 20 seconds and rests for 12 seconds to recharge water.' : 'One continuous hold.'} JSON acknowledgment timings run from local client send to client message callback. Server and synthetic clients share one Node process and event loop; measurements include that client overhead. No production listener/save/source is changed.`,
  limitations: ['Loopback TCP only: no venue router, Wi-Fi contention, phone CPU, browser rendering, projector, or device-to-photon latency is measured.', 'Short synthetic phases do not establish sustained thermal stability or a supported audience capacity.', 'Payload bytes exclude TCP/WebSocket framing overhead and startup downloads.', 'room.advance is called for control packets as well as scheduled ticks; categories measure both separately. Timings are observations, never pass/fail speed assertions.', 'Successful-ack latency excludes rejected controls, which are reported separately. A phase with hold-expiry errors does not establish responsive participation or valid 10 Hz input capacity.'],
  phases: [],
};
try {
  for (const count of counts) report.phases.push(await measure(count));
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  const destination = configuration.output ? path.resolve(configuration.output) : new URL('../output/coordination/peat-load.json', import.meta.url);
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
}
