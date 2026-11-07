/** Control the Projection stage's native fullscreen, independently of Chrome's window. */
export function mountProjectionFullscreen({ stage, button, document = globalThis.document,
  location = globalThis.location, window = globalThis.window, beforeChange = () => {},
  onChange = () => {}, onError = () => {} } = {}) {
  let destroyed = false, busy = false, automaticAttempted = false, waitingForVisibility = false;
  let fullscreen = document.fullscreenElement === stage, failure = '';
  const query = new URLSearchParams(location?.search ?? '');
  const automatic = ['/projection', '/projection/'].includes(location?.pathname) &&
    query.get('fullscreen') === '1' && !query.has('operator-preview') && Boolean(window && window.top === window);

  function synchronize() {
    const next = document.fullscreenElement === stage, changed = next !== fullscreen;
    fullscreen = next;
    stage.dataset.fullscreen = String(fullscreen);
    const action = `${fullscreen ? 'Exit' : 'Enter'} projection fullscreen`;
    button.setAttribute('aria-label', action);
    button.title = failure ? `${failure} Click to ${fullscreen ? 'exit' : 'enter'} projection fullscreen.` : action;
    button.disabled = busy;
    if (changed && !destroyed) onChange(fullscreen);
  }
  function stopWaiting() {
    if (waitingForVisibility) document.removeEventListener('visibilitychange', whenVisible);
    waitingForVisibility = false;
  }
  async function change(enter) {
    if (destroyed || busy) return false;
    busy = true; failure = ''; synchronize();
    try {
      beforeChange();
      // Invoke the native method before the first await so a real button click
      // retains its user activation. Automatic permission remains browser-owned.
      if (enter) await stage.requestFullscreen();
      else await document.exitFullscreen();
      if (destroyed) return false;
      if ((document.fullscreenElement === stage) !== enter) throw new Error('The fullscreen state did not change.');
      return true;
    } catch (error) {
      if (!destroyed) {
        failure = 'Fullscreen was unavailable.';
        onError('Fullscreen unavailable. Click the fullscreen button to try again.', error);
      }
      return false;
    } finally {
      busy = false;
      if (!destroyed) synchronize();
    }
  }
  function attemptAutomatic() {
    if (destroyed || !automatic || automaticAttempted) return Promise.resolve(false);
    automaticAttempted = true; stopWaiting();
    // Preserve fullscreen that the user has already chosen instead of toggling it.
    if (document.fullscreenElement) return Promise.resolve(document.fullscreenElement === stage);
    return change(true);
  }
  function whenVisible() { if (!document.hidden) void attemptAutomatic(); }
  function ready() {
    if (destroyed || !automatic || automaticAttempted) return Promise.resolve(false);
    if (document.hidden) {
      if (!waitingForVisibility) document.addEventListener('visibilitychange', whenVisible);
      waitingForVisibility = true;
      return Promise.resolve(false);
    }
    return attemptAutomatic();
  }
  function toggle() {
    automaticAttempted = true; stopWaiting();
    return change(!document.fullscreenElement);
  }
  const click = () => { void toggle(); };
  const fullscreenChange = () => { if (!destroyed) synchronize(); };
  button.addEventListener('click', click);
  document.addEventListener('fullscreenchange', fullscreenChange);
  synchronize();
  return { ready, toggle, destroy() {
    destroyed = true; stopWaiting();
    button.removeEventListener('click', click);
    document.removeEventListener('fullscreenchange', fullscreenChange);
  } };
}
