/**
 * The printable Program Brief must not quote numbers nobody maintains.
 *
 * /spinout-lab/brief is the artifact most likely to leave the product — it is
 * a print-to-PDF brochure, so a copy of it lands in an investor's inbox and
 * stays there. It carried four literals that no query produced:
 *
 *     "12 companies"                       ← track record
 *     "$2.4M"                              ← track record
 *     "Apply to Cohort 4"                  ← cohort number
 *     "Applications close August 1, 2026"  ← already in the past
 *
 * Meanwhile `HeroStatsPanel` on the sibling marketing page rendered the SAME
 * three stats, under the same labels, live from the public
 * `GET /spinout-lab/stats`. The brief was a hardcoded fork of a component that
 * was already correct — so the two surfaces could state different track
 * records on the same day, and the brief's was the one that got printed.
 *
 * Both read ONE source for the figures — `useSpinoutStats`, still, and the
 * brief's track-record block survived its D141 rebuild for exactly that reason.
 * The DATES parted company in D141: the brief now reads them from
 * `GET /api/spinout-lab/brief` while the hero still computes them with
 * `openCohortCopy`, and what keeps those two honest is no longer a shared call
 * but `spinout_brief_d141.test.mjs` asserting the worker's and the SPA's cohort
 * arithmetic equal on their output. These tests pin that the literals cannot
 * come back, that the brief computes no second cohort of its own, and that the
 * em-dash fallback (never a zero) is what a failed fetch prints.
 *
 * Run with:  node --test frontend/test/spinout_brief_live_data.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const BRIEF = read('../src/pages/SpinoutLabBriefPage.jsx');
const PAGE = read('../src/pages/SpinoutLabPage.jsx');
/**
 * The shared helpers moved OUT of the page.
 *
 * When the Lab intro was rebuilt, both surfaces of /spinout-lab — logged out
 * and signed-in-not-yet-applied — became one component under
 * `components/spinout/`. It could not import the cohort math back out of a
 * page without closing an import cycle (the page already imports the marketing
 * page, which now renders the component), so `useSpinoutStats`,
 * `companiesLabel`, `openCohortCopy` and the calendar moved down to lib/.
 *
 * The rule these tests exist for is unchanged and so are the assertions: ONE
 * source for the figures and ONE source for the dates, so the brief and the
 * hero can never quote different numbers for the same cohort. Only the file
 * they are asserted against moved.
 */
const LIB = read('../src/lib/spinoutLab.js');

/**
 * Comments quote the very literals these tests forbid — that is the point of
 * a comment recording what was wrong. The assertions are about what the page
 * RENDERS, so strip block and line comments (JSX `{/* … *​/}` included, since
 * those are block comments in braces) before matching. Without this the
 * explanation of the bug is itself indistinguishable from the bug.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block + JSX comments
  .replace(/^\s*\/\/.*$/gm, '');      // line comments

const BRIEF_CODE = code(BRIEF);

// ---------------------------------------------------------------------------
// The specific literals that were wrong.
// ---------------------------------------------------------------------------

test('the brief no longer hardcodes a track record', () => {
  assert.doesNotMatch(BRIEF_CODE, /12 companies/, 'companies-built must come from the stats endpoint');
  assert.doesNotMatch(BRIEF_CODE, /\$2\.4M/, 'capital-raised must come from the stats endpoint');
  assert.doesNotMatch(BRIEF_CODE, /const STATS = \[/, 'the frozen STATS table is gone');
});

test('the brief no longer hardcodes a cohort number or deadline', () => {
  assert.doesNotMatch(BRIEF_CODE, /Apply to Cohort \d/, 'cohort number must be resolved');
  assert.doesNotMatch(BRIEF_CODE, /August 1, 2026/, 'this deadline was already in the past');
  // Any month-day-year literal at all is the same bug wearing a different date.
  assert.doesNotMatch(
    BRIEF_CODE,
    /(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/,
    'a frozen calendar date reappeared in the brief',
  );
});

// ---------------------------------------------------------------------------
// What it reads instead.
// ---------------------------------------------------------------------------

test('the brief reads the shared stats hook', () => {
  assert.match(BRIEF, /useSpinoutStats/, 'stats come from the shared hook');
  assert.match(BRIEF, /const \{ companies, raised \} = useSpinoutStats\(\)/);
});

/**
 * ─── D141 RE-AIMED THESE TWO, AND THE RULE THEY GUARD IS UNCHANGED ──────────
 *
 * They used to assert the brief called `openCohortCopy()` and interpolated
 * `cohort.cohortNum` / `cohort.deadlineLabel`. The rebuilt brief reads its
 * cohort from `GET /api/spinout-lab/brief` instead — the platform answering,
 * which is the whole point of that route — so asserting the old CALL would now
 * pin a mechanism the page correctly no longer has.
 *
 * The rule survives and is enforced harder than before. "The brief and the hero
 * cannot quote different dates for the same cohort" used to rest on them
 * sharing one function; it now rests on `spinout_brief_d141.test.mjs` comparing
 * `resolveOpenCohort` (the hero's) against `resolveApplicationTarget` (the
 * route's) over 48 probes — two implementations in two languages, asserted
 * equal on their OUTPUT rather than on their spelling. That is a stronger
 * assertion, not a weaker one, and it is what makes reading the route safe.
 *
 * What stays here is the property that belongs to this page: it must not
 * compute the cohort a SECOND time, and an absent one must not become a wrong
 * date.
 */
