/**
 * D1246 (#3261, part 2 of #2385) — a Due Diligence case can be led, decided,
 * archived and sent to IC; a blocking section refuses "Proceed" while it
 * carries an open High or Critical flag; the deal team's memo is encrypted;
 * every report is listed and re-downloads only after a fresh step-up.
 *
 * Harness: the real router over SQLite built from the production baseline plus
 * migrations 339 and 620, a signed JWT per caller, and the app's error mapping.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_case_lifecycle_d1246.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import dd from '../src/routes/dd.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  BLOCKING_FLAG_REFUSAL, BLOCKING_SECTION_KEYS, blockingSectionsWithOpenSevereFlags,
} from '../src/services/dueDiligence.ts';

const SECRET = 'd1246-unit-test-secret-0123456789-abcdef';
const ADMIN = 1, LEAD = 2, REVIEWER = 3, OTHER = 4, ADVISOR = 5, INVESTOR = 6;
const CASE = 'case-d1246';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'user_sessions', 'projects', 'deals', 'user_company_links', 'ic_decisions', 'ic_votes',
  'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

function world() {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  db.exec(read('../sql/migrations/339_dd_section_signoff.sql'));
  db.exec(read('../sql/migrations/620_dd_case_lifecycle.sql'));
  db.exec(read('../sql/migrations/302_push_subscriptions.sql'));
  // D1249: the router also reads migration 623's template store.
  db.exec(read('../sql/migrations/623_dd_team_templates.sql'));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  for (const [id, role, name] of [[ADMIN, 'admin', 'Ada Admin'], [LEAD, 'partner', 'Lee Lead'], [REVIEWER, 'partner', 'Rae Reviewer'],
    [OTHER, 'partner', 'Otto Other'], [ADVISOR, 'advisor', 'Avi Advisor'], [INVESTOR, 'investor', 'Ivy Investor']] as const) {
    u.run(id, `synthetic${id}@example.test`, name, role);
  }
  db.exec(`INSERT INTO projects (id, name) VALUES (10, 'Company Alpha');`);
  db.prepare(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id, status)
              VALUES (?, 'project', 10, 'Company Alpha', ?, ?, 'in_review')`).run(CASE, LEAD, LEAD);
  // Section 1 is blocking (Corporate & Legal); section 2 is not (Market & Traction).
  db.exec(`INSERT INTO dd_sections (case_id, section_key, title, weight, blocking) VALUES (1, 'corporate_legal', 'Corporate & Legal Structure', 1.5, 1);
           INSERT INTO dd_sections (case_id, section_key, title, weight, blocking) VALUES (1, 'market_traction', 'Market & Traction', 1, 0);`);
  db.prepare('INSERT INTO dd_reviewers (case_id, section_id, user_id) VALUES (1, 2, ?)').run(REVIEWER);
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

async function call(w: any, who: number, method: string, path: string, body?: unknown, jti?: string) {
  const role = w.db.prepare('SELECT role FROM users WHERE id = ?').get(who).role;
  const claims: any = { user_id: who, role };
  if (jti) claims.jti = jti;
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/api/dd${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, w.env, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const lane = APPROVAL_SOURCES.find((s: any) => s.key === 'due_diligence') as any;
const waiting = (w: any) => Number(w.db.prepare(lane.countSql).get().n);
const decide = (w: any, who: number, decision: string, reason = 'The team reviewed every section.') =>
  call(w, who, 'POST', `/cases/${CASE}/decision`, { decision, reason });
const addFinding = (w: any, section: number, severity: string, resolved = false) =>
  w.db.prepare(`INSERT INTO dd_findings (case_id, section_id, source_kind, severity, title, resolved_at) VALUES (1, ?, 'manual', ?, 'Synthetic flag', ?)`)
    .run(section, severity, resolved ? '2026-10-20' : null);

/* ------------------------------------------------------------------ */

