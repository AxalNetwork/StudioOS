/**
 * HQ · Licences (canvas H2 + H3) and Platform → Deployments — D110.
 *
 * WHAT THE THREE NEW SURFACES PROMISE, and what each would get wrong if it
 * were built the obvious way:
 *
 *   H2 COVERAGE. The grid's point is the WHITE SPACE. A grid assembled from
 *   the licences that exist can only ever show what is taken, and "which
 *   countries are still available" is the question the zone exists to answer —
 *   so it is built from the 27 member states and the ledger is joined onto it.
 *   A SUSPENDED LICENCE STILL HOLDS ITS TERRITORY; a grid that freed those
 *   cells would invite the double-issue the UNIQUE index exists to prevent.
 *
 *   H2 RENEWALS. `days` is derived from a date the caller passes, never
 *   stored, and an OVERDUE renewal is kept with a negative number rather than
 *   filtered out. Dropping it is how a lapsed licence goes unnoticed.
 *
 *   H3 DEPLOY. The credential is a STATE. `GITHUB_ACCESS_TOKEN` is task #192
 *   and is unset, so the normal rendering of this step today is its own
 *   reason with the button disabled — not a button that 409s.
 *
 * Every assertion below is checked in both directions: a page that rendered
 * nothing would pass a test that only looked for an absence.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_licences_h2h3.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EU_27, EU_CODES, coverageCells, renewalPipeline, sortCells } from '../src/lib/licenceCoverage.js';
import { DEPLOY_TIMELINE, deployProgress } from '../src/lib/deployTimeline.js';
import { codeOnly, codeOnlyJsx } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
const PLATFORM = codeOnly(read('frontend/src/pages/hq/PlatformPage.jsx'));
const API = read('frontend/src/lib/api.js');

const lic = (over = {}) => ({
  uid: 'lic_fr', licence_ref: 'AXL-001', brand_name: 'Axal VC France',
  status: 'active', territories: ['FR', 'BE', 'LU'], renews_on: '2027-01-31',
  annual_fee_cents: 9000000, currency: 'EUR', ...over,
});

/* ── H2 · coverage ─────────────────────────────────────────────────── */

test('the grid is the 27 member states, not the countries somebody holds', () => {
  assert.equal(EU_CODES.length, 27);
  // Post-Brexit, and no candidates or EEA: the three that get added by
  // accident, each named so the list cannot quietly grow.
  for (const absent of ['GB', 'CH', 'NO', 'UA', 'IS']) {
    assert.ok(!EU_27[absent], `${absent} is not an EU member state`);
  }
  for (const present of ['FR', 'DE', 'HR', 'CY', 'MT']) {
    assert.ok(EU_27[present], `${present} is`);
  }
  // A ledger holding one licence still draws 27 cells — the white space is
  // the zone's whole point.
  const { cells, free } = coverageCells([lic()]);
  assert.equal(cells.length, 27);
  assert.equal(free, 24);
});

test('a suspended licence still holds its territory, and a terminated one holds nothing', () => {
  const s = coverageCells([lic({ status: 'suspended' })]);
  const byCode = Object.fromEntries(s.cells.map((c) => [c.code, c]));
  assert.equal(byCode.FR.state, 'held_suspended');
  assert.equal(s.held_suspended, 3);
  assert.equal(s.free, 24, 'suspension must not free a single cell');
  assert.equal(byCode.FR.licence.licence_ref, 'AXL-001', 'the cell names its holder');

  // The other direction, and the one state that DOES free the cells.
  const t = coverageCells([lic({ status: 'terminated' })]);
  assert.equal(t.free, 27);
  assert.equal(t.cells.find((c) => c.code === 'FR').state, 'free');
  assert.equal(t.cells.find((c) => c.code === 'FR').licence, null);

  // And an active one, so a grid that painted everything taken would fail.
  const a = coverageCells([lic()]);
  assert.equal(a.held_active, 3);
  assert.equal(a.held_suspended, 0);
});

