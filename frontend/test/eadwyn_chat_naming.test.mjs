/**
 * The chat panel is called Eadwyn AI, and the two places that say so agree.
 *
 * WHY THIS FILE EXISTS. `ui/README.md` has declared the rule since it was
 * written — "The assistant is called **Eadwyn**. Its copy must avoid regulated
 * wording — 'advisor', 'advice', 'recommendation', 'fiduciary' are
 * lint-enforced out of AI naming and surfaces" — and the chat header read
 * "Personal Advisor" anyway, which is the product naming the model in the exact
 * word the rule bans.
 *
 * IT WAS NOT AN OVERSIGHT IN THE LINT. `check-regulated-wording.mjs` has always
 * scanned this file; it lists it as "the chatbot UI — header, placeholder,
 * empty states". The check was green because the string was ON RECORD in its
 * baseline, with the reason: "Shipped product name ... renaming it is a product
 * and marketing decision, not a lint fix. Tracked separately." That is the lint
 * correctly refusing to make a naming call on its own. The call has now been
 * made, and the baseline entry went with the string.
 *
 * SO WHAT DOES THIS FILE ADD, given the lint? The lint bans a word; it cannot
 * require a name. Reverting the header to "Personal Assistant", or to anything
 * else avoiding the four families, passes it. This pins the name itself, and
 * pins the two surfaces that carry it to each other.
 *
 * Run with:
 *   node --test frontend/test/eadwyn_chat_naming.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const CHAT = 'frontend/src/components/advisor/PersonalAdvisor.jsx';
const SRC = read(CHAT);
const CODE = codeOnly(SRC);
const NAME = 'Eadwyn AI';

test('both chat headers carry the name, and there are exactly two', () => {
  // Two, because the panel has a docked header and a fullscreen one. Renaming
  // whichever you happen to be looking at and missing the other is the failure
  // this count exists for: a user who expands the panel would watch the product
  // rename itself mid-session.
  const headers = [...CODE.matchAll(
    /<div className="text-sm font-semibold text-gray-900 dark:text-gray-100">([^<]*)<\/div>/g,
  )].map((m) => m[1]);
  assert.equal(headers.length, 2, `expected 2 chat headers, found ${headers.length}`);
  for (const h of headers) assert.equal(h, NAME);
});

test('the screen-reader label says the same thing the header does', () => {
  // A dialog labelled one product and titled another is the same defect as a
  // mismatched header, heard instead of seen.
  const aria = CODE.match(/aria-label="([^"]*)"/)?.[1];
  assert.equal(aria, NAME, 'the dialog announces a different name than it displays');
});

test('no user-visible string in the chat surface still says the old name', () => {
  // Through `codeOnly`, because the docblock above the component explains the
  // rename and has to be able to quote what it replaced — the same reason that
  // helper exists at all.
  assert.ok(!CODE.includes('Personal Advisor'),
    'the chat surface still shows "Personal Advisor" somewhere outside a comment');
});

test('the name matches the one the design system declares', () => {
  // Read rather than repeated: if `ui/README.md` ever renames the assistant,
  // this fails here instead of leaving one surface behind.
  const readme = read('frontend/src/ui/README.md');
  const declared = readme.match(/The assistant is called \*\*(\w+)\*\*/)?.[1];
  assert.equal(declared, 'Eadwyn', 'ui/README.md no longer declares Eadwyn');
  assert.ok(NAME.startsWith(declared), `the chat header (${NAME}) is not a ${declared} name`);
});

test('the regulated-wording ledger no longer carries the retired string', () => {
  // The baseline fails on an entry whose copy is gone, so this is already
  // enforced by `check-regulated-wording.mjs` — asserted here too because it is
  // the half of the change a reader is most likely to undo by hand, restoring
  // the entry to "fix" a red check rather than reading why it went red.
  const baseline = JSON.parse(read('scripts/regulated-wording-baseline.json'));
  const stale = baseline.onRecord.filter(
    (e) => e.file.endsWith('PersonalAdvisor.jsx') && e.text === 'Personal Advisor',
  );
  assert.deepEqual(stale, [],
    'the retired "Personal Advisor" entry is back in the baseline, with no string to match');
});
