/**
 * The cadence vocabulary is written on both sides of the seam, and the two agree.
 *
 * WHY THIS IS A TEST AND NOT A SHARED MODULE. `frontend/` and `cloudflare-worker/`
 * do not import each other — the SPA ships to `docs/`, the worker to Workers — so
 * a kind list, a run state and a filter key all exist twice by construction. The
 * failure that follows is silent in the worst way: the worker coerces an
 * unrecognised `kind` to `'other'` (deliberately — see its docblock), so a fifth
 * kind added to the form would be STORED as `other`, disappear from the `Retros`
 * filter and drop out of the average retro length, with no error anywhere.
 *
 * So the four lists are compared value for value, and the worker's file is read as
 * TEXT rather than imported. Importing a `.ts` module from a frontend test would
 * pull the worker's whole dependency graph — `hono`, `auth`, `types` — into a suite
 * that has none of it. Reading the declarations is enough: they are `as const`
 * arrays and one object literal, all on one line each, and a declaration that stops
 * matching the shape this parses is itself a change worth failing on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';
import { RITUAL_KINDS, RITUAL_FREQUENCIES, WEEKDAYS, kindLabel, dayLabel, todayIso } from '../src/lib/cadence.js';
import { CADENCE_VIEWS } from '../src/pages/founder/FounderBuildCadence.jsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const WORKER = codeOnly(read('cloudflare-worker/src/routes/founder_cadence.ts'));

/**
 * Every `export const NAME = ['a', 'b'] as const;` in the worker route, by name.
 *
 * ONE LITERAL PATTERN, MATCHED ONCE — not a pattern built around the name asked
 * for. Semgrep flagged the previous shape under `detect-non-literal-regexp`
 * (alert 6091), and the reason that actually bites a source-scanning guard is the
 * one `_escapeRe.mjs` gives: a metacharacter in an interpolated name changes what
 * the pattern means silently, so the assertion still passes and now checks
 * something else. Reading every declaration once and looking the name up cannot
 * do that, and it costs nothing — the names are the map's keys either way.
 */
const SERVER_LISTS = new Map(
  [...WORKER.matchAll(/export const ([A-Z_]+) = \[([^\]]*)\]/g)]
    .map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])]),
);

/** `export const NAME = ['a', 'b'] as const;` → `['a','b']`. */
function serverList(name) {
  const list = SERVER_LISTS.get(name);
  assert.ok(list, `${name} is no longer a one-line array literal in founder_cadence.ts`);
  return list;
}

test('the four ritual kinds are the same four on both sides', () => {
  assert.deepEqual(RITUAL_KINDS.map(([v]) => v), serverList('RITUAL_KINDS'));
  // AND `other` IS AMONG THEM. It is the escape the worker coerces to, so a form
  // that does not offer it makes that coercion invisible to the person filling it
  // in: they pick "Investor sync", the row stores `other`, and nothing said so.
  assert.ok(RITUAL_KINDS.some(([v]) => v === 'other'));
});

test('the three frequencies are the same three on both sides', () => {
  assert.deepEqual(RITUAL_FREQUENCIES.map(([v]) => v), serverList('RITUAL_FREQUENCIES'));
});

test('the two run states are the two the form offers, and there is no third', () => {
  const states = serverList('RUN_STATES');
  assert.deepEqual(states, ['done', 'missed']);
  const DIALOGS = read('frontend/src/pages/founder/CadenceDialogs.jsx');
  for (const s of states) {
    assert.ok(DIALOGS.includes(`value="${s}"`), `the run form cannot file a ${s} run`);
  }
  // A run that has not happened yet is ABSENT, not `'pending'`. A third state
  // would land in the adherence denominator and quietly lower every percentage.
  assert.ok(!DIALOGS.includes('value="pending"'), 'the run form offers a third state');
});

