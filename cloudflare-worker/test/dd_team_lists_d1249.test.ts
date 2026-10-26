/**
 * D1249 (#3264, part 5 of #2385) — Due diligence's list and overview reads,
 * My reviews, the subject and people searches, the team (observer,
 * conflicts, invitation expiry, remove), HQ's versioned templates with widen,
 * and the case read's platform checks.
 *
 * Harness: the real router over SQLite built from the production baseline plus
 * migrations 339, 620 and 623, a signed JWT per caller, and the app's error mapping.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_team_lists_d1249.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { builtInTemplate, checkTemplateBody, SECTION_CATALOG } from '../src/services/dueDiligence.ts';

const SECRET = 'd1249-unit-test-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, LEAD = 3, REVIEWER = 4, OBSERVER = 5, INVESTOR = 6, ADVISOR = 7, FOUNDER = 8;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'super_admins', 'projects', 'founders', 'deals', 'deal_invitations', 'commitments', 'user_company_links', 'partner_profiles',
  'ic_decisions', 'ic_votes', 'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

function world() {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  for (const m of ['339_dd_section_signoff', '620_dd_case_lifecycle', '623_dd_team_templates', '302_push_subscriptions']) db.exec(read(`../sql/migrations/${m}.sql`));
  db.exec(`ALTER TABLE partner_profiles ADD COLUMN ref TEXT; ALTER TABLE partner_profiles ADD COLUMN reviewed_at TEXT;
           CREATE TABLE company_kyb_records (id INTEGER PRIMARY KEY, uid TEXT, company_id INTEGER, started_by_user_id INTEGER, status TEXT, updated_at TEXT);`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active, kyc_status, kyc_reviewed_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  for (const [id, role, name, kyc] of [[SUPER, 'admin', 'Sam Super', null], [ADMIN, 'admin', 'Ada Admin', null], [LEAD, 'partner', 'Lee Lead', null],
    [REVIEWER, 'partner', 'Rae Reviewer', null], [OBSERVER, 'advisor', 'Obi Observer', null], [INVESTOR, 'investor', 'Ivy Investor', null],
    [ADVISOR, 'advisor', 'Avi Advisor', null], [FOUNDER, 'founder', 'Fay Founder', 'approved']] as const) {
    u.run(id, `synthetic${id}@example.test`, name, role, kyc ?? 'not_started', kyc ? '2026-10-03 10:00:00' : null);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO founders (id, name, email) VALUES (80, 'Fay Founder', 'synthetic8@example.test');
    INSERT INTO projects (id, name, founder_id) VALUES (10, 'Company Alpha', 80), (11, 'Company Beta', NULL), (12, 'Company Gamma', NULL);
    INSERT INTO deals (id, project_id, status) VALUES (100, 10, 'active'), (101, 11, 'active');
    INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (100, ${INVESTOR}, 'invited');`);
  // Three cases: Alpha in review with a High open flag, Beta open with a past target date, Gamma decided.
  const c = db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status, created_at, updated_at,
    target_ic_date, decision, decided_at, template_depth) VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  c.run('case-alpha', 10, 'Company Alpha', LEAD, LEAD, 'in_review', '2026-10-20 09:00:00', '2026-10-25 09:00:00', '2026-11-14', null, null, 'standard');
  c.run('case-beta', 11, 'Company Beta', LEAD, LEAD, 'open', '2026-09-01 09:00:00', '2026-09-02 09:00:00', '2026-10-01', null, null, 'lite');
  // Gamma was decided five days ago, whatever today is, so the 90-day window and the month never drift.
  const decidedAt = (db.prepare("SELECT datetime('now', '-5 days') AS t").get() as any).t;
  c.run('case-gamma', 12, 'Company Gamma', ADMIN, ADMIN, 'completed', '2026-08-01 09:00:00', decidedAt, null, 'proceed', decidedAt, 'standard');
  db.exec(`INSERT INTO dd_sections (case_id, section_key, title, weight, blocking) VALUES (1, 'corporate_legal', 'Corporate & Legal Structure', 1.5, 1),
             (1, 'market_traction', 'Market & Traction', 1, 0), (2, 'corporate_legal', 'Corporate & Legal Structure', 1.5, 1);
           INSERT INTO dd_findings (case_id, section_id, source_kind, severity, title) VALUES (1, 1, 'manual', 'high', 'Synthetic');
           INSERT INTO dd_checklist_items (case_id, section_id, item_key, title, depth, status) VALUES
             (1, 1, 'corporate_legal.cap_table_current', 'Cap table', 'lite', 'pass'), (1, 2, 'market_traction.x', 'X', 'lite', 'pending'),
             (2, 3, 'corporate_legal.cap_table_current', 'Cap table', 'lite', 'pending');
           INSERT INTO dd_requests (case_id, title, state, created_by_user_id) VALUES (1, 'Send the cap table', 'requested', ${LEAD});`);
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id, role, magic_link_jti, expires_at) VALUES (1, 2, ?, 'reviewer', 'jti-ok', datetime('now', '+5 days'))`).run(REVIEWER);
  db.prepare(`INSERT INTO dd_reviewers (case_id, section_id, user_id, role, magic_link_jti, expires_at) VALUES (1, 1, ?, 'observer', 'jti-old', datetime('now', '-1 day'))`).run(OBSERVER);
  const env: any = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  return { db, env };
}

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  const status = (AUTH_ERROR_STATUSES as any)[msg] ?? (msg.startsWith('Forbidden') || /required/.test(msg) ? 403 : 500);
  if (status === 500) console.error('[test] unhandled:', err);
  return c.json({ detail: msg }, status);
});
app.route('/api/dd', dd);

async function call(w: any, who: number, method: string, path: string, body?: unknown) {
  const role = w.db.prepare('SELECT role FROM users WHERE id = ?').get(who).role;
  const token = await new SignJWT({ user_id: who, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const uids = (r: any) => r.body.items.map((x: any) => x.uid);

/* ------------------------------------------------------------------ */

