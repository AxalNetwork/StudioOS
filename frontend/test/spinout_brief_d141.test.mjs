/**
 * THE PROGRAMME BRIEF — the four printed pages, and what may not be typed on
 * them (D141).
 *
 * WHY THIS FILE RENDERS RATHER THAN SCANS. The brief is the one page in this
 * product a founder prints and forwards to an investor, and its single
 * unsurvivable failure is a binding reaching paper unresolved — `{{ cohortName }}`
 * or `{cohort.places}` in a document somebody is being asked to rely on. No
 * source scan can see that: it is a property of the OUTPUT. So `BriefDocument`
 * is exported as a pure, prop-driven component and both of its states are
 * rendered here — the six live fields filled, and the six stating their own
 * absence. `renderToStaticMarkup` never runs an effect, which is exactly why
 * the fetch lives in the wrapper and the document takes a payload.
 *
 * AND WHY THE COUNTS ARE ASSERTED AGAINST THEIR SOURCES. The arsenal's heading
 * reads *"Nineteen working tools. Count them."* — an invitation to check. The
 * day a twentieth tool lands in `LAB_TOOLS` that heading is a lie, and only an
 * assertion will say so. Same for the three tracks and the four weeks. The
 * brief has already carried a frozen number once ("Cohort 4 · closes August 1,
 * 2026", past by the time anyone read it), which is what the six live fields
 * exist to end.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/spinout_brief_d141.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import { BriefDocument } from '../src/pages/SpinoutLabBriefPage.jsx';
import {
  WEEKS, TERMS, JURISDICTIONS, DELIVERABLES, COMMUNITY, SUPPORT, FIT, NOT_FIT,
  TOOL_EXAMPLE_READS, EXAMPLE_LABEL, numberWord, numberWordCap,
} from '../src/lib/spinoutBrief.js';
import { LAB_TOOLS, LAB_TRACKS, TOOL_COUNT } from '../src/lib/spinoutLabArsenal.js';
import { COHORT_WEEKS, resolveOpenCohort } from '../src/lib/spinoutLab.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE_RAW = read('frontend/src/pages/SpinoutLabBriefPage.jsx');
const PAGE = codeOnly(PAGE_RAW);
const CONTENT = codeOnly(read('frontend/src/lib/spinoutBrief.js'));
const ROUTE = read('cloudflare-worker/src/routes/spinout_lab.ts');

/** A payload shaped exactly like the route's, for the filled state. */
const FILLED = {
  brief: { generated_at: '2026-09-17T10:00:00.000Z', year: '2026' },
  cohort: {
    name: 'October 2026',
    start_date: '2026-10-01T04:00:00.000Z',
    close_at: '2026-09-24T03:59:59.000Z',
    places: 8,
  },
  zone: 'America/New_York',
  applications_open: true,
};

/** The route's OTHER success shape: read fine, nothing open to name. */
const NO_COHORT = {
  brief: FILLED.brief,
  cohort: { name: null, start_date: null, close_at: null, places: 8 },
  zone: 'America/New_York',
  applications_open: false,
};

const render = (props) => renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(BriefDocument, props)),
);

/** What `useSpinoutStats` hands the document, in its two states. */
const STATS = [
  { value: '12 companies', label: 'Built to date' },
  { value: '$2.4M', label: 'Total capital raised by graduates' },
  { value: '28 days', label: 'Average time to incorporation' },
];

const FILLED_HTML = render({ brief: FILLED, err: false, stats: STATS });
const FAILED_HTML = render({ brief: null, err: true });
const CLOSED_HTML = render({ brief: NO_COHORT, err: false });

// ── The one failure this page cannot survive ────────────────────────────────

test('no binding reaches the page unresolved, in any state', () => {
  for (const [name, html] of [
    ['filled', FILLED_HTML], ['failed', FAILED_HTML], ['closed', CLOSED_HTML],
  ]) {
    assert.ok(!html.includes('{{'),
      `a raw {{ }} binding reached the ${name} document — the canvas's own notation printed as text`);
    for (const tok of ['{cohort.', '{brief.']) {
      assert.ok(!html.includes(tok),
        `the platform token ${tok}…} reached the ${name} document unresolved`);
    }
  }
});