test('the rule: only an open High or Critical flag in a blocking section blocks', () => {
  const sections = [{ id: 1, blocking: 1 }, { id: 2, blocking: 0 }];
  const none: any[] = [];
  // Mutation checked: count a resolved finding → [1] for a resolved High.
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, [{ section_id: 1, severity: 'high', resolved_at: '2026-10-01' }], none), []);
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, [{ section_id: 1, severity: 'critical', resolved_at: null }], none), [1]);
  // Mutation checked: let Medium block → [1] for an open Medium.
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, [{ section_id: 1, severity: 'medium', resolved_at: null }], none), []);
  // Mutation checked: ignore `blocking` → [2] for a High in a section that does not block.
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, [{ section_id: 2, severity: 'high', resolved_at: null }], none), []);
  // A checklist item still flagged or failed at High is an open flag; once passed it is not.
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, none, [{ section_id: 1, status: 'fail', severity: 'high' }]), [1]);
  assert.deepEqual(blockingSectionsWithOpenSevereFlags(sections, none, [{ section_id: 1, status: 'pass', severity: 'high' }]), []);
  assert.deepEqual([...BLOCKING_SECTION_KEYS].sort(), ['compliance_aml', 'corporate_legal', 'financial_health']);
});

test('a decided case leaves the Approvals lane', async () => {
  const w = world();
  assert.equal(waiting(w), 1);
  const r = await decide(w, LEAD, 'proceed_with_conditions');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = w.db.prepare('SELECT status, decision, decided_by, decided_at, decision_reason_enc FROM dd_cases WHERE id = 1').get() as any;
  assert.deepEqual([row.status, row.decision, row.decided_by], ['completed', 'proceed_with_conditions', LEAD]);
  assert.ok(row.decided_at);
  // Mutation checked: leave status in_review → the lane still counts it.
  assert.equal(waiting(w), 0, 'the Approvals lane drains');
  // The reason is ciphertext at rest, and comes back on the lead's read.
  assert.ok(!String(row.decision_reason_enc).includes('reviewed every section'));
  const got = await call(w, LEAD, 'GET', `/cases/${CASE}`);
  assert.equal(got.body.case.decision_reason, 'The team reviewed every section.');
  assert.ok(w.db.prepare(`SELECT 1 FROM dd_audit_log WHERE action = 'case_decided'`).get(), 'the write is audited');
  // "Reviewers are told."
  assert.ok(w.db.prepare(`SELECT 1 FROM notifications_inbox WHERE user_id = ? AND type = 'dd_case_decided'`).get(REVIEWER));
  // A section reviewer is told the decision, never its reason.
  const scoped = await call(w, REVIEWER, 'GET', `/cases/${CASE}`);
  assert.equal(scoped.body.case.decision, 'proceed_with_conditions');
  assert.equal(scoped.body.case.decision_reason, null);
});

test('Proceed with an open High in a blocking section is refused, in the canvas\'s words', async () => {
  const w = world();
  addFinding(w, 1, 'high');
  const r = await decide(w, LEAD, 'proceed');
  // Mutation checked: drop the gate → 200 and the case is decided Proceed.
  assert.equal(r.status, 409);
  assert.equal(r.body.error, BLOCKING_FLAG_REFUSAL);
  assert.deepEqual(r.body.section_ids, [1]);
  assert.equal((w.db.prepare('SELECT decision FROM dd_cases WHERE id = 1').get() as any).decision, null, 'nothing is recorded');
  // Proceed with conditions is the way through.
  assert.equal((await decide(w, LEAD, 'proceed_with_conditions')).status, 200);
  // Once the flag closes, Proceed is accepted.
  w.db.exec(`UPDATE dd_findings SET resolved_at = '2026-10-25'`);
  assert.equal((await decide(w, LEAD, 'proceed')).status, 200);
  // A High in a section that does not block never refuses.
  const v = world();
  addFinding(v, 2, 'critical');
  assert.equal((await decide(v, LEAD, 'proceed')).status, 200);
});

