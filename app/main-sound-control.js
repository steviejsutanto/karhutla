// Main playback intent is live session state, separate from saved mixer values.
// An explicit host or remote enable may ask the browser to activate audio.
// Browser autoplay permission still decides whether a first context can run.
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
  let targetEnabled = localStatus === 'ready', cancelActivation = null;
  const cancelled = Symbol('audio activation cancelled'), timeout = Symbol('audio activation timeout');
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
    const enabled = optimistic ?? (awaitingHost ? current.requestedEnabled : ['ready', 'starting'].includes(status.state));
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
  function clearActivation() {
    if (activationTimer != null) cancel(activationTimer);
    activationTimer = null;
    cancelActivation?.(); cancelActivation = null;
  }
  function failActivation(state) {
    targetEnabled = false;
    engine.setMuted(true);
    onStatus({ state });
  }
  async function play(enabled) {
    const token = ++operation;
    clearActivation();
    targetEnabled = enabled;
    if (!enabled) {
      localBusy = false; engine.setMuted(true); onStatus(engine.getMetrics?.() ?? { state: 'muted' }); return;
    }
    localBusy = true;
    // A host click keeps its activation; a remote request may use a browser's
    // existing autoplay permission, including the dedicated performance browser.
    let starting;
    try { starting = engine.enable(); }
    catch (error) {
      failActivation(['NotAllowedError', 'SecurityError'].includes(error?.name) ? 'needs-gesture' : 'error');
      localBusy = false; emit(); return;
    }
    onStatus({ state: 'starting' });
    try {
      const completion = Promise.resolve(starting).finally(() => {
        // A browser resume may settle after its timeout, a later disable, or
        // disposal. It must not reopen audio after that intent was withdrawn.
        if ((destroyed || !targetEnabled) && engine.muted !== true) engine.setMuted(true);
      });
      const result = await Promise.race([completion, new Promise(resolve => {
        cancelActivation = () => resolve(cancelled);
        // Leave time to report the browser fallback before the controller's
        // separate eight-second acknowledgement deadline expires.
        activationTimer = schedule(() => { activationTimer = null; resolve(timeout); }, 6000);
      })]);
      if (destroyed || token !== operation || result === cancelled) return;
      const metrics = engine.getMetrics?.();
      if (result === timeout || result === false || engine.context?.state !== 'running' || metrics && metrics.state !== 'ready') {
        const blocked = result === timeout || engine.context?.state === 'suspended' || metrics?.state !== 'error';
        failActivation(blocked ? 'needs-gesture' : 'error');
      } else onStatus(metrics ?? { state: 'ready' });
    } catch (error) {
      if (!destroyed && token === operation) failActivation(['NotAllowedError', 'SecurityError'].includes(error?.name) || engine.context?.state === 'suspended' ? 'needs-gesture' : 'error');
    }
    finally { if (token === operation) {
      clearActivation(); localBusy = false; emit();
    } }
  }
  function applyState(value, nextEpoch) {
    if (destroyed || !validState(value)) return;
    if (nextEpoch !== undefined && nextEpoch !== epoch) {
      epoch = nextEpoch; ++epochVersion; ++requestOperation;
      requestBusy = false; optimistic = null; clearAcknowledgementTimer();
      current = null; consumed = null; sentStatus = ''; timedOut = false;
      if (localBusy) {
        ++operation; clearActivation(); targetEnabled = false; localBusy = false;
        engine.setMuted(true); localStatus = engine.getMetrics?.().state ?? 'muted';
      }
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
      consumed = current.requestId; void play(current.requestedEnabled);
    } else reportStatus();
    emit();
  }
  async function toggle() {
    if (destroyed || !connected) return false;
    if (!remoteControl) {
      if (localBusy) return false;
      await play(localStatus !== 'ready'); return true;
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
    destroy() { destroyed = true; ++operation; ++requestOperation; clearAcknowledgementTimer(); clearActivation();
      targetEnabled = false; if (localBusy && !remoteControl) engine.setMuted(true);
      localBusy = false; listeners.clear(); } };
}
