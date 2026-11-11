import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneWeatherAudio, BELL_NOTE_TRIM_DB, BELL_PARTIALS, bellPitchParameters } from '../app/phone-weather.js';
import {BELL_HARMONICS, OVERTONE_ROOT_HZ, overtonePitch} from '../app/overtone-scale.js';
import { nationalPhoneInteraction, peatPhonePatches } from '../app/peat-phone.js';
import { COUNTRY_BOUNDS, countryPoint } from '../app/country-view.mjs';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; this.automation = []; }
  cancelAndHoldAtTime(at) {
    const held = this.at(at); this.events.push(['hold', at]);
    this.automation = this.automation.filter(event => event[2] < at); this.automation.push(['set', held, at]);
  }
  cancelScheduledValues(at) { this.events.push(['cancel', at]); this.automation = this.automation.filter(event => event[2] < at); }
  _schedule(kind, value, at) { this.value = value; const event = [kind, value, at]; this.events.push(event); this.automation.push(event); }
  setValueAtTime(value, at) { this._schedule('set', value, at); }
  linearRampToValueAtTime(value, at) { this._schedule('linear', value, at); }
  exponentialRampToValueAtTime(value, at) { this._schedule('exponential', value, at); }
  at(time) {
    let from = 0, start = 0;
    for (const [kind, value, end] of this.automation) {
      if (!['set', 'linear', 'exponential'].includes(kind)) continue;
      if (time < end) {
        if (kind === 'set') return from;
        const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
        return kind === 'exponential' && from > 0 ? from * (value / from) ** progress : from + (value - from) * progress;
      }
      from = value; start = end;
    }
    return from;
  }
}
class Node {
  constructor(context, kind) {
    this.context = context; this.kind = kind; this.connections = []; this.disconnected = false;
    for (const name of ['gain', 'frequency', 'detune']) this[name] = new Parameter();
    context.nodes.push(this);
  }
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; this.disconnected = true; }
  start(at = 0) { this.startedAt = at; }
  stop(at = this.context.currentTime) { this.stoppedAt = at; this.context.stops.add(this); }
}
class Context {
  constructor(sampleRate = 48000) { this.sampleRate = sampleRate; this.currentTime = 0; this.nodes = []; this.stops = new Set(); this.destination = {}; this.decodes = 0; this.buffers = 0; }
  createGain() { return new Node(this, 'gain'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createBufferSource() { this.buffers++; return new Node(this, 'source'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createConvolver() {
    const node = new Node(this, 'convolver'); let buffer = null;
    Object.defineProperty(node, 'buffer', {
      get: () => buffer,
      set: value => {
        if (value && value.sampleRate !== this.sampleRate) throw new Error('Convolver buffer sample rate must match the context.');
        buffer = value;
      },
    });
    return node;
  }
  createBuffer(channels, frames, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return { numberOfChannels: channels, length: frames, sampleRate, duration: frames / sampleRate, getChannelData: index => data[index] };
  }
  decodeAudioData() { this.decodes++; throw new Error('Phones must never decode rain.'); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const node of [...this.stops]) if (node.stoppedAt <= this.currentTime && !node.ended) { node.ended = true; this.stops.delete(node); node.onended?.(); }
  }
}
const hot = (patchKey = 'a') => ({ holding: true, patchKey, extinguished: false });
const out = (patchKey = 'a') => ({ holding: true, patchKey, extinguished: true });
const released = () => ({ holding: false, patchKey: null, extinguished: false });
function fixture(t, sampleRate = 48000) {
  const context = new Context(sampleRate), requests = [];
  const weather = new PhoneWeatherAudio({ context, destination: context.destination, random:()=>Math.random(),
    fetchImpl: async url => { requests.push(url); throw new Error('Phones must never request rain.'); } });
  t.after(() => weather.destroy());
  return { context, weather, requests };
}
function audibleVoice(weather, context) {
  const voice = [...weather.bells].at(-1), at = context.currentTime + .029;
  assert.ok(voice, 'A real native voice exists for this bell edge.');
  assert.ok(voice.envelope.connections.includes(context.destination), 'The envelope reaches the parent phone master.');
  assert.ok(voice.envelope.gain.at(at) > voice.peak * .95, 'The newest envelope reaches its quiet peak before ringing down.');
  assert.ok(voice.oscillators.length > 0);
  for (let index = 0; index < voice.oscillators.length; index++) {
    const oscillator = voice.oscillators[index], level = voice.levels[index];
    assert.ok(oscillator.startedAt <= at && oscillator.stoppedAt > at, 'The oscillator is running while its envelope is audible.');
    const partial = voice.partials[index];
    assert.ok(oscillator.connections.includes(level));
    assert.ok(partial.motion ? level.connections.includes(partial.motion) && partial.motion.connections.includes(voice.envelope) : level.connections.includes(voice.envelope));
    assert.ok(level.gain.value > 0); assert.equal(oscillator.disconnected, false);
  }
  return voice;
}

test('phones never fetch, decode, allocate or play rain, including legacy source calls', async t => {
  const { weather, context, requests } = fixture(t);
  weather.setActive(true); weather.update(hot());
  assert.equal(await weather.setRainSource('/never-load-rain.mp3'), false);
  weather.update(released()); weather.setActive(false); weather.setActive(true);
  await Promise.resolve();
  assert.deepEqual(requests, []); assert.equal(context.decodes, 0); assert.equal(context.buffers, 0);
  assert.deepEqual(context.nodes, [], 'Idle and held hot ground need no native audio nodes.');
  assert.equal(weather.getMetrics().rainGain, 0); assert.equal(weather.getMetrics().rainLoopCount, 0);
  assert.equal(weather.getMetrics().loaded, false); assert.equal(weather.getMetrics().loading, false); assert.equal(weather.getMetrics().sourceUrl, null);
});

test('initial out state is silent, fresh out taps ring, packets and dragging into out stay silent', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  weather.update({ ...out('initial'), holding: false }); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(out('a')); audibleVoice(weather, context);
  for (let index = 0; index < 30; index++) weather.update(out('a'));
  weather.update(out('b')); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(hot('a')); weather.update(out('b'));
  assert.equal(weather.getMetrics().bellsTriggered, 1, 'Dragging to a different already-out patch never creates an extinction.');
  weather.update(hot('b')); weather.update(out('b')); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 2);
  weather.update(released()); weather.update(out('b')); assert.equal(weather.getMetrics().bellsTriggered, 3);
});

test('one uninterrupted hold rings for every actual hot-to-out transition, including reheated ground', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 30; index++) {
    const key = `fire-${index % 4}`;
    weather.update(hot(key)); weather.update(out(key)); weather.update(out(key));
    assert.equal(weather.getMetrics().bellsTriggered, index + 1);
    audibleVoice(weather, context); context.advance(.03);
  }
  weather.update(hot('restored')); weather.update(out('restored'));
  assert.equal(weather.getMetrics().bellsTriggered, 31); audibleVoice(weather, context);
});

