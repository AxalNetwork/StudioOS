/**
 * D1245 (#3260, part 1 of #2385) — a partner-deal case seeds the checklist a
 * case opened from the desk seeds; a notice sends an admin to
 * `/admin/due-diligence/…` and everyone else to `/due-diligence/…`; and the
 * case read returns `allowed`, each flag true only where its route accepts
 * the call.
 *
 * Harness: the real router over SQLite built from the production baseline
 * plus migrations 339, 620, 302 and 623, a signed JWT per caller, and the
 * app's error mapping (as dd_case_lifecycle_d1246.test.ts).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_part1_d1245.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import dd, { caseAllowed, ddCaseBase } from '../src/routes/dd.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { seedNewCase, builtInTemplate, checklistFor } from '../src/services/dueDiligence.ts';

const SECRET = 'd1245-unit-test-secret-0123456789-abcdef';
const ADMIN = 1, LEAD = 2, REVIEWER = 3, OTHER = 4, ADVISOR = 5, INVESTOR = 6, OBSERVER = 7, OPENER = 8;
const CASE = 'case-d1245';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'user_sessions', 'projects', 'founders', 'deals', 'user_company_links', 'ic_decisions', 'ic_votes',
  'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

function world(subjectType = 'project') {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  db.exec(read('../sql/migrations/339_dd_section_signoff.sql'));
  db.exec(read('../sql/migrations/620_dd_case_lifecycle.sql'));
  db.exec(read('../sql/migrations/302_push_subscriptions.sql'));
  db.exec(read('../sql/migrations/623_dd_team_templates.sql'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, role] of [[ADMIN, 'admin'], [LEAD, 'partner'], [REVIEWER, 'partner'], [OTHER, 'partner'],
    [ADVISOR, 'advisor'], [INVESTOR, 'investor'], [OBSERVER, 'partner'], [OPENER, 'partner']] as const) {
    u.run(id, `synthetic${id}@example.test`, `Synthetic ${id}`, role);
  }
  db.exec(`INSERT INTO projects (id, name) VALUES (10, 'Company Alpha');`);
  // OPENER opened it; LEAD leads it.
  db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status)
              VALUES (?, ?, 10, 'Company Alpha', ?, ?, 'in_review')`).run(CASE, subjectType, OPENER, LEAD);
  db.exec(`INSERT INTO dd_sections (case_id, section_key, title, weight, blocking) VALUES (1, 'corporate_legal', 'Corporate & Legal Structure', 1.5, 1);
           INSERT INTO dd_sections (case_id, section_key, title, weight, blocking) VALUES (1, 'market_traction', 'Market & Traction', 1, 0);`);
  // REVIEWER works section 2, OBSERVER reads section 1, INVESTOR works section 1, ADVISOR works section 2.
  const r = db.prepare('INSERT INTO dd_reviewers (case_id, section_id, user_id, role) VALUES (1, ?, ?, ?)');
  r.run(2, REVIEWER, 'reviewer');
  r.run(1, OBSERVER, 'observer');
  r.run(1, INVESTOR, 'reviewer');
  r.run(2, ADVISOR, 'reviewer');
  // Every caller has a fresh TOTP session, so `report` meets its step-up and only its own gate decides.
  for (const id of [ADMIN, LEAD, REVIEWER, OTHER, ADVISOR, INVESTOR, OBSERVER, OPENER]) {
    db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', datetime('now'))`).run(id, `fresh-${id}`);
  }
  const files = new Map<string, Uint8Array>();
  const env: any = {
    DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    FILES: { put: async (k: string, v: any) => { files.set(k, v); }, get: async (k: string) => files.get(k) ? { arrayBuffer: async () => files.get(k) } : null },
  };
  return { db, env };
}

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  const status = (AUTH_ERROR_STATUSES as any)[msg] ?? (msg.startsWith('Forbidden') ? 403 : 500);
  if (status === 500) console.error('[test] unhandled:', err);
  return c.json({ detail: msg, code: msg }, status);
});
app.route('/api/dd', dd);

async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const role = w.db.prepare('SELECT role FROM users WHERE id = ?').get(who).role;
  const token = await new SignJWT({ user_id: who, role, jti: `fresh-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/* ------------------------------------------------------------------ */

