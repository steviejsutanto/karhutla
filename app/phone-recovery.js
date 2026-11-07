import { scenePresentation } from './performance-view.js';

// The normal ending remains completely black. Only a phone that cannot yet
// play sound gets a small, actionable recovery control outside the faded map.
export function phoneSoundRecoveryState(scene, soundState, metrics = {}) {
  const view = scene && scenePresentation(scene, { phone: true });
  const cricketPending = (metrics.samplePending || []).some(key => key === 'crickets' || key.startsWith('crickets:'));
  // The context can be running while a required recording has exhausted its
  // automatic retries. Other, unused layers must not light up the ending.
  const retryRecording = Boolean(soundState === 'ready' && view?.phoneGain > 0 && view?.mix.phoneCrickets > 0 && !cricketPending &&
    Object.values(metrics.sourceErrors || {}).some(error => error.id === 'crickets' && error.retryable === true &&
      error.attempts > 0 && error.retryAt === Infinity));
  const needed = Boolean(scene && scene.id !== 'ended' && view.blackout &&
    (retryRecording || ['off', 'error', 'suspended', 'muted', 'starting'].includes(soundState)));
  return { visible: needed, busy: soundState === 'starting', retryRecording,
    label: soundState === 'starting' ? 'Starting sound…' : soundState === 'suspended' ? 'Tap to resume sound' :
      soundState === 'muted' ? 'Tap to unmute sound' : soundState === 'error' || retryRecording ? 'Tap to retry sound' : 'Tap to enable sound' };
}

// Each attempt has its own timeout and cancellation signal. The caller owns
// disposable image/canvas resources and discards them in onFailedAttempt.
export async function retryPhoneAssets(load, { attempts = 3, timeoutMs = 8000,
  retryDelay = attempt => 1000 * 2 ** (attempt - 1) + Math.random() * 400,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onAttempt = () => {}, onFailedAttempt = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    let timeout;
    onAttempt(attempt, attempts);
    try {
      return await Promise.race([
        Promise.resolve().then(() => load({ attempt, signal: controller.signal })),
        new Promise((_, reject) => { timeout = setTimeout(() => {
          reject(new Error('The map took too long to load.'));
          controller.abort();
        }, timeoutMs); }),
      ]);
    } catch (error) {
      lastError = error;
      controller.abort();
      onFailedAttempt(error, attempt);
    } finally { clearTimeout(timeout); }
    if (attempt < attempts) await wait(retryDelay(attempt));
  }
  throw lastError;
}