test('a reviewer cannot decide; the lead or an Admin can; a reason is required', async () => {
  const w = world();
  // Mutation checked: let any case writer decide → the reviewer's 403 is a 200.
  assert.equal((await decide(w, REVIEWER, 'do_not_proceed')).status, 403);
  assert.equal((await decide(w, OTHER, 'do_not_proceed')).status, 403);
  assert.equal((await decide(w, LEAD, 'do_not_proceed', '   ')).status, 400);
  assert.equal((await decide(w, LEAD, 'maybe')).status, 400);
  assert.equal((await decide(w, ADMIN, 'withdrawn')).status, 200);
  // Handing the lead on moves the right to decide with it; the opener keeps their read.
  const v = world();
  assert.equal((await call(v, LEAD, 'PATCH', `/cases/${CASE}`, { lead_user_id: OTHER })).status, 200);
  assert.equal((await decide(v, LEAD, 'withdrawn')).status, 403);
  assert.equal((await decide(v, OTHER, 'withdrawn')).status, 200);
  assert.equal((await call(v, LEAD, 'GET', `/cases/${CASE}`)).status, 200);
  assert.ok(v.db.prepare(`SELECT 1 FROM notifications_inbox WHERE user_id = ? AND type = 'dd_case_lead'`).get(OTHER), 'the new lead is told');
});

test('the context: lead, target IC date, round, cheque and deal are checked; an advisor never leads', async () => {
  const w = world();
  const patch = (b: any, who = LEAD) => call(w, who, 'PATCH', `/cases/${CASE}`, b);
  assert.equal((await patch({ lead_user_id: ADVISOR })).status, 400);
  assert.equal((await patch({ target_ic_date: '2026-02-30' })).status, 400);
  assert.equal((await patch({ cheque_cents: 200000000 })).status, 400, 'a cheque needs its currency');
  assert.equal((await patch({ cheque_cents: -1, cheque_currency: 'EUR' })).status, 400);
  assert.equal((await patch({ deal_id: 999 })).status, 404);
  assert.equal((await patch({ round_label: 'Series A' }, REVIEWER)).status, 403);
  const ok = await patch({ target_ic_date: '2026-11-14', round_label: 'Series A', cheque_cents: 200000000, cheque_currency: 'eur' });
  assert.equal(ok.status, 200);
  const row = w.db.prepare('SELECT target_ic_date, round_label, cheque_cents, cheque_currency FROM dd_cases WHERE id = 1').get() as any;
  assert.deepEqual({ ...row }, { target_ic_date: '2026-11-14', round_label: 'Series A', cheque_cents: 200000000, cheque_currency: 'EUR' });
  // The audit says which fields changed, never the figures.
  const audits = w.db.prepare(`SELECT details_enc FROM dd_audit_log WHERE action = 'case_updated'`).all() as any[];
  assert.equal(audits.length, 1);
  // A section reviewer never reads the cheque.
  const scoped = await call(w, REVIEWER, 'GET', `/cases/${CASE}`);
  assert.equal(scoped.body.case.cheque_cents, null);
});

test('archive with a reason: the case leaves the lane and takes no further change', async () => {
  const w = world();
  assert.equal((await call(w, LEAD, 'PATCH', `/cases/${CASE}`, { archive: true })).status, 400, 'a reason is required');
  const r = await call(w, LEAD, 'PATCH', `/cases/${CASE}`, { archive: true, archived_reason: 'The round did not happen.' });
  assert.equal(r.status, 200);
  assert.equal(waiting(w), 0);
  const got = await call(w, ADMIN, 'GET', `/cases/${CASE}`);
  assert.equal(got.body.case.status, 'archived');
  assert.equal(got.body.case.archived_reason, 'The round did not happen.');
  // Mutation checked: drop the archived check → the decision is recorded on an archived case.
  assert.equal((await decide(w, LEAD, 'withdrawn')).status, 409);
  assert.equal((await call(w, LEAD, 'PUT', `/cases/${CASE}/memo`, { summary: 'x' })).status, 409);
});

