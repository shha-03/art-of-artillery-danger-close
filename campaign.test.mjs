import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { LEVELS, CHAPTERS } from './dist/levels.js';
import { DOMAIN, analyze, evaluate, parseExpression } from './dist/engine.js';

const pairs = values => values.map(([x, y]) => ({ x, y }));
const keys = values => values.map(({ x, y }) => `${x},${y}`).sort();
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
// Mathematical results are independent of the displayed loop and its step function.
const specifications = {
  '06': { inputs: [[0, 2], [0, 3], [0, 4]], result: ({ y }) => ({ x: y, y }) },
  '07': { inputs: [[4, 2], [7, 3], [7, 1]], result: ({ x, y }) => ({ x: x - y, y: 0 }) },
  '08': { inputs: [[-2, 0], [4, 0], [-6, 0]], result: ({ x, y }) => ({ x: 0, y: y + Math.abs(x) }) },
  '09': { inputs: [[1, 0], [2, 0], [3, 0]], result: ({ x, y }) => ({ x: 0, y: y + 2 * x }) },
  '10': { inputs: [[3, 3], [4, 4], [5, 5]], result: ({ x, y }) => ({ x, y: y % 2 }) },
  '11': { inputs: [[0, 0], [4, 4], [8, 8]], result: ({ x, y }) => ({ x: Math.max(2, Math.min(6, x)), y }) },
  '12': { inputs: [[5, 1], [6, 2], [8, 2]], result: ({ x, y }) => ({ x: (x + y) / 2, y: (x + y) / 2 }) },
  '13': { inputs: [[0, 0], [1, 0], [2, 0]], result: ({ x, y }) => ({ x: 3, y: (y + 1) * 2 ** (3 - x) - 1 }) },
  '14': { inputs: [[0, 0], [1, 0], [2, 0]], result: ({ x, y }) => ({ x: 0, y: y + x * x }) },
  '15': { inputs: [[-1, 0], [0, -2], [0, 3]], result: ({ x, y }) => ({ x: Math.sqrt(x * x + y * y), y: 0 }) },
  '16': { inputs: [[6, 1], [12, 1], [24, 1]], result: ({ x, y }) => {
    const factor = 2 ** Math.log2(x & -x);
    return { x: x / factor, y: y * factor };
  } },
  '17': { inputs: [[0, 8], [4, 8], [5, 8]], result: ({ x }) => ({ x: Math.max(3, x), y: Math.max(3, x) }) },
  '18': { inputs: [[6, 4], [6, 3], [8, 4]], result: ({ x, y }) => ({ x: gcd(x, y), y: gcd(x, y) }) },
  '19': { inputs: [[1, 1], [2, 2], [3, 3]], result: ({ x: scale }) => {
    const fibonacci = [1, 1, 2, 3, 5, 8];
    const index = fibonacci.findIndex((n, i) => i > 0 && n * scale >= 5);
    return { x: fibonacci[index - 1] * scale, y: fibonacci[index] * scale };
  } },
  '20': { inputs: [[1, 0], [0, 1], [2, 0]], result: ({ x, y }) => {
    // Independently tabulated small Pell pairs for these three seeds.
    return { '1,0': { x: 7, y: 5 }, '0,1': { x: 4, y: 3 }, '2,0': { x: 6, y: 4 } }[`${x},${y}`];
  } },
};

test('twenty stable mission IDs form five localized chapters in learning order', () => {
  assert.equal(LEVELS.length, 20);
  assert.deepEqual(LEVELS.map(l => l.id).sort(), Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')));
  assert.deepEqual(LEVELS.map(l => l.id), ['06', '01', '07', '09', '11', '08', '12', '05', '10', '02', '03', '14', '04', '16', '13', '15', '17', '18', '19', '20']);
  assert.deepEqual(CHAPTERS.map(c => c.id), [1, 2, 3, 4, 5]);
  for (const chapter of CHAPTERS) {
    assert.equal(LEVELS.filter(l => l.chapter === chapter.id).length, 4);
    for (const copy of [chapter, chapter.en]) for (const field of ['name', 'description']) assert.ok(copy[field]?.trim());
  }
  for (const level of LEVELS) {
    for (const copy of [level, level.en]) {
      for (const field of ['name', 'brief', 'concept']) assert.ok(copy[field]?.trim(), `${level.id}: ${field}`);
      assert.equal(copy.hints.length, 3);
      assert.ok(copy.hints.every(hint => hint.trim()));
    }
  }
});

for (const level of LEVELS.filter(l => specifications[l.id])) {
  test(`${level.id}: displayed algorithm, execution, ensures and targets match the independent result`, () => {
    const spec = specifications[level.id];
    assert.deepEqual(level.initialStates, pairs(spec.inputs));
    const expected = level.initialStates.map(spec.result);
    const report = analyze(level.solution, level.goalSolution, level);
    assert.equal(report.error, undefined);
    assert.equal(report.valid, true);
    assert.equal(report.goal.pass, true);
    assert.equal(report.checkedStateCount, DOMAIN.stateCount);
    assert.deepEqual(keys(report.candidates), keys(expected));
    assert.deepEqual(keys(level.enemies), keys(expected));
    const program = new Script(level.code);
    for (let i = 0; i < level.initialStates.length; i++) {
      const context = { ...level.initialStates[i] };
      program.runInNewContext(context, { timeout: 100 });
      // Integer coordinates identify -0 and 0 as the same location.
      assert.deepEqual({ x: context.x + 0, y: context.y + 0 }, expected[i]);
      assert.equal(report.traces[i].traceStatus, 'terminated');
      assert.deepEqual(keys([report.traces[i].trace.at(-1)]), keys([expected[i]]));
    }
    const goal = parseExpression(level.goalSolution);
    const goalStates = [];
    for (let x = DOMAIN.min; x <= DOMAIN.max; x++) for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
      if (evaluate(goal, { x, y })) goalStates.push({ x, y });
    }
    assert.deepEqual(keys(goalStates), keys(expected), 'ensures has no extra or missing results');
    const starter = analyze(level.starter, level.goalSolution, level);
    assert.equal(starter.valid, true);
    assert.equal(starter.goal.pass, false);
    assert.ok(starter.candidates.some(p => keys(level.allies).includes(`${p.x},${p.y}`)));
  });

  test(`${level.id}: displayed guard and one iteration match the verifier throughout its domain`, () => {
    // Trusted repository code only; replace the outer loop with one guarded step.
    assert.match(level.code, /^while\s*\(/);
    const oneStep = new Script(level.code.replace(/^while/, 'if'));
    const context = createContext({ x: 0, y: 0 });
    const guard = parseExpression(level.guardSource);
    for (let x = DOMAIN.min; x <= DOMAIN.max; x++) for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
      context.x = x;
      context.y = y;
      oneStep.runInContext(context);
      const expected = evaluate(guard, { x, y }) ? level.step({ x, y }) : { x, y };
      assert.deepEqual({ x: context.x + 0, y: context.y + 0 }, { x: expected.x + 0, y: expected.y + 0 }, `state (${x},${y})`);
    }
  });
}
