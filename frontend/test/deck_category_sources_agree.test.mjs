/**
 * A deck has ONE category, and three files have to say so.
 *
 * WHAT #207 WAS. The same thirteen decks are described in three places, each
 * carrying its own `id → category` table:
 *
 *   1. `cloudflare-worker/src/services/decks/methods.ts` — production, served by
 *      `GET /api/decks/methods`
 *   2. `frontend/src/decks/templates/index.ts` — the SPA's own registry
 *   3. `backend/app/api/routes/decks.py` (`_DECK_METHODS_DEV`) — the Replit-dev
 *      FastAPI mirror of the same endpoint
 *
 * Two of them had drifted, on the same two decks. The worker filed
 * `sequoia_classic` and `narrative_brand` under a fourth value, `'narrative'`,
 * while the registry called them `fundraising` and `commercial` — and because
 * `PitchDeckPage.jsx:1570` merges the two as `m.category || tpl.category`, the
 * worker won: the Sequoia template, which is the one founders raise money with,
 * displayed "NARRATIVE" on its card and fell out of the Fundraising chip
 * entirely. A founder filtering the picker could not find it.
 *
 * NOTHING WAS WATCHING, AND THAT IS THE REAL FINDING. `scripts/check-deck-
 * templates.mjs` guards the registry, but its `REQUIRED_FIELDS` deliberately
 * omits `category`; `decks.autofill.test.ts` imports `methods.ts` and asserts
 * slide counts; `_DECK_METHODS_DEV` was covered by nothing at all. So all three
 * tables were free to move independently and two of them did, for months,
 * visibly, without failing anything.
 *
 * Fixing the two values would have left that freedom in place. This is the fix.
 *
 * WHY IT PARSES SOURCE RATHER THAN IMPORTING. The registry imports thirteen deck
 * components and React; the worker module is TypeScript for a different runtime;
 * the third file is Python. Reading the tables out of the text is the only way
 * one test can hold all three, and it is the pattern the repo already uses where
 * a claim spans languages (`cloudflare-worker/test/terms_reacceptance_gate.test.ts`
 * extracts SQL from `auth.ts` and runs it against SQLite).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/deck_category_sources_agree.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shareDeckFlow } from '../src/lib/shareDeckAudience.js';

const WORKER = 'cloudflare-worker/src/services/decks/methods.ts';
const REGISTRY = 'frontend/src/decks/templates/index.ts';
const DEV_MIRROR = 'backend/app/api/routes/decks.py';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Comments are stripped before every scan, and this is not fussiness.
 *
 * Each of the three tables now carries prose explaining the value it used to
 * hold — "`narrative` until #207" sits directly above the line that says
 * `category: 'fundraising'`. A scan over raw text reads the explanation as data
 * and fails the file for documenting its own history, which is the lesson
 * `frontend/test/_codeOnly.mjs` exists to record: the line you most want to keep
 * is usually the one that names the thing.
 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/^[ \t]*#[^\n]*$/gm, '');   // Python
}

/** `{ id → category }` from the worker's `DECK_METHODS` array. */
function workerTable() {
  const src = stripComments(raw(WORKER));
  const out = new Map();
  // Each spec opens `id: 'x', key: 'x',` and declares `category: 'y',` a few
  // lines down, before the next spec's `id:`. Slice per spec so a stray
  // `category` elsewhere in the file cannot be mistaken for one of these.
  const starts = [...src.matchAll(/^\s*id:\s*'([a-z0-9_]+)',/gm)];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const m = /^\s*category:\s*'([a-z_]+)',/m.exec(src.slice(from, to));
    if (m) out.set(starts[i][1], m[1]);
  }
  return out;
}

