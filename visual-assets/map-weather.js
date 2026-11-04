import { palette } from './renderer.js';

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const fract = value => value - Math.floor(value);
const random = (index, seed) => fract(Math.sin(index * 127.1 + seed * 311.7) * 43758.5453123);

/**
 * Screen-space bounds for geographically sized weather. The footprint marks
 * the simulation brush; the rain curtain extends naturally beyond that circle.
 * Cloud bounds conservatively include its gentle bob.
 * No viewport clamping is applied, so pan and zoom preserve the geographic anchor.
 */
export function brushRainBounds({ x = 0, y = 0, radius = 0 } = {}) {
  const r = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const footprint = { x, y, radius: r, left: x - r, right: x + r, top: y - r, bottom: y + r, width: 2 * r, height: 2 * r };
  const cloud = { left: x - 1.16 * r, right: x + 1.16 * r, top: y - 2.08 * r, bottom: y - .97 * r, width: 2.32 * r, height: 1.11 * r };
  const rain = { left: x - 1.22 * r, right: x + 1.16 * r, top: y - 1.16 * r, bottom: y + 1.45 * r, width: 2.38 * r, height: 2.61 * r };
  return { footprint, rain, cloud, left: rain.left, right: cloud.right, top: cloud.top, bottom: rain.bottom, width: rain.width, height: 3.53 * r };
}

/**
 * A cloud above, and a free-falling curtain around, one projected brush.
 * All geometry scales with radius. Uneven landing heights and a slight wind
 * let rain spill past the circle without a circular or rectangular cut-off.
 * On release use amount: 0, retain the released strength in tailAmount,
 * then lower tail from 1 to 0 over .8 seconds. tail controls the last drops'
 * downward clearing; tailAmount independently preserves their initial intensity.
 * Caller context state and global alpha are preserved. time is in seconds.
 * rainColor can adapt drop contrast on dark surfaces; the map keeps its blue.
 */
export function drawBrushRain(ctx, { x = 0, y = 0, radius = 0, time = 0, amount = 1, tail = 0, tailAmount = 1, seed = 7, rainColor = '#176db4' } = {}) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return;
  const active = clamp01(amount), released = clamp01(tail);
  const rain = Math.max(active, released * clamp01(tailAmount));
  const seconds = Number.isFinite(time) ? time : 0;
  const stableSeed = Number.isFinite(seed) ? seed : 7;
  ctx.save();
  ctx.translate(x, y); ctx.scale(radius, radius);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  if (rain > .001) {
    ctx.save();
    ctx.strokeStyle = rainColor;
    ctx.lineWidth = Math.max(.0225, .55 / radius);
    const inheritedAlpha = ctx.globalAlpha;
    // Columns start beneath the cloud and fall across the entire brush width.
    // Their independent landing heights soften the curtain's lower edge.
    for (let i = 0; i < 34; i++) {
      const column = -.985 + i / 33 * 1.97;
      const xx = Math.max(-.995, Math.min(.995, column + (random(i + 18, stableSeed) - .5) * .022));
      const startY = -1.025 + (random(i + 36, stableSeed) - .5) * .065;
      const landingY = .96 + random(i + 49, stableSeed) * .38;
      const wind = -.055 - random(i + 84, stableSeed) * .055;
      const speed = .9 + random(i + 25, stableSeed) * .65;
      for (let row = 0; row < 2; row++) {
        const phase = fract(seconds * speed + random(i + 13, stableSeed) + row * .5);
        if (!active && phase < 1 - released) continue;
        const yy = startY + phase * (landingY - startY);
        const fallX = xx + phase * wind;
        const length = .14 + random(i + row + 68, stableSeed) * .065;
        const entry = Math.min(1, phase / .07);
        const landing = Math.min(1, (1 - phase) / .14);
        ctx.globalAlpha = inheritedAlpha * rain * (.82 + .18 * rain) * entry * landing;
        ctx.beginPath();
        ctx.moveTo(fallX + .014, yy - length * .5);
        ctx.lineTo(fallX - .014, yy + length * .5);
        ctx.stroke();
        if (phase > .90 && i % 3 === 0) {
          ctx.globalAlpha = inheritedAlpha * rain * (1 - phase) * 4.5;
          const splashX = xx + wind, splashY = landingY;
          ctx.beginPath();
          ctx.moveTo(splashX - .025, splashY); ctx.lineTo(splashX - .065, splashY - .05);
          ctx.moveTo(splashX + .025, splashY); ctx.lineTo(splashX + .065, splashY - .05);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // Bottom of the cloud meets the top of the footprint. The shape spans the
  // circle's full diameter, including a little overhang on either side.
  const bob = Math.sin(seconds * 1.5) * .014;
  ctx.save(); ctx.translate(0, bob);
  ctx.scale(1 + rain * .012, 1 - rain * .012);
  const idle = [231, 233, 228], pouring = [214, 219, 214];
  ctx.fillStyle = `rgb(${idle.map((channel, i) => Math.round(channel + (pouring[i] - channel) * rain)).join(',')})`;
  ctx.strokeStyle = palette.ink; ctx.lineWidth = Math.max(.015, .4 / radius);
  ctx.beginPath(); ctx.moveTo(-.82, -1.03);
  ctx.bezierCurveTo(-1.08, -1.03, -1.13, -1.31, -.89, -1.39);
  ctx.bezierCurveTo(-.96, -1.63, -.67, -1.79, -.47, -1.65);
  ctx.bezierCurveTo(-.40, -1.97, .09, -2.00, .25, -1.70);
  ctx.bezierCurveTo(.48, -1.86, .78, -1.70, .77, -1.49);
  ctx.bezierCurveTo(1.09, -1.54, 1.20, -1.27, 1.01, -1.10);
  ctx.bezierCurveTo(.95, -1.03, .87, -1.03, .79, -1.03);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#a8afa8'; ctx.lineWidth = Math.max(.009, .3 / radius);
  ctx.beginPath(); ctx.moveTo(-.82, -1.35); ctx.bezierCurveTo(-.72, -1.40, -.61, -1.36, -.58, -1.28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-.36, -1.65); ctx.bezierCurveTo(-.23, -1.72, -.06, -1.68, 0, -1.58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(.53, -1.36); ctx.bezierCurveTo(.62, -1.43, .74, -1.38, .76, -1.30); ctx.stroke();
  ctx.restore();
  ctx.restore();
}
