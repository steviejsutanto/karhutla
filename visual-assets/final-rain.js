const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const fract = value => value - Math.floor(value);
const MAX_DROPS = 4096;
const noise = (index, salt = 0) => {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
const drops = Array.from({ length: MAX_DROPS }, (_, index) => ({
  x: noise(index, 0), phase: noise(index, 1), speed: 58 + noise(index, 2) * 108,
  drift: -3 + noise(index, 3) * 8, sway: noise(index, 4) * Math.PI * 2,
  length: 5 + Math.floor(noise(index, 5) * 3) * 2,
  slant: .45 + noise(index, 6) * .65, rank: noise(index, 7), opacity: .5 + noise(index, 8) * .5,
}));

// One continuous field uses the contact feedback's native 5–9 px strokes.
// Repeating contact rectangles would introduce shared horizontal start/end
// rows, even when their anchors are jittered. Each drop instead traverses the
// entire sky on its own clock and fades against the real ground profile.
export function drawFinalSectionRain(context, { width, height, surfaceYAt, intensity = 0, now = 0, reducedMotion = false } = {}) {
  const gain = clamp(intensity);
  // Match the rain's equal-power sound entrance. A sparse field is present
  // immediately; multiplying the tiny show-clock gain into rank and opacity
  // separately would postpone the image for much of the gentle first rise.
  const audibleGain = Math.sin(gain * Math.PI / 2);
  const visibility = Math.sqrt(audibleGain);
  const coverage = .16 + .84 * audibleGain;
  const result = { columns: 0, drops: 0, intensity: gain, visualGain: visibility, clip: { left: 0, top: 0, right: width, bottom: height } };
  if (!(width > 0 && height > 0 && gain > 0)) return result;
  const surfaceAt = normalized => Math.max(0, Math.min(height,
    typeof surfaceYAt === 'function' ? surfaceYAt(normalized) : height * .285));
  let skyHeight = 0;
  for (let index = 0; index <= 32; index++) skyHeight = Math.max(skyHeight, surfaceAt(index / 32));
  if (!skyHeight) return result;
  const count = Math.min(MAX_DROPS, Math.max(32, Math.ceil(width * skyHeight * .0065)));
  const time = reducedMotion ? 0 : Math.max(0, Number.isFinite(now) ? now : 0) / 1000;
  const travel = skyHeight + 18, feather = Math.min(22, Math.max(8, skyHeight * .10));
  const skyFeather = Math.min(80, Math.max(18, skyHeight * .45));
  context.save();
  context.beginPath(); context.rect(0, 0, width, height); context.clip();
  context.lineCap = 'round'; context.lineWidth = 1.3; context.strokeStyle = '#fff0d8';
  for (let index = 0; index < count; index++) {
    const drop = drops[index], presence = smooth((coverage - drop.rank * .72) / .28);
    if (!presence) continue;
    const x = fract(drop.x + (time * drop.drift + Math.sin(time * .31 + drop.sway) * 6) / width) * width;
    const y = fract(drop.phase + time * drop.speed / travel) * travel - 9;
    const bottom = y + drop.length, ground = surfaceAt(x / width);
    if (y < 0 || bottom > ground) continue;
    // Spatial variation is two-dimensional and drifts slowly; there are no
    // stacked emitter rows or common drop speeds to reveal a curtain seam.
    const weather = .55 + .45 * (.5 + .25 * Math.sin(x * .012 + y * .027 + time * .21)
      + .25 * Math.sin(x * .031 - y * .019 - time * .16));
    const edge = smooth(Math.min(x, width - x) / feather) * smooth(y / skyFeather)
      * smooth((ground - bottom) / feather);
    const opacity = visibility * presence * drop.opacity * weather * edge * .62;
    if (opacity <= .0001) continue;
    context.globalAlpha = opacity;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x - drop.slant, bottom); context.stroke();
    result.drops++;
  }
  result.columns = result.drops ? 1 : 0;
  context.restore();
  return result;
}
