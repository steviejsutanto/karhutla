import { DEFAULT_PARAMETERS, MOISTURE_UPTAKE_SECONDS } from './simulation.js';
import { FOREST_RAIN_STRENGTH_MULTIPLIER, DEFAULT_RAIN_STRENGTH } from './scene-score.js';

export const RAIN_REFILL_SECONDS = 12;
export const RAIN_SUPPLY_FACTOR = .67;
// Size the original wetting/cooling/settling allowance, then apply the
// requested 0.67 supply factor. Recharge timing is independent.
// A source centre inside the circular brush receives at least this fraction
// of its full-cell rate. Use Scene 4's weaker rain when sizing both scenes.
export function rainSupplyCapacity(parameters = DEFAULT_PARAMETERS, strength = DEFAULT_RAIN_STRENGTH) {
  const rate = .35 * Math.max(.01, strength) * FOREST_RAIN_STRENGTH_MULTIPLIER;
  const soak = MOISTURE_UPTAKE_SECONDS / rate;
  const seconds = soak + (parameters.deepCoolingSeconds ?? DEFAULT_PARAMETERS.deepCoolingSeconds) * Math.log(10)
    + (parameters.extinctionHoldSeconds ?? DEFAULT_PARAMETERS.extinctionHoldSeconds) + 8;
  return Math.max(45, Math.ceil(seconds / 5) * 5) * RAIN_SUPPLY_FACTOR;
}
export function createRainSupply(now = 0) {
  return { level: 1, updatedAt: now, touching: false, needsRelease: false };
}
export function advanceRainSupply(supply, now, capacitySeconds, pouring = false) {
  const seconds = Math.max(0, now - supply.updatedAt) / 1000;
  if (pouring) supply.level = Math.max(0, supply.level - seconds / capacitySeconds);
  else if (!supply.touching) supply.level = Math.min(1, supply.level + seconds / RAIN_REFILL_SECONDS);
  supply.updatedAt = Math.max(supply.updatedAt, now);
  if (pouring && supply.level <= 1e-9) { supply.level = 0; supply.needsRelease = true; }
  return supply;
}
export function rainSupplyState(supply, capacitySeconds) {
  return { level: Math.round(supply.level * 10000) / 10000, capacitySeconds, rechargeSeconds: RAIN_REFILL_SECONDS,
    touching: supply.touching, needsRelease: supply.needsRelease };
}