/** D1245's seven flags; D1251's are held by their own test below. */
const CORE = ['scan', 'assign', 'verdict', 'requests', 'report', 'notify_founder', 'audit'] as const;
const core = (a: any) => Object.fromEntries(CORE.map((k) => [k, a[k]]));
const caseCore = (...args: Parameters<typeof caseAllowed>) => core(caseAllowed(...args));

test('caseAllowed: the matrix, role by role', () => {
  const cs = { id: 1, subject_type: 'project', owner_user_id: OPENER, lead_user_id: LEAD };
  const ids = [1, 2];
  const none: any[] = [];
  const admin = caseCore({ id: ADMIN, role: 'admin' }, cs, none, ids);
  assert.deepEqual(admin, { scan: true, assign: true, verdict: { 1: true, 2: true }, requests: true, report: true, notify_founder: true, audit: true });
  const lead = caseCore({ id: LEAD, role: 'partner' }, cs, none, ids);
  // Mutation checked: drop `lead` from verdict → the lead loses both sections.
  assert.deepEqual(lead, { scan: true, assign: true, verdict: { 1: true, 2: true }, requests: true, report: true, notify_founder: false, audit: true });
  // The opener keeps the writes the lead has, but not the lead's verdict on every section.
  const opener = caseCore({ id: OPENER, role: 'partner' }, cs, none, ids);
  assert.deepEqual(opener, { scan: true, assign: true, verdict: { 1: false, 2: false }, requests: true, report: true, notify_founder: false, audit: true });
  const reviewer = caseCore({ id: REVIEWER, role: 'partner' }, cs, [{ section_id: 2, role: 'reviewer' }], [2]);
  // Mutation checked: let a reviewer send requests → requests true.
  assert.deepEqual(reviewer, { scan: true, assign: true, verdict: { 2: true }, requests: false, report: true, notify_founder: false, audit: true });
  // Mutation checked: count an observer as a worker → verdict { 1: true }.
  const observer = caseAllowed({ id: OBSERVER, role: 'partner' }, cs, [{ section_id: 1, role: 'observer' }], [1]);
  assert.deepEqual(observer.verdict, { 1: false });
  assert.equal(observer.audit, true);
  // A reviewer who is not staff writes the verdict and reads the audit, never scans, assigns or reports.
  // Mutation checked: drop `(admin || partner)` → scan true for an investor.
  const investor = caseCore({ id: INVESTOR, role: 'investor' }, cs, [{ section_id: 1, role: 'reviewer' }], [1]);
  assert.deepEqual(investor, { scan: false, assign: false, verdict: { 1: true }, requests: false, report: false, notify_founder: false, audit: true });
  const advisor = caseCore({ id: ADVISOR, role: 'advisor' }, cs, [{ section_id: 2, role: 'reviewer' }], [2]);
  assert.deepEqual(advisor, { scan: false, assign: false, verdict: { 2: true }, requests: false, report: false, notify_founder: false, audit: true });
  const outsider = caseCore({ id: OTHER, role: 'partner' }, cs, none, ids);
  assert.deepEqual(outsider, { scan: false, assign: false, verdict: { 1: false, 2: false }, requests: false, report: false, notify_founder: false, audit: false });
  // Mutation checked: drop the subject check → notify_founder true on a partner case.
  assert.equal(caseAllowed({ id: ADMIN, role: 'admin' }, { ...cs, subject_type: 'partner' }, none, ids).notify_founder, false);
  assert.equal(caseAllowed({ id: ADMIN, role: 'admin' }, { ...cs, subject_type: 'founder' }, none, ids).notify_founder, true);
});

