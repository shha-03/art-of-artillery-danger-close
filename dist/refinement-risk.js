import {
  DOMAIN, analyze, battlefieldCasesForLevel, evaluate, initialStatesForLevel,
  isInitializedLevel, parseExpression,
} from './engine.js';

const point = ({ x, y }) => ({ x, y });
const key = ({ x, y }) => `${x},${y}`;
const inDomain = state => state && Number.isInteger(state.x) && Number.isInteger(state.y)
  && state.x >= DOMAIN.min && state.x <= DOMAIN.max
  && state.y >= DOMAIN.min && state.y <= DOMAIN.max;
const contains = (bounds, state) => state.x >= bounds.minX && state.x <= bounds.maxX
  && state.y >= bounds.minY && state.y <= bounds.maxY;
const sameBounds = (a, b) => a.minX === b.minX && a.maxX === b.maxX
  && a.minY === b.minY && a.maxY === b.maxY;
const extend = (bounds, state) => ({
  minX: Math.min(bounds.minX, state.x), maxX: Math.max(bounds.maxX, state.x),
  minY: Math.min(bounds.minY, state.y), maxY: Math.max(bounds.maxY, state.y),
});

/**
 * Measure a declared abstraction's friendly leakage, not intrinsic proof
 * difficulty. Each enemy receives the input group that actually terminates
 * there. Its executions are overapproximated by independent x/y intervals,
 * intersected with a verified reference invariant. Grow the intervals until
 * every reference/box/guard successor remains inside the box.
 *
 * Each resulting coarse invariant covers its own initial group; their union
 * covers ALL allowed inputs. No representative trace, distance, or shot order
 * participates in the measurement. Equal leakage deliberately gives equal
 * value, even when every enemy in a mission receives the same branch.
 */
