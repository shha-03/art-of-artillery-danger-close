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
 * Every valid invariant includes all actual enemy endpoints. With exact fire,
 * neutral/friendly cells are absent and singles hit enemies in x-then-y order.
 * Assign higher values to endpoints requiring more single-shot orders. This is
 * targeting order, not a claim about geometric distance or proof complexity.
 */
export function withUnitBranches(level) {
  const branches = ['infantry', 'armor', 'artillery'];
  const attach = (units, enemies) => {
    if (units.length !== branches.length) throw new TypeError('Campaign missions require three units per side.');
    const sorted = [...units].sort((a, b) => a.x - b.x || a.y - b.y);
    const ranks = new Map(sorted.map((unit, index) => [`${unit.x},${unit.y}`, index]));
    return units.map(unit => {
      const rank = ranks.get(`${unit.x},${unit.y}`);
      return { ...unit, branch: branches[rank], ...(enemies ? { targetingRisk: { shotRank: rank + 1 } } : {}) };
    });
  };
  return { ...level, enemies: attach(level.enemies, true), allies: attach(level.allies, false) };
}
