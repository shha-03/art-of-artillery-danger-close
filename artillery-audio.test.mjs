import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  start(time, offset, duration) { this.starts.push({ time, offset, duration }); }
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
    this.decodeCalls = 0;
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
  decodeAudioData(bytes) {
    this.decodeCalls++;
    const duration = new Float64Array(bytes)[0];
    return Promise.resolve(this.createBuffer(2, Math.round(duration * this.sampleRate), this.sampleRate));
  }
  resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}

function seededRandom() {
  let value = 173;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

const clipDurations = { 'breech-open.wav': 0.44, 'shell-load.wav': 0.58, 'breech-close.wav': 0.38 };
function fixtureFetch(calls = []) {
  return async (url, options) => {
    const filename = new URL(url).pathname.split('/').at(-1);
    assert.ok(Object.hasOwn(clipDurations, filename));
    calls.push({ url, signal: options.signal });
    return { ok: true, arrayBuffer: async () => new Float64Array([clipDurations[filename]]).buffer };
  };
}

async function ready({ recordings = false, ...options } = {}) {
  const context = new AudioContext(options);
  const audio = createArtilleryAudio({ contextFactory: () => context, random: seededRandom(), fetcher: fixtureFetch() });
  audio.setEnabled(true);
  assert.equal(await audio.unlock(), true);
  if (recordings) assert.equal(await audio.prepare(), true);
  return { audio, context };
}

function reaches(source, destination, seen = new Set()) {
  if (source === destination) return true;
  if (seen.has(source)) return false;
  seen.add(source);
  return source.connections.some(node => reaches(node, destination, seen));
}

function filterFor(source) {
  return source.connections.find(node => node.kind === 'filter');
}

function peakFor(source) {
  const gain = (filterFor(source) || source).connections.find(node => node.kind === 'gain');
  return Math.max(...gain.gain.events.filter(event => event.method === 'linear').map(event => event.value));
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
  for (const cue of ['fire', 'impact', 'salvoImpact', 'radio', 'bugle', 'failure']) {
    const first = context.sources.length;
    assert.equal(audio.play(cue), true, cue);
    const sources = context.sources.slice(first);
    assert.ok(sources.length >= 3, `${cue}: effect has distinct physical layers`);
    assert.ok(sources.some(source => source.kind === 'noise'), `${cue}: noise texture`);
    if (cue === 'radio' || cue === 'bugle') {
      assert.ok(sources.some(source => source.kind === 'oscillator'), `${cue}: intentional pitched signal`);
    } else {
      assert.ok(sources.every(source => source.kind === 'noise'), `${cue}: physical textures do not use pitched oscillator sweeps`);
    }
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

test('recorded mechanical cues play at original speed through the common master with no filter or reverb', async () => {
  const { audio, context } = await ready({ recordings: true });
  for (const [cue, duration, stageDuration] of [['breechOpen', .44, .48], ['shellLoad', .58, .62], ['breechClose', .38, .44]]) {
    const first = context.sources.length;
    assert.equal(audio.play(cue), true);
    const sources = context.sources.slice(first);
    assert.equal(sources.length, 1, 'one original recording, without synthesis layers');
    const source = sources[0];
    assert.equal(source.loop, false);
    assert.equal(source.playbackRate.events[0].value, 1);
    assert.equal(source.starts[0].offset, 0);
    assert.equal(source.starts[0].duration, duration);
    assert.equal(source.buffer.numberOfChannels, 2);
    assert.equal(source.connections.length, 1);
    assert.equal(source.connections[0].kind, 'compressor');
    assert.ok(Math.abs(source.stops[0] - source.starts[0].time - duration) < 1e-9);
    assert.ok(source.stops[0] <= context.currentTime + stageDuration);
    assert.equal(context.nodes.some(node => ['filter', 'convolver', 'panner'].includes(node.kind)), false);
    audio.stopAll();
  }
  audio.dispose();
});

test('boot preload is context-free and concurrent preparation fetches and decodes each recording once', async () => {
  const context = new AudioContext(), requests = [];
  let constructions = 0;
  const audio = createArtilleryAudio({ contextFactory: () => { constructions++; return context; }, fetcher: fixtureFetch(requests) });
  assert.deepEqual(await Promise.all([audio.preload(), audio.preload()]), [true, true]);
  assert.equal(constructions, 0, 'preloading bytes does not violate autoplay policies');
  assert.equal(context.decodeCalls, 0);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url }) => url.pathname.includes('/audio/')));
  audio.setEnabled(true);
  const preparing = audio.prepare();
  assert.equal(constructions, 1, 'the context is created synchronously in the gesture');
  assert.deepEqual(await Promise.all([preparing, audio.prepare()]), [true, true]);
  assert.equal(requests.length, 3);
  assert.equal(context.decodeCalls, 3);
  assert.equal(context.sources.length, 0, 'preparation never starts playback');
  assert.equal(audio.play('shellLoad'), true);
  const buffer = context.sources.at(-1).buffer;
  audio.setEnabled(false);
  audio.setEnabled(true);
  assert.equal(await audio.prepare(), true);
  assert.equal(audio.play('shellLoad'), true);
  assert.equal(context.sources.at(-1).buffer, buffer);
  assert.equal(context.decodeCalls, 3, 'decoded recordings survive mute cycles');
  audio.dispose();
});

