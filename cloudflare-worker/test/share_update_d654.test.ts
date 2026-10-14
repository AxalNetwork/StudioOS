/**
 * D654 (#1466) — Grow › Share an update, on `portfolio_updates` (migration 437).
 *
 * Real SQLite over the migrations that create each table the routes touch:
 * 125 (portfolio_updates), 437, 119 (project_members), 127 (contacts),
 * 128 (raise_prospects), 132 (job board). `follows`, `project_metrics` and the
 * notification inbox are created at runtime, as on a dev database.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/share_update_d654.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import updates, { shippedItems } from '../src/routes/portfolio_updates.ts';
import { ensureProjectMetricsSchema } from '../src/routes/progress.ts';
import {
  ASK_AGAIN_DAYS, ASK_MODULE, buildMetrics, canAskAgain, cleanAudience, cleanLines, cleanMetrics, draftLines, noMetrics, parseDraft, payloadFor, periodFacts,
  type Snapshot,
} from '../src/services/updateShare.ts';
import { d1Over } from './_d1_sqlite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, '../sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const INVESTOR = 2; const TEAM = 3; const NETWORK = 4; const STRANGER = 5;

const file = (prefix: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${prefix}_`))!), 'utf8');
/** The CREATE statements of a migration, without seed rows or ALTERs on tables it does not own. */
const ddl = (prefix: string) => file(prefix).split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter((s) => /^CREATE\s+(TABLE|INDEX|UNIQUE INDEX)/i.test(s)).map((s) => `${s};`).join('\n');

const snap = (d: string, o: Partial<Snapshot> = {}): Snapshot => ({ snapshot_date: d, source: 'stripe', mrr: null, paying_accounts: null, net_burn: null, cash_balance: null, ...o });

// ── The rules, as functions ─────────────────────────────────────────────────

test('a metric no snapshot records is null ("Not recorded"), never 0; a recorded 0 stays 0', () => {
  const m = buildMetrics([snap('2026-10-12', { mrr: 38400, paying_accounts: 0 })], [], '2026-10-01');
  const by = Object.fromEntries(m.map((x) => [x.key, x]));
  assert.deepEqual([by.mrr.value, by.mrr.source, by.mrr.as_of], [38400, 'stripe', '2026-10-12']);
  assert.equal(by.customers.value, 0, 'a recorded zero is a figure');
  for (const k of ['growth', 'burn', 'runway']) {
    assert.equal(by[k].value, null, `${k} is not recorded`);
    assert.notEqual(by[k].value, 0);
    assert.match(by[k].reason, /^Not recorded/);
    assert.equal(by[k].source, null);
  }
  const none = buildMetrics([], [], '2026-10-01');
  assert.ok(none.every((x) => x.value === null), 'no snapshot: every figure is Not recorded');
  assert.equal(noMetrics(none), true);
  assert.equal(noMetrics(m), false);
});

test('growth and runway are derived only from recorded figures', () => {
  const m = buildMetrics(
    [snap('2026-10-01', { mrr: 100, source: 'manual' }), snap('2026-10-20', { mrr: 106, net_burn: 50, cash_balance: 600, source: 'bank' })],
    [snap('2026-09-30', { mrr: 100 })], '2026-10-01',
  );
  const by = Object.fromEntries(m.map((x) => [x.key, x]));
  assert.equal(by.mrr.value, 106, 'the latest figure in the period');
  assert.equal(by.growth.value, 6);
  assert.equal(by.runway.value, 12);
  assert.equal(by.runway.source, 'bank');
  assert.equal(buildMetrics([snap('2026-10-01', { mrr: 100 })], [], '2026-10-01').find((x) => x.key === 'growth')!.value, null, 'no MRR before the period: no growth');
  const runway = (o: Partial<Snapshot>) => buildMetrics([snap('2026-10-01', o)], [], '2026-10-01').find((x) => x.key === 'runway')!.value;
  assert.equal(runway({ cash_balance: 600 }), null, 'cash without burn: no runway');
  assert.equal(runway({ cash_balance: 600, net_burn: 0 }), null, 'a zero burn gives no runway figure');
});