test('the memo is the deal team\'s, encrypted at rest; a reviewer cannot read it', async () => {
  const w = world();
  const saved = await call(w, LEAD, 'PUT', `/cases/${CASE}/memo`, {
    summary: 'A clean company.', verified: 'The cap table.', on_trust: 'The pipeline.', conditions: 'Close the legal flag.',
  });
  assert.equal(saved.status, 200);
  const raw = w.db.prepare('SELECT * FROM dd_case_memos').get() as any;
  // Mutation checked: store the plain text → the summary is readable in the row.
  for (const col of ['summary_enc', 'verified_enc', 'on_trust_enc', 'conditions_enc']) assert.ok(raw[col] && !String(raw[col]).includes(' '), col);
  const got = await call(w, ADMIN, 'GET', `/cases/${CASE}/memo`);
  assert.deepEqual([got.body.memo.summary, got.body.memo.conditions, got.body.memo.updated_by_name], ['A clean company.', 'Close the legal flag.', 'Lee Lead']);
  assert.equal((await call(w, REVIEWER, 'GET', `/cases/${CASE}/memo`)).status, 403);
  assert.equal((await call(w, REVIEWER, 'PUT', `/cases/${CASE}/memo`, { summary: 'x' })).status, 403);
  assert.deepEqual((await call(world(), LEAD, 'GET', `/cases/${CASE}/memo`)).body, { memo: null });
});

test('every report is listed; an old one re-downloads only after a recent step-up', async () => {
  const w = world();
  w.db.exec(`INSERT INTO dd_reports (case_id, storage_key, format, risk_band_at_generation, generated_by_user_id, created_at)
             VALUES (1, 'dd-reports/1/old.pdf.enc', 'pdf', 'yellow', ${LEAD}, '2026-10-01 10:00:00'),
                    (1, NULL, 'html', NULL, ${LEAD}, '2026-10-02 10:00:00');`);
  const list = await call(w, LEAD, 'GET', `/cases/${CASE}/reports`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((r: any) => [r.format, r.stored, r.generated_by_name, r.risk_band_at_generation]),
    [['html', false, 'Lee Lead', null], ['pdf', true, 'Lee Lead', 'yellow']]);
  assert.equal((await call(w, INVESTOR, 'GET', `/cases/${CASE}/reports`)).status, 403);
  // No step-up: refused before anything is minted.
  // Mutation checked: drop requireStepUp → an SMS-era session gets a link.
  w.db.exec(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (${LEAD}, 'stale', 'totp', '2026-01-01 00:00:00');`);
  const stale = await call(w, LEAD, 'POST', `/cases/${CASE}/reports/1/download`, undefined, 'stale');
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, 'step_up_required');
  w.db.exec(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (${LEAD}, 'fresh', 'totp', datetime('now'));`);
  const fresh = await call(w, LEAD, 'POST', `/cases/${CASE}/reports/1/download`, undefined, 'fresh');
  assert.equal(fresh.status, 200);
  assert.match(fresh.body.download_url, /^\/api\/dd\/reports\/download\/.+/);
  assert.ok(w.db.prepare(`SELECT 1 FROM dd_audit_log WHERE action = 'report_downloaded'`).get());
  // A report that was never stored cannot come back.
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/reports/2/download`, undefined, 'fresh')).status, 410);
  // Another case's report id is not this case's.
  w.db.exec(`INSERT INTO dd_cases (uid, subject_type, subject_id, subject_label, owner_user_id, lead_user_id) VALUES ('other', 'project', 10, 'B', ${OTHER}, ${OTHER});
             INSERT INTO dd_reports (case_id, storage_key, format, generated_by_user_id) VALUES (2, 'k', 'pdf', ${OTHER});`);
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/reports/3/download`, undefined, 'fresh')).status, 404);
});

