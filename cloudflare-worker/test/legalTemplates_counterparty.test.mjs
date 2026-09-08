// Task #1 (DB) — smoke test for the e-sign envelope merge-field
// resolver. Exercises the *production* `applyMergeFields` exported
// from cloudflare-worker/src/services/legalTemplates.ts so any
// regression in the dotted-path lookup, missing-token preservation,
// or the regex itself surfaces here before the next contract send
// leaks an empty AXF-id.
//
// We can't import `renderLegalTemplate` directly because it depends
// on Wrangler's `?raw` import suffix to load the markdown template
// bundle (node has no equivalent loader). So we drive a representative
// template fragment through `applyMergeFields`, which is the same
// function `renderLegalTemplate` calls internally — coverage of the
// merge layer is identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Import the pure resolver module directly (no template `?raw` deps)
// so the test runs under `node --test` without a Wrangler bundler.
import { applyMergeFields } from '../src/services/mergeFields.ts';

const TEMPLATE = `
COUNTERPARTY DESIGNATION

This Agreement is entered into between Axal Studio Inc. and the
counterparty identified below.

Counterparty Name: {{recipient_name}}
Counterparty Email: {{recipient_email}}
Founder ID:        {{counterparty.founder_id}}
Partner ID:        {{counterparty.partner_id}}
Effective Date:    {{effective_date}}
`.trim();

test('applyMergeFields resolves counterparty.founder_id (envelope path)', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'Alice Founder',
    recipient_email: 'alice@example.com',
    effective_date: '2026-05-13',
    counterparty: { founder_id: 'AXF-000123', partner_id: null, user_id: 7 },
  });
  assert.match(out, /Founder ID:\s+AXF-000123/);
  assert.match(out, /Counterparty Name:\s+Alice Founder/);
  // Unset partner id is preserved verbatim, not silently emptied.
  assert.match(out, /Partner ID:\s+\{\{counterparty\.partner_id\}\}/);
});

test('applyMergeFields resolves counterparty.partner_id (envelope path)', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'Bob Partner',
    recipient_email: 'bob@example.com',
    effective_date: '2026-05-13',
    counterparty: { founder_id: null, partner_id: 'AXP-0000A0', user_id: 9 },
  });
  assert.match(out, /Partner ID:\s+AXP-0000A0/);
  assert.match(out, /Founder ID:\s+\{\{counterparty\.founder_id\}\}/);
});

test('applyMergeFields preserves unresolved tokens as literal placeholders', () => {
  const out = applyMergeFields(TEMPLATE, {
    recipient_name: 'X',
    recipient_email: 'x@y.com',
    effective_date: '2026-05-13',
    // counterparty omitted entirely
  });
  assert.match(out, /Founder ID:\s+\{\{counterparty\.founder_id\}\}/);
  assert.match(out, /Partner ID:\s+\{\{counterparty\.partner_id\}\}/);
});

test('applyMergeFields supports flat top-level keys', () => {
  const out = applyMergeFields('Hello {{name}}!', { name: 'Alice' });
  assert.equal(out, 'Hello Alice!');
});

test('applyMergeFields handles whitespace inside the placeholder', () => {
  const out = applyMergeFields('ID={{  counterparty.founder_id  }}', {
    counterparty: { founder_id: 'AXF-000123' },
  });
  assert.equal(out, 'ID=AXF-000123');
});

// ---------------------------------------------------------------------------
// The token grammar is one object, and the e-sign route no longer builds its own
// ---------------------------------------------------------------------------

/**
 * `routes/esign.ts` used to expand merge fields by compiling one regex per
 * submitted key — `new RegExp('\\{\\{\\s*' + escape(key) + '\\s*\\}\\}', 'g')` —
 * and the escape was mis-nested. Its character class closed fifteen characters
 * in (`/[.*+?^${}()|[\\]\\\\]/`), so the pattern read "one metacharacter, two
 * backslashes, a bracket" and matched almost nothing: `company.name` came back
 * unchanged. Nothing exploited it — the request validator restricts keys to
 * `[A-Za-z0-9_\-.]` and `buildTemplateBody` emits no tokens at all — but it was
 * the last open `detect-non-literal-regexp` finding and a trap besides.
 *
 * These assertions are what stops it coming back: the route holds no `RegExp`
 * of its own, and both of its branches ask the same shared resolver.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mergeTokensIn } from '../src/services/mergeFields.ts';
// The comment ABOVE explains why `new RegExp` is gone, and says the words. Ban
// them in code only, or the explanation fails the assertion it belongs to —
// the six-failures lesson `_codeOnly.mjs` was written for.
import { codeOnly } from '../../frontend/test/_codeOnly.mjs';

const ESIGN_SRC = codeOnly(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/routes/esign.ts'), 'utf8',
));

test('the e-sign route builds no regex of its own', () => {
  assert.equal(
    ESIGN_SRC.includes('new RegExp'), false,
    'a dynamic RegExp is back in esign.ts — merge expansion belongs to applyMergeFields',
  );
  // And it reaches the shared resolver on BOTH branches, not just the D1 one.
  assert.equal(
    (ESIGN_SRC.match(/applyMergeFields\(/g) || []).length, 2,
    'both the stored-template branch and the legacy branch must expand through applyMergeFields',
  );
});

test('a key full of regex metacharacters is inert, not a pattern', () => {
  // The old code fed the key into a RegExp. `(` alone would have thrown
  // (SyntaxError → a 500 on send); `.` would have matched any character and
  // substituted into a token that was never written.
  const body = 'A={{a.b}} B={{plain}}';
  const out = applyMergeFields(body, { '(evil': 'x', 'a.b': 'ok', plain: 'p' });
  assert.equal(out, 'A={{a.b}} B=p', 'a dotted FLAT key is a path, not a literal key');
  assert.doesNotThrow(() => applyMergeFields(body, { '(': '1', '.*': '2', '[': '3' }));
  assert.equal(applyMergeFields('X={{plain}}', { '.*': 'swallowed' }), 'X={{plain}}');
});

test('mergeTokensIn reports the tokens a body carries, and only those', () => {
  assert.deepEqual(
    [...mergeTokensIn('{{a}} text {{ b.c }} {{a}}')].sort(), ['a', 'b.c'],
    'deduplicated, whitespace-tolerant, dotted paths kept whole',
  );
  assert.deepEqual([...mergeTokensIn('no tokens here')], []);
  // `{{a-b}}` is not a token under this grammar; the request validator accepts
  // a hyphen in a key, so a caller CAN send one — it simply never matches, and
  // both branches now agree about that instead of one silently claiming it did.
  assert.deepEqual([...mergeTokensIn('{{a-b}}')], []);
});

test('the shared /g token regex carries no lastIndex between calls', () => {
  // `applyMergeFields`, `resolveWithBrackets` and `mergeTokensIn` share one
  // module-level `/…/g` object. That is only safe because `replace` resets
  // lastIndex and `matchAll` clones — a `.test()` or `.exec()` added later
  // would break it, and it would break intermittently, which is why this runs
  // each entry point twice and compares.
  const body = '{{one}} {{two}}';
  assert.deepEqual([...mergeTokensIn(body)], [...mergeTokensIn(body)]);
  assert.equal(applyMergeFields(body, { one: '1', two: '2' }), '1 2');
  assert.equal(applyMergeFields(body, { one: '1', two: '2' }), '1 2');
  assert.deepEqual([...mergeTokensIn(body)].sort(), ['one', 'two']);
});
