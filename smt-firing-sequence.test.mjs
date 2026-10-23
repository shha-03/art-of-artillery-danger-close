import test from 'node:test';
import assert from 'node:assert/strict';
import { runFiringSequence } from './dist/firing-sequence.js';

test('the firing presentation awaits asynchronous proof stages before advancing', async () => {
  const events = [], checks = [];
  const result = { shots: [{ x: 0, y: 2 }], cost: 1 };
  async function* stages() {
    const analysis = {};
    for (const stage of ['initial', 'preservation', 'goal']) {
      await Promise.resolve();
      checks.push(stage);
      analysis[stage] = { pass: true };
      yield { stage, analysis: structuredClone(analysis) };
    }
    return result;
  }
  const returned = await runFiringSequence({ iterator: stages(), mode: 'salvo',
    onEvent: event => events.push(event), wait: async () => {} });
  assert.equal(returned, result);
  assert.deepEqual(checks, ['initial', 'preservation', 'goal']);
  assert.deepEqual(events.filter(event => event.type === 'checked').map(event => event.stage), checks);
  assert.ok(events.findIndex(event => event.type === 'commit') > events.findIndex(event => event.phase === 'radio'));
});

test('cancelling inside a pending iterator advance emits no late proof, fire or commit', async () => {
  for (const awaitedAdvance of [0, 1, 2, 3]) {
    const controller = new AbortController(), events = [];
    let cursor = 0;
    const analysis = { initial: { pass: true }, preservation: { pass: true }, goal: { pass: true } };
    const iterator = { async next() {
      const index = cursor++;
      await Promise.resolve();
      if (index === awaitedAdvance) controller.abort();
      return index < 3 ? { done: false, value: { stage: ['initial', 'preservation', 'goal'][index], analysis } }
        : { done: true, value: { shots: [{ x: 0, y: 2 }], cost: 1 } };
    } };
    const result = await runFiringSequence({ iterator, signal: controller.signal,
      onEvent: event => events.push(event), wait: async () => {} });
    assert.equal(result.cancelled, true);
    assert.equal(events.filter(event => event.type === 'checked').length, Math.min(awaitedAdvance, 3));
    assert.ok(!events.some(event => event.phase === 'fire' || event.type === 'commit'));
  }
});

test('an asynchronous inconclusive check stops immediately without firing or charging', async () => {
  const events = [];
  async function* stages() {
    yield { stage: 'initial', analysis: { initial: { pass: null }, error: 'Z3 timeout', errorStage: 'initial' } };
    await Promise.resolve();
    return { error: 'Z3 timeout', cost: 0, shots: [] };
  }
  const result = await runFiringSequence({ iterator: stages(), onEvent: event => events.push(event), wait: async () => {} });
  assert.equal(result.cost, 0);
  assert.deepEqual(events.filter(event => event.type === 'checking').map(event => event.stage), ['initial']);
  assert.ok(!events.some(event => event.phase === 'fire'));
});
