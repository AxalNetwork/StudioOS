/**
 * THE NEEDS BOARD READ THE WRONG ENVELOPE KEY ON EVERY LIST IT HAS.
 *
 * `GET /needs`, `GET /needs/:id/quotes`, `GET /quotes/me` and `GET /engagements`
 * all answer `{ items }`. `NeedsBoardPage.jsx` read `.needs`, `.quotes` and
 * `.engagements` — five reads, every one `undefined`, each falling through a
 * `|| []` into an empty list that rendered as "no open needs" rather than as a
 * failure. So the Browse board, the founder's My needs, a need's quote list,
 * the partner's My quotes and the Engagements table were ALL permanently
 * empty, on `/needs`, `/partner/needs`, `/founder/post-need` and the partner's
 * `/pipeline/leads`.
 *
 * WHAT MADE IT FINDABLE, and what this file pins: `EngagementsPage.jsx` calls
 * three of the same four methods and reads `.items` correctly. One file right,
 * one wrong, same endpoints — so the envelope is not ambiguous, it was simply
 * mistyped and then hidden by the default.
 *
 * It is the same shape as `agreed_price` for `price`, `claims_count` for
 * `claim_count`, and a `sold` that was always null: a plausible name that
 * resolves to undefined, and a `||` that turns the absence into a confident
 * answer. Source tests could not see it because the page is syntactically
 * perfect; only rendering it with a populated response showed the rows never
 * arriving.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NEEDS_ROUTE = read('cloudflare-worker/src/routes/needs.ts');

/**
 * The four reads this page depends on, each with the api.js method that calls
 * it. The worker side is asserted from source rather than assumed, so if a
 * route ever changes its envelope this test says so instead of silently
 * pinning the old one.
 */
const ENDPOINTS = [
  { method: 'listNeeds', handler: "needs.get('/', " },
  { method: 'listQuotesForNeed', handler: "needs.get('/:id/quotes'" },
  { method: 'myQuotes', handler: "quotesRouter.get('/me'" },
  { method: 'listEngagements', handler: "engagementsRouter.get('/'" },
];

test('the four needs-board routes all answer with an `items` envelope', () => {
  for (const { handler } of ENDPOINTS) {
    const at = NEEDS_ROUTE.indexOf(handler);
    assert.ok(at > 0, `route handler not found: ${handler} — has it been renamed?`);
    // The handler's own body, up to the next top-level route registration.
    const rest = NEEDS_ROUTE.slice(at);
    const end = rest.slice(1).search(/\n(needs|quotesRouter|engagementsRouter)\.(get|post|patch|delete)\(/);
    const body = end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
    assert.match(body, /c\.json\(\{\s*items/,
      `${handler} no longer answers with { items } — every consumer below reads that key`);
  }
});

test('no page reads a needs-board list under any key but `items`', () => {
  // The bug, pinned shut. `.needs`, `.quotes` and `.engagements` off one of
  // these calls is always undefined.
  const PAGES = [
    'frontend/src/pages/NeedsBoardPage.jsx',
    'frontend/src/pages/partner/operations/EngagementsPage.jsx',
  ];
  const WRONG = ['needs', 'quotes', 'engagements', 'rows', 'results', 'data'];
  for (const page of PAGES) {
    const src = codeOnly(read(page));
    for (const { method } of ENDPOINTS) {
      // Every place the method is called, then the key read off its result
      // within the next couple of lines.
      for (const m of src.matchAll(new RegExp(`api\\.${method}\\([^)]*\\)`, 'g'))) {
        const after = src.slice(m.index, m.index + 260);
        for (const key of WRONG) {
          assert.ok(
            !new RegExp(`\\.${key}\\s*\\|\\|`).test(after),
            `${page}: api.${method}() result is read as \`.${key}\`, but the route answers `
            + '{ items } — that read is undefined and the `|| []` renders it as "none".',
          );
        }
      }
    }
    // And the catch-fallback has to use the same key, or a failed read
    // reintroduces the bug on the error path only.
    assert.doesNotMatch(src, /catch\(\(\) => \(\{ (needs|quotes|engagements): \[\] \}\)\)/,
      `${page}: a catch fallback shapes the wrong envelope`);
  }
});

test('NeedsBoardPage reads every one of its lists as `items`', () => {
  // Five reads, counted, so a sixth list added later cannot quietly use a
  // different key.
  const src = codeOnly(read('frontend/src/pages/NeedsBoardPage.jsx'));
  const reads = [...src.matchAll(/\.(\w+)\s*\|\|\s*\[\]/g)].map((m) => m[1]);
  const listReads = reads.filter((k) => ['items', 'needs', 'quotes', 'engagements'].includes(k));
  assert.ok(listReads.length >= 5, `expected at least 5 list reads, found ${listReads.length}`);
  assert.deepEqual([...new Set(listReads)], ['items'],
    'every list on the needs board comes from an { items } envelope');
});
