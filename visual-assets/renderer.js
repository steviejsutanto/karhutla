/**
 * Wildfire performance — transparent, deterministic Canvas 2D assets.
 * Coordinates and time are independent of the simulation. Time is in seconds.
 * All painting is contained inside the requested rectangle; caller state is restored.
 */
export const palette = Object.freeze({
  paper: '#faf9f5', ink: '#333632', leaf: '#73766a', leafLight: '#989b8d',
  earth: '#b9b7aa', ash: '#c5c3bc', charcoal: '#393b38', smoke: '#8e938e',
  fire: '#a44832', flame: '#ca7544', ember: '#ba852b', rain: '#548fb7',
  rainDark: '#397ca7', cloud: '#e7e9e4', cloudDark: '#d6dbd6',
});

const clamp = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const fract = n => n - Math.floor(n);
const random = (n, seed = 1) => fract(Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123);
const mix = (a, b, t) => {
  const aa = a.match(/[\da-f]{2}/gi).map(v => parseInt(v, 16));
  const bb = b.match(/[\da-f]{2}/gi).map(v => parseInt(v, 16));
  return `rgb(${aa.map((v, i) => Math.round(lerp(v, bb[i], clamp(t)))).join(',')})`;
};

function path(ctx, coordinates, close = false) {
  ctx.beginPath();
  coordinates.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  if (close) ctx.closePath();
}

function prepare(ctx, x, y, width, height, background) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  if (background) { ctx.fillStyle = typeof background === 'string' ? background : palette.paper; ctx.fillRect(x, y, width, height); }
  ctx.translate(x, y); ctx.scale(width / 640, height / 360);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

function tree(ctx, x, base, scale, damage, index, seed) {
  ctx.save(); ctx.translate(x, base); ctx.scale(scale, scale);
  const bend = (random(index + 80, seed) - .5) * 8;
  ctx.fillStyle = mix('#6e6658', palette.charcoal, smooth(0, .7, damage));
  path(ctx, [[-7, 0], [-4, -49], [-3 + bend, -107], [2 + bend, -113], [5, -57], [9, 0]], true); ctx.fill();
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 4.5;
  path(ctx, [[-1, -48], [-24, -73], [-31, -97]]); ctx.stroke();
  path(ctx, [[2, -68], [24, -88], [32, -109]]); ctx.stroke();
  ctx.lineWidth = 2.3;
  path(ctx, [[-21, -70], [-36, -73], [-44, -85]]); ctx.stroke();
  path(ctx, [[17, -83], [36, -87], [43, -96]]); ctx.stroke();
  path(ctx, [[bend, -94], [13 + bend, -110], [16 + bend, -127]]); ctx.stroke();
  // Crown edges are broad and irregular, rather than conifer triangles.
  const foliage = 1 - smooth(.06, .87, damage);
  if (foliage > 0) {
    ctx.globalAlpha *= foliage;
    ctx.fillStyle = index % 2 ? palette.leafLight : palette.leaf;
    ctx.beginPath();
    ctx.moveTo(-52, -98); ctx.lineTo(-60, -117); ctx.lineTo(-49, -137);
    ctx.lineTo(-32, -139); ctx.lineTo(-25, -155); ctx.lineTo(-5, -160);
    ctx.lineTo(12, -149); ctx.lineTo(29, -153); ctx.lineTo(48, -137);
    ctx.lineTo(46, -119); ctx.lineTo(56, -109); ctx.lineTo(42, -94);
    ctx.lineTo(23, -95); ctx.lineTo(10, -85); ctx.lineTo(-13, -92);
    ctx.lineTo(-34, -88); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = palette.paper; ctx.globalAlpha *= .34; ctx.lineWidth = 1;
    path(ctx, [[-40, -119], [-22, -124], [-13, -137]]); ctx.stroke();
    path(ctx, [[12, -108], [22, -122], [37, -127]]); ctx.stroke();
  }
  ctx.restore();
}

