import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_LEVELS } from './dist/levels-general.js';
import { SPATIAL_LEVELS } from './dist/levels-spatial.js';
import { createBattle } from './dist/engine.js';
import { orderStagesSmt } from './dist/smt-engine.js';
import { checkSmt, shutdownZ3 } from './dist/z3-checker.js';

after(async () => shutdownZ3());

// Real Z3 proofs through the browser's staged order API. Shared CI runners get
// more time for nonlinear arithmetic; local runs keep the browser's deadline.
// No campaign answer, numeric input bound, or finite state scan can
// override a solver result here. Every definedness and logical query must be
// independently UNSAT for all mathematical integer inputs and loop states.
for (const level of [...GENERAL_LEVELS, ...SPATIAL_LEVELS]) {
  test(`${level.id}: Z3 proves initialization, preservation, and both exit obligations`, async t => {
    const checks = [];
    const check = async (...args) => {
      const start = performance.now();
      const result = await checkSmt(...args);
      checks.push({ status: result.status, reason: result.reason, ms: Math.round(performance.now() - start) });
      return result;
    };
    const timeoutMs = process.env.CI === 'true' ? 20000 : undefined;
    const iterator = orderStagesSmt(createBattle(level), level.solution, level.goalSolution, 'salvo', { check, timeoutMs });
    const stages = [];
    let result;
    for (;;) {
      const next = await iterator.next();
      if (next.done) { result = next.value; break; }
      stages.push(next.value.stage);
    }
    t.diagnostic(`Queries: ${checks.map(item => `${item.status}:${item.ms}ms${item.reason ? ` (${item.reason})` : ''}`).join(', ')}`);
    assert.deepEqual(stages, ['initial', 'preservation', 'goal'], JSON.stringify(result?.analysis));
    for (const stage of ['initial', 'preservation', 'goal', 'specification']) {
      assert.equal(result.analysis[stage].pass, true, `${stage}: ${JSON.stringify(result.analysis)}`);
      assert.equal(result.analysis[stage].status, 'unsat');
    }
    assert.equal(result.analysis.objectiveVerified, true);
    assert.equal(checks.length, 8, 'definedness and Boolean obligation each checked for all four stages');
    assert.ok(checks.every(item => item.status === 'unsat'));
  });
}