test('caseAllowed (D1251): the decision, the memo, scope, the team and work, role by role and on an archived case', () => {
  const cs = { id: 1, subject_type: 'project', owner_user_id: OPENER, lead_user_id: LEAD, status: 'in_review' };
  const none: any[] = [];
  const pick = (a: any) => ({ decide: a.decide, update: a.update, memo_read: a.memo_read, widen: a.widen, team: a.team, work: a.work, work_case_wide: a.work_case_wide });
  assert.deepEqual(pick(caseAllowed({ id: ADMIN, role: 'admin' }, cs, none, [1, 2])),
    { decide: true, update: true, memo_read: true, widen: true, team: true, work: { 1: true, 2: true }, work_case_wide: true });
  assert.deepEqual(pick(caseAllowed({ id: LEAD, role: 'partner' }, cs, none, [1, 2])),
    { decide: true, update: true, memo_read: true, widen: true, team: true, work: { 1: true, 2: true }, work_case_wide: true });
  // Mutation checked: let the opener decide → decide true. The opener keeps the team, the memo and the work.
  assert.deepEqual(pick(caseAllowed({ id: OPENER, role: 'partner' }, cs, none, [1, 2])),
    { decide: false, update: false, memo_read: true, widen: false, team: true, work: { 1: true, 2: true }, work_case_wide: true });
  // Mutation checked: count an observer as a worker → work { 1: true }.
  assert.deepEqual(caseAllowed({ id: OBSERVER, role: 'partner' }, cs, [{ section_id: 1, role: 'observer' }], [1]).work, { 1: false });
  assert.deepEqual(pick(caseAllowed({ id: REVIEWER, role: 'partner' }, cs, [{ section_id: 2, role: 'reviewer' }], [2])),
    { decide: false, update: false, memo_read: false, widen: false, team: false, work: { 2: true }, work_case_wide: false });
  // Mutation checked: drop the archived check → an archived case is decided again.
  const archived = caseAllowed({ id: ADMIN, role: 'admin' }, { ...cs, status: 'archived' }, none, [1]);
  assert.deepEqual([archived.decide, archived.update, archived.widen, archived.team], [false, false, false, false]);
  // Mutation checked: let a decided case widen → widen true on a completed case.
  assert.equal(caseAllowed({ id: LEAD, role: 'partner' }, { ...cs, status: 'completed' }, none, [1]).widen, false);
  assert.equal(caseAllowed({ id: LEAD, role: 'partner' }, { ...cs, status: 'completed' }, none, [1]).decide, true, 'a decided case can be decided again');
});

test('allowed on an archived case (D1251): nothing is decided, widened or changed, and each route agrees', async () => {
  const w = world();
  w.db.exec(`UPDATE dd_cases SET status = 'archived'`);
  const got = await call(w, ADMIN, 'GET', `/cases/${CASE}`);
  for (const flag of ['decide', 'update', 'widen', 'team']) {
    assert.equal(got.body.allowed[flag], false, flag);
    const probe = PROBES.find(([n]) => n === flag)![1];
    const w2 = world();
    w2.db.exec(`UPDATE dd_cases SET status = 'archived'`);
    assert.equal((await probe(w2, ADMIN)).status, 409, `${flag}'s route refuses an archived case`);
  }
});

test('ddCaseBase: an admin opens the admin base, every other role the member base', () => {
  // Mutation checked: return the admin base for every role → partner and investor fail.
  assert.equal(ddCaseBase('admin'), '/admin/due-diligence');
  for (const role of ['partner', 'investor', 'advisor', null, undefined]) assert.equal(ddCaseBase(role), '/due-diligence');
});

