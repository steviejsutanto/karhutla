// Shared by the venue settings, Operator controls and native phone graph.
// Unity retains the authored balance; these trims never enable phone audio.
export const PHONE_MIXER_DEFAULTS = Object.freeze({ overall: 1, crackle: 1, rain: 1, crickets: 1, birds: 1, drone: 1 });

export function phoneMixerPatch(current = PHONE_MIXER_DEFAULTS, patch = {}) {
  const plain = patch && typeof patch === 'object' && !Array.isArray(patch)
    && [Object.prototype, null].includes(Object.getPrototypeOf(patch));
  if (!plain || Reflect.ownKeys(patch).some(key => !Object.hasOwn(PHONE_MIXER_DEFAULTS, key))
    || Object.values(patch).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2)) {
    throw Object.assign(new Error('Phone mixer levels must be numbers between zero and two.'), { status: 400 });
  }
  return { ...PHONE_MIXER_DEFAULTS, ...current, ...patch };
}