test('100 rapid press-release gestures keep audible voices after extinction and resources bounded', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 100; index++) {
    weather.update(released()); weather.update(index % 2 ? hot('a') : out('a'));
    if (index % 2) weather.update(out('a'));
    assert.equal(weather.getMetrics().bellsTriggered, index + 1);
    audibleVoice(weather, context);
    assert.ok(weather.bells.size <= 8); assert.ok(weather.retiringBells.size <= 8);
    assert.ok(context.nodes.filter(node => node.kind === 'oscillator' && !node.disconnected).length <= 113);
    assert.equal(context.nodes.filter(node => node.kind === 'convolver' && !node.disconnected).length, 1, 'Every rapid tap shares one room.');
    context.advance(.03);
  }
  context.advance(16);
  assert.equal(weather.bells.size, 0); assert.equal(weather.retiringBells.size, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
  weather.update(released()); weather.update(out()); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 101, 'Natural cleanup never disables later bells.');
});

test('fresh taps across fully extinguished brush footprints keep ringing outside the tiny source cell', t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  const rows = [['440,-8', 110.125, -1.875, 0, true], ['443,-8', 110.875, -1.875, 0, true]];
  const patches = peatPhonePatches({ format: 'country-v1', bounds: COUNTRY_BOUNDS, cellSize: .25, patches: rows });
  for (let index = 0; index < 100; index++) {
    weather.update(released());
    const interaction = nationalPhoneInteraction(patches, countryPoint([index % 2 ? 111.2 : 110.3, -1.875]), { holding: true, eligible: true });
    assert.notEqual(interaction.patchKey, null, 'The rain brush still targets cooled sources.');
    weather.update(interaction); audibleVoice(weather, context); context.advance(.03);
  }
  assert.equal(weather.getMetrics().bellsTriggered, 100);
});