/** `{ id → category }` from the SPA registry's `TEMPLATES` record. */
function registryTable() {
  const src = stripComments(raw(REGISTRY));
  const body = src.slice(src.indexOf('export const TEMPLATES'));
  const out = new Map();
  for (const m of body.matchAll(/key:\s*'([a-z0-9_]+)'[\s\S]*?category:\s*'([a-z_]+)'/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** `{ id → category }` from the FastAPI dev mirror's `_DECK_METHODS_DEV`. */
function devMirrorTable() {
  const src = stripComments(raw(DEV_MIRROR));
  const body = src.slice(src.indexOf('_DECK_METHODS_DEV'));
  const out = new Map();
  for (const m of body.matchAll(/"id":\s*"([a-z0-9_]+)"[\s\S]*?"category":\s*"([a-z_]+)"/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

const SOURCES = [
  ['worker', WORKER, workerTable],
  ['registry', REGISTRY, registryTable],
  ['dev mirror', DEV_MIRROR, devMirrorTable],
];

test('each source is actually parsed — thirteen decks, not zero', () => {
  // A REGEX THAT MATCHES NOTHING AGREES WITH EVERYTHING. Without this, renaming
  // `DECK_METHODS` or reformatting one table to a single line would turn the
  // comparison below into a check that two empty maps are equal, and it would
  // pass forever. Assert the shape of the evidence before trusting the verdict.
  for (const [name, path, read] of SOURCES) {
    const table = read();
    assert.equal(table.size, 13,
      `${name} (${path}): parsed ${table.size} decks, expected 13. Either a deck was added or `
      + 'removed — in which case make the same change in all three tables and update this number '
      + `and \`EXPECTED\` in scripts/check-deck-templates.mjs — or the table's shape changed and `
      + 'the reader above stopped seeing it.');
    for (const [id, category] of table) {
      assert.match(category, /^[a-z_]+$/, `${name}: ${id} has a malformed category "${category}"`);
    }
  }
});

test('all three tables give every deck the same category', () => {
  const [worker, registry, dev] = SOURCES.map(([, , read]) => read());

  assert.deepEqual([...registry.keys()].sort(), [...worker.keys()].sort(),
    'the registry and the worker describe different sets of decks');
  assert.deepEqual([...dev.keys()].sort(), [...worker.keys()].sort(),
    'the FastAPI dev mirror describes a different set of decks from the worker');

  const disagreements = [];
  for (const [id, category] of worker) {
    if (registry.get(id) !== category) {
      disagreements.push(`${id}: worker says "${category}", registry says "${registry.get(id)}"`);
    }
    if (dev.get(id) !== category) {
      disagreements.push(`${id}: worker says "${category}", dev mirror says "${dev.get(id)}"`);
    }
  }
  assert.deepEqual(disagreements, [],
    'a deck cannot have two categories — the picker reads the worker\'s value and the share '
    + 'CTA reads the registry\'s, so a split sends the same deck to two different screens:\n  '
    + disagreements.join('\n  '));
});

test('every category any source emits is one a share link can actually route', () => {
  // The other half of the #205/#207 pair. Agreement alone is not enough: three
  // tables could agree on a value `lib/shareDeckAudience.js` has never heard of,
  // and every share link for those decks would render no CTA — silently, since
  // refusing is also what an unknown value correctly does.
  for (const [name, , read] of SOURCES) {
    for (const [id, category] of read()) {
      assert.ok(shareDeckFlow(category),
        `${name}: "${id}" is categorised "${category}", which no share link knows how to `
        + 'honour — map it in lib/shareDeckAudience.js or use an existing category');
    }
  }
});

test('the picker offers a chip for every category a deck can hold', () => {
  // THE SYMPTOM #207 WAS REPORTED AS, guarded from the other side. The filter
  // row is a hard-coded list; `PitchDeckPage.jsx:1580` keeps a card only when
  // `filter === 'all' || c.category === filter`. A category with no chip is
  // therefore reachable ONLY under "All" — which is exactly what happened to
  // Sequoia Classic and Narrative/Brand, and it looked like the templates had
  // gone missing rather than like a filter row being one entry short.
  //
  // Agreeing tables do not fix this on their own: three sources could agree on
  // a new category tomorrow and it would still be unfindable in the picker.
  const src = stripComments(raw('frontend/src/pages/PitchDeckPage.jsx'));
  const row = /\[\s*'all'((?:\s*,\s*'[a-z_]+')+)\s*\]\s*\.map/.exec(src);
  assert.ok(row, 'could not find the picker filter row in PitchDeckPage.jsx');
  const chips = new Set([...row[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  for (const [id, category] of workerTable()) {
    assert.ok(chips.has(category),
      `"${id}" is categorised "${category}" and the picker has no chip for it — the deck is `
      + 'reachable only under "All"');
  }
});

test('`narrative` is retired, and no source may quietly bring it back', () => {
  // THE DURABLE ONE. #207's finding is not "two values were wrong" — it is that
  // `'narrative'` named a deck's STYLE inside a vocabulary of AUDIENCES, so
  // nothing could route it and D97 was right to refuse to guess. The value is
  // gone from all three tables and from the worker's union type; re-adding it
  // anywhere is a decision about what a narrative deck's share link promises a
  // viewer who has just signed an NDA, and it should fail here until someone
  // makes that decision on purpose.
  for (const [name, , read] of SOURCES) {
    const back = [...read()].filter(([, c]) => c === 'narrative').map(([id]) => id);
    assert.deepEqual(back, [],
      `${name}: ${back.join(', ')} filed under "narrative" again — see D102`);
  }
  const union = stripComments(raw(WORKER));
  assert.doesNotMatch(union, /category:\s*(?:'[a-z_]+'\s*\|\s*)*'narrative'/,
    "the worker's category union admits 'narrative' again — it is a style, not an audience (D102)");
});
