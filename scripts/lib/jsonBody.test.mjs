/**
 * #9184: `check-json-body.mjs` fails on a new raw `c.req.json` read, on a
 * stale baseline entry, and passes on this tree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countRawReads, ratchet } from './jsonBody.mjs';

const CHECK = fileURLToPath(new URL('../check-json-body.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });

function fixture(files, baseline) {
  const root = mkdtempSync(join(tmpdir(), 'json-body-9184-'));
  mkdirSync(join(root, 'cloudflare-worker/src/routes'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'cloudflare-worker/src/routes', name), text);
  writeFileSync(join(root, 'scripts/json-body-baseline.json'), JSON.stringify({ files: baseline }));
  return root;
}

test('countRawReads counts bare, caught and typed reads, not comments or the helper', () => {
  assert.equal(countRawReads('const a = await c.req.json();'), 1);
  assert.equal(countRawReads('const a = await c.req.json().catch(() => ({}));'), 1);
  assert.equal(countRawReads('const a = await c.req.json<{ x?: string }>();'), 1);
  assert.equal(countRawReads('// was: await c.req.json()\n/**\n * c.req.json()\n */'), 0);
  assert.equal(countRawReads('const a = await readJsonObject(c);'), 0);
});

test('ratchet names growth, a new file and a stale entry', () => {
  const { grown, shrunk } = ratchet({ 'a.ts': 2, 'new.ts': 1 }, { 'a.ts': 1, 'gone.ts': 3 });
  assert.deepEqual(grown, [{ file: 'a.ts', now: 2, baseline: 1 }, { file: 'new.ts', now: 1, baseline: 0 }]);
  assert.deepEqual(shrunk, [{ file: 'gone.ts', now: 0, baseline: 3 }]);
});

test('the guard fails on a fixture with a new bare read', () => {
  const root = fixture({
    'old.ts': 'r.post("/", async (c) => { const b = await c.req.json(); });\n',
    'new.ts': 'r.post("/", async (c) => { const b = await c.req.json(); });\n',
  }, { 'cloudflare-worker/src/routes/old.ts': 1 });
  try {
    const r = run('--root', root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /raw c\.req\.json reads grew/);
    assert.match(r.stderr, /cloudflare-worker\/src\/routes\/new\.ts: 1 \(on record: 0\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the guard fails when a converted file keeps its old entry', () => {
  const root = fixture({ 'old.ts': 'const b = await readJsonObject(c);\n' }, { 'cloudflare-worker/src/routes/old.ts': 1 });
  try {
    const r = run('--root', root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /old\.ts: 0 \(on record: 1\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the guard passes on this tree', () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /not growing/);
});
