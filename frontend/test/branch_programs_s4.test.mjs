/**
 * Branch · Programs and · Community — canvas S4, and the third promise this
 * programme has had to delete (D140).
 *
 * WHAT THIS FILE IS FOR. `/branch/programs` promised *"the cohort calendar with
 * dates you adjust, and assessment runs whose results are yours."* Measured
 * against the worker, the first clause is false and the second cannot be built:
 *
 *   1. THERE IS NO `UPDATE week_windows` ANYWHERE, and every
 *      `UPDATE cohort_cycles` touches `status`, `app_status`, `force_proceed`
 *      or the one-shot application window — never `start_at`/`end_at`. A date
 *      picker would be a control with nothing behind it.
 *   2. THERE IS NO ROUTE THAT LISTS ASSESSMENT RUNS — no `GET /sessions`, no
 *      `GET /results`. A table of runs would have nothing to read.
 *
 * So the risk on these two pages is not a wrong number, it is a *plausible*
 * affordance: a control the reader believes in and the server always refuses.
 * The assertions below are aimed there, and the worker-side facts are read OUT
 * OF THE WORKER rather than restated, so the day one of them stops being true
 * this file fails instead of going quietly stale.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/branch_programs_s4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

import { inZone, dateInZone } from '../src/lib/zoneTime.js';
import { cycleLabel, statusesByWeek } from '../src/lib/cohortTimeline.js';
import { COMMUNITY_CONSOLES } from '../src/pages/branch/BranchCommunity.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const APP_RAW = raw('frontend/src/App.jsx');
const APP = codeOnly(APP_RAW);
const PROG_RAW = raw('frontend/src/pages/branch/BranchPrograms.jsx');
const PROG = codeOnly(PROG_RAW);
const COMM_RAW = raw('frontend/src/pages/branch/BranchCommunity.jsx');
const HOME = codeOnly(raw('frontend/src/pages/branch/BranchHome.jsx'));

/** Every file under a tree, so a claim about the tree is about the tree. */
function filesUnder(dir, out = []) {
  for (const name of readdirSync(resolve(process.cwd(), dir))) {
    if (name.startsWith('.')) continue;
    const p = `${dir}/${name}`;
    if (statSync(resolve(process.cwd(), p)).isDirectory()) filesUnder(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

test('the promise of adjustable dates is deleted, not reworded', () => {
  // The `NO_VERDICT_SNAPSHOT` precedent: a promise that outlived its fact is
  // deleted at the source, and may not reappear anywhere under frontend/src.
  // Scanned over CODE ONLY, because this file and the page's own docblock both
  // quote the sentence in order to say it is retired.
  const offenders = filesUnder('frontend/src')
    .filter((p) => /dates you adjust/i.test(codeOnly(raw(p))));
  assert.deepEqual(offenders, [],
    'the retired promise is back in the tree — no route adjusts a cycle or a week window');
});

test('both S4 routes render a page rather than a stated notice', () => {
  for (const [path, page] of [
    ['/branch/programs', 'BranchPrograms'],
    ['/branch/community', 'BranchCommunity'],
  ]) {
    const at = APP.indexOf(`path="${path}"`);
    assert.ok(at > 0, `${path} is no longer a registered route`);
    const el = APP.slice(at, at + 160);
    // D151 — THE COMPONENT, NOT THE PROP-LESS SPELLING. `<${page} />` failed
    // the moment the route passed a prop, which does not change which page it
    // renders. The character after the name is checked so `<BranchPrograms`
    // cannot be satisfied by a longer identifier that starts the same way.
    const open = el.indexOf(`<${page}`);
    assert.ok(open >= 0 && /[\s/>]/.test(el[open + page.length + 1] || ''),
      `${path} does not render ${page}`);
    assert.ok(!el.includes('BranchZonePending'),
      `${path} still renders the notice the page was built to replace`);
  }
});

test('the calendar states that its dates are derived, where a reader meets them', () => {
  // Not a footnote and not the rail alone: the sentence sits on the calendar
  // block, because "these dates are read rather than set" is the first thing a
  // reader of that block would otherwise assume wrong.
  assert.ok(PROG_RAW.includes('data-testid="branch-programs-derived"'),
    'the calendar does not say its dates are derived');
  const at = PROG_RAW.indexOf('data-testid="branch-programs-derived"');
  const block = PROG_RAW.slice(at, at + 420);
  assert.match(block, /No route\s+moves a cycle or a window/,
    'the derived-dates sentence does not say that no route moves one');
});

test('no date-editing control is drawn against a route that does not exist', () => {
  // D134's rule, one tier over: a button the server always rejects teaches the
  // operator that one of its buttons is a lie. There is no route to call, so
  // there must be no control and no write.
  assert.ok(!/type="date"/.test(PROG), 'a date input is drawn on a page with nothing to write to');
  assert.ok(!/<form/i.test(PROG), 'a form is drawn on a page whose calendar is read-only');
  assert.ok(!/api\.adminCohort(Grace|Override|ForceProceed)/.test(PROG),
    'the page re-implements an audited write that already has a console');
  // …and it says where those two decisions ARE made rather than pretending
  // they do not exist.
  assert.match(PROG, /to="\/admin\/spinout-lab"/,
    'the page does not link to the console where grace and override are decided');
});

test('every week deadline carries the zone it is enforced in', () => {
  assert.ok(PROG_RAW.includes('data-testid="branch-programs-zone"'),
    'the calendar never names the zone its deadlines are in');
  // The zone is passed to the formatter at every call, which is the property
  // that matters — a call that omitted it would render the READER's hour.
  // EVERY call is read and its SECOND ARGUMENT checked, rather than a regex
  // that merely proves some call mentions the zone. The first version of this
  // assertion did the latter and a mutation passing `undefined` walked straight
  // through it — an assertion that cannot fail on the defect it was written for
  // is not a guard.
  const calls = [...PROG.matchAll(/\b(inZone|dateInZone)\(([^)]*)\)/g)];
  assert.ok(calls.length >= 3, 'the calendar formats fewer instants than it renders');
  const zoneless = calls
    .map((m) => ({ call: m[0], zone: (m[2].split(',')[1] || '').trim() }))
    .filter((c) => c.zone !== 'COHORT_TZ');
  assert.deepEqual(zoneless, [],
    'an instant is formatted without the zone it is enforced in — the reader gets their own hour');
  assert.ok(!/new Date\((?!\))/.test(PROG),
    'the page parses an instant itself instead of going through lib/zoneTime.js');
});

test("the SPA's COHORT_TZ is the worker's, not a third copy", () => {
  // Two constants that must agree and cannot import each other. Pinning them
  // together is the only thing that stops a rename on one side going unnoticed.
  const spa = raw('frontend/src/lib/spinoutLab.js').match(/COHORT_TZ\s*=\s*'([^']+)'/);
  const worker = raw('cloudflare-worker/src/services/cohortTiming.ts').match(/COHORT_TZ\s*=\s*'([^']+)'/);
  assert.ok(spa && worker, 'one of the two COHORT_TZ declarations is gone or renamed');
  assert.equal(spa[1], worker[1],
    'the SPA and the worker disagree about the programme zone');
  assert.match(PROG, /from '\.\.\/\.\.\/lib\/spinoutLab'/,
    'the page types the zone itself instead of reading the shared constant');
});

