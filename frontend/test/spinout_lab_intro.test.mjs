/**
 * The Spin-Out Lab introduction — the rules no framework enforces.
 *
 * This surface is drawn from a Claude Design canvas that is generous with
 * sample content: four named cohort companies, a feed of what they shipped
 * this week, three founder-to-founder questions, and a seat count. None of it
 * exists. `design/incoming/README.md` records why that matters — an audit
 * found whole surfaces that were canvas sample data shipped as fact, and every
 * one of them looked finished — so the first half of this file is simply the
 * list of things the canvas asked for that must never appear.
 *
 * THE SECOND HALF IS THE ONE THAT WOULD OTHERWISE HAVE NO GUARD AT ALL.
 * `scripts/check-dark-mode.mjs` pairs six bare utilities — `bg-white`,
 * `text-gray-900/800/700`, `border-gray-200/300`. It has no opinion about
 * `bg-[#faf9fc]`, `text-[#141118]`, or `style={{ background: '#e8e6ee' }}`,
 * which is exactly the shape a faithful port of a light-only canvas takes. So
 * a hex port passes `npm run test:drift` and fails on a reader's screen, in
 * silence. The theming assertions below are the actual evidence that this page
 * works in both themes; the guard script is not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const INTRO = read('../src/components/spinout/LabIntro.jsx');
const STYLES = read('../src/components/spinout/labIntroStyles.js');
const ARSENAL = read('../src/lib/spinoutLabArsenal.js');
const LIB = read('../src/lib/spinoutLab.js');
const MARKETING = read('../src/pages/SpinoutLabMarketingPage.jsx');
const PAGE = read('../src/pages/SpinoutLabPage.jsx');
const APP = read('../src/App.jsx');
const COHORT_APPS = read('../../cloudflare-worker/src/services/cohortApplications.ts');

const INTRO_CODE = codeOnly(INTRO);
const STYLES_CODE = codeOnly(STYLES);

// ---------------------------------------------------------------------------
// One design, two surfaces.
// ---------------------------------------------------------------------------

test('both surfaces render the same component, not two copies of it', () => {
  // The whole reason this component exists. Before it, the header, hero,
  // pipeline and deliverables were hand-maintained twice and had drifted —
  // different hover states, different connector colours.
  assert.match(MARKETING, /from '\.\.\/components\/spinout\/LabIntro'/);
  assert.match(PAGE, /from "\.\.\/components\/spinout\/LabIntro"/);
  assert.match(codeOnly(MARKETING), /<LabIntro\s/);
  assert.match(codeOnly(PAGE), /<LabIntro\s/);
});

test('the public page no longer draws a completed gate for a cohort it has no place in', () => {
  // PHASE_STATUS = ['done', 'active', 'future', 'future'] drew gate 1 with a
  // tick and gate 2 with a live pulsing dot, on a logged-out page, for a
  // cohort the visitor is not in — its own comment conceded "the logged-out
  // page has no cohort". Same class of defect as the sample companies below,
  // and it was already shipped.
  // Asserted against code, not source: the marketing page's docblock QUOTES
  // the deleted line, which is the point of a comment recording what was
  // wrong. Without stripping comments the explanation of the bug is
  // indistinguishable from the bug (frontend/test/README.md says this).
  assert.doesNotMatch(codeOnly(MARKETING), /PHASE_STATUS/);
  assert.doesNotMatch(INTRO_CODE, /PHASE_STATUS/);
});

// ---------------------------------------------------------------------------
// What the canvas drew that has no store behind it.
// ---------------------------------------------------------------------------

test('not one of the canvas’s sample companies ships', () => {
  // Checked across every file this integration touched, not just the
  // component: a fixture that migrates into the data module is still a
  // fixture. Matched against raw source INCLUDING comments — unlike the
  // rules below, a sample company name has no legitimate reason to appear
  // anywhere, and the file header naming them as excluded is in this test's
  // own excluded set by being asserted here rather than there.
  for (const name of ['Halyard', 'Verity Health', 'LoopSense', 'Kelp Bio']) {
    for (const [label, src] of [['LabIntro', INTRO_CODE], ['arsenal', codeOnly(ARSENAL)],
      ['spinoutLab', codeOnly(LIB)], ['marketing page', codeOnly(MARKETING)]]) {
      assert.ok(!src.includes(name), `${label} renders the canvas fixture "${name}"`);
    }
  }
});

test('no seat count is drawn, because nothing stores one', () => {
  // The canvas's "8 spots available" has no column behind it. Neither has any
  // other number of places. (SpinoutLabBriefPage still carries an "8 spots"
  // fallback string and SpinoutLabPage a "capped at 8 companies" refusal —
  // both pre-existing, both pinned by their own tests, neither touched here.)
  assert.doesNotMatch(INTRO_CODE, /\bspots?\s+(available|left|remaining)\b/i);
  assert.doesNotMatch(INTRO_CODE, /\b\d+\s+(seats?|spots?|places)\b/i);
});

test('founder-to-founder asks are stated as absent, never drawn', () => {
  // The canvas draws three sample questions. No table holds a founder-to-
  // founder request, and /cohort deliberately returns no founder identity, so
  // there is nobody to address one to. The panel has to say that.
  assert.match(INTRO, /Founder-to-founder asks/);
  assert.match(INTRO, /does not exist yet/);
  // And it must not have grown a list to render.
  assert.doesNotMatch(INTRO_CODE, /const ASKS\b|asks\s*=\s*\[/);
});

test('every cohort figure comes from a read, and a failed read says so', () => {
  // "Nobody is in the cohort" and "we could not find out" are different
  // sentences. Collapsing them renders the second as the first.
  assert.match(INTRO, /because we do not know/);
  // A count is only drawn when a read actually succeeded.
  assert.match(INTRO_CODE, /!directory\?\.loading && !directory\?\.error &&/);
  // The absent-is-not-zero rule, in the shape _zoneGuards bans elsewhere.
  assert.doesNotMatch(INTRO_CODE, /\|\|\s*0\b/);
  assert.doesNotMatch(INTRO_CODE, /\?\?\s*0\b/);
});

test('an uncomputable cohort date reads as Not recorded, not as a blank', () => {
  assert.match(INTRO, /Not recorded/);
  // openCohortCopy returns null when the calendar throws; the hero must
  // render that as an absence rather than an empty cell that looks like a
  // date nobody has typed yet.
  assert.match(INTRO_CODE, /value \?\? 'Not recorded'/);
});

// ---------------------------------------------------------------------------
// The gates, and the promise the tracks are allowed to make.
// ---------------------------------------------------------------------------

test('the four gates render from PIPELINE_PHASES, not from a per-track list', () => {
  // The canvas gives each track its own four gates. The product enforces ONE
  // gate set — MILESTONES in the worker's spinoutLabCatalog — identically for
  // everyone. Four invented gate sets would tell a founder that week 2 asks
  // something it does not ask.
  assert.match(INTRO_CODE, /PIPELINE_PHASES\.map/);
  assert.match(INTRO_CODE, /pipelineItemsFor\(phase, jurisdiction\)/);
  // The canvas's own gate names, which belong to no week this product runs.
  for (const invented of ['Structure', 'Discover', 'Interview', 'Size', 'Scope', 'Prove']) {
    assert.ok(!INTRO_CODE.includes(`'${invented}'`) && !INTRO_CODE.includes(`"${invented}"`),
      `a per-track gate name (${invented}) was reintroduced`);
  }
});

test('LabGates cannot vary by track, structurally', () => {
  // Not a convention someone has to remember: the component takes no track
  // prop at all, so there is nothing for a future edit to branch on.
  const sig = INTRO_CODE.slice(INTRO_CODE.indexOf('export function LabGates'));
  const params = sig.slice(sig.indexOf('('), sig.indexOf(')') + 1);
  assert.ok(!params.includes('track'), `LabGates took a track prop: ${params}`);
});

test('the page says the gates are the same for every track', () => {
  // The track re-orders which tools lead. Saying nothing would let a reader
  // infer the gates move too, which is the canvas's claim and is false.
  assert.match(INTRO, /the same for every track/);
});

test('the apply link carries no track, because nothing records one', () => {
  // spinout_applications has `incorporated` and a free-text `stage`, and no
  // track column. RegisterPage reads only `lane` and `product`, so a third
  // param would be dropped in silence — a choice that looks remembered and
  // is not.
  // Asserted against STRING LITERALS, not raw text: LabApplyBand tells the
  // reader on screen that the track is not carried, and the lib's docblock
  // says why. Naming the param in prose is the opposite of shipping it, and a
  // bare /track=/ over the source cannot tell the two apart — codeOnly leaves
  // indented JSX comments alone on purpose (see its header).
  const literals = (src) => [...src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  for (const [label, src] of [['LabIntro', INTRO_CODE], ['marketing page', codeOnly(MARKETING)],
    ['SpinoutLabPage', codeOnly(PAGE)], ['spinoutLab lib', codeOnly(LIB)]]) {
    for (const lit of literals(src)) {
      assert.ok(!/[?&]track=/.test(lit), `${label} carries a track param: ${lit}`);
    }
  }
  // And the two apply targets by name, so a rewrite cannot smuggle one in.
  assert.match(LIB, /LAB_APPLY_HREF = '\/register\?lane=founder&product=spinout-lab'/);
  assert.match(LIB, /LAB_APPLY_HREF_SIGNED_IN = '\/spinout-lab\/apply'/);
});

// ---------------------------------------------------------------------------
// The arsenal — the page's headline claim, and whether it is true.
// ---------------------------------------------------------------------------

test('there are exactly nineteen tools, in five groups of 5/3/3/5/3', () => {
  const ids = [...ARSENAL.matchAll(/\{ id: '([a-z0-9]+)', group: '(\w+)'/g)];
  assert.equal(ids.length, 19, 'the page claims nineteen working tools');
  const counts = {};
  for (const [, , group] of ids) counts[group] = (counts[group] || 0) + 1;
  assert.deepEqual(counts, { Company: 5, Evidence: 3, Build: 3, Formation: 5, Capital: 3 });
  // The claim on screen is computed from the list, never typed beside it.
  assert.match(ARSENAL, /export const TOOL_COUNT = LAB_TOOLS\.length/);
  assert.doesNotMatch(INTRO_CODE, /\bNineteen\b|\b19 (working )?tools\b/);
});

test('every tool names a route that exists in App.jsx', () => {
  // This is what makes "nineteen working tools" a checkable claim rather than
  // a marketing number: a renamed or deleted route fails the build here.
  const routes = [...ARSENAL.matchAll(/route: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(routes.length, 19);
  assert.equal(new Set(routes).size, 19, 'two tools claim the same route');
  for (const r of routes) {
    assert.ok(APP.includes(`path="${r}"`), `no route in App.jsx for ${r}`);
  }
});

test('no arsenal card is a link, because none of them would open', () => {
  // Every /spinout-lab/<tool> route is guard(labRoles(['admin'])), and
  // labRoles widens the allowed list only when spinout_lab_active === 1. This
  // surface IS the not-active branch, so every card would bounce off
  // RoleGuard. A link that always fails is worse than no link.
  const arsenal = INTRO_CODE.slice(
    INTRO_CODE.indexOf('export function LabArsenal'),
    INTRO_CODE.indexOf('export function LabJurisdictionCard'),
  );
  assert.ok(arsenal.length > 200, 'the arsenal section moved; this slice is stale');
  assert.doesNotMatch(arsenal, /<Link\b/, 'an arsenal card became a link');
  assert.doesNotMatch(arsenal, /\bt\.route\b/, 'the arsenal rendered a tool route');
  // And it says why, rather than leaving a reader clicking dead cards.
  assert.match(INTRO, /which\s+is why nothing above is a link/);
});

test('all seven jurisdictions are drawn, not the canvas’s four', () => {
  // Two are live and five are marked Soon. Drawing only the four the canvas
  // felt like drawing tells a founder the other three do not exist.
  assert.match(INTRO_CODE, /LAB_JURISDICTIONS\.map/);
  const keys = [...LIB.matchAll(/^\s*key: '(\w+)',/gm)].map((m) => m[1]);
  assert.equal(keys.length, 7);
  const soon = [...LIB.matchAll(/^\s*key: '(\w+)', label: '[^']*', soon: true/gm)];
  assert.equal(soon.length, 5, 'exactly two jurisdictions are live');
});

// ---------------------------------------------------------------------------
// Theming — the assertions check-dark-mode structurally cannot make.
// ---------------------------------------------------------------------------

test('no raw colour ships outside the one declared dark panel', () => {
  // A hex port of a light-only canvas passes every guard in the repo and
  // renders white-on-white in dark mode. LAB_PANEL_HEX is the single
  // exception, and it is legitimate: a panel that is dark in BOTH themes needs
  // no dark: counterpart by definition.
  const styleHex = STYLES_CODE.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(styleHex, ['#241f38'],
    'labIntroStyles grew a colour outside LAB_PANEL_HEX');
  assert.match(STYLES_CODE, /export const LAB_PANEL_HEX = '#241f38'/);

  // The component itself carries none at all — it composes the constants.
  assert.deepEqual(INTRO_CODE.match(/#[0-9a-fA-F]{3,8}\b/g) || [], [],
    'LabIntro hardcoded a colour instead of composing labIntroStyles');
  for (const arb of [/\bbg-\[#/, /\btext-\[#/, /\bborder-\[#/, /\bfrom-\[#/, /\bto-\[#/]) {
    assert.doesNotMatch(INTRO_CODE, arb, 'an arbitrary-value colour class appeared');
    assert.doesNotMatch(STYLES_CODE, arb, 'an arbitrary-value colour class appeared');
  }
});

test('every light colour token in the style module states its dark counterpart', () => {
  // No axal-* token has a dark variant — bg-axal-ground is #f4f3f7 in both
  // themes — so each pair has to name the dark utility itself, in the same
  // string, which is also the shape check-dark-mode understands.
  const decls = [...STYLES_CODE.matchAll(/export const (LAB_\w+)\s*=\s*([\s\S]*?);\n/g)];
  assert.ok(decls.length >= 15, 'the style module shrank unexpectedly');

  // Two kinds of colour live here and only one of them is theme-dependent.
  //
  //   A SURFACE OR AN INK — white, a gray, axal-ground, axal-hairline,
  //   axal-ink, axal-muted, a violet tint. These ARE the theme: leave one
  //   unpaired and the page renders light ink on a dark ground.
  //
  //   A FILLED BRAND ACCENT — bg-axal-violet-deep with white on it. Violet is
  //   violet in both themes; giving it a dark: variant would make the brand
  //   colour change with the OS setting, which is a bug, not a fix.
  //
  // ...and anything drawn ON the dark panel, which is dark in both themes by
  // construction and is named as such.
  const themeDependent =
    /\b(bg-white|bg-gray-\d|text-gray-\d|border-gray-\d|bg-axal-ground|bg-axal-lavender|text-axal-ink|text-axal-muted|border-axal-hairline|bg-violet-[12]?00|bg-amber-[12]?00)\b/;
  const onDarkPanel = /_ON_DARK$|_PANEL_HEX$|_ON_DARK_\w+$/;
  let checked = 0;
  for (const [, name, value] of decls) {
    if (onDarkPanel.test(name)) continue;
    if (!themeDependent.test(value)) continue;
    checked += 1;
    assert.match(value, /\bdark:/, `${name} sets a theme-dependent colour with no dark: counterpart`);
  }
  assert.ok(checked >= 6, `only ${checked} constants were actually checked — the matcher is not matching`);
});

test('colours reach the page as utilities, never as var() in a style attribute', () => {
  // Tailwind v4 tree-shakes any @theme token no utility references, so
  // var(--color-axal-violet) inside a style attribute resolves to nothing in
  // the built CSS while working perfectly in dev (index.css:41-46).
  assert.doesNotMatch(INTRO_CODE, /var\(--color-/);
  assert.doesNotMatch(STYLES_CODE, /var\(--color-/);
});

test('no undeclared axal token is adopted', () => {
  // axal-ink-2, axal-ink-3, axal-surface-2 and axal-border-soft are used ~400
  // times across pages/ and workspaces/ and are declared NOWHERE — they emit
  // no CSS and resolve to inherited colour. ui_design_tokens.test.mjs cannot
  // see them because it only walks ui/. Copying one onto this page would give
  // it a colour nobody chose.
  const declared = new Set(
    [...read('../src/index.css').matchAll(/--color-(axal-[\w-]+):/g)].map((m) => m[1]),
  );
  assert.ok(declared.has('axal-violet-deep') && declared.has('axal-muted'),
    'the @theme scrape found nothing — this test is not checking anything');
  for (const [, used] of [...`${INTRO_CODE}${STYLES_CODE}`.matchAll(/\b(?:bg|text|border)-(axal-[\w-]+)/g)]) {
    assert.ok(declared.has(used), `${used} is used but never declared in index.css @theme`);
  }
});

// ---------------------------------------------------------------------------
// The cohort calendar the hero quotes.
// ---------------------------------------------------------------------------

/**
 * The client's calendar is a hand-copy of the worker's, and nothing has ever
 * pinned the two together. The hero now quotes FOUR fields off it, including a
 * newly derived end date, so an unnoticed drift would put a wrong deadline on
 * the public page and a right one in the API that rejects it.
 *
 * Extracted by evaluating the real source, like spinout_application_status
 * does, because lib/spinoutLab.js imports React and this runner has no loader.
 */
