import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceHeat, SURFACE_HEAT_MAX_TIP_MOTION, MAP_HEAT_MAX_TIP_MOTION,
  surfaceHeatPose, mapHeatPose, selectHeatSites } from './visual-assets/surface-heat.js';

const bounds = Object.freeze({ x: 30, y: 40, width: 1200, height: 500 });

function islandSites() {
  const islands = [[.08, .45, 300], [.3, .65, 48], [.42, .25, 48], [.6, .42, 48], [.88, .52, 48]];
  return Object.freeze(islands.flatMap(([u, v, count], island) => Array.from({ length: count }, (_, index) => Object.freeze({
    id: `${island}:${index}`, island,
    x: bounds.x + u * bounds.width + (index % 8) * 3,
    y: bounds.y + v * bounds.height + Math.floor(index / 8) * 2,
    activity: .7 + index % 5 * .05, ember: .4, calm: 0,
  }))));
}

function binOf(site) {
  return `${Math.min(23, Math.floor((site.x - bounds.x) / bounds.width * 24))}:${Math.min(11, Math.floor((site.y - bounds.y) / bounds.height * 12))}`;
}

function imageContext() {
  const stack = [];
  return {
    matrix: [1, 0, 0, 1, 0, 0], images: [], globalAlpha: 1,
    save() { stack.push({ matrix: [...this.matrix], globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); },
    transform(a, b, c, d, e, f) {
      const [ma, mb, mc, md, me, mf] = this.matrix;
      this.matrix = [ma * a + mc * b, mb * a + md * b, ma * c + mc * d, mb * c + md * d,
        ma * e + mc * f + me, mb * e + md * f + mf];
    },
    drawImage(...args) { this.images.push({ args, matrix: [...this.matrix], alpha: this.globalAlpha }); },
  };
}

function imagePoint({ args, matrix }, u, v) {
  const [dx, dy, width, height] = args.slice(5), [a, b, c, d, e, f] = matrix;
  const x = dx + width * u, y = dy + height * v;
  return [a * x + c * y + e, b * x + d * y + f];
}

function nearPoint(actual, expected, message) {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-8,
    `${message}: received ${actual}, expected ${expected}`);
}

function drawGeometry(images) {
  return images.map(({ args, matrix }) => ({ source: args.slice(1, 5), destination: args.slice(5), matrix }));
}

function mapRenderer() {
  const renderer = new SurfaceHeat();
  // Exercise real cropping and affine transforms without a DOM/bitmap decode.
  renderer.image = Object.freeze({ width: 768, height: 384 });
  return renderer;
}

function mapFrame(renderer, context, sites, now, options = {}) {
  context.images.length = 0;
  const stats = { ...renderer.drawSites(context, { sites, now, ...options }) };
  return { stats, images: [...context.images] };
}

const oneSite = (overrides = {}) => Object.freeze({ id: 'one-source', x: 200.25, y: 140.75,
  activity: 1, ember: .4, calm: 0, ...overrides });

function sideOptions(overrides = {}) {
  return { width: 1000, height: 400, activity: new Float32Array(120).fill(1),
    embers: new Float32Array(120).fill(.4), calm: new Float32Array(120),
    surfaceAt: x => 110 + Math.sin(x * 11) * 3, ...overrides };
}

function sideFrame(renderer, context, now, options) {
  context.images.length = 0;
  return { stats: { ...renderer.draw(context, { now, ...options }) }, images: context.images };
}

test('side surface heat holds every source anchor while curl stays within 3.5 CSS pixels', () => {
  assert.equal(SURFACE_HEAT_MAX_TIP_MOTION, 3.5);
  for (const scale of [.5, 1, 1.5, 2]) {
    for (let step = 0; step < 720; step++) {
      const pose = surfaceHeatPose({ x: 17.25, y: 91.75, height: 40 * scale,
        phase: step * .07, restless: 1, calm: 0, scale });
      assert.equal(pose.anchorX, 17.25); assert.equal(pose.anchorY, 91.75);
      assert.equal(pose.anchorDrift, 0);
      assert.ok(Math.abs(pose.tipOffsetX) <= 3.5 * scale + 1e-12);
      assert.ok(pose.heightStretch >= .89 && pose.heightStretch <= 1.11);
      assert.ok(pose.heightBreath <= .11); assert.equal(pose.bands.length, 4);
      nearPoint([pose.bands[2].bottomX, pose.bands[2].bottomY], [0, 0], 'Side texture keeps its source base fixed');
      nearPoint([pose.bands[3].topX, pose.bands[3].topY], [0, 0], 'Lower side texture starts at that same fixed base');
    }
  }
});

