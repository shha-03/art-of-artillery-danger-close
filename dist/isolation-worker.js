// Same-origin response-header fallback for hosts without configurable headers.
// Pattern: https://github.com/gzuidhof/coi-serviceworker (MIT).
// No response cache, authentication changes, or cross-origin interception.
const baseURL = new URL('./', self.location.href);
const appFiles = new Set([
  '', 'index.html', 'bootstrap.js', 'app.js', 'engine.js', 'smt.js',
  'i18n.js', 'levels.js', 'ui-copy.js', 'z3-runtime.js', 'style.css', 'favicon.svg',
  'vendor/z3-api.js', 'vendor/z3-built.js', 'vendor/z3-built.wasm.gz',
  'vendor/z3-LICENSE.txt', 'vendor/z3-manifest.json'
]);

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== baseURL.origin || !url.pathname.startsWith(baseURL.pathname)) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const file = url.pathname.slice(baseURL.pathname.length);
  if (!appFiles.has(file)) return;

  event.respondWith((async () => {
    // Preserve the original request, including cookies and redirect policy.
    const response = await fetch(request);
    if (!response.ok || response.redirected || ['opaque', 'opaqueredirect', 'error'].includes(response.type)) return response;
    if (response.url && new URL(response.url).origin !== baseURL.origin) return response;
    const contentType = response.headers.get('Content-Type') || '';
    if (file === '' || file === 'index.html') {
      if (!contentType.toLowerCase().includes('text/html')) return response;
      // A private host can return a sign-in page at the app URL with status 200.
      // Do not alter that page's policies or its authentication flow.
      const html = await response.clone().text();
      if (!html.includes('id="game-title"') || !html.includes('src="./bootstrap.js"')) return response;
    } else if (contentType.toLowerCase().includes('text/html')) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  })());
});