const cal = (() => {
  const pick = (name, kind = 'function') => {
    const i = LIB.indexOf(`${kind} ${name}(`);
    assert.notEqual(i, -1, `${name} is gone from lib/spinoutLab.js`);
    const src = LIB.slice(i);
    return src.slice(0, src.indexOf('\n}\n') + 3);
  };
  const body = [
    "const COHORT_TZ = 'America/New_York';",
    'const COHORT_BASE = { year: 2026, month: 5, num: 1 };',
    LIB.slice(LIB.indexOf('export const COHORT_WEEKS')).split('\n')[0].replace(/^export /, ''),
    pick('_wallToUtcMs'),
    pick('cohortNumFor', 'export function').replace(/^export /, ''),
    pick('resolveOpenCohort', 'export function').replace(/^export /, ''),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return { resolveOpenCohort, cohortNumFor };`)();
})();

/** The calendar day, in Delaware time, as a comparable YYYY-MM-DD. */
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ms));

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

test('applications close exactly seven days before the cohort starts', () => {
  // Spanning a DST boundary in both directions — March and November — because
  // a fixed-offset implementation passes every other month and fails these.
  for (const iso of ['2026-01-15', '2026-03-01', '2026-03-20', '2026-06-10',
    '2026-11-02', '2026-12-28']) {
    const w = cal.resolveOpenCohort(Date.parse(`${iso}T12:00:00Z`));
    assert.equal(dayDiff(etDay(w.closeMs), etDay(w.startMs)), 7,
      `close is not 7 days before start for a visitor on ${iso}`);
    assert.ok(w.closeMs > Date.parse(`${iso}T12:00:00Z`),
      `resolveOpenCohort returned a window that already closed, for ${iso}`);
  }
});

test('the cohort runs 28 days, and the end date is derived rather than typed', () => {
  for (const iso of ['2026-01-15', '2026-03-01', '2026-06-10', '2026-11-02']) {
    const w = cal.resolveOpenCohort(Date.parse(`${iso}T12:00:00Z`));
    assert.equal(dayDiff(etDay(w.startMs), etDay(w.endMs)), 28,
      `the sprint is not 28 days for a visitor on ${iso}`);
  }
  // Derived from COHORT_WEEKS, not a literal 29 someone has to keep in step
  // with the worker's week windows.
  assert.match(LIB, /1 \+ COHORT_WEEKS \* 7/);
});

test('the client window matches the rule the worker enforces', () => {
  // cohortApplications.ts is the authority: it is what rejects a late
  // application. Both sides must use day -6 at 23:59:59 in the same zone.
  assert.match(COHORT_APPS, /wallClockToUtcMs\(year, month, -6, 23, 59, 59, tz\)/);
  assert.match(LIB, /_wallToUtcMs\(year, month, -6, 23, 59, 59\)/);
  assert.match(COHORT_APPS, /America\/New_York/);
  assert.match(LIB, /America\/New_York/);
});

test('May 2026 is Cohort 1, and the sequence is arithmetic', () => {
  assert.equal(cal.cohortNumFor(2026, 5), 1);
  assert.equal(cal.cohortNumFor(2026, 8), 4); // the anchor the old copy cited
  assert.equal(cal.cohortNumFor(2027, 5), 13);
});