test('reduced motion removes all deformation and local calm reduces the tip range', () => {
  for (const phase of [0, 1, 10, 10000]) {
    const still = surfaceHeatPose({ x: 41, y: 83, height: 18, restless: 1, phase, reducedMotion: true });
    assert.equal(Math.abs(still.tipOffsetX), 0); assert.equal(Math.abs(still.tipOffsetY), 0);
    assert.equal(still.maxTipMotion, 0); assert.equal(still.stretch, 1);
    assert.equal(Math.abs(still.shear), 0); assert.equal(still.anchorDrift, 0);
    const dry = surfaceHeatPose({ restless: 1, phase });
    const calm = surfaceHeatPose({ restless: 1, calm: 1, phase });
    assert.ok(calm.maxTipMotion < dry.maxTipMotion * .1);
  }
});

test('map deformation moves the bright body while every band joins and the source base stay fixed', () => {
  assert.equal(MAP_HEAT_MAX_TIP_MOTION, 2);
  for (const scale of [.5, 1, 1.5, 2]) for (let step = 0; step < 100; step++) {
    const pose = mapHeatPose({ x: 17.25, y: 91.75, height: 30 * scale,
      phase: step * .17, restless: 1, scale });
    assert.equal(pose.anchorX, 17.25); assert.equal(pose.anchorY, 91.75); assert.equal(pose.anchorDrift, 0);
    assert.equal(pose.bands.length, 4);
    assert.ok(pose.heightStretch >= .935 && pose.heightStretch <= 1.065);
    assert.ok(pose.heightBreath <= .065); assert.ok(pose.maxTipMotion <= 2);
    for (const band of pose.bands) {
      assert.ok(Math.abs(band.topX) <= 2 * scale + 1e-12);
      assert.ok(Math.abs(band.bottomX) <= 2 * scale + 1e-12);
      assert.ok(band.bottomY > band.topY);
    }
    for (let index = 0; index < 3; index++) {
      assert.equal(pose.bands[index].sourceBottom, pose.bands[index + 1].sourceTop);
      assert.equal(pose.bands[index].bottomX, pose.bands[index + 1].topX);
      assert.equal(pose.bands[index].bottomY, pose.bands[index + 1].topY);
    }
    assert.equal(pose.bands[2].sourceBottom, .82);
    nearPoint([pose.bands[2].bottomX, pose.bands[2].bottomY], [0, 0], 'The upper texture ends at its fixed source base');
    nearPoint([pose.bands[3].topX, pose.bands[3].topY], [0, 0], 'The lower texture starts at its fixed source base');
    assert.equal(pose.bands[3].bottomX, 0);
  }
});

