/**
 * D412 — every reason the Perks Worker gives for "you cannot claim this" has
 * its own words on the page.
 *
 * The card used to print `reason === 'tier_required' ? 'Needs an upgrade' :
 * 'Not enough credits'`, so every other reason read as a balance problem. When
 * claiming became founders-only that sentence became false for every investor,
 * advisor and partner looking at the marketplace. The reasons are parsed out of
 * routes/perks.ts's `affordability`, so a new reason added there fails here
 * until the page has a label for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const worker = codeOnly(read('cloudflare-worker/src/routes/perks.ts'));
const page = codeOnly(read('frontend/src/pages/PerksPage.jsx'));

function workerReasons() {
  const start = worker.indexOf('function affordability(');
  assert.ok(start > 0, 'affordability() is gone from routes/perks.ts');
  const body = worker.slice(start, worker.indexOf('\n}\n', start));
  const found = new Set();
  for (const m of body.matchAll(/reason: '([a-z_]+)'/g)) found.add(m[1]);
  // The ternaries: `reason: cond ? null : 'x'`.
  for (const m of body.matchAll(/reason: [^,\n]*\? null : '([a-z_]+)'/g)) found.add(m[1]);
  return found;
}

function pageLabels() {
  const start = page.indexOf('const UNCLAIMABLE_LABEL = {');
  assert.ok(start > 0, 'UNCLAIMABLE_LABEL is gone from PerksPage.jsx');
  const block = page.slice(start, page.indexOf('};', start));
  return new Set([...block.matchAll(/^\s*([a-z_]+):\s*'/gm)].map((m) => m[1]));
}

test('the Worker’s claim refusals are parsed, so this test is live', () => {
  const r = workerReasons();
  for (const expected of ['founders_only', 'perk_ended', 'cap_reached', 'tier_required', 'insufficient_credits']) {
    assert.ok(r.has(expected), `could not find reason ${expected} — the parse went stale`);
  }
});

test('every reason the Worker gives has its own label on the page', () => {
  const labels = pageLabels();
  const missing = [...workerReasons()].filter((r) => !labels.has(r));
  assert.deepEqual(missing, [], 'these reasons would print the fallback, not what is true');
});

test('the card reads the label map, not a two-way ternary that calls everything a balance problem', () => {
  // D413: a paid engagement's CTA is `Request` — nothing is bought here.
  assert.match(page, /p\.claimable \? \(p\.kind === 'money' \? 'Request' : 'Claim'\) : \(UNCLAIMABLE_LABEL\[p\.reason\] \|\| 'Not claimable'\)/);
  assert.doesNotMatch(page, /'Needs an upgrade' : 'Not enough credits'/);
});

test('a non-founder is shown the Worker’s own sentence', () => {
  assert.match(page, /d\.reason === 'founders_only' && d\.reason_text/);
  assert.match(page, /\{d\.reason_text\}/);
});
