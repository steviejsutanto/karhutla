export const CELL_SIZE = 0.25;
export const BRUSH_RADIUS = 0.85;
export const DEFAULT_PARAMETERS = Object.freeze({
  fireReturnSeconds: 4,
  rainResponseSeconds: 1.5,
  deepCoolingSeconds: 10,
  extinctionHoldSeconds: 4,
});
export const PARAMETER_LIMITS = Object.freeze({
  fireReturnSeconds: Object.freeze({ min: 3, max: 90, step: 1 }),
  rainResponseSeconds: Object.freeze({ min: 0.5, max: 20, step: 0.5 }),
  deepCoolingSeconds: Object.freeze({ min: 2, max: 240, step: 1 }),
  extinctionHoldSeconds: Object.freeze({ min: 0, max: 60, step: 1 }),
});

const BOUNDS = { west: 94, east: 142, south: -12, north: 7 };
const REFERENCE_CELLS = Math.PI * (BRUSH_RADIUS / CELL_SIZE) ** 2;
const MAX_STEP = 0.1;
// Artistic response per unit of the unchanged water budget, not peat physics.
// Fast uptake and slow release are separate: a held brush soaks the ground in
// seconds while remembered geographic moisture still decays over minutes.
// Unfinished fires recover when rain leaves; retained moisture records prior
// attention but cannot finish extinguishing an unattended patch.
export const MOISTURE_UPTAKE_SECONDS = 1.2;
export const MOISTURE_RETENTION_SECONDS = 180;
const OUT_MOISTURE = 0.8;
const OUT_HEAT = 0.15;
// A restored source re-enters the actual fire field only after returning heat
// is nonzero at the precision used by downstream state and sound consumers.
export const FOREST_RETURN_HEAT_EPSILON = 0.0001;
// Scene four keeps supplying heat beneath the audience's ordinary rain. A
// confirmed extinction is real and stays out briefly before another gradual
// return; the low ongoing pressure remains below the wet extinction threshold.
export const FOREST_OUT_REST_SECONDS = 3;
const FOREST_RETURN_PULSE_SECONDS = 4;
const LEGACY_PARAMETER_LIMITS = { ...PARAMETER_LIMITS, rainResponseSeconds: { min: 1, max: 20 }, deepCoolingSeconds: { min: 15, max: 240 } };
// The wetting calibration retains the earlier half-suppression response.
// Return is calibrated to the current surface activity curve (1 - W)^2.2.
const HALF_FLAME_WETNESS = (1 - 0.44) / 0.95;
const DRY_RESPONSE_SCALE = -Math.log(1 - 0.5 ** (1 / 2.2));
const WET_RESPONSE_SCALE = -Math.log(1 - HALF_FLAME_WETNESS / 2.5);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp01 = value => Math.max(0, Math.min(1, value));
const inBounds = (longitude, latitude) => longitude >= BOUNDS.west && longitude < BOUNDS.east && latitude >= BOUNDS.south && latitude < BOUNDS.north;
const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(finite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const keyFor = (longitude, latitude) => `${Math.floor(longitude / CELL_SIZE)},${Math.floor(latitude / CELL_SIZE)}`;

function validParameters(parameters, requireComplete = false, limits = PARAMETER_LIMITS) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;
  const prototype = Object.getPrototypeOf(parameters);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const names = Reflect.ownKeys(parameters);
  if (requireComplete && names.length !== Object.keys(DEFAULT_PARAMETERS).length) return false;
  return names.every(name => {
    if (!Object.hasOwn(limits, name)) return false;
    const { min, max } = limits[name];
    return finite(parameters[name]) && parameters[name] >= min && parameters[name] <= max;
  });
}

function blankCell(longitude, latitude) {
  return {
    longitude: (Math.floor(longitude / CELL_SIZE) + 0.5) * CELL_SIZE,
    latitude: (Math.floor(latitude / CELL_SIZE) + 0.5) * CELL_SIZE,
    surfaceWetness: 0, moisture: 0, heat: 0,
    extinguished: false, settledFor: 0, hasFire: false,
  };
}

