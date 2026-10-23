// Game point values are balancing choices, independent of NATO symbology.
export const UNIT_TYPES = Object.freeze({
  infantry: Object.freeze({ name: '보병', en: Object.freeze({ name: 'Infantry' }), points: 2 }),
  armor: Object.freeze({ name: '기갑', en: Object.freeze({ name: 'Armor' }), points: 4 }),
  artillery: Object.freeze({ name: '포병', en: Object.freeze({ name: 'Artillery' }), points: 6 }),
});

// Legacy untyped coordinates retain their one-point value. The engine validates
// branch identifiers; an arbitrary unit.points field never overrides the catalog.
export function unitPoints(unit) {
  if (unit?.branch === undefined) return 1;
  if (!Object.hasOwn(UNIT_TYPES, unit.branch)) throw new TypeError('Unknown unit branch.');
  return UNIT_TYPES[unit.branch].points;
}

/** APP-6 land-unit frame plus a branch icon, shared by map and branch legend. */
export function unitSymbol(affiliation, branch, className = 'unit-icon') {
  const hostile = affiliation === 'enemy';
  const frame = hostile
    ? '<path d="M24 3 45 24 24 45 3 24Z" fill="#ff8080"/>'
    : '<rect x="3" y="10" width="42" height="28" fill="#80e0ff"/>';
  const symbols = {
    infantry: hostile
      ? '<path d="M13.5 13.5 34.5 34.5M34.5 13.5 13.5 34.5"/>'
      : '<path d="M3 10 45 38M45 10 3 38"/>',
    armor: '<ellipse cx="24" cy="24" rx="13" ry="8"/>',
    artillery: '<circle cx="24" cy="24" r="4" fill="#000"/>',
  };
  const icon = Object.hasOwn(symbols, branch) ? symbols[branch] : '';
  // Classes are supplied only by application code, but escape the attribute too.
  const escapedClass = String(className).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<svg class="${escapedClass}" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g stroke="#000" stroke-width="2.5" stroke-linejoin="miter">${frame}<g fill="none">${icon}</g></g></svg>`;
}

/**
 * Enemy values follow friendly leakage under the declared interval abstraction:
 * zero, one, or at least two leaked allies map to 2, 4, or 6 points. Equal counts
 * stay equal; no distance or firing-order tie-breaker is applied. Friendly branch
 * assignments retain the stable coordinate ordering used by earlier campaigns.
 */
export function withUnitBranches(level, risks) {
  const branches = ['infantry', 'armor', 'artillery'];
  const key = ({ x, y }) => `${x},${y}`;
  if (!Array.isArray(level.enemies) || !Array.isArray(level.allies)
    || level.enemies.length < 1 || level.enemies.length > branches.length || level.allies.length !== branches.length) {
    throw new TypeError('Campaign missions require one to three unique enemies and three allies.');
  }
  if (!Array.isArray(risks) || risks.length !== level.enemies.length) {
    throw new TypeError('Every enemy requires one refinement-risk result.');
  }
  const enemyLocations = new Set(level.enemies.map(key));
  const allyLocations = new Set(level.allies.map(key));
  if (allyLocations.size !== level.allies.length || [...allyLocations].some(location => enemyLocations.has(location))) {
    throw new TypeError('Enemy and friendly coordinates must be distinct.');
  }
  const riskByLocation = new Map();
  for (const risk of risks) {
    const location = key(risk);
    if (!enemyLocations.has(location) || riskByLocation.has(location)) {
      throw new TypeError('Refinement-risk coordinates must match enemies exactly once.');
    }
    if (risk.model !== 'interval-refinement-v1' || !Number.isInteger(risk.friendlyCount)
      || risk.friendlyCount < 0 || !Array.isArray(risk.friendlies)
      || risk.friendlies.length !== risk.friendlyCount
      || new Set(risk.friendlies.map(key)).size !== risk.friendlyCount
      || risk.friendlies.some(ally => !allyLocations.has(key(ally)))) {
      throw new TypeError('Refinement-risk friendly witnesses must match their count and the layout.');
    }
    riskByLocation.set(location, risk);
  }
  if (enemyLocations.size !== level.enemies.length || riskByLocation.size !== enemyLocations.size) {
    throw new TypeError('Refinement-risk coordinates must match enemies exactly once.');
  }
  const copyEvidence = value => Array.isArray(value) ? value.map(copyEvidence)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, copyEvidence(item)]))
      : value;
  const enemies = level.enemies.map(unit => {
    const { x, y, ...risk } = riskByLocation.get(key(unit));
    return { ...unit, branch: branches[Math.min(risk.friendlyCount, 2)], targetingRisk: copyEvidence(risk) };
  });
  const sortedAllies = [...level.allies].sort((a, b) => a.x - b.x || a.y - b.y);
  const allyBranches = new Map(sortedAllies.map((unit, index) => [key(unit), branches[index]]));
  const allies = level.allies.map(unit => ({ ...unit, branch: allyBranches.get(key(unit)) }));
  return { ...level, enemies, allies };
}
