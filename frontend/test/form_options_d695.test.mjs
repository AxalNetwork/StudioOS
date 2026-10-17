/**
 * D695 decision 16 (#1656, its own PR by S1's ruling A): one `formOptions`
 * for every cycle, over #1690's `GET /api/cycles/:cycle/modules/:slug/form-options`.
 * Test 11's client cases, against a stubbed `request`: the live route answers
 * 404 until each cycle's records task registers its specs, and no form is
 * wired to it yet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import { MODULES } from '../src/pages/cycles/modules.js';
import { extractClientCalls, normalizePath } from '../../scripts/lib/apiModules.mjs';
import { mutationCheck } from './_form_d695.mjs';

const path = 'lib/api/cycleWrites.js';
const source = readFileSync(new URL('../src/' + path, import.meta.url), 'utf8');

async function assertFormOptions({ makeCycleWrites: make }) {
  const calls = [];
  const w = make((p, opts) => { calls.push([p, opts]); return Promise.resolve({ read: p }); });
  const read = await w.formOptions('validate', 3, 'problem-discovery');
  assert.deepEqual(calls.at(-1), ['/cycles/validate/modules/problem-discovery/form-options?project=3', undefined], 'a GET with the venture as ?project=');
  assert.deepEqual(read, { read: '/cycles/validate/modules/problem-discovery/form-options?project=3' }, 'the read comes back as sent');
  await w.formOptions('validate', 3, 'market-intelligence', { q: 'acme' });
  assert.equal(calls.at(-1)[0], '/cycles/validate/modules/market-intelligence/form-options?project=3&q=acme', 'the query follows project');
  await w.formOptions('raise', 7, 'capital-relationships', { q: 'seed & growth', stage: 'pre-seed' });
  assert.equal(calls.at(-1)[0], '/cycles/raise/modules/capital-relationships/form-options?project=7&q=seed+%26+growth&stage=pre-seed', 'each entry is encoded');
  await w.formOptions('build', 7, 'operating-systems', { project: 9, q: null });
  assert.equal(calls.at(-1)[0], '/cycles/build/modules/operating-systems/form-options?project=7', 'the query never names another venture, and an empty entry is not sent');
  // Every module of every cycle reaches the one route, with the cycle in the path.
  for (const [cycle, modules] of Object.entries(MODULES)) {
    for (const { slug } of modules) {
      await w.formOptions(cycle, 3, slug);
      assert.equal(calls.at(-1)[0], `/cycles/${cycle}/modules/${slug}/form-options?project=3`);
    }
  }
  // Only a cycle's own name and a module slug's charset reach the URL.
  const before = calls.length;
  for (const [cycle, slug] of [['admin', 'problem-discovery'], ['validate/../admin', 'x'], ['Validate', 'problem-discovery'], ['validate', '../../users'], ['validate', 'Problem Discovery'], ['validate', ''], ['validate', 'a/b'], ['', 'problem-discovery']]) {
    await assert.rejects(() => w.formOptions(cycle, 3, slug), /That module has no form choices\./, `${cycle} / ${slug}`);
  }
  assert.equal(calls.length, before, 'a refused cycle or slug sends nothing');
}

test('formOptions reads one module\'s form choices for every cycle, its query after the venture, and sends only a known cycle and a slug', async () => {
  await assertFormOptions({ makeCycleWrites });
  await mutationCheck(source, path, assertFormOptions, [
    ["if (key !== 'project' && value != null) params.append", 'if (value != null) params.append'],
    ["if (key !== 'project' && value != null) params.append", "if (key !== 'project') params.append"],
    ['const CYCLE_KEY = /^(validate|build|raise|grow)$/;', 'const CYCLE_KEY = /^[A-Za-z./]+$/;'],
    ['const MODULE_SLUG = /^[a-z0-9][a-z0-9-]*$/;', 'const MODULE_SLUG = /^.*$/;'],
    ['/form-options?${params}`', '/form-options`'],
    ['new URLSearchParams({ project: String(projectId) });\n      for', 'new URLSearchParams({ venture: String(projectId) });\n      for'],
  ]);
});

test('the drift check reads formOptions as GET /api/cycles/:p/modules/:p/form-options, the route #1690 mounts', () => {
  const calls = extractClientCalls(source).map((c) => `${c.method} ${normalizePath(c.path)}`);
  assert.equal(calls.filter((c) => c.includes('form-options')).length, 1, 'one method, for every cycle');
  assert.ok(calls.includes('GET /cycles/:p/modules/:p/form-options'));
  const route = readFileSync('cloudflare-worker/src/routes/cycle_records.ts', 'utf8');
  assert.match(route, /route\.get\('\/:cycle\/modules\/:slug\/form-options'/);
  assert.match(readFileSync('cloudflare-worker/src/index.ts', 'utf8'), /app\.route\('\/api\/cycles', cycleRecords\);/);
  // The app binds the same factory, so `cyclesWrite.formOptions` is the method #1657 and #1704 call.
  assert.match(readFileSync('frontend/src/lib/api/cycles.js', 'utf8'), /export const cyclesWrite = makeCycleWrites\(request\);/);
});

// `npm run test:drift` finds every route (test 11). D690 builds its router in a
// factory (`createCycleRecords()`, so a test can pass its own registry), and
// the guard used to count only verbs on the mounted name, so this call read
// as drift although the route is mounted. The guard now reads that router.
const GUARD = 'scripts/check-api-drift.mjs';
function guardOutput(script) {
  try { return execFileSync('node', [script], { encoding: 'utf8' }); } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
}
function assertGuardSees(script) {
  const out = guardOutput(script);
  assert.match(out, /Worker routes resolved/, 'the guard ran');
  assert.ok(!out.includes('- GET /api/cycles/:p/modules/:p/form-options'), 'formOptions is not reported as a call with no worker route');
}

test('the drift guard reads the router D690\'s factory builds, so formOptions\'s route is found', () => {
  assertGuardSees(GUARD);
  const src = readFileSync(GUARD, 'utf8');
  for (const [before, after] of [
    ['const declaredOn = (name, at) => name === ident || (built && name === built.name && at > built.from && at < built.to);', 'const declaredOn = (name) => name === ident;'],
    ['return local ? { name: local[1], from, to } : null;', 'return null;'],
  ]) {
    assert.ok(src.includes(before), 'mutation target: ' + before);
    // The guard resolves its root from its own path, so the copy sits beside it, for one run.
    const copy = `scripts/.drift-mutant-${process.pid}.mjs`;
    try {
      writeFileSync(copy, src.replace(before, after));
      assert.throws(() => assertGuardSees(copy), { name: 'AssertionError' }, 'mutation must fail: ' + after);
    } finally { rmSync(copy, { force: true }); }
  }
});
