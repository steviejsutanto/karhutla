// Deterministic, non-persisting model/control-path rehearsal. Never opens a port.
// node scripts/measure-suppression.mjs [model module, relative to workspace]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SharedRoom } from '../shared-room.mjs';
import { RegionCatalog } from '../regions.mjs';

const { RainSimulation, DEFAULT_PARAMETERS, PARAMETER_LIMITS, CELL_SIZE, BRUSH_RADIUS } = await import(pathToFileURL(path.resolve(process.argv[2] || 'simulation.js')));
const minimum = Object.fromEntries(Object.entries(PARAMETER_LIMITS).map(([key, value]) => [key, value.min]));
const catalog = new RegionCatalog();
const fixtures = [{ name: 'operator-interior', position: [110.125, -2.125] }, ...[...catalog.regions.values()].map(region => ({ name: region.id, position: catalog.map(region.id, [.5, .5]), constraint: region.constraint }))];
const halfWetness = (1 - .44) / .95;
const budget = Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2;
const round = value => value === null ? null : Math.round(value * 1e4) / 1e4;

function thresholds(state, seconds, results) {
  // Renderer half-height activity includes both wetness and residual heat.
  if (results.visibleFlameHalfSeconds === null && state.heat * (1 - .95 * state.surfaceWetness) <= .44) results.visibleFlameHalfSeconds = seconds;
  if (results.surfaceHalfSeconds === null && state.surfaceWetness >= halfWetness) results.surfaceHalfSeconds = seconds;
  if (results.moistureReadySeconds === null && state.moisture >= .8) results.moistureReadySeconds = seconds;
  if (results.deepCoolSeconds === null && state.heat <= .15) results.deepCoolSeconds = seconds;
  if (results.outSeconds === null && state.extinguished) results.outSeconds = seconds;
}
const emptyResult = () => ({ visibleFlameHalfSeconds: null, surfaceHalfSeconds: null, moistureReadySeconds: null, deepCoolSeconds: null, outSeconds: null });

function measureModel(fixture, parameters, strength) {
  const simulation = new RainSimulation(parameters).seed([{ longitude: fixture.position[0], latitude: fixture.position[1] }]);
  const stroke = { path: [fixture.position], strength, constraint: fixture.constraint };
  const result = emptyResult();
  for (let i = 1; i <= 12000 && result.outSeconds === null; i++) {
    simulation.step(.05, [stroke]);
    thresholds(simulation.sample(...fixture.position), i * .05, result);
  }
  return { ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)])), waterAtOutOrTimeout: round(simulation.totalWater), expectedWater: round(budget * strength * (result.outSeconds ?? 600)) };
}

async function measureRoom(fixture, parameters, strength, renewEvery = 500) {
  const record = { longitude: fixture.position[0], latitude: fixture.position[1] };
  let now = 0;
  const room = new SharedRoom({ records: [record], persistencePath: null, clock: () => now });
  await room.bootstrap({ state: null, strength });
  room.simulation = new RainSimulation(parameters).seed([record]);
  const welcome = room.connect({ clientId: 'measurement', role: fixture.constraint ? 'participant' : 'operator' });
  const screen = fixture.constraint ? [.5, .5] : fixture.position;
  // Seeding the central source does not add a land cell and therefore leaves
  // the normalized row mapping identical to the catalog fixture.
  const actualPosition = fixture.constraint ? room.regions.map(welcome.assignment.id, screen) : screen;
  if (actualPosition.some((value, index) => value !== fixture.position[index])) throw new Error('Fixture assignment changed');
  let seq = 0;
  const hold = start => room.hold(welcome.connectionId, { type: 'hold', epoch: room.epoch, seq: seq++, holding: true, start, position: screen, ...(fixture.constraint ? { space: 'region' } : {}) });
  hold(true);
  const result = emptyResult();
  for (let i = 1; i <= 12000 && result.outSeconds === null; i++) {
    now = i * 50;
    if (now % renewEvery === 0) hold(false);
    room.advance();
    thresholds(room.simulation.sample(...fixture.position), now / 1000, result);
  }
  return { ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value)])), waterAtOutOrTimeout: round(room.simulation.totalWater), actorRevision: room.actorRevision };
}

