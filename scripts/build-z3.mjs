import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve('z3-solver/package.json'));
const vendor = path.join(root, 'dist', 'vendor');
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
await mkdir(vendor, { recursive: true });

// Keep the official Emscripten script intact: it is also its own pthread worker.
await copyFile(path.join(packageRoot, 'build', 'z3-built.js'), path.join(vendor, 'z3-built.js'));
const wasm = await readFile(path.join(packageRoot, 'build', 'z3-built.wasm'));
await writeFile(path.join(vendor, 'z3-built.wasm.gz'), gzipSync(wasm, { level: 9 }));
await build({
  stdin: {
    contents: "export { init } from 'z3-solver/build/browser.js'; export { killThreads } from 'z3-solver/build/kill-threads.js';",
    resolveDir: root,
    sourcefile: 'z3-browser-entry.js',
    loader: 'js'
  },
  outfile: path.join(vendor, 'z3-api.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  define: { global: 'globalThis' },
  minify: true,
  legalComments: 'eof'
});

await copyFile(path.join(packageRoot, 'LICENSE.txt'), path.join(vendor, 'z3-LICENSE.txt'));
const assets = {};
for (const name of ['z3-api.js', 'z3-built.js', 'z3-built.wasm.gz', 'z3-LICENSE.txt']) {
  const data = await readFile(path.join(vendor, name));
  if (data.byteLength > 25 * 1024 * 1024) throw new Error(`${name} exceeds the 25 MiB hosting asset limit`);
  assets[name] = { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
}
await writeFile(path.join(vendor, 'z3-manifest.json'), JSON.stringify({
  package: 'z3-solver', version: metadata.version, rawWasmBytes: wasm.byteLength, assets
}, null, 2) + '\n');
console.log(`Z3 ${metadata.version}: ${wasm.byteLength} byte WASM packaged as ${assets['z3-built.wasm.gz'].bytes} byte gzip; browser assets ready.`);