test('real side atlas bands animate the luminous body while keeping every ground base and band join fixed', () => {
  const renderer = mapRenderer(), context = imageContext(), options = sideOptions();
  const before = [...options.activity], frameBodies = [];
  let initialGeometry, bodyTravel = 0, frameTravel = 0, previousBodies, phaseRate = 0;
  for (let frame = 0; frame <= 24; frame++) {
    const result = sideFrame(renderer, context, frame * 1000 / 24, options);
    assert.equal(result.stats.visibleEmitters, renderer.emitters.length);
    assert.equal(result.images.length, renderer.emitters.length * 4);
    assert.equal(result.stats.textureDraws, result.images.length);
    assert.ok(result.stats.maxTipMotion <= 3.5); assert.ok(result.stats.maxHeightBreath <= .11);
    const bodies = renderer.emitters.map((emitter, index) => {
      const bands = result.images.slice(index * 4, index * 4 + 4);
      const source = [emitter.x * options.width, options.surfaceAt(emitter.x)];
      const tileTop = Math.floor(bands[0].args[2] / 192) * 192, rows = [0, .45, .68, .82, 1];
      for (let band = 0; band < 4; band++) {
        assert.ok(Math.abs(bands[band].args[2] - tileTop - rows[band] * 192) < 1e-9);
        assert.ok(Math.abs(bands[band].args[4] - (rows[band + 1] - rows[band]) * 192) < 1e-9);
      }
      for (let band = 0; band < 3; band++) for (const edge of [0, 1]) {
        nearPoint(imagePoint(bands[band], edge, 1), imagePoint(bands[band + 1], edge, 0),
          'Side texture strips join at both actual vertices');
      }
      nearPoint(imagePoint(bands[2], .5, 1), source, 'The upper moving side texture ends at its actual ground location');
      nearPoint(imagePoint(bands[3], .5, 0), source, 'The lower side texture starts at that same ground location');
      const body = imagePoint(bands[1], .5, 1);
      if (frame === 0) frameBodies[index] = body;
      bodyTravel = Math.max(bodyTravel, Math.hypot(body[0] - frameBodies[index][0], body[1] - frameBodies[index][1]));
      if (previousBodies) frameTravel = Math.max(frameTravel,
        Math.hypot(body[0] - previousBodies[index][0], body[1] - previousBodies[index][1]));
      return body;
    });
    if (frame === 0) initialGeometry = drawGeometry(result.images);
    if (frame === 24) assert.notDeepEqual(drawGeometry(result.images), initialGeometry,
      'The side changes actual texture transforms rather than only its opacity or a decorative statistic.');
    if (frame > 0) phaseRate = result.stats.phaseAdvance / renderer.emitters.length * 24;
    previousBodies = bodies;
  }
  assert.ok(bodyTravel > 2.5, `Hot side fibres should visibly move through their bright body, received ${bodyTravel}`);
  assert.ok(frameTravel > .15 && frameTravel < .3, 'Side motion is visible and smooth between 24fps frames.');
  assert.ok(phaseRate >= 1.5 && phaseRate <= 1.9);
  assert.deepEqual([...options.activity], before);
});

test('map movement stays quieter than the side and below the previous map movement profile', () => {
  const side = mapRenderer(), map = mapRenderer(), context = imageContext(), options = sideOptions(), site = oneSite();
  let sideMaximumStep = 0, mapMaximumStep = 0, sidePrevious, mapPrevious;
  for (let frame = 0; frame <= 24; frame++) {
    const now = frame * 1000 / 24;
    const surface = sideFrame(side, context, now, options);
    const sideBodies = side.emitters.map((_, index) => imagePoint(surface.images[index * 4 + 1], .5, 1));
    if (sidePrevious) sideBodies.forEach((point, index) => {
      sideMaximumStep = Math.max(sideMaximumStep, Math.hypot(point[0] - sidePrevious[index][0], point[1] - sidePrevious[index][1]));
    });
    const country = mapFrame(map, context, [site], now), mapBody = imagePoint(country.images[1], .5, 1);
    if (mapPrevious) mapMaximumStep = Math.max(mapMaximumStep, Math.hypot(mapBody[0] - mapPrevious[0], mapBody[1] - mapPrevious[1]));
    if (frame > 0) {
      const sideRate = surface.stats.phaseAdvance / surface.stats.visibleEmitters * 24;
      const mapRate = country.stats.phaseAdvance * 24;
      assert.ok(mapRate <= 1.3 && sideRate >= 1.5 && mapRate < sideRate);
    }
    assert.ok(country.stats.maxTipMotion <= 2 && country.stats.maxTipMotion < surface.stats.maxTipMotion);
    assert.ok(country.stats.maxHeightBreath <= .065 && country.stats.maxHeightBreath < surface.stats.maxHeightBreath);
    sidePrevious = sideBodies; mapPrevious = mapBody;
  }
  assert.ok(mapMaximumStep < sideMaximumStep * .6,
    'The map should read as a quieter overview while the side surface visibly stirs.');
  assert.ok(MAP_HEAT_MAX_TIP_MOTION < 5 && map.siteStats.maxHeightBreath < .2,
    'The former 5px / 20% map movement cannot return.');
});