test('the list: server-side search, filters, sort and pages, with stable totals and each row\'s counts', async () => {
  const w = world();
  const all = await call(w, ADMIN, 'GET', '/cases');
  assert.equal(all.status, 200);
  assert.deepEqual([all.body.total, uids(all)], [3, ['case-alpha', 'case-beta', 'case-gamma']], 'newest first, as before');
  const alpha = all.body.items[0];
  // Mutation checked: count pending items as worked → checklist_worked 2.
  assert.deepEqual([alpha.stage, alpha.checklist_total, alpha.checklist_worked, alpha.open_flags, alpha.worst_severity, alpha.requests_waiting, alpha.lead_name],
    ['in_review', 2, 1, 1, 'high', 1, 'Lee Lead']);
  // Mutation checked: page the count with the rows → total 1 on page 2.
  const p1 = await call(w, ADMIN, 'GET', '/cases?page_size=2&page=1');
  const p2 = await call(w, ADMIN, 'GET', '/cases?page_size=2&page=2');
  assert.deepEqual([p1.body.total, p2.body.total, uids(p1), uids(p2)], [3, 3, ['case-alpha', 'case-beta'], ['case-gamma']]);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?q=beta')), ['case-beta']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?q=case-g')), ['case-gamma'], 'the case id searches too');
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?q=%25')), [], 'a % is a character, not a wildcard');
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?stage=decided')), ['case-gamma']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?stage=not_started')), ['case-beta']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?past_target=1')), ['case-beta']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', `/cases?lead=${ADMIN}`)), ['case-gamma']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?template=lite')), ['case-beta']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?decision=none')), ['case-alpha', 'case-beta']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?risk_band=none')).length, 3, 'nothing is scored yet');
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?sort=name')), ['case-alpha', 'case-beta', 'case-gamma']);
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?sort=target')), ['case-beta', 'case-alpha', 'case-gamma'], 'no target sorts last');
  assert.deepEqual(uids(await call(w, ADMIN, 'GET', '/cases?sort=flags')).slice(0, 1), ['case-alpha']);
  // Scope: a reviewer lists only the case they review; a stranger lists nothing.
  // Mutation checked: drop the scope binds' `everyone` → the reviewer lists all three.
  assert.deepEqual(uids(await call(w, REVIEWER, 'GET', '/cases')), ['case-alpha']);
  assert.deepEqual((await call(w, INVESTOR, 'GET', '/cases')).body.total, 0);
});

