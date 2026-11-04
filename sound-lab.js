import { loadSoundLibrary, soundAssetUrl } from './sound-library.js';

const $ = id => document.getElementById(id), players = [];
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; }
function saveChoice(forestSource, paletteVersion) {
  try { const key = 'wildfire-sound-operator-v1', saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; localStorage.setItem(key, JSON.stringify({ ...saved, forestSource, paletteVersion })); }
  catch { $('library-status').hidden = false; $('library-status').textContent = 'Choose this palette from the Sound controls on the main page.'; return; }
  location.href = '/study';
}
function card(asset, library) {
  const element = node('article', 'sound-card');
  element.dataset.asset = asset.id;
  const pair = library.morphs?.[asset.kind], position = pair?.indexOf(asset.id);
  const role = position === 0 ? ' · lower range' : position === pair?.length - 1 ? ' · upper range' : '';
  const kind = asset.kind === 'forest' ? `Burning forest${role || ' · fixed alternative'}` : asset.kind === 'crickets' ? 'After the fire' : `${asset.kind.replaceAll('-', ' ')}${role}`;
  element.append(node('p', 'sound-kind', kind), node('h3', '', asset.title), node('p', 'sound-description', asset.description || 'A separate texture for the landscape.'), node('p', 'sound-meta', `${Math.round(asset.durationSeconds)} sec · ${asset.model || (asset.generated === false ? 'Field recording' : 'Stable Audio')}`));
  const player = document.createElement('audio'); player.controls = true; player.preload = 'metadata'; player.src = soundAssetUrl(asset); player.setAttribute('aria-label', `Listen to ${asset.title}`); player.volume = .7;
  player.addEventListener('play', () => { for (const other of players) if (other !== player) other.pause(); });
  players.push(player); element.append(player);
  const actions = node('div', 'sound-actions'), download = node('a', '', 'Download'); download.href = soundAssetUrl(asset); download.download = asset.file.split('/').at(-1);
  if (asset.kind === 'forest') {
    const choose = node('button', '', 'Use this fire →'); choose.type = 'button';
    choose.addEventListener('click', () => saveChoice(asset.id, library.version));
    actions.append(choose);
  }
  actions.append(download); element.append(actions); return element;
}
loadSoundLibrary().then(library => {
  const models = [...new Set(library.assets.filter(asset => asset.generated).map(asset => asset.model).filter(Boolean))];
  const hasRecordings = library.assets.some(asset => asset.generated === false);
  $('model-note').textContent = hasRecordings ? `Natural field recordings${models.length ? ` and sound studies generated with ${models.join(' · ')}` : ''}.` : models.length ? `Generated with ${models.join(' · ')}.` : '';
  $('use-palette').hidden = !library.morphs?.forest;
  $('use-palette').addEventListener('click', () => saveChoice('morph', library.version));
  for (const asset of library.assets) $(asset.kind === 'forest' ? 'forest-options' : 'texture-options').append(card(asset, library));
  $('forest-section').hidden = !library.assets.some(asset => asset.kind === 'forest'); $('textures-section').hidden = !library.assets.some(asset => asset.kind !== 'forest');
  $('library-status').hidden = library.assets.length > 0;
  if (!library.assets.length) $('library-status').textContent = 'The new sound studies are still being prepared.';
}).catch(error => { $('library-status').textContent = error.message; });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const player of players) player.pause(); });