test('real side texture geometry freezes under reduced motion and settles under local rain', () => {
  const still = mapRenderer(), quiet = mapRenderer(), context = imageContext();
  const options = sideOptions(), rain = sideOptions({ calm: new Float32Array(120).fill(1) });
  const stillFirst = drawGeometry(sideFrame(still, context, 0, { ...options, reducedMotion: true }).images);
  const quietFirst = drawGeometry(sideFrame(quiet, context, 0, rain).images);
  for (const now of [100, 1000, 10000]) {
    const fixed = sideFrame(still, context, now, { ...options, reducedMotion: true });
    assert.deepEqual(drawGeometry(fixed.images), stillFirst);
    assert.equal(fixed.stats.phaseAdvance, 0); assert.equal(fixed.stats.shapeChange, 0);
    assert.equal(fixed.stats.maxTipMotion, 0); assert.equal(fixed.stats.maxHeightBreath, 0);
    const calm = sideFrame(quiet, context, now, rain);
    assert.deepEqual(drawGeometry(calm.images), quietFirst);
    assert.equal(calm.stats.shapeChange, 0); assert.equal(calm.stats.maxTipMotion, 0);
    assert.ok(calm.images.length > 0, 'Quiet rain retains the underlying ember texture.');
    assert.ok(calm.stats.phaseAdvance <= quiet.emitters.length * .15 * .1 + 1e-12);
  }
  const cold = sideOptions({ activity: new Float32Array(120), embers: new Float32Array(120) });
  const out = sideFrame(still, context, 10100, cold);
  assert.equal(out.stats.visibleEmitters, 0); assert.equal(out.stats.textureDraws, 0); assert.equal(out.images.length, 0);
});

test('the 192 map sprites cover every populated geographic bin before adding density', () => {
  const sites = islandSites(), before = JSON.stringify(sites);
  assert.equal(sites.length, 492);
  const selected = selectHeatSites(sites, 192, bounds);
  assert.equal(selected.length, 192);
  assert.deepEqual(new Set(selected.map(site => site.island)), new Set([0, 1, 2, 3, 4]),
    'Dense early sources cannot consume the whole budget on the western island.');
  assert.deepEqual(new Set(selected.map(binOf)), new Set(sites.map(binOf)));
  assert.deepEqual(selectHeatSites([...sites].reverse(), 192, bounds).map(site => site.id), selected.map(site => site.id),
    'Selection is deterministic and independent of incoming source order.');
  assert.ok(selected.every(site => sites.includes(site)), 'Selected coordinates retain their original source objects.');
  assert.equal(JSON.stringify(sites), before);
  assert.equal(selectHeatSites(sites, 1000000, bounds).length, 192, 'The decorative cap cannot be bypassed.');
});

test('extinguished and ember-only sites produce no surface flame selection', () => {
  const sites = Object.freeze([
    Object.freeze({ id: 'hot', x: 1, y: 2, activity: .8, ember: .4 }),
    Object.freeze({ id: 'out', x: 3, y: 4, activity: 1, ember: 1, extinguished: true }),
    Object.freeze({ id: 'ember', x: 5, y: 6, activity: 0, ember: 1 }),
    Object.freeze({ id: 'cold', x: 7, y: 8, activity: 0, ember: 0 }),
  ]);
  assert.deepEqual(selectHeatSites(sites).map(site => site.id), ['hot']);
  assert.deepEqual(selectHeatSites(sites, 0), []);
});

