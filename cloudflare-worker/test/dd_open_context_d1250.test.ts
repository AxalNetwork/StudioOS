/**
 * D1250 (#3265, part 6 of #2385) — the Worker side of Open a case (DDL2): a
 * case opens with its context (round, cheque, target IC date, lead, linked
 * deal) under PATCH's own checks, and the subject search gives each startup
 * its stage and the deals the caller may link.
 *
 * Harness: D1249's — the real router over SQLite from the production baseline
 * plus migrations 339, 620, 622 and 623, a signed JWT per caller.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/dd_open_context_d1250.test.ts
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
import { decField } from '../src/services/dueDiligence.ts';

const SECRET = 'd1250-unit-test-secret-0123456789-abcdef';
const SUPER = 1, ADMIN = 2, LEAD = 3, REVIEWER = 4, OBSERVER = 5, INVESTOR = 6, ADVISOR = 7, FOUNDER = 8;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql').replace(/--[^\n]*/g, '');
const TABLES = ['users', 'super_admins', 'projects', 'founders', 'deals', 'deal_invitations', 'commitments', 'user_company_links', 'partner_profiles',
  'ic_decisions', 'ic_votes', 'dd_cases', 'dd_sections', 'dd_findings', 'dd_external_sources', 'dd_attachments', 'dd_reviewers', 'dd_reports',
  'dd_audit_log', 'dd_checklist_items', 'dd_requests', 'notifications_inbox'];

function world() {
  const { DB, db } = makeD1('');
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(baseline, t)));
  for (const m of ['339_dd_section_signoff', '620_dd_case_lifecycle', '622_dd_documents_due_reminders', '623_dd_team_templates', '302_push_subscriptions']) db.exec(read(`../sql/migrations/${m}.sql`));
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
    INSERT INTO deals (id, project_id, status, instrument) VALUES (100, 10, 'active', 'SAFE'), (101, 11, 'active', NULL), (102, 10, 'applied', NULL);
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
const cases = (w: any) => Number(w.db.prepare('SELECT COUNT(*) AS n FROM dd_cases').get().n);
const OPEN = { subject_type: 'project', subject_id: 10, subject_label: 'Company Alpha', template_depth: 'lite' };

