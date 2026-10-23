/** Decorative firing effects. Verification, shot selection, and timing belong
 * to app.js; this module never changes game state or announces duplicate text. */
export const BATTLE_EFFECT_TIMING = Object.freeze({ flight: 620, impact: 680, radio: 720 });

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * The overlay is a sibling of grid, surviving grid.innerHTML replacement.
 * All target positions come from the current data-cell elements, never from
 * assumptions about axis direction, cell spacing, or responsive breakpoints.
 * Methods are synchronous; launch() finishes its visible flight within 620ms.
 */
export function createBattleEffects({ grid, battlefield }) {
  if (!grid || !battlefield) throw new TypeError('Battle effects require grid and battlefield.');
  const document = grid.ownerDocument;
  const window = document.defaultView;
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(media?.matches);
  let disposed = false;
  let frame = null;
  let generation = 0;
  let flights = [];
  let bursts = [];
  let geometry = { width: 1, height: 1 };
  const timers = new Set();
  const svg = (tag, attrs = {}) => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
    return element;
  };
  const later = (callback, delay) => {
    const token = generation;
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed && token === generation) callback();
    }, delay);
    timers.add(timer);
    return timer;
  };
  const layer = svg('svg', {
    class: 'fx-battle-layer', 'aria-hidden': 'true', focusable: 'false',
    preserveAspectRatio: 'none', viewBox: '0 0 1 1',
  });
  const flightLayer = svg('g', { class: 'fx-flight-layer' });
  const impactLayer = svg('g', { class: 'fx-impact-layer' });
  layer.append(flightLayer, impactLayer);
  battlefield.append(layer);
  battlefield.classList.add('fx-effects-enabled');

  const selectedShots = (shots, size) => {
    const limit = Number.isInteger(size) && size > 0 ? size : 9;
    const unique = new Map();
    for (const shot of Array.isArray(shots) ? shots : []) {
      if (!Number.isInteger(shot?.x) || !Number.isInteger(shot?.y)
        || shot.x < 0 || shot.y < 0 || shot.x >= limit || shot.y >= limit) continue;
      unique.set(`${shot.x},${shot.y}`, { x: shot.x, y: shot.y });
      if (unique.size >= 81) break;
    }
    return [...unique.values()];
  };
  const positionFor = (shot) => {
    const cell = grid.querySelector(`[data-cell="${shot.x},${shot.y}"]`);
    if (!cell) return null;
    const fieldRect = battlefield.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    if (!fieldRect.width || !fieldRect.height || !cellRect.width || !cellRect.height) return null;
    return {
      x: cellRect.left + cellRect.width / 2 - fieldRect.left,
      y: cellRect.top + cellRect.height / 2 - fieldRect.top,
      cellSize: Math.min(cellRect.width, cellRect.height),
    };
  };
  const updateGeometry = () => {
    if (disposed) return;
    const rect = battlefield.getBoundingClientRect();
    geometry = { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
    layer.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
    for (const item of [...flights, ...bursts]) {
      const target = positionFor(item.shot);
      if (!target) { item.node.style.visibility = 'hidden'; continue; }
      item.node.style.visibility = '';
      item.target = target;
      if (item.burst || item.reduced) item.node.setAttribute('transform', `translate(${target.x} ${target.y})`);
    }
  };
  const cancelFlightFrame = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
  };
  const wipeFlights = () => {
    cancelFlightFrame();
    flights = [];
    flightLayer.replaceChildren();
  };
  const wipeBursts = () => {
    bursts = [];
    impactLayer.replaceChildren();
  };
  const curveAt = (start, control, end, progress) => {
    const inverse = 1 - progress;
    return {
      x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
    };
  };
  const drawFlight = (item, progress) => {
    const target = item.target;
    if (!target) return;
    const drift = clamp(geometry.width * .13, 28, 96) * (item.index % 2 ? .8 : 1);
    const start = { x: clamp(target.x - drift, 10, geometry.width - 10), y: -24 };
    const control = { x: target.x - drift * .15, y: target.y * .28 - 18 };
    const position = curveAt(start, control, target, progress);
    const trailStart = Math.max(0, progress - .21);
    const tail = curveAt(start, control, target, trailStart);
    const interval = progress - trailStart;
    const tangent = {
      x: 2 * ((1 - trailStart) * (control.x - start.x) + trailStart * (target.x - control.x)),
      y: 2 * ((1 - trailStart) * (control.y - start.y) + trailStart * (target.y - control.y)),
    };
    const trailControl = { x: tail.x + tangent.x * interval / 2, y: tail.y + tangent.y * interval / 2 };
    const path = `M${tail.x} ${tail.y} Q${trailControl.x} ${trailControl.y} ${position.x} ${position.y}`;
    item.trail.setAttribute('d', path);
    item.halo.setAttribute('d', path);
    const angle = Math.atan2(
      (1 - progress) * (control.y - start.y) + progress * (target.y - control.y),
      (1 - progress) * (control.x - start.x) + progress * (target.x - control.x),
    ) * 180 / Math.PI - 90;
    const scale = clamp(target.cellSize / 42, .7, 1.18) * (item.dense ? .82 : 1);
    item.shell.setAttribute('transform', `translate(${position.x} ${position.y}) rotate(${angle}) scale(${scale})`);
  };
  const tickFlight = (time) => {
    frame = null;
    if (disposed || reduced) return;
    let active = false;
    for (const item of flights) {
      const elapsed = time - item.started - item.delay;
      if (elapsed < 0) { active = true; continue; }
      const progress = clamp(elapsed / 500, 0, 1);
      item.node.style.opacity = progress < 1 ? '1' : '0';
      drawFlight(item, progress);
      if (progress < 1) active = true;
    }
    if (active) frame = window.requestAnimationFrame(tickFlight);
    else wipeFlights();
  };
  const makeReducedTarget = (shot, index) => {
    const target = positionFor(shot);
    if (!target) return;
    const node = svg('g', { class: 'fx-reduced-target', transform: `translate(${target.x} ${target.y})` });
    const radius = clamp(target.cellSize * .28, 7, 17);
    node.append(svg('circle', { r: radius }), svg('path', { d: `M${-radius - 4} 0H${-radius + 1}M${radius - 1} 0H${radius + 4}M0 ${-radius - 4}V${-radius + 1}M0 ${radius - 1}V${radius + 4}` }));
    flightLayer.append(node);
    flights.push({ shot, index, target, node, reduced: true });
  };
  const launch = (shots, { mode = 'single', size = 9 } = {}) => {
    if (disposed) return;
    wipeFlights();
    wipeBursts();
    updateGeometry();
    const selected = selectedShots(shots, size);
    const started = window.performance.now();
    if (reduced) {
      selected.forEach(makeReducedTarget);
      return;
    }
    selected.forEach((shot, index) => {
      const target = positionFor(shot);
      if (!target) return;
      const node = svg('g', { class: `fx-projectile${selected.length > 18 ? ' fx-dense' : ''}` });
      node.style.opacity = '0';
      const halo = svg('path', { class: 'fx-trail-halo' });
      const trail = svg('path', { class: 'fx-trail-core' });
      const shell = svg('g', { class: 'fx-shell' });
      shell.append(
        svg('path', { class: 'fx-shell-body', d: 'M-3-9H3C5-4 5 4 0 11C-5 4-5-4-3-9Z' }),
        svg('path', { class: 'fx-shell-band', d: 'M-4-4H4M-3-8-7-12H7L3-8' }),
      );
      node.append(halo, trail, shell);
      flightLayer.append(node);
      flights.push({ shot, index, target, node, halo, trail, shell, started, delay: 80 + (mode === 'salvo' ? index % 4 * 7 : 0), dense: selected.length > 18 });
    });
    if (flights.length) frame = window.requestAnimationFrame(tickFlight);
  };
  const impact = (shots, { mode = 'single', size = 9 } = {}) => {
    if (disposed) return;
    wipeFlights();
    wipeBursts();
    updateGeometry();
    const selected = selectedShots(shots, size);
    selected.forEach((shot, index) => {
      const target = positionFor(shot);
      if (!target) return;
      const dense = selected.length > 18;
      const node = svg('g', { class: `fx-impact-anchor${dense ? ' fx-dense' : ''}${reduced ? ' fx-reduced-impact' : ''}`, transform: `translate(${target.x} ${target.y})` });
      const burst = svg('g', { class: 'fx-burst' });
      const scale = clamp(target.cellSize / 42, .7, 1.25) * (mode === 'single' ? 1.15 : 1);
      burst.setAttribute('transform', `scale(${scale})`);
      burst.append(svg('circle', { class: 'fx-shockwave', r: 12 }), svg('circle', { class: 'fx-impact-core', r: 6 }));
      if (!reduced) {
        const dust = svg('g', { class: 'fx-dust' });
        dust.append(svg('ellipse', { cx: -8, cy: 1, rx: 10, ry: 6 }), svg('ellipse', { cx: 8, cy: 3, rx: 12, ry: 7 }));
        if (!dense) dust.append(svg('ellipse', { cx: 1, cy: -4, rx: 9, ry: 7 }));
        const sparks = svg('g', { class: 'fx-sparks', transform: `rotate(${index * 37 % 90})` });
        sparks.append(svg('path', { d: dense ? 'M-8-7-15-14M8 6 16 12' : 'M-8-7-17-15M8-7 16-15M-7 7-15 15M8 6 18 13' }));
        burst.append(dust, sparks);
      }
      node.append(burst);
      impactLayer.append(node);
      bursts.push({ shot, target, node, burst: true });
    });
    const current = bursts;
    later(() => { if (bursts === current) wipeBursts(); }, BATTLE_EFFECT_TIMING.impact);
  };
  const radio = () => {
    if (disposed) return;
    const status = battlefield.querySelector('.map-status');
    if (!status) return;
    status.classList.remove('fx-radio-pulse');
    // Restart a one-shot pulse without applying a transform to the status text.
    void status.offsetWidth;
    status.classList.add('fx-radio-pulse');
    later(() => status.classList.remove('fx-radio-pulse'), BATTLE_EFFECT_TIMING.radio);
  };
  const clear = () => {
    if (disposed) return;
    generation++;
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    wipeFlights();
    wipeBursts();
    battlefield.querySelector('.map-status')?.classList.remove('fx-radio-pulse');
  };
  const onMotionChange = (event) => {
    reduced = Boolean(event.matches);
    layer.classList.toggle('fx-reduced-motion', reduced);
    if (reduced && flights.length) {
      const shots = flights.map(item => item.shot);
      wipeFlights();
      shots.forEach(makeReducedTarget);
    }
  };
  if (media?.addEventListener) media.addEventListener('change', onMotionChange);
  else media?.addListener?.(onMotionChange);
  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(updateGeometry) : null;
  observer?.observe(battlefield);
  observer?.observe(grid);
  window.addEventListener('resize', updateGeometry);
  const dispose = () => {
    if (disposed) return;
    clear();
    disposed = true;
    observer?.disconnect();
    window.removeEventListener('resize', updateGeometry);
    if (media?.removeEventListener) media.removeEventListener('change', onMotionChange);
    else media?.removeListener?.(onMotionChange);
    layer.remove();
    battlefield.classList.remove('fx-effects-enabled');
  };
  onMotionChange({ matches: reduced });
  updateGeometry();
  return { launch, impact, radio, clear, dispose };
}
