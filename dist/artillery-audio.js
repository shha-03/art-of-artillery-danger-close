// Original procedural effects: no recordings, external assets, or quoted music.
// The optional dependencies make scheduling/lifecycle tests independent of a browser.
const MAX_SOURCES = 48;
const MAX_SALVO_BLASTS = 6;
const OUTPUT_LEVEL = 0.62;
const FLOOR = 0.0001;

export function createArtilleryAudio({ contextFactory, random = Math.random } = {}) {
  let context = null, compressor = null, output = null, buses = null;
  let enabled = false, disposed = false, resumePending = null;
  let impulse = null, brassWave = null;
  const buffers = new Map();
  const voices = new Set();
  const rand = () => Math.max(0, Math.min(1, Number(random()) || 0));
  const disconnect = node => { try { node?.disconnect(); } catch {} };

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
      resumePending = Promise.resolve(resumed).then(
        () => !disposed && context === resumedContext && context.state === 'running',
        () => false,
      ).finally(() => { resumePending = null; });
      return resumePending;
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
  const metal = (at, weight = 1, pan = 0) => {
    tone(at, 0.16, 0.075 * weight, 720, { pan, wet: 0.13 });
    tone(at + 0.002, 0.105, 0.035 * weight, 1273, { pan, wet: 0.12 });
  };

  function breechOpen(at) {
    noise(at, 0.024, 0.14, 3400, { filter: { type: 'highpass', frequency: 1900 }, wet: 0.08 });
    metal(at + 0.008, 0.8, -0.16);
    noise(at + 0.045, 0.34, 0.16, 700, { filter: { type: 'bandpass', frequency: 630, endFrequency: 390, q: 0.6 }, attack: 0.025, sustain: 0.65, pan: -0.12, wet: 0.08 });
    tone(at + 0.06, 0.29, 0.085, 165, { endFrequency: 138, pan: -0.08, wet: 0.1 });
    noise(at + 0.37, 0.11, 0.19, 490, { noise: 'brown', pan: -0.15, wet: 0.12 });
    tone(at + 0.37, 0.14, 0.09, 228, { endFrequency: 181, wet: 0.15 });
  }

  function loadClose(at) {
    noise(at, 0.29, 0.13, 820, { filter: { type: 'bandpass', frequency: 540, q: 0.55 }, attack: 0.04, sustain: 0.6, pan: 0.12, wet: 0.06 });
    tone(at + 0.12, 0.10, 0.04, 880, { pan: 0.16, wet: 0.08 });
    noise(at + 0.24, 0.14, 0.12, 1400, { attack: 0.015, wet: 0.08 });
    noise(at + 0.39, 0.10, 0.27, 920, { noise: 'brown', wet: 0.18 });
    noise(at + 0.391, 0.022, 0.11, 3500, { wet: 0.1 });
    tone(at + 0.39, 0.23, 0.18, 177, { endFrequency: 142, wet: 0.18 });
    metal(at + 0.395, 0.68, 0.08);
  }

  function fire(at) {
    noise(at, 0.035, 0.36, 5500, { filter: { type: 'highpass', frequency: 1300 }, wet: 0.25 });
    noise(at + 0.002, 0.23, 0.46, 1900, { filter: { type: 'lowpass', frequency: 1900, endFrequency: 550 }, wet: 0.5 });
    tone(at, 0.72, 0.48, 118, { endFrequency: 33, wet: 0.32 });
    tone(at + 0.012, 0.23, 0.20, 62, { endFrequency: 27, wet: 0.15 });
    noise(at + 0.018, 1.45, 0.42, 180, { noise: 'brown', attack: 0.025, wet: 0.7 });
    noise(at + 0.08, 0.9, 0.15, 420, { noise: 'brown', pan: -0.2, wet: 0.55 });
    noise(at + 0.145, 0.22, 0.11, 1000, { pan: -0.58, wet: 0.4 });
    noise(at + 0.23, 0.31, 0.075, 700, { pan: 0.52, wet: 0.45 });
  }

  function impact(at, pan = 0, scale = 1) {
    tone(at, 0.61, 0.32 * scale, 86 + rand() * 25, { endFrequency: 31, pan, wet: 0.38 });
    noise(at, 0.24, 0.34 * scale, 1900, { filter: { type: 'lowpass', frequency: 2200, endFrequency: 500 }, pan, wet: 0.38 });
    noise(at + 0.014, 0.48, 0.16 * scale, 1500, { filter: { type: 'bandpass', frequency: 1250, q: 0.45 }, pan, wet: 0.23 });
    noise(at + 0.039, 0.055, 0.115 * scale, 4000, { pan: Math.max(-1, pan - 0.13), wet: 0.18 });
    noise(at + 0.076, 0.078, 0.075 * scale, 2700, { pan: Math.min(1, pan + 0.16), wet: 0.2 });
    noise(at + 0.03, 1.04, 0.28 * scale, 165, { noise: 'brown', attack: 0.035, pan, wet: 0.48 });
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
    noise(at, 0.07, 0.10, 800, { noise: 'brown', wet: 0.08 });
    tone(at + 0.015, 0.18, 0.085, 205, { endFrequency: 153, wet: 0.07 });
    tone(at + 0.06, 0.11, 0.035, 92, { type: 'sawtooth', filter: { type: 'lowpass', frequency: 420 }, wet: 0.04 });
    noise(at + 0.19, 0.04, 0.045, 1100, { wet: 0.03 });
  }

  function play(cue, options = {}) {
    if (!enabled || disposed || !context || context.state !== 'running') return false;
    const effects = { breechOpen, loadClose, fire, impact, salvoImpact, radio, bugle, failure };
    if (!Object.hasOwn(effects, cue)) return false;
    try {
      prepareBuses();
      const at = context.currentTime + 0.008;
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
    stopAll();
    disconnect(compressor); disconnect(output);
    try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
    context = null; compressor = null; output = null;
    buffers.clear(); impulse = null; brassWave = null;
  }

  return { unlock, setEnabled, play, stopAll, dispose };
}
