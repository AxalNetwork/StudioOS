/**
 * D435 — Team (integrated, founder): the roster, advisors, hiring and
 * coverage page at /build/team?mode=workspace, built to the owner's decision
 * line and replacing TeamBuildingPage.
 *
 * FIVE THINGS, PINNED TO THE PROPERTY.
 *
 * 1. THE MOUNT AND THE REDIRECTS. `/build/team` in workspace mode renders
 *    `FounderTeamPage`; the old page is deleted; the three founder redirects
 *    (`/advisors`, `/my/jobs`, `/cofounder`) carry `mode=workspace`, because a
 *    bare `/build/team` is the Grow desk for a founder and `?tab=` alone never
 *    reached a tab; and the legacy tab ids land in the tab that owns the job.
 *
 * 2. WHAT IS COMPUTED IS LABELLED, AND NOTHING IS INVENTED. Vesting comes
 *    from the recorded schedule with a ghost track before the cliff; equity
 *    says whether it is the cap table's figure or the recorded grant; people
 *    cost counts an unrecorded salary as unknown and the payroll-load rate as
 *    not recorded; the pool's "reserved" is not recorded, never zero.
 *
 * 3. ECONOMICS ARE LOCKED, NOT HIDDEN: an absent `salary_cents` draws Locked,
 *    and the cost card locks as a whole when any active row lacks the field.
 *
 * 4. EVERY SOURCE HAS A FAILED STATE: the team read, the roles, the calendar,
 *    the cap table, the pool and the co-founder decision each render
 *    Unreadable or a reasoned Unrecorded, never an empty list.
 *
 * 5. THE DECISION LINE IS ON SCREEN: the six owner decisions are drawn in a
 *    panel, "Send document" is not drawn as live, and the invite note says
 *    no paperwork is issued from here. The client methods each have a mounted
 *    worker route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/founder/FounderTeamPage.jsx');
const CODE = codeOnly(PAGE);
const APP = codeOnly(read('frontend/src/App.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const WORKER = codeOnly(read('cloudflare-worker/src/routes/company.ts'));
const MIGRATION = read('cloudflare-worker/sql/migrations/326_company_team_roster_coverage_plan.sql');

function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `could not slice ${from} → ${to}`);
  return src.slice(a, b);
}

// The pure helpers, lifted out of the module and run without React.
function helpers() {
  const src = slice(CODE, 'const LEGACY_TABS', 'function TierGate(').replace(/export function/g, 'function');
  const tabs = "const TABS = [{ id: 'roster' }, { id: 'advisors' }, { id: 'hiring' }, { id: 'coverage' }];";
  return new Function(`${tabs}; ${src}; return { resolveTab, vestingOf, equityOf, fullyDiluted, paperworkGaps, peopleCost, poolArithmetic, dollarsToCents, centsToDollars, rosterCsv, initialsOf };`)();
}

// ---------------------------------------------------------------------------
// 1. Mount and redirects.
// ---------------------------------------------------------------------------

test('the Team page is mounted in workspace mode, the old page is gone, and the founder redirects carry mode=workspace', () => {
  const route = APP.split('\n').find((l) => l.includes('path="/build/team"'));
  assert.match(route, /<FounderWorkspaceTabs set="grow" user=\{user\}><FounderTeamPage \/><\/FounderWorkspaceTabs>/);
  assert.match(route, /founderGrowLanding \? <FounderGrowDesk \/>/, 'the Grow desk still owns the bare route for a founder');
  assert.doesNotMatch(APP, /TeamBuildingPage/);
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/TeamBuildingPage.jsx')), 'the retired page is deleted (D304)');
  for (const [path, tab] of [['/advisors', 'advisor'], ['/my/jobs', 'jobs'], ['/cofounder', 'cofounder']]) {
    const line = APP.split('\n').find((l) => l.includes(`path="${path}"`));
    assert.match(line, new RegExp(`user\\?\\.role === 'founder' \\? <Navigate to="/build/team\\?mode=workspace&tab=${tab}" replace />`), path);
  }
  assert.doesNotMatch(APP, /to="\/build\/team\?tab=/, 'no redirect sends a bare ?tab= into the Grow desk');
  const home = codeOnly(read('frontend/src/pages/founder/FounderStudioHome.jsx'));
  assert.match(home, /to="\/build\/team\?mode=workspace&tab=advisor"/);
});

test('the legacy tab ids land in the tab that owns the job, and tab changes keep the mode', () => {
  const { resolveTab } = helpers();
  assert.equal(resolveTab(null), 'roster');
  assert.equal(resolveTab('advisor'), 'advisors');
  assert.equal(resolveTab('cofounder'), 'hiring');
  assert.equal(resolveTab('jobs'), 'hiring');
  assert.equal(resolveTab('coverage'), 'coverage');
  assert.equal(resolveTab('nonsense'), 'roster');
  const page = slice(CODE, 'export default function FounderTeamPage', 'function exportRoster(');
  assert.match(page, /const next = new URLSearchParams\(searchParams\);\s*next\.set\('tab', id\);/, 'the other params (mode=workspace) survive a tab change');
  // The discovery surfaces the retired page embedded still open here.
  assert.match(CODE, /<AdvisorsPage embedded \/>/);
  assert.match(CODE, /<CofounderPage embedded \/>/);
  assert.match(CODE, /<MyJobsPage embedded \/>/);
  assert.match(CODE, /<TierGate tier="growth"/);
  assert.match(CODE, /<TierGate tier="studio"/);
  assert.match(CODE, /pageKey="team_building"/);
});

// ---------------------------------------------------------------------------
// 2. Computed, labelled, nothing invented.
// ---------------------------------------------------------------------------

test('vesting comes from the recorded schedule, with a ghost track before the cliff and an absence without one', () => {
  const { vestingOf } = helpers();
  const today = new Date('2026-08-25T00:00:00Z');
  assert.equal(vestingOf({ vest_start_date: null, vest_months: 48 }, today), null);
  assert.equal(vestingOf({ vest_start_date: '2026-05-04', vest_months: null }, today), null);
  const pre = vestingOf({ vest_start_date: '2026-05-04', cliff_months: 12, vest_months: 48, status: 'active' }, today);
  assert.equal(pre.pct, 0, 'nothing vests before the cliff');
  assert.ok(pre.ghost > 0 && pre.ghost < 100, 'elapsed time is a ghost track, never vested equity');
  assert.match(pre.note, /^Cliff in \d+ days$/);
  const post = vestingOf({ vest_start_date: '2024-08-25', cliff_months: 12, vest_months: 48, status: 'active' }, today);
  assert.equal(post.pct, 50);
  assert.equal(post.ghost, 0);
  assert.match(post.note, /computed from the recorded schedule/);
  const noCliff = vestingOf({ vest_start_date: '2026-02-25', cliff_months: null, vest_months: 24, status: 'active' }, today);
  assert.equal(noCliff.cliffRecorded, false);
  assert.equal(noCliff.pct, 25);
  const offer = vestingOf({ vest_start_date: '2026-09-14', cliff_months: 12, vest_months: 48, status: 'offer_out' }, today);
  assert.equal(offer.pct, 0);
  assert.match(offer.note, /^Starts /);
  assert.doesNotMatch(CODE, /vested_shares/, 'a provider’s vested count is never re-derived here');
});

test('equity says whether it is the cap table’s figure or the recorded grant, and is absent otherwise', () => {
  const { equityOf, fullyDiluted } = helpers();
  const cap = { available: true, holders: [{ email: 'a@x.test', shares: 5400000, ownership_pct: 54 }, { email: 'b@x.test', shares: 4600000, ownership_pct: null }] };
  assert.equal(fullyDiluted(cap), 10000000);
  assert.equal(fullyDiluted({ available: false }), null);
  assert.equal(fullyDiluted({ available: true, holders: [] }), null, 'no holders is not a zero denominator');
  assert.deepEqual(equityOf({ email: 'A@x.test', equity_shares: 1 }, cap), { source: 'cap_table', pct: 54, shares: 5400000, kind: null });
  assert.equal(equityOf({ email: 'b@x.test' }, cap).pct, 46, 'shares over the fully-diluted total when the row has no pct');
  const rec = equityOf({ email: 'c@x.test', equity_shares: 240000, equity_kind: 'options' }, cap);
  assert.equal(rec.source, 'recorded');
  assert.equal(rec.pct, 2.4);
  assert.equal(equityOf({ email: 'c@x.test', equity_shares: 240000 }, { available: false }).pct, null, 'no denominator, no percentage');
  assert.equal(equityOf({ equity_kind: 'none' }, cap).source, 'none');
  assert.equal(equityOf({}, cap).source, 'unrecorded');
  assert.match(CODE, /recorded grant, not on the cap table/);
  assert.match(CODE, /'on the cap table'/);
});

test('people cost counts an unrecorded salary as unknown, locks when the field is withheld, and does not estimate payroll load', () => {
  const { peopleCost, poolArithmetic } = helpers();
  const served = [
    { status: 'active', person_type: 'employee', salary_cents: 14500000 },
    { status: 'active', person_type: 'contractor', salary_cents: 9600000 },
    { status: 'active', person_type: 'founder', salary_cents: 0 },
    { status: 'active', person_type: 'employee', salary_cents: null },
    { status: 'offer_out', person_type: 'employee', salary_cents: 13500000 },
  ];
  const c = peopleCost(served);
  assert.equal(c.locked, false);
  assert.equal(c.employees.monthlyCents, Math.round(14500000 / 12));
  assert.equal(c.contractors.monthlyCents, 800000);
  assert.equal(c.unknown, 1, 'the unrecorded salary is counted as unknown, not as zero');
  assert.equal(c.deferring, 1);
  assert.equal(c.totalMonthlyCents, Math.round(14500000 / 12) + 800000);
  assert.equal(peopleCost([{ status: 'active', person_type: 'employee' }]).locked, true, 'a withheld field locks the card');
  assert.doesNotMatch(CODE, /0\.11|\* 11 \/ 100/, 'the canvas’s 11% payroll load is a fixture, not estimated here');
  assert.match(CODE, /Payroll load &amp; benefits<\/dt><dd><Unrecorded/);
  const pa = poolArithmetic({ available: true, rows: [{ shares_authorized: 1000000, shares_available: 760000 }] }, [
    { equity_kind: 'options', equity_shares: 240000, status: 'active' },
    { equity_kind: 'options', equity_shares: 180000, status: 'offer_out' },
    { equity_kind: 'common', equity_shares: 5400000, status: 'active' },
  ]);
  assert.deepEqual([pa.granted, pa.committed, pa.authorized, pa.available], [240000, 180000, 1000000, 760000]);
  assert.equal(poolArithmetic({ available: false }, []).authorized, null);
  assert.match(CODE, /reserved for open roles: not recorded/);
  assert.match(CODE, /A top-up model is not drawn/);
});

// ---------------------------------------------------------------------------
// 3. Locked, not hidden.
// ---------------------------------------------------------------------------

test('an absent salary draws Locked in the drawer; a null one draws Not recorded', () => {
  const d = slice(CODE, 'function PersonDrawer(', 'function toForm(');
  assert.match(d, /const hasEconomics = Object\.prototype\.hasOwnProperty\.call\(p, 'salary_cents'\);/);
  assert.match(d, /\{!hasEconomics \? <Locked \/> : p\.salary_cents == null \? <Unrecorded>Not recorded<\/Unrecorded> : `\$\{centsToDollars\(p\.salary_cents\)\}\/yr`\}/);
  const { dollarsToCents, centsToDollars } = helpers();
  assert.equal(dollarsToCents('145,000'), 14500000);
  assert.equal(dollarsToCents(''), null, 'blank is not recorded');
  assert.equal(dollarsToCents('0'), 0, 'zero records a deferred salary');
  assert.equal(dollarsToCents('lots'), undefined, 'refused, never coerced');
  assert.equal(centsToDollars(14500000), '$145,000');
  assert.equal(centsToDollars(null), null);
});

// ---------------------------------------------------------------------------
// 4. Every source has a failed state.
// ---------------------------------------------------------------------------

test('each read renders its own failed state rather than an empty section', () => {
  assert.match(CODE, /data-testid="team-unreadable"/);
  assert.match(CODE, /<Unreadable what="The team record"[^>]*onRetry=\{reload\}/);
  assert.match(CODE, /jobs\.phase === 'failed' && <div className="px-4 py-3"><Unreadable what="Your roles"/);
  assert.match(CODE, /hours\.phase === 'failed' && <Unreadable what="The calendar"/);
  assert.match(CODE, /!data\.pool\?\.available \? \(\s*<Unreadable what="The option pool"/);
  assert.match(CODE, /!data\.cap_table\?\.available \? `\$\{data\.cap_table\?\.reason/);
  assert.match(CODE, /!cf\?\.available \? <Unrecorded reason=\{cf\?\.reason\}>/);
  const jc = slice(CODE, 'function JobsCount()', 'function RosterTab(');
  assert.match(jc, /jobs\.phase === 'failed'\) return <Unrecorded/, 'a failed roles read is not zero roles');
  assert.doesNotMatch(CODE, /\|\| 0\b|\?\? 0\b/, 'no absence coerced to zero');
  // Company scope: no company is an on-ramp, not an empty roster.
  assert.match(CODE, /Team is scoped to a company, and this account has no company membership yet\./);
});

test('the worker serves each composed source per source, and the client methods have mounted routes', () => {
  for (const m of ['getCompanyTeam', 'addCompanyPerson', 'updateCompanyPerson', 'saveCompanyCoverage', 'saveCompanyHeadcountPlan']) {
    assert.match(API, new RegExp(`\\b${m}:`), m);
  }
  assert.match(WORKER, /r\.get\('\/company\/:uid\/team'/);
  assert.match(WORKER, /r\.post\('\/company\/:uid\/team\/people'/);
  assert.match(WORKER, /r\.patch\('\/company\/:uid\/team\/people\/:pid'/);
  assert.match(WORKER, /r\.put\('\/company\/:uid\/team\/coverage'/);
  assert.match(WORKER, /r\.put\('\/company\/:uid\/team\/plan'/);
  const get = slice(WORKER, "r.get('/company/:uid/team'", "r.post('/company/:uid/team/people'");
  assert.match(get, /capTable = \{ available: false, reason:/);
  assert.match(get, /pool = \{ available: false, reason:/);
  assert.match(get, /cofounder = \{ available: false, reason:/);
  assert.match(get, /JOIN projects p ON p\.id = h\.project_id\s*WHERE p\.company_id = \? AND p\.deleted_at IS NULL/, 'holders by the company’s projects');
  assert.match(get, /JOIN user_company_links ucl ON ucl\.user_id = o\.user_id\s*WHERE ucl\.company_id = \?/, 'a member’s pool only');
  assert.match(get, /personDto\(p, editor \|\| Number\(p\.user_id\) === user\.id\)/, 'D431: the editor and the person');
  assert.match(WORKER, /if \(!\(await viewerIsMember\(c\.env, company\.id, user\)\)\) \{\s*return refuse\(c, 403, \{ code: 'not_a_member'/);
  assert.match(WORKER, /code: 'not_an_editor'/);
  // Migration 326 stands alone: additive, no transaction statements, cents.
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS company_people/);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS company_function_coverage/);
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS company_headcount_plan/);
  assert.match(MIGRATION, /salary_cents INTEGER/);
  assert.doesNotMatch(MIGRATION, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  assert.match(MIGRATION, /created_by INTEGER NOT NULL REFERENCES users\(id\)/, 'every row is signed');
});

// ---------------------------------------------------------------------------
// 5. The decision line is on screen.
// ---------------------------------------------------------------------------

test('the six owner decisions are drawn, Send document is not live, and the invite note issues nothing', () => {
  const dec = slice(CODE, 'export const OPEN_DECISIONS = [', 'function DecisionsPanel(');
  for (const what of ['Cap table of record', 'Option pool', 'Paperwork issuance', 'Payroll load', 'Talent leads', 'Advisory grants and the cap table']) {
    assert.match(dec, new RegExp(`\\['${what}'`), what);
  }
  assert.match(CODE, /<DecisionsPanel \/>/);
  assert.match(CODE, /Send document: not available from here\. No flow issues an offer, IP assignment or advisory agreement from the Team page/);
  assert.doesNotMatch(CODE, /onClick=\{[^}]*sendDocument/, 'no dead Send document control');
  const note = slice(CODE, 'data-testid="invite-note"', '</p>');
  assert.match(note, /No offer letter, IP assignment or option paperwork is issued from here/);
  assert.match(note, /No advisory agreement is issued from here, and the grant is not written to the cap table/);
  // Offboarding is two steps with the consequence, and a status write, never a delete.
  const d = slice(CODE, 'function PersonDrawer(', 'function toForm(');
  assert.match(d, /data-testid="offboard-confirm"/);
  assert.match(d, /api\.updateCompanyPerson\(company\.uid, p\.uid, \{ status: 'offboarded' \}\)/);
  assert.match(d, /onClick=\{\(\) => setOffboarding\(\(x\) => !x\)\}[^>]*data-testid="offboard"/, 'the Offboard button opens the confirmation');
  assert.equal((d.match(/onClick=\{offboard\}/g) || []).length, 1, 'the one write sits behind the confirmation');
  assert.match(slice(d, 'data-testid="offboard-confirm"', 'Keep them'), /onClick=\{offboard\}/);
  assert.doesNotMatch(CODE, /deleteCompanyPerson|removeCompanyPerson/);
  assert.match(d, /The record stays with today’s date as the offboarding date/);
  // The workspace invitation is the existing one, sent only when asked and only with an email.
  const inv = slice(CODE, 'function InviteDrawer(', 'export const OPEN_DECISIONS');
  assert.match(inv, /if \(sendInvite && payload\.email\) \{[\s\S]*?api\.inviteCompanyMember\(company\.uid, \{ email: payload\.email, role_in_company: 'Member' \}\)/);
  assert.match(inv, /is recorded, but the workspace invitation failed/, 'the two outcomes are reported apart');
  // Eadwyn's voice: nothing on this page is called advice or a recommendation.
  assert.doesNotMatch(PAGE, /recommend|advice|fiduciary/i);
});

test('the paperwork strip names the person and the document, and the roster CSV is the loaded roster', () => {
  const { paperworkGaps, rosterCsv, initialsOf } = helpers();
  const gaps = paperworkGaps([
    { name: 'Amara Osei', status: 'active', ip_assignment: 'signed', election_83b: 'not_filed' },
    { name: 'Rin Takahashi', status: 'active', ip_assignment: 'missing', election_83b: 'not_applicable' },
    { name: 'Gone Person', status: 'offboarded', ip_assignment: 'missing' },
    { name: 'Fine Person', status: 'active', ip_assignment: 'signed', election_83b: 'filed' },
  ]);
  assert.deepEqual(gaps.map((p) => p.name), ['Amara Osei', 'Rin Takahashi'], 'an offboarded person is not a live blocker');
  assert.match(CODE, /Both are diligence blockers\./);
  assert.match(CODE, /<Link to="\/trust" className="underline">Open Trust Center →<\/Link>/);
  const csv = rosterCsv([{ name: 'A, B', email: 'a@x.test', person_type: 'founder', equity_shares: 5 }]);
  assert.equal(csv.split('\n')[0], 'name,email,person_type,role_title,start_date,status,access_level,equity_shares,equity_kind,agreement_status,ip_assignment,election_83b');
  assert.equal(csv.split('\n')[1], '"A, B",a@x.test,founder,,,,,5,,,,');
  assert.equal(initialsOf('Novacraft Labs, Inc.'), 'NL');
  assert.equal(initialsOf(''), '?');
});
