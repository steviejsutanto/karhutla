import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createPerformanceServer } from '../app/server.mjs';
import { scoreDurations } from '../app/scene-score.js';

class CrowdPeer {
  constructor(url) {
    this.messages = [];
    this.waiters = new Set();
    this.seq = 0;
    this.socket = new WebSocket(url);
    this.socket.on('message', raw => {
      const message = JSON.parse(raw);
      this.messages.push(message);
      for (const waiter of [...this.waiters]) if (waiter.match(message)) waiter.finish(null, message);
    });
    this.socket.on('error', error => { for (const waiter of [...this.waiters]) waiter.finish(error); });
  }
  wait(match, after = 0) {
    const existing = this.messages.slice(after).find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { match, finish: (error, message) => {
        clearTimeout(timer); this.waiters.delete(waiter); error ? reject(error) : resolve(message);
      } };
      const timer = setTimeout(() => waiter.finish(new Error('Crowd client timed out')), 5000);
      this.waiters.add(waiter);
    });
  }
  async ready() { this.welcome = await this.wait(message => message.type === 'welcome'); return this; }
  async hold(holding, position, start = false) {
    const seq = ++this.seq, after = this.messages.length;
    this.socket.send(JSON.stringify({ type: 'hold', epoch: this.welcome.epoch, seq, holding, start,
      space: 'country', position, path: [position] }));
    const result = await this.wait(message => message.type === 'error' || message.type === 'ack' && message.seq === seq, after);
    assert.equal(result.type, 'ack', result.message);
    assert.equal(result.holding, holding);
    return result;
  }
}

test('50 audience connections keep rain, identity, pause and the full ending coherent through reconnects', async t => {
  let now = 1000;
  const instance = await createPerformanceServer({ port: 0, persistencePath: null,
    clock: () => now, wallClock: () => 100000 + now });
  const allPeers = [];
  t.after(async () => { allPeers.forEach(peer => peer.socket.terminate()); await instance.close(); });
  const { port } = await instance.listen(), http = `http://127.0.0.1:${port}`;
  const request = async body => {
    const response = await fetch(`${http}/api/scene`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
  };
  const connect = async (role, id) => {
    const peer = new CrowdPeer(`ws://127.0.0.1:${port}/ws?role=${role}&clientId=${id}${role === 'participant' ? '&scope=indonesia' : ''}`);
    allPeers.push(peer); return peer.ready();
  };
  await request({ scene: 'participation' });
  const operator = await connect('operator', 'crowd-operator');
  const projection = await connect('projection', 'crowd-projection');
  const audience = await Promise.all(Array.from({ length: 50 }, (_, index) => connect('participant', `crowd-${index}`)));
  const numbers = audience.map(peer => peer.welcome.participantNumber);
  assert.equal(new Set(numbers).size, 50);
  assert.equal(instance.room.connections.size, 52);
  const bounds = instance.room.national.layout().bounds, patches = instance.room.national.sourcePatches;
  assert.ok(patches.length > 0, 'This test needs the distributed release snapshot.');
  const positions = audience.map((_, index) => {
    const [, longitude, latitude] = patches[Math.floor(index * patches.length / 50)];
    return [(longitude - bounds.west) / (bounds.east - bounds.west), (bounds.north - latitude) / (bounds.north - bounds.south)];
  });
  await Promise.all(audience.map((peer, index) => peer.hold(true, positions[index], true)));
  assert.equal(instance.room.wireState().activeCount, 50);
  for (let round = 0; round < 10; round++) {
    now += 100; instance.tick(); instance.broadcast();
    await Promise.all(audience.map((peer, index) => peer.hold(true, positions[index])));
  }
  assert.ok(instance.room.simulation.totalWater > 0);
  assert.equal(instance.room.wireState().activeCount, 50);

  // Ten devices drop their connections, then reconnect together under their
  // existing identities. No old pressed gesture may survive this interruption.
  await Promise.all(audience.slice(0, 10).map(peer => new Promise(resolve => {
    peer.socket.once('close', resolve); peer.socket.terminate();
  })));
  const disconnectDeadline = Date.now() + 2000;
  while (instance.room.connections.size !== 42 && Date.now() < disconnectDeadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(instance.room.connections.size, 42);
  assert.equal(instance.room.wireState().activeCount, 40);
  await Promise.all(audience.slice(0, 10).map(async (_, index) => { audience[index] = await connect('participant', `crowd-${index}`); }));
  assert.deepEqual(audience.map(peer => peer.welcome.participantNumber), numbers);
  assert.equal(instance.room.connections.size, 52);
  assert.equal(instance.room.wireState().activeCount, 40);
  for (const peer of audience.slice(0, 10)) assert.equal(instance.room.phoneState(peer.welcome.connectionId).own.holding, false);
  await Promise.all(audience.slice(0, 10).map((peer, index) => peer.hold(true, positions[index], true)));
  assert.equal(instance.room.wireState().activeCount, 50);

  await request({ action: 'pause' });
  assert.equal(instance.room.wireState().activeCount, 0);
  const waterAtPause = instance.room.simulation.totalWater;
  now += 10000; instance.tick();
  assert.equal(instance.room.simulation.totalWater, waterAtPause);
  await request({ action: 'resume' });
  assert.equal(instance.room.wireState().activeCount, 0, 'Resume does not restore stale holds.');
  await Promise.all(audience.map((peer, index) => peer.hold(true, positions[index], true)));
  now += 100; instance.tick();
  await Promise.all(audience.map((peer, index) => peer.hold(false, positions[index])));
  assert.equal(instance.room.wireState().activeCount, 0);

  await request({ scene: 'forest-takeover' });
  await request({ scene: 'final-rain' });
  const durations = scoreDurations(instance.room.scenes.settings);
  now += durations.finalRainRiseMs; instance.tick(); instance.broadcast();
  assert.equal(instance.room.sceneState().id, 'afterglow');
  const { sourceCount, outCount } = instance.room.globalSound().fireProgress;
  assert.ok(sourceCount > 0); assert.equal(outCount, sourceCount);
  const audienceMarks = audience.map(peer => peer.messages.length);
  const operatorMark = operator.messages.length, projectionMark = projection.messages.length;
  now += durations.afterglowDurationMs; instance.tick(); instance.broadcast();
  assert.equal(instance.room.sceneState().id, 'ended');
  const ended = message => ['summary', 'state'].includes(message.type) && message.scene?.id === 'ended';
  const ending = await Promise.all([
    ...audience.map((peer, index) => peer.wait(ended, audienceMarks[index])),
    operator.wait(ended, operatorMark), projection.wait(ended, projectionMark),
  ]);
  for (const message of ending) { assert.equal(message.scene.phoneGain, 0); assert.equal(message.scene.mainGain, 0); }
  assert.equal(instance.room.connections.size, 52);
  assert.equal(instance.room.wireState().activeCount, 0);
  for (const peer of allPeers) assert.equal(peer.messages.some(message => message.type === 'error'), false);
});