test('the overview: stages, open High flags, requests waiting, ages by target date, and decisions by month', async () => {
  const w = world();
  const r = await call(w, ADMIN, 'GET', '/overview');
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.body.stages, available: undefined }, { available: undefined, not_started: 1, in_review: 1, ready: 0, decided_90_days: 1, decided: 1, archived: 0, open: 2 });
  assert.deepEqual([r.body.severe_flags.open, r.body.severe_flags.cases], [1, 1]);
  assert.equal(r.body.requests.waiting, 1);
  // Mutation checked: count past-due as zero → past_due 0 on a store with no due dates.
  assert.equal(r.body.requests.past_due, null, 'no due date is stored, so none is past due');
  const ages = r.body.ages.buckets;
  assert.equal(ages.reduce((a: number, b: any) => a + b.before_target + b.past_target + b.no_target, 0), 2);
  assert.ok(ages.some((b: any) => b.past_target === 1), 'Beta is past its target');
  // Decisions are recorded from the first one; earlier months say so.
  const first = String((w.db.prepare("SELECT decided_at FROM dd_cases WHERE uid = 'case-gamma'").get() as any).decided_at).slice(0, 7);
  assert.equal(r.body.decisions.recorded_from, first);
  const months = r.body.decisions.months;
  assert.equal(months.length, 12);
  assert.equal(months.find((m: any) => m.month === first).proceed, 1);
  // Mutation checked: mark every month recorded → the months before the first decision read zero.
  assert.ok(months.filter((m: any) => m.month < first).every((m: any) => m.recorded === false && m.proceed === undefined), 'never a zero before decisions were recorded');
  // The same scope as the list.
  assert.equal((await call(w, REVIEWER, 'GET', '/overview')).body.stages.open, 1);
  // A failed read is a 503, never an empty desk.
  const broken = world(); broken.db.exec('DROP TABLE dd_requests');
  assert.equal((await call(broken, ADMIN, 'GET', '/overview')).status, 503);
});

test('My reviews: the sections I am invited to, with what is pending and whether the link has expired', async () => {
  const w = world();
  const mine = await call(w, REVIEWER, 'GET', '/my-reviews');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.items.map((x: any) => [x.case_uid, x.section_title, x.role, x.items_pending, x.invite_expired]),
    [['case-alpha', 'Market & Traction', 'reviewer', 1, false]]);
  assert.equal((await call(w, OBSERVER, 'GET', '/my-reviews')).body.items[0].invite_expired, true);
  assert.deepEqual((await call(w, LEAD, 'GET', '/my-reviews')).body.items, []);
});

test('the subject search: by name; an investor sees only startups they share a deal with; an advisor opens none', async () => {
  const w = world();
  assert.deepEqual((await call(w, ADMIN, 'GET', '/subjects?type=project&q=Company')).body.items.map((x: any) => x.name), ['Company Alpha', 'Company Beta', 'Company Gamma']);
  // Mutation checked: drop the deal predicate → the investor lists all three startups.
  assert.deepEqual((await call(w, INVESTOR, 'GET', '/subjects?type=project&q=')).body.items.map((x: any) => x.name), ['Company Alpha']);
  assert.equal((await call(w, INVESTOR, 'GET', '/subjects?type=founder&q=')).status, 403);
  assert.equal((await call(w, ADVISOR, 'GET', '/subjects?type=project&q=')).status, 403);
  assert.deepEqual((await call(w, LEAD, 'GET', '/subjects?type=founder&q=fay')).body.items, [{ id: FOUNDER, name: 'Fay Founder', type: 'founder' }]);
  assert.equal((await call(w, LEAD, 'GET', '/subjects?type=nobody')).status, 400);
});

