/** D1159 (#3066): names, act-table writes and independent booklet counts on real SQLite. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import funds from '../src/routes/funds.ts';
import performance from '../src/routes/fund_performance.ts';
import fundAdminRouter from '../src/routes/fund_admin.ts';
import { Hono } from 'hono';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const fundAdmin = new Hono<any>();
fundAdmin.route('/', fundAdminRouter);
fundAdmin.onError((error, c) => c.json({ detail: error.message }, AUTH_ERROR_STATUSES[error.message] ?? 500));
import { fundAdminOverview } from '../src/services/fundAdminOverview.ts';
import { splitDistribution } from '../src/services/fundDistributionSplit.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { ADMIN, SUPER, INVESTOR, FOUNDER, JTI, freshDb, envFor, tokenFor } from './_mercury_fixture.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const baseline = read('../sql/schema_baseline.sql');
const TODAY = '2026-10-25';
const digest = 'a'.repeat(64);
let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches++; throw new Error('network forbidden'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0); });

function fixture() {
  const db = freshDb();
  for (const table of ['legal_templates', 'fund_distributions', 'portfolio_positions', 'queue_jobs', 'lp_applications', 'esign_envelopes', 'esign_recipients'])
    db.exec(stripForeignKeys(tableFromBaseline(baseline, table)));
  for (const migration of ['264_admin_notices.sql', '417_fund_position_valuations.sql', '476_fund_report_drafts.sql', '478_fund_notices_booklets.sql', '485_fund_booklet_envelopes.sql'])
    db.exec(read(`../sql/migrations/${migration}`));
  db.exec(`UPDATE users SET is_active = 1;
    UPDATE users SET investor_tier = 'institutional', investor_subscription_status = 'active' WHERE id = ${INVESTOR};
    INSERT INTO vc_funds (id, name, slug, gp_user_id, carried_interest) VALUES
      (1, 'Fund I', 'spinout-fund-i', NULL, 0.2), (2, 'Outside fund', 'outside', ${INVESTOR}, 0.2), (3, 'Empty fund', NULL, ${ADMIN}, 0.2);
    INSERT INTO limited_partners (id, fund_id, name, commitment_amount, invested_amount, status) VALUES
      (10, 1, 'Named A', 333, 100, 'active'), (11, 1, 'Named B', 333, 100, 'committed'), (12, 1, NULL, 334, 100, 'active'),
      (20, 2, 'Outside LP', 100, 0, 'active');
    INSERT INTO portfolio_positions (id, uid, created_by, fund_id, project_id, round_name, invested_amount) VALUES
      (1, 'position-1', ${INVESTOR}, 1, 1, 'Seed', 100), (2, 'position-2', ${INVESTOR}, 2, 2, 'Seed', 100);`);
  return { db, env: envFor(db) };
}

async function call(app: any, env: any, user: number, method: string, path: string, body?: unknown, impersonated = false) {
  const token = await tokenFor(user, { jti: user === ADMIN ? JTI.adminTotp : user === SUPER ? JTI.superFresh : undefined, impersonated });
  const response: Response = await app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: response.status, body: await response.json() as any };
}
const mark = { valuation_date: TODAY, value_cents: 12000, source: 'Synthetic mark' };

test('D1159: preview names each LP, preserves arithmetic and reconciles line totals including rounding', async () => {
  const { db, env } = fixture();
  const result = await call(funds, env, ADMIN, 'POST', '/1/distributions/preview', { proceeds_cents: 100002 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.lines.map((r: any) => [r.lp_id, r.lp_name, r.amount_cents]), [[10, 'Named A', 28639], [11, 'Named B', 28639], [12, null, 28725]]);
  const expected = splitDistribution(100002, 0.2, [
    { id: 10, commitment_amount: 333, invested_amount: 100 }, { id: 11, commitment_amount: 333, invested_amount: 100 }, { id: 12, commitment_amount: 334, invested_amount: 100 },
  ]);
  const { lines, ok, fund_id, ...arithmetic } = result.body;
  assert.deepEqual(arithmetic, (({ lines: _lines, ...rest }) => rest)(expected));
  assert.equal(lines.reduce((sum: number, r: any) => sum + r.amount_cents, 0) + result.body.unallocated_cents, result.body.distributable_cents);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fund_distributions').get()?.n, 0);
});

test('D1159: access lists both Admin acts; successful Admin writes audit once and preserve domain audit', async () => {
  const { db, env } = fixture();
  const access = await call(fundAdmin, env, ADMIN, 'GET', '/access');
  assert.equal(access.status, 200);
  for (const key of ['fund.create', 'fund.valuation']) {
    const act = access.body.acts.find((r: any) => r.act === key);
    assert.deepEqual([act.tier, act.allowed, act.sentence], ['admin', true, null]);
  }
  assert.equal((await call(funds, env, ADMIN, 'POST', '/', { name: 'Created fund' })).status, 201);
  assert.equal((await call(performance, env, ADMIN, 'POST', '/positions/1/valuations', mark)).status, 201);
  assert.equal((await call(performance, env, ADMIN, 'PUT', '/positions/1/fund', { fund_id: 3 })).status, 200);
  const audits = db.prepare("SELECT action, filters_json FROM admin_audit_log WHERE action IN ('fund_admin.fund.create', 'fund_admin.fund.valuation') ORDER BY id").all() as any[];
  assert.deepEqual(audits.map((r) => r.action), ['fund_admin.fund.create', 'fund_admin.fund.valuation', 'fund_admin.fund.valuation']);
  assert.deepEqual(audits.map((r) => JSON.parse(r.filters_json).act), ['fund.create', 'fund.valuation', 'fund.valuation']);
  assert.equal(audits.some((r) => r.filters_json.includes('Synthetic mark') || r.filters_json.includes('Created fund')), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('fund_position_valued', 'fund_position_attributed')").get()?.n, 2);
});

test('D1159: refused writes change no store; outside GPs retain only their existing fund scope', async () => {
  const { db, env } = fixture();
  const writes: Array<[any, string, string, unknown]> = [[funds, 'POST', '/', { name: 'Denied' }],
    [performance, 'POST', '/positions/1/valuations', mark], [performance, 'PUT', '/positions/1/fund', { fund_id: 3 }]];
  const snapshot = () => JSON.stringify(['vc_funds', 'portfolio_positions', 'fund_position_valuations', 'activity_logs', 'admin_audit_log'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
  for (const [app, method, path, body] of writes) {
    for (const [who, support] of [[FOUNDER, false], [ADMIN, true]] as const) {
      const before = snapshot();
      const result = await call(app, env, who, method, path, body, support);
      assert.ok(result.status >= 400 && result.status < 500, JSON.stringify({ who, support, path, ...result }));
      assert.equal(snapshot(), before);
    }
  }
  db.exec(`INSERT INTO admin_notices (uid, user_id, kind, subject, body, respond_by, status) VALUES ('paused', ${ADMIN}, 'fees', 'Synthetic', 'Synthetic', datetime('now', '-1 day'), 'overdue');`);
  for (const [app, method, path, body] of writes) {
    const before = snapshot();
    const result = await call(app, env, ADMIN, method, path, body);
    assert.equal(result.status, 423);
    assert.equal(snapshot(), before);
  }
  // Owner explicitly confirmed that existing institutional GP rights stay.
  assert.equal((await call(funds, env, INVESTOR, 'POST', '/', { name: 'GP fund' })).status, 201);
  assert.equal((await call(performance, env, INVESTOR, 'POST', '/positions/2/valuations', mark)).status, 201);
  assert.equal((await call(performance, env, INVESTOR, 'POST', '/positions/1/valuations', mark)).status, 404);
  assert.equal((await call(performance, env, INVESTOR, 'PUT', '/positions/2/fund', { fund_id: 1 })).status, 404);
  assert.equal((await call(fundAdmin, env, INVESTOR, 'GET', '/access')).status, 403);
});

function booklet(db: any, id: number, options: { status?: string; signed?: boolean; completed?: boolean; gp?: boolean } = {}) {
  db.prepare("INSERT INTO lp_applications (id, user_id, investor_type, fund_slug) VALUES (?, ?, 'individual', 'spinout-fund-i')").run(id, 10000 + id);
  const status = options.status ?? 'submitted';
  db.prepare(`INSERT INTO fund_subscription_booklets (id, uid, application_id, status, frozen_json, digest, submitted_at, withdrawn_by, withdrawn_reason)
    VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?)`).run(id, `book-${id}`, id, status, digest, TODAY, status === 'withdrawn' ? ADMIN : null, status === 'withdrawn' ? 'Synthetic withdrawal' : null);
  db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status)
    VALUES (?, ?, 'fund_booklet', 'Synthetic', 'Synthetic', ?, ?, ?)`).run(id, `app-${id}`, digest, SUPER, options.completed === false ? 'sent' : 'completed');
  db.prepare(`INSERT INTO esign_recipients (envelope_id, recipient_email, signing_token, token_expires_at, status, signed_at) VALUES (?, ?, ?, '2099-01-01', ?, ?)`)
    .run(id, 'synthetic@example.test', `synthetic-${id}`, options.signed === false ? 'pending' : 'signed', options.signed === false ? null : TODAY);
  // Open/withdrawn fixtures represent an earlier signature, before the current status.
  db.prepare("INSERT INTO fund_booklet_envelopes (booklet_id, envelope_uuid, stage, digest) VALUES (?, ?, 'applicant', ?)").run(id, `app-${id}`, digest);
  if (options.gp) db.prepare("INSERT INTO fund_booklet_envelopes (booklet_id, envelope_uuid, stage, digest) VALUES (?, ?, 'gp', ?)").run(id, `gp-${id}`, digest);
}

test('D1159: booklets count signed applicants not yet sent to GP, per administered fund; a failed block stands alone', async () => {
  const { db, env } = fixture();
  booklet(db, 1); booklet(db, 2); booklet(db, 3, { signed: false }); booklet(db, 4, { completed: false }); booklet(db, 5, { gp: true });
  booklet(db, 7); db.exec("UPDATE esign_recipients SET signed_at = NULL WHERE envelope_id = 7");
  booklet(db, 8); db.exec("UPDATE esign_recipients SET status = 'pending' WHERE envelope_id = 8");
  booklet(db, 6); db.exec("UPDATE fund_subscription_booklets SET status = 'withdrawn', withdrawn_by = 902, withdrawn_reason = 'Synthetic withdrawal' WHERE id = 6");
  const readOverview = () => fundAdminOverview(env, { id: ADMIN, role: 'admin', email: 'synthetic@example.test' } as any, TODAY);
  const view = await readOverview();
  assert.deepEqual(view?.booklets, { state: 'ok', items: [{ fund_id: 1, waiting: 2 }, { fund_id: 3, waiting: 0 }] });
  db.exec(`UPDATE vc_funds SET gp_user_id = ${INVESTOR} WHERE id = 1;`);
  assert.deepEqual((await readOverview())?.booklets, { state: 'ok', items: [{ fund_id: 3, waiting: 0 }] });
  db.exec('DROP TABLE fund_booklet_envelopes;');
  const broken = await readOverview();
  assert.deepEqual(broken?.booklets, { state: 'unreadable', items: [] });
  for (const key of ['funds', 'entities', 'fees', 'drafts', 'matches'] as const) assert.equal(broken?.[key].state, 'ok');
});