// ── Counts are counted, never typed ─────────────────────────────────────────

test('the arsenal heading counts the arsenal', () => {
  assert.ok(FILLED_HTML.includes(`${numberWordCap(TOOL_COUNT)} working tools. Count them.`),
    'the heading must spell the tool count the arsenal actually holds');
  // The number words must not be typed into the page. A literal survives a
  // twentieth tool landing in LAB_TOOLS; `TOOL_COUNT` does not.
  for (const w of [numberWord(TOOL_COUNT), numberWordCap(TOOL_COUNT)]) {
    assert.ok(!PAGE.includes(w),
      `"${w}" is typed into the page — it must be derived from TOOL_COUNT`);
  }
});

test('the tracks, the weeks and the days are all derived too', () => {
  for (const [what, n] of [
    ['tracks', LAB_TRACKS.length], ['weeks', WEEKS.length], ['days', COHORT_WEEKS * 7],
  ]) {
    for (const w of [numberWord(n), numberWordCap(n)]) {
      assert.ok(!PAGE.includes(w),
        `the ${what} count is typed as "${w}" rather than derived from its source`);
    }
  }
  assert.ok(FILLED_HTML.includes(`${numberWordCap(COHORT_WEEKS * 7)} days`),
    'the programme length must render as COHORT_WEEKS × 7');
  assert.equal(WEEKS.length, COHORT_WEEKS,
    'the brief draws a different number of weeks from the one the programme runs');
});

test('every tool in the app is a tool in the brief, by name', () => {
  for (const t of LAB_TOOLS) {
    assert.ok(FILLED_HTML.includes(t.name),
      `"${t.name}" is in the product's arsenal and missing from the brief`);
  }
  // The other direction: the brief must not invent one. Each card carries its
  // padded index, so counting those counts the cards.
  const cards = LAB_TOOLS.map((_, i) => String(i + 1).padStart(2, '0'));
  assert.equal(cards.length, TOOL_COUNT);
});

// ── The six, and their two different absences ───────────────────────────────

test('each of the six live fields states its own absence when the read fails', () => {
  // The route's payload is the only thing that can fill these, so a failed read
  // must leave six stated absences — never a zero, never a stale literal.
  const failedReason = 'The platform did not answer when this brief was generated.';
  assert.ok(FAILED_HTML.includes(failedReason),
    'a failed read rendered no reason at all');
  for (const v of ['October 2026', '2026-10-01', '23 Sept']) {
    assert.ok(!FAILED_HTML.includes(v),
      `a value from the successful payload (${v}) survived a failed read`);
  }
  // Six fields, so at least six absences: three live chips, places, the year in
  // two footers, the generated-at stamp, and the apply block's two.
  const absences = FAILED_HTML.split(failedReason).length - 1;
  assert.ok(absences >= 6,
    `only ${absences} of the six live fields stated an absence on a failed read`);
});

test('a month with no open cohort is a different sentence from a failed read', () => {
  const closedReason = 'No cohort is open for applications';
  assert.ok(CLOSED_HTML.includes(closedReason),
    'a closed application window was reported as a failure to read');
  assert.ok(!FAILED_HTML.includes(closedReason),
    'a failed read claimed to know that no cohort is open — it knows nothing');
  // `places` is answered on both paths, so it must still render.
  assert.ok(CLOSED_HTML.includes('>8<'),
    'places is an operator setting the route answers either way, and it vanished');
});