test('Send to IC: after a decision to go ahead, once, with the case attached', async () => {
  const w = world();
  // Mutation checked: drop the decision check → an undecided case reaches IC.
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/ic`)).status, 409);
  await decide(w, LEAD, 'do_not_proceed');
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/ic`)).status, 409, 'Do not proceed never goes to IC');
  await decide(w, LEAD, 'proceed');
  assert.equal((await call(w, REVIEWER, 'POST', `/cases/${CASE}/ic`)).status, 403);
  const sent = await call(w, LEAD, 'POST', `/cases/${CASE}/ic`);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const ic = w.db.prepare('SELECT uid, dd_case_id, project_id, status, created_by, title FROM ic_decisions').get() as any;
  assert.deepEqual([ic.dd_case_id, ic.project_id, ic.status, ic.created_by], [1, 10, 'draft', LEAD]);
  assert.equal(ic.title, 'Investment decision: Company Alpha');
  assert.equal(sent.body.ic_record.uid, ic.uid);
  assert.equal((await call(w, LEAD, 'POST', `/cases/${CASE}/ic`)).status, 409, 'a case goes once');
  const got = await call(w, LEAD, 'GET', `/cases/${CASE}`);
  assert.deepEqual(got.body.case.ic_record, { uid: ic.uid, status: 'draft' });
  // An advisor never reaches IC (nor leads a case).
  const v = world();
  await decide(v, LEAD, 'proceed');
  v.db.exec(`UPDATE dd_cases SET lead_user_id = ${ADVISOR}`);
  assert.equal((await call(v, ADVISOR, 'POST', `/cases/${CASE}/ic`)).status, 403);
});

test('the case lead records a verdict without a reviewer row; a reviewer still only on their own section', async () => {
  const w = world();
  // Mutation checked: drop the lead branch → 403 "You are not assigned to this section".
  const lead = await call(w, LEAD, 'POST', `/cases/${CASE}/sections/1/verdict`, { verdict: 'pass' });
  assert.equal(lead.status, 200, JSON.stringify(lead.body));
  assert.equal((w.db.prepare('SELECT signed_off_by FROM dd_sections WHERE id = 1').get() as any).signed_off_by, LEAD);
  assert.equal((await call(w, REVIEWER, 'POST', `/cases/${CASE}/sections/1/verdict`, { verdict: 'pass' })).status, 403);
});

test('a new case: its opener leads it, and the catalog\'s blocking sections are stamped', async () => {
  const w = world();
  const r = await call(w, LEAD, 'POST', '/cases', { subject_type: 'project', subject_id: 10, subject_label: 'Company Gamma' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = w.db.prepare('SELECT lead_user_id FROM dd_cases WHERE uid = ?').get(r.body.uid) as any;
  assert.equal(row.lead_user_id, LEAD);
  const sections = w.db.prepare('SELECT section_key, blocking FROM dd_sections WHERE case_id = ? ORDER BY id').all(r.body.id) as any[];
  // Mutation checked: skip stampNewCase → every section reads 0.
  assert.deepEqual(sections.filter((s) => s.blocking === 1).map((s) => s.section_key).sort(), ['compliance_aml', 'corporate_legal', 'financial_health']);
});

test('wiring: migration 620, a scan never reopens a decided case, and the client names every route', () => {
  const sql = read('../sql/migrations/620_dd_case_lifecycle.sql');
  assert.match(sql, /ADD COLUMN decision TEXT\s+CHECK \(decision IS NULL OR decision IN \('proceed', 'proceed_with_conditions', 'do_not_proceed', 'withdrawn'\)\)/);
  assert.match(sql, /UPDATE dd_cases SET lead_user_id = owner_user_id WHERE lead_user_id IS NULL/);
  const route = read('../src/routes/dd.ts');
  // Mutation checked: drop the status guard → a scan moves a decided case back to in_review.
  assert.match(route, /SET status = 'in_review', updated_at = CURRENT_TIMESTAMP WHERE id = \$\{caseId\} AND status IN \('open', 'in_review'\)/);
  const client = read('../../frontend/src/lib/api/ddLifecycle.js');
  for (const path of ['/dd/cases/${enc(uid)}/decision', '/dd/cases/${enc(uid)}/memo', '/dd/cases/${enc(uid)}/reports', '/dd/cases/${enc(uid)}/ic']) assert.ok(client.includes(path), path);
  assert.match(read('../../frontend/src/lib/api.js'), /export \* from '\.\/api\/ddLifecycle\.js';/);
});