test('drawSites keeps the actual atlas base on its source across caller clocks and does not alter received state', () => {
  const renderer = mapRenderer(), context = imageContext(), sites = islandSites();
  const before = JSON.stringify(sites);
  const expected = selectHeatSites(sites, 192, bounds);
  let initial = null;
  for (const now of [0, 100, 10000, 86400000]) {
    const { stats, images } = mapFrame(renderer, context, sites, now, { bounds, scale: 1.5 });
    assert.equal(stats.visibleSites, 192); assert.equal(stats.locatedSites, 492);
    assert.equal(stats.anchorDrift, 0); assert.ok(stats.maxTipMotion <= 2);
    assert.equal(images.length, 192 * 4); assert.equal(stats.textureDraws, images.length);
    assert.ok(stats.drawSlots <= 192); assert.ok(stats.phaseAdvance <= 192 * .15 * 1.3);
    const bases = expected.map((site, index) => {
      const bands = images.slice(index * 4, index * 4 + 4);
      const rows = [0, .45, .68, .82, 1], tileHeight = 192;
      const tileTop = Math.floor(bands[0].args[2] / tileHeight) * tileHeight;
      for (let band = 0; band < 4; band++) {
        assert.ok(Math.abs(bands[band].args[2] - tileTop - rows[band] * tileHeight) < 1e-9,
          'Every drawn strip must start at the intended source-atlas row.');
        assert.ok(Math.abs(bands[band].args[4] - (rows[band + 1] - rows[band]) * tileHeight) < 1e-9,
          'Continuous source-atlas rows must reach the actual .82 base edge.');
      }
      for (let band = 0; band < 3; band++) for (const edge of [0, 1]) {
        nearPoint(imagePoint(bands[band], edge, 1), imagePoint(bands[band + 1], edge, 0),
          'Adjacent atlas bands join at both actual canvas vertices');
      }
      const source = [site.x, site.y];
      nearPoint(imagePoint(bands[2], .5, 1), source, 'Upper atlas base stays at its exact geographic source');
      nearPoint(imagePoint(bands[3], .5, 0), source, 'Lower atlas base stays at its exact geographic source');
      return imagePoint(bands[2], .5, 1);
    });
    if (initial) assert.deepEqual(bases, initial); else initial = bases;
  }
  assert.equal(JSON.stringify(sites), before, 'Rendering cannot change received heat, wetness, or coordinates.');
  const out = sites.map(site => ({ ...site, extinguished: true }));
  for (let step = 1; step <= 70; step++) mapFrame(renderer, context, out, 86400000 + step * 100, { bounds });
  assert.equal(renderer.siteStats.visibleSites, 0);
  assert.equal(renderer.siteMemory.size, 0);
});

test('map textures retain 24–36 CSS pixels of legible grain as heat fades', () => {
  const renderer = mapRenderer(), context = imageContext();
  const sites = Object.freeze([.02, .5, 1].map((activity, index) => Object.freeze({
    id: `legibility:${index}`, x: index * 100 + 50, y: 80, activity, ember: .4, calm: 0,
  })));
  for (const scale of [.5, 1, 1.5, 2]) {
    context.images.length = 0;
    renderer.drawSites(context, { sites, now: 100, scale });
    assert.equal(context.images.length, 3 * 4);
    for (const { args, alpha } of context.images) {
      // Each band retains the full tile width (the source tiles are square),
      // so this recovers nominal sprite height independently of its stretch.
      const cssHeight = args[7] / scale;
      assert.ok(cssHeight >= 24 && cssHeight <= 36,
        'Temperature changes opacity while retaining enough texture pixels for a country-wide map.');
      assert.ok(alpha > 0 && alpha <= .76, 'The larger map texture stays translucent.');
    }
  }
});

test('hot map fire changes image geometry gently through the bright body within one second', () => {
  const renderer = mapRenderer(), context = imageContext(), site = oneSite();
  const first = mapFrame(renderer, context, [site], 0);
  const firstBody = imagePoint(first.images[1], .5, 1);
  let bodyTravel = 0, shapeChange = 0, final, previousBody = firstBody, maximumFrameTravel = 0;
  for (let frame = 1; frame <= 24; frame++) {
    final = mapFrame(renderer, context, [site], frame * 1000 / 24);
    const body = imagePoint(final.images[1], .5, 1);
    bodyTravel = Math.max(bodyTravel, Math.hypot(body[0] - firstBody[0], body[1] - firstBody[1]));
    maximumFrameTravel = Math.max(maximumFrameTravel, Math.hypot(body[0] - previousBody[0], body[1] - previousBody[1]));
    previousBody = body;
    shapeChange += final.stats.shapeChange;
    nearPoint(imagePoint(final.images[2], .5, 1), [site.x, site.y], 'Moving bright grain retains its base every frame');
  }
  assert.ok(bodyTravel > .4, `Bright grain should keep subtle visible movement, received ${bodyTravel}`);
  assert.ok(bodyTravel < 4, 'Country-map motion remains quieter than the previous 4.7px body curl.');
  assert.ok(maximumFrameTravel < .13, 'A map flame moves gently between 24fps frames.');
  assert.ok(shapeChange > 0); assert.ok(final.stats.phaseAdvance > 0);
  assert.notDeepEqual(drawGeometry(final.images), drawGeometry(first.images), 'Movement changes image transforms, not only opacity.');
  assert.deepEqual(final.images.map(image => image.alpha), first.images.map(image => image.alpha),
    'Steady hot fire can animate without relying on blinking.');
});

