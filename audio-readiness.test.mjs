import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual application handler without booting its DOM, rendering,
// or storage. Assertions concern behavior, not source-code spelling. Audio
// preparation and the separately tested firing controller are deferred peers.
const app = fs.readFileSync(new URL('./dist/app.js', import.meta.url), 'utf8');
function applicationSlice(startMarker, endMarker) {
  const start = app.indexOf(startMarker), end = app.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Application test entry point moved: ${startMarker}`);
  return new vm.Script(app.slice(start, end), { filename: 'dist/app.js', lineOffset: app.slice(0, start).split('\n').length - 1 });
}
const fireScript = applicationSlice('async function fire(mode)', '\nfunction showResult()');
const soundScript = applicationSlice("$('sound-button').addEventListener('click'", "\ndocument.addEventListener('visibilitychange'");
const tacticalScript = applicationSlice('function selectTacticalView(', '\nfunction playCue(');
const tacticalEventsScript = applicationSlice("$('view-tabs').addEventListener('click'", "$('chapter-select').addEventListener('change'");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ sound = true, abortResolves = true, manualSequence = false } = {}) {
  const preparations = [], sequences = [], calls = { orders: [], stops: 0, enabled: [], renders: 0, commits: [] };
  const sequenceReady = deferred();
  const listeners = new Map();
  const elements = new Map([
    ['goal-input', { value: 'true' }],
    ['invariant-input', { value: 'x >= 0' }],
    ['sound-button', { addEventListener: (type, handler) => listeners.set(type, handler) }],
  ]);
  const context = {
    AbortController, Set, sound, busy: false, battle: { finished: false, remaining: 6 },
    sequenceAbort: null, audioPreparationAbort: null, turnToken: 7,
    sequenceStarted: false, revealedStages: new Set(), currentStage: null,
    firingPhase: 'idle', lastAnalysis: null, witness: null, impacts: [], feedbackState: null,
    SOUND_STORAGE_KEY: 'test-sound', localStorage: { setItem() {} },
    $: id => elements.get(id), flash() {}, render() { calls.renders++; },
    renderChecks() {}, renderSound() {}, showResult() {}, playCue() {},
    selectTacticalView() {},
    setFiringPhase(phase) { context.firingPhase = phase; },
    battleEffects: { clear() {} },
    artilleryAudio: {
      prepare(options) {
        const task = { ...deferred(), options };
        preparations.push(task);
        if (abortResolves) options.signal.addEventListener('abort', () => task.resolve(false), { once: true });
        return task.promise;
      },
      stopAll() { calls.stops++; },
      setEnabled(value) { calls.enabled.push(value); },
      unlock() { return Promise.resolve(true); },
    },
    orderStages(battle, expression, goal, mode) {
      const order = { battle, expression, goal, mode };
      calls.orders.push(order);
      return order;
    },
    applyOrderResult(result) { calls.commits.push(result); context.battle = result.battle; },
    runFiringSequence(options) {
      const sequence = { ...deferred(), options };
      sequences.push(sequence);
      sequenceReady.resolve(sequence);
      if (!manualSequence) {
        options.onEvent({ type: 'finished' });
        sequence.resolve();
      }
      return sequence.promise;
    },
  };
  vm.createContext(context);
  fireScript.runInContext(context);
  soundScript.runInContext(context);
  return { context, preparations, sequences, calls, elements, sequenceReady: sequenceReady.promise, toggleSound: () => listeners.get('click')() };
}

function withTacticalViews(h) {
  const events = {}, effects = [], doc = { activeElement: null, querySelector: () => ({ scrollIntoView() {} }) };
  function element(id, extra = {}) {
    const node = {
      hidden: false, disabled: false, attrs: {},
      contains(target) { return target === this || this.children?.includes(target) || false; },
      setAttribute(key, value) { this.attrs[key] = value; },
      focus() { doc.activeElement = this; },
      ...extra,
    };
    h.elements.set(id, node);
    return node;
  }
  const map = element('map-view'), codeFocus = {};
  const program = element('program-view', { children: [codeFocus] });
  const tabs = ['map', 'program'].map(view => element(`${view}-view-tab`, { dataset: { view }, closest() { return this; } }));
  element('view-tabs', { children: tabs, addEventListener: (name, handler) => { events[name] = handler; } });
  element('map-status');
  Object.assign(h.context, {
    document: doc, level: () => ({ size: 9 }), t: key => key,
    sequenceCopyPhase: () => h.context.firingPhase, renderFeedback() {},
    // renderStats, invoked by the real render, synchronizes these controls.
    render() { h.calls.renders++; h.context.syncTacticalView(); },
  });
  Object.assign(h.context.battleEffects, {
    launch() { effects.push({ phase: 'flight', visible: !map.hidden }); },
    impact() { effects.push({ phase: 'impact', visible: !map.hidden }); }, radio() {},
  });
  tacticalScript.runInContext(h.context);
  tacticalEventsScript.runInContext(h.context);
  h.context.selectTacticalView('map');
  return { map, program, tabs, codeFocus, doc, events, effects };
}

test('the first order waits for audio readiness before constructing its verifier and retains the requested inputs', async () => {
  const h = harness();
  const firing = h.context.fire('salvo');
  assert.equal(h.context.busy, true);
  assert.equal(h.preparations.length, 1, 'prepare is called synchronously from the gesture');
  assert.equal(h.calls.orders.length, 0);
  assert.equal(h.sequences.length, 0);
  assert.ok(h.preparations[0].options.timeoutMs > 0 && h.preparations[0].options.timeoutMs <= 5000, 'first-shot preparation has a finite wait budget');
  h.elements.get('invariant-input').value = 'false';
  h.preparations[0].resolve(true);
  await firing;
  assert.equal(h.calls.orders.length, 1);
  assert.equal(h.calls.orders[0].expression, 'x >= 0');
  assert.equal(h.calls.orders[0].mode, 'salvo');
  assert.equal(h.sequences.length, 1);
  assert.equal(h.context.busy, false);
  assert.equal(h.context.audioPreparationAbort, null);
});

test('single and salvo requests cannot duplicate an order while its audio preparation is pending', async () => {
  const h = harness();
  const firing = h.context.fire('salvo');
  await h.context.fire('single');
  await h.context.fire('salvo');
  assert.equal(h.preparations.length, 1);
  assert.equal(h.calls.orders.length, 0);
  h.preparations[0].resolve(true);
  await firing;
  assert.equal(h.calls.orders.length, 1);
  assert.equal(h.sequences.length, 1);
});

test('preparation failure, timeout, or rejection permits gameplay instead of rejecting the fire order', async () => {
  for (const rejects of [false, true]) {
    const h = harness();
    const firing = h.context.fire('single');
    if (rejects) h.preparations[0].reject(new Error('Audio unavailable'));
    else h.preparations[0].resolve(false); // The audio API also returns false on timeout.
    await firing;
    assert.equal(h.calls.orders.length, 1);
    assert.equal(h.sequences.length, 1);
    assert.equal(h.context.busy, false);
    assert.notEqual(h.context.feedbackState.type, 'exception');
    assert.equal(h.calls.stops, 0);
  }
});

test('sound OFF bypasses audio preparation entirely', async () => {
  const h = harness({ sound: false });
  await h.context.fire('single');
  assert.equal(h.preparations.length, 0);
  assert.equal(h.calls.orders.length, 1);
  assert.equal(h.sequences.length, 1);
});

test('sequence cancellation aborts preparation and prevents late readiness from starting verification', async () => {
  const h = harness({ abortResolves: false });
  const before = h.context.battle;
  const firing = h.context.fire('single');
  h.context.sequenceAbort.abort(); // The same controller is aborted on pagehide.
  assert.equal(h.preparations[0].options.signal.aborted, true);
  h.preparations[0].resolve(true);
  await firing;
  assert.equal(h.calls.orders.length, 0);
  assert.equal(h.sequences.length, 0);
  assert.equal(h.context.battle, before);
});

test('a changed mission token discards pending readiness even if its signal has not been aborted', async () => {
  const h = harness();
  const firing = h.context.fire('single');
  h.context.turnToken++;
  const newBattle = { finished: false, remaining: 6 };
  h.context.battle = newBattle;
  h.preparations[0].resolve(true);
  await firing;
  assert.equal(h.calls.orders.length, 0);
  assert.equal(h.sequences.length, 0);
  assert.equal(h.context.battle, newBattle);
});

test('the actual sound toggle cancels only audio preparation and late readiness cannot undo OFF', async () => {
  const h = harness();
  const firing = h.context.fire('single');
  await h.toggleSound();
  await firing;
  assert.equal(h.preparations[0].options.signal.aborted, true);
  assert.equal(h.context.sequenceAbort.signal.aborted, false);
  assert.equal(h.sequences.length, 1);
  assert.equal(h.context.sound, false);
  h.preparations[0].resolve(true);
  await Promise.resolve();
  assert.equal(h.context.sound, false);
  assert.deepEqual(h.calls.enabled, [false]);
});

test('a previous preparation rejection cannot clear the busy state or audio of a newer order', async () => {
  const h = harness({ abortResolves: false });
  const old = h.context.fire('single');
  h.context.sequenceAbort.abort();
  h.context.turnToken++;
  h.context.busy = false; // loadLevel/pageshow restores interaction before another order.
  const current = h.context.fire('salvo');
  h.preparations[0].reject(new Error('Old decode failed'));
  await old;
  assert.equal(h.context.busy, true);
  assert.equal(h.calls.stops, 0);
  assert.equal(h.sequences.length, 0);
  assert.equal(h.context.audioPreparationAbort.signal, h.preparations[1].options.signal);
  h.preparations[1].resolve(true);
  await current;
  assert.equal(h.sequences.length, 1);
  assert.equal(h.calls.orders[0].mode, 'salvo');
});

test('late sequence events and errors from a cancelled order cannot commit over or stop a newer order', async () => {
  const h = harness({ sound: false, manualSequence: true });
  const old = h.context.fire('single');
  h.context.sequenceAbort.abort();
  h.context.busy = false;
  const current = h.context.fire('salvo'); // Same mission token; controller identity must also protect it.
  const newBattle = h.context.battle;
  h.sequences[0].options.onEvent({ type: 'commit', result: { battle: { finished: true, remaining: 0 } } });
  h.sequences[0].options.onEvent({ type: 'finished' });
  h.sequences[0].reject(new Error('Stale sequence failed'));
  await old;
  assert.equal(h.context.battle, newBattle);
  assert.equal(h.context.busy, true);
  assert.equal(h.calls.commits.length, 0);
  assert.equal(h.calls.stops, 0);
  h.sequences[1].options.onEvent({ type: 'finished' });
  h.sequences[1].resolve();
  await current;
  assert.equal(h.context.busy, false);
});

test('code remains available during preparation, but flight and impact always use a visible map until the radio phase', async () => {
  const h = harness({ manualSequence: true }), view = withTacticalViews(h);
  const firing = h.context.fire('single');
  h.context.selectTacticalView('program');
  assert.equal(view.program.hidden, false, 'audio preparation does not lock out the program');
  h.preparations[0].resolve(true);
  const emit = (await h.sequenceReady).options.onEvent;
  emit({ type: 'checking', stage: 'preservation' });
  assert.equal(view.program.hidden, false, 'verification may be inspected in the program tab');
  assert.equal(view.tabs[1].disabled, false);
  view.doc.activeElement = view.codeFocus;
  emit({ type: 'phase', phase: 'flight-delay', shots: [], mode: 'single' });
  assert.equal(view.map.hidden, false);
  assert.equal(view.program.hidden, true);
  assert.equal(view.tabs[1].disabled, true);
  assert.equal(view.doc.activeElement, view.tabs[0], 'focus cannot remain in the hidden code panel');
  view.events.click({ target: view.tabs[1] });
  h.context.selectTacticalView('program');
  let prevented = false;
  view.events.keydown({ target: view.tabs[0], key: 'End', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(view.map.hidden, false, 'clicks, direct activation and keyboard navigation cannot hide the effects');
  assert.equal(view.tabs[0].tabIndex, 0);
  assert.equal(view.tabs[1].tabIndex, -1);
  emit({ type: 'phase', phase: 'flight', shots: [], mode: 'single' });
  h.context.selectTacticalView('program');
  emit({ type: 'phase', phase: 'impact', shots: [], mode: 'single' });
  assert.deepEqual(view.effects, [{ phase: 'flight', visible: true }, { phase: 'impact', visible: true }]);
  assert.equal(view.tabs[1].disabled, true);
  emit({ type: 'phase', phase: 'radio', shots: [], mode: 'single' });
  assert.equal(view.tabs[1].disabled, false);
  view.events.click({ target: view.tabs[1] });
  assert.equal(view.program.hidden, false, 'the short animation lock ends before the report');
  emit({ type: 'finished' });
  h.sequences[0].resolve();
  await firing;
  assert.equal(h.context.busy, false);
  assert.equal(view.tabs[1].disabled, false);
});

test('an animation failure releases the program tab and a focused tab is moved safely before it is disabled', async () => {
  const h = harness({ sound: false, manualSequence: true }), view = withTacticalViews(h);
  const firing = h.context.fire('single');
  h.context.selectTacticalView('program', { focusTab: true });
  h.sequences[0].options.onEvent({ type: 'phase', phase: 'flight-delay', shots: [], mode: 'single' });
  assert.equal(view.doc.activeElement, view.tabs[0]);
  assert.equal(view.tabs[1].disabled, true);
  h.sequences[0].reject(new Error('Animation failed'));
  await firing;
  assert.equal(h.context.busy, false);
  assert.equal(h.context.firingPhase, 'failed');
  assert.equal(view.tabs[1].disabled, false);
  h.context.selectTacticalView('program');
  assert.equal(view.program.hidden, false);
});