test('a country outside the EU is reported, not silently dropped', () => {
  // A grid titled "EU coverage" that swallowed a Swiss territory would make
  // the ledger look smaller than it is.
  const r = coverageCells([lic({ territories: ['FR', 'CH', 'gb'] })]);
  assert.deepEqual(r.outside_eu, ['CH', 'GB'], 'upper-cased, de-duplicated, sorted');
  assert.equal(r.cells.find((c) => c.code === 'FR').state, 'held_active');
  assert.equal(r.held_active, 1, 'only the EU one lands in a cell');
  // A terminated licence's non-EU countries are free too, so they are not
  // reported either.
  assert.deepEqual(coverageCells([lic({ territories: ['CH'], status: 'terminated' })]).outside_eu, []);
});

test('codes arrive in whatever case the ledger has, and the grid still finds them', () => {
  const r = coverageCells([lic({ territories: [' fr ', 'be', '', null] })]);
  assert.equal(r.held_active, 2, 'trimmed, upper-cased, and empties skipped');
  assert.equal(r.free, 25);
});

test('an empty or absent ledger draws an all-free grid rather than throwing', () => {
  for (const input of [[], null, undefined]) {
    const r = coverageCells(input);
    assert.equal(r.cells.length, 27);
    assert.equal(r.free, 27);
    assert.equal(r.held_active, 0);
    assert.deepEqual(r.outside_eu, []);
  }
});

/* ── H2 · renewals ─────────────────────────────────────────────────── */

test('days to renewal is derived from the date passed, never stored', () => {
  const today = new Date('2026-09-15T22:30:00Z');
  const [row] = renewalPipeline([lic({ renews_on: '2026-09-25' })], today);
  assert.equal(row.days, 10, 'whole days, measured from midnight — not 9.06');

  // The same licence read a day later is a different number. A `days` baked in
  // at render time is wrong tomorrow, which is the reason this takes a date.
  const [later] = renewalPipeline([lic({ renews_on: '2026-09-25' })], new Date('2026-09-16T01:00:00Z'));
  assert.equal(later.days, 9);
});

test('an overdue renewal is kept, and sorts first', () => {
  const today = new Date('2026-09-15T00:00:00Z');
  const rows = renewalPipeline([
    lic({ uid: 'a', renews_on: '2027-01-31' }),
    lic({ uid: 'b', renews_on: '2026-08-01' }),
    lic({ uid: 'c', renews_on: '2026-09-15' }),
  ], today);
  assert.deepEqual(rows.map((r) => r.uid), ['b', 'c', 'a'], 'soonest first, overdue included');
  assert.equal(rows[0].days, -45, 'overdue goes negative rather than being dropped');
  assert.equal(rows[1].days, 0, 'a renewal today reads 0');
});

test('a licence with no renewal date, and a terminated one, are not in the pipeline', () => {
  const today = new Date('2026-09-15T00:00:00Z');
  assert.deepEqual(renewalPipeline([lic({ renews_on: null })], today), []);
  assert.deepEqual(renewalPipeline([lic({ status: 'terminated' })], today), []);
  // The other direction: a suspended licence still renews, and its row stays.
  assert.equal(renewalPipeline([lic({ status: 'suspended' })], today).length, 1);
});

/* ── H2 · the sort and the click (D146) ────────────────────────────── */

// Two licences whose codes and states disagree about order, so a test cannot
// pass by accident: DE is held-active and sorts LAST alphabetically of the
// three named here; AT is free and sorts FIRST.
const sorted = () => coverageCells([
  lic({ uid: 'lic_de', licence_ref: 'AXL-002', territories: ['DE'] }),
  lic({ uid: 'lic_es', licence_ref: 'AXL-004', territories: ['ES'], status: 'suspended' }),
]).cells;