test('new bell strikes descend with extinction progress without changing a ringing bell', t => {
  const {weather,context}=fixture(t); weather.random=()=>.5; weather.setActive(true);
  weather.setExtinctionProgress(0); assert.equal(weather.ring({key:'early'}),true);
  const early=[...weather.bells][0], frequency=early.frequency;
  context.advance(.2); weather.setExtinctionProgress(1); assert.equal(weather.ring({key:'late'}),true);
  const late=[...weather.bells].at(-1);
  assert.ok(early.harmonic<=6 && late.harmonic<=3 && early.harmonic>late.harmonic);
  assert.equal(early.frequency,frequency); assert.equal(early.oscillators[0].frequency.value,frequency);
  const weights=weather.getMetrics().bellHarmonicWeights;
  assert.ok(weights[0].weight>weights.at(-1).weight*40);
  assert.ok(weights.every(value=>value.weight>0));
});

test('bells begin lower and finish their descent early while every harmonic remains possible', t => {
  const {weather}=fixture(t);
  const stages=[0,.1,.25,.45,1].map(fraction=>{
    weather.setExtinctionProgress(fraction);
    const metrics=weather.getMetrics(),weights=metrics.bellHarmonicWeights;
    assert.ok(weights.every(value=>value.weight>0));
    assert.ok(Math.abs(weights.reduce((sum,value)=>sum+value.weight,0)-1)<1e-12);
    return {profile:metrics.bellRegisterProgress,mean:weights.reduce((sum,value)=>sum+value.harmonic*value.weight,0)};
  });
  assert.ok(stages[0].mean<6,'The performance no longer starts with high-register bell choices.');
  assert.ok(stages[1].mean<stages[0].mean && stages[2].mean<stages[1].mean);
  assert.ok(stages[2].profile>.9,'A substantial lower-register bias is reached before a third of the fire is out.');
  assert.deepEqual(stages[3],stages[4],'The lower bell profile is reached by 45% global extinction.');
  weather.setExtinctionProgress(null);
  assert.equal(weather.getMetrics().bellRegisterProgress,.5,'Direct isolated auditions retain neutral access to all ten pitches.');
});

test('each exact harmonic from 2 through 11 has equal random odds in neutral auditions and a restrained register contour', t => {
  const {weather,context}=fixture(t), random=Math.random; weather.setActive(true);
  t.after(()=>{Math.random=random;});
  const heard=[],peaks=[],decays=[];
  for(let index=0;index<BELL_HARMONICS.length;index++){
    const harmonic=BELL_HARMONICS[index],pitch=overtonePitch(harmonic);
    Math.random=()=>(index+.5)/BELL_HARMONICS.length;
    weather.update(released());weather.update(out());
    const voice=audibleVoice(weather,context);heard.push(voice.harmonic);peaks.push(voice.peak);decays.push(voice.decaySeconds);
    assert.equal(voice.frequency,OVERTONE_ROOT_HZ*harmonic);
    assert.equal(voice.midi,pitch.midi);
    assert.equal(voice.oscillators[0].frequency.value,pitch.frequency);
    assert.ok(voice.envelope.gain.events.some(event=>event[0]==='linear'&&event[1]===voice.peak&&event[2]===voice.at+.008));
    assert.ok(voice.envelope.gain.events.some(event=>event[0]==='exponential'&&event[2]===voice.at+voice.decaySeconds));
    context.advance(16);
  }
  assert.deepEqual(heard,[2,3,4,5,6,7,8,9,10,11]);
  assert.equal(decays[0],12);assert.equal(decays.at(-1),8);
  assert.ok(decays.every((value,index)=>index===0||value<decays[index-1]));
  assert.ok(peaks.every((value,index)=>index===0||value<peaks[index-1]),'Higher modal bells are never boosted solely to equalize body energy.');
  assert.deepEqual(weather.getMetrics().bellHarmonics,heard);
  assert.deepEqual(weather.getMetrics().bellNoteTrimsDb,BELL_NOTE_TRIM_DB);
  assert.deepEqual(weather.getMetrics().bellPitchMidi,heard.map(h=>overtonePitch(h).midi));
  assert.deepEqual(weather.getMetrics().bellDecayRangeSeconds,[8,12]);
  assert.ok(!Number.isInteger(overtonePitch(7).midi)&&!Number.isInteger(overtonePitch(11).midi));
  const counts=new Map();
  for(let index=0;index<2000;index++){
    context.advance(16);Math.random=()=>(index+.5)/2000;
    weather.update(released());weather.update(out());
    const harmonic=weather.getMetrics().lastBellHarmonic;counts.set(harmonic,(counts.get(harmonic)??0)+1);
  }
  assert.deepEqual([...counts.values()],[200,200,200,200,200,200,200,200,200,200]);
  for(const invalid of [1,12,2.5,NaN])assert.throws(()=>bellPitchParameters(invalid),/2 to 11/);
});