test('reduced-motion map textures remain geometrically fixed and rain quiets the visible body', () => {
  const still = mapRenderer(), hot = mapRenderer(), quiet = mapRenderer(), context = imageContext(), site = oneSite();
  const firstStill = mapFrame(still, context, [site], 0, { reducedMotion: true });
  const quietSite = oneSite({ calm: 1 });
  mapFrame(hot, context, [site], 0); mapFrame(quiet, context, [quietSite], 0);
  const hotStart = imagePoint(mapFrame(hot, context, [site], 0).images[1], .5, 1);
  const quietStart = imagePoint(mapFrame(quiet, context, [quietSite], 0).images[1], .5, 1);
  let hotTravel = 0, quietTravel = 0;
  for (let frame = 1; frame <= 24; frame++) {
    const now = frame * 1000 / 24;
    const fixed = mapFrame(still, context, [site], now, { reducedMotion: true });
    assert.deepEqual(drawGeometry(fixed.images), drawGeometry(firstStill.images));
    assert.equal(fixed.stats.phaseAdvance, 0); assert.equal(fixed.stats.shapeChange, 0);
    const dry = mapFrame(hot, context, [site], now), wet = mapFrame(quiet, context, [quietSite], now);
    const dryBody = imagePoint(dry.images[1], .5, 1), wetBody = imagePoint(wet.images[1], .5, 1);
    hotTravel = Math.max(hotTravel, Math.hypot(dryBody[0] - hotStart[0], dryBody[1] - hotStart[1]));
    quietTravel = Math.max(quietTravel, Math.hypot(wetBody[0] - quietStart[0], wetBody[1] - quietStart[1]));
    assert.ok(wet.stats.maxTipMotion < dry.stats.maxTipMotion * .1);
    assert.ok(wet.stats.phaseAdvance < dry.stats.phaseAdvance * .1);
    nearPoint(imagePoint(wet.images[2], .5, 1), [site.x, site.y], 'Rain never displaces its source');
  }
  assert.ok(hotTravel > .4); assert.ok(quietTravel < hotTravel * .1);
});

test('accepted rain fades an existing texture monotonically and a still-hot return fades back in', () => {
  const renderer = mapRenderer(), context = imageContext(), dry = oneSite(), wet = oneSite({ activity: 0, ember: 1, calm: 1 });
  const initial = mapFrame(renderer, context, [dry], 0).images[0].alpha;
  let previous = initial, firstWet = 0;
  for (let frame = 1; frame <= 144; frame++) {
    const result = mapFrame(renderer, context, [wet], frame * 1000 / 24);
    const alpha = result.images[0]?.alpha ?? 0;
    if (frame === 1) {
      firstWet = alpha;
      assert.ok(result.stats.shapeMotion > 0,
        'The still-visible release tail must ease toward calm instead of snapping to an undeformed shape.');
    }
    assert.ok(alpha <= previous + 1e-12, 'Wet texture opacity must fade instead of popping or blinking.');
    previous = alpha;
    assert.ok(result.stats.drawSlots <= 1); assert.ok(result.stats.textureDraws <= 4);
  }
  assert.ok(firstWet > initial * .85, 'The first accepted wet frame retains a smooth release tail.');
  assert.equal(previous, 0); assert.equal(renderer.siteMemory.size, 0);
  let returnAlpha = 0;
  for (let frame = 1; frame <= 12; frame++) {
    const result = mapFrame(renderer, context, [dry], 6000 + frame * 1000 / 24);
    const alpha = result.images[0]?.alpha ?? 0;
    assert.ok(alpha >= returnAlpha - 1e-12, 'Returning heat enters with a continuous attack.');
    if (frame === 1) assert.ok(alpha > 0 && alpha < initial * .2, 'Returning heat does not appear at full opacity.');
    returnAlpha = alpha;
  }
  assert.ok(returnAlpha > initial * .7);
});

