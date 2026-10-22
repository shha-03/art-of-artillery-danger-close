const workerURL = new URL('./isolation-worker.js', import.meta.url);
const scopeURL = new URL('./', import.meta.url);
const RELOAD_KEY = 'danger-close:isolation-reloaded:v1';
const STARTUP_TIMEOUT_MS = 8000;

function isOwnWorker(worker) {
  return worker?.scriptURL === workerURL.href;
}

function awaitController(signal) {
  const serviceWorker = navigator.serviceWorker;
  if (isOwnWorker(serviceWorker.controller)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = result => {
      serviceWorker.removeEventListener('controllerchange', changed);
      signal.removeEventListener('abort', aborted);
      resolve(result);
    };
    const changed = () => finish(isOwnWorker(serviceWorker.controller));
    const aborted = () => finish(false);
    serviceWorker.addEventListener('controllerchange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else if (isOwnWorker(serviceWorker.controller)) finish(true);
  });
}

async function prepareController(signal) {
  const serviceWorker = navigator.serviceWorker;
  if (serviceWorker.controller && !isOwnWorker(serviceWorker.controller)) return false;
  const existing = await serviceWorker.getRegistration(scopeURL.href);
  if (signal.aborted) return false;
  const registeredWorkers = [existing?.active, existing?.waiting, existing?.installing].filter(Boolean);
  if (registeredWorkers.some(worker => !isOwnWorker(worker))) return false;
  await serviceWorker.register(workerURL.href, { scope: scopeURL.pathname, updateViaCache: 'none' });
  if (signal.aborted) return false;
  return awaitController(signal);
}

async function shouldReloadForIsolation() {
  if (globalThis.crossOriginIsolated || !globalThis.isSecureContext || !navigator.serviceWorker) return false;
  // If session storage is unavailable, do not risk a reload loop.
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false;
    const probe = `${RELOAD_KEY}:probe`;
    sessionStorage.setItem(probe, '1');
    sessionStorage.removeItem(probe);
  } catch {
    return false;
  }
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      prepareController(controller.signal),
      new Promise(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, STARTUP_TIMEOUT_MS);
      })
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Complete isolation setup before importing gameplay. No reload listener remains
// after this point, so worker updates cannot reset an operation in progress.
const body = document.body;
const previousInert = body.inert;
const previousBusy = body.getAttribute('aria-busy');
body.inert = true;
body.setAttribute('aria-busy', 'true');
let reloading = false;
try {
  if (await shouldReloadForIsolation()) {
    try {
      sessionStorage.setItem(RELOAD_KEY, '1');
      location.reload();
      reloading = true;
    } catch {
      // Registration or reload failure leaves the existing runtime error path.
    }
  }
  if (!reloading) await import('./app.js');
} catch (error) {
  const panel = document.getElementById('feedback-panel');
  if (panel) {
    panel.dataset.kind = 'error';
    panel.textContent = '게임 준비 실패. 연결을 확인하고 새로고침하라. / Startup failed. Check your connection and reload.';
  }
  for (const id of ['single-button', 'salvo-button']) {
    const button = document.getElementById(id);
    if (button) button.disabled = true;
  }
  console.error('Game startup failed.', error);
} finally {
  if (!reloading) {
    body.inert = previousInert;
    if (previousBusy === null) body.removeAttribute('aria-busy');
    else body.setAttribute('aria-busy', previousBusy);
  }
}