test("'az' is the identity — coverageCells already emits alphabetical order", () => {
  const cells = sorted();
  assert.deepEqual(sortCells(cells, 'az').map((c) => c.code), [...EU_CODES]);
  // An unknown mode reads as A–Z rather than throwing: this is a display
  // control, and a grid that renders nothing because a key was misspelt is
  // worse than a grid in the order it already had.
  assert.deepEqual(sortCells(cells, 'nonsense').map((c) => c.code), [...EU_CODES]);
  assert.deepEqual(sortCells(cells).map((c) => c.code), [...EU_CODES]);
});

test("'state' groups held-active, then held-suspended, then white space", () => {
  const out = sortCells(sorted(), 'state');
  assert.deepEqual(
    out.map((c) => c.state).filter((s, i, a) => s !== a[i - 1]),
    ['held_active', 'held_suspended', 'free'],
    'each state appears in exactly one contiguous run, worst-available-last',
  );
  // The specific rows, so a rank flip cannot pass by still producing three runs.
  assert.equal(out[0].code, 'DE', 'the only held-active country leads');
  assert.equal(out[1].code, 'ES', 'the suspended one follows — it still holds its territory');
  assert.equal(out[2].code, 'AT', 'white space begins, A–Z within the group');
  assert.equal(out.length, 27, 'sorting never drops or invents a cell');
});

test('the sort is stable, so the two orders agree wherever state does not decide', () => {
  // Within one state the order must still be the A–Z the other option gives.
  const free = sortCells(sorted(), 'state').filter((c) => c.state === 'free').map((c) => c.code);
  assert.deepEqual(free, [...free].sort(), 'A–Z survives inside each group');
});

test('sortCells does not mutate its input', () => {
  // coverageCells returns a fresh array today, so an in-place sort would
  // happen to work — and would break the day a caller memoises the cells.
  const cells = sorted();
  const before = cells.map((c) => c.code);
  sortCells(cells, 'state');
  assert.deepEqual(cells.map((c) => c.code), before);
});