const timings = [];
for (const [setting, parameters, strength] of [['default', DEFAULT_PARAMETERS, .5], ['minimum', minimum, .5], ['all-sliders-minimum', minimum, .1]]) {
  for (const fixture of fixtures) {
    timings.push({ setting, strength, footprint: fixture.name, position: fixture.position, model: measureModel(fixture, parameters, strength), room: await measureRoom(fixture, parameters, strength) });
  }
}

const snapshot = JSON.parse(await readFile(new URL('../data/fire-snapshot.json', import.meta.url), 'utf8'));
const envelope = JSON.parse(await readFile(new URL('../data/performance-state.json', import.meta.url), 'utf8'));
const cpu = [];
const modelCpu = [];
const quantile = (values, p) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
for (const participantCount of [1, 8]) {
  const samples = [];
  let now = 0, sequence = 0;
  const room = new SharedRoom({ records: snapshot.records, persistencePath: null, clock: () => now });
  await room.bootstrap({ state: null });
  room.simulation = new RainSimulation();
  if (!room.simulation.restore(envelope.simulation)) throw new Error('Real save rejected by measured model');
  const initialWater = room.simulation.totalWater;
  const welcomes = Array.from({ length: participantCount }, (_, i) => room.connect({ clientId: `bench-${i}` }));
  const modelOnly = new RainSimulation();
  if (!modelOnly.restore(envelope.simulation)) throw new Error('Real save rejected by measured model');
  const modelSamples = [];
  const modelStrokes = welcomes.map(welcome => ({ path: [room.regions.map(welcome.assignment.id, [.5, .5])], strength: .5, constraint: room.regions.regions.get(welcome.assignment.id).constraint }));
  for (let i = 1; i <= 200; i++) {
    const start = performance.now();
    modelOnly.step(.05, modelStrokes);
    modelSamples.push(performance.now() - start);
  }
  modelCpu.push({ participantCount, ticks: modelSamples.length, simulatedSeconds: 10, cells: modelOnly.cells.size, meanTickMs: round(modelSamples.reduce((a, b) => a + b, 0) / modelSamples.length), p95TickMs: round(quantile(modelSamples, .95)), maxTickMs: round(Math.max(...modelSamples)), waterAdded: round(modelOnly.totalWater - initialWater), expectedWater: round(budget * .5 * 10 * participantCount) });
  const renew = start => { for (const welcome of welcomes) room.hold(welcome.connectionId, { type: 'hold', epoch: room.epoch, seq: sequence, holding: true, start, space: 'region', position: [.5, .5] }); sequence++; };
  renew(true);
  for (let i = 1; i <= 200; i++) {
    now = i * 50;
    const start = performance.now();
    if (i % 10 === 0) renew(false);
    room.advance();
    samples.push(performance.now() - start);
  }
  cpu.push({ participantCount, ticks: samples.length, simulatedSeconds: 10, cells: room.simulation.cells.size, meanTickMs: round(samples.reduce((a, b) => a + b, 0) / samples.length), p95TickMs: round(quantile(samples, .95)), maxTickMs: round(Math.max(...samples)), waterAdded: round(room.simulation.totalWater - initialWater), expectedWater: round(budget * .5 * 10 * participantCount) });
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), model: process.argv[2] || 'simulation.js', parameters: { default: DEFAULT_PARAMETERS, minimum }, timeResolutionSeconds: .05, timeoutSeconds: 600, timingDefinition: 'Dry/hot central fire cell under stationary50% or10% rain; actual threshold crossings sampled every50ms. Null means threshold not reached within600s. Room renews every500ms. All clocks synthetic; CPU timings use real wall time. No network latency is measured.', timings, modelCpu, cpu }, null, 2));