function smoke(ctx, time, amount, seed, wind = 0) {
  if (amount <= .001) return;
  for (let i = 0; i < 18; i++) {
    const life = fract(time / (5.5 + random(i + 5, seed) * 3) + random(i + 120, seed));
    const origin = 130 + random(i + 14, seed) * 380;
    const xx = origin + Math.sin(life * 4.4 + i) * 14 + life * (18 + wind);
    const yy = 246 - life * (125 + random(i + 41, seed) * 85);
    const radius = 7 + life * 18 + random(i + 55, seed) * 5;
    const alpha = Math.sin(Math.PI * life) * amount;
    ctx.save(); ctx.translate(xx, yy);
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = palette.smoke; ctx.globalAlpha *= .11;
    ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.2, radius * .66, -.15, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha /= .11; ctx.globalAlpha *= .44;
    ctx.strokeStyle = palette.smoke; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-radius, radius * .18);
    ctx.bezierCurveTo(-radius * 1.27, -radius * .23, -radius * .25, -radius * .83, radius * .23, -radius * .44);
    ctx.bezierCurveTo(radius * .75, -radius * .82, radius * 1.24, -radius * .08, radius * .9, radius * .27);
    ctx.stroke();
    ctx.restore();
  }
}

function ground(ctx, damage, wetness, seed) {
  ctx.fillStyle = mix(palette.earth, palette.ash, damage);
  path(ctx, [[49, 267], [104, 255], [177, 259], [229, 248], [307, 257], [393, 249], [470, 260], [547, 255], [589, 273], [577, 294], [510, 320], [401, 331], [298, 324], [196, 333], [99, 313], [57, 290]], true); ctx.fill();
  ctx.strokeStyle = '#93958b'; ctx.lineWidth = 1;
  path(ctx, [[49, 267], [104, 255], [177, 259], [229, 248], [307, 257], [393, 249], [470, 260], [547, 255], [589, 273]]); ctx.stroke();
  ctx.fillStyle = mix('#939687', '#7b7c73', damage);
  path(ctx, [[57, 290], [140, 306], [248, 299], [351, 307], [471, 300], [577, 294], [510, 320], [401, 331], [298, 324], [196, 333], [99, 313]], true);
  ctx.globalAlpha *= .3; ctx.fill(); ctx.globalAlpha /= .3;
  for (let i = 0; i < 57; i++) {
    const xx = 82 + random(i + 300, seed) * 473;
    const yy = 272 + random(i + 420, seed) * 40;
    ctx.strokeStyle = i % 4 === 0 ? '#f0eee6' : mix('#858779', '#575a53', damage);
    ctx.lineWidth = i % 5 === 0 ? 2.3 : 1.1;
    path(ctx, [[xx, yy], [xx + 3 + random(i + 500, seed) * 7, yy - random(i + 600, seed) * 3]]); ctx.stroke();
  }
  // Persistent charcoal scatters and broken logs make “out” visibly burned.
  ctx.strokeStyle = palette.charcoal; ctx.lineWidth = 6;
  path(ctx, [[193, 284], [227, 276], [249, 278]]); ctx.stroke();
  ctx.lineWidth = 3;
  path(ctx, [[221, 278], [227, 268], [239, 265]]); ctx.stroke();
  path(ctx, [[387, 299], [418, 286], [441, 290]]); ctx.stroke();
  ctx.lineWidth = 1.3;
  path(ctx, [[410, 290], [410, 282], [420, 274]]); ctx.stroke();
  ctx.strokeStyle = '#e5e2d6'; ctx.lineWidth = .8;
  path(ctx, [[199, 283], [224, 277]]); ctx.stroke();
  if (wetness > .005) {
    ctx.save(); ctx.globalAlpha *= wetness * .65; ctx.strokeStyle = palette.rain; ctx.lineWidth = 1.3;
    for (let i = 0; i < 10; i++) {
      const xx = 105 + random(i + 881, seed) * 425, yy = 278 + random(i + 889, seed) * 28;
      path(ctx, [[xx, yy], [xx + 12, yy]]); ctx.stroke();
    }
    ctx.restore();
  }
}

