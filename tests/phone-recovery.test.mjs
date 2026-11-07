import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneSoundRecoveryState, retryPhoneAssets } from '../app/phone-recovery.js';

test('a late phone can recover sound during the dark phone-only ending without lighting working phones', () => {
  const scene = { id: 'afterglow', elapsedMs: 54_000 };
  for (const state of ['off', 'error', 'suspended', 'muted']) {
    const recovery = phoneSoundRecoveryState(scene, state);
    assert.equal(recovery.visible, true, state);
    assert.equal(recovery.busy, false, state);
    assert.match(recovery.label, /^Tap to /);
  }
  assert.deepEqual(phoneSoundRecoveryState(scene, 'starting'), { visible: true, busy: true, retryRecording: false, label: 'Starting sound…' });
  assert.equal(phoneSoundRecoveryState(scene, 'ready').visible, false);
  for (const id of ['arrival', 'participation', 'ended']) assert.equal(phoneSoundRecoveryState({ id }, 'off').visible, false);
  assert.equal(phoneSoundRecoveryState(null, 'off').visible, false);
});

test('a running context exposes exhausted transient cricket recovery only when that recording is needed', () => {
  const scene = { id: 'afterglow', elapsedMs: 54_000 };
  const cricket = { id: 'crickets', url: '/crickets.mp3', retryable: true, attempts: 4, retryAt: Infinity };
  const metrics = { sourceErrors: { 'crickets:/crickets.mp3': cricket }, samplePending: [] };
  const recovery = phoneSoundRecoveryState(scene, 'ready', metrics);
  assert.equal(recovery.visible, true); assert.equal(recovery.retryRecording, true);
  assert.equal(recovery.label, 'Tap to retry sound');
  assert.equal(phoneSoundRecoveryState(scene, 'ready', { ...metrics, samplePending: ['crickets:/crickets.mp3'] }).visible, false);
  assert.equal(phoneSoundRecoveryState(scene, 'ready', { ...metrics, samplePending: ['crickets'] }).visible, false);
  for (const patch of [{ retryAt: Date.now() + 1000 }, { retryable: false }, { id: 'crackle' }]) {
    assert.equal(phoneSoundRecoveryState(scene, 'ready', { sourceErrors: { failed: { ...cricket, ...patch } } }).visible, false);
  }
  assert.equal(phoneSoundRecoveryState({ id: 'afterglow', elapsedMs: 30_000 }, 'ready', metrics).visible, false, 'PA-only hold does not need phone cricket recovery yet');
  assert.equal(phoneSoundRecoveryState({ id: 'ended' }, 'ready', metrics).visible, false);
  assert.equal(phoneSoundRecoveryState(scene, 'ready', { sourceErrors: {} }).visible, false, 'Successful loading restores black');
});

test('a failed initial download retries and returns recovered assets instead of latching failure', async () => {
  const calls = [], delays = [], failures = [];
  const result = await retryPhoneAssets(async ({ attempt, signal }) => {
    calls.push(attempt); assert.equal(signal.aborted, false);
    if (attempt === 1) throw new Error('temporary Wi-Fi failure');
    return { type: 'FeatureCollection', features: [] };
  }, { retryDelay: attempt => attempt * 1000, wait: ms => delays.push(ms),
    onFailedAttempt: (error, attempt) => failures.push([error.message, attempt]) });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(delays, [1000]);
  assert.deepEqual(failures, [['temporary Wi-Fi failure', 1]]);
  assert.equal(result.type, 'FeatureCollection');
});

test('automatic recovery stops after three failures and a later manual batch can succeed', async () => {
  let attempts = 0, disposed = 0;
  await assert.rejects(retryPhoneAssets(async () => {
    attempts++; throw new Error('unavailable');
  }, { wait: async () => {}, onFailedAttempt: () => disposed++ }), /unavailable/);
  assert.equal(attempts, 3); assert.equal(disposed, 3);
  const recovered = await retryPhoneAssets(async () => { attempts++; return 'ready'; });
  assert.equal(recovered, 'ready'); assert.equal(attempts, 4);
});

test('a stalled load is aborted and discarded before retry, and a late result cannot win', async () => {
  let previousSignal, resolveStalled, disposed = false;
  const result = await retryPhoneAssets(({ attempt, signal }) => {
    if (attempt === 1) { previousSignal = signal; return new Promise(resolve => { resolveStalled = resolve; }); }
    assert.equal(previousSignal.aborted, true); assert.equal(disposed, true);
    resolveStalled('obsolete assets');
    return 'new assets';
  }, { timeoutMs: 5, wait: async () => {}, onFailedAttempt: () => { disposed = true; } });
  assert.equal(result, 'new assets');
});