test('a held cell opens its licence and white space is not a button', () => {
  // The grid renders through the sorted list, not the raw cells.
  assert.match(PAGE, /sortCells\(cells, sort\)/);
  assert.match(PAGE, /ordered\.map\(/);
  assert.ok(!/\{cells\.map\(/.test(PAGE), 'the unsorted cells must not be what renders');

  // A held cell is the same <button onClick> idiom the licence rows use, and
  // it opens by uid — the selector the rows already set.
  assert.match(PAGE, /onClick=\{\(\) => onOpen\?\.\(c\.licence\.uid\)\}/);
  // …and the call site hands it the very same setter, so a click on a country
  // and a click on its row cannot land in two different places.
  assert.match(PAGE, /<Coverage items=\{items\} onOpen=\{setSel\} \/>/);

  // WHITE SPACE STAYS A DIV. A button that refuses is the `still_an_admin`
  // mistake D134 named. The ternary is keyed on `c.licence`, which is null for
  // exactly the free cells.
  assert.match(PAGE, /return c\.licence \? \(/);

  // The control itself: two options, `aria-pressed` carrying the choice.
  assert.match(PAGE, /data-testid="hq-coverage-sort"/);
  assert.match(PAGE, /aria-pressed=\{sort === s\.key\}/);
  assert.match(PAGE, /\{ key: 'state', label: 'By state' \}/);
  assert.match(PAGE, /\{ key: 'az', label: 'A–Z' \}/);
  // "By state" ships selected, because the canvas draws that segment chosen.
  assert.match(PAGE, /useState\('state'\)/);
});

test('the HQ sidebar comment counts the rows its own guard counts', () => {
  const CFG = read('frontend/src/sidebarConfig.js');
  // The array has shipped eleven rows since D138; the prose above it said
  // eight until D146, omitting Revenue, Content and Platform — the three
  // rows whose own comments sit a few lines below it.
  assert.ok(!/has eight rows/.test(CFG), 'the eight-row claim is gone');
  assert.ok(!/All eight resolve today/.test(CFG), 'and so is its follow-on');
  assert.match(CFG, /ELEVEN rows/);
  assert.match(CFG, /All eleven resolve today/);
  // NAMED, NOT COUNTED. A number on its own goes stale exactly the way the
  // last one did, so the comment must list the rows — and the three it used to
  // omit are asserted against the comment's own sentence rather than anywhere
  // in the file, or a mention in an unrelated line three hundred lines down
  // would satisfy it.
  const sentence = CFG.match(/The approved canvas has ELEVEN rows[^.]*\./)?.[0] ?? '';
  assert.ok(sentence, 'the eleven-row sentence exists to be read');
  for (const row of ['Home', 'Licences', 'Funds', 'Contracts', 'Team',
    'Revenue', 'Content', 'Platform', 'Support', 'Security', 'Settings']) {
    assert.ok(sentence.includes(row), `${row} is named in the comment, not just implied by a count`);
  }
});

/* ── H2 · the page renders both zones ──────────────────────────────── */

test('the coverage grid and the renewal pipeline are on the page, off the shared library', () => {
  assert.match(PAGE, /from '\.\.\/\.\.\/lib\/licenceCoverage'/);
  assert.match(PAGE, /coverageCells\(/);
  assert.match(PAGE, /renewalPipeline\(/);
  assert.match(PAGE, /data-testid="hq-coverage"/);
  assert.match(PAGE, /data-testid="hq-renewal-pipeline"/);
  // Each cell carries its own state, so the three are distinguishable in the
  // DOM rather than only by colour.
  assert.match(PAGE, /data-state=\{/);
  // The refusal this zone replaced must be gone, not merely out-voted by the
  // new code: a page that said "not drawn" beside the drawing is worse than
  // either. The phrase that stood here named the choropleth as refused.
  assert.ok(
    !/refus\w+ as "the EU choropleth"/i.test(read('frontend/src/pages/admin/AdminLicences.jsx')),
    'the choropleth refusal must be retired now that the grid exists',
  );
});

/* ── H3 · the six steps ────────────────────────────────────────────── */

test('the issue flow is the canvas\'s six steps, in order, and history is not one of them', () => {
  const m = PAGE.match(/const STEPS = \[([^\]]+)\]/);
  assert.ok(m, 'STEPS must be a literal list');
  const steps = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(steps, ['Entity', 'Territory', 'Seats', 'Terms', 'Contract', 'Deploy']);
  // Unnumbered and outside the list: the record is not a step anybody performs.
  assert.match(PAGE, /const HISTORY_STEP = STEPS\.length \+ 1/);
  assert.match(PAGE, /step === HISTORY_STEP/);
  assert.ok(!steps.includes('History'), 'History is not one of the six');
  assert.ok(!steps.includes('Activate'), 'Activate is a button above the tabs, not a tab');
});

test('step 5 instantiates from a named template version and never blanks a field it cannot fill', () => {
  assert.match(PAGE, /\{step === 5 && <ContractStep/);
  assert.match(PAGE, /api\.licenceContract\(/);
  assert.match(PAGE, /api\.licenceContractCreate\(/);
  assert.match(PAGE, /data-testid="licence-contract-step"/);
  // The version travels with the row, so a reader can see which text was
  // agreed rather than which text is current.
  assert.match(PAGE, /template_version/);
  assert.match(PAGE, /data-testid="contract-unfilled"/);
  assert.match(PAGE, /left as placeholders in the text rather/);
  // The canvas's rule, stated on the step that could be read as blocking.
  assert.match(PAGE, /pending signature does not block activation/);
  // A library with nothing in it says so instead of showing an empty picker.
  assert.match(PAGE, /templates_reason/);
});

test('step 6 renders the credential reason and disables the button rather than letting it 409', () => {
  assert.match(PAGE, /\{step === 6 && <DeployStep/);
  assert.match(PAGE, /data-testid="licence-deploy-step"/);
  assert.match(PAGE, /data-testid="deploy-credential-reason"/);
  // Disabled ON the server-supplied flag, not on a guess about the token: the
  // page cannot see a Worker secret, and a client-side guess would be wrong
  // the moment #192 is set.
  assert.match(PAGE, /disabled=\{busy \|\| !codeOk \|\| !reg\.dispatch_available\}/);
  assert.match(PAGE, /\{reg\.dispatch_reason\}/);
  assert.ok(
    !/GITHUB_ACCESS_TOKEN/.test(PAGE),
    'the reason is the server\'s sentence, never a second copy of it in the SPA',
  );
});

test('the deploy step states what residency it can and cannot promise', () => {
  assert.match(PAGE, /data-testid="residency-caveat"/);
  assert.match(PAGE, /in-country storage outside the EU is not available/);
  // The values Cloudflare actually offers, and nothing invented beside them.
  const hints = PAGE.match(/const LOCATION_HINTS = \[([\s\S]*?)\];/)[1];
  const vs = [...hints.matchAll(/v: '([a-z]+)'/g)].map((x) => x[1]);
  assert.deepEqual(vs, ['none', 'weur', 'eeur', 'enam', 'wnam', 'apac', 'oc']);
  const dos = PAGE.match(/const DO_JURISDICTIONS = \[([\s\S]*?)\];/)[1];
  assert.deepEqual([...dos.matchAll(/v: '([a-z]+)'/g)].map((x) => x[1]), ['none', 'eu', 'us']);
});

test('the branch code is refused rather than corrected, on the same charset as the workflow', () => {
  const m = PAGE.match(/const BRANCH_CODE_RE = (\/[^\n]+\/);/);
  assert.ok(m, 'the page must carry the charset it validates against');
  const re = new RegExp(m[1].slice(1, -1));
  for (const bad of ['FR', 'f', '1fr', 'fr; rm -rf /', 'a-very-long-branch-code']) {
    assert.ok(!re.test(bad), `${JSON.stringify(bad)} must not pass`);
  }
  for (const good of ['fr', 'dach', 'nordics-2']) assert.ok(re.test(good), `${good} must pass`);
  // No lower-casing on the way in: it names the Worker, the database and the
  // hostname, and a value HQ rewrote would be refused by the workflow it was
  // dispatched to.
  assert.ok(
    !/setCode\(e\.target\.value\.toLowerCase\(\)\)/.test(PAGE),
    'the code is validated as typed',
  );
});

test('the timeline shows the steps still ahead, not only the one reached', () => {
  // D149 MOVED THE LIST TO `lib/deployTimeline.js` AND THIS TEST FOLLOWED IT,
  // assertions unchanged — which is what proves the move was a move. It is read
  // as the exported value rather than sliced out of source text, because it is
  // now a value a test can hold.
  const keys = DEPLOY_TIMELINE.map(([k]) => k);
  assert.deepEqual(keys, [
    'requested', 'database_created', 'schema_applied', 'secrets_present',
    'principal_seeded', 'worker_live', 'hostname_active', 'linked',
  ]);
  assert.ok(!keys.includes('failed'), 'failed is a status, not a stage on the way');
  assert.match(PAGE, /data-testid="deploy-timeline"/);
  // And the page must read the one list rather than keeping a second copy of
  // the eight steps beside it.
  assert.match(PAGE, /from '\.\.\/\.\.\/lib\/deployTimeline'/);
  assert.ok(
    !/const DEPLOY_TIMELINE = \[/.test(PAGE),
    'the eight steps are declared once, in lib/deployTimeline.js',
  );
});

/* ── H8 · the deploy timeline's three states (D149) ─────────────────── */

test('a RUNNING deployment and a FAILED one no longer render alike', () => {
  // THE ASSERTION THE WHOLE FIX TURNS ON, and it needs both cases: the defect
  // was that they rendered IDENTICALLY, so a fixture holding only the failed
  // one could not see it. Before D149 the render was `at >= 0 && i <= at`, so
  // `failed` (at === -1) drew eight empty circles and `requested` drew one
  // check and seven — different, yes, but a failure AFTER step 3 and a run
  // still ON step 4 both drew three checks and five circles, and a failure
  // drew what "not started" would draw.
  const running = deployProgress('schema_applied');
  const failed = deployProgress('failed');

  assert.notDeepEqual(running.states, failed.states);
  assert.notEqual(running.summary, failed.summary);

  // Running: the steps behind are done, the steps ahead are waiting, and
  // nothing claims to know about a step it cannot see.
  assert.deepEqual(running.states, ['ok', 'ok', 'ok', 'wait', 'wait', 'wait', 'wait', 'wait']);
  assert.equal(running.failed, false);
  assert.equal(running.done, 3);

  // Failed: every step is `unknown`, and NOT `fail`. `status` was overwritten,
  // so which step it failed at is gone — but the row exists, so claiming all
  // eight failed would be a second false statement in place of the first.
  assert.deepEqual(failed.states, Array(8).fill('unknown'));
  assert.ok(!failed.states.includes('fail'), 'no step may be marked failed: none is recorded as such');
  assert.equal(failed.failed, true);
  assert.equal(failed.done, 0);

  // The two states a binary render collapsed: a failure after step 3 against a
  // run still working on step 4.
  assert.notDeepEqual(deployProgress('failed').states, deployProgress('secrets_present').states);
});

test('every one of the eight steps derives its own state, and the last one completes', () => {
  // Walked end to end rather than sampled, because an off-by-one at either end
  // is the mistake this shape invites: `requested` must complete exactly one
  // step and `linked` must complete all eight with nothing left waiting.
  for (const [i, [key]] of DEPLOY_TIMELINE.entries()) {
    const p = deployProgress(key);
    assert.equal(p.done, i + 1, `${key} completes ${i + 1} steps`);
    assert.equal(p.states[i], 'ok', `${key} marks its own step done`);
    if (i + 1 < p.total) assert.equal(p.states[i + 1], 'wait', `${key} leaves the next step waiting`);
    assert.equal(p.states.filter((x) => x === 'ok').length, i + 1);
  }
  assert.equal(deployProgress('linked').states.filter((x) => x === 'wait').length, 0);
  assert.equal(deployProgress('requested').done, 1);
});

test('the summary counts what the marks show, and says so when it cannot', () => {
  // A summary derived separately from the marks is how the two come to
  // disagree, so it is asserted against them rather than against a literal.
  for (const status of [...DEPLOY_TIMELINE.map(([k]) => k), 'failed']) {
    const p = deployProgress(status);
    assert.equal(p.done, p.states.filter((x) => x === 'ok').length, `${status}: the count matches the marks`);
  }
  assert.equal(deployProgress('worker_live').summary, '6 of 8 complete · 2 waiting');
  // The failed summary must SAY the step is unrecorded rather than print a
  // count that implies nothing happened. "0 of 8 complete" would be the same
  // lie the blank timeline told.
  const failed = deployProgress('failed').summary;
  assert.match(failed, /not recorded/);
  assert.ok(!/^0 of 8 complete/.test(failed), 'a failure is not a deployment that never started');
  assert.match(PAGE, /data-testid="deploy-summary"/);
});

test('the page draws three distinct marks and states what the store cannot carry', () => {
  // The derivation is proved above; this is the wiring, which a scan CAN see.
  for (const state of ['ok', 'wait', 'unknown']) {
    assert.ok(
      new RegExp(`state === '${state}'`).test(PAGE),
      `the timeline must draw its own mark for ${state}`,
    );
  }
  assert.match(PAGE, /data-state=\{state\}/);
  assert.match(PAGE, /states\[i\]/);
  // Per-step times and per-step notes are NOT derivable from one status and
  // one note, so the page says so instead of inventing seven timestamps from
  // `requested_at` — the D140/D147 rule.
  assert.match(PAGE, /data-testid="deploy-timeline-bound"/);
  assert.match(PAGE, /No step carries a time or a note of its own/);
  // And the one note there is gets named as the deployment's, not a step's.
  assert.match(PAGE, /data-testid="deploy-status-note"/);
  assert.match(PAGE, /Why it stopped/);
});

/* ── H6 · Platform → Deployments ───────────────────────────────────── */

test('Platform reads the deployments registry on its own request', () => {
  assert.match(PLATFORM, /api\.deployments\(\)/);
  assert.match(PLATFORM, /data-testid="hq-deployments"/);
  assert.match(API, /\bdeployments:\s*\(\) => request\('\/admin\/deployments'\)/);
});

test('the provisioning status and the live read are rendered as two chips, never one', () => {
  // A deployment that reached `worker_live` last week and is unreachable right
  // now has not regressed to `requested`. Both surfaces keep them apart.
  for (const [name, src] of [['Platform', PLATFORM], ['the Deploy step', PAGE]]) {
    assert.match(src, /live_state/, `${name} must render the live read`);
    assert.match(src, /\bstatus\b/, `${name} must render the provisioning status`);
  }
  assert.match(PLATFORM, /registry_available/, 'an unreadable registry is not zero branches');
});

/* ── D161 · Platform → Traffic by branch ───────────────────────────── */

// The JSX comments are stripped here as well as the block ones: this zone's
// markup EXPLAINS the states it draws, and an assertion satisfied by that
// explanation rather than by the render is not an assertion.
const PLATFORM_JSX = codeOnlyJsx(read('frontend/src/pages/hq/PlatformPage.jsx'));

test('the branch traffic split is its own read, on its own method', () => {
  // Its own `useState`/loader, not a field on the platform summary: it goes out
  // to Analytics Engine over the network and fails differently, so an
  // unreadable metrics store must not empty the keys, jobs or deployments
  // halves of this page.
  assert.match(PLATFORM_JSX, /api\.analyticsTrafficByBranch\(/);
  assert.match(PLATFORM_JSX, /data-testid="hq-traffic-by-branch"/);
  assert.match(API, /analyticsTrafficByBranch:\s*\(from, to\)/);
  assert.match(API, /\/monitoring\/analytics\/traffic-by-branch\?from=/);
  // And it is a SEPARATE method from the platform-wide aggregate, deliberately:
  // that one is requireAdmin, and a plain admin is a branch admin here, so
  // attributing traffic to a named branch through it would show every branch
  // admin every other branch's figures.
  assert.match(API, /analyticsTechnical:\s*\(from, to\)/,
    'the aggregate keeps its own method and its own gate');
  assert.ok(!/analyticsTechnical:[\s\S]{0,200}branch=/.test(API),
    'the requireAdmin aggregate must not grow a ?branch= parameter');
});

/**
 * The traffic zone's own markup, bounded at both ends.
 *
 * WHY THIS IS A SLICE AND NOT A WHOLE-FILE SCAN, learned the hard way one
 * mutation ago: the Deployments zone four hundred lines above renders "an empty
 * registry, not an unreadable one", so a whole-file match on that phrase passed
 * with THIS zone's empty-state sentence deleted outright. An assertion a
 * neighbouring zone can satisfy is not an assertion about this one.
 */
function trafficZone() {
  const from = PLATFORM_JSX.indexOf('Traffic by branch');
  assert.ok(from > 0, 'the zone must exist');
  const to = PLATFORM_JSX.indexOf('Feature flags', from);
  assert.ok(to > from, 'and must sit before Feature flags, which is what bounds this slice');
  return PLATFORM_JSX.slice(from, to);
}

test('could not read and no traffic are two different renders, and neither is a zero', () => {
  // The rule since D107/D129, on the surface this time. An empty split has two
  // entirely different causes and a page that drew both as 0 would be making a
  // claim nothing measured.
  const zone = trafficZone();
  assert.match(zone, /traffic === UNAVAILABLE/, 'the request itself can fail');
  assert.match(zone, /traffic\.available === false/, 'and so can the store behind it');
  assert.match(zone, /<Absent reason=\{traffic\.reason\}/,
    "the server's own sentence is rendered, never one written here");
  assert.match(zone, /answered and holds no request[\s\S]{0,80}not an unreadable one/,
    'and the empty-but-readable case says so in its own words, in THIS zone');
  // The ban this page already enforces everywhere else, applied to the new zone.
  assert.ok(!/\|\|\s*0/.test(zone), 'no figure on this zone falls back to 0');
});

test('one row does not read as one branch out of several', () => {
  // The state of the platform today: zero branches provisioned, so every row
  // carries `hq` and the split renders exactly one group. Drawn without this,
  // a single row reads as a fan-out that found one answer.
  assert.match(PLATFORM_JSX, /traffic\.rows\.length === 1 && traffic\.rows\[0\]\.branch === 'hq'/);
  assert.match(PLATFORM_JSX, /this is one deployment, not one branch out of several/);
});

/* ── D163 · Platform → Deployments carries HQ's own acts ───────────── */

/**
 * The Deployments zone's own markup, bounded at both ends.
 *
 * Bounded for the reason the traffic zone above states in its own words: a
 * whole-file scan on this page is satisfiable by a neighbouring zone, and an
 * assertion a neighbour can satisfy is not an assertion about this one.
 */
function deploymentsZone() {
  const from = PLATFORM_JSX.indexOf('one row per branch');
  assert.ok(from > 0, 'the zone must exist');
  const to = PLATFORM_JSX.indexOf('Traffic by branch', from);
  assert.ok(to > from, 'and must sit before Traffic by branch, which is what bounds this slice');
  return PLATFORM_JSX.slice(from, to);
}

test('the mirror rides the deployments payload — no second method, no drift entry', () => {
  // D150's lesson, applied rather than re-learned: this page already fetches
  // /admin/deployments, and the mirror is a block on that payload. A parallel
  // fetch would be a second request for one zone, and would owe check-api-drift
  // a new method for a read the page already makes.
  assert.match(deploymentsZone(), /deps\.branch_actions/);
  assert.ok(!/analyticsBranchActions|branch-actions/.test(API),
    'no new /api/* method is introduced for this');
});

test('an unreadable telemetry store is said ONCE, not once per branch', () => {
  const zone = deploymentsZone();
  // Repeating it per row would read as every branch being unreachable, which
  // is the conflation `live_state` exists to prevent — and the reason
  // admin_security.ts states this rule for its own tenant column.
  assert.match(zone, /branch_actions_available === false/);
  assert.match(zone, /data-testid="hq-branch-actions-absent"/);
  const perRow = zone.match(/data-testid=\{`hq-branch-actions-\$\{d\.code\}`\}/g) || [];
  assert.equal(perRow.length, 1, 'one per-branch list, keyed by the branch');
  const absent = zone.match(/hq-branch-actions-absent/g) || [];
  assert.equal(absent.length, 1, 'and exactly one unreadable sentence for the whole zone');
});

test("the server's own reason is rendered, and no figure falls back to 0", () => {
  const zone = deploymentsZone();
  assert.match(zone, /\{deps\.branch_actions_reason\}/,
    "the reason comes from the payload, never a sentence written on the page");
  assert.ok(!/\|\|\s*0/.test(zone), 'no count on this zone falls back to 0');
});

test('a branch with nothing recorded draws nothing, which is not an absent state', () => {
  // The absence of an act is not a claim worth drawing; the store being
  // unreadable is, and the zone says that separately above.
  assert.match(PLATFORM_JSX, /actionsForBranch\(deps\.branch_actions, d\.code\)\.length > 0/);
});