test('selection pressure retains a fading source within the same sprite budget before admitting a replacement', () => {
  const renderer = mapRenderer(), context = imageContext();
  const a = oneSite({ id: 'a', x: 50 }), b = oneSite({ id: 'b', x: 500 }), c = oneSite({ id: 'c', x: 950 });
  mapFrame(renderer, context, [a, b], 0, { bounds, maxSprites: 2 });
  const pressure = [{ ...a, activity: 0, calm: 1 }, b, c];
  const early = mapFrame(renderer, context, pressure, 1000 / 24, { bounds, maxSprites: 2 });
  assert.equal(early.stats.visibleSites, 2); assert.equal(early.stats.pendingSites, 1);
  assert.ok(renderer.siteMemory.has('a'), 'A retiring incumbent must not disappear at the cap boundary.');
  assert.equal(renderer.siteMemory.has('c'), false, 'A replacement waits for room in the same bounded budget.');
  nearPoint(imagePoint(early.images[2], .5, 1), [a.x, a.y], 'The retiring texture remains at its original source');
  for (let frame = 2; frame <= 144; frame++) {
    const result = mapFrame(renderer, context, pressure, frame * 1000 / 24, { bounds, maxSprites: 2 });
    assert.ok(result.stats.drawSlots <= 2); assert.ok(result.stats.visibleSites <= 2);
    assert.ok(result.stats.textureDraws <= 8); assert.ok(result.images.length <= 8);
  }
  assert.equal(renderer.siteMemory.has('a'), false); assert.ok(renderer.siteMemory.has('b')); assert.ok(renderer.siteMemory.has('c'));
});

test('explicit extinction releases only an existing tail and can never acquire a new fire texture', () => {
  const renderer = mapRenderer(), context = imageContext(), out = oneSite({ extinguished: true });
  assert.equal(mapFrame(renderer, context, [out], 0).images.length, 0);
  const live = oneSite();
  for (let frame = 1; frame <= 24; frame++) mapFrame(renderer, context, [live], frame * 1000 / 24);
  const before = renderer.siteMemory.get(live.id).opacity;
  const firstOut = mapFrame(renderer, context, [out], 1000 + 1000 / 24);
  assert.ok(firstOut.images[0].alpha > 0 && firstOut.images[0].alpha < before,
    'Explicit out releases its existing visual tail without creating a new emitter.');
  for (let frame = 2; frame <= 168; frame++) mapFrame(renderer, context, [out], 1000 + frame * 1000 / 24);
  assert.equal(renderer.siteMemory.size, 0);
  const settled = mapFrame(renderer, context, [out], 10000);
  assert.equal(settled.stats.visibleSites, 0); assert.equal(settled.stats.textureDraws, 0); assert.equal(settled.images.length, 0);
});

test('main map and section share a single atlas decode', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  let loads = 0, decodes = 0;
  class SyntheticImage {
    constructor() { this.width = 768; this.height = 384; }
    decode() { decodes++; return Promise.resolve(); }
    set src(value) { loads++; queueMicrotask(() => this.onload()); }
  }
  Object.defineProperty(globalThis, 'Image', { value: SyntheticImage, configurable: true, writable: true });
  try {
    const map = new SurfaceHeat({ imageUrl: 'synthetic-anchor-test-atlas' });
    const section = new SurfaceHeat({ imageUrl: 'synthetic-anchor-test-atlas' });
    await Promise.all([map.ready(), section.ready()]);
    assert.equal(loads, 1); assert.equal(decodes, 1);
    assert.equal(map.image, section.image);
    assert.equal(map.stats.assetLoaded, true); assert.equal(section.stats.assetLoaded, true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Image', descriptor);
    else delete globalThis.Image;
  }
});
