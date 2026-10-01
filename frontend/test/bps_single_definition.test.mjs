/**
 * One definition of basis points → percent (D149).
 *
 * WHAT WENT WRONG. `frontend/src/lib/README.md` states the rule: *"If a helper
 * appears in two places, put it here once rather than a third time."* The task
 * filed **three** copies; measured with a scan aimed at the arithmetic rather
 * than at one body, there were **six**, and three of them had drifted into a
 * different format. The three that shared a body —
 *
 *   `pages/admin/AdminLicences.jsx`      as `pct`,    absent → null
 *   `pages/subsidiary/MyLicencePage.jsx` as `fmtBps`, absent → 'Not recorded'
 *   `pages/NeedsBoardPage.jsx`           inline, on a tax rate
 *
 * — and HQ's Revenue page was about to be a fourth when H10's `× N% owed` rate
 * landed. The three the filed count missed had each written their own format:
 *
 *   `pages/CompanySettingsPage.jsx`  a carry toast, `toFixed(2)` and NO trim
 *   `pages/IntroductionsPanel.jsx`   `feePct`, `toFixed(bps % 100 ? 2 : 0)`
 *   `pages/NetworkEffectsPage.jsx`   a multiplier, `toFixed(0)` — which rounds
 *
 * So the same 3550 bps rendered "35.5%" on three surfaces and "35.50%" on a
 * fourth, and a hypothetical 150 would have read "2%" on the fifth.
 * `AdminLicences.jsx`'s own comment claimed it was *"the only place a fraction
 * is ever computed"*, which was already false when it was written and was
 * wrong by five: the same class of stale claim D129 and D131 each deleted.
 *
 * AND THE MOVE IS ALSO A CORRECTION, which is why this file asserts behaviour
 * and not only structure. **None of the six guarded the empty string.**
 * `Number('')` is 0, `Number('   ')` is 0 and `Number([])` is 0 — all finite —
 * so a `Number.isFinite` test alone lets a missing value through and renders it
 * **"0%"**, which on a revenue share says the branch owes nothing. `bps == null`
 * does not catch any of the three. That is the one wrong number this function
 * can produce, and it is the trap D141 hit on a cycle's year.
 *
 * WHY "DEFINED ONCE" AND NOT A COUNT, per `absence_helpers_single_definition`'s
 * argument: a count passes the moment somebody deletes one copy and types
 * another. One definition is what actually stops a seventh being written.
 *
 * WHY THE FALLBACK SENTENCE STAYS AT THE CALL SITE. The sites disagreed about
 * what absence should read as, and every answer is somebody's copy — `null` so
 * a caller can render its own, the literal 'Not recorded' that `MyLicencePage`
 * chose to match the eight other absences around it, and `IntroductionsPanel`'s
 * 'no rate recorded' beside its own 'no economics attached'. Folding any of
 * them into the helper would flatten a choice. That is D117's split, one layer
 * down: **a fallback is a human-written sentence; this does arithmetic.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bpsPercent } from '../src/lib/bps.js';

const SRC = resolve(process.cwd(), 'frontend/src');
const HOME = 'lib/bps.js';
const BPS = readFileSync(resolve(SRC, HOME), 'utf8');

/** Every source file under frontend/src, as `path relative to src` → contents. */
function sources() {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(full, rel); continue; }
      if (!/\.(js|jsx|ts|tsx)$/.test(rel)) continue;
      out.set(rel, readFileSync(full, 'utf8'));
    }
  };
  walk(SRC, '');
  return out;
}
const FILES = sources();

/** Files whose source matches `re`, excluding bps.js itself. */
const matching = (re) =>
  [...FILES].filter(([rel, src]) => rel !== HOME && re.test(src)).map(([rel]) => rel).sort();

/**
 * The bps→percent SHAPE: divide by 100, fix the decimals, print a `%`.
 *
 * AIMED, NOT PATTERN-MATCHED, and the first draft of it was wrong in both
 * directions — which is why the reasoning is here rather than in a commit
 * message. `/ 100).toFixed(2)` alone matched **thirteen** lines, and ten of
 * them were CENTS → CURRENCY: money shares the ×100 encoding by coincidence and
 * must never share the formatter, because money keeps its two decimals ($1.20,
 * never $1.2) and a rate trims them. That is D117's `money` trap — two
 * deliberate behaviours under one name — and merging them is the mistake this
 * guard would otherwise cause.
 *
 * It also has to miss `lib/quarterlyReportViewModel.js`, which uses the very
 * same trailing-zero trim on a **fraction**: `(management_fee) * 100`, a
 * different encoding reaching the same string. Multiplying is not dividing, so
 * requiring `/ 100` is what tells the two apart.
 *
 * The `%` is what makes the anchor mean something rather than spell something:
 * a per-cent sign after a divide-by-100 is a rate, and nothing else in this
 * tree is. Same lesson as D148's `rank` scan — a lexical scan cannot tell a
 * domain from a domain that shares its characters, so give it a second
 * character that only one domain writes.
 */
const BPS_SHAPE = /\/\s*100\s*\)\s*\.toFixed\([^)]*\)\s*(?:\.replace\([^)]*\))?\s*\}?\s*%/;