test('growth reads only the previous calendar month, including across a year boundary', () => {
  const growth = (start: string, prior: string) => buildMetrics([snap(start, { mrr: 120 })], [snap(prior, { mrr: 100 })], start).find((m) => m.key === 'growth')!;
  assert.equal(growth('2026-10-01', '2026-09-30').value, 20);
  assert.equal(growth('2027-01-01', '2026-12-31').value, 20);
  assert.deepEqual([growth('2026-10-01', '2026-08-31').value, growth('2026-10-01', '2026-08-31').reason],
    [null, 'Not recorded: growth needs MRR recorded in this period and the month before']);
});

test('the default audience and ask labels match the Grow modules', () => {
  assert.deepEqual(cleanAudience({}), { investors: true, team: true, network: true });
  assert.deepEqual(cleanAudience({ network: false }), { investors: true, team: true, network: false });
  assert.deepEqual(['hire', 'customer', 'partner', 'market', 'capital'].map((k) => ASK_MODULE[k as keyof typeof ASK_MODULE].label),
    ['Team expansion', 'Distribution', 'Partner network', 'Market expansion', 'Capital relationships']);
});

test('a role alone does not trigger Eadwyn; shipped and contact facts have sourced labels', async () => {
  const facts = periodFacts(buildMetrics([], [], '2026-10-01'), [{ title: 'Engineer', opened: '2026-10-01' }, { title: 'Future', opened: '2026-11-01' }],
    2, '2026-10-31');
  assert.equal(facts.length, 2);
  assert.equal(facts[0].source.label, 'Team expansion · Engineer open 30 days');
  assert.equal(facts[1].source.label, 'Distribution · customer contacts captured');
  assert.equal((await draftLines({} as any, 1, facts)).status, 'nothing');
  const shipped = periodFacts(buildMetrics([], [], '2026-10-01'), [], null, '2026-10-31',
    [{ kind: 'feedback', label: 'Onboarding', shipped_on: '2026-10-12', customers: 3 }]);
  assert.deepEqual([shipped[0].text, shipped[0].source.label, shipped[0].source.as_of],
    ['Onboarding shipped, asked for by 3 customers', 'Product improvement · Onboarding shipped 12 Oct', '2026-10-12']);
});

test('a kept metric with a figure but no source is dropped; a null stays null', () => {
  const kept = cleanMetrics([
    { key: 'mrr', label: 'MRR', unit: 'usd', value: 10, source: 'stripe', as_of: '2026-10-01' },
    { key: 'burn', label: 'Burn', unit: 'usd', value: 5 },
    { key: 'runway', label: 'Runway', unit: 'months', value: null },
    { key: 'invented', value: 1, source: 'x' },
  ]);
  assert.deepEqual(kept.map((x) => [x.key, x.value]), [['mrr', 10], ['runway', null]]);
});

test('every highlight carries a source: a line without one is refused', () => {
  assert.deepEqual(cleanLines([{ text: 'MRR up', source: { label: 'Stripe · MRR', as_of: '2026-10-12' } }], 'Highlight'),
    [{ text: 'MRR up', source: { label: 'Stripe · MRR', ref: null, as_of: '2026-10-12' } }]);
  assert.throws(() => cleanLines([{ text: 'MRR up' }], 'Highlight'), /names no source/);
  assert.throws(() => cleanLines([{ text: 'MRR up', source: { label: '  ' } }], 'Highlight'), /names no source/);
  assert.throws(() => cleanLines([{ source: { label: 'x' } }], 'Highlight'), /no text/);
});

