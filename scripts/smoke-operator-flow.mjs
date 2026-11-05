import assert from 'node:assert/strict';

export async function requestJson(base, route, body) {
  const response = await fetch(`${base}${route}`, body === undefined ? { signal: AbortSignal.timeout(5000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${route} returned ${response.status}: ${result.error ?? 'request failed'}`);
  return result;
}

export async function prepareFreshOperator(base) {
  const health = await requestJson(base, '/api/health');
  assert.equal(health.status, 'ok');
  assert.equal(health.bootstrapAvailable, true, 'The smoke must begin with a real fresh install, not an initialized rehearsal save.');
  assert.equal(health.authorityReady, false);
  const scene = await requestJson(base, '/api/scene');
  assert.equal(scene.id, 'arrival'); assert.equal(scene.paused, true);
  const preset = await requestJson(base, '/api/settings/export');
  preset.strength = .37; preset.soundSettings.level = .42; preset.soundSettings.automation = false;
  preset.soundSettings.mixer.bells = .8; preset.soundSettings.macros.haze = .61;
  preset.sceneSettings.participationSeconds = 333; preset.sceneSettings.wifiName = 'Smoke rehearsal';
  preset.sceneSettings.programNotes = 'Release settings persistence check.';
  const imported = await requestJson(base, '/api/settings/import', preset);
  assert.equal(imported.bootstrapAvailable, true, 'Importing a settings file prepares the show without starting it.');
  assert.equal(imported.scene.id, 'arrival'); assert.equal(imported.scene.paused, true);
  assert.deepEqual(await requestJson(base, '/api/settings/export'), preset);
  assert.equal((await requestJson(base, '/api/health')).authorityReady, false);
  return preset;
}

export async function assertRestartedOperator(base, preset, { initialized }) {
  assert.deepEqual(await requestJson(base, '/api/settings/export'), preset, 'Prepared settings survive a server restart.');
  const health = await requestJson(base, '/api/health');
  assert.equal(health.bootstrapAvailable, !initialized);
  assert.equal(health.authorityReady, initialized);
  const scene = await requestJson(base, '/api/scene');
  assert.equal(scene.id, 'arrival'); assert.equal(scene.paused, true); assert.equal(scene.elapsedMs, 0);
}

export async function exercisePreparedOperator(base, preset) {
  // Use the real operator buttons' endpoints. Deliberately never call the
  // legacy /api/bootstrap route: that hid the fresh-install failure in 1.0.2.
  const started = await requestJson(base, '/api/scene', { action: 'resume' });
  assert.equal(started.bootstrapAvailable, false, 'Start timed performance must initialize a fresh install itself.');
  assert.equal(started.scene.id, 'arrival'); assert.equal(started.scene.paused, false);
  assert.equal((await requestJson(base, '/api/health')).authorityReady, true);
  assert.deepEqual(await requestJson(base, '/api/settings/export'), preset);
  for (const cue of ['forest-takeover', 'final-rain']) {
    const reset = await requestJson(base, '/api/reset', {});
    assert.equal(reset.scene.id, 'arrival'); assert.equal(reset.scene.paused, true);
    const selected = await requestJson(base, '/api/scene', { scene: cue });
    assert.equal(selected.scene.id, cue, `Selecting ${cue} must work without a separate Initialize action.`);
    assert.equal(selected.scene.paused, false); assert.equal(selected.bootstrapAvailable, false);
    if (cue === 'final-rain') assert.equal(selected.scene.globalRain, true);
    assert.deepEqual(await requestJson(base, '/api/settings/export'), preset);
  }
  const restarted = await requestJson(base, '/api/reset', {});
  assert.equal(restarted.scene.id, 'arrival'); assert.equal(restarted.scene.paused, true);
  assert.deepEqual(await requestJson(base, '/api/settings/export'), preset, 'Restart keeps the prepared settings.');
}