test('inZone still refuses a missing zone after the move to lib/', () => {
  // The whole reason the argument is required. A formatter that fell back to
  // the reader's zone produces the exact wrong hour it exists to prevent.
  const iso = '2026-09-23T04:00:00.000Z';
  assert.equal(inZone(iso, null), null);
  assert.equal(inZone(iso, ''), null);
  assert.equal(dateInZone(iso, null), null);
  assert.equal(inZone(null, 'America/New_York'), null);
  assert.equal(inZone('not a date', 'America/New_York'), null);
  // And it genuinely formats in the zone it is given, both ways.
  assert.notEqual(inZone(iso, 'America/New_York'), inZone(iso, 'Asia/Tokyo'));
  // en-GB abbreviates September as "Sept", so the assertion pins the day and
  // year rather than a month spelling the Intl data owns.
  assert.match(dateInZone(iso, 'America/New_York') || '', /^23 \w+ 2026$/);
});

test('inZone is defined once in the SPA, and the page it came from does not re-declare it', () => {
  // The fifth consolidation. `lib/README.md`: "If a helper appears in two
  // places, put it here once rather than a third time."
  const decls = filesUnder('frontend/src')
    .filter((p) => /export function inZone\s*\(/.test(raw(p)));
  assert.deepEqual(decls, ['frontend/src/lib/zoneTime.js'],
    'inZone is declared somewhere other than its one home');
  assert.ok(!/function inZone\s*\(/.test(HOME),
    'BranchHome re-declares the helper it was meant to import');
  assert.match(HOME, /from '\.\.\/\.\.\/lib\/zoneTime'/,
    'BranchHome no longer imports the helper it still uses');
});

test('a week nobody has been judged in is not a week everyone passed', () => {
  // `status_counts` carries one row per (week, status) pair. A week with no
  // rows has no entry — which the page renders as "no outcome recorded yet"
  // rather than as a row of zeroes.
  const folded = statusesByWeek([
    { week_number: 1, status: 'passed', n: 4 },
    { week_number: 1, status: 'failed', n: 1 },
    { week_number: 3, status: 'grace', n: 2 },
  ]);
  assert.deepEqual(folded.get(1), { passed: 4, failed: 1 });
  assert.deepEqual(folded.get(3), { grace: 2 });
  assert.equal(folded.get(2), undefined, 'an unjudged week was invented as an empty tally');
  assert.equal(statusesByWeek(null).size, 0, 'a missing payload is not an empty tally');
  assert.ok(PROG_RAW.includes('no outcome recorded yet'),
    'the page prints nothing for a week it has no outcome for');
});

test('a cycle label refuses a month it cannot name', () => {
  assert.equal(cycleLabel(2026, 10), 'October 2026');
  assert.equal(cycleLabel(2026, 13), null);
  assert.equal(cycleLabel(2026, 0), null);
  assert.equal(cycleLabel(null, 10), null);
});

test('the assessment gap is named on the page, not only in the rail', () => {
  assert.ok(PROG_RAW.includes('data-testid="branch-programs-runs-gap"'),
    'nothing on screen says why individual runs are not listed');
  assert.ok(PROG_RAW.includes('data-testid="branch-programs-authoring"'),
    'the page does not say that authoring belongs to HQ');
  // And it draws no authoring control, because 17 of that file's 23 routes
  // refuse one on a branch.
  assert.ok(!/adminAssessment\.(createGame|updateGame|publishGame|archiveGame|createChapter|createItem|createBadge)/.test(PROG),
    'the page calls an assessment authoring route that is refused on a branch');
});

test('the assessment runs gap is true: the worker lists no sessions or results', () => {
  // Read out of the worker rather than restated. The day somebody ships a list
  // route, this fails and the page gets its table.
  const file = raw('cloudflare-worker/src/routes/admin_assessment.ts');
  assert.ok(!/adminAssessment\.get\('\/sessions'/.test(file),
    'a sessions list route exists now — BranchPrograms can show runs');
  assert.ok(!/adminAssessment\.get\('\/results'/.test(file),
    'a results list route exists now — BranchPrograms can show runs');
});

test('every community card points at a route App.jsx registers', () => {
  assert.equal(COMMUNITY_CONSOLES.length, 4, 'the console list changed size');
  // One card per console, keyed from the list rather than hand-written — so a
  // fifth entry gets a card without anyone remembering to add one, and two
  // entries cannot share a key and collapse into one.
  assert.match(COMM_RAW, /data-testid=\{`branch-community-\$\{con\.key\}`\}/,
    'the cards are not rendered from COMMUNITY_CONSOLES');
  assert.equal(new Set(COMMUNITY_CONSOLES.map((c) => c.key)).size, 4,
    'two consoles share a key, so one card would replace the other');
  for (const con of COMMUNITY_CONSOLES) {
    assert.ok(APP.includes(`path="${con.to}"`),
      `${con.label} links to ${con.to}, which is not a registered route`);
    assert.ok(con.key && con.label && con.scope && con.what,
      `${con.label} is missing one of the four fields a card renders`);
  }
});

test('the four community consoles really are reachable on a branch', () => {
  // task 385 / D302: "the roster stays branch-local" is the coordinator's
  // decision, and the guard now asks EACH CARD which worker file serves it
  // (via its own `worker` field) rather than a hard-coded list of four —
  // so a fifth console added without naming its worker is caught by the
  // COMMUNITY_CONSOLES-length assertion above, and every one of the several
  // ways a route can be made HQ-only is refused here, not only one of them.
  for (const con of COMMUNITY_CONSOLES) {
    assert.ok(con.worker, `${con.label} names no worker file — the card cannot be checked for an HQ gate`);
    const path = `cloudflare-worker/src/routes/${con.worker}`;
    assert.ok(existsSync(resolve(process.cwd(), path)), `${con.label}'s worker field names ${con.worker}, which does not exist`);
    const src = codeOnly(raw(path));
    for (const gate of ['requireHqAuthoring', 'requireSuperAdmin', 'requireSuperAdminWriteBar']) {
      assert.ok(!new RegExp(`\\b${gate}\\b`).test(src),
        `${con.worker} calls ${gate}(), so its Community card would 403 on a branch`);
    }
    assert.ok(!/\bHQ_ONLY\b/.test(src) && !/\bHQ_AUTHORING_ONLY\b/.test(src),
      `${con.worker} throws an HQ-only refusal, so its Community card would 403 on a branch`);
  }
});

test('a comment mentioning requireSuperAdmin in a console file does not trip the gate check (negative control)', () => {
  // codeOnly strips exactly the prose shapes a defensive comment would use to
  // explain an absence — proving the check above reads CODE, not comments,
  // the same way a mention of "watermarked" or a 403 in prose does not fail
  // the assertions those words guard elsewhere in this suite.
  const fixture = `
// This console deliberately never calls requireSuperAdmin() — it stays open to any branch admin.
export function handler() { return true; }
`;
  const cleaned = codeOnly(fixture);
  assert.ok(!/\brequireSuperAdmin\b/.test(cleaned),
    'codeOnly left a bare-comment mention of requireSuperAdmin in place — the negative control is not exercising codeOnly');
});

test('the job board card does not claim an authoring power it lacks', () => {
  const jobs = COMMUNITY_CONSOLES.find((c) => c.key === 'jobs');
  assert.match(jobs.scope, /Moderation only/);
  assert.match(jobs.what, /no admin\s+create, edit or delete/i);
  // And the worker agrees: five routes, none of which creates or deletes.
  const src = raw('cloudflare-worker/src/routes/admin_jobs.ts');
  assert.ok(!/adminJobs\.post\('\/'/.test(src), 'the job board gained an admin create');
  assert.ok(!/adminJobs\.delete\(/.test(src), 'the job board gained an admin delete');
});

test('network profiles is not described as a member directory', () => {
  const np = COMMUNITY_CONSOLES.find((c) => c.key === 'network-profiles');
  assert.match(np.what, /not a member directory/i,
    'the card lets its name imply a directory the platform does not have');
  // The measurement behind that sentence: the only public route over the table
  // is the photo blob. If a member-facing list ever ships, this fails and the
  // card can be rewritten.
  const pub = raw('cloudflare-worker/src/routes/network_public.ts');
  const routes = pub.match(/r\.(get|post)\(['"][^'"]+['"]/g) || [];
  assert.deepEqual(routes, ["r.get('/network/:id/photo'"],
    'network_public.ts serves more than the photo now — re-check the directory claim');
});

test('Community reads nothing, so no count here can disagree with its console', () => {
  // Four counts would each be a second read of a console's own list, and a
  // tile disagreeing with the table one click away is what D128 ended.
  const comm = codeOnly(COMM_RAW);
  assert.ok(!/\bapi\./.test(comm), 'the Community index fetches, so it can now contradict a console');
  assert.ok(!/useEffect|useState/.test(comm), 'the Community index holds state it has no read for');
});
