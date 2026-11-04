// Only the Main sound owner can publish a short-lived visual bell cue.
export function createBellRelay({ room, deliver, now = Date.now } = {}) {
  let epoch = null;
  const seen = new Set(), recent = [];
  return {
    publish(role, message) {
      if (role !== 'operator') throw new Error('Only Main may publish a bell cue.');
      if (!message || message.type !== 'bell' || message.epoch !== room.epoch) throw new Error('Stale bell cue.');
      const allowed = ['type', 'epoch', 'eventId', 'key', 'position', 'radiusDegrees', 'wallAt'];
      if (Object.keys(message).some(key => !allowed.includes(key)) ||
          typeof message.eventId !== 'string' || !/^[a-zA-Z0-9:._-]{1,180}$/.test(message.eventId) ||
          typeof message.key !== 'string' || message.key.length > 50 ||
          !Array.isArray(message.position) || message.position.length !== 2 ||
          !message.position.every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
          message.radiusDegrees !== .85 || !Number.isFinite(message.wallAt)) throw new Error('Invalid bell cue.');
      const time = now(), scene = room.sceneState();
      if (!['participation', 'forest-takeover'].includes(scene.id) || scene.paused || room.bootstrapAvailable ||
          !room.national.fireKeys.has(message.key) || !room.simulation.cells.get(message.key)?.extinguished ||
          Math.abs(message.wallAt - time) > 2500) throw new Error('Bell cue is no longer current.');
      if (epoch !== room.epoch) { epoch = room.epoch; seen.clear(); recent.length = 0; }
      if (seen.has(message.eventId)) return false;
      while (recent.length && recent[0] <= time - 1000) recent.shift();
      if (recent.length >= 20) return false;
      seen.add(message.eventId); recent.push(time);
      while (seen.size > 512) seen.delete(seen.values().next().value);
      deliver({ type: 'bell', epoch, eventId: message.eventId, key: message.key,
        position: [...message.position], radiusDegrees: .85, wallAt: message.wallAt, serverNow: time });
      return true;
    },
  };
}
