import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtilleryAudio } from './dist/artillery-audio.js';

class Parameter {
  constructor() { this.events = []; }
  record(method, value, time) {
    assert.ok(Number.isFinite(value));
    assert.ok(Number.isFinite(time));
    this.events.push({ method, value, time });
  }
  setValueAtTime(value, time) { this.record('set', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0, 'exponential ramps require positive endpoints');
    this.record('exponential', value, time);
  }
  cancelScheduledValues(time) { this.events.push({ method: 'cancel', time }); }
}

class Node {
  constructor(context, kind) {
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
    context.nodes.push(this);
  }
  connect(node) { assert.ok(node); this.connections.push(node); return node; }
  disconnect() { this.connections = []; this.disconnected = true; }
}

class Source extends Node {
  constructor(context, kind) {
    super(context, kind);
    this.frequency = new Parameter();
    this.playbackRate = new Parameter();
    this.starts = [];
    this.stops = [];
    this.onended = null;
    context.sources.push(this);
  }
  start(time, offset) { this.starts.push({ time, offset }); }
  stop(time) { this.stops.push(time); }
  setPeriodicWave(wave) { this.wave = wave; }
  finish() { this.onended?.(); }
}

class AudioContext {
  constructor({ suspended = false, stereo = true } = {}) {
    this.currentTime = 10;
    this.sampleRate = 12000;
    this.state = suspended ? 'suspended' : 'running';
    this.nodes = [];
    this.sources = [];
    this.buffers = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.destination = new Node(this, 'destination');
    if (!stereo) this.createStereoPanner = undefined;
  }
  createGain() { const node = new Node(this, 'gain'); node.gain = new Parameter(); return node; }
  createDynamicsCompressor() {
    const node = new Node(this, 'compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Parameter();
    return node;
  }
  createBiquadFilter() {
    const node = new Node(this, 'filter');
    node.frequency = new Parameter(); node.Q = new Parameter();
    return node;
  }
  createStereoPanner() { const node = new Node(this, 'panner'); node.pan = new Parameter(); return node; }
  createConvolver() { return new Node(this, 'convolver'); }
  createOscillator() { return new Source(this, 'oscillator'); }
  createBufferSource() { return new Source(this, 'noise'); }
  createPeriodicWave(real, imag) { return { real, imag }; }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: channel => data[channel] };
    this.buffers.push(buffer);
    return buffer;
  }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}

