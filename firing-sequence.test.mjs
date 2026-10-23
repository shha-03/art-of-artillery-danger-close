import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRING_TIMING, runFiringSequence, stagePassed } from './dist/firing-sequence.js';

function fixture(failedStage = null, extra = {}) {
  const advances = [];
  const result = { shots: [{ x: 1, y: 2 }], battle: { remaining: 5 }, ...extra };
  function* steps() {
    const analysis = {};
    for (const stage of ['initial', 'preservation', 'goal']) {
      advances.push(stage);
      analysis[stage] = { pass: stage !== failedStage };
      yield { stage, analysis: structuredClone(analysis) };
      if (stage === failedStage) return { ...result, dud: true, shots: [] };
    }
    return result;
  }
  return { iterator: steps(), advances, result };
}

test('a salvo checks in order, launches and impacts together, then commits after radio', async () => {
  const { iterator, advances, result } = fixture();
  const events = [];
  const waits = [];
  await runFiringSequence({ iterator, mode: 'salvo', onEvent: e => events.push(e), wait: async ms => {
    waits.push(ms);
    if (events.at(-1).type === 'checking') assert.equal(advances.length, events.filter(e => e.type === 'checked').length);
  } });
  assert.deepEqual(advances, ['initial', 'preservation', 'goal']);
  assert.deepEqual(events.map(e => e.type === 'phase' ? e.phase : `${e.type}${e.stage ? ':' + e.stage : ''}`), [
    'checking:initial','checked:initial','breech-open','checking:preservation','checked:preservation','loading','breech-close',
    'checking:goal','checked:goal','fire','flight-delay','flight','impact','radio','commit','finished',
  ]);
  assert.equal(events.find(e => e.type === 'commit').result, result);
  assert.ok(waits.every(ms => ms > 0));
  assert.equal(events.filter(e => e.phase === 'impact').length, 1);
});

test('loading finishes before breech closure, and closure finishes before the exit check', async () => {
  const { iterator } = fixture();
  const phases = [];
  let elapsed = 0;
  await runFiringSequence({ iterator, onEvent: event => phases.push({ ...event, at: elapsed }),
    wait: async ms => { elapsed += ms; },
  });
  const loading = phases.find(event => event.phase === 'loading');
  const closing = phases.find(event => event.phase === 'breech-close');
  const exit = phases.find(event => event.type === 'checking' && event.stage === 'goal');
  assert.equal(closing.at - loading.at, FIRING_TIMING.load);
  assert.equal(exit.at - closing.at, FIRING_TIMING.close);
  assert.ok(FIRING_TIMING.load >= 620, 'leave space after the loading sound before closure');
});

test('cancelling during loading prevents closure, exit verification and firing', async () => {
  const { iterator, advances } = fixture();
  const controller = new AbortController();
  const events = [];
  const outcome = await runFiringSequence({ iterator, signal: controller.signal,
    onEvent: event => events.push(event),
    wait: async () => { if (events.at(-1).phase === 'loading') controller.abort(); },
  });
  assert.equal(outcome.cancelled, true);
  assert.deepEqual(advances, ['initial', 'preservation']);
  assert.ok(!events.some(event => event.phase === 'breech-close' || event.phase === 'fire' || event.type === 'commit'));
});

for (const stage of ['initial', 'preservation', 'goal']) {
  test(`${stage} failure stops later stages and never emits firing or impact`, async () => {
    const { iterator, advances } = fixture(stage);
    const events = [];
    await runFiringSequence({ iterator, onEvent: e => events.push(e), wait: async () => {} });
    assert.equal(advances.at(-1), stage);
    assert.equal(events.filter(e => e.type === 'commit').length, 1);
    assert.ok(events.find(e => e.phase === 'failed'));
    assert.ok(!events.some(e => ['fire','flight','impact','radio'].includes(e.phase)));
  });
}

test('a fixed-specification failure fails the exit phase even if editable goal passes', () => {
  assert.equal(stagePassed({ goal: { pass: true }, specification: { pass: false } }, 'goal'), false);
  assert.equal(stagePassed({ goal: { pass: true }, specification: { pass: true } }, 'goal'), true);
});

test('an exit-stage expression error preserves completed earlier successes', () => {
  const analysis={initial:{pass:true},preservation:{pass:true},goal:{pass:null},error:'arithmetic error',errorStage:'goal'};
  assert.equal(stagePassed(analysis,'initial'),true);
  assert.equal(stagePassed(analysis,'preservation'),true);
  assert.equal(stagePassed(analysis,'goal'),false);
});

test('cancelling during flight prevents late impacts, reports and battle commits', async () => {
  const { iterator } = fixture();
  const controller = new AbortController();
  const events = [];
  const outcome = await runFiringSequence({ iterator, signal: controller.signal,
    onEvent: e => events.push(e), wait: async () => { if (events.at(-1).phase === 'flight') controller.abort(); },
  });
  assert.equal(outcome.cancelled, true);
  assert.ok(!events.some(e => e.type === 'commit' || e.phase === 'impact'));
});

test('free verification and empty candidates never play a phantom shot', async () => {
  for (const reason of ['proved', 'no-candidates']) {
    const { iterator } = fixture(null, { shots: [], reason, cost: 0 });
    const events = [];
    await runFiringSequence({ iterator, onEvent: e => events.push(e), wait: async () => {} });
    assert.ok(!events.some(e => e.phase === 'fire' || e.phase === 'impact'));
    assert.equal(events.filter(e => e.type === 'commit').length, 1);
  }
});