// The probe for each flag: a call whose only refusal is the flag's own gate.
// The bodies are chosen to stop before any side effect a later probe could
// see, and each probe runs in a fresh world.
const PROBES: Array<[string, (w: any, who: number) => Promise<{ status: number }>]> = [
  ['scan', (w, who) => call(w, who, 'POST', `/cases/${CASE}/scan`, { connectors: ['__no_such_connector__'] })],
  ['assign', (w, who) => call(w, who, 'POST', `/cases/${CASE}/sections/2/assign`, {})],
  ['requests', (w, who) => call(w, who, 'POST', `/cases/${CASE}/requests`, {})],
  ['report', (w, who) => call(w, who, 'POST', `/cases/${CASE}/report`, {})],
  ['notify_founder', (w, who) => call(w, who, 'POST', `/cases/${CASE}/report/share`, {})],
  ['audit', (w, who) => call(w, who, 'GET', `/cases/${CASE}/audit`)],
  // D1251 (#3266): the writes the case's tabs draw. An empty body stops each at its own check after the gate.
  ['decide', (w, who) => call(w, who, 'POST', `/cases/${CASE}/decision`, {})],
  ['update', (w, who) => call(w, who, 'PATCH', `/cases/${CASE}`, {})],
  ['memo_read', (w, who) => call(w, who, 'GET', `/cases/${CASE}/memo`)],
  ['widen', (w, who) => call(w, who, 'POST', `/cases/${CASE}/widen`, {})],
  ['team', (w, who) => call(w, who, 'DELETE', `/cases/${CASE}/sections/1/reviewers/999`)],
  ['work_case_wide', (w, who) => {
    w.db.exec(`INSERT INTO dd_findings (id, case_id, section_id, source_kind, severity, title) VALUES (90, 1, NULL, 'manual', 'low', 'Case-wide')`);
    return call(w, who, 'PATCH', `/cases/${CASE}/findings/90`, { state: 'in_progress' });
  }],
];
/** A route refuses its gate with 403, and an archived or decided case with 409 where the flag says so. */
const refusedBy = (flag: string, status: number) => status === 403 || ((flag === 'decide' || flag === 'update' || flag === 'widen' || flag === 'team') && status === 409);

for (const [name, who] of [['admin', ADMIN], ['lead', LEAD], ['opener', OPENER], ['reviewer', REVIEWER], ['observer', OBSERVER],
  ['investor reviewer', INVESTOR], ['advisor reviewer', ADVISOR]] as const) {
  test(`allowed matches each route's own gate: ${name}`, async () => {
    const got = await call(world(), who, 'GET', `/cases/${CASE}`);
    assert.equal(got.status, 200, JSON.stringify(got.body));
    const allowed = got.body.allowed;
    assert.ok(allowed, 'the case read returns allowed');
    for (const [flag, probe] of PROBES) {
      const r = await probe(world(), who);
      // A refusal is 403; the report/share route answers 400 when the subject has no founder.
      const accepted = flag === 'notify_founder' ? r.status !== 403 && r.status !== 400 : !refusedBy(flag, r.status);
      assert.equal(allowed[flag], accepted, `${name} ${flag}: allowed ${allowed[flag]}, route ${r.status}`);
    }
    for (const sid of Object.keys(allowed.verdict)) {
      // n_a needs no NDA, so the route's refusal is the gate alone.
      const r = await call(world(), who, 'POST', `/cases/${CASE}/sections/${sid}/verdict`, { verdict: 'n_a' });
      assert.equal(allowed.verdict[sid], r.status !== 403, `${name} verdict ${sid}: allowed ${allowed.verdict[sid]}, route ${r.status}`);
    }
    // D1251: `work` per section is the checklist item's own gate, and a flag's in that section.
    assert.deepEqual(Object.keys(allowed.work).sort(), Object.keys(allowed.verdict).sort(), 'work names the sections the reader sees');
    for (const sid of Object.keys(allowed.work)) {
      const w = world();
      w.db.prepare(`INSERT INTO dd_checklist_items (id, case_id, section_id, item_key, title, depth, status) VALUES (?, 1, ?, ?, 'An item', 'lite', 'pending')`).run(70 + Number(sid), Number(sid), `k${sid}`);
      const item = await call(w, who, 'PATCH', `/cases/${CASE}/items/${70 + Number(sid)}`, { status: 'pending' });
      assert.equal(allowed.work[sid], item.status !== 403, `${name} item in ${sid}: allowed ${allowed.work[sid]}, route ${item.status}`);
      w.db.exec(`INSERT INTO dd_findings (id, case_id, section_id, source_kind, severity, title) VALUES (${80 + Number(sid)}, 1, ${Number(sid)}, 'manual', 'low', 'A flag')`);
      const flag = await call(w, who, 'PATCH', `/cases/${CASE}/findings/${80 + Number(sid)}`, { state: 'in_progress' });
      assert.equal(allowed.work[sid], flag.status !== 403, `${name} flag in ${sid}: allowed ${allowed.work[sid]}, route ${flag.status}`);
    }
  });
}

