/**
 * The Team & Network slide's roster heading, in the three places a deck is built.
 *
 * WHAT D214 FOUND. Every Demo Day deck built from live data printed
 * "ADVISORS & ADVISORS". The worker (`services/decks/spinoutDeckData.ts`) and
 * the Replit-dev mirror (`backend/app/api/routes/projects.py`) both carried it;
 * only the SPA's sample (`frontend/src/decks/spinout/deckData.js`) did not.
 *
 * The cause was a mechanical rename, `fb36dd5fe` — the mentor role became
 * advisor "across all layers", and "ADVISORS & MENTORS" became a repeated word.
 * `a196b1d7e` corrected the sample to "ADVISORS & PARTNERS" and left the other
 * two, and nothing noticed, because no test held the three together. Two of
 * three copies stayed broken while the one a reviewer sees looked right.
 *
 * So this holds four things:
 *   1. each source sets the label exactly once, as a literal;
 *   2. the three are equal;
 *   3. no label repeats its own word — the shape of the defect itself, so a
 *      fourth copy added later cannot bring it back;
 *   4. the label is the canvas's own name for the roster (H19 · C4, "Advisors &
 *      Partners — deck roster"). That is why PARTNERS and not MENTORS: the
 *      platform renamed the mentor role on purpose, and the design names the
 *      roster the deck draws from.
 *
 * WHY IT PARSES SOURCE. The worker module is TypeScript for another runtime and
 * the mirror is Python; reading the literal out of the text is the only way one
 * test holds all three. `deck_category_sources_agree.test.mjs` is the precedent.
 * Comments are stripped first: the worker's line carries the old label's
 * history in a comment directly above it, and a scan over raw text would read
 * that explanation as data (the lesson `_codeOnly.mjs` records).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/spinout_deck_label_d214.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = process.cwd();
const raw = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const WORKER = 'cloudflare-worker/src/services/decks/spinoutDeckData.ts';
const SAMPLE = 'frontend/src/decks/spinout/deckData.js';
const DEV_MIRROR = 'backend/app/api/routes/projects.py';
const CANVAS = 'design/canvases/integrated/Admin · Super.dc.html';

// A Python comment is a line that starts with `#`. Hex colours in this file sit
// inside string literals, so only whole-line comments are removed.
const pythonCode = (src) => src.replace(/^[ \t]*#.*$/gm, '');

const JS_LABEL = /advisorsLabel\s*:\s*(['"])(.*?)\1/g;
const PY_LABEL = /"advisorsLabel"\s*:\s*"(.*?)"/g;

function labelsIn(path) {
  if (path.endsWith('.py')) {
    return [...pythonCode(raw(path)).matchAll(PY_LABEL)].map((m) => m[1]);
  }
  return [...codeOnly(raw(path)).matchAll(JS_LABEL)].map((m) => m[2]);
}

const words = (label) => label.toUpperCase().split(/[^A-Z]+/).filter(Boolean);

test('each of the three sources sets the roster label exactly once, as a literal', () => {
  for (const path of [WORKER, SAMPLE, DEV_MIRROR]) {
    const found = labelsIn(path);
    assert.equal(found.length, 1, `${path} sets advisorsLabel ${found.length} times; one literal is the contract`);
    assert.ok(found[0].trim().length > 0, `${path} sets an empty label, so the slide prints a blank heading`);
  }
});

test('the worker, the SPA sample and the dev mirror print the same heading', () => {
  const [worker] = labelsIn(WORKER);
  const [sample] = labelsIn(SAMPLE);
  const [mirror] = labelsIn(DEV_MIRROR);
  assert.equal(worker, sample,
    'the deck built from live data and the sample a reviewer sees disagree — '
    + 'which is exactly how "ADVISORS & ADVISORS" hid behind a correct sample');
  assert.equal(mirror, worker, 'Replit dev builds a different heading from production');
});

test('no label repeats its own word — the defect the mentor→advisor rename left behind', () => {
  for (const path of [WORKER, SAMPLE, DEV_MIRROR]) {
    const [label] = labelsIn(path);
    const w = words(label);
    assert.ok(w.length >= 2, `${path}: "${label}" names one group where the slide lists two`);
    assert.equal(new Set(w).size, w.length, `${path}: "${label}" repeats a word`);
    assert.ok(!w.includes('MENTORS'), `${path}: "${label}" uses the role the platform renamed`);
  }
});

test('the label is the canvas’s own name for the roster the deck draws from', () => {
  const [label] = labelsIn(WORKER);
  const canvas = readFileSync(resolve(ROOT, CANVAS), 'utf8');
  // "ADVISORS & PARTNERS" → "Advisors &amp; Partners", as the canvas encodes it.
  const drawn = label
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace('&', '&amp;');
  assert.ok(canvas.includes(`${drawn} — deck roster`),
    `H19 names the roster "${drawn} — deck roster"; the deck heading no longer matches it`);
});

test('one literal per tier: nothing else in the SPA or the worker spells the heading', () => {
  // A second spelling of the heading elsewhere in a tier is a second source that
  // can drift, which is the whole defect. The readers print the field verbatim
  // (`axal_spinout_demoday_app.tsx`, `buildDeck.js`) and must not supply one.
  const walk = (dir) => readdirSync(resolve(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(?:[cm]?js|jsx|ts|tsx)$/.test(e.name) ? [p] : [];
  });
  for (const [tier, only] of [['frontend/src', SAMPLE], ['cloudflare-worker/src', WORKER]]) {
    const hits = walk(tier).filter((p) => /ADVISORS\s*&/.test(codeOnly(raw(p))));
    assert.deepEqual(hits, [only], `${tier} spells the heading in ${hits.length} files; ${only} is the one`);
  }
});