test('a fast modal strike retains an inharmonic body instead of a long clean fundamental', t => {
  const {weather,context}=fixture(t),random=Math.random;Math.random=()=>0;t.after(()=>{Math.random=random;});
  weather.setActive(true);weather.update(out());
  const voice=audibleVoice(weather,context),envelope=voice.envelope.gain;
  assert.equal(voice.frequency,OVERTONE_ROOT_HZ*2);
  for(let index=0;index<BELL_PARTIALS.length;index++)assert.ok(Math.abs(voice.oscillators[index].frequency.value/voice.frequency-BELL_PARTIALS[index][0])<1e-12);
  assert.equal(envelope.at(0),0);assert.equal(envelope.at(.004),voice.peak/2);assert.equal(envelope.at(.008),voice.peak);
  assert.ok(Math.abs(envelope.at(.10)-voice.peak*.84)<1e-12);
  assert.ok(Math.abs(envelope.at(.55)-voice.peak*.42)<1e-12);
  assert.ok(envelope.at(2.5)>.005);assert.ok(envelope.at(5)>.0001);
  const fundamentalFraction=voice.levels[0].gain.at(6)/BELL_PARTIALS[0][1];
  for(const index of [1,2])assert.ok(voice.levels[index].gain.at(6)/BELL_PARTIALS[index][1]>fundamentalFraction*2,'Inharmonic resonances outlast the clean root.');
  weather.update(released());assert.equal(weather.getMetrics().currentBellVoices,1);
  assert.equal(voice.oscillators[0].stoppedAt,12.08,'Release preserves the finite natural tail.');
  assert.equal(envelope.at(12.07),0);context.advance(12.1);
  assert.equal(weather.getMetrics().currentBellVoices,0);assert.equal(weather.getMetrics().bellReverb.active,true);
  context.advance(3.3);assert.equal(weather.getMetrics().bellReverb.graphCount,0);assert.ok(context.nodes.every(node=>node.disconnected));
});

test('six static independently decaying modes replace the old audio-plus-LFO graph with fewer oscillators', t => {
  const {weather,context}=fixture(t);weather.setActive(true);weather.update(out());const voice=audibleVoice(weather,context);
  assert.equal(voice.oscillators.length,6);assert.equal(voice.modulators.length,0);assert.equal(voice.modulationNodes.length,0);
  assert.ok(context.nodes.every(node=>!voice.oscillators.some(oscillator=>node.connections.includes(oscillator.detune))),'No clean vibrato masks the strike.');
  assert.ok(BELL_PARTIALS.slice(1).filter(([ratio])=>Math.abs(ratio-Math.round(ratio))>.1).length>=4);
  const nodes=context.nodes.length;context.advance(7);assert.equal(context.nodes.length,nodes);
  weather.stop();context.advance(.041);assert.ok(voice.oscillators.every(node=>node.disconnected));
});

test('the darker modal spectrum keeps an inharmonic body with restrained upper energy and room headroom', () => {
  const strikeEnergy=BELL_PARTIALS.reduce((sum,[,amplitude])=>sum+amplitude**2,0);
  const upperEnergy=BELL_PARTIALS.filter(([ratio])=>ratio>3).reduce((sum,[,amplitude])=>sum+amplitude**2,0);
  const centroid=BELL_PARTIALS.reduce((sum,[ratio,amplitude])=>sum+ratio*amplitude**2,0)/strikeEnergy;
  assert.ok(upperEnergy/strikeEnergy>.08 && upperEnergy/strikeEnergy<.14,'Upper modes colour the sound without the previous bright edge.');
  assert.ok(centroid<1.9,'The body is darker than the former upper-partial-heavy spectrum.');
  assert.ok(BELL_PARTIALS.at(-1)[0]<7,'The final resonance stays below the previous very high mode.');
  assert.ok(BELL_PARTIALS.reduce((sum,[,amplitude])=>sum+amplitude,0)<=1.76+Number.EPSILON*4,
    'The darker dry spectrum leaves headroom for the increased room return.');
});