test('allowed on a partner case: the admin may not notify a founder, and the route agrees', async () => {
  const got = await call(world('partner'), ADMIN, 'GET', `/cases/${CASE}`);
  assert.equal(got.body.allowed.notify_founder, false);
  const r = await call(world('partner'), ADMIN, 'POST', `/cases/${CASE}/report/share`, {});
  assert.equal(r.status, 400);
});

test('the case read names the lead and who decided (D1251), and never an email', async () => {
  const w = world();
  w.db.exec(`UPDATE dd_cases SET decision = 'proceed', decided_by = ${ADMIN}`);
  const got = await call(w, OPENER, 'GET', `/cases/${CASE}`);
  assert.equal(got.body.case.lead_name, `Synthetic ${LEAD}`);
  assert.equal(got.body.case.decided_by_name, `Synthetic ${ADMIN}`);
  assert.ok(!JSON.stringify([got.body.case.lead_name, got.body.case.decided_by_name]).includes('@'));
  const none = world();
  assert.equal((await call(none, OPENER, 'GET', `/cases/${CASE}`)).body.case.decided_by_name, null, 'no decision, no name');
});

test('an outsider and an advisor with no row never reach allowed: the case read refuses them', async () => {
  assert.equal((await call(world(), OTHER, 'GET', `/cases/${CASE}`)).status, 403);
  const w = world();
  w.db.prepare('DELETE FROM dd_reviewers WHERE user_id = ?').run(ADVISOR);
  assert.equal((await call(w, ADVISOR, 'GET', `/cases/${CASE}`)).status, 403);
});

/* ------------------------------------------------------------------ */

const link = (w: any, user: number, type: string) =>
  (w.db.prepare('SELECT link FROM notifications_inbox WHERE user_id = ? AND type = ? ORDER BY id DESC').get(user, type) as any)?.link;

test('the verdict notice opens the member base for a partner opener, the admin base for an admin', async () => {
  const w = world();
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/sections/2/verdict`, { verdict: 'n_a' })).status, 200);
  // Mutation checked: link `/admin/due-diligence/…` for every role → this reads the admin base.
  assert.equal(link(w, OPENER, 'dd_section_completed'), `/due-diligence/${CASE}`);
  const w2 = world();
  w2.db.prepare('UPDATE dd_cases SET owner_user_id = ?').run(ADMIN);
  assert.equal((await call(w2, LEAD, 'POST', `/cases/${CASE}/sections/2/verdict`, { verdict: 'n_a' })).status, 200);
  // Mutation checked: link the member base for every role → this reads `/due-diligence/…`.
  assert.equal(link(w2, ADMIN, 'dd_section_completed'), `/admin/due-diligence/${CASE}`);
});

test('an investor\'s invitation link opens the member base', async () => {
  const w = world();
  const r = await call(w, LEAD, 'POST', `/cases/${CASE}/sections/2/assign`, { user_id: INVESTOR });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = String(link(w, INVESTOR, 'dd_section_assigned') ?? '');
  // Mutation checked: keep `/admin/due-diligence` in the magic link → this fails.
  assert.match(got, new RegExp(`^https://[^/]+/due-diligence/${CASE}\\?section=2&inv=`), got);
});