test('a case opens with its context: lead, target IC date, round, cheque and the startup’s deal', async () => {
  const w = world();
  const r = await call(w, ADMIN, 'POST', '/cases', {
    ...OPEN, lead_user_id: LEAD, target_ic_date: '2026-12-14', round_label: 'Series A', cheque_cents: 200000000, cheque_currency: 'eur', deal_id: 100,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = w.db.prepare('SELECT * FROM dd_cases WHERE uid = ?').get(r.body.uid) as any;
  // Mutation checked: drop the context UPDATE → every field reads NULL and the lead is the opener.
  assert.deepEqual([row.lead_user_id, row.owner_user_id, row.target_ic_date, row.round_label, row.cheque_cents, row.cheque_currency, row.deal_id],
    [LEAD, ADMIN, '2026-12-14', 'Series A', 200000000, 'EUR', 100]);
  const a = w.db.prepare("SELECT id, details_enc FROM dd_audit_log WHERE case_id = ? AND action = 'case_opened'").get(row.id) as any;
  const plain = String(await decField(w.env, 'dd_audit_log', 'details', Number(a.id), a.details_enc));
  assert.deepEqual(JSON.parse(plain).context, ['lead', 'target_ic_date', 'round', 'cheque', 'deal']);
  assert.ok(!/200000000|Series A|2026-12-14/.test(plain), 'the audit names the fields, never the figures');
  // Mutation checked: notify the opener → no bell for the lead.
  const bell = w.db.prepare("SELECT user_id, title FROM notifications_inbox WHERE type = 'dd_case_lead'").all() as any[];
  assert.deepEqual(bell.map((b) => b.user_id), [LEAD]);

  // Opened with no context: the opener leads, nothing else is recorded, nobody is told.
  const bare = await call(w, ADMIN, 'POST', '/cases', OPEN);
  const b = w.db.prepare('SELECT * FROM dd_cases WHERE uid = ?').get(bare.body.uid) as any;
  assert.deepEqual([b.lead_user_id, b.target_ic_date, b.cheque_cents, b.deal_id], [ADMIN, null, null, null]);
  assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'dd_case_lead'").get() as any).n, 1);
});

test('a refused context field opens no case', async () => {
  const w = world();
  const before = cases(w);
  const refused = [
    [{ cheque_cents: 5, cheque_currency: 'euros' }, 400, /three-letter code/],
    [{ cheque_cents: -1, cheque_currency: 'EUR' }, 400, /zero or more/],
    [{ target_ic_date: '2026-02-30' }, 400, /YYYY-MM-DD/],
    [{ lead_user_id: ADVISOR }, 400, /Admin, a partner or an investor/],
    [{ lead_user_id: 999 }, 404, /could not be found/],
    [{ deal_id: 101 }, 400, /deal of this startup/],
    [{ deal_id: 999 }, 404, /could not be found/],
  ] as const;
  for (const [ctx, status, words] of refused) {
    const r = await call(w, ADMIN, 'POST', '/cases', { ...OPEN, ...ctx });
    assert.equal(r.status, status, JSON.stringify(ctx));
    assert.match(r.body.error, words);
  }
  // Mutation checked: check the context after the INSERT → a case per refusal.
  assert.equal(cases(w), before, 'a refusal wrote a case');
});

test('an investor links only a deal they are on; an advisor opens nothing', async () => {
  const w = world();
  // Deal 102 is Company Alpha's too, but the investor is not on it.
  const other = await call(w, INVESTOR, 'POST', '/cases', { ...OPEN, deal_id: 102 });
  assert.equal(other.status, 400);
  const mine = await call(w, INVESTOR, 'POST', '/cases', { ...OPEN, deal_id: 100 });
  assert.equal(mine.status, 201);
  assert.equal((w.db.prepare('SELECT deal_id FROM dd_cases WHERE uid = ?').get(mine.body.uid) as any).deal_id, 100);
  // An Admin may link any of the startup's deals.
  assert.equal((await call(w, ADMIN, 'POST', '/cases', { ...OPEN, deal_id: 102 })).status, 201);
  assert.equal((await call(w, ADVISOR, 'POST', '/cases', OPEN)).status, 403);
});

test('the subject search gives each startup its stage and the deals the caller may link', async () => {
  const w = world();
  w.db.exec("UPDATE projects SET stage = 'mvp' WHERE id = 10");
  const admin = await call(w, ADMIN, 'GET', '/subjects?type=project&q=Alpha');
  assert.equal(admin.status, 200);
  const alpha = admin.body.items[0];
  assert.deepEqual([alpha.name, alpha.stage, alpha.deals.map((d: any) => d.id).sort()], ['Company Alpha', 'mvp', [100, 102]]);
  assert.deepEqual(Object.keys(alpha.deals[0]).sort(), ['created_at', 'id', 'instrument', 'status']);
  // Mutation checked: pass the privileged flag for everyone → the investor sees 102.
  const inv = await call(w, INVESTOR, 'GET', '/subjects?type=project&q=');
  assert.deepEqual(inv.body.items.map((p: any) => [p.name, p.deals.map((d: any) => d.id)]), [['Company Alpha', [100]]]);
  const none = await call(w, ADMIN, 'GET', '/subjects?type=project&q=Gamma');
  assert.deepEqual(none.body.items[0].deals, [], 'a startup with no deal has an empty list, read');
  const people = await call(w, ADMIN, 'GET', '/subjects?type=founder&q=Fay');
  assert.equal(people.body.items[0].deals, undefined, 'only a startup carries deals');
});

test('PATCH keeps its checks after the shared helper', async () => {
  const w = world();
  const bad = await call(w, LEAD, 'PATCH', '/cases/case-alpha', { cheque_cents: 5, cheque_currency: 'xx' });
  assert.equal(bad.status, 400);
  const ok = await call(w, LEAD, 'PATCH', '/cases/case-alpha', { round_label: 'Seed', deal_id: 101 });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.case.round_label, ok.body.case.deal_id], ['Seed', 101], 'PATCH links any deal, as D1246 drew it');
  assert.equal((await call(w, LEAD, 'PATCH', '/cases/case-alpha', {})).status, 400);
});
