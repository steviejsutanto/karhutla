// Main playback intent is live session state, separate from saved mixer values.
// Only a gesture on the host may create its first AudioContext.
const STATES = new Set(['unavailable', 'off', 'needs-gesture', 'starting', 'ready', 'muted', 'suspended', 'error']);
const validState = value => value && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
  Number.isSafeInteger(value.requestId) && value.requestId >= 0 && typeof value.requestedEnabled === 'boolean' &&
  value.status && Number.isSafeInteger(value.status.requestId) && value.status.requestId >= 0 &&
  STATES.has(value.status.state) && typeof value.status.activated === 'boolean';

export function createMainSoundControl({ engine, remoteControl = false, request, report, onError = () => {},
  setTimeout: schedule = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout } = {}) {
  let current = null, epoch, consumed = null, connected = false, destroyed = false;
  let activated = false, localBusy = false, requestBusy = false, optimistic = null, timedOut = false;
  let operation = 0, requestOperation = 0, epochVersion = 0, acknowledgementTimer = null, activationTimer = null, sentStatus = '', retryStatus = false;
  let localStatus = engine?.getMetrics?.().state ?? 'off';
  let statusQueue = Promise.resolve();
  if (localStatus === 'ready') activated = true;
  const listeners = new Set();

  function waitingForHost() {
    return Boolean(current && (current.status.requestId < current.requestId || current.status.state === 'starting'));
  }
  function getState() {
    const status = remoteControl ? current?.status ?? { state: 'unavailable', activated: false, requestId: 0 }
      : { state: localStatus, activated, requestId: consumed ?? 0 };
    const awaitingHost = remoteControl && current && current.status.requestId < current.requestId;
    const pending = requestBusy || localBusy || Boolean(remoteControl && waitingForHost() && !timedOut);
    const enabled = optimistic ?? (awaitingHost ? current.requestedEnabled
      : status.state === 'needs-gesture' ? Boolean(current?.requestedEnabled) : ['ready', 'starting'].includes(status.state));
    return { remoteControl, connected, requestId: current?.requestId ?? 0,
      requestedEnabled: optimistic ?? current?.requestedEnabled ?? false, enabled, pending,
      status: !connected || timedOut ? { ...status, state: 'unavailable' } : { ...status } };
  }
  function emit() { if (!destroyed) for (const listener of listeners) listener(getState()); }
  function clearAcknowledgementTimer() { if (acknowledgementTimer != null) cancel(acknowledgementTimer); acknowledgementTimer = null; }
  function watchAcknowledgement() {
    clearAcknowledgementTimer();
    if (!remoteControl || !connected || !waitingForHost()) { timedOut = false; return; }
    timedOut = false;
    acknowledgementTimer = schedule(() => {
      acknowledgementTimer = null; timedOut = true; emit();
      onError('The host did not respond. Keep its Operator page open and check the connection.');
    }, 8000);
  }
  function reportStatus() {
    if (remoteControl || !current || !connected || destroyed) return;
    const state = !activated && current.requestedEnabled && localStatus === 'off' ? 'needs-gesture' : localStatus;
    const payload = { requestId: current.requestId, state, activated }, signature = JSON.stringify(payload);
    if (signature === sentStatus && !retryStatus) return;
    sentStatus = signature; retryStatus = false;
    const generation = epochVersion;
    // Serialize reports so a slow "starting" response cannot overwrite the
    // later ready/muted state. Coalesce reports that became stale in the queue.
    statusQueue = statusQueue.then(() => {
      if (destroyed || generation !== epochVersion || signature !== sentStatus) return null;
      return report(payload);
    }).then(value => {
      if (!destroyed && generation === epochVersion && value) applyState(value);
    }).catch(() => { if (generation === epochVersion && sentStatus === signature) retryStatus = true; });
  }
  function onStatus(metrics) {
    if (remoteControl || destroyed || !metrics || !STATES.has(metrics.state)) return;
    localStatus = metrics.state;
    if (localStatus === 'ready') activated = true;
    reportStatus(); emit();
  }
  async function play(enabled, gesture) {
    const token = ++operation;
    if (activationTimer != null) cancel(activationTimer);
    activationTimer = null;
    if (!enabled) {
      localBusy = false; engine.setMuted(true); onStatus(engine.getMetrics?.() ?? { state: 'muted' }); return;
    }
    if (!gesture && (!activated || !engine.context || engine.context.state === 'closed')) {
      localStatus = 'needs-gesture'; reportStatus(); emit(); return;
    }
    localBusy = true;
    // Call synchronously before any await, preserving a host click's activation.
    let starting;
    try { starting = engine.enable(); }
    catch { localStatus = 'error'; localBusy = false; reportStatus(); emit(); return; }
    onStatus({ state: 'starting' });
    try {
      const timeout = Symbol('audio activation timeout');
      const enabled = await Promise.race([starting, new Promise(resolve => {
        activationTimer = schedule(() => { activationTimer = null; resolve(timeout); }, 8000);
      })]);
      if (destroyed || token !== operation) return;
      if (enabled === timeout) {
        engine.setMuted(true);
        onStatus({ state: 'needs-gesture' });
      } else onStatus(engine.getMetrics?.() ?? { state: enabled ? 'ready' : 'error' });
    } catch { if (!destroyed && token === operation) onStatus({ state: 'error' }); }
    finally { if (token === operation) {
      if (activationTimer != null) cancel(activationTimer);
      activationTimer = null; localBusy = false; emit();
    } }
  }
  function applyState(value, nextEpoch) {
    if (destroyed || !validState(value)) return;
    if (nextEpoch !== undefined && nextEpoch !== epoch) {
      epoch = nextEpoch; ++epochVersion; ++requestOperation;
      requestBusy = false; optimistic = null; clearAcknowledgementTimer();
      current = null; consumed = null; sentStatus = ''; timedOut = false;
    }
    if (current && value.revision < current.revision) return;
    const oldRequest = current?.requestId;
    current = { ...value, status: { ...value.status } }; connected = true;
    if (remoteControl) {
      // An interim "starting" acknowledgement still needs a final result. Keep
      // the original deadline through ordinary state packets and that interim ack.
      if (oldRequest !== current.requestId || !waitingForHost() || acknowledgementTimer == null && !timedOut) watchAcknowledgement();
    } else if (consumed === null) {
      // A page load/reconnection must never replay an earlier start request.
      consumed = current.requestId; reportStatus();
    } else if (current.requestId > consumed) {
      consumed = current.requestId; void play(current.requestedEnabled, false);
    } else reportStatus();
    emit();
  }
  async function toggle() {
    if (destroyed || !connected) return false;
    if (!remoteControl) {
      if (localBusy) return false;
      await play(localStatus !== 'ready', true); return true;
    }
    if (requestBusy || getState().pending) return false;
    const token = ++requestOperation, enabled = !getState().enabled;
    requestBusy = true; optimistic = enabled; timedOut = false; emit();
    try { const value = await request(enabled); if (!destroyed && token === requestOperation) applyState(value); return true; }
    catch (error) { if (!destroyed && token === requestOperation) onError(error?.message || 'Main sound could not change. Check the venue connection.'); return false; }
    finally { if (token === requestOperation) { requestBusy = false; optimistic = null; emit(); } }
  }
  function setConnected(value) {
    const next = Boolean(value);
    // The preview announces "connected" on every state/actor packet. Only an
    // actual reconnection may retry a report or restart the host deadline;
    // otherwise report -> broadcast -> connected creates a feedback loop.
    if (destroyed || connected === next) return;
    connected = next; if (!connected) clearAcknowledgementTimer();
    else { timedOut = false; watchAcknowledgement(); retryStatus = true; reportStatus(); }
    emit();
  }
  return { getState, applyState, toggle, onStatus, setConnected,
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    destroy() { destroyed = true; ++operation; ++requestOperation; clearAcknowledgementTimer();
      if (activationTimer != null) cancel(activationTimer); listeners.clear(); } };
}