test('the bps→percent shape is written once in the tree, under any name', () => {
  // The arithmetic, not the identifier: the six copies were `pct`, `fmtBps`,
  // `feePct` and three inline expressions, so a name-keyed scan would have
  // found at most half of them — and the filed count, which was taken that
  // way, said three.
  assert.deepEqual(
    matching(BPS_SHAPE),
    [],
    'bps → percent belongs in lib/bps.js; import bpsPercent instead of writing it again',
  );
  // The trim is part of the FORMAT rather than a nicety, so a copy that kept
  // the divide and wrote its own trim is the same duplication one character
  // away — and it is how `feePct` came to disagree on fractional rates.
  assert.deepEqual(
    matching(/replace\(\/\\\.\?0\+\$\/, ''\)/).filter((f) => f !== 'lib/quarterlyReportViewModel.js'),
    [],
    'the trailing-zero trim is part of bpsPercent, not a per-page flourish',
  );
});

test('the shape scan is aimed at rates and not at money', () => {
  // A guard nobody can see the aim of gets widened by the next person who hits
  // it, so the aim is asserted rather than described. Money divides by the same
  // 100 and must stay out: `(cents / 100).toFixed(2)` beside a currency code is
  // a different function that happens to share an encoding.
  assert.ok(!BPS_SHAPE.test("`${(cents / 100).toFixed(2)} ${currency}`"), 'money must not match');
  assert.ok(!BPS_SHAPE.test('`$${(b.amount_cents / 100).toFixed(2)}`'), 'money must not match');
  // A fraction reaching a percent multiplies; only bps divides.
  assert.ok(!BPS_SHAPE.test("`${(fee * 100).toFixed(2).replace(/\\.?0+$/, '')}%`"), 'a fraction must not match');
  // And every one of the six real copies must still be caught, in the spelling
  // it actually had — otherwise this guard passes a tree it was written for.
  for (const copy of [
    "`${(Number(bps) / 100).toFixed(2).replace(/\\.?0+$/, '')}%`",  // pct / fmtBps / the tax rate
    '`Carry set to ${(next / 100).toFixed(2)}%`',                   // the carry toast
    '`${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`',                 // feePct
    '{(mult / 100).toFixed(0)}% commission multiplier',             // the multiplier
  ]) {
    assert.ok(BPS_SHAPE.test(copy), `the scan must catch ${copy}`);
  }
});

test('every page that shows a rate reads it from the one helper', () => {
  // Named rather than counted, because the point is which pages were converted.
  for (const rel of [
    'pages/admin/AdminLicences.jsx',
    'pages/subsidiary/MyLicencePage.jsx',
    'pages/NeedsBoardPage.jsx',
    'pages/hq/RevenuePage.jsx',
    'pages/CompanySettingsPage.jsx',
    'pages/IntroductionsPanel.jsx',
    'pages/NetworkEffectsPage.jsx',
  ]) {
    const src = FILES.get(rel);
    assert.ok(src, `${rel} must exist`);
    assert.match(
      src,
      /import \{ bpsPercent[^}]*\} from '\.{1,2}(\/\.\.)*\/lib\/bps'/,
      `${rel} must import bpsPercent rather than declaring its own`,
    );
  }
});

test('the helper does arithmetic and the fallback sentence stays at the call site', () => {
  // D117's split, asserted from BOTH ends so it is the agreement that is
  // pinned rather than one file's spelling: the literal lives on the page that
  // chose it, and cannot have been folded into the helper.
  assert.ok(
    !/Not recorded'/.test(BPS.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
    'bpsPercent must not return a sentence — absence is null and the caller words it',
  );
  assert.match(
    FILES.get('pages/subsidiary/MyLicencePage.jsx'),
    /bpsPercent\(bps\) \?\? 'Not recorded'/,
    "MyLicencePage keeps its own absent copy, which is what the helper's null is for",
  );
  assert.equal(bpsPercent(null), null);
  assert.equal(bpsPercent(undefined), null);
});

test('an absent rate is never rendered as 0%', () => {
  // THE CORRECTION, and the reason this is a behaviour test. `Number('')` is 0
  // and finite; so is `Number('   ')`. A formatter that only tested
  // `Number.isFinite` printed "0%" for a value nobody recorded — on a revenue
  // share, the statement that a branch owes nothing.
  for (const empty of ['', '   ', '\t', '\n']) {
    assert.equal(bpsPercent(empty), null, `${JSON.stringify(empty)} is absence, not zero`);
  }
  // A real zero still reads as a zero: 0% is a rate somebody set.
  assert.equal(bpsPercent(0), '0%');
  assert.equal(bpsPercent('0'), '0%');
  // And nothing numeric-looking survives that is not a number.
  for (const bad of ['x', 'NaN', {}, [], NaN, Infinity, -Infinity]) {
    assert.equal(bpsPercent(bad), null, `${JSON.stringify(bad)} must not format`);
  }
});

test('the format is the one all three call sites already rendered', () => {
  // Which is what makes the move a MOVE: no rendered string changes.
  assert.equal(bpsPercent(3500), '35%');
  assert.equal(bpsPercent(3550), '35.5%');
  assert.equal(bpsPercent(10000), '100%');
  assert.equal(bpsPercent(100), '1%');
  assert.equal(bpsPercent(1), '0.01%');
  // Strings off a JSON payload format the same as the integers D1 stores.
  assert.equal(bpsPercent('3500'), '35%');
});