test('long low bell tails survive other strikes and bounded overflow always finishes its fade', t => {
  const { weather, context } = fixture(t), random = Math.random; Math.random = () => 0; t.after(() => { Math.random = random; });
  weather.setActive(true); assert.equal(weather.ring(), true); const first = [...weather.bells][0], originalStop = first.oscillators[0].stoppedAt;
  Math.random = () => .999;
  for (let index = 0; index < 7; index++) { context.advance(.15); assert.equal(weather.ring(), true); }
  assert.equal(first.oscillators[0].stoppedAt, originalStop, 'Seven subsequent strikes preserve the full earlier low tail.');
  assert.ok(first.envelope.gain.at(context.currentTime) > .01); assert.equal(first.disposed, undefined);
  for (let index = 0; index < 8; index++) assert.equal(weather.ring(), true);
  assert.equal(weather.bells.size, 8); assert.equal(weather.retiringBells.size, 8);
  const fading = [...weather.retiringBells], before = context.nodes.length;
  for (let index = 0; index < 1000; index++) assert.equal(weather.ring(), false);
  assert.equal(context.nodes.length, before, 'A burst cannot allocate beyond the bounded voices.');
  assert.equal(weather.getMetrics().bellsTriggered, 16);
  assert.ok(fading.every(voice => !voice.disposed), 'Saturation never disconnects a voice during its short release.');
  context.advance(.04); assert.ok(fading.every(voice => !voice.disposed));
  assert.ok(first.envelope.gain.at(context.currentTime) > 0);
  context.advance(.041); assert.ok(fading.every(voice => voice.disposed));
  assert.equal(weather.getMetrics().bellsTriggered, 16, 'Saturated strikes are consumed without a deferred replay.');
  assert.equal(weather.ring(), true); audibleVoice(weather, context);
  context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
});

test('the upper middle-register bell retains its metallic partials within every supported native bandwidth', t => {
  const random = Math.random; Math.random = () => .999; t.after(() => { Math.random = random; });
  for (const sampleRate of [22050, 32000, 48000, 96000]) {
    const { weather, context } = fixture(t, sampleRate); weather.setActive(true); weather.update(out());
    const voice = audibleVoice(weather, context);
    assert.equal(voice.harmonic, 11); assert.equal(voice.midi, overtonePitch(11).midi); assert.equal(voice.decaySeconds, 8); assert.equal(voice.peak, bellPitchParameters(11).peak);
    assert.ok(voice.oscillators.every(oscillator => oscillator.frequency.value < sampleRate * .45));
    assert.equal(voice.oscillators.length, 6);
    context.advance(12); assert.ok(context.nodes.every(node => node.disconnected));
  }
});

test('one static dark room has a longer useful late tail, bounded wet output and parent-master routing', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const room = weather.reverb, impulse = room.convolver.buffer, data = impulse.getChannelData(0);
  assert.equal(impulse.numberOfChannels, 1); assert.equal(impulse.sampleRate, context.sampleRate);
  assert.equal(impulse.length, 153600); assert.equal(room.convolver.normalize, false);
  assert.equal(room.send.gain.value, .40); assert.deepEqual(room.send.connections, [room.convolver]);
  assert.deepEqual(room.convolver.connections, [room.output]); assert.deepEqual(room.output.connections, [context.destination]);
  assert.deepEqual(room.clock.connections, [], 'The cleanup clock cannot produce audible sound.');
  assert.ok(data.slice(0, Math.floor(.028 * impulse.sampleRate)).every(value => value === 0), 'The dry attack stays clear.');
  assert.ok(data[Math.round(.029 * impulse.sampleRate)] > .01, 'Dark early reflections follow the strike.');
  const absoluteSum = data.reduce((sum, value) => sum + Math.abs(value), 0);
  assert.ok(absoluteSum > .99 && absoluteSum < 1.001);
  const lateAbsoluteSum=data.slice(Math.floor(.2*impulse.sampleRate)).reduce((sum,value)=>sum+Math.abs(value),0);
  assert.ok(lateAbsoluteSum>.4,'Late reflections retain useful energy instead of an almost inaudible normalized noise tail.');
  assert.ok(data.slice(Math.floor(2.5*impulse.sampleRate)).some(value=>value!==0),'The dark room extends beyond the old 1.4-second tail.');
  assert.ok(data.slice(Math.floor(3.1*impulse.sampleRate)).every(value=>value===0),'The room finishes smoothly before its finite cleanup clock.');
  const highestPeak = Math.max(...weather.getMetrics().bellHarmonicWeights.map(value => value.peak));
  const worstCasePeak = 16 * highestPeak * BELL_PARTIALS.reduce((sum, partial) => sum + partial[1], 0) * (1 + .40 * absoluteSum);
  assert.ok(worstCasePeak < 1.5, 'The calibrated coherent burst stays bounded in the float graph before Main protection; native output is checked separately.');
  assert.ok(weather.getMetrics().bellDecaySeconds >= 5 && weather.getMetrics().bellDecaySeconds <= 14);
  assert.equal(weather.getMetrics().bellReverb.durationSeconds, 3.2);
  context.advance(8); weather.update(released()); weather.update(out());
  assert.equal(weather.reverb.convolver.buffer, impulse, 'The static impulse is reused instead of regenerated for each gesture.');
});

