/**
 * D464 — the chase log, and the quarter-end read.
 *
 * THE CHASE (migration 337). Canvas IP2's "Chase all overdue" and the
 * Portfolio canvas's per-company Nudge are the same act: an investor asks a
 * silent company for its update. `POST /portfolio/chase` logs one row per
 * company and notifies the founder; the tenancy check is on the project, not
 * on the page's overdue list; a repeat chase inside the hour answers the
 * existing row rather than re-notifying.
 *
 * THE QUARTER-END READ. `GET /positions/analytics` accepts `as_of`, and it
 * now cuts the flows AND the marks at the date — a quarter-end export must
 * not count a wire that landed after it or price the book with a mark that
 * did not exist yet.
 *
 * Harness: the real routers against in-memory SQLite, with the app's onError
 * mapping replicated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import portfolio from '../src/routes/portfolio.ts';
import positions from '../src/routes/positions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden' || msg === 'Admin required') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/portfolio', portfolio);
app.route('/api/positions', positions);

const INVESTOR = 42;
const OUTSIDER = 43;
const ADMIN = 44;
const FOUNDER = 50;
const PROJ = 7;
const PROJ_OUT = 9;

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // The real schema (D7650): the chase now reads the reporting obligation, so
  // the positions, duties and updates it reads are the ones the Worker has.
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, name, email, founder_id, is_active, investor_tier, investor_subscription_status)
                        VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(INVESTOR, 'investor', 'Ingrid Investor', 'ingrid@angel.example', null, 'professional');
  u.run(OUTSIDER, 'investor', 'Otto Outsider', 'otto@angel.example', null, 'professional');
  u.run(ADMIN, 'admin', 'Ada Admin', 'ada@axal.example', null, 'free');
  u.run(FOUNDER, 'founder', 'Fred Founder', 'fred@alpha.example', 9, 'free');
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (?, 'p-alpha', 'Alpha', 9)").run(PROJ);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (?, 'p-beta', 'Beta', null)").run(PROJ_OUT);
  // The investor's book: a deal on PROJ, and membership in its room.
  db.prepare("INSERT INTO deals (id, uid, project_id) VALUES (71, 'd-alpha', ?)").run(PROJ);
  db.prepare('INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (?, 71)').run(INVESTOR);
  return db;
}

/**
 * D7650: PROJ owes the investor a report that is due. A confirmed commitment
 * and a position put it in the book; a duty of 0 days after the period ends
 * makes the last completed period's report due today whatever today is.
 */
function owes(db: InstanceType<typeof DatabaseSync>) {
  db.prepare(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 71, ?, 1000, 'confirmed')`).run(INVESTOR);
  db.prepare(`INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount, position_date) VALUES ('pos-owes', ?, 'Seed', 500, '2026-01-10')`).run(PROJ);
  db.prepare(`INSERT INTO reporting_duties (closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_rule, due_days,
    source_document, source_clause, source_kind, starts_on, status)
    VALUES (1, 1, 'l1', ?, ?, 'quarterly_kpi', 'quarterly', 'after_end', 0, 'IRA', '§1.1', 'closing_template', '2026-01-01', 'active')`).run(PROJ, INVESTOR);
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function call(
  who: { user: number; role: string },
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

// ── The chase ──────────────────────────────────────────────────────────────

test('a chase is logged per company, and the tenancy check is on the project', async () => {
  const db = owes(freshDb());
  const r = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', {
    method: 'POST', body: { project_ids: [PROJ, PROJ_OUT] },
  }, db);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.chased.map((c: any) => c.project_id), [PROJ]);
  assert.deepEqual(r.body.skipped, [PROJ_OUT], 'a project outside the book is skipped, not chased');
  assert.deepEqual(r.body.skips.map((s: any) => [s.project_id, s.reason]), [[PROJ_OUT, 'no_obligation']], 'D7650: and it says why');
  const rows = db.prepare('SELECT project_id, chased_by FROM portfolio_update_chases').all() as any[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chased_by, INVESTOR);
});

test('a repeat chase inside the hour answers the existing row', async () => {
  const db = owes(freshDb());
  const first = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  assert.equal(first.body.chased[0].already, false);
  const second = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  assert.equal(second.body.chased[0].already, true, 'a double-click is not a second ask');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_update_chases').get() as any).n, 1);
});

test('the chase log reads back, scoped to the chaser', async () => {
  const db = owes(freshDb());
  await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  const read = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chases', {}, db);
  assert.equal(read.status, 200);
  assert.equal(read.body.items.length, 1);
  assert.equal(read.body.items[0].project_name, 'Alpha');
  const other = await call({ user: OUTSIDER, role: 'investor' }, '/api/portfolio/chases', {}, db);
  assert.equal(other.body.items.length, 0, 'another investor’s chase is not in this log');
});

test('a founder may not chase', async () => {
  const r = await call({ user: FOUNDER, role: 'founder' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } });
  assert.equal(r.status, 403);
});

// ── The quarter-end read ───────────────────────────────────────────────────

test('as_of cuts the flows and the marks at the date', async () => {
  const db = freshDb();
  // A position contributed in March, a distribution in May, and two marks:
  // one at the quarter end, one after it.
  db.prepare(`INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount, position_date)
              VALUES ('pos-1', ?, 'Seed', 1000000, '2026-03-10')`).run(PROJ);
  db.prepare(`INSERT INTO portfolio_marks (uid, project_id, as_of_date, fmv, basis)
              VALUES ('m-1', ?, '2026-03-31', 1200000, 'gp_estimate'), ('m-2', ?, '2026-05-02', 900000, 'write_down')`).run(PROJ, PROJ);
  db.prepare(`INSERT INTO portfolio_distributions (uid, project_id, distribution_date, amount, kind)
              VALUES ('dist-1', ?, '2026-05-12', 50000, 'dividend')`).run(PROJ);

  const admin = { user: ADMIN, role: 'admin' };
  const now = await call(admin, '/api/positions/analytics', {}, db);
  assert.equal(now.status, 200);
  assert.equal(now.body.nav, 900000, 'today’s read prices the latest mark');
  assert.equal(now.body.distributed, 50000);

  const quarterEnd = await call(admin, '/api/positions/analytics?as_of=2026-03-31', {}, db);
  assert.equal(quarterEnd.status, 200);
  assert.equal(quarterEnd.body.as_of, '2026-03-31', 'the date the figures speak for is echoed');
  assert.equal(quarterEnd.body.nav, 1200000, 'the quarter-end read prices the mark that existed then');
  assert.equal(quarterEnd.body.distributed, 0, 'the May distribution is not in the March quarter');
});

test('D1057: the chase notice sends the founder to Grow\'s Reporting desk, never the KPI board (#2427 finding 6)', async () => {
  // Mutation checked: the link back on /build/kpi.
  const db = owes(freshDb());
  const r = await call({ user: INVESTOR, role: 'investor' }, '/api/portfolio/chase', { method: 'POST', body: { project_ids: [PROJ] } }, db);
  assert.equal(r.status, 200);
  const sent = db.prepare("SELECT user_id, link, cta_url FROM notifications_inbox WHERE type = 'portfolio_update_chase'").all() as any[];
  assert.equal(sent.length, 1, 'the founder was notified');
  assert.deepEqual([sent[0].user_id, sent[0].link, sent[0].cta_url], [FOUNDER, '/grow/reporting', '/grow/reporting']);
});