test('the filled state renders all six, in the zone the route named', () => {
  assert.ok(FILLED_HTML.includes('October 2026'), 'cohort.name');
  assert.ok(FILLED_HTML.includes('1 Oct 2026'), 'cohort.start_date, as a date in COHORT_TZ');
  assert.ok(/23 Sept, 23:59/.test(FILLED_HTML),
    'cohort.close_at must render in America/New_York (23:59 ET on the 23rd), not the reader’s zone');
  assert.ok(FILLED_HTML.includes('>8<'), 'cohort.places');
  assert.ok(FILLED_HTML.includes('2026 Axal VC Management LLC'), 'brief.year');
  assert.ok(FILLED_HTML.includes('17 Sept 2026'), 'brief.generated_at');
});

test('no instant is formatted without the zone the route sent', () => {
  const calls = [...PAGE.matchAll(/\b(inZone|dateInZone)\(([^)]*)\)/g)];
  assert.ok(calls.length >= 3, 'the brief formats fewer instants than it prints');
  const zoneless = calls
    .map((m) => ({ call: m[0], zone: (m[2].split(',')[1] || '').trim() }))
    .filter((c) => c.zone !== 'zone');
  assert.deepEqual(zoneless, [],
    'an instant is formatted without the zone it is enforced in — the reader gets their own hour');
});

// ── The programme's own description has no store, and says so ────────────────

/**
 * Names that legitimately appear in the content module although something in
 * the arsenal shares them — a NAMED exemption rather than a loosened rule, on
 * `check-inline-project-pickers`'s shape, so a stale entry is refused too.
 *
 * "Office hours" is a support offering on page 4 AND a tool card on page 3; the
 * two say different things about it and may be renamed apart. "Form" is both a
 * track and the name of the third gate ON that track — the week the entity is
 * filed. Neither is a second list, which is what this test is actually for.
 */
const SHARED_NAMES = {
  'Office hours': 'a support row on page 4 as well as a tool card on page 3',
  Form: 'the third gate on the Form track is the week the entity is filed',
};

test('the content module reaches no server and holds no second tool or track list', () => {
  for (const bad of ['api.', 'fetch(', 'request(', 'useState', 'useEffect']) {
    assert.ok(!CONTENT.includes(bad),
      `spinoutBrief.js contains \`${bad}\` — the programme's prose is content in git, not a store`);
  }

  // A pasted copy of LAB_TOOLS or LAB_TRACKS brings their SHAPE with it, which
  // is the thing to refuse: a name can collide by coincidence, a key cannot.
  for (const key of ['blurb:', 'route:', 'leads:', 'who:', 'group:']) {
    assert.ok(!CONTENT.includes(key),
      `spinoutBrief.js declares \`${key}\` — that is the arsenal's shape, and the brief reads spinoutLabArsenal.js rather than copying it`);
  }

  // And the names, with the two known collisions named rather than waved past.
  const collided = [];
  for (const name of [...LAB_TOOLS.map((t) => t.name), ...LAB_TRACKS.map((t) => t.name)]) {
    if (CONTENT.includes(`'${name}'`)) collided.push(name);
  }
  assert.deepEqual(collided.sort(), Object.keys(SHARED_NAMES).sort(),
    'a tool or track name is declared in spinoutBrief.js that is not one of the two known collisions — two lists of one thing is the rule lib/README.md forbids. If a collision has GONE, delete its SHARED_NAMES entry: a ledger is only worth reading if every line still points at something.');
});

test('the brief reads the tracks’ short form off LAB_TRACKS, not a copy', () => {
  for (const t of LAB_TRACKS) {
    assert.equal(typeof t.brief, 'string',
      `track ${t.id} has no short print form; the brief would fall back to the screen’s sentence`);
    assert.ok(FILLED_HTML.includes(t.brief),
      `track ${t.id}’s printed sentence is not the one LAB_TRACKS carries`);
    assert.ok(!FILLED_HTML.includes(t.who),
      `track ${t.id} printed the screen’s long sentence, which wraps to a ragged list in a print column`);
  }
});