function seededRandom() {
  let value = 173;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

async function ready(options = {}) {
  const context = new AudioContext(options);
  const audio = createArtilleryAudio({ contextFactory: () => context, random: seededRandom() });
  audio.setEnabled(true);
  assert.equal(await audio.unlock(), true);
  return { audio, context };
}

test('unlock constructs and resumes synchronously within the gesture and shares a pending resume', async () => {
  const context = new AudioContext({ suspended: true });
  let created = 0, finishResume;
  context.resume = () => {
    context.resumeCalls++;
    return new Promise(resolve => { finishResume = () => { context.state = 'running'; resolve(); }; });
  };
  const audio = createArtilleryAudio({ contextFactory: () => { created++; return context; } });
  assert.equal(created, 0, 'importing and constructing the controller do not allocate a context');
  audio.setEnabled(true);
  assert.equal(audio.play('fire'), false, 'play cannot create or resume a context');
  const first = audio.unlock();
  assert.equal(created, 1, 'context exists before unlock yields');
  assert.equal(context.resumeCalls, 1, 'resume is invoked before unlock yields');
  assert.equal(audio.unlock(), first);
  audio.setEnabled(false);
  finishResume();
  assert.equal(await first, true);
  assert.equal(audio.play('radio'), false, 'a pending unlock must not undo a later OFF command');
  assert.equal(context.sources.length, 0);
  audio.setEnabled(true);
  assert.equal(audio.play('radio'), true);
  assert.equal(created, 1);
  audio.dispose();
});

test('muted, unavailable, rejected, and disposed audio paths fail silently without source allocation', async () => {
  const context = new AudioContext();
  const audio = createArtilleryAudio({ contextFactory: () => context });
  assert.equal(await audio.unlock(), true);
  assert.equal(audio.play('fire'), false, 'default is OFF');
  assert.equal(context.sources.length, 0);
  audio.stopAll(); audio.setEnabled(false); audio.dispose(); audio.dispose();
  assert.equal(context.closeCalls, 1);
  assert.equal(await audio.unlock(), false);
  audio.setEnabled(true);
  assert.equal(audio.play('fire'), false);

  const unavailable = createArtilleryAudio({ contextFactory: () => { throw new Error('not supported'); } });
  unavailable.setEnabled(true);
  assert.equal(await unavailable.unlock(), false);
  assert.equal(unavailable.play('fire'), false);
  unavailable.stopAll(); unavailable.dispose();
  const deniedContext = new AudioContext({ suspended: true });
  deniedContext.resume = () => Promise.reject(new Error('autoplay denied'));
  const denied = createArtilleryAudio({ contextFactory: () => deniedContext });
  denied.setEnabled(true);
  assert.equal(await denied.unlock(), false);
  assert.equal(denied.play('fire'), false);
  denied.dispose();
});

test('every cue schedules finite layered sources, envelopes, and explicit source end times', async () => {
  const { audio, context } = await ready();
  for (const cue of ['breechOpen', 'loadClose', 'fire', 'impact', 'salvoImpact', 'radio', 'bugle', 'failure']) {
    const first = context.sources.length;
    assert.equal(audio.play(cue), true, cue);
    const sources = context.sources.slice(first);
    assert.ok(sources.length >= 3, `${cue}: effect has distinct physical layers`);
    assert.ok(sources.some(source => source.kind === 'noise'), `${cue}: noise texture`);
    assert.ok(sources.some(source => source.kind === 'oscillator'), `${cue}: body or resonance`);
    for (const source of sources) {
      assert.equal(source.starts.length, 1);
      assert.ok(source.starts[0].time >= context.currentTime);
      assert.ok(source.stops[0] > source.starts[0].time);
      assert.ok(source.stops[0] < context.currentTime + 5, 'no indefinite oscillator or looping noise');
    }
    audio.stopAll();
  }
  const compressor = context.nodes.find(node => node.kind === 'compressor');
  assert.equal(compressor.ratio.events[0].value, 6);
  assert.ok(compressor.threshold.events[0].value < 0);
  const master = context.nodes.find(node => node.connections.includes(context.destination));
  assert.ok(master.gain.events.filter(event => event.method === 'set').every(event => event.value >= 0 && event.value <= 0.7));
  assert.equal(audio.play('constructor'), false);
  assert.equal(audio.play('__proto__'), false);
  audio.dispose();
});

test('an 81-cell salvo is a bounded stereo cluster with several nearly simultaneous impacts', async () => {
  const { audio, context } = await ready();
  assert.equal(audio.play('salvoImpact', { count: 81 }), true);
  assert.equal(context.sources.length, 36, 'six impact positions with six layers each');
  const bodies = context.sources.filter(source => source.kind === 'oscillator');
  assert.equal(bodies.length, 6);
  const starts = bodies.map(source => source.starts[0].time);
  assert.equal(new Set(starts).size, 6);
  assert.ok(Math.max(...starts) - Math.min(...starts) < 0.08, 'impacts overlap instead of firing sequentially');
  const pans = context.nodes.filter(node => node.kind === 'panner').map(node => node.pan.events[0].value);
  assert.ok(pans.some(value => value < -0.5));
  assert.ok(pans.some(value => value > 0.5));
  assert.equal(context.nodes.filter(node => node.kind === 'convolver').length, 1, 'one shared reverberation bus');
  assert.ok(context.nodes.length < 200, 'large salvos cannot multiply graph size by 81');
  audio.dispose();
});

test('OFF immediately cancels future notes and current voices, disconnects reverb, and cannot revive old tails', async () => {
  const { audio, context } = await ready();
  audio.play('bugle'); audio.play('fire');
  assert.ok(context.sources.some(source => source.starts[0].time > context.currentTime + .7));
  const sources = [...context.sources];
  const oldConvolver = context.nodes.find(node => node.kind === 'convolver');
  const bufferCount = context.buffers.length;
  context.currentTime += 0.04;
  audio.setEnabled(false);
  for (const source of sources) {
    assert.equal(source.stops.at(-1), context.currentTime);
    assert.equal(source.onended, null);
    assert.equal(source.disconnected, true);
  }
  assert.equal(oldConvolver.disconnected, true);
  assert.equal(audio.play('impact'), false);
  assert.equal(context.sources.length, sources.length);
  audio.setEnabled(true);
  assert.equal(audio.play('radio'), true);
  const reverbs = context.nodes.filter(node => node.kind === 'convolver');
  assert.equal(reverbs.length, 2, 'a fresh bus has no old convolution tail');
  assert.equal(reverbs[0].disconnected, true);
  assert.equal(context.buffers.length, bufferCount, 'noise and impulse buffers are cached across mute cycles');
  audio.dispose();
});

test('stopAll cancels scheduled audio without changing the enabled preference', async () => {
  const { audio, context } = await ready();
  audio.play('loadClose');
  audio.stopAll();
  assert.ok(context.sources.every(source => source.stops.at(-1) === context.currentTime));
  assert.equal(audio.play('breechOpen'), true);
  audio.dispose();
});

test('repeated salvos enforce the global voice limit and ending voices releases their graph nodes', async () => {
  const { audio, context } = await ready();
  for (let repeat = 0; repeat < 5; repeat++) {
    assert.equal(audio.play('salvoImpact', { count: 81 }), true);
    assert.ok(context.sources.filter(source => source.onended !== null).length <= 48);
  }
  assert.ok(context.sources.slice(0, 36).every(source => source.disconnected), 'old voices are stolen instead of leaking');
  for (const source of context.sources) source.finish();
  assert.ok(context.sources.every(source => source.onended === null));
  assert.ok(context.sources.every(source => source.disconnected));
  assert.equal(audio.play('fire'), true, 'completion does not disable future audio');
  audio.dispose();
  assert.ok(context.nodes.filter(node => node.kind !== 'destination').every(node => node.disconnected));
});

test('stereo-unavailable browsers retain a safe mono signal and cached procedural buffers contain finite audio', async () => {
  const { audio, context } = await ready({ stereo: false });
  assert.equal(audio.play('fire'), true);
  assert.equal(audio.play('impact'), true);
  assert.equal(context.nodes.some(node => node.kind === 'panner'), false);
  assert.equal(context.buffers.length, 3, 'white noise, brown noise, and one stereo impulse');
  for (const buffer of context.buffers) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      assert.ok(samples.every(Number.isFinite));
      assert.ok(samples.some(sample => sample > 0));
      assert.ok(samples.some(sample => sample < 0));
    }
  }
  audio.dispose();
});

