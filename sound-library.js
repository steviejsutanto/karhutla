// Local audio provenance is also the source of the listening-room choices.
export const SOUND_LIBRARY_URL = '/audio-assets/v3/manifest.json';
const localAudio = asset => asset && /^audio-assets\/v3\/[a-z0-9-]+\.mp3$/.test(asset.file) &&
  /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isFinite(asset.durationSeconds) && asset.durationSeconds > 0;
export function soundLibrary(value) {
  if (!value || !Array.isArray(value.assets) || value.assets.length > 40) throw new Error('The sound library is unavailable.');
  const ids = new Set();
  const assets = value.assets.map(asset => {
    if (!asset || typeof asset.id !== 'string' || !/^[a-z0-9-]+$/.test(asset.id) || ids.has(asset.id) ||
      typeof asset.title !== 'string' || typeof asset.kind !== 'string' ||
      !localAudio(asset) || (asset.mobile != null && !localAudio(asset.mobile))) throw new Error('The sound library contains an invalid entry.');
    ids.add(asset.id); return { ...asset };
  });
  return { ...value, assets, defaultForest: assets.some(asset => asset.kind === 'forest' && asset.id === value.defaultForest) ? value.defaultForest : assets.find(asset => asset.kind === 'forest')?.id ?? null };
}
export const soundAssetUrl = asset => `/${asset.file}?v=${asset.sha256.slice(0, 12)}`;

/** Resolve only verified catalog entries; a palette cannot introduce a remote URL. */
export function ambianceSources(library) {
  const assets = new Map(library.assets.map(asset => [asset.id, asset]));
  const variations = {};
  function resolve(ids, kind) {
    if (!Array.isArray(ids) || ids.length !== 2 || new Set(ids).size !== ids.length) return null;
    const entries = ids.map(id => assets.get(id));
    if (entries.some(asset => !asset || asset.kind !== kind)) return null;
    return entries.map((asset, index) => ({ url: soundAssetUrl(asset), at: index / (entries.length - 1) }));
  }
  for (const kind of ['forest', 'haze', 'ash', 'rain', 'moisture']) {
    const entries = resolve(library.morphs?.[kind], kind);
    if (entries) variations[kind] = entries;
  }
  const insects = resolve(library.aftermath, 'crickets');
  if (insects) variations.crickets = insects;
  // Layer IDs still pass through the verified local catalog. Order describes
  // near / middle / far perspective, rather than a volume morph.
  let cricketLayers;
  if (Array.isArray(library.cricketLayers) && library.cricketLayers.length >= 2 && library.cricketLayers.length <= 6 && new Set(library.cricketLayers).size === library.cricketLayers.length) {
    const entries = library.cricketLayers.map(id => assets.get(id));
    if (entries.every(asset => asset?.kind === 'crickets')) cricketLayers = entries.map((asset, index) => ({ id: asset.id, url: soundAssetUrl(asset), depth: index / (entries.length - 1) }));
  }
  const phone = {};
  for (const [layer, kind] of [['crackle', 'phone-crackle'], ['crickets', 'crickets'], ['rain', 'rain']]) {
    const asset = assets.get(library.phone?.[layer]);
    if (asset?.kind === kind) phone[layer] = soundAssetUrl(asset.mobile ?? asset);
  }
  // The catalog's legacy phone.quench IDs remain provenance-stable; this
  // bank is resolved exclusively for Main and never as a phone source.
  const quenchIds = library.main?.quench ?? library.phone?.quench;
  const mainQuench = Array.isArray(quenchIds) && quenchIds.length <= 4
    ? [...new Set(quenchIds)].map(id => assets.get(id)).filter(asset => ['phone-quench', 'main-quench'].includes(asset?.kind))
      .map(asset => ({ id: asset.id, url: soundAssetUrl(asset) })) : [];
  const blobIds = library.main?.blob;
  const blobAssets = Array.isArray(blobIds) && blobIds.length <= 4 && new Set(blobIds).size === blobIds.length
    ? blobIds.map(id => assets.get(id)) : [];
  const mainBlob = blobAssets.every(asset => asset?.kind === 'blob')
    ? blobAssets.map(asset => ({ id: asset.id, url: soundAssetUrl(asset) })) : [];
  const phoneCricketLayers = Array.isArray(library.phone?.cricketLayers) && library.phone.cricketLayers.length >= 2 && library.phone.cricketLayers.length <= 3
    && new Set(library.phone.cricketLayers).size === library.phone.cricketLayers.length
    ? library.phone.cricketLayers.map(id => assets.get(id)) : [];
  const verifiedPhoneCrickets = phoneCricketLayers.length && phoneCricketLayers.every(asset => asset?.kind === 'crickets')
    ? phoneCricketLayers.map((asset, index) => ({ id: asset.id, url: soundAssetUrl(asset.mobile ?? asset), depth: 1 - index / (phoneCricketLayers.length - 1) })) : [];
  const residueSources = {};
  for (const kind of ['ash', 'moisture', 'haze']) {
    const ids = library.residueVariations?.[kind];
    if (!Array.isArray(ids) || ids.length > 6 || new Set(ids).size !== ids.length) continue;
    const entries = ids.map(id => assets.get(id));
    if (entries.every(asset => asset?.kind === kind)) residueSources[kind] = entries.map(asset => ({ id: asset.id, url: soundAssetUrl(asset) }));
  }
  return { variations, phone, mainQuench, mainBlob, residueSources, phoneCricketLayers: verifiedPhoneCrickets, ...(cricketLayers ? { cricketLayers } : {}) };
}
export async function loadSoundLibrary() {
  const response = await fetch(SOUND_LIBRARY_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('The sound library could not load.');
  return soundLibrary(await response.json());
}
