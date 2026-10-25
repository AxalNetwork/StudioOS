// D985 (#2777, part 4 of #2376): the Programs row names where the grant gate
// stands, and the worker agrees.
//
// `branchFreeze.js`'s Programs row carries `grantGatedIn`, the route files
// that call `programRefusal`. Like `gatedIn` for the freeze, the list is
// evidence: this test reads the worker and fails when a file gains or loses
// the gate without the row following. Behaviour is held by the Worker test,
// `cloudflare-worker/test/program_enforcement_d985.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { FROZEN } from '../src/lib/branchFreeze.js';

const ROUTES = 'cloudflare-worker/src/routes';
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const programs = FROZEN.find((r) => r.row === 'Programs');

/** Route files whose code awaits the grant gate. */
function filesThatGrantGate() {
  return readdirSync(resolve(process.cwd(), ROUTES))
    .filter((f) => f.endsWith('.ts') && /await programRefusal\(c\.env, '[a-z-]+'\)/.test(codeOnly(read(`${ROUTES}/${f}`))))
    .sort();
}

test('the Programs row names exactly the route files that call the grant gate', () => {
  assert.deepEqual([...programs.grantGatedIn].sort(), filesThatGrantGate());
});

test('every grant-gated file is also frozen: the grant gate never stands where the freeze does not', () => {
  const frozen = new Set(FROZEN.flatMap((r) => r.gatedIn));
  for (const f of programs.grantGatedIn) assert.ok(frozen.has(f), `${f} checks the grant but no row says it freezes`);
});

test('each call site names a program a branch route can hold', () => {
  const allowed = new Set(['spinout-lab', 'mentor-cohorts', 'refer-and-earn', 'perks']);
  for (const f of filesThatGrantGate()) {
    for (const [, key] of codeOnly(read(`${ROUTES}/${f}`)).matchAll(/programRefusal\(c\.env, '([a-z-]+)'\)/g)) {
      assert.ok(allowed.has(key), `${f} gates on ${key}`);
    }
  }
});

test('in every handler the grant gate comes after the freeze, never before it', () => {
  for (const f of filesThatGrantGate()) {
    const src = codeOnly(read(`${ROUTES}/${f}`));
    for (const m of src.matchAll(/await programRefusal\(c\.env,/g)) {
      const before = src.slice(0, m.index);
      const handler = Math.max(before.lastIndexOf('.post('), before.lastIndexOf('.patch('), before.lastIndexOf('export async function '));
      assert.ok(handler >= 0, `${f}: no handler above the gate`);
      assert.ok(before.slice(handler).includes('await requireBranchNotSuspended(c)'),
        `${f}: a grant gate at offset ${m.index} is not preceded by the freeze in its handler`);
    }
  }
});

test('the row tells the reader the grant is a second condition, outside a suspension', () => {
  assert.match(programs.note, /Outside a suspension, admissions, host approvals, certificate issues, mentor assignments, perk approvals and Refer & Earn acceptances also need the program in this studio’s licence: granted by HQ, not paused, and inside its dates\.$/);
});
