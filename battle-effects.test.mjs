import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleEffects, BATTLE_EFFECT_TIMING } from './dist/battle-effects.js';

// A small DOM boundary fake tests coordinates, lifecycle, and motion policy.
// Pixel rendering and the visual timeline are covered by the browser smoke test.
function environment({ reduced = false } = {}) {
  let now = 0, nextId = 1;
  const frames = new Map(), timers = new Map(), listeners = new Map();
  const observers = [];
  const mediaListeners = new Set();
  const media = { matches: reduced, addEventListener: (_, f) => mediaListeners.add(f), removeEventListener: (_, f) => mediaListeners.delete(f) };
  const window = {
    performance: { now: () => now }, matchMedia: () => media,
    requestAnimationFrame(f) { const id = nextId++; frames.set(id, f); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(f, delay) { const id = nextId++; timers.set(id, { f, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, f) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(f); },
    removeEventListener(name, f) { listeners.get(name)?.delete(f); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.connected = true; observers.push(this); }
      observe() {}
      disconnect() { this.connected = false; }
    },
  };
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attrs = new Map(); this.dataset = {}; this.style = {};
      this.rect = { left: 0, top: 0, width: 600, height: 700 }; this.ownerDocument = document;
      const classes = new Set();
      Object.defineProperty(this, 'className', { get: () => [...classes].join(' '), set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); } });
      this.classList = {
        add: (...values) => values.forEach(v => classes.add(v)), remove: (...values) => values.forEach(v => classes.delete(v)),
        contains: value => classes.has(value), toggle(value, on) { if (on ?? !classes.has(value)) classes.add(value); else classes.delete(value); },
      };
    }
    setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'class') this.className = value; }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    append(...elements) { elements.forEach(element => { element.remove(); element.parentNode = this; this.children.push(element); }); }
    before(element) { const parent = this.parentNode; element.remove(); element.parentNode = parent; parent.children.splice(parent.children.indexOf(this), 0, element); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    replaceChildren(...elements) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...elements); }
    getBoundingClientRect() { return { ...this.rect }; }
    get offsetWidth() { return this.rect.width; }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return Boolean(match && this.attrs.has(match[1]) && (match[2] === undefined || this.attrs.get(match[1]) === match[2]));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  const document = { defaultView: window, createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  const grid = document.createElement('div');
  const battlefield = document.createElement('section');
  battlefield.rect = { left: 70, top: 130, width: 600, height: 700 };
  const status = document.createElement('div'); status.className = 'map-status'; battlefield.append(grid, status);
  const cells = new Map();
  for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) {
    const cell = document.createElement('button'); cell.setAttribute('data-cell', `${x},${y}`);
    cell.rect = { left: 106 + x * 54, top: 190 + (8 - y) * 54, width: 52, height: 52 };
    grid.append(cell); cells.set(`${x},${y}`, cell);
  }
  return {
    grid, battlefield, status, cells, frames, timers, observers, mediaListeners, listeners,
    advance(time) {
      now = time;
      const pendingFrames = [...frames.values()]; frames.clear(); pendingFrames.forEach(f => f(now));
      for (const [id, item] of [...timers]) if (item.due <= now) { timers.delete(id); item.f(); }
    },
    motion(matches) { media.matches = matches; mediaListeners.forEach(f => f({ matches })); },
    resize() { observers.filter(o => o.connected).forEach(o => o.callback()); },
  };
}

test('effects use actual cell rectangles and survive grid rerender and resize', () => {
  const env = environment();
  const effects = createBattleEffects(env);
  const target = env.cells.get('3,5');
  target.rect = { left: 207, top: 351, width: 44, height: 38 };
  effects.launch([{ x: 3, y: 5 }], { size: 9 });
  assert.equal(env.frames.size, 1);
  assert.equal(env.battlefield.querySelectorAll('.fx-projectile').length, 1);
  env.advance(330);
  assert.match(env.battlefield.querySelector('.fx-shell').getAttribute('transform'), /^translate\(/);
  // Replacing map cells must not destroy the sibling effects layer.
  env.grid.replaceChildren(target);
  assert.ok(env.battlefield.querySelector('.fx-battle-layer'));
  effects.impact([{ x: 3, y: 5 }], { size: 9 });
  const anchor = env.battlefield.querySelector('.fx-impact-anchor');
  assert.equal(anchor.getAttribute('transform'), 'translate(159 240)');
  target.rect.left = 257;
  env.resize();
  assert.equal(anchor.getAttribute('transform'), 'translate(209 240)');
  assert.equal(env.frames.size, 0);
  effects.dispose();
});

test('clear and dispose cancel pending work and remove the effects layer', () => {
  const env = environment();
  const effects = createBattleEffects(env);
  effects.launch([{ x: 0, y: 0 }]);
  effects.radio();
  assert.equal(env.status.classList.contains('fx-radio-pulse'), true);
  effects.clear();
  assert.equal(env.frames.size, 0);
  assert.equal(env.timers.size, 0);
  assert.equal(env.status.classList.contains('fx-radio-pulse'), false);
  env.advance(10000);
  assert.equal(env.battlefield.querySelectorAll('.fx-projectile').length, 0);
  effects.dispose(); effects.dispose();
  assert.equal(env.battlefield.querySelector('.fx-battle-layer'), null);
  assert.equal(env.mediaListeners.size, 0);
  assert.equal(env.listeners.get('resize').size, 0);
  assert.ok(env.observers.every(observer => !observer.connected));
});

test('a full 81-cell salvo remains bounded and cleans up after flight and impact', () => {
  const env = environment();
  const effects = createBattleEffects(env);
  const shots = Array.from(env.cells.keys(), key => { const [x, y] = key.split(',').map(Number); return { x, y }; });
  effects.launch([...shots, ...shots, { x: -1, y: 3 }, { x: 20, y: 0 }], { mode: 'salvo', size: 9 });
  assert.equal(env.battlefield.querySelectorAll('.fx-projectile').length, 81);
  env.advance(BATTLE_EFFECT_TIMING.flight);
  assert.equal(env.battlefield.querySelectorAll('.fx-projectile').length, 0);
  assert.equal(env.frames.size, 0);
  effects.impact(shots, { mode: 'salvo', size: 9 });
  assert.equal(env.battlefield.querySelectorAll('.fx-impact-anchor').length, 81);
  env.advance(BATTLE_EFFECT_TIMING.flight + BATTLE_EFFECT_TIMING.impact);
  assert.equal(env.battlefield.querySelectorAll('.fx-impact-anchor').length, 0);
  effects.dispose();
});

test('reduced motion uses static markers and reacts to a preference change during flight', () => {
  const env = environment({ reduced: true });
  const effects = createBattleEffects(env);
  effects.launch([{ x: 2, y: 4 }]);
  assert.equal(env.frames.size, 0);
  assert.equal(env.battlefield.querySelectorAll('.fx-reduced-target').length, 1);
  effects.impact([{ x: 2, y: 4 }]);
  assert.equal(env.battlefield.querySelectorAll('.fx-dust').length, 0);
  assert.equal(env.battlefield.querySelectorAll('.fx-sparks').length, 0);
  env.motion(false);
  effects.launch([{ x: 1, y: 1 }]);
  assert.equal(env.frames.size, 1);
  env.motion(true);
  assert.equal(env.frames.size, 0);
  assert.equal(env.battlefield.querySelectorAll('.fx-projectile').length, 0);
  assert.equal(env.battlefield.querySelectorAll('.fx-reduced-target').length, 1);
  assert.equal(env.battlefield.querySelector('.fx-battle-layer').getAttribute('aria-hidden'), 'true');
  effects.dispose();
});
