// The mobile recordings contain slower spaced, shorter natural chirps. Keep
// their field continuous; the score owns its handoff and retreat. One native
// entrance softens a late join without muting whole multi-second passages.
export const PHONE_CRICKET_RATE = .76;
export const PHONE_CRICKET_LEVEL = .04 * 10 ** (-8.5 / 20);
export const PHONE_CRICKET_ENTRANCE_SECONDS = 4;
export class PhoneCricketPhrases {
  constructor({ context, parameter }) {
    this.context = context; this.parameter = parameter;
    this.active = false; this.enteredAt = null;
    parameter.value = 0;
  }
  update(active) {
    const now = this.context.currentTime, parameter = this.parameter;
    if (Boolean(active) === this.active) return;
    this.active = Boolean(active);
    parameter.cancelScheduledValues(now);
    if (!active) { parameter.setValueAtTime(0, now); this.enteredAt = null; return; }
    this.enteredAt = now;
    parameter.setValueAtTime(0, now);
    // Raised-cosine native points avoid a hard first cricket attack.
    for (let index = 1; index <= 32; index++) {
      const progress = index / 32;
      parameter.linearRampToValueAtTime(.5 - .5 * Math.cos(Math.PI * progress), now + PHONE_CRICKET_ENTRANCE_SECONDS * progress);
    }
  }
  getMetrics() { return { active: this.active, continuous: true, enteredAt: this.enteredAt, entranceSeconds: PHONE_CRICKET_ENTRANCE_SECONDS }; }
}