// Area of a circle inside the rectangle between the origin and (x, y).
// Signed quadrants let inclusion/exclusion give exact circle/cell overlap.
function circlePrimitive(x, y) {
  const sign = Math.sign(x) * Math.sign(y);
  const a = Math.min(Math.abs(x), BRUSH_RADIUS);
  const b = Math.min(Math.abs(y), BRUSH_RADIUS);
  const crossing = Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - b ** 2));
  if (a <= crossing) return sign * a * b;
  const integral = value => 0.5 * (value * Math.sqrt(Math.max(0, BRUSH_RADIUS ** 2 - value ** 2)) + BRUSH_RADIUS ** 2 * Math.asin(value / BRUSH_RADIUS));
  return sign * (crossing * b + integral(a) - integral(crossing));
}

function footprint(longitude, latitude) {
  const weights = [];
  let sum = 0;
  const firstX = Math.floor((longitude - BRUSH_RADIUS) / CELL_SIZE);
  const lastX = Math.floor((longitude + BRUSH_RADIUS) / CELL_SIZE);
  const firstY = Math.floor((latitude - BRUSH_RADIUS) / CELL_SIZE);
  const lastY = Math.floor((latitude + BRUSH_RADIUS) / CELL_SIZE);
  for (let x = firstX; x <= lastX; x += 1) {
    for (let y = firstY; y <= lastY; y += 1) {
      const x0 = x * CELL_SIZE - longitude, x1 = x0 + CELL_SIZE;
      const y0 = y * CELL_SIZE - latitude, y1 = y0 + CELL_SIZE;
      const area = Math.max(0, circlePrimitive(x1, y1) - circlePrimitive(x0, y1) - circlePrimitive(x1, y0) + circlePrimitive(x0, y0));
      if (area < 1e-12) continue;
      const weight = area / CELL_SIZE ** 2;
      weights.push({ longitude: (x + 0.5) * CELL_SIZE, latitude: (y + 0.5) * CELL_SIZE, weight });
      sum += weight;
    }
  }
  // Normalize before clipping to the simulation boundary: water outside it is
  // lost, rather than being concentrated into the remaining coastal cells.
  return weights.filter(cell => inBounds(cell.longitude, cell.latitude)).map(cell => ({ ...cell, weight: cell.weight * REFERENCE_CELLS / sum }));
}

function prepareStroke(stroke) {
  if (!stroke || !finite(stroke.strength) || stroke.strength <= 0) return null;
  const points = stroke.path === undefined ? [stroke.from, stroke.to] : stroke.path;
  if (!Array.isArray(points) || !points.length || !points.every(validPoint)) return null;
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  }
  return { points, distances, length: distances.at(-1), strength: clamp01(stroke.strength), constraint: stroke.constraint };
}

function positionAt(stroke, fraction) {
  if (!stroke.length) return stroke.points[0];
  const target = fraction * stroke.length;
  let index = 1;
  while (index < stroke.distances.length - 1 && stroke.distances[index] < target) index += 1;
  const span = stroke.distances[index] - stroke.distances[index - 1];
  const mix = span ? (target - stroke.distances[index - 1]) / span : 0;
  return [0, 1].map(axis => stroke.points[index - 1][axis] + (stroke.points[index][axis] - stroke.points[index - 1][axis]) * mix);
}

function evolveMoisture(initial, rate, seconds) {
  const equilibrium = MOISTURE_RETENTION_SECONDS / MOISTURE_UPTAKE_SECONDS * rate;
  if (!rate) return {
    moisture: initial * Math.exp(-seconds / MOISTURE_RETENTION_SECONDS),
    squaredIntegral: initial ** 2 * (MOISTURE_RETENTION_SECONDS / 2) * -Math.expm1(-2 * seconds / MOISTURE_RETENTION_SECONDS),
  };
  let movingSeconds = seconds;
  if (equilibrium > 1) {
    const saturationTime = initial >= 1 ? 0 : -MOISTURE_RETENTION_SECONDS * Math.log((equilibrium - 1) / (equilibrium - initial));
    movingSeconds = Math.min(seconds, saturationTime);
  }
  const at = time => initial + (equilibrium - initial) * -Math.expm1(-time / MOISTURE_RETENTION_SECONDS);
  // Three-point Gaussian integration of M² is stable for tiny timesteps and
  // effectively exact at our <= 0.1 s integration step.
  const offset = Math.sqrt(15) / 10;
  const integral = movingSeconds * (
    5 / 18 * at(movingSeconds * (0.5 - offset)) ** 2 +
    8 / 18 * at(movingSeconds * 0.5) ** 2 +
    5 / 18 * at(movingSeconds * (0.5 + offset)) ** 2
  ) + seconds - movingSeconds;
  return { moisture: clamp01(at(seconds)), squaredIntegral: Math.max(0, integral) };
}