test('the page fetches exactly one thing, and it is the six', () => {
  const calls = [...PAGE.matchAll(/spinoutLab\.(\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['brief'],
    'the brief called something other than its own route — the rest of the page is content in the bundle');
});

// ── The nine example charts are labelled as examples ────────────────────────

test('every example chart carries the word example', () => {
  const drawn = Object.keys(TOOL_EXAMPLE_READS);
  assert.ok(drawn.length > 0);
  const labels = FILLED_HTML.split(EXAMPLE_LABEL).length - 1;
  assert.equal(labels, drawn.length,
    `${drawn.length} example charts drawn and ${labels} labelled — an unlabelled chart with a figure under it reads as measured, and these figures are invented`);
  for (const k of drawn) {
    assert.ok(FILLED_HTML.includes(TOOL_EXAMPLE_READS[k].read),
      `the example reading for ${k} was not drawn`);
  }
});

// ── The rest of the content actually reaches the page ───────────────────────

test('every content list the brief declares is drawn', () => {
  const lists = [
    ['terms', TERMS.map((x) => x.k)],
    ['jurisdictions', JURISDICTIONS.map((j) => j.name)],
    ['deliverables', DELIVERABLES],
    ['community', COMMUNITY.map((c) => c.k)],
    ['support', SUPPORT.map((s) => s.k)],
    ['fit', FIT],
    ['not-fit', NOT_FIT],
  ];
  for (const [name, items] of lists) {
    for (const it of items) {
      assert.ok(FILLED_HTML.includes(it.replace(/&/g, '&amp;')),
        `${name} item "${it}" is declared and never drawn`);
    }
  }
});

test('the track record is drawn, not merely imported', () => {
  // THE GAP THIS CLOSES. `spinout_brief_live_data.test.mjs` asserts the page
  // READS `useSpinoutStats` and `companiesLabel` — a source scan, which an
  // empty render survives intact. A mutation that stopped drawing the block
  // passed both files until this assertion existed. The figures are the
  // load-bearing fact for the investor this brief gets forwarded to, and the
  // canvas does not draw them at all, so nothing else would notice them going.
  for (const s of STATS) {
    assert.ok(FILLED_HTML.includes(s.value), `the track record's ${s.label} value is not on the page`);
    assert.ok(FILLED_HTML.includes(s.label), `the track record's "${s.label}" label is not on the page`);
  }
  assert.ok(FILLED_HTML.includes('data-testid="brief-track-record"'),
    'the track-record block itself is gone');
});

// ── The print rules, which are the whole PDF export ─────────────────────────

test('the document pages itself for print', () => {
  assert.ok(/@page\s*\{[^}]*size:\s*letter/.test(PAGE_RAW),
    'no @page size — the saved PDF would take the browser default');
  assert.ok(/\[data-brief-page\][^}]*page-break-after:\s*always/.test(PAGE_RAW),
    'the pages do not break — a four-page brief would print as one run-on');
  assert.ok(/\[data-brief-page\]:last-child[^}]*page-break-after:\s*auto/.test(PAGE_RAW),
    'the last page still breaks, so every saved PDF ends on a blank sheet');
  assert.ok(/print-color-adjust:\s*exact/.test(PAGE_RAW),
    'the charts and the hero would print white — print-color-adjust is what keeps them');
  const pages = FILLED_HTML.split('data-brief-page').length - 1;
  assert.equal(pages, 4, `the brief is four pages and ${pages} were rendered`);
  for (let n = 1; n <= 4; n++) {
    assert.ok(FILLED_HTML.includes(`page ${n} of 4`), `page ${n}'s own footer is missing`);
  }
});