test('native-style convolution accepts only matching context rates and stays bounded at 48 and 96 kHz', t => {
  for (const sampleRate of [48000, 96000]) {
    const { weather, context } = fixture(t, sampleRate), probe = context.createConvolver();
    assert.throws(() => { probe.buffer = context.createBuffer(1, 240, 24000); }, /sample rate must match/);
    probe.disconnect();
    weather.setActive(true); weather.update(out()); audibleVoice(weather, context);
    const impulse = weather.reverb.convolver.buffer, metrics = weather.getMetrics().bellReverb;
    assert.equal(impulse.sampleRate, sampleRate); assert.equal(metrics.impulseSampleRate, sampleRate);
    assert.equal(impulse.length, Math.ceil(3.2 * sampleRate));
    assert.ok(impulse.length * Float32Array.BYTES_PER_ELEMENT <= 1228800, 'One reused mono impulse stays below 1.18 MiB even at 96 kHz.');
    assert.equal(metrics.graphCount, 1); assert.equal(weather.getMetrics().bellsTriggered, 1);
    context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
  }
});

test('mute and hidden suspension flush old dry and wet tails before resuming without replay', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const oldRoom = weather.reverb, oldVoice = audibleVoice(weather, context); context.advance(.7);
  weather.setActive(false);
  assert.equal(oldRoom.send.gain.at(context.currentTime), 0, 'New input into the old convolution history is cut immediately.');
  assert.equal(oldRoom.output.gain.at(context.currentTime + .04), 0, 'Existing wet history has a short release.');
  assert.equal(oldVoice.envelope.gain.at(context.currentTime + .04), 0);
  // Resume before any audio time passes, as when a browser suspends immediately.
  weather.setActive(true); weather.update(out());
  assert.equal(weather.getMetrics().bellsTriggered, 1); assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  assert.equal(oldRoom.convolver.buffer, null); assert.equal(oldRoom.output.disconnected, true);
  assert.equal(oldVoice.envelope.disconnected, true);
  weather.update(hot()); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context);
  assert.equal(weather.getMetrics().bellsTriggered, 2); assert.notEqual(weather.reverb, oldRoom);
});