export function computeRefinementRisks(level) {
  if (isInitializedLevel(level)) return initializedRefinementRisks(level);
  const fail = message => { throw new TypeError(`Refinement risk ${level?.id ?? 'level'}: ${message}`); };
  const inputs = initialStatesForLevel(level);
  // A semantically unrestricted precondition needs the true reference. The
  // campaign's normalization starter intentionally fails its initial check.
  const unrestricted = level.initialCondition !== undefined && inputs.length === DOMAIN.stateCount;
  const baselineSource = unrestricted ? 'true' : level.starter;
  if (typeof baselineSource !== 'string' || !baselineSource.trim()) fail('missing reference invariant.');
  const baselineCheck = analyze(baselineSource, 'true', level);
  if (baselineCheck.initial.pass !== true || baselineCheck.preservation.pass !== true) {
    fail('reference invariant must pass initiation and preservation.');
  }
  const baseline = parseExpression(baselineSource);
  const guard = parseExpression(level.guardSource);
  const occupied = new Set();
  const validateUnits = (units, label) => {
    if (!Array.isArray(units)) fail(`${label} must be a coordinate array.`);
    for (const unit of units) {
      if (!inDomain(unit) || unit.x < 0 || unit.x >= level.size || unit.y < 0 || unit.y >= level.size) {
        fail(`${label} must occupy board coordinates.`);
      }
      if (occupied.has(key(unit))) fail('unit coordinates must be distinct.');
      occupied.add(key(unit));
    }
  };
  validateUnits(level.enemies, 'enemies');
  validateUnits(level.allies, 'allies');
  if (!level.enemies.length) fail('at least one enemy endpoint is required.');
  const groups = new Map(level.enemies.map(enemy => [key(enemy), { initialCount: 0, bounds: null }]));

  // Enumerate the entire reference region once. Cached transitions are used
  // both for complete executions and for closure over unreachable states.
  const reference = [];
  const stateMap = new Map();
  for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
    for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
      const state = { x, y };
      if (!evaluate(baseline, state)) continue;
      const active = evaluate(guard, state);
      const after = active ? level.step(point(state)) : null;
      if (active && (!inDomain(after) || !evaluate(baseline, after))) {
        fail('reference transition escapes its invariant or the mathematical domain.');
      }
      const entry = { state, active, after: active ? point(after) : null };
      reference.push(entry);
      stateMap.set(key(state), entry);
    }
  }

  for (const initial of inputs) {
    let state = point(initial);
    const visited = new Set();
    const path = [];
    while (true) {
      const location = key(state);
      const entry = stateMap.get(location);
      if (!entry) fail('execution leaves the verified reference region.');
      if (visited.has(location)) fail('an allowed initial input has a nonterminating cycle.');
      visited.add(location);
      path.push(state);
      if (!entry.active) break;
      state = point(entry.after);
    }
    const group = groups.get(key(state));
    if (!group) fail('an actual terminal state has no matching enemy.');
    group.initialCount++;
    for (const position of path) {
      group.bounds = group.bounds ? extend(group.bounds, position) : {
        minX: position.x, maxX: position.x, minY: position.y, maxY: position.y,
      };
    }
  }

  return level.enemies.map(enemy => {
    const group = groups.get(key(enemy));
    if (!group.initialCount) fail('every enemy must be an actual endpoint of an allowed input.');
    let bounds = group.bounds;
    let iterations = 0;
    while (true) {
      let expanded = { ...bounds };
      for (const { state, active, after } of reference) {
        if (active && contains(bounds, state)) expanded = extend(expanded, after);
      }
      if (sameBounds(bounds, expanded)) break;
      bounds = expanded;
      iterations++;
      // Every strict expansion moves one integer bound outward. Verified
      // reference transitions remain in DOMAIN, so this is a defensive bound.
      if (iterations > 4 * (DOMAIN.max - DOMAIN.min)) fail('interval closure did not stabilize.');
    }
    const friendlies = level.allies.filter(ally => {
      const entry = stateMap.get(key(ally));
      return entry && !entry.active && contains(bounds, ally);
    }).map(point);
    const coarseInvariant = `(${baselineSource}) && x >= ${bounds.minX} && x <= ${bounds.maxX}`
      + ` && y >= ${bounds.minY} && y <= ${bounds.maxY}`;
    return {
      ...point(enemy), model: 'interval-refinement-v1', friendlyCount: friendlies.length,
      friendlies, bounds: { ...bounds }, baselineSource, coarseInvariant,
      initialCount: group.initialCount, iterations,
    };
  });
}

/**
 * Initialized programs have immutable input parameters. A box from one input
 * cannot be evaluated under another input's parameters. Compute each visible
 * context independently, then merge leaked friendly coordinates only when the
 * contexts have the same real endpoint. These are battlefield risk estimates;
 * they neither replace nor claim the verifier's separate 81-input coverage.
 */