test('a lead handed the case is told at the member base; an admin lead at the admin base', async () => {
  const w = world();
  assert.equal((await call(w, LEAD, 'PATCH', `/cases/${CASE}`, { lead_user_id: REVIEWER })).status, 200);
  assert.equal(link(w, REVIEWER, 'dd_case_lead'), `/due-diligence/${CASE}`);
  const w2 = world();
  assert.equal((await call(w2, LEAD, 'PATCH', `/cases/${CASE}`, { lead_user_id: ADMIN })).status, 200);
  assert.equal(link(w2, ADMIN, 'dd_case_lead'), `/admin/due-diligence/${CASE}`);
});

/* ------------------------------------------------------------------ */

function partnerCase(w: any) {
  return Number((w.db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id)
    VALUES ('case-partner', 'partner', 99, 'Partner Org', ?) RETURNING id`).get(LEAD) as any).id);
}
const itemsBySection = (w: any, caseId: number) => Object.fromEntries((w.db.prepare(
  `SELECT s.section_key AS k, COUNT(i.id) AS n FROM dd_sections s LEFT JOIN dd_checklist_items i ON i.section_id = s.id
    WHERE s.case_id = ? GROUP BY s.id`).all(caseId) as any[]).map((r) => [r.k, Number(r.n)]));

test('a non-capital partner-deal case seeds its checklist; KYC and Accreditation are n/a with no items', async () => {
  const w = world();
  const caseId = partnerCase(w);
  const seeded = await seedNewCase(w.env, caseId, 'partner', 'standard', { notApplicable: new Set(['kyc_individual', 'accreditation']) });
  const by = itemsBySection(w, caseId);
  const want = checklistFor('partner', 'standard');
  // Mutation checked: skip the checklist (the old partner opener) → every count is 0.
  assert.ok(by.corporate_legal > 0 && by.compliance_aml > 0, JSON.stringify(by));
  // Mutation checked: seed items in n/a sections → kyc_individual > 0.
  assert.equal(by.kyc_individual, 0);
  assert.equal(by.accreditation, 0);
  assert.equal(seeded.items, want.filter((i) => i.section_key !== 'kyc_individual' && i.section_key !== 'accreditation').length);
  const na = w.db.prepare(`SELECT section_key, status, verdict FROM dd_sections WHERE case_id = ? AND verdict = 'n_a' ORDER BY section_key`).all(caseId) as any[];
  assert.deepEqual(na.map((s) => [s.section_key, s.status]), [['accreditation', 'completed'], ['kyc_individual', 'completed']]);
  // stampNewCase ran: the opener leads it, and the blocking sections are marked.
  const row = w.db.prepare('SELECT lead_user_id FROM dd_cases WHERE id = ?').get(caseId) as any;
  assert.equal(row.lead_user_id, LEAD);
  assert.ok(Number((w.db.prepare(`SELECT COUNT(*) AS n FROM dd_sections WHERE case_id = ? AND blocking = 1`).get(caseId) as any).n) > 0);
});

test('a capital partner-deal case seeds items in KYC; a saved template is recorded on the case', async () => {
  const w = world();
  w.db.prepare(`INSERT INTO dd_templates (uid, depth, version, body_json, created_by) VALUES ('t1', 'standard', 3, ?, ?)`)
    .run(JSON.stringify(builtInTemplate('standard')), ADMIN);
  const caseId = partnerCase(w);
  const seeded = await seedNewCase(w.env, caseId, 'partner', 'standard');
  assert.equal(seeded.templateVersion, 3);
  assert.ok(itemsBySection(w, caseId).kyc_individual > 0);
  // Mutation checked: drop the template_id write → null.
  assert.equal((w.db.prepare('SELECT template_id FROM dd_cases WHERE id = ?').get(caseId) as any).template_id, 1);
});

test('the partner-deal opener calls the shared seed, not its own section loop', () => {
  const src = read('../src/services/partnerDeals.ts');
  // Mutation checked: restore the old loop → no seedNewCase call.
  assert.match(src, /seedNewCase\(env, Number\(ddIns\.id\), 'partner', 'standard'/);
  assert.doesNotMatch(src, /INSERT INTO dd_sections/);
});