function advanceCell(cell, rate, seconds, wettingSeconds, dryingSeconds, deepCoolingSeconds, extinctionHoldSeconds, fireReturnSeconds) {
  const initialMoisture = cell.moisture;
  const surfaceTarget = 5 * rate;
  // Light rain must never dry a patch faster than no rain.
  const response = surfaceTarget >= cell.surfaceWetness ? wettingSeconds : dryingSeconds;
  cell.surfaceWetness = clamp01(surfaceTarget + (cell.surfaceWetness - surfaceTarget) * Math.exp(-seconds / response));
  const moisture = evolveMoisture(initialMoisture, rate, seconds);
  cell.moisture = moisture.moisture;
  if (!cell.hasFire || cell.extinguished) return;
  if (!rate) {
    // Exact recovery over elapsed time, including a long hidden/offline gap.
    // This remains authoritative: renderers do not invent returning heat.
    cell.heat = 1 - (1 - cell.heat) * Math.exp(-Math.LN2 * seconds / fireReturnSeconds);
    cell.settledFor = 0;
    return;
  }
  const initialHeat = cell.heat;
  cell.heat *= Math.exp(-moisture.squaredIntegral / deepCoolingSeconds);
  const startsWet = initialMoisture >= OUT_MOISTURE, endsWet = cell.moisture >= OUT_MOISTURE;
  if (!startsWet && !endsWet) { cell.settledFor = 0; return; }
  const equilibrium = MOISTURE_RETENTION_SECONDS / MOISTURE_UPTAKE_SECONDS * rate;
  const moistureCrossing = startsWet === endsWet ? 0 : -MOISTURE_RETENTION_SECONDS * Math.log((OUT_MOISTURE - equilibrium) / (initialMoisture - equilibrium));
  const wetFrom = startsWet ? 0 : moistureCrossing;
  const wetUntil = endsWet ? seconds : moistureCrossing;
  let coolFrom = 0;
  if (initialHeat > OUT_HEAT) {
    if (cell.heat > OUT_HEAT) { cell.settledFor = 0; return; }
    const requiredIntegral = deepCoolingSeconds * Math.log(initialHeat / OUT_HEAT);
    // Only the one interval crossing the heat threshold needs this search.
    // Fractional eligibility keeps settlement independent of frame/event rate.
    let lower = 0, upper = seconds;
    for (let i = 0; i < 35; i++) {
      const midpoint = (lower + upper) / 2;
      if (evolveMoisture(initialMoisture, rate, midpoint).squaredIntegral < requiredIntegral) lower = midpoint;
      else upper = midpoint;
    }
    coolFrom = (lower + upper) / 2;
  }
  const eligibleFrom = Math.max(wetFrom, coolFrom);
  const eligibleUntil = Math.min(seconds, wetUntil);
  const hasEligibleTime = eligibleFrom <= eligibleUntil;
  const settledFor = (startsWet && initialHeat <= OUT_HEAT ? cell.settledFor : 0) + Math.max(0, eligibleUntil - eligibleFrom);
  // A zero hold still needs a wet, cool instant; a tap cannot mark hot ground out.
  if (hasEligibleTime && settledFor >= extinctionHoldSeconds - 1e-9) {
    cell.extinguished = true;
    cell.heat = 0;
    cell.settledFor = extinctionHoldSeconds;
  } else cell.settledFor = hasEligibleTime && endsWet ? settledFor : 0;
}