test('the people search: by name, paged, an email for an Admin only; never a founder', async () => {
  const w = world();
  const partner = await call(w, LEAD, 'GET', '/people?q=e');
  assert.equal(partner.status, 200);
  // Mutation checked: return rows as read → a partner reads emails.
  assert.ok(partner.body.items.length > 0 && partner.body.items.every((x: any) => !('email' in x)), 'no email for a partner');
  assert.ok(!partner.body.items.some((x: any) => x.role === 'founder'));
  const admin = await call(w, ADMIN, 'GET', '/people?q=Rae');
  assert.equal(admin.body.items[0].email, 'synthetic4@example.test');
  assert.equal(admin.body.total, 1);
  assert.equal((await call(w, INVESTOR, 'GET', '/people?q=a')).status, 403);
  assert.ok((await call(w, LEAD, 'GET', '/experts')).body.eligible.every((x: any) => !('email' in x)), 'the experts list carries no email for a partner');
});

test('the team: an expired invitation is refused, an observer never works the section, conflicts are declared, and someone is removed', async () => {
  const w = world();
  // Mutation checked: drop the expiry check → the old link is accepted.
  const old = await call(w, OBSERVER, 'POST', '/cases/case-alpha/reviewer-invite/jti-old');
  assert.equal(old.status, 410);
  assert.equal(old.body.code, 'invite_expired');
  assert.equal((await call(w, REVIEWER, 'POST', '/cases/case-alpha/reviewer-invite/jti-ok')).status, 200);
  // Resending (assigning again) starts a fresh 14 days.
  const resend = await call(w, LEAD, 'POST', '/cases/case-alpha/sections/1/assign', { user_id: OBSERVER, role: 'observer' });
  assert.equal(resend.status, 200, JSON.stringify(resend.body));
  const row = w.db.prepare(`SELECT role, julianday(expires_at) - julianday('now') AS days FROM dd_reviewers WHERE user_id = ?`).get(OBSERVER) as any;
  assert.equal(row.role, 'observer');
  assert.ok(row.days > 13.9 && row.days <= 14, 'fourteen days');
  assert.equal((w.db.prepare('SELECT assignee_user_id FROM dd_sections WHERE id = 1').get() as any).assignee_user_id, null, 'an observer is not the assignee');
  // Mutation checked: drop the observer check → the observer's verdict is recorded.
  assert.equal((await call(w, OBSERVER, 'POST', '/cases/case-alpha/sections/1/verdict', { verdict: 'n_a' })).status, 403);
  assert.equal((await call(w, LEAD, 'POST', '/cases/case-alpha/sections/1/assign', { user_id: OBSERVER, role: 'boss' })).status, 400);
  // Conflicts: the reviewer answers for themself; a declaration needs words, is encrypted, and the lead reads it.
  assert.equal((await call(w, REVIEWER, 'POST', '/cases/case-alpha/sections/2/conflicts', { declared: true })).status, 400);
  assert.equal((await call(w, LEAD, 'POST', '/cases/case-alpha/sections/2/conflicts', { declared: false })).status, 403);
  assert.equal((await call(w, REVIEWER, 'POST', '/cases/case-alpha/sections/2/conflicts', { declared: true, note: 'I advised a competitor in 2025.' })).status, 200);
  const raw = w.db.prepare('SELECT conflicts, conflicts_note_enc FROM dd_reviewers WHERE user_id = ?').get(REVIEWER) as any;
  assert.equal(raw.conflicts, 'declared');
  assert.ok(raw.conflicts_note_enc && !String(raw.conflicts_note_enc).includes('competitor'));
  const team = (await call(w, LEAD, 'GET', '/cases/case-alpha')).body.reviewers.find((r: any) => r.user_id === REVIEWER);
  assert.deepEqual([team.conflicts, team.conflicts_note, team.conflicts_note_enc], ['declared', 'I advised a competitor in 2025.', undefined]);
  // Remove: the lead or an Admin; a reviewer cannot.
  assert.equal((await call(w, REVIEWER, 'DELETE', `/cases/case-alpha/sections/1/reviewers/${OBSERVER}`)).status, 403);
  assert.equal((await call(w, LEAD, 'DELETE', `/cases/case-alpha/sections/1/reviewers/${OBSERVER}`)).status, 200);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM dd_reviewers WHERE user_id = ?').get(OBSERVER).n, 0);
  assert.equal((await call(w, OBSERVER, 'GET', '/cases/case-alpha')).status, 403, 'removed, they read the case no more');
  assert.ok(w.db.prepare(`SELECT 1 FROM dd_audit_log WHERE action = 'reviewer_removed'`).get());
});

