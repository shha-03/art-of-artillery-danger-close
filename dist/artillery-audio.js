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
  const metal = (at, weight = 1, pan = 0, length = 1) => {
    // Short, independently damped, non-harmonic noise resonances. These are
    // contact sounds rather than pitched oscillator notes or downward sweeps.
    noise(at, 0.055 * length, 0.075 * weight, 330, { filter: { type: 'bandpass', frequency: 330, q: 3.1 }, pan, wet: 0 });
    noise(at + 0.002, 0.045 * length, 0.05 * weight, 807, { filter: { type: 'bandpass', frequency: 807, q: 4.2 }, pan, wet: 0 });
    noise(at + 0.004, 0.03 * length, 0.03 * weight, 1469, { filter: { type: 'bandpass', frequency: 1469, q: 3.6 }, pan, wet: 0 });
  };

  function breechOpen(at) {
    // Unlock, drag along the guides, then meet the open stop. Mechanical cues
    // are dry so their actual end is bounded, without a shared reverb tail.
    noise(at, 0.018, 0.11, 3400, { filter: { type: 'highpass', frequency: 1700 }, wet: 0 });
    noise(at + 0.005, 0.035, 0.10, 450, { filter: { type: 'bandpass', frequency: 450, q: 0.9 }, wet: 0 });
    metal(at + 0.009, 0.7, -0.12);
    noise(at + 0.045, 0.24, 0.14, 630, { filter: { type: 'bandpass', frequency: 630, q: 0.7 }, attack: 0.02, sustain: 0.65, pan: -0.12, wet: 0 });
    noise(at + 0.11, 0.025, 0.055, 1450, { filter: { type: 'bandpass', frequency: 1450, q: 1 }, pan: -0.12, wet: 0 });
    noise(at + 0.205, 0.02, 0.045, 2900, { filter: { type: 'highpass', frequency: 1900 }, wet: 0 });
    noise(at + 0.315, 0.10, 0.23, 340, { noise: 'brown', pan: -0.15, wet: 0 });
    noise(at + 0.318, 0.05, 0.13, 270, { filter: { type: 'bandpass', frequency: 270, q: 0.9 }, wet: 0 });
    metal(at + 0.325, 0.45, -0.15);
  }

  function shellLoad(at) {
    // Sliding/ramming texture precedes the main seating impact near 300 ms.
    noise(at, 0.26, 0.16, 470, { filter: { type: 'bandpass', frequency: 470, q: 0.6 }, attack: 0.025, sustain: 0.65, pan: 0.12, wet: 0 });
    noise(at + 0.026, 0.20, 0.08, 1550, { filter: { type: 'bandpass', frequency: 1550, q: 0.5 }, attack: 0.035, sustain: 0.6, pan: 0.14, wet: 0 });
    noise(at + 0.105, 0.024, 0.06, 2100, { pan: 0.1, wet: 0 });
    noise(at + 0.18, 0.035, 0.07, 950, { filter: { type: 'bandpass', frequency: 950, q: 1.2 }, wet: 0 });
    noise(at + 0.292, 0.115, 0.29, 380, { noise: 'brown', pan: 0.08, wet: 0 });
    noise(at + 0.294, 0.07, 0.18, 310, { filter: { type: 'bandpass', frequency: 310, q: 0.8 }, wet: 0 });
    metal(at + 0.298, 0.6, 0.08);
    noise(at + 0.40, 0.065, 0.06, 760, { filter: { type: 'bandpass', frequency: 760, q: 0.7 }, wet: 0 });
    noise(at + 0.446, 0.035, 0.035, 1400, { wet: 0 });
  }

  function breechClose(at) {
    // A short closing movement, a heavy seat, then a separate locking latch.
    noise(at, 0.18, 0.12, 420, { filter: { type: 'bandpass', frequency: 420, q: 0.7 }, attack: 0.008, sustain: 0.65, wet: 0 });
    noise(at + 0.225, 0.09, 0.28, 390, { noise: 'brown', wet: 0 });
    noise(at + 0.227, 0.055, 0.24, 250, { filter: { type: 'bandpass', frequency: 250, q: 0.9 }, wet: 0 });
    noise(at + 0.226, 0.012, 0.12, 3400, { filter: { type: 'highpass', frequency: 1400 }, wet: 0 });
    metal(at + 0.231, 0.75, 0.06);
    noise(at + 0.32, 0.012, 0.13, 3300, { filter: { type: 'highpass', frequency: 1700 }, wet: 0 });
    noise(at + 0.321, 0.03, 0.08, 530, { filter: { type: 'bandpass', frequency: 530, q: 1.1 }, wet: 0 });
    metal(at + 0.32, 0.4, 0.06, 0.75);
  }

  function loadClose(at) {
    // Compatibility for older callers; new animation stages use separate cues.
    shellLoad(at);
    breechClose(at + 0.54);
  }

  function fire(at) {
    // A pressure impulse and broadband combustion, without a pitched bass dive.
    noise(at, 0.012, 0.34, 5500, { filter: { type: 'highpass', frequency: 1800 }, wet: 0.12 });
    noise(at + 0.001, 0.24, 1.04, 85, { noise: 'brown', filter: { type: 'bandpass', frequency: 85, q: 0.85 }, attack: 0.001, wet: 0.08 });
    noise(at + 0.002, 0.15, 0.63, 165, { filter: { type: 'bandpass', frequency: 165, q: 0.7 }, attack: 0.001, wet: 0.12 });
    noise(at + 0.004, 0.31, 0.72, 1950, { filter: { type: 'lowpass', frequency: 1950, endFrequency: 420 }, wet: 0.26 });
    noise(at + 0.02, 0.95, 0.62, 210, { noise: 'brown', attack: 0.015, wet: 0.42 });
    noise(at + 0.065, 0.60, 0.18, 640, { filter: { type: 'bandpass', frequency: 640, q: 0.5 }, pan: -0.15, wet: 0.3 });
    noise(at + 0.16, 0.18, 0.10, 950, { pan: -0.55, wet: 0.35 });
    noise(at + 0.26, 0.26, 0.07, 720, { pan: 0.5, wet: 0.4 });
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
    const effects = { breechOpen, shellLoad, breechClose, loadClose, fire, impact, salvoImpact, radio, bugle, failure };
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