test('stop and reset drain the room in a short release and repeated reset remains bounded', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const impulse = weather.reverbImpulse, room = weather.reverb; context.advance(12.1);
  assert.equal(weather.getMetrics().currentBellVoices, 0, 'Only the wet tail remains when stop is called.');
  weather.stop(); context.advance(.05);
  assert.equal(room.output.disconnected, true); assert.equal(room.convolver.buffer, null);
  assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  for (let index = 0; index < 100; index++) {
    weather.reset(); weather.update(out());
    assert.ok(weather.getMetrics().bellReverb.graphCount <= 2);
    assert.ok(context.nodes.filter(node => node.kind === 'convolver' && !node.disconnected).length <= 2);
    assert.ok(weather.bells.size + weather.retiringBells.size <= 16);
    assert.equal(weather.reverbImpulse, impulse);
    context.advance(.001);
  }
  weather.reset(); context.advance(.05);
  assert.equal(weather.getMetrics().bellReverb.graphCount, 0);
  assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('inactive, null-focus and ineligible edges are consumed without packet or unmute replay', t => {
  const { weather, context } = fixture(t);
  weather.update(out()); weather.setActive(true); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update({ ...out(), eligible: false }); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update({ ...out(), patchKey: null }); assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update(hot()); weather.setActive(false); weather.update(out()); weather.setActive(true); weather.update(out());
  assert.equal(weather.getMetrics().bellsTriggered, 0);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.setActive(false); context.advance(.05); assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  weather.setActive(true); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  weather.update(released()); weather.update(hot()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 2);
});

test('stop requires release, reset permits a fresh gesture and Safari fades from the current bell level', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.update(out());
  const voice = audibleVoice(weather, context); voice.envelope.gain.cancelAndHoldAtTime = undefined;
  context.advance(.1); weather.stop();
  assert.ok(voice.envelope.gain.events.some(event => event[0] === 'set' && event[1] > 0 && event[1] < voice.peak));
  weather.update(hot()); weather.update(out()); assert.equal(weather.getMetrics().bellsTriggered, 1);
  context.advance(.1); assert.equal(weather.bells.size + weather.retiringBells.size, 0);
  weather.update(released()); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 2);
  weather.reset(); weather.update(out()); audibleVoice(weather, context); assert.equal(weather.getMetrics().bellsTriggered, 3);
});

test('destroy disconnects every owned native node and makes future interaction inert', async t => {
  const { weather, context } = fixture(t); weather.setActive(true);
  for (let index = 0; index < 8; index++) { weather.update(released()); weather.update(out()); }
  weather.destroy(); const count = context.nodes.length;
  weather.update(released()); weather.update(out('another')); weather.setActive(true); weather.reset(); weather.stop();
  assert.equal(await weather.setRainSource('/later.mp3'), false); assert.equal(context.nodes.length, count);
  assert.ok(context.nodes.every(node => node.disconnected)); assert.equal(weather.getMetrics().rainLoopCount, 0);
  assert.equal(weather.getMetrics().currentBellVoices, 0); assert.equal(weather.getMetrics().retiringBellVoices, 0);
});

test('a short high bell never shortens a preceding low bell room tail', t => {
  const { weather, context } = fixture(t), random = Math.random; t.after(() => { Math.random = random; });
  weather.setActive(true); Math.random = () => 0; weather.update(out()); const tail = weather.reverb.tailUntil;
  context.advance(.1); Math.random = () => .999; weather.update(released()); weather.update(out());
  assert.equal(weather.getMetrics().lastBellHarmonic, 11); assert.equal(weather.getMetrics().bellDecaySeconds, 8);
  assert.equal(weather.reverb.tailUntil, tail); context.advance(3); assert.equal(weather.getMetrics().bellReverb.active, true);
});

test('a bell arriving after the room clock ended gets a fresh room before the old ended event runs', t => {
  const { weather, context } = fixture(t); weather.setActive(true); weather.ring();
  const oldRoom = weather.reverb, delayedEnded = oldRoom.clock.onended;
  context.currentTime = oldRoom.tailUntil + .001; // The audio clock advanced while JS event dispatch was delayed.
  oldRoom.clock.ended = true;
  weather.ring(); const newRoom = weather.reverb;
  assert.notEqual(newRoom, oldRoom); assert.equal(oldRoom.disposed, true);
  delayedEnded(); assert.equal(weather.reverb, newRoom);
  assert.equal(newRoom.disposed, false); assert.ok(newRoom.clock.stoppedAt > context.currentTime);
  context.advance(16); assert.ok(context.nodes.every(node => node.disconnected));
});

test('legacy quench selection cannot request, decode or allocate samples on phones', async t => {
  const { weather, context, requests } = fixture(t);
  assert.equal(await weather.setQuenchSources([{ id: 'wood', url: '/quench-wood.mp3' }]), false);
  weather.setActive(true); weather.update(out());
  assert.equal(await weather.setQuenchSources([{ id: 'steam', url: '/quench-steam.mp3' }]), false);
  weather.update(released()); weather.update(out()); weather.setActive(false); weather.setActive(true);
  assert.deepEqual(requests, []); assert.equal(context.decodes, 0); assert.equal(context.buffers, 0);
  assert.equal(weather.getMetrics().bellsTriggered, 2); assert.equal(weather.getMetrics().quench, undefined);
});