test('templates: an Admin cannot write one; a Super Admin saves a new version; a case keeps its version; scope only widens', async () => {
  const w = world();
  const t = await call(w, ADMIN, 'GET', '/templates');
  assert.equal(t.status, 200);
  assert.equal(t.body.can_edit, false);
  assert.deepEqual(t.body.templates.map((x: any) => [x.depth, x.current.version]), [['lite', 0], ['standard', 0], ['deep', 0]]);
  const body = builtInTemplate('standard');
  body.sections.find((s) => s.key === 'market_traction')!.blocking = true;
  body.sections.find((s) => s.key === 'corporate_legal')!.weight = 2;
  body.sections.find((s) => s.key === 'compliance_aml')!.blocking = false;
  // Mutation checked: gate with requireAdmin → the Admin saves a version.
  assert.equal((await call(w, ADMIN, 'POST', '/templates', { depth: 'standard', ...body })).status, 403);
  const saved = await call(w, SUPER, 'POST', '/templates', { depth: 'standard', ...body });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.template.version, 1);
  assert.equal((await call(w, SUPER, 'GET', '/templates')).body.can_edit, true);
  // A new case opens on v1: its weights and blocking come from the template.
  const opened = await call(w, LEAD, 'POST', '/cases', { subject_type: 'project', subject_id: 12, subject_label: 'Company Gamma II' });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  assert.equal(opened.body.template_version, 1);
  const secs = w.db.prepare('SELECT section_key, weight, blocking FROM dd_sections WHERE case_id = ? ORDER BY id').all(opened.body.id) as any[];
  assert.equal(secs.find((s) => s.section_key === 'market_traction').blocking, 1);
  assert.equal(secs.find((s) => s.section_key === 'corporate_legal').weight, 2);
  // Mutation checked: let the catalog's list stamp a template case too → Compliance / AML blocks again.
  assert.equal(secs.find((s) => s.section_key === 'compliance_aml').blocking, 0, 'the template unblocked it');
  // A second version does not move the case already open.
  body.sections.find((s) => s.key === 'corporate_legal')!.weight = 3;
  assert.equal((await call(w, SUPER, 'POST', '/templates', { depth: 'standard', ...body })).body.template.version, 2);
  const tid = (w.db.prepare('SELECT template_id FROM dd_cases WHERE id = ?').get(opened.body.id) as any).template_id;
  assert.equal((w.db.prepare('SELECT version FROM dd_templates WHERE id = ?').get(tid) as any).version, 1, 'the case keeps v1');
  // A bad body is refused in words.
  assert.match((await call(w, SUPER, 'POST', '/templates', { depth: 'standard', sections: [] })).body.error, /every section/);
  // Widen: Standard → Deep adds the deeper items; never narrower; the lead or an Admin.
  const before = w.db.prepare('SELECT COUNT(*) AS n FROM dd_checklist_items WHERE case_id = ?').get(opened.body.id).n;
  assert.equal((await call(w, LEAD, 'POST', `/cases/${opened.body.uid}/widen`, { depth: 'lite' })).status, 400);
  assert.equal((await call(w, REVIEWER, 'POST', `/cases/${opened.body.uid}/widen`, { depth: 'deep' })).status, 403);
  const widened = await call(w, LEAD, 'POST', `/cases/${opened.body.uid}/widen`, { depth: 'deep' });
  assert.equal(widened.status, 200);
  const after = w.db.prepare('SELECT COUNT(*) AS n FROM dd_checklist_items WHERE case_id = ?').get(opened.body.id).n;
  // Mutation checked: insert without OR IGNORE → the existing Standard items fail the widen.
  assert.equal(after, before + widened.body.items_added);
  assert.ok(widened.body.items_added > 0);
  assert.equal((w.db.prepare('SELECT template_depth FROM dd_cases WHERE id = ?').get(opened.body.id) as any).template_depth, 'deep');
});

