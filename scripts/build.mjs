// Build + verification for static hosting (AWS Amplify, Netlify, any CDN).
// The garden is a buildless ES-module app; this script verifies the module
// graph and asset references, then stages a clean copy in dist/.
// The /api sync layer is optional — without server.mjs the app runs fully
// local-first, so a static deploy is a first-class citizen.
//
// Run: node scripts/build.mjs
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const REQUIRED = [
  'index.html',
  'styles.css',
  'src/main.js', 'src/world.js', 'src/ui.js', 'src/audio.js', 'src/config.js',
  'src/db.js', 'src/api.js', 'src/seed.js', 'src/flowers.js', 'src/keepsake.js',
  'vendor/three.module.js',
];

const COPY = ['index.html', 'styles.css', 'src', 'vendor', 'assets'];

let failed = false;
const fail = (msg) => { failed = true; console.error('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

console.log('— checking required files');
for (const f of REQUIRED) {
  try { await access(join(ROOT, f)); ok(f); }
  catch { fail(`missing: ${f}`); }
}

console.log('— syntax-checking ES modules');
const scratch = join(tmpdir(), 'garden-build-check');
await mkdir(scratch, { recursive: true });
for (const f of REQUIRED.filter((p) => p.endsWith('.js') && p.startsWith('src/'))) {
  const tmp = join(scratch, f.replace(/[\\/]/g, '_') + '.mjs');
  await writeFile(tmp, await readFile(join(ROOT, f)));
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); ok(f); }
  catch (e) { fail(`${f}: ${String(e.stderr || e.message).split('\n')[0]}`); }
}

console.log('— checking index.html local references');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1].slice(2));
for (const r of refs) {
  try { await access(join(ROOT, r)); ok(r); }
  catch { fail(`index.html references missing file: ${r}`); }
}
// the import map must point at a real file too
const im = [...html.matchAll(/"(\.\/vendor\/[^"]+)"/g)].map((m) => m[1].slice(2));
for (const r of im) {
  try { await access(join(ROOT, r)); ok(`importmap → ${r}`); }
  catch { fail(`import map references missing file: ${r}`); }
}

console.log('— checking module import graph');
for (const f of REQUIRED.filter((p) => p.startsWith('src/'))) {
  const code = await readFile(join(ROOT, f), 'utf8');
  const imports = [...code.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1]);
  for (const spec of imports) {
    const target = join(ROOT, 'src', spec);
    try { await access(target); }
    catch { fail(`${f} imports missing module: ${spec}`); }
  }
}
ok('all relative imports resolve');

if (failed) {
  console.error('\nBuild check failed — nothing was staged.');
  process.exit(1);
}

console.log('— staging dist/');
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const item of COPY) {
  try { await access(join(ROOT, item)); }
  catch { continue; } // assets/ may be absent; everything required was verified above
  await cp(join(ROOT, item), join(DIST, item), { recursive: true });
  ok(`dist/${item}`);
}

console.log('\nThe garden is ready to be planted anywhere static. (dist/)');