test('the four filter keys are the same four on both sides, and mean the same thing', () => {
  const m = /export const CADENCE_VIEWS[^=]*= \{([\s\S]*?)\n\};/.exec(WORKER);
  assert.ok(m, 'CADENCE_VIEWS is no longer an object literal in founder_cadence.ts');
  const serverKeys = [...m[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]);
  assert.deepEqual(Object.keys(CADENCE_VIEWS), serverKeys);

  // And the MEANING, not just the spelling. The server records which kinds and
  // which state each view narrows on; the page's predicate has to agree, or the
  // CSV export a founder downloads holds different rows than the chip they pressed.
  const body = m[1];
  assert.match(body, /plans: \{ kinds: \['plan'\]/);
  assert.match(body, /retros: \{ kinds: \['retro'\]/);
  assert.match(body, /skipped: \{ kinds: null, state: 'missed' \}/);
  assert.match(body, /all: \{ kinds: null, state: null \}/);

  const plan = { ritual_kind: 'plan', state: 'done' };
  const retro = { ritual_kind: 'retro', state: 'done' };
  const missedRetro = { ritual_kind: 'retro', state: 'missed' };
  assert.deepEqual([plan, retro, missedRetro].filter(CADENCE_VIEWS.plans), [plan]);
  assert.deepEqual([plan, retro, missedRetro].filter(CADENCE_VIEWS.retros), [retro, missedRetro]);
  assert.deepEqual([plan, retro, missedRetro].filter(CADENCE_VIEWS.skipped), [missedRetro]);
  assert.equal([plan, retro, missedRetro].filter(CADENCE_VIEWS.all).length, 3);
  // THE OVERLAP IS ASSERTED, NOT TOLERATED. A missed retro is under BOTH `retros`
  // and `skipped` because the canvas's row mixes kind and state, so the counts do
  // not sum to the total — and a reader who expects them to will conclude the
  // numbers are broken. Written down here so the next change to the row is made
  // knowing it.
  assert.ok(CADENCE_VIEWS.retros(missedRetro) && CADENCE_VIEWS.skipped(missedRetro));
});

test('the weekday index the form sends is the index the column stores', () => {
  // 0 = Sunday, matching `getUTCDay` and the migration's own comment. Off by one
  // here files every Friday retro on a Saturday, and nothing would ever error.
  assert.equal(WEEKDAYS.length, 7);
  assert.equal(WEEKDAYS[0], 'Sunday');
  assert.equal(WEEKDAYS[5], 'Friday');
  const MIGRATION = read('cloudflare-worker/sql/migrations/250_project_cadence.sql');
  assert.match(MIGRATION, /0 = Sunday/, 'the migration stopped recording which end 0 is');
  assert.match(MIGRATION, /getUTCDay/, 'the migration stopped naming the function it matches');
});

test('a date is formatted from its parts, never through a timezone', () => {
  // `Date.parse('2026-08-21')` is UTC midnight, rendered in the reader's zone —
  // so west of Greenwich `toLocaleDateString` on it says Aug 20. Every date in the
  // archive would be one day early for a founder in California, which is the
  // trap `interview_date` already carries a note about.
  assert.equal(dayLabel('2026-08-21'), 'Aug 21');
  assert.equal(dayLabel('2026-01-01'), 'Jan 1');
  assert.equal(dayLabel('2026-12-31'), 'Dec 31');
  // A malformed or absent date reads as absent, not as today and not as Jan 1.
  assert.equal(dayLabel(''), '—');
  assert.equal(dayLabel(null), '—');
  assert.equal(dayLabel('21 Aug 2026'), '—');
  assert.equal(dayLabel('2026-13-01'), '—', 'a thirteenth month rendered as a month');
  // `codeOnly` — the docblock above `dayLabel` NAMES `Date.parse` to explain why it
  // is not used, which is the comment worth keeping and the third time in this
  // change that a ban tripped over its own explanation.
  const SRC = codeOnly(read('frontend/src/lib/cadence.js'));
  assert.ok(!/Date\.parse/.test(SRC), 'the date label went through Date.parse again');
  assert.ok(!/toLocaleDateString/.test(SRC), 'a stored day is being rendered through a locale');
});

test('today is taken from local parts, not from toISOString', () => {
  // `new Date().toISOString().slice(0,10)` is the UTC day. Late evening in New
  // York it is already tomorrow in UTC, so the date prefilled on "file a review"
  // would be a day the founder has not lived through — and the unique index would
  // then refuse their real entry the next morning as a duplicate.
  assert.equal(todayIso(new Date(2026, 7, 21, 23, 30)), '2026-08-21');
  assert.equal(todayIso(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
  assert.equal(todayIso(new Date(2026, 11, 31, 22, 0)), '2026-12-31');
  const SRC = codeOnly(read('frontend/src/lib/cadence.js'));
  assert.ok(!SRC.includes('toISOString'), 'todayIso went back through UTC');
});

test('an unknown kind reads as itself rather than as nothing', () => {
  assert.equal(kindLabel('retro'), 'Retro');
  assert.equal(kindLabel('other'), 'Other');
  // A row stored before a kind was renamed still has to draw. Blank here would
  // make the archive's second column empty and the row unreadable.
  assert.equal(kindLabel('sync'), 'sync');
  assert.equal(kindLabel(''), 'Other');
  assert.equal(kindLabel(null), 'Other');
});
