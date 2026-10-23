// Mechanical and firing cues use the user's local recordings; impacts and
// signals are synthesized. See audio/SOURCE.md for the split and constant gains.
// The optional dependencies make scheduling/lifecycle tests independent of a browser.
const MAX_SOURCES = 48;
const MAX_SALVO_BLASTS = 6;
const OUTPUT_LEVEL = 0.62;
const FLOOR = 0.0001;
const RECORDING_FILES = Object.fromEntries(['sound1.mp3','sound2.mp3','sound3.mp3']
  .map(file => [file, new URL(`./audio/${file}`, import.meta.url)]));
const RECORDINGS = {
  breechOpen: { file: 'sound1.mp3', offset: 0, duration: 0.68, gain: 5.780593767732224 },
  shellLoad: { file: 'sound2.mp3', offset: 0, gain: 6.830070598341799 },
  breechClose: { file: 'sound1.mp3', offset: 0.68, gain: 5.780593767732224 },
  fire: { file: 'sound3.mp3', offset: 0, gain: 3.7817304978327306 },
};

export function createArtilleryAudio({ contextFactory, random = Math.random,
  fetcher = globalThis.fetch?.bind(globalThis), loadTimeoutMs = 4000 } = {}) {
  let context = null, compressor = null, output = null, buses = null;
  let enabled = false, disposed = false, resumePending = null;
  let impulse = null, brassWave = null;
  const buffers = new Map();
  const voices = new Set();
  const recordingBytes = new Map(), recordings = new Map(), decoding = new Map();
  const requests = new Set();
  const lifetimeAbort = new AbortController();
  let contextVersion = 0;
  const loadDeadline = Number.isFinite(loadTimeoutMs) && loadTimeoutMs > 0 ? loadTimeoutMs : 4000;
  const rand = () => Math.max(0, Math.min(1, Number(random()) || 0));
  const disconnect = node => { try { node?.disconnect(); } catch {} };

  function bounded(promise, timeoutMs = loadDeadline, signal) {
    return new Promise(resolve => {
      let settled = false, timer;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        lifetimeAbort.signal.removeEventListener('abort', cancel);
        resolve(value);
      };
      const cancel = () => finish(false);
      // Attach rejection handling even if cancellation already occurred.
      Promise.resolve(promise).then(finish, cancel);
      if (disposed || signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      lifetimeAbort.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(cancel, Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : loadDeadline);
    });
  }

  function fetchRecording(cue) {
    if (recordingBytes.has(cue)) return recordingBytes.get(cue);
    if (disposed || typeof fetcher !== 'function') return Promise.resolve(false);
    const controller = new AbortController();
    requests.add(controller);
    const request = Promise.resolve().then(() => fetcher(RECORDING_FILES[cue], { signal: controller.signal }))
      .then(response => response?.ok ? response.arrayBuffer() : false);
    const pending = bounded(request).then(bytes => {
      if (!bytes || disposed) { controller.abort(); return false; }
      return bytes;
    }).finally(() => requests.delete(controller)).then(bytes => {
      // A later explicit preparation can retry a transient offline/timeout
      // failure. Do not invalidate a newer request or retry automatically.
      if (!bytes && recordingBytes.get(cue) === pending) recordingBytes.delete(cue);
      return bytes;
    });
    recordingBytes.set(cue, pending);
    return pending;
  }

  function preload({ signal, timeoutMs = loadDeadline } = {}) {
    if (disposed || signal?.aborted) return Promise.resolve(false);
    // Boot may fetch bytes without creating or resuming an AudioContext.
    return bounded(Promise.all(Object.keys(RECORDING_FILES).map(fetchRecording))
      .then(results => results.every(Boolean)), timeoutMs, signal);
  }

  function decodeRecording(cue, target, version) {
    if (recordings.has(cue)) return Promise.resolve(recordings.get(cue));
    if (decoding.has(cue)) return decoding.get(cue);
    const pending = (async () => {
      const bytes = await fetchRecording(cue);
      if (!bytes || disposed || context !== target || contextVersion !== version
        || typeof target.decodeAudioData !== 'function') return false;
      const decoded = await bounded(new Promise((resolve, reject) => {
        // Copy because decodeAudioData may detach its input. Keep the original
        // bytes cached if an interrupted/closed context has to be recreated.
        const promise = target.decodeAudioData(bytes.slice(0), resolve, reject);
        if (promise?.then) promise.then(resolve, reject);
      }));
      if (!decoded || disposed || context !== target || contextVersion !== version
        || !Number.isFinite(decoded.duration) || decoded.duration <= 0) return false;
      recordings.set(cue, decoded);
      return decoded;
    })().catch(() => false).then(decoded => {
      if (!decoded && decoding.get(cue) === pending) decoding.delete(cue);
      return decoded;
    });
    decoding.set(cue, pending);
    return pending;
  }

  function prepare({ signal, timeoutMs = loadDeadline } = {}) {
    if (disposed || !enabled || signal?.aborted) return Promise.resolve(false);
    // unlock() must run before the first await to retain the click gesture.
    const unlocked = unlock();
    const target = context, version = contextVersion;
    const ready = Promise.all([unlocked, ...Object.keys(RECORDING_FILES).map(cue =>
      target ? decodeRecording(cue, target, version) : Promise.resolve(false))])
      .then(results => results.every(Boolean) && !disposed && enabled
        && context === target && contextVersion === version);
    return bounded(ready, timeoutMs, signal);
  }

  function silenceOutput() {
    if (!output || !context) return;
    output.gain.cancelScheduledValues(context.currentTime);
    output.gain.setValueAtTime(0, context.currentTime);
  }

  function release(voice, stop = false) {
    if (!voices.delete(voice)) return;
    voice.source.onended = null;
    if (stop) { try { voice.source.stop(context?.currentTime ?? 0); } catch {} }
    voice.nodes.forEach(disconnect);
  }

  function stopAll() {
    // Disconnect the effect bus too: stopping source nodes alone leaves a
    // convolver's tail audible, and it could return when sound is re-enabled.
    try { silenceOutput(); } catch {}
    for (const voice of [...voices]) release(voice, true);
    if (buses) buses.nodes.forEach(disconnect);
    buses = null;
  }

  function setEnabled(value) {
    enabled = !disposed && value === true;
    if (!enabled) stopAll();
  }

  function unlock() {
    if (disposed) return Promise.resolve(false);
    try {
      if (!context || context.state === 'closed') {
        stopAll();
        disconnect(compressor); disconnect(output);
        buffers.clear(); impulse = null; brassWave = null;
        recordings.clear(); decoding.clear(); contextVersion++;
        resumePending = null;
        const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!contextFactory && !Constructor) return Promise.resolve(false);
        // Construction and resume happen synchronously inside the gesture,
        // before returning a Promise or yielding to the event loop.
        context = contextFactory ? contextFactory() : new Constructor({ latencyHint: 'interactive' });
        compressor = context.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-16, context.currentTime);
        compressor.knee.setValueAtTime(18, context.currentTime);
        compressor.ratio.setValueAtTime(6, context.currentTime);
        compressor.attack.setValueAtTime(0.002, context.currentTime);
        compressor.release.setValueAtTime(0.24, context.currentTime);
        output = context.createGain();
        output.gain.setValueAtTime(0, context.currentTime);
        compressor.connect(output); output.connect(context.destination);
      }
      if (context.state === 'running') return Promise.resolve(true);
      if (resumePending) return resumePending;
      const resumedContext = context;
      const resumed = context.resume();
      const pending = Promise.resolve(resumed).then(
        () => !disposed && context === resumedContext && context.state === 'running',
        () => false,
      ).finally(() => { if (resumePending === pending) resumePending = null; });
      resumePending = pending;
      return pending;
    } catch {
      stopAll();
      return Promise.resolve(false);
    }
  }

  function noiseBuffer(kind) {
    if (buffers.has(kind)) return buffers.get(kind);
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 2), context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      const white = rand() * 2 - 1;
      brown = (brown + 0.035 * white) / 1.035;
      data[i] = kind === 'brown' ? brown * 3.2 : white;
    }
    buffers.set(kind, buffer);
    return buffer;
  }

  function reverbImpulse() {
    if (impulse) return impulse;
    const length = Math.ceil(context.sampleRate * 1.65);
    impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const seconds = i / context.sampleRate;
        const onset = Math.min(1, Math.max(0, (seconds - 0.025) / 0.018));
        samples[i] = (rand() * 2 - 1) * Math.exp(-seconds * 4.8) * onset * 0.22;
      }
      for (const [delay, gain] of [[0.047, 0.38], [0.083, 0.24], [0.137, 0.13]]) {
        samples[Math.floor((delay + channel * 0.006) * context.sampleRate)] += gain;
      }
    }
    return impulse;
  }

  function prepareBuses() {
    if (!buses) {
      const dry = context.createGain(), wet = context.createGain();
      const convolver = context.createConvolver(), returnGain = context.createGain();
      convolver.buffer = reverbImpulse();
      returnGain.gain.setValueAtTime(0.24, context.currentTime);
      dry.connect(compressor);
      wet.connect(convolver); convolver.connect(returnGain); returnGain.connect(compressor);
      buses = { dry, wet, nodes: [dry, wet, convolver, returnGain] };
    }
    output.gain.cancelScheduledValues(context.currentTime);
    output.gain.setValueAtTime(OUTPUT_LEVEL, context.currentTime);
  }

  function envelope(parameter, at, duration, peak, attack, sustain) {
    parameter.setValueAtTime(0, at);
    parameter.linearRampToValueAtTime(peak, at + Math.min(attack, duration / 3));
    if (sustain) parameter.linearRampToValueAtTime(peak * 0.72, at + duration * sustain);
    parameter.exponentialRampToValueAtTime(FLOOR, at + duration);
    parameter.setValueAtTime(0, at + duration + 0.012);
  }

  function sourceVoice({ at, duration, gain, pan = 0, wet = 0.2, attack = 0.003,
    sustain = 0, frequency, endFrequency, type = 'sine', noise, filter, brass = false }) {
    while (voices.size >= MAX_SOURCES) release(voices.values().next().value, true);
    const nodes = [];
    let voice;
    try {
      const source = noise ? context.createBufferSource() : context.createOscillator();
      nodes.push(source);
      if (noise) {
        source.buffer = noiseBuffer(noise);
        source.loop = true;
      } else {
        source.type = type;
        if (brass && typeof context.createPeriodicWave === 'function') {
          brassWave ||= context.createPeriodicWave(new Float32Array(8), new Float32Array([0, 1, 0.48, 0.3, 0.16, 0.09, 0.05, 0.02]));
          source.setPeriodicWave(brassWave);
        }
        source.frequency.setValueAtTime(frequency, at);
        if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, at + duration * 0.8);
      }
      let tail = source;
      if (filter) {
        const tone = context.createBiquadFilter(); nodes.push(tone);
        tone.type = filter.type;
        tone.frequency.setValueAtTime(filter.frequency, at);
        tone.Q.setValueAtTime(filter.q ?? 0.7, at);
        if (filter.endFrequency) tone.frequency.exponentialRampToValueAtTime(filter.endFrequency, at + duration);
        tail.connect(tone); tail = tone;
      }
      const level = context.createGain(); nodes.push(level);
      envelope(level.gain, at, duration, Math.max(FLOOR, gain), attack, sustain);
      tail.connect(level); tail = level;
      if (typeof context.createStereoPanner === 'function') {
        const panner = context.createStereoPanner(); nodes.push(panner);
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), at);
        tail.connect(panner); tail = panner;
      }
      tail.connect(buses.dry);
      if (wet > 0) {
        const send = context.createGain(); nodes.push(send);
        send.gain.setValueAtTime(wet, at);
        tail.connect(send); send.connect(buses.wet);
      }
      voice = { source, nodes };
      voices.add(voice);
      source.onended = () => release(voice);
      if (noise) source.start(at, rand() * 1.5); else source.start(at);
      source.stop(at + duration + 0.025);
    } catch (error) {
      if (voice) release(voice, true); else nodes.forEach(disconnect);
      throw error;
    }
  }

  const noise = (at, duration, gain, frequency, options = {}) => sourceVoice({
    at, duration, gain, noise: 'white', filter: { type: 'lowpass', frequency }, ...options,
  });
  const tone = (at, duration, gain, frequency, options = {}) => sourceVoice({ at, duration, gain, frequency, ...options });
  function recordedVoice(cue, at) {
    const recording = RECORDINGS[cue], buffer = recordings.get(recording.file);
    if (!buffer) return false;
    const duration = Math.min(buffer.duration - recording.offset, recording.duration ?? Infinity);
    if (!(duration > 0)) return false;
    while (voices.size >= MAX_SOURCES) release(voices.values().next().value, true);
    const source = context.createBufferSource();
    const voice = { source, nodes: [source] };
    try {
      source.buffer = buffer;
      source.loop = false;
      source.playbackRate.setValueAtTime(1, at);
      // Only a constant per-file level correction precedes the common master.
      // Loading and firing retain the entire decoded recording, including tails.
      const level = context.createGain(); voice.nodes.push(level);
      level.gain.setValueAtTime(recording.gain, at);
      source.connect(level); level.connect(compressor);
      voices.add(voice);
      source.onended = () => release(voice);
      source.start(at, recording.offset, duration);
      source.stop(at + duration);
      return true;
    } catch (error) {
      if (voices.has(voice)) release(voice, true); else disconnect(source);
      throw error;
    }
  }

  function loadClose(at) {
    const loading = recordings.get(RECORDINGS.shellLoad.file), closing = recordings.get(RECORDINGS.breechClose.file);
    if (!loading || !closing || closing.duration <= RECORDINGS.breechClose.offset) return false;
    const loadingDuration = loading.duration;
    recordedVoice('shellLoad', at);
    recordedVoice('breechClose', at + loadingDuration + 0.02);
    return true;
  }

  function impact(at, pan = 0, scale = 1) {
    noise(at, 0.24, 0.72 * scale, 95, { noise: 'brown', filter: { type: 'bandpass', frequency: 86 + rand() * 25, q: 0.8 }, attack: 0.001, pan, wet: 0.18 });
    noise(at, 0.21, 0.50 * scale, 2400, { filter: { type: 'lowpass', frequency: 2400, endFrequency: 500 }, pan, wet: 0.24 });
    noise(at + 0.014, 0.30, 0.16 * scale, 1050, { filter: { type: 'bandpass', frequency: 1050, q: 0.45 }, pan, wet: 0.16 });
    noise(at + 0.037, 0.055, 0.105 * scale, 4000, { pan: Math.max(-1, pan - 0.13), wet: 0.14 });
    noise(at + 0.075, 0.07, 0.065 * scale, 2700, { pan: Math.min(1, pan + 0.16), wet: 0.16 });
    noise(at + 0.03, 0.76, 0.45 * scale, 180, { noise: 'brown', attack: 0.018, pan, wet: 0.34 });
  }

  function salvoImpact(at, count) {
    const blasts = Math.max(1, Math.min(MAX_SALVO_BLASTS, Number.isFinite(count) ? Math.floor(count) : 1));
    const scale = 0.94 / Math.sqrt(blasts);
    for (let i = 0; i < blasts; i++) {
      const position = blasts === 1 ? 0 : (i / (blasts - 1) * 2 - 1) * 0.78;
      // The cluster spans a few tens of milliseconds, rather than a machine-gun sequence.
      const offset = 0.04 + (i - (blasts - 1) / 2) * 0.009 + (rand() - 0.5) * 0.02;
      impact(at + offset, position, scale);
    }
  }

  function radio(at) {
    noise(at, 0.13, 0.07, 1800, { filter: { type: 'bandpass', frequency: 1750, q: 0.8 }, wet: 0, attack: 0.002 });
    tone(at + 0.012, 0.035, 0.016, 890, { type: 'triangle', wet: 0 });
    noise(at + 0.14, 0.029, 0.035, 3000, { filter: { type: 'highpass', frequency: 2400 }, wet: 0 });
  }

  function bugle(at, success) {
    // An original short phrase using a brass-like harmonic spectrum.
    const notes = success
      ? [[523.25, 0.13], [659.25, 0.13], [783.99, 0.25], [659.25, 0.13], [783.99, 0.15], [1046.5, 0.52]]
      : [[523.25, 0.22], [392, 0.23], [523.25, 0.16], [392, 0.48]];
    let cursor = at;
    for (const [frequency, length] of notes) {
      tone(cursor, length, 0.12, frequency, { type: 'sawtooth', brass: true, attack: 0.018, sustain: 0.72, wet: 0.32, filter: { type: 'lowpass', frequency: 2400, q: 0.5 } });
      noise(cursor, length * 0.7, 0.012, 2100, { filter: { type: 'bandpass', frequency: 1800, q: 0.4 }, attack: 0.015, wet: 0.12 });
      cursor += length + 0.035;
    }
  }

  function failure(at) {
    noise(at, 0.025, 0.08, 1600, { wet: 0 });
    noise(at + 0.015, 0.12, 0.16, 280, { noise: 'brown', wet: 0 });
    noise(at + 0.06, 0.065, 0.06, 430, { filter: { type: 'bandpass', frequency: 430, q: 1.3 }, wet: 0 });
    noise(at + 0.19, 0.025, 0.04, 1100, { wet: 0 });
  }

  function play(cue, options = {}) {
    if (!enabled || disposed || !context || context.state !== 'running') return false;
    const effects = { impact, salvoImpact, radio, bugle, failure };
    const recorded = Object.hasOwn(RECORDINGS, cue);
    if (!recorded && cue !== 'loadClose' && !Object.hasOwn(effects, cue)) return false;
    try {
      const at = context.currentTime + 0.008;
      if (recorded || cue === 'loadClose') {
        // A missing or still-loading clip is silent. Never synthesize a fallback
        // or replay a late asynchronous result after its visual phase passed.
        if (recorded && !recordings.has(RECORDINGS[cue].file)) return false;
        if (cue === 'loadClose' && (!recordings.has(RECORDINGS.shellLoad.file) || !recordings.has(RECORDINGS.breechClose.file))) return false;
        output.gain.cancelScheduledValues(context.currentTime);
        output.gain.setValueAtTime(OUTPUT_LEVEL, context.currentTime);
        return recorded ? recordedVoice(cue, at) : loadClose(at);
      }
      prepareBuses();
      if (cue === 'salvoImpact') salvoImpact(at, options?.count ?? 1);
      else if (cue === 'bugle') bugle(at, options?.success !== false);
      else effects[cue](at);
      return true;
    } catch {
      stopAll();
      return false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true; enabled = false;
    lifetimeAbort.abort();
    for (const request of requests) request.abort();
    requests.clear();
    stopAll();
    disconnect(compressor); disconnect(output);
    try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
    context = null; compressor = null; output = null;
    buffers.clear(); impulse = null; brassWave = null;
    recordingBytes.clear(); recordings.clear(); decoding.clear(); contextVersion++;
  }

  return { unlock, preload, prepare, setEnabled, play, stopAll, dispose };
}
