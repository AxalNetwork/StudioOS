/**
 * The persona taxonomy exists four times, and three of them have to agree.
 *
 * WHAT D254 WAS. `cloudflare-worker/src/personas.ts` (PERSONAS) is the
 * canonical source, "Mirrored verbatim" (its own comment said) in
 * `frontend/src/lib/personas.js` — the copy the sidebar actually reads
 * (App.jsx) — and in `backend/app/api/routes/personas.py`, the dev-only
 * FastAPI mirror. All three agreed on the 12 ids, their labels,
 * `role_alignment` and the follow-up question keys. Their NAV ENTRIES did
 * not:
 *
 *   - founder_existing: the worker offered `/founder` (no such route exists
 *     — only `/founder/post-need`); the frontend had only `/legal-capital`.
 *   - operator_advisor: the worker offered `/projects` (which only
 *     redirects to `/build`); the frontend pointed at `/build` directly.
 *
 * Nothing caught it because the two existing guards
 * (`founder_portal_removed.test.mjs`, `spinouts_page_removed.test.mjs`) each
 * watch ONE copy. `GET /api/personas/taxonomy` serves the worker's dead
 * link and nothing drew it, which is why nobody saw it either.
 *
 * A fourth copy, `frontend/src/pages/IntroductionsPanel.jsx`'s
 * `PERSONA_LABEL`, intentionally differs from the canonical labels on 5 of
 * the 12 ids (shorter labels for its entity filter/chips, and the two
 * founder personas merged into one 'Founder' option) — a product call, not
 * drift, recorded in D254. This file pins its KEY SET to the canonical 12
 * ids, not its values, so a 13th persona fails loudly instead of rendering
 * unlabelled.
 *
 * WHY IT PARSES SOURCE RATHER THAN IMPORTING. The worker module is
 * TypeScript for a different runtime; the third file is Python — reading
 * the tables out of text is the only way one test can hold all three, on
 * the shape of `deck_category_sources_agree.test.mjs` (D102).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/persona_sources_agree.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKER = 'cloudflare-worker/src/personas.ts';
const FRONTEND = 'frontend/src/lib/personas.js';
const DEV_MIRROR = 'backend/app/api/routes/personas.py';
const INTRODUCTIONS = 'frontend/src/pages/IntroductionsPanel.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Comments stripped before every scan — see D102's note on why. */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/^[ \t]*#[^\n]*$/gm, '');   // Python
}

/**
 * One persona's record: label, role_alignment, nav_extras (as `to` targets,
 * order-independent) and follow-up question keys. `hasNav` distinguishes
 * "declares an empty nav_extras: []" from "the field does not exist at all"
 * (true of every Python entry), so the comparison below can skip Python's
 * nav dimension entirely rather than reading its absence as an empty list.
 */
function parsePersonaBlocks(src, { idRe, labelRe, roleRe, navRe, keyRe, hasNav }) {
  const out = new Map();
  const starts = [...src.matchAll(idRe)];
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : src.length;
    const block = src.slice(from, to);
    const id = starts[i][1];
    const label = labelRe.exec(block)?.[1] ?? null;
    const role = roleRe.exec(block)?.[1] ?? null;
    const keys = [...block.matchAll(keyRe)].map((m) => m[1]);
    let nav = null;
    if (hasNav) {
      const navBlock = navRe.exec(block);
      nav = navBlock
        ? [...navBlock[0].matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]).sort()
        : null;
    }
    out.set(id, { label, role, keys: keys.sort(), nav });
  }
  return out;
}

function workerTable() {
  return parsePersonaBlocks(stripComments(raw(WORKER)), {
    idRe: /^\s*id:\s*'([a-z0-9_]+)',/gm,
    labelRe: /^\s*label:\s*'([^']*)',/m,
    roleRe: /^\s*role_alignment:\s*'([a-z]+)',/m,
    navRe: /nav_extras:\s*\[[^\]]*\]/,
    keyRe: /^\s*\{\s*key:\s*'([a-z0-9_]+)',/gm,
    hasNav: true,
  });
}

function frontendTable() {
  return parsePersonaBlocks(stripComments(raw(FRONTEND)), {
    idRe: /^\s*id:\s*'([a-z0-9_]+)',/gm,
    labelRe: /^\s*label:\s*'([^']*)',/m,
    roleRe: /^\s*role_alignment:\s*'([a-z]+)',/m,
    navRe: /nav_extras:\s*\[[^\]]*\]/,
    keyRe: /^\s*\{\s*key:\s*'([a-z0-9_]+)',/gm,
    hasNav: true,
  });
}

function devMirrorTable() {
  return parsePersonaBlocks(stripComments(raw(DEV_MIRROR)), {
    idRe: /^\s*"id":\s*"([a-z0-9_]+)",/gm,
    labelRe: /^\s*"label":\s*"([^"]*)",/m,
    roleRe: /^\s*"role_alignment":\s*"([a-z]+)",/m,
    navRe: null,
    keyRe: /^\s*\{"key":\s*"([a-z0-9_]+)",/gm,
    hasNav: false,
  });
}

