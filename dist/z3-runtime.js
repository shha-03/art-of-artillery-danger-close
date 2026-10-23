const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
const INIT_TIMEOUT_MS = 45000;
const vendorURL = new URL('./vendor/', import.meta.url);
let initialization = null;
let instance = null;
let terminateThreads = null;
let scriptLoading = null;
let initializationController = null;
let generation = 0;

function runtimeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'Z3RuntimeError';
  error.code = code;
  return error;
}

function loadEmscriptenScript(signal) {
  if (typeof globalThis.initZ3 === 'function') return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('z3-built.js', vendorURL).href;
    script.async = true;
    const stop = () => {
      script.remove();
      reject(runtimeError('Z3_INIT_CANCELLED', 'The Z3 WebAssembly download was cancelled.'));
    };
    script.onload = () => {
      signal.removeEventListener('abort', stop);
      if (typeof globalThis.initZ3 === 'function') resolve();
      else reject(runtimeError('Z3_LOAD_FAILED', 'The Z3 WebAssembly loader did not initialize.'));
    };
    script.onerror = () => {
      signal.removeEventListener('abort', stop);
      script.remove();
      reject(runtimeError('Z3_LOAD_FAILED', 'The Z3 WebAssembly loader could not be downloaded.'));
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    else document.head.append(script);
  }).catch(error => {
    scriptLoading = null;
    throw error;
  });
  return scriptLoading;
}

async function loadWasm(signal) {
  const response = await fetch(new URL('z3-built.wasm.gz', vendorURL), { signal });
  if (!response.ok) throw runtimeError('Z3_LOAD_FAILED', `The Z3 solver asset returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Hosts may already decode a gzip Content-Encoding. Accept either transport form.
  let binary = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    binary = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (binary[0] !== 0 || binary[1] !== 0x61 || binary[2] !== 0x73 || binary[3] !== 0x6d) {
    throw runtimeError('Z3_LOAD_FAILED', 'The downloaded Z3 solver asset is not WebAssembly.');
  }
  return binary;
}

async function initialize(signal) {
  if (isNode) {
    const { init, killThreads } = await import('z3-solver');
    terminateThreads = killThreads;
    return init();
  }
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    throw runtimeError('Z3_ISOLATION_REQUIRED', 'Z3 requires cross-origin isolation: serve COOP same-origin and COEP require-corp headers.');
  }
  if (typeof WebAssembly === 'undefined' || typeof DecompressionStream === 'undefined') {
    throw runtimeError('Z3_UNSUPPORTED', 'This browser does not support the WebAssembly solver runtime.');
  }
  const [{ init, killThreads }, wasmBinary] = await Promise.all([
    import('./vendor/z3-api.js'),
    loadWasm(signal),
    loadEmscriptenScript(signal)
  ]);
  terminateThreads = killThreads;
  return init({
    wasmBinary,
    mainScriptUrlOrBlob: new URL('z3-built.js', vendorURL).href,
    locateFile: name => new URL(name, vendorURL).href
  });
}

/** Lazily load the official Z3 API. Solver.check() uses Z3's own pthread worker. */
export function getZ3() {
  if (initialization) return initialization;
  const current = ++generation;
  const controller = new AbortController();
  initializationController = controller;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(runtimeError('Z3_INIT_TIMEOUT', 'Z3 initialization timed out. Retry the verification.'));
    }, INIT_TIMEOUT_MS);
  });
  const pending = initialize(controller.signal).then(async api => {
    if (current !== generation || controller.signal.aborted) {
      await terminateThreads?.(api.em);
      throw runtimeError('Z3_INIT_CANCELLED', 'Z3 initialization was cancelled.');
    }
    instance = api;
    return api;
  });
  initialization = Promise.race([pending, timeout]).catch(error => {
    controller.abort();
    if (current === generation) initialization = null;
    if (error.name === 'Z3RuntimeError') throw error;
    throw runtimeError('Z3_LOAD_FAILED', 'The Z3 solver could not be initialized.', error);
  }).finally(() => {
    clearTimeout(timer);
    if (initializationController === controller) initializationController = null;
  });
  return initialization;
}

/** Hard-stop official worker threads after a deadline, or after Node tests. */
export async function shutdownZ3() {
  ++generation;
  initializationController?.abort();
  initializationController = null;
  const api = instance;
  instance = null;
  initialization = null;
  if (api && terminateThreads) await terminateThreads(api.em);
}
