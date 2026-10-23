// Presentation timing is independent of the verifier. Each iterator advance
// performs exactly one proof stage; battle state is committed only after radio.
export const FIRING_TIMING = Object.freeze({
  check: 280, breech: 480, load: 620, close: 440, muzzle: 180,
  flightDelay: 220, flight: 640, impact: 700, radio: 120, report: 280,
});
export const VERIFICATION_STAGES = Object.freeze(['initial', 'preservation', 'goal']);

export function stagePassed(analysis, stage) {
  return analysis?.errorStage !== stage && analysis?.[stage]?.pass === true
    && (stage !== 'goal' || !analysis.specification || analysis.specification.pass === true);
}

// A completed false exit check is a warning, not a dud. Unfinished checks and
// expression errors still block firing, even after the first two stages pass.
export function exitAllowsFire(analysis) {
  return stagePassed(analysis, 'initial') && stagePassed(analysis, 'preservation')
    && !analysis.error && !analysis.errorStage
    && typeof analysis.goal?.pass === 'boolean'
    && (!analysis.specification || typeof analysis.specification.pass === 'boolean');
}

function delay(milliseconds, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function runFiringSequence({ iterator, mode, onEvent, signal, wait = delay, timing = FIRING_TIMING }) {
  const emit = event => { if (!signal?.aborted) onEvent(event); };
  const pause = async milliseconds => { await wait(milliseconds, signal); return !signal?.aborted; };
  const cancelled = () => ({ cancelled: true });
  const finishEarly = result => {
    const failed = Boolean(result?.dud || result?.error);
    emit({ type: 'phase', phase: failed ? 'failed' : 'idle', result });
    emit({ type: 'commit', result });
    emit({ type: 'finished', result });
    return result;
  };

  for (const stage of VERIFICATION_STAGES) {
    if (signal?.aborted) return cancelled();
    emit({ type: 'checking', stage });
    if (!await pause(timing.check)) return cancelled();
    const step = iterator.next();
    if (step.done) return finishEarly(step.value);
    if (step.value.stage !== stage) throw new Error('Verification stages arrived out of order.');
    emit({ type: 'checked', stage, analysis: step.value.analysis });
    if (!stagePassed(step.value.analysis, stage)
      && !(stage === 'goal' && exitAllowsFire(step.value.analysis))) {
      const stopped = iterator.next();
      if (!stopped.done) throw new Error('Verifier continued after a failed stage.');
      return finishEarly(stopped.value);
    }
    if (stage === 'initial') {
      emit({ type: 'phase', phase: 'breech-open' });
      if (!await pause(timing.breech)) return cancelled();
    } else if (stage === 'preservation') {
      emit({ type: 'phase', phase: 'loading' });
      if (!await pause(timing.load)) return cancelled();
      emit({ type: 'phase', phase: 'breech-close' });
      if (!await pause(timing.close)) return cancelled();
    }
  }
  const final = iterator.next();
  if (!final.done) throw new Error('Verifier did not finish after the exit check.');
  const result = final.value;
  if (result?.error || result?.dud || !result?.shots?.length) return finishEarly(result);

  emit({ type: 'phase', phase: 'fire', shots: result.shots, mode });
  if (!await pause(timing.muzzle)) return cancelled();
  emit({ type: 'phase', phase: 'flight-delay', shots: result.shots, mode });
  if (!await pause(timing.flightDelay)) return cancelled();
  emit({ type: 'phase', phase: 'flight', shots: result.shots, mode });
  if (!await pause(timing.flight)) return cancelled();
  emit({ type: 'phase', phase: 'impact', shots: result.shots, mode });
  if (!await pause(timing.impact)) return cancelled();
  emit({ type: 'phase', phase: 'radio', shots: result.shots, mode });
  if (!await pause(timing.radio)) return cancelled();
  emit({ type: 'commit', result });
  if (!await pause(timing.report)) return cancelled();
  emit({ type: 'finished', result });
  return result;
}