function advanceForestHeat(cell, source, seconds, deepCoolingSeconds) {
  if (cell.extinguished && source.phase === 'waiting') {
    const rest = Math.min(seconds, Math.max(0, FOREST_OUT_REST_SECONDS - source.elapsed));
    source.elapsed += rest;
    seconds -= rest;
    if (source.elapsed < FOREST_OUT_REST_SECONDS - 1e-9) return;
    source.phase = 'returning'; source.elapsed = 0; source.pendingHeat = 0;
  }
  if (seconds <= 0) return;
  let returningSeconds = 0;
  if (source.phase === 'returning') {
    returningSeconds = Math.min(seconds, Math.max(0, FOREST_RETURN_PULSE_SECONDS - source.elapsed));
    source.elapsed += returningSeconds;
    if (source.elapsed >= FOREST_RETURN_PULSE_SECONDS - 1e-9) source.phase = 'burning';
  }
  const pressure = returningSeconds * .55 / Math.min(4, deepCoolingSeconds)
    + (seconds - returningSeconds) * .05 / deepCoolingSeconds;
  const previousHeat = cell.extinguished ? source.pendingHeat || 0 : cell.heat;
  const heat = 1 - (1 - previousHeat) * Math.exp(-pressure);
  if (cell.extinguished && heat <= FOREST_RETURN_HEAT_EPSILON) { source.pendingHeat = heat; return; }
  if (cell.extinguished) { cell.extinguished = false; cell.settledFor = 0; }
  cell.heat = heat;
}

function migrateLegacyParameters(parameters) {
  // Recognize the old supplied defaults and fast endpoints exactly. Bespoke
  // numeric choices keep their values, including intentionally slow settings.
  const migrated = { ...parameters };
  if (migrated.fireReturnSeconds === 25) migrated.fireReturnSeconds = DEFAULT_PARAMETERS.fireReturnSeconds;
  if (migrated.rainResponseSeconds === 4) migrated.rainResponseSeconds = DEFAULT_PARAMETERS.rainResponseSeconds;
  else if (migrated.rainResponseSeconds === 1) migrated.rainResponseSeconds = PARAMETER_LIMITS.rainResponseSeconds.min;
  if (migrated.deepCoolingSeconds === 90) migrated.deepCoolingSeconds = DEFAULT_PARAMETERS.deepCoolingSeconds;
  else if (migrated.deepCoolingSeconds === 15) migrated.deepCoolingSeconds = PARAMETER_LIMITS.deepCoolingSeconds.min;
  if (migrated.extinctionHoldSeconds === 20) migrated.extinctionHoldSeconds = DEFAULT_PARAMETERS.extinctionHoldSeconds;
  return migrated;
}

export class RainSimulation {
  constructor(parameters = {}) {
    this.parameters = { ...DEFAULT_PARAMETERS };
    this.setParameters(parameters);
    this.cells = new Map();
    this.totalWater = 0;
    this.sourceRecords = [];
    this.forestRestoration = null;
    this.finalRainCooling = null;
  }

  setParameters(patch) {
    if (!validParameters(patch)) return false;
    this.parameters = { ...this.parameters, ...patch };
    return true;
  }

  seed(records) {
    this.sourceRecords = (Array.isArray(records) ? records : []).filter(record => record && finite(record.longitude) && finite(record.latitude) && inBounds(record.longitude, record.latitude)).map(({ longitude, latitude }) => ({ longitude, latitude }));
    for (const record of this.sourceRecords) {
      const cell = this._cell(record.longitude, record.latitude);
      if (!cell.hasFire) {
        cell.hasFire = true;
        cell.heat = 1;
      }
    }
    return this;
  }

  _cell(longitude, latitude) {
    const key = keyFor(longitude, latitude);
    if (!this.cells.has(key)) this.cells.set(key, blankCell(longitude, latitude));
    return this.cells.get(key);
  }

