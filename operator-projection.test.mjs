import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorMapScale, operatorMapRect, studyMapRect, countryPoint, countryGeo, countryInputAt, countryMapRect } from './country-view.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
const originalScale = (width, height, zoom) => Math.min((width - 65) / 49, (height - 90) / 22) * zoom;
function originalProject(width, height, [longitude, latitude], { zoom = 1, panX = 0, panY = 0 } = {}) {
  const scale = originalScale(width, height, zoom);
  return [width / 2 + (longitude - 118) * scale + panX, height / 2 - (latitude + 2.9) * scale + panY];
}

test('operator rectangles preserve the original geographic projection at every normal viewport and zoom', () => {
  const positions = [[94, 7], [142, -12], [118, -2.9], [96.2, 5.1], [114.7, -3.6], [140.5, -9.2]];
  for (const [width, height] of [[1440, 480], [1280, 720], [844, 260], [320, 500]]) {
    for (const options of [{}, { zoom: 1.6, panX: 41, panY: -23 }, { zoom: 4, panX: -200, panY: 125 }]) {
      const rect = operatorMapRect(width, height, options);
      const scale = operatorMapScale(width, height, options.zoom ?? 1);
      assert.equal(scale, originalScale(width, height, options.zoom ?? 1));
      assert.deepEqual(Object.keys(rect).sort(), ['height', 'width', 'x', 'y']);
      near(rect.width / 48, scale); near(rect.height / 19, scale);
      for (const position of positions) {
        const point = countryPoint(position), expected = originalProject(width, height, position, options);
        near(rect.x + point[0] * rect.width, expected[0]);
        near(rect.y + point[1] * rect.height, expected[1]);
      }
    }
  }
});

test('operator projection input returns the same geographic rain target after zoom and pan', () => {
  for (const [width, height] of [[1440, 480], [844, 260], [320, 500]]) {
    for (const options of [{}, { zoom: 2.4, panX: -60, panY: 33 }]) {
      const rect = operatorMapRect(width, height, options);
      for (const position of [[96.2, 5.1], [118, -2.9], [140.5, -11.5]]) {
        const pixel = originalProject(width, height, position, options);
        const input = countryInputAt(rect, ...pixel), point = countryPoint(position);
        near(input[0], point[0]); near(input[1], point[1]);
        const geographic = countryGeo(input);
        near(geographic[0], position[0]); near(geographic[1], position[1]);
      }
    }
  }
});

test('tiny or not-yet-measured operator viewports retain finite positive map dimensions', () => {
  for (const [width, height] of [[0, 0], [30, 60], [65, 90], [Number.NaN, Infinity]]) {
    assert.ok(Number.isFinite(operatorMapScale(width, height)) && operatorMapScale(width, height) > 0);
    const rect = operatorMapRect(width, height);
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.width > 0 && rect.height > 0);
  }
});

test('phone map fitting retains its previous centered country rectangle', () => {
  assert.deepEqual(countryMapRect(480, 190), { x: 0, y: 0, width: 480, height: 190 });
  assert.deepEqual(countryMapRect(500, 300, 10), { x: 10, y: 55, width: 480, height: 190 });
  const portrait = countryMapRect(320, 500, 12);
  near(portrait.x, 12); near(portrait.y, 191.41666666666666);
  near(portrait.width, 296); near(portrait.height, 117.16666666666667);
  assert.notDeepEqual(operatorMapRect(500, 300), countryMapRect(500, 300, 10), 'Main-display parity uses its separate helper.');
});

test('study framing fills its clear air with healthy complete-country margins', () => {
  for (const [width, height] of [[968,335],[1119,278],[1440,480],[1280,720],[844,260],[320,500]]) {
    const rect = studyMapRect(width,height), original = operatorMapRect(width,height);
    const zoom = rect.width / original.width;
    assert.ok(zoom > 1, 'Only the study receives the larger country fit.');
    near(rect.width / rect.height, 48 / 19);
    near(rect.x + rect.width / 2, width / 2); near(rect.y + rect.height / 2, height / 2);
    assert.ok(rect.x >= 24 && rect.y >= 24);
    assert.ok(width - rect.x - rect.width >= 24 && height - rect.y - rect.height >= 24);
    for (const [u,v] of [[0,0],[0,1],[1,0],[1,1]]) {
      const x = rect.x + u * rect.width, y = rect.y + v * rect.height;
      assert.ok(x >= 24 && x <= width - 24 && y >= 24 && y <= height - 24,
        'Even the enclosing 94–142 / 7–−12 frame must remain inside the stage.');
    }
  }
  for (const [width,height] of [[968,335],[1119,278]]) {
    const rect = studyMapRect(width,height);
    assert.ok(rect.height >= height * .75, 'The country uses the available air while keeping room around the islands.');
    near(rect.y, height - rect.y - rect.height);
  }
});

test('study rain navigation round-trips through the closer country frame without changing geography', () => {
  for (const [width,height] of [[968,335],[1119,278],[320,500],[75,60]]) {
    const rect = studyMapRect(width,height);
    for (const geographic of [[95,6],[141,-11],[118,-2.5],[114.7,-3.6]]) {
      const point = countryPoint(geographic), x = rect.x + point[0]*rect.width, y = rect.y + point[1]*rect.height;
      const input = countryInputAt(rect,x,y), roundTrip = countryGeo(input);
      near(input[0],point[0]); near(input[1],point[1]);
      near(roundTrip[0],geographic[0]); near(roundTrip[1],geographic[1]);
    }
    const center = countryPoint([118,-2.5]);
    near(rect.x+center[0]*rect.width,Math.max(1,width)/2);
    near(rect.y+center[1]*rect.height,Math.max(1,height)/2);
  }
});

test('tiny and unmeasured study stages retain a positive country fit without clipping', () => {
  for (const [width,height] of [[0,0],[1,1],[30,60],[65,90],[66,91],[Number.NaN,Infinity],[-5,-10]]) {
    const rect = studyMapRect(width,height);
    const safeWidth = Math.max(1,Number.isFinite(width)?width:1), safeHeight = Math.max(1,Number.isFinite(height)?height:1);
    assert.ok(Object.values(rect).every(Number.isFinite));
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x+rect.width <= safeWidth+1e-12 && rect.y+rect.height <= safeHeight+1e-12);
    near(rect.width/rect.height,48/19);
  }
});