test('the brief takes its cohort from the platform, and computes none of its own', () => {
  assert.match(BRIEF_CODE, /spinoutLab\.brief\(\)/,
    'the brief must read the route that answers the six live values');
  assert.match(BRIEF_CODE, /brief\?\.cohort\?\.name/,
    'the cohort name must come off the payload');
  // A literal scan, not a regex built from this array. `new RegExp` over data
  // is the shape CodeQL and Semgrep have flagged three times in this repo, and
  // `includes` is the stronger assertion here anyway — it cannot be widened by
  // a metacharacter in a name.
  for (const own of ['openCohortCopy(', 'resolveOpenCohort(', 'cohortNumFor(']) {
    assert.ok(!BRIEF_CODE.includes(own),
      `the brief computes the cohort itself with ${own}) as well as reading it — two sources for one date is what this file exists to prevent`);
  }
});

test('an unresolvable cohort degrades to a stated reason, not a wrong date', () => {
  // The route reports `applications_open: false` between a close and the next
  // month's opening, and a failed read reports nothing at all. Those are two
  // different facts and the brief says which — but neither may become a date.
  assert.match(BRIEF_CODE, /No cohort is open for applications/,
    'a closed window must say so rather than naming the wrong cohort');
  assert.match(BRIEF_CODE, /The platform did not answer/,
    'a failed read must say so rather than printing a stale value');
  assert.match(BRIEF_CODE, /<Unrecorded reason=\{reason\}>/,
    'the live fields must render the shared honest-absence component, never a bare fallback');
});

// ---------------------------------------------------------------------------
// A failed fetch prints an em-dash, never a zero.
//
// "0 companies built" on a forwarded brochure is materially worse than an
// obvious placeholder — it reads as a track record rather than as a gap.
// ---------------------------------------------------------------------------

test('a failed stats fetch renders an em-dash on the brief', () => {
  assert.match(BRIEF, /raised === null \? "—" : raised/);
  assert.match(BRIEF, /companiesLabel\(companies\)/);
});

test('companiesLabel returns an em-dash for null and is singular-correct', () => {
  const src = LIB.slice(LIB.indexOf('export function companiesLabel'));
  const body = src.slice(0, src.indexOf('\n}\n') + 3).replace(/^export /, '');
  // eslint-disable-next-line no-new-func
  const companiesLabel = new Function(`${body}; return companiesLabel;`)();
  assert.equal(companiesLabel(null), '—');
  assert.equal(companiesLabel(0), '0 companies');
  assert.equal(companiesLabel(1), '1 company', 'a brief reading "1 companies" looks broken');
  assert.equal(companiesLabel(12), '12 companies');
});

// ---------------------------------------------------------------------------
// The two surfaces share one source, so they cannot disagree.
// ---------------------------------------------------------------------------

test('the hero panel and the brief use the same hook and label helper', () => {
  assert.match(LIB, /export function useSpinoutStats/);
  assert.match(LIB, /export function companiesLabel/);
  assert.match(LIB, /export function openCohortCopy/);
  // And the page must not have grown its own copy on the way past.
  assert.doesNotMatch(PAGE, /function useSpinoutStats/);
  assert.doesNotMatch(PAGE, /function companiesLabel/);
  assert.doesNotMatch(PAGE, /function openCohortCopy/);
  // The hero must consume them rather than keeping its own inlined copy.
  assert.match(PAGE, /const \{ companies, raised \} = useSpinoutStats\(\)/);
  assert.doesNotMatch(
    PAGE,
    /companies === 1 \? 'company' : 'companies'\s*\}`\s*\}\s*<\/div>/,
    'the hero re-inlined the pluralisation instead of using companiesLabel',
  );
});

test('the apply CTA resolves its deadline through the shared helper', () => {
  assert.match(PAGE, /const cohort = useMemo\(\(\) => openCohortCopy\(\), \[\]\)/);
  assert.match(PAGE, /Applications close \$\{cohort\.deadlineLabel\}/);
});

test('the cohort deadline is formatted in Delaware time', () => {
  // The cohort calendar is defined in America/New_York; formatting in the
  // viewer's zone would show the wrong day either side of midnight ET.
  //
  // openCohortCopy now delegates every label to one formatter instead of
  // repeating the Intl options per field — there are four labels to render
  // since the hero gained Starts and Ends. So the zone is asserted where it is
  // actually applied, and separately that the copy helper has not gone around
  // it with a bare toLocaleDateString.
  const fmt = LIB.slice(LIB.indexOf('export function cohortDateLabel'));
  assert.match(fmt.slice(0, 700), /timeZone: COHORT_TZ/);
  const fn = LIB.slice(LIB.indexOf('export function openCohortCopy'));
  assert.doesNotMatch(fn.slice(0, 700), /toLocaleDateString/,
    'openCohortCopy formatted a date itself instead of going through cohortDateLabel');
});

test('openCohortCopy swallows cohort-math failures rather than blanking the page', () => {
  const fn = LIB.slice(LIB.indexOf('export function openCohortCopy'));
  assert.match(fn.slice(0, 700), /catch \{\s*return null;/);
});