  step(dtSeconds, strokes = [], { globalRainKeys = null, globalRainStrength = 0 } = {}) {
    if (!finite(dtSeconds) || dtSeconds <= 0) return this;
    const prepared = (Array.isArray(strokes) ? strokes : []).map(prepareStroke).filter(Boolean);
    // Finale rain has one uniform rate per current source cell. It enters the
    // same moisture/cooling/settlement physics without creating a brush and
    // scanning the entire landscape once for every individual fire.
    // The server may supply a substep-average rate to integrate an evolving
    // scene envelope. Numeric rates retain their existing uniform behavior.
    const rainProfile = typeof globalRainStrength === 'function' ? globalRainStrength : null;
    const rainKeys = globalRainKeys instanceof Set && (rainProfile || finite(globalRainStrength) && globalRainStrength > 0)
      ? [...globalRainKeys].filter(key => this.cells.get(key)?.hasFire) : [];
    const uniformRate = finite(globalRainStrength) ? clamp01(globalRainStrength) : 0;
    if (!prepared.length && !rainKeys.length && !this.forestRestoration) return this.advanceDry(dtSeconds);
    const divisions = Math.max(1, Math.ceil(dtSeconds / MAX_STEP), ...prepared.map(stroke => Math.min(stroke.constraint ? 64 : Infinity, Math.ceil(stroke.length / (BRUSH_RADIUS / 3)))));
    const seconds = dtSeconds / divisions;
    const surfaceWettingSeconds = this.parameters.rainResponseSeconds / WET_RESPONSE_SCALE;
    const surfaceDryingSeconds = this.parameters.fireReturnSeconds / DRY_RESPONSE_SCALE;
    const { deepCoolingSeconds, extinctionHoldSeconds } = this.parameters;
    for (let division = 0; division < divisions; division += 1) {
      const sampledRate = rainProfile ? rainProfile(division * seconds, (division + 1) * seconds) : uniformRate;
      const globalRate = finite(sampledRate) ? clamp01(sampledRate) : 0;
      const rates = new Map();
      for (const key of rainKeys) rates.set(key, globalRate);
      this.totalWater += rainKeys.length * globalRate * seconds;
      for (const stroke of prepared) {
        let position = positionAt(stroke, (division + 0.5) / divisions);
        // Constraints are server-created functions, never client payloads.
        // Project swept segments too: endpoints on different island branches
        // must not pour through another region or through the intervening sea.
        if (stroke.constraint) position = stroke.constraint.project(position);
        let covered = footprint(...position);
        if (stroke.constraint) {
          covered = covered.filter(cell => stroke.constraint.allows(cell.longitude, cell.latitude));
          const weight = covered.reduce((sum, cell) => sum + cell.weight, 0);
          // Clipping redistributes the one fixed budget; it never creates a
          // second budget, and sweeping still shares the same elapsed time.
          if (!weight) continue;
          for (const cell of covered) cell.weight *= REFERENCE_CELLS / weight;
        }
        this.totalWater += REFERENCE_CELLS * stroke.strength * seconds;
        for (const cell of covered) {
          this._cell(cell.longitude, cell.latitude);
          const key = keyFor(cell.longitude, cell.latitude);
          rates.set(key, (rates.get(key) || 0) + stroke.strength * cell.weight);
        }
      }
      for (const [key, cell] of this.cells) {
        const returningSource = this.forestRestoration?.sources.get(key);
        if (returningSource) advanceForestHeat(cell, returningSource, seconds, deepCoolingSeconds);
        const wasBurning = !cell.extinguished;
        // New underground heat is still arriving during a return pulse. Rain
        // keeps cooling it, and the ordinary settlement resumes afterwards.
        const hold = returningSource?.phase === 'returning' ? Infinity : extinctionHoldSeconds;
        advanceCell(cell, rates.get(key) || 0, seconds, surfaceWettingSeconds, surfaceDryingSeconds, deepCoolingSeconds, hold, this.parameters.fireReturnSeconds);
        if (returningSource && wasBurning && cell.extinguished && returningSource.phase !== 'waiting') {
          returningSource.phase = 'waiting'; returningSource.elapsed = 0;
          returningSource.pendingHeat = 0;
        }
      }
    }
    return this;
  }

  stepGlobalRain(dtSeconds, sourceKeys, strength = 1) {
    return this.step(dtSeconds, [], { globalRainKeys: sourceKeys, globalRainStrength: strength });
  }

  beginFinalRainCooling(sourceKeys) {
    const keys = sourceKeys instanceof Set ? sourceKeys : new Set(this.sourceRecords.map(record => keyFor(record.longitude, record.latitude)));
    // Finale cooling belongs to the same show clock as the rising rain. Keep
    // its entry geography and condition; ordinary fast brush physics cannot
    // finish this cue early or turn one delayed update into a different field.
    this.finalRainCooling = { progress: 0, cells: new Map([...keys].filter(key => this.cells.get(key)?.hasFire).map(key => [key, { ...this.cells.get(key) }])) };
    return this;
  }