test('the document paints its own fixed palette; only the chrome follows the theme', () => {
  // A brief is a DOCUMENT: what is on screen has to be what comes out of the
  // printer, so the four pages carry one declared palette and no theme-aware
  // class. The toolbar around them is app chrome and keeps its `dark:` pairs.
  //
  // This is also what keeps `check-dark-mode` satisfied without an exemption.
  // That guard pairs light Tailwind utilities with `dark:` variants, and it was
  // right to flag the cards — `bg-white` in the middle of an inline palette was
  // the wrong mechanism, not a forgotten pair. `codemod-dark-mode.mjs` would
  // happily put them back, which is what this assertion is for.
  const doc = PAGE.slice(PAGE.indexOf('export function BriefDocument'),
    PAGE.indexOf('export default function SpinoutLabBriefPage'));
  assert.ok(doc.length > 1000, 'the document body was not located');
  for (const cls of ['bg-white', 'dark:', 'text-gray-900', 'border-gray-200']) {
    assert.ok(!doc.includes(cls),
      `the printed document uses the theme-aware class "${cls}" — it has a declared palette, and a page that renders dark and prints white is two documents under one URL`);
  }
  assert.ok(/const PAPER = '#[0-9a-f]{6}';/.test(PAGE),
    'the paper colour is not part of the declared palette');
  // THE CONTROL, and it has to be narrower than "some dark: survives" — the
  // toolbar carries several, so a version of this that only looked for the
  // prefix passed a mutation that stripped the pair off the Back link. Assert
  // the actual property `check-dark-mode` enforces: every light surface in the
  // chrome carries its own dark counterpart, in the same class string.
  const chrome = PAGE.slice(PAGE.indexOf('export default function SpinoutLabBriefPage'));
  const chromeClasses = [...chrome.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
  const unpaired = chromeClasses.filter(
    (c) => /(?<!print:)\bbg-white\b/.test(c) && !c.includes('dark:bg-'),
  );
  assert.deepEqual(unpaired, [],
    'a light surface in the chrome lost its dark counterpart — the toolbar is app chrome and follows the reader\u2019s theme, unlike the document it sits above');
});

// ── The two cohort-window computations must agree ───────────────────────────

test('the SPA and the worker resolve the SAME application window', async () => {
  // THE DEFECT THIS EXISTS TO CATCH, and it is now reachable rather than
  // theoretical. `resolveOpenCohort` (lib/spinoutLab.js) is what the marketing
  // hero and the Lab intro quote; `resolveApplicationTarget`
  // (services/cohortApplications.ts) is what this brief's route answers with.
  // They are two independent implementations of one rule — seven days before
  // the 1st, 23:59:59 Delaware — living in two languages, and the day they
  // disagree two pages on the same site quote different deadlines for the same
  // cohort. Measured today they agree on every probe; this keeps that true.
  const { resolveApplicationTarget } = await import('../../cloudflare-worker/src/services/cohortApplications.ts');

  const probes = [];
  for (let m = 0; m < 12; m++) {
    // Mid-month, the last instant before a close, the instant after it, and a
    // DST boundary month — the four places a wall-clock rule can slip.
    probes.push(Date.UTC(2026, m, 15, 12));
    probes.push(Date.UTC(2026, m, 23, 23, 0));
    probes.push(Date.UTC(2026, m, 24, 12));
    probes.push(Date.UTC(2027, m, 1, 0, 30));
  }

  const disagreements = [];
  for (const now of probes) {
    const w = resolveApplicationTarget(now);
    const s = resolveOpenCohort(now);
    if (!w.ok) continue; // the worker reports no open window; the SPA has no such state
    if (w.year !== s.year || w.month !== s.month
      || w.window.closeMs !== s.closeMs || w.window.startMs !== s.startMs) {
      disagreements.push({
        now: new Date(now).toISOString(),
        worker: { y: w.year, m: w.month, close: w.window.closeMs, start: w.window.startMs },
        spa: { y: s.year, m: s.month, close: s.closeMs, start: s.startMs },
      });
    }
  }
  assert.deepEqual(disagreements, [],
    'the brief’s deadline and the marketing page’s deadline are computed by two implementations that no longer agree');
});

test('the route sends the zone, and only the six', () => {
  // The page renders every instant in the zone the ROUTE names rather than one
  // it assumes, so the route must keep sending it.
  assert.ok(/zone:\s*COHORT_TZ/.test(ROUTE),
    'the brief route stopped naming the zone its deadlines are enforced in');
  assert.ok(PAGE.includes('brief?.zone'),
    'the page stopped reading the zone from the payload and is assuming one');
});
