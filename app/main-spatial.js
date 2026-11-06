const unit = (value, fallback = .5) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export const MAIN_STEREO_FOCUS = .65;

/** Widen the Main field without moving its centre or changing source distance. */
export function mainSpatialPosition(position = [.5, .5]) {
  const x = unit(Array.isArray(position) ? position[0] : position?.x);
  const y = unit(Array.isArray(position) ? position[1] : position?.y);
  // Retain the existing HRTF angle and radius. Wider HRTF angles introduced
  // high-note cancellation when folded to mono; native stereo focus gives
  // clearer room-speaker separation without that new spectral/depth change.
  const world = [(x - .5) * 7, 0, -(.8 + 6 * y)];
  const pan = Math.sin((x - .5) * Math.PI);
  return { x, y, world, pan, focusPan: pan * MAIN_STEREO_FOCUS, distanceGain: 1 / (1 + .8 * y) };
}
