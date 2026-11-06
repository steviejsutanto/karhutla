// Transport only. The venue server owns time, water, heat, and persistence.
export class SharedConnection {
  constructor({ role, scope = 'region', onState, onActors, onBell, onConnection, onWelcome, onError }) {
    this.role = role;
    this.scope = scope === 'indonesia' ? 'indonesia' : 'region';
    this.onState = onState;
    this.onActors = onActors;
    this.onBell = onBell;
    this.onConnection = onConnection;
    this.onWelcome = onWelcome;
    this.onError = onError;
    this.epoch = null;
    this.revision = null;
    this.assignment = null;
    this.seq = 0;
    this.participantNumber = null;
    this.connectionId = null;
    this.ready = false;
    this.scene = null;
    this.connected = false;
    this.holding = false;
    this.inputHeld = false;
    this.rainSupply = null;
    this.acknowledged = false;
    this.pendingPath = [];
    this.movementTimer = null;
    this.position = null;
    this.lastSent = 0;
    this.newGesture = false;
    this.gestureSeq = Infinity;
    this.retryMs = 500;
    const key = `wildfire-${role}-client-id`;
    const newId = `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      const storage = role === 'participant' ? localStorage : sessionStorage;
      this.clientId = storage.getItem(key) || newId;
      storage.setItem(key, this.clientId);
    }
    catch { this.clientId = newId; }
    this.connect();
    this.timer = setInterval(() => {
      if ((this.holding || this.inputHeld) && performance.now() - this.lastSent >= 500) this.sendHold(true);
    }, 100);
  }

  connect() {
    this.onConnection?.('connecting');
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('role', this.role);
    url.searchParams.set('clientId', this.clientId);
    if (this.role === 'participant' && this.scope === 'indonesia') url.searchParams.set('scope', 'indonesia');
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'welcome') {
        this.connected = true;
        this.epoch = message.epoch;
        this.revision = null;
        this.assignment = message.assignment || null;
        this.connectionId = message.connectionId;
        this.participantNumber = message.participantNumber;
        this.rainSupply = message.rainSupply ?? null;
        this.seq = 0;
        this.ready = false;
        this.clearHold();
        this.retryMs = 500;
        this.onWelcome?.(message);
        this.onConnection?.('connected');
      } else if (message.type === 'state' || message.type === 'summary') {
        if (message.type === 'state' && message.simulation?.delta &&
            (message.epoch !== this.epoch || message.baseRevision !== this.revision)) {
          this.stop();
          this.ready = false;
          this.revision = null;
          socket.send(JSON.stringify({ type: 'resync' }));
          return;
        }
        if (message.type === 'state') this.revision = message.revision;
        if (message.assignment) this.assignment = message.assignment;
        const reset = this.epoch !== null && message.epoch !== this.epoch;
        if (reset) this.clearHold();
        this.epoch = message.epoch;
        this.ready = !message.bootstrapAvailable;
        this.scene = message.scene || null;
        if (message.rainSupply) this.rainSupply = message.rainSupply;
        if (this.scene && !this.scene.audienceEnabled) this.clearHold();
        this.checkOwnHold(message);
        this.onState?.(message, { reset });
        this.onConnection?.('connected');
      } else if (message.type === 'actors') {
        // Lightweight presence never establishes an epoch or simulation baseline.
        if (message.epoch !== this.epoch || !this.ready) return;
        this.checkOwnHold(message);
        this.onActors?.(message);
        this.onConnection?.('connected');
      } else if (message.type === 'bell') {
        if (message.epoch === this.epoch && this.ready) this.onBell?.(message);
      } else if (message.type === 'ack' && message.epoch === this.epoch) {
        if (message.rainSupply) this.rainSupply = message.rainSupply;
        if (this.rainSupply?.needsRelease && !message.holding) {
          this.holding = false; this.acknowledged = false; this.pendingPath = [];
        }
        if (message.seq >= this.gestureSeq) this.acknowledged = this.holding && message.holding;
        this.onConnection?.('connected');
      } else if (message.type === 'error') {
        this.clearHold();
        this.onError?.(message.message || 'Contribution was not accepted. Press again to retry.');
        this.onConnection?.('connected');
      }
    });
    socket.addEventListener('close', event => {
      if (this.socket !== socket) return;
      this.connected = false; this.ready = false; this.clearHold();
      this.onConnection?.('disconnected');
      if (event.code === 4001) {
        this.onError?.('This participant is open in another tab. This tab is not contributing.');
        return;
      }
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(5000, this.retryMs * 1.5);
    });
    socket.addEventListener('error', () => { /* close handles recovery; no old gestures are queued */ });
  }

  checkOwnHold(message) {
    const own = message.own || message.participants?.find(actor => actor.id === this.clientId);
    if (this.inputHeld && this.rainSupply?.needsRelease && own && !own.holding) {
      this.holding = false; this.acknowledged = false; this.pendingPath = [];
      return;
    }
    if (this.holding && this.acknowledged && own && !own.holding) {
      this.clearHold();
      this.onError?.('Your rain stopped. Press again to continue.');
    }
  }

  clearHold() {
    if (this.movementTimer !== null) clearTimeout(this.movementTimer);
    this.movementTimer = null;
    this.holding = false;
    this.inputHeld = false;
    this.acknowledged = false;
    this.pendingPath = [];
    this.newGesture = false;
    this.gestureSeq = Infinity;
  }

  get canPour() { return this.role !== 'projection' && (!this.scene || this.scene.audienceEnabled) && this.connected && this.ready && this.socket?.readyState === WebSocket.OPEN; }

  sendBellFeedback(detail = {}) {
    if (this.role !== 'operator' || !this.connected || !this.ready || this.socket?.readyState !== WebSocket.OPEN) return false;
    if (typeof detail.eventId !== 'string' || typeof detail.key !== 'string' || !Array.isArray(detail.position)) return false;
    this.socket.send(JSON.stringify({ type: 'bell', epoch: this.epoch, eventId: detail.eventId, key: detail.key,
      position: detail.position, radiusDegrees: detail.radiusDegrees, wallAt: detail.wallAt }));
    return true;
  }

  begin(position) {
    if (!this.canPour || this.holding || this.inputHeld || this.rainSupply?.needsRelease || this.rainSupply?.level === 0) return false;
    this.holding = true; this.acknowledged = false;
    this.inputHeld = true;
    this.newGesture = true;
    this.position = [...position]; this.pendingPath = [[...position]];
    this.sendHold(true);
    this.gestureSeq = this.seq;
    this.onConnection?.('connected');
    return true;
  }

  move(position) {
    if (!this.holding) return;
    this.position = [...position];
    this.pendingPath.push([...position]);
    if (this.pendingPath.length > 256) this.pendingPath = this.pendingPath.filter((_, index) => index === 0 || index % 2 === 1);
    // Send the first movement after an idle hold immediately. Continuous motion
    // still sends at most 10Hz, using a trailing timer rather than an unrelated
    // periodic poll that can add up to another 100ms of wait.
    const remaining = 100 - (performance.now() - this.lastSent);
    if (remaining <= 0) {
      if (this.movementTimer !== null) clearTimeout(this.movementTimer);
      this.movementTimer = null;
      this.sendHold(true);
    } else if (this.movementTimer === null) {
      this.movementTimer = setTimeout(() => {
        this.movementTimer = null;
        if (this.holding && this.pendingPath.length > 1) this.sendHold(true);
      }, remaining);
    }
  }

  sendHold(holding) {
    if (!this.canPour || !this.position) return;
    const points = this.pendingPath.length ? this.pendingPath : [this.position];
    const path = points.length <= 64 ? points : Array.from({ length: 64 }, (_, index) => points[Math.round(index * (points.length - 1) / 63)]);
    this.socket.send(JSON.stringify({ type: 'hold', epoch: this.epoch, seq: ++this.seq, holding, start: holding && this.newGesture, ...(this.role === 'participant' ? { space: this.scope === 'indonesia' ? 'country' : 'region' } : {}), position: this.position, path }));
    this.newGesture = false;
    this.pendingPath = [[...this.position]];
    this.lastSent = performance.now();
  }

  stop() {
    if (this.holding || this.inputHeld) this.sendHold(false);
    this.clearHold();
    this.onConnection?.(this.connected ? 'connected' : 'disconnected');
  }
}

export async function operatorRequest(path, body = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wildfire-Role': 'operator' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The operator action could not be completed.');
  return data;
}