test('legacy loadClose plays the two recordings sequentially and stopAll cancels its future close', async () => {
  const { audio, context } = await ready({ recordings: true });
  assert.equal(audio.play('loadClose'), true);
  assert.equal(context.sources.length, 2);
  const [loading, closing] = context.sources;
  assert.ok(closing.starts[0].time > loading.stops[0]);
  assert.ok(Math.abs(closing.starts[0].time - loading.stops[0] - .02) < 1e-9);
  context.currentTime += .05;
  audio.setEnabled(false);
  assert.ok(context.sources.every(source => source.stops.at(-1) === context.currentTime && source.disconnected));
  assert.equal(audio.play('breechOpen'), false);
  audio.dispose();
});

test('explosions combine low pressure, broadband shock and later debris without oscillator pitch dives', async () => {
  const { audio, context } = await ready();
  for (const cue of ['fire', 'impact']) {
    const first = context.sources.length;
    audio.play(cue);
    const sources = context.sources.slice(first);
    assert.ok(sources.every(source => source.kind === 'noise'));
    const bass = sources.find(source => filterFor(source).type === 'bandpass' && filterFor(source).frequency.events[0].value < 120);
    assert.ok(bass && bass.starts[0].time < context.currentTime + 0.02, 'low pressure arrives with the main strike');
    assert.ok(peakFor(bass) >= 0.7, 'filtered low noise retains body instead of leaving only a high-frequency click');
    assert.ok(sources.some(source => filterFor(source).frequency.events[0].value > 1500 && source.starts[0].time < context.currentTime + 0.02), 'broadband initial shock');
    assert.ok(sources.some(source => source.starts[0].time > context.currentTime + 0.04), 'separate later debris or diffuse tail');
    assert.ok(sources.some(source => source.stops[0] - source.starts[0].time > 0.7), 'a slower low tail follows the sharp impact');
    audio.stopAll();
  }
  audio.dispose();
});

