import { operatorRequest } from '/shared-client.js';
import { DEFAULT_PARAMETERS, PARAMETER_LIMITS } from '/simulation.js';
import { mountSoundControls } from '/sound-controls.js';
import { createMainSoundControl } from '/main-sound-control.js';
import { DEFAULT_PROGRAM_NOTES, sceneClock, sceneRemaining, scenePresentation, scenePhaseReadout } from '/performance-view.js';
import { DEFAULT_SCORE_SETTINGS, SCENE_DURATION_LIMITS } from '/scene-score.js';

const $ = id => document.getElementById(id), frame = $('operator-preview');
const remoteRoute = /^\/operator-remote\/?$/.test(location.pathname);
document.body.dataset.operatorAccess = 'locked';
if (remoteRoute) document.title = 'karhutla · remote operator';
// View changes only reveal existing nodes. The preview owns Main audio and
// must stay attached, including while Setup is open.
const workspaceTabs = [...document.querySelectorAll('[data-workspace-tab]')];
function selectWorkspace(view, focusTab = false) {
  const activeTab = workspaceTabs.find(tab => tab.dataset.workspaceTab === view);
  if (!activeTab) return;
  document.body.dataset.workspaceView = view;
  for (const tab of workspaceTabs) {
    const selected = tab === activeTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  $('operator-live-view').hidden = view === 'setup';
  $('operator-setup-view').hidden = view !== 'setup';
  if (view !== 'setup') $('operator-live-view').setAttribute('aria-labelledby', activeTab.id);
  if (focusTab) activeTab.focus();
}
for (const [index, tab] of workspaceTabs.entries()) {
  tab.addEventListener('click', () => selectWorkspace(tab.dataset.workspaceTab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % workspaceTabs.length;
    else if (event.key === 'ArrowLeft') next = (index + workspaceTabs.length - 1) % workspaceTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = workspaceTabs.length - 1;
    else return;
    event.preventDefault();
    selectWorkspace(workspaceTabs[next].dataset.workspaceTab, true);
  });
}
$('scene-restart-shortcut').addEventListener('click', () => {
  selectWorkspace('setup');
  $('scene-restart').focus();
});
const metrics = window.__performanceOperator = { allowed: false, localOperator: false, remoteControl: false, connected: false, lastState: null, scene: null, soundSettings: null, mainSound: null, actions: [], errors: [] };
let mainSoundControl = null;
let latestState = null, sound = null, scene = null, pending = 0, soundTimer = null, soundPatch = {}, soundWaiters = [], strengthTimer = null, timingTimer = null, settingsDirty = false, scoreSettingsDirty = false, lastSoundSettings = '', connectionNotice = true;
const parameterLabels = { fireReturnSeconds: ['Fire return', 'How quickly unfinished fire returns after rain leaves.'], rainResponseSeconds: ['Surface response', 'How quickly held rain damps the surface flames.'], deepCoolingSeconds: ['Ground cooling', 'How long rain takes to cool the deeper fire.'], extinctionHoldSeconds: ['Extinction hold', 'How long cooled ground must stay wet to settle out.'] };
$('ground-timing').innerHTML = Object.entries(PARAMETER_LIMITS).map(([key, limits]) => `<label class="slider-label">${parameterLabels[key][0]} <output data-parameter-value="${key}">${DEFAULT_PARAMETERS[key]} s</output><input type="range" data-parameter="${key}" min="${limits.min}" max="${limits.max}" step="${limits.step}" value="${DEFAULT_PARAMETERS[key]}"><span class="slider-hint">${parameterLabels[key][1]}</span></label>`).join('');
$('program-notes').value = DEFAULT_PROGRAM_NOTES;
for (const input of $('score-settings').querySelectorAll('input')) {
  const limits = SCENE_DURATION_LIMITS[input.name];
  if (limits) { input.min = String(limits.min); input.max = String(limits.max); }
  input.value = String(DEFAULT_SCORE_SETTINGS[input.name]);
}
function text(id, value) { const node = $(id); if (node && node.textContent !== String(value)) node.textContent = String(value); }
function notify(message, error = false, connection = false) { connectionNotice = connection; text('operator-notice', message); $('operator-notice').dataset.error = String(error); if (error) metrics.errors.push(message); }
async function action(path, body = {}, message = '') {
  if (!metrics.allowed) return;
  pending++; metrics.actions.push({ path, at: Date.now() });
  try { const result = await operatorRequest(path, body); if (message) notify(message); return result; }
  catch (error) { notify(error.message, true); throw error; }
  finally { pending--; }
}
function renderScene(next) {
  if (!next) return;
  scene = next; metrics.scene = next;
  const view = scenePresentation(next);
  document.body.dataset.scene = next.id;
  const labels = { arrival: '01 · Arrival', instructions: '02 · Instructions', participation: '03 · Participation', 'forest-takeover': '04 · Forest takeover', 'final-rain': '05 · Final rain' };
  text('current-scene', labels[view.cueScene] || next.label || next.id);
  text('scene-paused', next.paused ? 'Paused' : next.id === 'ended' ? '' : 'Running');
  const remaining = sceneRemaining(next), nextLabel = { arrival: 'Instructions', instructions: 'Participation', participation: 'Forest takeover', 'forest-takeover': 'Final rain' }[next.id];
  text('scene-clock', next.id === 'ended' ? '00:00' : sceneClock({ elapsedMs: remaining * 1000 }));
  text('scene-remaining', nextLabel ? `Until ${nextLabel} · ${next.paused ? 'timer paused' : 'automatic'}` : next.id === 'ended' ? 'Performance complete' : next.id === 'afterglow' ? 'Until next ending phase' : 'Until heavy rain');
  text('scene-phase', scenePhaseReadout(next));
  $('scene-phase').dataset.phase = view.phase;
  const finalQueued = next.id === 'forest-takeover' && next.pendingFinalRain === true;
  $('scene-queue').hidden = !finalQueued;
  for (const button of document.querySelectorAll('button[data-scene]')) {
    const current = button.dataset.scene === view.cueScene, queued = button.dataset.scene === 'final-rain' && finalQueued;
    button.setAttribute('aria-current', current ? 'step' : 'false'); button.disabled = false;
    button.title = current ? 'Restart this scene and reset its timer.' : 'Override the sequence and start this scene now.';
    button.dataset.queued = String(queued);
    const durationKey = { arrival: 'arrivalSeconds', instructions: 'instructionsSeconds', participation: 'participationSeconds', 'forest-takeover': 'forestTakeoverSeconds' }[button.dataset.scene];
    if (durationKey) {
      const seconds = next.settings?.[durationKey] ?? DEFAULT_SCORE_SETTINGS[durationKey];
      button.querySelector('small').textContent = `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
    }
    if (button.dataset.scene === 'final-rain') {
      button.querySelector('small').textContent = queued ? 'Queued' : 'Through ending';
      button.title = 'Start final rain now and reset its timer.';
    }
  }
  $('scene-pause').disabled = next.id === 'ended'; text('scene-pause', next.paused ? next.id === 'arrival' && next.elapsedMs === 0 ? 'Start timed performance' : 'Resume' : 'Pause');
  if (next.id === 'ended') text('scene-pause', 'Complete');
  $('scene-restart-shortcut').hidden = next.id !== 'ended';
  $('scene-end').disabled = next.id === 'ended';
  const descriptions = { arrival: 'Title, program notes and numbered Wi-Fi then QR steps are visible. Start timed performance when the room is ready. Scenes then advance automatically; any scene button overrides the sequence and resets that scene’s timer.', instructions: 'Wi-Fi details, instructions and QR are visible on Projection; the same instructions appear on phones. Main moves from haze into distant burning forest. Participation opens automatically when this countdown ends.', participation: 'Audience rain cools the ground. D♭ soft tones sound in fixed places. Main rings once when an entire rain area is extinguished; phones add light rain during touch. Forest takeover begins automatically when this countdown ends.', 'forest-takeover': 'Fire returns as burning forest rises to 100%. The low drone transfers to phones with soft distortion. Audience rain cools and extinguishes patches while returning heat fights back. Final rain begins automatically after this countdown; the scene buttons can override it.', 'final-rain': `Sparse, quiet rain builds over ${next.settings?.finalRainRiseSeconds ?? DEFAULT_SCORE_SETTINGS.finalRainRiseSeconds} seconds. After all fires are out, rain crossfades into PA crickets over ${next.settings?.rainCricketOverlapSeconds ?? DEFAULT_SCORE_SETTINGS.rainCricketOverlapSeconds} seconds as the screens fade. PA crickets and a distant orangutan voice then hold in complete darkness before the crickets transfer to phones.`, afterglow: 'Rain crossfades smoothly into PA crickets as the screens fade. PA crickets and a distant orangutan voice hold in darkness before crickets transfer to phones. Very sparse bird calls pass between phones while the orangutan remains faint on Main; all recede into silence.', ended: 'Every screen is black and all sound is silent. Restart returns the room to paused Arrival with a fresh landscape.' };
  text('scene-description', next.paused && next.id !== 'arrival' ? `Paused. ${descriptions[next.id]}` : descriptions[next.id]);
  if (!settingsDirty) {
    $('wifi-name').value = next.settings?.wifiName || ''; $('wifi-password').value = next.settings?.wifiPassword || '';
    $('program-notes').value = next.settings?.programNotes || DEFAULT_PROGRAM_NOTES;
  }
  if (!scoreSettingsDirty) for (const input of $('score-settings').querySelectorAll('input')) {
    if (document.activeElement !== input) input.value = String(next.settings?.[input.name] ?? DEFAULT_SCORE_SETTINGS[input.name]);
  }
}
function receiveState(message) {
  if (!metrics.allowed) return;
  latestState = message; metrics.lastState = message; metrics.connected = true;
  if (message.mainSound) {
    metrics.mainSound = message.mainSound;
    mainSoundControl?.applyState(message.mainSound, message.epoch);
  }
  renderScene(message.scene);
  const condition = message.soundCondition;
  if (condition) { text('operator-heat', `${Math.round((condition.heat || 0) * 100)}%`); text('operator-wetness', `${Math.round((condition.surfaceWetness || 0) * 100)}%`); text('operator-out', `${condition.outCount || 0} / ${condition.sourceCount || 0}`); }
  text('operator-crowd', `${message.joinedCount || 0} phones · ${message.activeCount || 0} raining`);
  if (document.activeElement !== $('rain-strength') && !strengthTimer && Number.isFinite(message.strength)) { $('rain-strength').value = String(Math.round(message.strength * 100)); text('rain-strength-value', `${Math.round(message.strength * 100)}%`); }
  if (!timingTimer && message.simulation?.parameters) for (const control of document.querySelectorAll('[data-parameter]')) {
    if (document.activeElement === control) continue;
    const value = message.simulation.parameters[control.dataset.parameter]; if (!Number.isFinite(value)) continue;
    control.value = String(value); document.querySelector(`[data-parameter-value="${control.dataset.parameter}"]`).textContent = `${value} s`;
  }
  if (message.soundSettings) {
    metrics.soundSettings = message.soundSettings;
    const signature = JSON.stringify(message.soundSettings);
    if (sound && !soundTimer && signature !== lastSoundSettings) { sound.applySharedSettings(message.soundSettings); lastSoundSettings = signature; }
  }
  if (connectionNotice) notify(metrics.remoteControl ? 'Connected to the host. Remote controls are ready.' : 'Connected. Operator controls are ready.');
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (!metrics.allowed) return;
  if (event.data?.type === 'wildfire-preview-state') receiveState(event.data.state);
  if (event.data?.type === 'wildfire-preview-actors') text('operator-crowd', `${event.data.state.joinedCount || 0} phones · ${event.data.state.activeCount || 0} raining`);
  if (event.data?.type === 'wildfire-preview-connection') {
    const status = event.data.status;
    metrics.connected = status === 'connected';
    mainSoundControl?.setConnected(metrics.connected);
    if (status === 'disconnected') { notify('Preview disconnected. Waiting for the venue to reconnect.', false, true); void refreshSession(); }
    else if (status === 'connecting') notify('Connecting the preview to the venue…', false, true);
    else if (status === 'connected' && connectionNotice) notify('Connected. Operator controls are ready.');
  }
});
function mountAudition() {
  if (!metrics.allowed || sound || !frame.contentWindow?.__wildfireSound) return;
  mainSoundControl = createMainSoundControl({ engine: frame.contentWindow.__wildfireSound, remoteControl: metrics.remoteControl,
    request: enabled => operatorRequest('/api/main-sound', { enabled }, { timeoutMs: 8000 }),
    report: status => operatorRequest('/api/main-sound/status', status, { timeoutMs: 8000 }),
    onError: message => notify(message, true) });
  sound = mountSoundControls($('operator-sound'), { mode: 'operator', engine: frame.contentWindow.__wildfireSound, shared: true, remoteControl: metrics.remoteControl,
    mainSoundControl,
    onSettings(patch) {
      for (const [key, value] of Object.entries(patch)) soundPatch[key] = ['mixer', 'macros', 'phoneMixer'].includes(key) ? { ...soundPatch[key], ...value } : value;
      const saved = new Promise(resolve => soundWaiters.push(resolve));
      clearTimeout(soundTimer); text('sound-save-state', 'Saving shared sound settings…');
      soundTimer = setTimeout(async () => {
        const patchToSave = soundPatch, waiters = soundWaiters; soundPatch = {}; soundWaiters = []; soundTimer = null;
        let saved = false;
        try { await action('/api/sound-settings', patchToSave); saved = true; text('sound-save-state', 'Shared sound settings saved.'); }
        catch { text('sound-save-state', 'Sound settings could not save. Check the venue connection.'); }
        finally { for (const resolve of waiters) resolve(saved); }
      }, 160);
      return saved;
    } });
  if (latestState?.mainSound) mainSoundControl.applyState(latestState.mainSound, latestState.epoch);
  if (latestState?.soundSettings) { sound.applySharedSettings(latestState.soundSettings); lastSoundSettings = JSON.stringify(latestState.soundSettings); }
}
frame.addEventListener('load', mountAudition);
mountAudition();
const sceneCueMessages = { arrival: 'Arrival is ready.', instructions: 'Instructions are visible. Main is moving into distant burning forest.', participation: 'Participation opened.', 'forest-takeover': 'Forest takeover started. Rain cools the ground while fire keeps returning.', 'final-rain': 'Final rain started.' };
for (const button of document.querySelectorAll('button[data-scene]')) button.addEventListener('click', async () => {
  try {
    const result = await action('/api/scene', { scene: button.dataset.scene });
    if (result?.scene) renderScene(result.scene);
    notify(result?.scene?.pendingFinalRain ? 'Final rain queued; fire returning.' : sceneCueMessages[button.dataset.scene]);
  } catch {}
});
$('scene-pause').addEventListener('click', () => action('/api/scene', { action: scene?.paused ? 'resume' : 'pause' }, scene?.paused ? 'Performance resumed.' : 'Performance paused.').catch(() => {}));
$('scene-restart').addEventListener('click', async () => { try { await action('/api/reset', {}, 'Performance restarted in Arrival with a fresh landscape.'); } catch {} });
$('scene-end').addEventListener('click', () => action('/api/scene', { scene: 'ended' }, 'Performance ended.').catch(() => {}));
$('rain-strength').addEventListener('input', event => {
  const strength = Number(event.target.value) / 100; text('rain-strength-value', `${event.target.value}%`); clearTimeout(strengthTimer);
  strengthTimer = setTimeout(() => { strengthTimer = null; action('/api/strength', { strength }).catch(() => {}); }, 160);
});
for (const control of document.querySelectorAll('[data-parameter]')) control.addEventListener('input', () => {
  document.querySelector(`[data-parameter-value="${control.dataset.parameter}"]`).textContent = `${control.value} s`; clearTimeout(timingTimer);
  timingTimer = setTimeout(() => { timingTimer = null; const parameters = Object.fromEntries([...document.querySelectorAll('[data-parameter]')].map(node => [node.dataset.parameter, Number(node.value)])); action('/api/parameters', { parameters }).catch(() => {}); }, 160);
});
$('timing-defaults').addEventListener('click', () => action('/api/parameters', { parameters: DEFAULT_PARAMETERS }, 'Ground timing restored.').catch(() => {}));
async function readSnapshot() {
  try { const response = await fetch('/data/fire-snapshot.json', { cache: 'no-store' }); if (!response.ok) throw new Error(); const data = await response.json(); text('snapshot-status', data.observationStart && data.observationEnd ? `NASA FIRMS / NOAA-20 · ${data.observationStart.slice(0, 10)} to ${data.observationEnd.slice(0, 10)} · ${data.records?.length ?? data.hotspots?.length ?? 'Saved'} observations` : 'Saved NASA FIRMS observations.'); }
  catch { text('snapshot-status', 'Saved source status unavailable. The received landscape remains visible.'); }
}
$('fetch-fires').addEventListener('click', async () => { $('fetch-fires').disabled = true; try { await action('/api/snapshot/refresh', {}, 'Latest fire observations fetched.'); await readSnapshot(); } catch {} finally { $('fetch-fires').disabled = false; } });
$('arrival-settings').addEventListener('input', () => { settingsDirty = true; });
$('arrival-settings').addEventListener('submit', async event => {
  event.preventDefault(); const settings = { wifiName: $('wifi-name').value.trim(), wifiPassword: $('wifi-password').value, programNotes: $('program-notes').value.trim() };
  try { await action('/api/scene', { settings }, 'Audience information saved.'); settingsDirty = false; } catch {}
});
$('score-settings').addEventListener('input', () => { scoreSettingsDirty = true; text('score-save-state', 'Unsaved timing changes.'); });
$('score-settings').addEventListener('submit', async event => {
  event.preventDefault();
  if (!$('score-settings').reportValidity()) return;
  const settings = Object.fromEntries([...$('score-settings').querySelectorAll('input')].map(input => [input.name, Number(input.value)]));
  try { await action('/api/scene', { settings }, 'Performance timing saved.'); scoreSettingsDirty = false; text('score-save-state', 'Performance timing saved.'); } catch { text('score-save-state', 'Timing could not save. Check the venue connection.'); }
});
let settingsTransferBusy = false;
async function transferSettings(callback) {
  if (settingsTransferBusy || !metrics.allowed) return;
  settingsTransferBusy = true;
  $('operator-controls').disabled = true;
  text('settings-transfer-status', 'Preparing settings…');
  try {
    // Finish debounced slider saves before reading or replacing shared settings.
    const deadline = Date.now() + 10000;
    while (soundTimer || strengthTimer || timingTimer || pending) {
      if (Date.now() > deadline) throw new Error('Settings are still saving. Check the connection and try again.');
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    await callback();
  } catch (error) { text('settings-transfer-status', error.message); notify(error.message, true); }
  finally { settingsTransferBusy = false; $('operator-controls').disabled = !metrics.allowed; }
}
$('settings-export').addEventListener('click', () => transferSettings(async () => {
  if (settingsDirty || scoreSettingsDirty) throw new Error('Save your timing and audience edits before exporting settings.');
  const response = await fetch('/api/settings/export', { cache: 'no-store', headers: { 'X-Wildfire-Role': 'operator' } });
  const preset = await response.json();
  if (!response.ok) throw new Error(preset.error || 'Settings could not be exported.');
  const file = new Blob([`${JSON.stringify(preset, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = `karhutla-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  text('settings-transfer-status', 'Settings exported. Copy this file to the other computer and choose Import settings.');
}));
$('settings-import').addEventListener('click', () => { if (!settingsTransferBusy) $('settings-file').click(); });
$('settings-file').addEventListener('change', event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  transferSettings(async () => {
    if (file.size > 256 * 1024) throw new Error('Choose a karhutla settings file smaller than 256 KB.');
    let preset;
    try { preset = JSON.parse(await file.text()); } catch { throw new Error('This file is not valid JSON. Choose an exported karhutla settings file.'); }
    const result = await action('/api/settings/import', preset);
    settingsDirty = false; scoreSettingsDirty = false;
    receiveState(result);
    text('score-save-state', 'Imported performance timing saved.');
    text('sound-save-state', 'Imported sound settings saved.');
    text('settings-transfer-status', 'Settings imported and saved. Scene position and landscape progress are unchanged.');
    notify('Settings imported.');
  });
});
let sessionTask = null, sessionReady = false, pairingError = '', remoteLink = '', pinBusy = false, pinRetryUntil = 0;
function showRemoteLink(data) {
  const available = data.enabled && typeof data.remoteUrl === 'string' && /^[0-9]{6}$/.test(data.pin);
  $('remote-operator-share').hidden = !available;
  $('remote-operator-url').value = available ? data.remoteUrl : '';
  text('remote-operator-pin', available ? data.pin : '------');
  remoteLink = available ? data.remoteUrl : '';
  text('remote-operator-status', available ? 'Ready. Open /operator-remote on your other device and enter the PIN once. The controller will remember access.' : data.enabled && !data.pin ? 'Restart Karhutla once to enable the new controller address and PIN.' : 'No shared network address is available. Connect this computer to Wi-Fi or Ethernet and launch with Start-Karhutla, then refresh the address.');
}
async function refreshRemoteLink(renew = false) {
  if (!metrics.localOperator || metrics.remoteControl) return;
  $('remote-operator-refresh').disabled = true;
  $('remote-operator-renew').disabled = true;
  try {
    const response = await fetch(`/api/operator/remote${renew ? '/renew' : ''}`, renew ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' }, body: '{}' } : { cache: 'no-store', headers: { 'X-Wildfire-Role': 'operator' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The private link could not be read.');
    showRemoteLink(data);
    if (renew) text('remote-operator-status', 'PIN reset. Remote controllers are disconnected. Enter the new PIN on each controller to reconnect.');
  } catch (error) { text('remote-operator-status', error.message); }
  finally { $('remote-operator-refresh').disabled = false; $('remote-operator-renew').disabled = false; }
}
$('remote-operator-refresh').addEventListener('click', () => void refreshRemoteLink());
$('remote-operator-renew').addEventListener('click', () => void refreshRemoteLink(true));
$('remote-operator-copy').addEventListener('click', async () => {
  if (!remoteLink) return;
  try {
    await navigator.clipboard.writeText(remoteLink);
    text('remote-operator-status', 'Controller address copied. Open it on the other device using the same Wi-Fi, enter the PIN, then bookmark the page.');
  } catch {
    $('remote-operator-url').focus(); $('remote-operator-url').select();
    text('remote-operator-status', 'The controller address is selected. Copy it and open it on the other device, then enter the PIN.');
  }
});
function refreshSession() {
  if (!sessionTask) sessionTask = readSession().finally(() => { sessionTask = null; });
  return sessionTask;
}
async function refreshPairedSession() {
  // An earlier poll may have captured the session before Set-Cookie arrived.
  // Finish that read, then explicitly check the newly paired browser.
  await sessionTask;
  await refreshSession();
}
async function readSession() {
  try {
    const response = await fetch('/api/session', { cache: 'no-store' }); if (!response.ok) throw new Error('The venue session could not be read.');
    const session = await response.json(), wasAllowed = metrics.allowed;
    metrics.allowed = session.operatorAllowed === true;
    metrics.localOperator = session.localOperator === true;
    metrics.remoteControl = remoteRoute || !metrics.localOperator;
    $('operator-controls').disabled = !metrics.allowed || settingsTransferBusy;
    document.body.dataset.operatorAccess = metrics.allowed ? 'connected' : 'locked';
    $('operator-access-help').hidden = metrics.allowed;
    $('remote-controller-note').hidden = !metrics.allowed || !metrics.remoteControl;
    $('remote-operator-panel').hidden = !metrics.localOperator || metrics.remoteControl;
    renderScene(session.scene);
    if (!metrics.allowed) {
      if (frame.hasAttribute('src')) frame.removeAttribute('src');
      sound = null; latestState = null; metrics.connected = false;
      const message = pairingError || 'Enter the operator PIN to connect this device.';
      if (wasAllowed || !sessionReady || $('operator-notice').textContent !== message) notify(message, true, true);
      sessionReady = true;
      return;
    }
    const join = new URL(session.audienceUrl || session.joinUrl); join.pathname = '/audience';
    $('operator-audience-link').href = join.href; $('operator-join-url').href = join.href; text('operator-join-url', join.href);
    const audienceQR = `/api/qr.svg?view=audience&address=${encodeURIComponent(join.host)}`;
    if ($('operator-qr').getAttribute('src') !== audienceQR) $('operator-qr').src = audienceQR;
    const previewURL = `/projection?operator-preview=1${metrics.remoteControl ? '&remote-control=1' : ''}`;
    if (frame.getAttribute('src') !== previewURL) {
      sound = null; latestState = null;
      frame.src = previewURL;
      frame.title = metrics.remoteControl ? 'Remote landscape preview: hold the map to rain' : 'Operator landscape preview: hold the map to rain and audition fire patches';
      text('operator-preview-hint', metrics.remoteControl ? 'Hold the landscape to rain. Mixer changes control Main sound on the host computer.' : 'Enable main sound, then hold either view to rain and audition patches.');
      notify(metrics.remoteControl ? 'Connected to the host. Loading the shared landscape…' : 'Connected. Start timed performance when the audience is ready.');
      void readSnapshot();
    }
    if (metrics.localOperator && !metrics.remoteControl && (!sessionReady || document.body.dataset.workspaceView === 'setup')) void refreshRemoteLink();
    sessionReady = true;
  } catch (error) { notify(`${error.message} Retrying the connection…`, true, true); }
}
$('operator-pin-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (pinBusy || Date.now() < pinRetryUntil || !$('operator-pin-form').reportValidity()) return;
  const pin = $('operator-pin').value.trim();
  if (!/^[0-9]{6}$/.test(pin)) return;
  pinBusy = true; $('operator-pin-submit').disabled = true;
  $('operator-pin-status').dataset.error = 'false'; text('operator-pin-status', 'Connecting this device…');
  try {
    const response = await fetch('/api/operator/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' }, body: JSON.stringify({ pin }) });
    const result = await response.json();
    if (response.status === 429) {
      const seconds = Math.max(1, Number(response.headers.get('Retry-After')) || 60);
      pinRetryUntil = Date.now() + seconds * 1000;
    }
    if (!response.ok) throw new Error(result.error || 'The PIN could not be checked. Try again.');
    pairingError = ''; $('operator-pin').value = ''; text('operator-pin-status', 'Connected. This device will remember access.');
    await refreshPairedSession();
    if (!metrics.allowed) throw new Error('Access could not be remembered. Allow cookies for this page and try again.');
  } catch (error) { $('operator-pin-status').dataset.error = 'true'; text('operator-pin-status', error.message); }
  finally { pinBusy = false; $('operator-pin-submit').disabled = Date.now() < pinRetryUntil; }
});
$('operator-pin').addEventListener('input', () => {
  if (!pinBusy && Date.now() >= pinRetryUntil) text('operator-pin-status', '');
});
setInterval(() => {
  if (!pinRetryUntil) return;
  const remaining = Math.ceil((pinRetryUntil - Date.now()) / 1000);
  if (remaining > 0) text('operator-pin-status', `Too many attempts. Try again in ${remaining} seconds.`);
  else { pinRetryUntil = 0; $('operator-pin-submit').disabled = pinBusy; text('operator-pin-status', 'You can try the PIN again.'); }
}, 1000);
$('operator-access-retry').addEventListener('click', async () => { await pairFromLocation(); await refreshPairedSession(); });
async function pairFromLocation() {
  const fragment = new URLSearchParams(location.hash.slice(1)), token = fragment.get('remote');
  if (fragment.has('remote')) {
    pairingError = '';
    let invalidLink = false;
    try {
      const response = await fetch('/api/operator/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' }, body: JSON.stringify({ token }) });
      invalidLink = response.status === 403;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'This private link is no longer valid. Get a new link from the host computer.');
      // Keep a valid private fragment so the browser can bookmark the full
      // reconnecting link. Fragments never travel in HTTP requests/referrers.
    } catch (error) {
      pairingError = error.message;
      if (invalidLink && new URLSearchParams(location.hash.slice(1)).get('remote') === token) {
        fragment.delete('remote');
        const rest = fragment.toString();
        history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
      }
    }
  }
}
window.addEventListener('hashchange', async () => { await pairFromLocation(); await refreshPairedSession(); });
async function initialize() {
  await pairFromLocation();
  await refreshSession();
  setInterval(() => void refreshSession(), 5000);
}
initialize();
setInterval(() => {
  if (!sound || !metrics.soundSettings?.automation) return;
  const effective = sound.getMetrics()?.automation?.effectiveMacros || sound.getMetrics()?.macros;
  if (!effective) return;
  for (const input of $('operator-sound').querySelectorAll('[data-macro]')) {
    if (document.activeElement === input || soundTimer) continue;
    const value = Math.round((effective[input.dataset.macro] || 0) * 100); input.value = String(value); $('operator-sound').querySelector(`[data-value="${input.dataset.macro}"]`).textContent = `${value}%`;
  }
}, 300);