/** Draw a forest-and-land patch. Explicit progress: 0 fire, .55 embers, 1 out. */
export function drawForest(ctx, options = {}) {
  const { x = 0, y = 0, width = 640, height = 360, time = 0, heat = 1,
    surfaceWetness = 0, extinguished = false, smokeTail = 0, background = false, seed = 11 } = options;
  const suppliedProgress = Number.isFinite(options.progress);
  const progress = suppliedProgress ? clamp(options.progress) : extinguished ? 1 : .9 * (1 - clamp(heat) * (1 - .95 * clamp(surfaceWetness)));
  const wetness = clamp(surfaceWetness);
  const activity = clamp(heat) * (1 - .95 * wetness);
  const flame = suppliedProgress ? 1 - smooth(.03, .50, progress) : extinguished ? 0 : smooth(.10, .78, activity);
  const ember = suppliedProgress ? (1 - smooth(.58, 1, progress)) * (.28 + .72 * smooth(.02, .48, progress)) : extinguished ? 0 : clamp(heat) * (.35 + .65 * (1 - flame));
  const residualSmoke = suppliedProgress ? progress < 1 ? lerp(.68, .15, smooth(.50, 1, progress)) : 0 : extinguished ? 0 : clamp(heat) * .68;
  const smokeAmount = Math.max(residualSmoke, clamp(smokeTail) * (suppliedProgress ? .15 : clamp(heat) * .68));
  prepare(ctx, x, y, width, height, background);
  // Rear silhouettes are deliberately quiet so surface flames remain readable.
  // This is an already burned forest. Cooling never regenerates its canopy,
  // and reheating never restores leaves or clears its charcoal.
  tree(ctx, 198, 257, .65, 1, 4, seed);
  tree(ctx, 432, 258, .70, 1, 5, seed);
  ground(ctx, 1, wetness, seed);
  tree(ctx, 127, 274, .94, 1, 0, seed);
  tree(ctx, 293, 270, 1.03, 1, 1, seed);
  tree(ctx, 510, 277, .88, 1, 2, seed);
  tree(ctx, 375, 279, .59, 1, 3, seed);
  // Fire never reaches the crowns: its motion is confined to the forest floor.
  for (let i = 0; i < 24; i++) {
    const xx = 93 + i * 19 + random(i + 25, seed) * 12;
    const yy = 274 + random(i + 45, seed) * 16;
    const pulse = .78 + .22 * Math.sin(time * (5 + random(i + 59, seed) * 4) + i * 1.7);
    const hh = (14 + random(i + 70, seed) * 30) * flame * pulse;
    const ww = 6 + random(i + 80, seed) * 7;
    if (ember > .001) {
      ctx.save(); ctx.globalAlpha *= ember * (.6 + .4 * Math.sin(time * 2 + i) ** 2);
      ctx.strokeStyle = palette.ember; ctx.lineWidth = 2 + ember;
      path(ctx, [[xx - 3, yy], [xx + 3 + random(i + 64, seed) * 4, yy - 1]]); ctx.stroke();
      ctx.restore();
    }
    if (hh > .1) {
      const sway = Math.sin(time * 5 + i) * 4 * flame;
      ctx.fillStyle = mix(palette.flame, palette.fire, random(i + 77, seed));
      ctx.beginPath(); ctx.moveTo(xx - ww, yy);
      ctx.bezierCurveTo(xx - ww * 1.1, yy - hh * .46, xx + sway - ww * .16, yy - hh * .7, xx + sway, yy - hh);
      ctx.bezierCurveTo(xx + ww * .6 + sway, yy - hh * .6, xx + ww * .85, yy - hh * .3, xx + ww, yy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = palette.ember;
      path(ctx, [[xx - ww * .4, yy], [xx + sway * .35, yy - hh * .45], [xx + ww * .45, yy]], true); ctx.fill();
    }
  }
  const sparks = Math.max(flame * .7, ember * .35);
  if (sparks > .001) {
    ctx.save(); ctx.fillStyle = palette.ember;
    const parentAlpha = ctx.globalAlpha;
    for (let i = 0; i < 10; i++) {
      const age = fract(time * (.22 + random(i + 201, seed) * .13) + random(i + 111, seed));
      ctx.globalAlpha = parentAlpha * sparks * Math.sin(age * Math.PI);
      const xx = 110 + random(i + 105, seed) * 420 + Math.sin(age * 3 + i) * 8;
      const yy = 272 - age * 56;
      ctx.fillRect(xx, yy, 1.5, 2.4);
    }
    ctx.restore();
  }
  smoke(ctx, time, smokeAmount, seed);
  ctx.restore();
}

/** Draw one cloud with rainfall. amount is active rain; tail lets released drops settle. */
export function drawCloudRain(ctx, options = {}) {
  const { x = 0, y = 0, width = 320, height = 300, time = 0, amount = 0,
    tail = 0, background = false, seed = 7 } = options;
  const active = clamp(amount), released = clamp(tail);
  prepare(ctx, x, y, width, height, background);
  const bob = Math.sin(time * 1.5) * (active ? 1.8 : 3.5);
  const cloudY = 80 + bob;
  // Every drop belongs to a fixed column; frame rate never changes its path.
  const rain = Math.max(active, released);
  if (rain > .001) {
    ctx.save(); ctx.strokeStyle = palette.rain; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 36; i++) {
      if (random(i + 210, seed) > .28 + active * .72 && !released) continue;
      const phase = fract(time * (1.15 + random(i + 25, seed) * .5) + random(i + 13, seed));
      // As a released tail reaches zero, the top clears first.
      if (!active && phase < 1 - released) continue;
      const xx = 201 + random(i + 18, seed) * 238;
      const yy = cloudY + 55 + phase * 168;
      ctx.globalAlpha *= rain * (.38 + rain * .6);
      path(ctx, [[xx + 3, yy], [xx, yy + 7 + rain * 4]]); ctx.stroke();
      ctx.globalAlpha /= rain * (.38 + rain * .6);
      if (phase > .87) {
        ctx.save(); ctx.globalAlpha *= (1 - phase) * 6 * rain;
        path(ctx, [[xx - 5, 315], [xx - 8, 312]]); ctx.stroke();
        path(ctx, [[xx + 4, 315], [xx + 7, 312]]); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }
  ctx.save(); ctx.translate(320, cloudY); ctx.scale(1 + active * .018, 1 - active * .035);
  ctx.fillStyle = active > .01 ? palette.cloudDark : palette.cloud;
  ctx.strokeStyle = palette.ink; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(-116, 48);
  ctx.bezierCurveTo(-152, 48, -157, 6, -124, -3);
  ctx.bezierCurveTo(-131, -36, -92, -58, -66, -38);
  ctx.bezierCurveTo(-56, -77, 10, -83, 27, -42);
  ctx.bezierCurveTo(56, -60, 93, -39, 91, -11);
  ctx.bezierCurveTo(133, -16, 157, 11, 139, 35);
  ctx.bezierCurveTo(133, 46, 124, 48, 111, 48);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#a8afa8'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(-115, 5); ctx.bezierCurveTo(-102, -2, -87, 3, -83, 14); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72, 4); ctx.bezierCurveTo(85, -5, 101, 1, 104, 12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-49, -35); ctx.bezierCurveTo(-31, -45, -7, -40, 0, -26); ctx.stroke();
  ctx.restore();
  if (rain > .001) {
    ctx.save(); ctx.globalAlpha *= rain * .45; ctx.strokeStyle = palette.rainDark; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.save();
      const pulse = fract(time * .8 + i * .24), xx = 220 + i * 65;
      ctx.globalAlpha *= Math.sin(pulse * Math.PI);
      ctx.beginPath(); ctx.ellipse(xx, 319, 3 + pulse * 13, .7 + pulse * 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  ctx.restore();
}