test('an 81-cell salvo is a bounded stereo cluster with several nearly simultaneous impacts', async () => {
  const { audio, context } = await ready();
  assert.equal(audio.play('salvoImpact', { count: 81 }), true);
  assert.equal(context.sources.length, 36, 'six impact positions with six layers each');
  const bodies = context.sources.filter(source => filterFor(source)?.type === 'bandpass' && filterFor(source).frequency.events[0].value < 120);
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
  const { audio, context } = await ready({ recordings: true });
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

test('missing or undecodable recordings stay silent without suppressing unrelated effects', async () => {
  for (const failure of ['http', 'network', 'decode', 'unsupported']) {
    const context = new AudioContext();
    const normalFetch = fixtureFetch();
    const fetcher = (url, options) => {
      if (String(url).endsWith('breech-close.wav')) {
        if (failure === 'http') return Promise.resolve({ ok: false });
        if (failure === 'network') return Promise.reject(new Error('offline'));
      }
      return normalFetch(url, options);
    };
    if (failure === 'decode') {
      const decode = context.decodeAudioData.bind(context);
      context.decodeAudioData = bytes => new Float64Array(bytes)[0] === .38
        ? Promise.reject(new Error('invalid WAV')) : decode(bytes);
    }
    if (failure === 'unsupported') context.decodeAudioData = undefined;
    const audio = createArtilleryAudio({ contextFactory: () => context, fetcher });
    audio.setEnabled(true);
    assert.equal(audio.play('breechClose'), false, 'not-ready recordings do not synthesize a substitute');
    assert.equal(await audio.prepare(), false);
    assert.equal(audio.play('breechClose'), false, failure);
    assert.equal(audio.play('loadClose'), false, 'a partial combined cue does not schedule half a mechanism');
    assert.equal(context.sources.length, 0);
    if (failure !== 'unsupported') assert.equal(audio.play('breechOpen'), true, 'one bad file does not block the other recording');
    assert.equal(audio.play('fire'), true, 'procedural combat effects remain available');
    audio.dispose();
  }
});

test('fetch timeouts abort requests and let preparation settle without a recording fallback', async () => {
  const context = new AudioContext(), signals = [];
  const audio = createArtilleryAudio({ contextFactory: () => context, loadTimeoutMs: 15,
    fetcher: (_url, { signal }) => { signals.push(signal); return new Promise(() => {}); } });
  audio.setEnabled(true);
  assert.equal(await audio.prepare({ timeoutMs: 80 }), false);
  assert.equal(signals.length, 3);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(context.decodeCalls, 0);
  assert.equal(audio.play('shellLoad'), false);
  assert.equal(audio.play('impact'), true);
  audio.dispose();
});

test('an aborted caller stops waiting without poisoning shared boot downloads', async () => {
  const context = new AudioContext(), completions = [];
  const normalFetch = fixtureFetch();
  const audio = createArtilleryAudio({ contextFactory: () => context,
    fetcher: (url, options) => new Promise(resolve => completions.push(async () => resolve(await normalFetch(url, options)))) });
  const preload = audio.preload();
  audio.setEnabled(true);
  const controller = new AbortController();
  const preparing = audio.prepare({ signal: controller.signal });
  controller.abort();
  assert.equal(await preparing, false);
  assert.equal(context.sources.length, 0);
  for (const complete of completions) await complete();
  assert.equal(await preload, true);
  assert.equal(await audio.prepare(), true, 'later explicit preparation can use the shared files');
  assert.equal(context.sources.length, 0, 'late readiness never automatically plays a cue');
  audio.dispose();
});

test('mute and disposal prevent pending decoding from reviving playback', async () => {
  for (const dispose of [false, true]) {
    const context = new AudioContext(), finishDecode = [];
    context.decodeAudioData = bytes => new Promise(resolve => finishDecode.push(() =>
      resolve(context.createBuffer(2, new Float64Array(bytes)[0] * context.sampleRate, context.sampleRate))));
    const audio = createArtilleryAudio({ contextFactory: () => context, fetcher: fixtureFetch() });
    audio.setEnabled(true);
    const preparing = audio.prepare();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finishDecode.length, 3);
    if (dispose) audio.dispose(); else audio.setEnabled(false);
    for (const finish of finishDecode) finish();
    assert.equal(await preparing, false);
    assert.equal(context.sources.length, 0);
    assert.equal(audio.play('shellLoad'), false);
    if (dispose) {
      assert.equal(await audio.preload(), false);
      assert.equal(await audio.prepare(), false);
    } else {
      audio.setEnabled(true);
      assert.equal(await audio.prepare(), true);
      assert.equal(audio.play('shellLoad'), true, 'only a new explicit playback starts the cached recording');
      audio.dispose();
    }
  }
});

test('late decode completion after its timeout is ignored', async () => {
  const context = new AudioContext(), completions = [];
  context.decodeAudioData = bytes => new Promise(resolve => completions.push(() =>
    resolve(context.createBuffer(2, new Float64Array(bytes)[0] * context.sampleRate, context.sampleRate))));
  const audio = createArtilleryAudio({ contextFactory: () => context, fetcher: fixtureFetch(), loadTimeoutMs: 15 });
  audio.setEnabled(true);
  assert.equal(await audio.prepare({ timeoutMs: 80 }), false);
  assert.equal(completions.length, 3);
  for (const complete of completions) complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(audio.play('breechOpen'), false);
  assert.equal(context.sources.length, 0);
  audio.dispose();
});

test('a replacement context ignores stale decode completions and reuses the fetched bytes', async () => {
  const oldContext = new AudioContext(), newContext = new AudioContext(), completions = [], requests = [];
  oldContext.decodeAudioData = bytes => new Promise(resolve => completions.push(() =>
    resolve(oldContext.createBuffer(2, new Float64Array(bytes)[0] * oldContext.sampleRate, oldContext.sampleRate))));
  let constructions = 0;
  const audio = createArtilleryAudio({ contextFactory: () => constructions++ ? newContext : oldContext, fetcher: fixtureFetch(requests) });
  audio.setEnabled(true);
  const oldPreparation = audio.prepare();
  await new Promise(resolve => setImmediate(resolve));
  oldContext.state = 'closed';
  assert.equal(await audio.prepare(), true);
  assert.equal(newContext.decodeCalls, 3);
  for (const complete of completions) complete();
  assert.equal(await oldPreparation, false);
  assert.equal(requests.length, 3, 'context replacement reuses original bytes');
  assert.equal(audio.play('breechOpen'), true);
  assert.equal(oldContext.sources.length, 0);
  assert.ok(newContext.buffers.includes(newContext.sources.at(-1).buffer));
  audio.dispose();
});

test('oversized recordings are cut to the mechanical stage limit without playback-rate changes', async () => {
  const context = new AudioContext();
  context.decodeAudioData = () => Promise.resolve(context.createBuffer(2, context.sampleRate * 2, context.sampleRate));
  const audio = createArtilleryAudio({ contextFactory: () => context, fetcher: fixtureFetch() });
  audio.setEnabled(true);
  assert.equal(await audio.prepare(), true);
  for (const [cue, limit] of [['breechOpen', .48], ['shellLoad', .62], ['breechClose', .44]]) {
    assert.equal(audio.play(cue), true);
    const source = context.sources.at(-1);
    assert.ok(source.stops[0] < context.currentTime + limit);
    assert.equal(source.playbackRate.events[0].value, 1);
  }
  audio.dispose();
});

test('a later explicit preparation retries failed fetches and decodes while retaining successful caches', async () => {
  const context = new AudioContext(), fetched = new Map();
  const normalFetch = fixtureFetch();
  let decodeFailure = true;
  const decode = context.decodeAudioData.bind(context);
  context.decodeAudioData = bytes => {
    if (decodeFailure) return Promise.reject(new Error('temporary decoder failure'));
    return decode(bytes);
  };
  const audio = createArtilleryAudio({ contextFactory: () => context, fetcher: (url, options) => {
    const key = String(url), count = (fetched.get(key) || 0) + 1;
    fetched.set(key, count);
    return count === 1 ? Promise.resolve({ ok: false }) : normalFetch(url, options);
  } });
  assert.equal(await audio.preload(), false);
  audio.setEnabled(true);
  assert.equal(await audio.prepare(), false, 'second download succeeds but first decode fails');
  decodeFailure = false;
  assert.equal(await audio.prepare(), true, 'the next user action can recover without reloading the page');
  assert.deepEqual([...fetched.values()], [2, 2, 2], 'successful downloads are not fetched again');
  assert.equal(context.decodeCalls, 3);
  assert.equal(audio.play('shellLoad'), true);
  audio.dispose();
});

test('a closed context pending resume cannot prevent or clear a replacement context resume', async () => {
  const oldContext = new AudioContext({ suspended: true }), newContext = new AudioContext({ suspended: true });
  let finishOld, finishNew, constructions = 0;
  oldContext.resume = () => new Promise(resolve => { finishOld = resolve; });
  newContext.resume = () => new Promise(resolve => { finishNew = () => { newContext.state = 'running'; resolve(); }; });
  const audio = createArtilleryAudio({ contextFactory: () => constructions++ ? newContext : oldContext });
  audio.setEnabled(true);
  const oldResume = audio.unlock();
  oldContext.state = 'closed';
  const newResume = audio.unlock();
  assert.notEqual(oldResume, newResume);
  assert.equal(typeof finishNew, 'function', 'replacement context gets its own resume call');
  finishOld();
  assert.equal(await oldResume, false);
  assert.equal(audio.unlock(), newResume, 'stale completion did not clear the current pending resume');
  finishNew();
  assert.equal(await newResume, true);
  audio.dispose();
});

test('shipped recordings are valid 48 kHz stereo PCM16 WAVs within their animation stages', () => {
  for (const [filename, expectedDuration] of Object.entries(clipDurations)) {
    const bytes = readFileSync(new URL(`./dist/audio/${filename}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    let format, data;
    for (let position = 12; position + 8 <= bytes.length;) {
      const kind = bytes.toString('ascii', position, position + 4), length = bytes.readUInt32LE(position + 4);
      assert.ok(position + 8 + length <= bytes.length, 'chunk fits the file');
      if (kind === 'fmt ') format = bytes.subarray(position + 8, position + 8 + length);
      if (kind === 'data') data = bytes.subarray(position + 8, position + 8 + length);
      position += 8 + length + (length % 2);
    }
    assert.ok(format && data);
    assert.equal(format.readUInt16LE(0), 1, 'uncompressed PCM');
    assert.equal(format.readUInt16LE(2), 2, 'stereo');
    assert.equal(format.readUInt32LE(4), 48000);
    assert.equal(format.readUInt16LE(14), 16);
    assert.equal(data.length / (48000 * 2 * 2), expectedDuration);
    let peak = 0;
    for (let index = 0; index < data.length; index += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(index)) / 32768);
    assert.ok(peak > 0.01 && peak < 1, 'audible recording has unclipped headroom');
  }
});
