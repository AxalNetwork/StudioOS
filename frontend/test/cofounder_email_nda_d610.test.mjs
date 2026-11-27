/**
 * D610 (#1310) — the Connections tab said why no email is shown: the Worker
 * withholds the other person's email until both have signed the NDA.
 *
 * #2355 (#2297 §3, the owner's Remove) deleted that tab with its page,
 * `/cofounder`: Co-founder Match at /spinout-lab/cofounder-match is the one
 * matcher, and the NDA connection flow was a feature only the removed page had.
 * What stays is the Worker's rule, pinned by its own D610 test
 * (`cloudflare-worker/test/cofounder_email_nda_d610.test.ts`). This file now
 * pins that the card is gone, so it does not come back without its page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const at = (p) => new URL(`../${p}`, import.meta.url);
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(n) ? [p] : [];
});

test('D610: the Connections card went with /cofounder; no client file draws the NDA connection flow', () => {
  assert.ok(!existsSync(at('src/pages/CofounderPage.jsx')), 'the removed /cofounder page is back');
  for (const f of files(at('src').pathname)) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /\bConnectionCard\b/, f);
    assert.doesNotMatch(src, /Shown once you have both signed the NDA/, f);
  }
});

test('D610: the Worker still withholds the email until both sign, under its own test', () => {
  const route = readFileSync(at('../cloudflare-worker/src/routes/cofounder.ts'), 'utf8');
  assert.match(route, /email_withheld/);
  assert.ok(existsSync(at('../cloudflare-worker/test/cofounder_email_nda_d610.test.ts')));
});