test('Eadwyn\'s draft keeps only lines that cite a real fact, with that fact\'s source', () => {
  const facts = periodFacts(buildMetrics([snap('2026-10-12', { mrr: 38400 })], [], '2026-10-01'), [{ title: 'Engineer', opened: '2026-09-01' }], 3, '2026-10-31');
  assert.equal(facts.length, 3);
  const d = parseDraft(JSON.stringify({
    highlights: [{ text: 'MRR reached 38,400', fact: 0 }, { text: 'Invented', fact: 9 }, { text: 'No fact' }],
    lowlights: [{ text: 'Engineer still open', fact: 1 }],
  }), facts);
  assert.deepEqual(d.highlights.map((l) => l.text), ['MRR reached 38,400']);
  assert.ok([...d.highlights, ...d.lowlights].every((l) => l.source && l.source.label), 'every line has a source');
  assert.match(d.lowlights[0].source.label, /^Team expansion/);
  assert.deepEqual(parseDraft('not json', facts), { highlights: [], lowlights: [] });
  assert.deepEqual(periodFacts(buildMetrics([], [], '2026-10-01'), [], 0, '2026-10-31'), [], 'nothing new: no fact, so "Nothing new this month"');
});

test('the network gets the asks only unless the founder includes the metrics; never the highlights', () => {
  const u = { title: 'October', period_start: '2026-10-01', period_end: '2026-10-31', metrics: [{ key: 'mrr' }] as any,
    highlights: [{ text: 'h' }] as any, lowlights: [{ text: 'l' }] as any, asks: [{ kind: 'hire' }], network_includes_metrics: false };
  const net = payloadFor('network', u) as any;
  assert.deepEqual(Object.keys(net).sort(), ['asks', 'audience', 'period_end', 'period_start', 'title']);
  const netWith = payloadFor('network', { ...u, network_includes_metrics: true }) as any;
  assert.deepEqual(netWith.metrics, u.metrics);
  assert.equal(netWith.highlights, undefined);
  for (const a of ['investor', 'team'] as const) {
    const full = payloadFor(a, u) as any;
    assert.deepEqual([full.metrics, full.highlights, full.lowlights], [u.metrics, u.highlights, u.lowlights]);
  }
});

test('an ask can be asked again only after 14 days with no reply', () => {
  const sent = '2026-10-01T00:00:00Z'; const t0 = Date.parse(sent);
  assert.equal(ASK_AGAIN_DAYS, 14);
  assert.equal(canAskAgain(sent, 0, null, t0 + 13 * 86_400_000), false);
  assert.equal(canAskAgain(sent, 0, null, t0 + 14 * 86_400_000), true);
  assert.equal(canAskAgain(sent, 1, null, t0 + 30 * 86_400_000), false, 'an ask with a reply is not re-asked');
  assert.equal(canAskAgain(null, 0, null, t0 + 30 * 86_400_000), false);
  assert.equal(canAskAgain(sent, 0, '2026-10-20T00:00:00Z', t0 + 25 * 86_400_000), false, 'counts from the last ask');
});

