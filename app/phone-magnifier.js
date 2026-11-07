// A bounded copy of the already-painted map, never another map or simulation.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MAGNIFIER_ZOOM = 2;
export const MAGNIFIER_SIZE = 124;

export function magnifierLayout({ width, height, x, y, size = MAGNIFIER_SIZE, gap = 36, margin = 12, topInset = 12, bottomInset = 88 }) {
  const diameter = Math.max(40, Math.min(size, width - margin * 2, height - topInset - bottomInset));
  const maximumX = Math.max(margin, width - margin - diameter);
  const maximumY = Math.max(topInset, height - bottomInset - diameter);
  let left = clamp(x - diameter / 2, margin, maximumX), top = y - gap - diameter, placement = 'above';
  if (top < topInset) {
    // Near the top, a side lens keeps the target visible without covering the
    // finger at the viewport edge. Controls retain their higher stacking layer.
    const rightRoom = width - margin - x, leftRoom = x - margin;
    placement = rightRoom >= leftRoom ? 'right' : 'left';
    left = clamp(placement === 'right' ? x + gap : x - gap - diameter, margin, maximumX);
    top = clamp(y - diameter / 2, topInset, maximumY);
  } else top = clamp(top, topInset, maximumY);
  return { left, top, size: diameter, placement };
}

export function magnifierCrop({ x, y, width, height, size = MAGNIFIER_SIZE, zoom = MAGNIFIER_ZOOM }) {
  const span = size / zoom, originX = x - span / 2, originY = y - span / 2;
  const left = clamp(originX, 0, width), top = clamp(originY, 0, height);
  const right = clamp(originX + span, 0, width), bottom = clamp(originY + span, 0, height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top),
    targetX: (left - originX) * zoom, targetY: (top - originY) * zoom,
    targetWidth: Math.max(0, right - left) * zoom, targetHeight: Math.max(0, bottom - top) * zoom };
}

export class PhoneMagnifier {
  constructor({ element, canvas, source, pixelRatio = 1,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis), cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) }) {
    if (canvas === source) throw new Error('The magnifier needs a separate source canvas.');
    this.element = element; this.canvas = canvas; this.source = source; this.context = canvas.getContext('2d');
    const label = element.querySelector?.('[data-magnifier-label]');
    if (label) label.textContent = `${MAGNIFIER_ZOOM}×`;
    element.dataset.zoom = String(MAGNIFIER_ZOOM);
    this.pixelRatio = Math.max(1, Math.min(1.5, pixelRatio)); this.active = false; this.lingering = false; this.hideTimer = null; this.lastDraw = -Infinity; this.frames = 0;
    this.requestFrame = requestFrame; this.cancelFrame = cancelFrame; this.moveFrame = null; this.paintedPoint = null; this.lastMoveDraw = -Infinity;
    this.hide();
  }
  show({ touch, point, width, height, sourceWidth, sourceHeight }, now = performance.now()) {
    clearTimeout(this.hideTimer); this.hideTimer = null; this.lingering = false;
    const fresh = !this.active;
    this.active = true; this.point = point; this.sourceWidth = sourceWidth; this.sourceHeight = sourceHeight;
    this.layout = magnifierLayout({ width, height, x: touch.x, y: touch.y });
    const { left, top, size, placement } = this.layout;
    this.element.hidden = false; this.element.dataset.placement = placement;
    this.element.style.width = `${size}px`; this.element.style.height = `${size}px`;
    this.element.style.transform = `translate(${left}px, ${top}px)`;
    const pixels = Math.round(size * this.pixelRatio);
    const resized = this.canvas.width !== pixels;
    if (resized) { this.canvas.width = pixels; this.canvas.height = pixels; }
    if (fresh || resized) { this.lastMoveDraw = -Infinity; this.draw(now, true); }
    else if (this._pointMoved()) {
      // The lens follows the finger immediately; its tiny cached-map crop
      // catches up on the next paint, rather than waiting for the map's 20 Hz
      // animation or the idle lens's 24 Hz refresh. Coalesce fast input into
      // one pending copy instead of repainting the full map on every move.
      this._queueMovement();
    } else this.draw(now);
  }
  _pointMoved() { return !this.paintedPoint || Math.abs(this.point.x - this.paintedPoint.x) > .25 || Math.abs(this.point.y - this.paintedPoint.y) > .25; }
  _queueMovement() {
    if (this.moveFrame !== null || !this.requestFrame) return;
    this.moveFrame = this.requestFrame(at => {
      this.moveFrame = null;
      if (!this.active || !this._pointMoved()) return;
      // High-refresh phones still copy at most 60 times per second during a
      // drag. Its first movement always gets the very next animation frame.
      if (at - this.lastMoveDraw < 1000 / 60 - .01) { this._queueMovement(); return; }
      this.draw(at, true); this.lastMoveDraw = at;
    });
  }
  _cancelMovement() { if (this.moveFrame !== null) this.cancelFrame?.(this.moveFrame); this.moveFrame = null; }
  draw(now = performance.now(), force = false) {
    if (!this.active || !this.source.width || !this.source.height || (!force && now - this.lastDraw < 1000 / 24)) return false;
    const size = this.layout.size, context = this.context;
    const crop = magnifierCrop({ ...this.point, width: this.sourceWidth, height: this.sourceHeight, size });
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.fillStyle = '#080b0a'; context.fillRect(0, 0, size, size);
    if (crop.width > 0 && crop.height > 0) {
      const scaleX = this.source.width / this.sourceWidth, scaleY = this.source.height / this.sourceHeight;
      context.drawImage(this.source, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY,
        crop.targetX, crop.targetY, crop.targetWidth, crop.targetHeight);
    }
    const center = size / 2;
    context.strokeStyle = '#ffe9c8'; context.lineWidth = .8;
    context.beginPath();
    context.moveTo(center - 10, center); context.lineTo(center - 4, center);
    context.moveTo(center + 4, center); context.lineTo(center + 10, center);
    context.moveTo(center, center - 10); context.lineTo(center, center - 4);
    context.moveTo(center, center + 4); context.lineTo(center, center + 10);
    context.stroke();
    this.lastDraw = now; this.frames++; this.paintedPoint = { ...this.point };
    this.element.dataset.frames = String(this.frames); this.element.dataset.zoom = String(MAGNIFIER_ZOOM);
    this.element.dataset.sourcePoint = JSON.stringify([this.point.x, this.point.y]);
    return true;
  }
  release() {
    if (!this.active) return;
    this._cancelMovement();
    if (this._pointMoved()) this.draw(performance.now(), true);
    this.active = false; this.lingering = true;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 450);
  }
  hide() {
    clearTimeout(this.hideTimer); this.hideTimer = null;
    this._cancelMovement();
    this.active = false; this.lingering = false; this.element.hidden = true; this.point = null;
    this.paintedPoint = null;
  }
}
