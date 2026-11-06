import test from 'node:test';
import assert from 'node:assert/strict';
import { circularLoopBuffer, WildfireSound } from '../app/sound-engine.js';

const context = {
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: channel => data[channel] };
  },
};

function rainWithSilentTail({ quietInterior = false } = {}) {
  const rate = 8000, buffer = context.createBuffer(2, 30 * rate, rate);
  let seed = 771;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      // The restored heavy-rain master is quiet from about 29.3 s onwards.
      const level = index >= 29.3 * rate ? .00001 : quietInterior && index >= 12 * rate && index < 12.3 * rate ? .0001 : .12;
      data[index] = (seed / 2147483648 - 1) * level;
    }
  }
  return buffer;
}

function rms(buffer, start, seconds = .1) {
  let power = 0, count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = Math.round(start * buffer.sampleRate); index < (start + seconds) * buffer.sampleRate; index++) {
      power += data[((index % buffer.length) + buffer.length) % buffer.length] ** 2;
      count++;
    }
  }
  return Math.sqrt(power / count);
}

function assertSteadyJoin(buffer) {
  const reference = rms(buffer, 2, 1);
  for (let start = buffer.duration - .8; start < buffer.duration + .3; start += .02) {
    assert.ok(rms(buffer, start) > reference * .86, 'The loop join must not repeat the silent recording tail.');
    assert.ok(rms(buffer, start) < reference * 1.14, 'The join must not replace the dip with a level bump.');
  }
}

test('rain removes an embedded 700 ms silent tail before its native loop crossfade', () => {
  const input = rainWithSilentTail(), untouched = input.getChannelData(0).slice();
  const output = circularLoopBuffer(context, input, { naturalRain: true });
  assertSteadyJoin(output);
  assert.deepEqual(input.getChannelData(0), untouched, 'Loop conditioning must not modify the restored recording.');
});

test('Main rain decode uses the tail repair while preserving quiet passages inside the recording', t => {
  const engine = new WildfireSound({ mode: 'operator', document: null });
  t.after(() => { engine.context = null; engine.destroy(); });
  engine.context = context;
  const prepared = engine._prepareBuffer(rainWithSilentTail({ quietInterior: true }), 'rain');
  assertSteadyJoin(prepared);
  assert.ok(rms(prepared, 12 - .55, .2) < rms(prepared, 2) * .01, 'Natural quiet passages inside the storm are retained.');
});

test('rain trimming remains bounded and cricket phrasing keeps its existing short join', () => {
  const input = rainWithSilentTail();
  input.getChannelData(0).fill(0, 24 * input.sampleRate);
  input.getChannelData(1).fill(0, 24 * input.sampleRate);
  const bounded = circularLoopBuffer(context, input, { naturalRain: true });
  assert.ok(bounded.duration >= input.duration - 2.6, 'A quiet recording cannot lose an unbounded amount of material.');
  const cricket = circularLoopBuffer(context, input, { cricket: true, naturalRain: true });
  assert.equal(cricket.duration, input.duration - .025, 'Rain repair does not erase insect rests.');
});