// ── The routes ──────────────────────────────────────────────────────────────

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
                               jwt_min_iat INTEGER, name TEXT, email TEXT);
           CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, sector TEXT, stage TEXT,
                                  status TEXT, company_id INTEGER, deleted_at TEXT);
           CREATE TABLE pitch_decks (id INTEGER PRIMARY KEY);`);
  db.exec(ddl('125'));
  db.exec(file('437'));
  db.exec(ddl('001')); db.exec(ddl('252')); db.exec(ddl('443')); db.exec(ddl('436'));
  for (const p of ['119', '127', '128', '132']) db.exec(ddl(p));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount REAL');
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(INVESTOR, 'investor', null, 'Ivy', 'ivy@fund.example');
  u.run(TEAM, 'founder', 11, 'Tom', 'tom@co.example');
  u.run(NETWORK, 'founder', 12, 'Nia', 'nia@else.example');
  u.run(STRANGER, 'founder', 13, 'Sam', 'sam@else.example');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture', 10)`).run();
  db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, 'cofounder', 'accepted')`).run(TEAM);
  const pr = db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES (?, 7, ?, ?, ?)`);
  pr.run('rp1', 'Ivy', 'IVY@fund.example', 'contacted');
  pr.run('rp2', 'No Account', 'nobody@fund.example', 'meeting');
  pr.run('rp3', 'Passed', 'gone@fund.example', 'passed');
  db.prepare(`INSERT INTO job_postings (slug, host_user_id, project_id, title, status) VALUES ('eng', ?, 7, 'Engineer', 'open')`).run(FOUNDER);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  await ensureProjectMetricsSchema(env);
  db.prepare(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (7, '2026-10-12', 38400, 'stripe')`).run();
  // The Axal network: people following the company.
  const { ensureFollowsSchema } = await import('../src/routes/follows.ts');
  await ensureFollowsSchema(env);
  db.prepare(`INSERT INTO follows (follower_user_id, entity_type, entity_id) VALUES (?, 'project', 7)`).run(NETWORK);
  return db;
}

const app = new Hono<any>();
app.route('/api/portfolio-updates', updates);
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException() {} };

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown, vars: Record<string, unknown> = {}) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/portfolio-updates${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...vars } as any, ctx as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}

async function draftAndSend(db: DatabaseSync, share: Record<string, unknown>) {
  const created = await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'October', status: 'draft' });
  assert.equal(created.status, 201);
  const uid = created.body.uid;
  const ctxRes = await call(db, FOUNDER, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31');
  assert.equal(ctxRes.status, 200);
  const put = await call(db, FOUNDER, 'PUT', `/${uid}/share`, {
    period_start: '2026-10-01', period_end: '2026-10-31', metrics: ctxRes.body.metrics,
    highlights: [{ text: 'MRR reached $38,400', source: { label: 'Stripe · MRR', as_of: '2026-10-12' } }],
    lowlights: [], audience: { investors: true, team: true, network: true },
    asks: [{ kind: 'hire', text: 'A senior engineer', link_ref: String(ctxRes.body.open_roles[0].id) },
      { kind: 'customer', text: 'An intro to a logistics company' }, { kind: 'market', text: 'Someone in Spain' }],
    ...share,
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const sent = await call(db, FOUNDER, 'POST', `/${uid}/send`);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  return { uid, ctx: ctxRes.body, put: put.body, sent: sent.body };
}

test('the context fills metrics from Revenue and traction; a missing figure is null, not 0', async () => {
  const db = await fixture();
  const r = await call(db, FOUNDER, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31');
  const by = Object.fromEntries(r.body.metrics.map((m: any) => [m.key, m]));
  assert.deepEqual([by.mrr.value, by.mrr.source, by.mrr.as_of], [38400, 'stripe', '2026-10-12']);
  for (const k of ['growth', 'customers', 'burn', 'runway']) assert.equal(by[k].value, null, k);
  assert.equal(r.body.no_metrics, false);
  const empty = await call(db, FOUNDER, 'GET', '/share/context?project_id=7&period_start=2025-01-01&period_end=2025-01-31');
  assert.equal(empty.body.no_metrics, true);
  assert.ok(empty.body.metrics.every((m: any) => m.value === null));
  assert.deepEqual(r.body.audience, { investors: 2, team: 1, network: 1 }, 'a passed investor is not in the audience');
  assert.deepEqual(r.body.project, { id: 7, name: 'Venture' });
  assert.deepEqual([r.body.open_call, r.body.open_call_reason], [null, 'Coming soon. Round calls are not enabled.']);
  const enabled = await call(db, FOUNDER, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31', undefined, { ROUND_CALLS_ENABLED: 'true' });
  assert.deepEqual([enabled.body.open_call, enabled.body.open_call_reason], [null, 'No open Call for Capital']);
  db.exec(ddl('145'));
  db.prepare(`INSERT INTO round_calls (uid,project_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,terms_hash,created_by,state,sent_at)
    VALUES ('call1',7,'Seed call',100000,'safe','terms',1000,'2099-12-31','hash',1,'sent','2026-10-10')`).run();
  const open = await call(db, FOUNDER, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31', undefined, { ROUND_CALLS_ENABLED: 'true' });
  assert.deepEqual(open.body.open_call, { uid: 'call1', name: 'Seed call', target_close: '2099-12-31' });
  assert.equal(open.body.open_call_reason, null);
  const updateUid = (await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'Call update' })).body.uid;
  const linked = await call(db, FOUNDER, 'PUT', `/${updateUid}/share`,
    { asks: [{ kind: 'capital', text: 'Join the call' }] }, { ROUND_CALLS_ENABLED: 'true' });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.asks[0].link_ref, open.body.open_call.uid, 'context and saved ask choose the same open call');
  assert.equal((await call(db, STRANGER, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31')).status, 403);
});

test('shipped facts respect period, deduplicate roadmap moves, and omit linked feedback', async () => {
  const db = await fixture();
  db.exec(`INSERT INTO roadmap_okrs (id,project_id,objective,kanban_status) VALUES (10,7,'Launch search','done'),(11,7,'Older work','done');
    INSERT INTO okr_column_moves (project_id,okr_id,to_status,week_start,moved_at) VALUES
      (7,10,'done','2026-10-05','2026-10-10T10:00:00Z'),(7,10,'done','2026-10-12','2026-10-12T10:00:00Z'),
      (7,11,'done','2026-09-07','2026-09-10T10:00:00Z'),
      (7,11,'done','2026-11-02','2026-11-02T10:00:00Z');
    INSERT INTO product_feedback (uid,project_id,body,source,roadmap_item_ref,roadmap_item_label,theme,status,shipped_on,updated_at) VALUES
      ('f1',7,'Asked','customer','10','Launch search',NULL,'shipped','2026-10-11','2026-10-11'),
      ('f2',7,'Asked','customer',NULL,'Onboarding',NULL,'shipped','2026-10-14','2026-10-14'),
      ('f3',7,'Asked','customer',NULL,'Onboarding',NULL,'shipped',NULL,'2026-10-16'),
      ('f4',7,'Asked','customer',NULL,NULL,'Outside','shipped','2026-09-20','2026-10-16');`);
  const facts = await shippedItems({ DB: d1Over(db) } as any, 7, '2026-10-01', '2026-10-31');
  assert.deepEqual(facts, [
    { kind: 'roadmap', label: 'Launch search', shipped_on: '2026-10-12' },
    { kind: 'feedback', label: 'Onboarding', shipped_on: '2026-10-16', customers: 2 },
  ]);
  const sourced = periodFacts(buildMetrics([], [], '2026-10-01'), [], null, '2026-10-31', facts);
  assert.deepEqual(sourced.map((f) => f.source.label), ['Product roadmap · Launch search shipped 12 Oct', 'Product improvement · Onboarding shipped 16 Oct']);
});

test('send refuses an empty choice or empty selected group before writing a recipient or sent_at', async () => {
  const db = await fixture();
  const uid = (await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'Draft' })).body.uid;
  assert.equal((await call(db, FOUNDER, 'PUT', `/${uid}/share`, { audience: { investors: false, team: false, network: false } })).status, 200);
  assert.deepEqual(await call(db, FOUNDER, 'POST', `/${uid}/send`),
    { status: 400, body: { detail: 'Choose who receives this update', field: 'audience' } });
  db.exec('DELETE FROM follows');
  assert.equal((await call(db, FOUNDER, 'PUT', `/${uid}/share`, { audience: { investors: false, team: false, network: true } })).status, 200);
  assert.deepEqual(await call(db, FOUNDER, 'POST', `/${uid}/send`),
    { status: 400, body: { detail: 'Nobody is in the audience you chose yet', field: 'audience' } });
  assert.deepEqual((db.prepare('SELECT sent_at FROM portfolio_updates WHERE uid = ?').get(uid) as any).sent_at, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM update_recipients').get() as any).n, 0);
});

test('a partial send retries without reinserting or notifying an existing recipient', async () => {
  const db = await fixture();
  const uid = (await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'Draft' })).body.uid;
  await call(db, FOUNDER, 'PUT', `/${uid}/share`, { audience: { investors: true, team: false, network: false } });
  const id = (db.prepare('SELECT id FROM portfolio_updates WHERE uid = ?').get(uid) as any).id;
  db.prepare("INSERT INTO update_recipients (update_id,audience,user_id,email,delivered_via) VALUES (?, 'investor', ?, 'ivy@fund.example', 'notification')").run(id, INVESTOR);
  const sent = await call(db, FOUNDER, 'POST', `/${uid}/send`);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual([sent.body.recipients, sent.body.delivered], [2, 1]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM update_recipients WHERE user_id = ?').get(INVESTOR) as any).n, 1);
  const inboxExists = db.prepare("SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = 'notifications_inbox'").get();
  assert.equal(inboxExists ? (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ?').get(INVESTOR) as any).n : 0, 0);
});

test('a co-founder can author and send; owner gets the team copy; advisor and partner cannot share', async () => {
  const db = await fixture();
  db.prepare("INSERT INTO users (id,role,founder_id,name,email) VALUES (6,'founder',14,'Adviser','adviser@example.test'),(7,'partner',NULL,'Staff','staff@example.test')").run();
  db.prepare("INSERT INTO project_members (project_id,user_id,role,status) VALUES (7,6,'advisor','accepted')").run();
  for (const id of [6, 7, INVESTOR]) {
    const context = await call(db, id, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31');
    assert.deepEqual(context, { status: 403, body: { detail: 'You can read this venture but not share its updates.', code: 'share_not_allowed' } });
    const create = await call(db, id, 'POST', '', { project_id: 7, title: 'Forbidden' });
    assert.equal(create.status, 403);
    assert.equal(create.body.code, 'share_not_allowed');
  }
  const context = await call(db, TEAM, 'GET', '/share/context?project_id=7&period_start=2026-10-01&period_end=2026-10-31');
  assert.equal(context.status, 200);
  assert.equal(context.body.audience.team, 2, 'owner and advisor are members of the selected team');
  const draft = await call(db, TEAM, 'POST', '/share/draft-lines', { project_id: 7, period_start: '2025-01-01', period_end: '2025-01-31' });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.status, 'nothing');
  const created = await call(db, TEAM, 'POST', '', { project_id: 7, title: 'Team authored' });
  assert.equal(created.status, 201);
  const uid = created.body.uid;
  assert.equal((await call(db, TEAM, 'PUT', `/${uid}/share`, { audience: { investors: false, team: true, network: false } })).status, 200);
  assert.equal((await call(db, TEAM, 'POST', `/${uid}/send`)).status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM update_recipients WHERE audience = ? AND user_id = ?').get('team', FOUNDER) as any).n, 1);
  assert.equal((await call(db, FOUNDER, 'GET', `/${uid}/page`)).status, 200);
});

test('author page names team recipients, records replies, and aggregates network readers anonymously', async () => {
  const db = await fixture();
  const { uid } = await draftAndSend(db, {});
  const first = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  const customer = first.body.asks.find((a: any) => a.kind === 'customer');
  assert.equal((await call(db, INVESTOR, 'POST', `/asks/${customer.uid}/replies`, { message: 'An intro' })).status, 201);
  assert.equal((await call(db, NETWORK, 'POST', `/asks/${customer.uid}/replies`, { message: 'Another intro' })).status, 201);
  await call(db, NETWORK, 'GET', `/${uid}/page`);
  const page = (await call(db, FOUNDER, 'GET', `/${uid}/page`)).body;
  assert.equal(page.project_id, 7);
  assert.deepEqual(page.audience, { investors: true, team: true, network: true });
  assert.equal(page.recipients.find((r: any) => r.user_id === TEAM).label, 'Tom');
  assert.equal(page.recipients.find((r: any) => r.user_id === INVESTOR).replied, true);
  assert.equal(page.recipients.find((r: any) => r.user_id === TEAM).replied, false);
  assert.equal(page.recipients.some((r: any) => r.audience === 'network'), false);
  assert.deepEqual(page.network, { sent: 1, opened: 1, replied: 1 });
  assert.equal(JSON.stringify(page.network).includes('user_id'), false);
  const recipient = (await call(db, INVESTOR, 'GET', `/${uid}/page`)).body;
  assert.equal(Object.hasOwn(recipient, 'project_id'), false);
  assert.equal(typeof recipient.audience, 'string');
});

test('a highlight with no source is refused, and nothing is saved', async () => {
  const db = await fixture();
  const uid = (await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'October', status: 'draft' })).body.uid;
  const bad = await call(db, FOUNDER, 'PUT', `/${uid}/share`, { highlights: [{ text: 'We grew' }] });
  assert.deepEqual([bad.status, bad.body.field], [400, 'lines']);
  const row = db.prepare('SELECT highlights_json FROM portfolio_updates WHERE uid = ?').get(uid) as any;
  assert.equal(row.highlights_json, null);
  const update = (db.prepare('SELECT id FROM portfolio_updates WHERE uid = ?').get(uid) as any).id;
  assert.throws(() => db.prepare(`INSERT INTO update_asks (uid, update_id, kind, text) VALUES ('x', ?, 'investor', 't')`).run(update),
    /CHECK constraint failed/, 'migration 437 allows only the five kinds');
  assert.equal((await call(db, FOUNDER, 'PUT', `/${uid}/share`, { asks: [{ kind: 'investor', text: 'x' }] })).status, 400);
  const badAsk = await call(db, FOUNDER, 'PUT', `/${uid}/share`, { asks: [{ kind: 'hire', text: 'x', link_ref: '999' }] });
  assert.equal(badAsk.status, 400, 'a hire links to one of the company\'s own open roles');
  const badMarket = await call(db, FOUNDER, 'PUT', `/${uid}/share`, { asks: [{ kind: 'market', text: 'Spain', link_ref: '5' }] });
  assert.equal(badMarket.status, 400, 'D664: a market ask links to one of the company\'s own markets');
  assert.equal((await call(db, FOUNDER, 'PUT', `/${uid}/share`, { asks: [{ kind: 'market', text: 'Spain' }] })).status, 200, 'or to none');
});

test('a network recipient never receives the metrics unless the founder included them', async () => {
  const db = await fixture();
  const { uid } = await draftAndSend(db, {});
  const net = await call(db, NETWORK, 'GET', `/${uid}/page`);
  assert.equal(net.status, 200);
  assert.equal(net.body.metrics, undefined);
  assert.equal(net.body.highlights, undefined);
  assert.equal(net.body.asks.length, 3);
  assert.doesNotMatch(JSON.stringify(net.body), /38400|Stripe · MRR/);
  const inv = await call(db, INVESTOR, 'GET', `/${uid}/page`);
  assert.equal(inv.body.metrics.find((m: any) => m.key === 'mrr').value, 38400);
  assert.equal(inv.body.highlights.length, 1);
  const team = await call(db, TEAM, 'GET', `/${uid}/page`);
  assert.equal(team.body.highlights.length, 1);

  const db2 = await fixture();
  const withMetrics = await draftAndSend(db2, { network_includes_metrics: true });
  const net2 = await call(db2, NETWORK, 'GET', `/${withMetrics.uid}/page`);
  assert.equal(net2.body.metrics.find((m: any) => m.key === 'mrr').value, 38400);
  assert.equal(net2.body.highlights, undefined, 'the network never gets the highlights');
});

test('send records each recipient; an investor with no account is not delivered, and a stranger cannot read it', async () => {
  const db = await fixture();
  const { uid, sent } = await draftAndSend(db, {});
  assert.deepEqual([sent.recipients, sent.not_delivered], [4, 1]);
  const rows = db.prepare('SELECT audience, user_id, delivered_via, not_delivered_reason FROM update_recipients ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => r.audience), ['investor', 'investor', 'team', 'network']);
  const none = rows.find((r) => r.user_id == null);
  assert.equal(none.delivered_via, null);
  assert.match(none.not_delivered_reason, /No Axal account/);
  assert.equal((await call(db, STRANGER, 'GET', `/${uid}/page`)).status, 403);
  assert.equal((await call(db, FOUNDER, 'POST', `/${uid}/send`)).status, 409, 'sent once');
  // Opening records the open.
  await call(db, INVESTOR, 'GET', `/${uid}/page`);
  const page = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  assert.ok(page.body.recipients.find((r: any) => r.user_id === INVESTOR).opened_at);
  assert.equal(page.body.recipients.find((r: any) => r.user_id === TEAM).opened_at, null);
  assert.deepEqual(page.body.sent_to, { investors: 2, team: 1, network: 1 });
});

test('a reply reaches its module: a hire becomes a candidate, a customer a contact; a market reply with no market link stays with its reason', async () => {
  const db = await fixture();
  const { uid } = await draftAndSend(db, {});
  const page = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  const ask = (k: string) => page.body.asks.find((a: any) => a.kind === k).uid;
  const hire = await call(db, NETWORK, 'POST', `/asks/${ask('hire')}/replies`, { message: 'Try Lee', name: 'Lee', email: 'lee@dev.example' });
  assert.deepEqual([hire.status, hire.body.landed_module], [201, 'talent']);
  const app = db.prepare('SELECT posting_id, email, cover_note FROM job_applications').get() as any;
  assert.equal(app.email, 'lee@dev.example');
  assert.match(app.cover_note, /Try Lee/);
  const cust = await call(db, INVESTOR, 'POST', `/asks/${ask('customer')}/replies`, { message: 'I know Acme', email: 'buyer@acme.example' });
  assert.equal(cust.body.landed_module, 'customers');
  const contact = db.prepare('SELECT audience, email, source FROM contacts').get() as any;
  assert.deepEqual([contact.audience, contact.email, contact.source], ['customer', 'buyer@acme.example', 'update_ask']);
  const market = await call(db, TEAM, 'POST', `/asks/${ask('market')}/replies`, { message: 'Ana in Madrid' });
  assert.equal(market.body.landed_module, null);
  assert.match(market.body.landed_reason, /linked to no market/, 'D664: an ask linked to no market keeps its reply');
  assert.equal((await call(db, STRANGER, 'POST', `/asks/${ask('hire')}/replies`, { message: 'x' })).status, 403, 'only a recipient replies');
  const after = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  assert.equal(after.body.asks.find((a: any) => a.kind === 'hire').replies.length, 1);
});

test('"Ask again" is offered only after 14 days with no reply', async () => {
  const db = await fixture();
  const { uid } = await draftAndSend(db, {});
  const page = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  const market = page.body.asks.find((a: any) => a.kind === 'market');
  assert.equal(market.can_ask_again, false);
  assert.equal((await call(db, FOUNDER, 'POST', `/asks/${market.uid}/ask-again`)).status, 409);
  db.prepare(`UPDATE portfolio_updates SET sent_at = '2026-01-01T00:00:00Z' WHERE uid = ?`).run(uid);
  const later = await call(db, FOUNDER, 'GET', `/${uid}/page`);
  assert.equal(later.body.asks.find((a: any) => a.kind === 'market').can_ask_again, true);
  const again = await call(db, FOUNDER, 'POST', `/asks/${market.uid}/ask-again`);
  assert.equal(again.status, 200);
  assert.equal((await call(db, NETWORK, 'POST', `/asks/${market.uid}/ask-again`)).status, 403);
});

test('with no metrics the update still sends, with the metrics left out', async () => {
  const db = await fixture();
  db.exec('DELETE FROM project_metrics');
  const { uid, sent } = await draftAndSend(db, { metrics: [] });
  assert.equal(sent.recipients, 4);
  const inv = await call(db, INVESTOR, 'GET', `/${uid}/page`);
  assert.deepEqual(inv.body.metrics, []);
});

test('the sent update appears in Raise as an investor update sent, from the same row', async () => {
  const db = await fixture();
  db.exec(ddl('145'));
  const { uid } = await draftAndSend(db, {});
  await call(db, FOUNDER, 'POST', '', { project_id: 7, title: 'An unsent draft', status: 'draft' });
  const { default: contacts } = await import('../src/routes/contacts.ts');
  const raise = new Hono<any>();
  raise.route('/api/contacts', contacts);
  const token = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await raise.fetch(new Request('http://t/api/contacts/raise-updates?project_id=7', { headers: { Authorization: `Bearer ${token}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 300));
  const body = JSON.parse(text);
  assert.equal(body.shared_updates.length, 1);
  assert.deepEqual([body.shared_updates[0].uid, body.shared_updates[0].source, body.shared_updates[0].investors, body.shared_updates[0].delivered],
    [uid, 'share_update', 2, 1]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM portfolio_updates').get() as any).n, 2, 'no copy: the sent row and the draft');
});