test('the rule a template must keep: every section once, a weight above 0 and at most 5, its own items only', () => {
  const ok = checkTemplateBody(builtInTemplate('deep'));
  assert.equal(ok.ok, true);
  const missing = builtInTemplate('lite'); missing.sections.pop();
  assert.equal(checkTemplateBody(missing).ok, false);
  const heavy = builtInTemplate('lite'); heavy.sections[0].weight = 6;
  assert.equal(checkTemplateBody(heavy).ok, false);
  const stolen = builtInTemplate('lite'); stolen.sections[0].items.push('cyber_posture.pen_test');
  assert.equal(checkTemplateBody(stolen).ok, false);
  assert.equal(builtInTemplate('lite').sections.length, SECTION_CATALOG.length);
});

test('platform checks: the identity check read only, with a link for an Admin; hidden from a section reviewer', async () => {
  const w = world();
  const admin = await call(w, ADMIN, 'GET', '/cases/case-alpha');
  // Mutation checked: read the case owner instead of the subject → the identity check reads not_started.
  assert.deepEqual(admin.body.case.platform_checks.identity, { available: true, status: 'approved', decided_at: '2026-10-03 10:00:00', link: '/admin/kyc' });
  const lead = await call(w, LEAD, 'GET', '/cases/case-alpha');
  assert.equal(lead.body.case.platform_checks.identity.link, null, 'the KYC desk is an Admin\'s');
  assert.equal((await call(w, REVIEWER, 'GET', '/cases/case-alpha')).body.case.platform_checks, null);
  // A partner case reads the business check and the partner profile.
  w.db.exec(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id) VALUES ('case-partner', 'partner', ${REVIEWER}, 'Partner Firm', ${ADMIN}, ${ADMIN});
    INSERT INTO partner_profiles (email, user_id, admin_status, ref, reviewed_at) VALUES ('p@example.test', ${REVIEWER}, 'approved', 'pp_abc', '2026-10-12');
    INSERT INTO user_company_links (uid, company_id, user_id) VALUES ('l1', 9, ${REVIEWER});
    INSERT INTO company_kyb_records (uid, company_id, started_by_user_id, status) VALUES ('k1', 9, ${REVIEWER}, 'in_review');`);
  const p = (await call(w, ADMIN, 'GET', '/cases/case-partner')).body.case.platform_checks;
  assert.equal(p.business.status, 'in_review');
  assert.deepEqual([p.partner_profile.status, p.partner_profile.link], ['approved', '/admin/partner-profiles/pp_abc']);
});

test('wiring: migration 623, and the client names every new route through one line in api.js', () => {
  const sql = read('../sql/migrations/623_dd_team_templates.sql');
  assert.match(sql, /ADD COLUMN conflicts TEXT CHECK \(conflicts IS NULL OR conflicts IN \('none', 'declared'\)\)/);
  assert.match(sql, /UNIQUE \(depth, version\)/);
  const client = read('../../frontend/src/lib/api/ddDesk.js');
  for (const path of ['/dd/overview', '/dd/my-reviews', '/dd/subjects?type=', '/dd/people?q=', '/conflicts`', '/reviewers/${enc(userId)}', '/widen`', "'/dd/templates'"]) assert.ok(client.includes(path), path);
  assert.match(read('../../frontend/src/lib/api.js'), /export \* from '\.\/api\/ddDesk\.js';/);
});