test('the original bugle phrase uses scheduled pitched notes and distinguishes success from an unsuccessful ending', async () => {
  const { audio, context } = await ready();
  audio.play('bugle', { success: true });
  const success = context.sources.filter(source => source.kind === 'oscillator');
  assert.equal(success.length, 6);
  assert.ok(success.every(source => source.wave));
  assert.ok(success.at(-1).frequency.events[0].value > success[0].frequency.events[0].value);
  audio.stopAll();
  const first = context.sources.length;
  audio.play('bugle', { success: false });
  const failure = context.sources.slice(first).filter(source => source.kind === 'oscillator');
  assert.equal(failure.length, 4);
  assert.ok(failure.at(-1).frequency.events[0].value < failure[0].frequency.events[0].value);
  audio.dispose();
});

test('dispose during a pending resume cannot resurrect audio or leak its context', async () => {
  const context = new AudioContext({ suspended: true });
  let resolveResume;
  context.resume = () => new Promise(resolve => { resolveResume = resolve; });
  const audio = createArtilleryAudio({ contextFactory: () => context });
  audio.setEnabled(true);
  const pending = audio.unlock();
  audio.dispose();
  resolveResume();
  assert.equal(await pending, false);
  assert.equal(context.closeCalls, 1);
  assert.equal(audio.play('fire'), false);
  assert.equal(context.sources.length, 0);
});