const SOURCES = [
  ['worker', WORKER, workerTable],
  ['frontend', FRONTEND, frontendTable],
  ['dev mirror', DEV_MIRROR, devMirrorTable],
];

const CANONICAL_IDS = [
  'lp_individual', 'lp_institutional', 'gp_external', 'angel_scout', 'corporate_vc',
  'sovereign_family_office', 'academic', 'founder_new', 'founder_existing',
  'operator_advisor', 'service_provider', 'press_analyst',
];

test('each source parsed exactly 12 personas before anything is compared', () => {
  // A REGEX THAT MATCHES NOTHING AGREES WITH EVERYTHING. Assert the shape of
  // the evidence before trusting the verdict — the lesson D102 states for
  // the deck-category sibling of this test.
  for (const [name, path, read] of SOURCES) {
    const table = read();
    assert.equal(table.size, 12,
      `${name} (${path}): parsed ${table.size} personas, expected 12. Either a persona was `
      + 'added or removed — in which case update this file and all three sources together — '
      + 'or the table\'s shape changed and the reader above stopped seeing it.');
    assert.deepEqual([...table.keys()].sort(), [...CANONICAL_IDS].sort(),
      `${name}: parsed a different 12 ids than the canonical set`);
  }
});

test('worker, frontend and dev mirror agree on label, role_alignment and question keys', () => {
  const [worker, frontend, dev] = SOURCES.map(([, , read]) => read());
  const disagreements = [];
  for (const id of CANONICAL_IDS) {
    const w = worker.get(id);
    for (const [name, table] of [['frontend', frontend], ['dev mirror', dev]]) {
      const t = table.get(id);
      if (t.label !== w.label) {
        disagreements.push(`${id}: worker label "${w.label}", ${name} "${t.label}"`);
      }
      if (t.role !== w.role) {
        disagreements.push(`${id}: worker role_alignment "${w.role}", ${name} "${t.role}"`);
      }
      if (JSON.stringify(t.keys) !== JSON.stringify(w.keys)) {
        disagreements.push(`${id}: worker question keys [${w.keys}], ${name} [${t.keys}]`);
      }
    }
  }
  assert.deepEqual(disagreements, [], 'a persona cannot describe two different things:\n  '
    + disagreements.join('\n  '));
});

test('worker and frontend agree on nav_extras — the frontend is what the sidebar draws', () => {
  // D254's actual bug: founder_existing and operator_advisor disagreed here.
  // The dev mirror is excluded on purpose — it declares no `nav_extras` field
  // at all (confirmed below), so there is nothing to compare it against.
  const [worker, frontend] = [workerTable(), frontendTable()];
  // An absent `nav_extras` (the field is optional in the worker's type) and
  // an explicit `nav_extras: []` (the frontend always writes the field) mean
  // the same thing — no extra nav links — so both normalise to `[]` here.
  const disagreements = [];
  for (const id of CANONICAL_IDS) {
    const w = worker.get(id).nav ?? [];
    const f = frontend.get(id).nav ?? [];
    if (JSON.stringify(w) !== JSON.stringify(f)) {
      disagreements.push(`${id}: worker nav targets [${w}], frontend [${f}]`);
    }
  }
  assert.deepEqual(disagreements, [],
    'a persona\'s nav_extras must match, or the sidebar renders one set of links while the '
    + 'worker\'s own taxonomy endpoint (GET /api/personas/taxonomy) serves another:\n  '
    + disagreements.join('\n  '));
});

test('the dev mirror declares no nav_extras field — its absence is not a disagreement', () => {
  const dev = stripComments(raw(DEV_MIRROR));
  assert.doesNotMatch(dev, /"nav_extras"/,
    'the dev mirror now has a nav_extras field — extend devMirrorTable() to parse it and '
    + 'compare it against the worker/frontend pair above, rather than leaving it unchecked');
});

test('IntroductionsPanel\'s PERSONA_LABEL covers exactly the 12 canonical ids', () => {
  const src = stripComments(raw(INTRODUCTIONS));
  const body = src.slice(src.indexOf('const PERSONA_LABEL'), src.indexOf('function entityLabel'));
  const ids = [...body.matchAll(/([a-z0-9_]+):\s*'[^']*'/g)].map((m) => m[1]);
  assert.equal(ids.length, 12, `expected 12 keys in PERSONA_LABEL, found ${ids.length}`);
  assert.deepEqual([...ids].sort(), [...CANONICAL_IDS].sort(),
    'PERSONA_LABEL\'s key set no longer matches the canonical 12 persona ids — a 13th '
    + 'persona (or a removed one) would otherwise render unlabelled instead of failing here');
});