  coolFinalRain(progress) {
    const cooling = this.finalRainCooling;
    if (!cooling || !finite(progress)) return this;
    // Lengthening a live cue cannot restore heat or undo absorbed water.
    const amount = cooling.progress = Math.max(cooling.progress, clamp01(progress));
    for (const [key, initial] of cooling.cells) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      cell.heat = initial.heat * (1 - amount);
      cell.surfaceWetness = initial.surfaceWetness + (1 - initial.surfaceWetness) * amount;
      cell.moisture = initial.moisture + (1 - initial.moisture) * amount;
      cell.extinguished = initial.extinguished || amount === 1;
      cell.settledFor = initial.extinguished ? initial.settledFor : amount === 1 ? this.parameters.extinctionHoldSeconds : initial.settledFor * (1 - amount);
    }
    return this;
  }

  stepFinalRain(dtSeconds, strength, progress) {
    const cooling = this.finalRainCooling;
    if (!cooling || !finite(dtSeconds) || dtSeconds <= 0 || !finite(strength)) return this;
    // strength is the exact interval-average of the scene rain envelope.
    // Count actual delivered water once; reading/publishing the field adds none.
    this.totalWater += cooling.cells.size * clamp01(strength) * dtSeconds;
    this.advanceDry(dtSeconds, cooling.cells);
    return this.coolFinalRain(progress);
  }

  endFinalRainCooling() {
    this.finalRainCooling = null;
    return this;
  }

  beginForestRestoration(sourceKeys) {
    const keys = sourceKeys instanceof Set ? sourceKeys : new Set(this.sourceRecords.map(record => keyFor(record.longitude, record.latitude)));
    // Only current source fires receive return pressure. There is no reheated
    // entry snapshot to overwrite moisture or cooling produced by a touch.
    this.forestRestoration = { progress: 0, sources: new Map([...keys]
      .filter(key => this.cells.get(key)?.hasFire)
      .map(key => [key, { phase: this.cells.get(key).extinguished ? 'returning' : 'burning', elapsed: 0 }])) };
    return this;
  }

  restoreForest(progress) {
    const restoration = this.forestRestoration;
    if (!restoration || !finite(progress)) return this;
    restoration.progress = Math.max(restoration.progress, clamp01(progress));
    return this;
  }

  endForestRestoration() {
    this.forestRestoration = null;
    return this;
  }

  advanceDry(dtSeconds, excludedCells = null) {
    if (!finite(dtSeconds) || dtSeconds <= 0) return this;
    if (this.forestRestoration && !excludedCells) return this.step(dtSeconds);
    const surfaceDryingSeconds = this.parameters.fireReturnSeconds / DRY_RESPONSE_SCALE;
    const { deepCoolingSeconds, extinctionHoldSeconds } = this.parameters;
    for (const [key, cell] of this.cells) {
      if (excludedCells?.has(key)) continue;
      advanceCell(cell, 0, dtSeconds, surfaceDryingSeconds, surfaceDryingSeconds, deepCoolingSeconds, extinctionHoldSeconds, this.parameters.fireReturnSeconds);
    }
    return this;
  }

  sample(longitude, latitude) {
    if (!finite(longitude) || !finite(latitude)) return { ...blankCell(0, 0) };
    return { ...(this.cells.get(keyFor(longitude, latitude)) || blankCell(longitude, latitude)) };
  }

  sampleArea(longitude, latitude) {
    const result = { surfaceWetness: 0, moisture: 0, heat: 0, coveredFraction: 0, cellCount: 0, fireFraction: 0, extinguishedFraction: 0 };
    if (!validPoint([longitude, latitude])) return result;
    const area = footprint(longitude, latitude);
    const totalWeight = area.reduce((sum, cell) => sum + cell.weight, 0);
    if (!totalWeight) return result;
    result.coveredFraction = clamp01(totalWeight / REFERENCE_CELLS);
    result.cellCount = area.length;
    for (const covered of area) {
      const cell = this.cells.get(keyFor(covered.longitude, covered.latitude));
      if (!cell) continue;
      const fraction = covered.weight / totalWeight;
      result.surfaceWetness += cell.surfaceWetness * fraction;
      result.moisture += cell.moisture * fraction;
      result.heat += cell.heat * fraction;
      if (cell.hasFire) result.fireFraction += fraction;
      if (cell.extinguished) result.extinguishedFraction += fraction;
    }
    return result;
  }

  stats() {
    let wetCells = 0, extinguishedCells = 0, fireCells = 0;
    const visibleFireKeys = new Set(this.sourceRecords.map(record => keyFor(record.longitude, record.latitude)));
    for (const [key, cell] of this.cells) {
      if (cell.surfaceWetness > 0.01 || cell.moisture > 0.01) wetCells += 1;
      if (cell.hasFire && visibleFireKeys.has(key)) {
        fireCells += 1;
        if (cell.extinguished) extinguishedCells += 1;
      }
    }
    return { wetCells, extinguishedCells, fireCells, totalWater: this.totalWater };
  }

  serialize() {
    return { schemaVersion: 3, parameters: { ...this.parameters }, cellSize: CELL_SIZE, brushRadius: BRUSH_RADIUS, totalWater: this.totalWater, sourceRecords: this.sourceRecords.map(record => ({ ...record })), cells: [...this.cells.values()].map(cell => ({ ...cell })) };
  }

  restore(payload) {
    if (!payload || ![1, 2, 3].includes(payload.schemaVersion) || payload.cellSize !== CELL_SIZE || payload.brushRadius !== BRUSH_RADIUS || !finite(payload.totalWater) || payload.totalWater < 0 || payload.totalWater > 1e12 || !Array.isArray(payload.cells) || payload.cells.length > 15000 || !Array.isArray(payload.sourceRecords) || payload.sourceRecords.length > 100000) return false;
    if (payload.schemaVersion !== 1 && !validParameters(payload.parameters, true, payload.schemaVersion === 2 ? LEGACY_PARAMETER_LIMITS : PARAMETER_LIMITS)) return false;
    const parameters = payload.schemaVersion === 1 ? { ...DEFAULT_PARAMETERS } : payload.schemaVersion === 2 ? migrateLegacyParameters(payload.parameters) : { ...payload.parameters };
    const restored = new Map();
    for (const cell of payload.cells) {
      if (!cell || !finite(cell.longitude) || !finite(cell.latitude) || !inBounds(cell.longitude, cell.latitude)) return false;
      const canonical = blankCell(cell.longitude, cell.latitude);
      if (Math.abs(canonical.longitude - cell.longitude) > 1e-9 || Math.abs(canonical.latitude - cell.latitude) > 1e-9) return false;
      if (!['surfaceWetness', 'moisture', 'heat'].every(name => finite(cell[name]) && cell[name] >= 0 && cell[name] <= 1) || !finite(cell.settledFor) || cell.settledFor < 0 || cell.settledFor > PARAMETER_LIMITS.extinctionHoldSeconds.max || typeof cell.hasFire !== 'boolean' || typeof cell.extinguished !== 'boolean') return false;
      if ((!cell.hasFire && (cell.heat !== 0 || cell.extinguished || cell.settledFor !== 0)) || (cell.extinguished && cell.heat !== 0)) return false;
      const key = keyFor(cell.longitude, cell.latitude);
      if (restored.has(key)) return false;
      restored.set(key, { longitude: cell.longitude, latitude: cell.latitude, surfaceWetness: cell.surfaceWetness, moisture: cell.moisture, heat: cell.heat, extinguished: cell.extinguished, settledFor: cell.settledFor, hasFire: cell.hasFire });
    }
    const records = [];
    for (const record of payload.sourceRecords) {
      if (!record || !finite(record.longitude) || !finite(record.latitude) || !inBounds(record.longitude, record.latitude) || !restored.get(keyFor(record.longitude, record.latitude))?.hasFire) return false;
      records.push({ longitude: record.longitude, latitude: record.latitude });
    }
    this.cells = restored;
    this.totalWater = payload.totalWater;
    this.sourceRecords = records;
    this.parameters = parameters;
    this.forestRestoration = null;
    this.finalRainCooling = null;
    return true;
  }

  reset() {
    const records = this.sourceRecords;
    this.cells.clear();
    this.totalWater = 0;
    this.forestRestoration = null;
    this.finalRainCooling = null;
    return this.seed(records);
  }
}