function initializedRefinementRisks(level) {
  const fail = message => { throw new TypeError(`Refinement risk ${level?.id ?? 'level'}: ${message}`); };
  const baselineSource = level.referenceInvariant ?? level.starter;
  if (typeof baselineSource !== 'string' || !baselineSource.trim()) fail('missing reference invariant.');
  const baseline = parseExpression(baselineSource);
  const guard = parseExpression(level.guardSource);
  if (baseline.valueType !== 'boolean' || guard.valueType !== 'boolean') fail('reference and guard must be predicates.');
  if (!Array.isArray(level.enemies) || !level.enemies.length || !Array.isArray(level.allies)) {
    fail('enemy endpoints and friendly coordinates are required.');
  }
  const occupied = new Set();
  for (const unit of [...level.enemies, ...level.allies]) {
    if (!inDomain(unit) || unit.x < 0 || unit.x >= level.size || unit.y < 0 || unit.y >= level.size) {
      fail('units must occupy board coordinates.');
    }
    if (occupied.has(key(unit))) fail('unit coordinates must be distinct.');
    occupied.add(key(unit));
  }
  const groups = new Map(level.enemies.map(enemy => [key(enemy), []]));
  const inputs = battlefieldCasesForLevel(level);
  for (const initial of inputs) {
    const parameters = Object.fromEntries(['a', 'b', 'n', 'm'].map(name => [name, initial[name]]));
    if (!evaluate(baseline, initial)) fail('reference invariant must hold after initialization.');
    const reference = [];
    const stateMap = new Map();
    for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
      for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
        const state = { x, y, ...parameters };
        if (!evaluate(baseline, state)) continue;
        const active = evaluate(guard, state);
        let after = null;
        if (active) {
          const executionState = { ...state };
          for (const name of ['a', 'b', 'n', 'm']) Object.defineProperty(executionState, name, { writable: false });
          const output = level.step(executionState);
          if (!inDomain(output)) fail('reference transition escapes the verification window.');
          after = { ...point(output), ...parameters };
          if (!evaluate(baseline, after)) fail('reference invariant must be preserved in every battlefield context.');
        }
        const entry = { state, active, after };
        reference.push(entry);
        stateMap.set(key(state), entry);
      }
    }

    let state = { ...initial };
    let bounds = { minX: state.x, maxX: state.x, minY: state.y, maxY: state.y };
    const visited = new Set();
    while (true) {
      const location = key(state);
      const entry = stateMap.get(location);
      if (!entry) fail('execution leaves the verified reference region.');
      if (visited.has(location)) fail('a battlefield input has a nonterminating cycle.');
      visited.add(location);
      bounds = extend(bounds, state);
      if (!entry.active) break;
      state = entry.after;
    }
    const group = groups.get(key(state));
    if (!group) fail('an actual battlefield terminal state has no matching enemy.');
    let iterations = 0;
    while (true) {
      let expanded = { ...bounds };
      for (const entry of reference) {
        if (entry.active && contains(bounds, entry.state)) expanded = extend(expanded, entry.after);
      }
      if (sameBounds(bounds, expanded)) break;
      bounds = expanded;
      if (++iterations > 4 * (DOMAIN.max - DOMAIN.min)) fail('interval closure did not stabilize.');
    }
    const friendlies = level.allies.filter(ally => {
      const entry = stateMap.get(key(ally));
      return entry && !entry.active && contains(bounds, ally);
    }).map(point);
    const coarseInvariant = `(${baselineSource}) && x >= ${bounds.minX} && x <= ${bounds.maxX}`
      + ` && y >= ${bounds.minY} && y <= ${bounds.maxY}`;
    group.push({
      input: { a: initial.a, b: initial.b }, parameters, initial: point(initial),
      bounds: { ...bounds }, coarseInvariant, friendlies, iterations,
    });
  }
  return level.enemies.map(enemy => {
    const contexts = groups.get(key(enemy));
    if (!contexts.length) fail('every enemy must be an actual endpoint of a battlefield input.');
    const leaked = new Set(contexts.flatMap(context => context.friendlies.map(key)));
    const friendlies = level.allies.filter(ally => leaked.has(key(ally))).map(point);
    const bounds = contexts.reduce((result, context) => ({
      minX: Math.min(result.minX, context.bounds.minX), maxX: Math.max(result.maxX, context.bounds.maxX),
      minY: Math.min(result.minY, context.bounds.minY), maxY: Math.max(result.maxY, context.bounds.maxY),
    }), { ...contexts[0].bounds });
    const coarseInvariant = contexts.map(context =>
      `(a == ${context.input.a} && b == ${context.input.b} && (${context.coarseInvariant}))`).join(' || ');
    return {
      ...point(enemy), model: 'interval-refinement-v1', scope: 'battlefield-contexts',
      friendlyCount: friendlies.length, friendlies, bounds, baselineSource, coarseInvariant,
      initialCount: contexts.length, iterations: contexts.reduce((sum, context) => sum + context.iterations, 0),
      contexts,
    };
  });
}
