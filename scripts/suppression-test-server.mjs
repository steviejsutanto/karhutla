// Isolated browser fixture. No real save or source file is modified.
import { createPerformanceServer } from '../app/server.mjs';
import { RegionCatalog } from '../app/regions.mjs';
import { PARAMETER_LIMITS } from '../app/simulation.js';
const position = new RegionCatalog().map('kalimantan', [.5, .5]);
const instance = await createPerformanceServer({ port: 4183, persistencePath: null, records: [{ longitude: position[0], latitude: position[1] }], snapshotVersion: 'isolated-suppression-fixture' });
await instance.room.bootstrap({ state: null, strength: process.argv.includes('--weak') ? .1 : .5 });
if (process.argv.includes('--minimum')) await instance.room.setParameters(Object.fromEntries(Object.entries(PARAMETER_LIMITS).map(([key, value]) => [key, value.min])));
await instance.listen();
console.log(JSON.stringify({ ready: true, port: 4183, persistence: false, position, strength: instance.room.strength, parameters: instance.room.simulation.parameters }));
let firstHeld = null, reported = false;
const timer = setInterval(() => {
  const actors = [...instance.room.connections.values()];
  if (firstHeld === null && actors.some(actor => actor.holding)) firstHeld = performance.now();
  const cell = instance.room.simulation.sample(...position);
  if (!reported && cell.extinguished) {
    reported = true;
    console.log(JSON.stringify({ event: 'out', realSecondsFromFirstObservedHold: (performance.now() - firstHeld) / 1000, totalWater: instance.room.simulation.totalWater, cell, participants: actors.map(actor => ({ role: actor.role, regionId: actor.regionId, holding: actor.holding })) }));
  }
}, 25);
const close = async () => { clearInterval(timer); await instance.close(); process.exit(0); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
