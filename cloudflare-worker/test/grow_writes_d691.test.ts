/**
 * D691 (S19-A, #1697) — migration 462, Grow's writes and its lists, on real
 * SQLite. The database is the production baseline plus every numbered
 * migration above BASELINE_CUTOFF, in order, as `migrations_fresh_build.test.ts`
 * builds it, with foreign keys on, as D1 runs them. Every venture, customer,
 * partner and applicant below is made up.
 *
 * Tests 3, 4 and 5 are the task's (#1697); 1 and 2 are #1696's, 6-9 #1698's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_writes_d691.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow, { shapeRecords } from '../src/routes/cycle_grow.ts';
import jobs from '../src/routes/jobs.ts';
import { RECORD_ID } from '../src/services/records/owned.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const M462 = '462_grow_record_stores.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const FOUNDER = 1; const COFOUNDER = 2; const ADVISOR = 3; const PARTNER = 4; const ADMIN = 5; const OTHER = 6;
const PA = 7; const PB = 8;

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort();

/** The baseline plus every post-cutoff migration, stopping before `upTo` when given. */
function build(upTo?: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASELINE);
  for (const name of newer) {
    if (upTo && name >= upTo) break;
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  return db;
}

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');`);
  const u = db.prepare('INSERT INTO users (id, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?)');
  u.run(FOUNDER, 'founder@example.test', 'Fay Founder', 'founder', 10);
  u.run(COFOUNDER, 'cofounder@example.test', 'Cal Cofounder', 'founder', null);
  u.run(ADVISOR, 'advisor@example.test', 'Ada Advisor', 'founder', null);
  u.run(PARTNER, 'partner@example.test', 'Pat Partner', 'partner', null);
  u.run(ADMIN, 'admin@example.test', 'Ari Admin', 'admin', null);
  u.run(OTHER, 'other@example.test', 'Oli Other', 'founder', 20);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO roadmap_okrs (id, project_id, objective) VALUES (1, ${PA}, 'CSV export'), (2, ${PB}, 'Heron item');
    INSERT OR IGNORE INTO research_countries (code, name, region) VALUES ('ES', 'Spain', 'Europe');`);
}

function fixture() {
  const db = build();
  seed(db);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/jobs', jobs);
const ROLE: Record<number, string> = { [FOUNDER]: 'founder', [COFOUNDER]: 'founder', [ADVISOR]: 'founder', [PARTNER]: 'partner', [ADMIN]: 'admin', [OTHER]: 'founder' };

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const grow = (f: any, who: number, method: string, path: string, body: Record<string, unknown> = {}) =>
  call(f, who, method, `/api/cycles/grow${path}`, { project: PA, ...body });
const list = (f: any, slug: string, qs = '', who = FOUNDER) => call(f, who, 'GET', `/api/cycles/grow/modules/${slug}?project=${PA}${qs}`);
const plain = (r: any) => (r == null ? r : { ...r });
const one = (f: any, sql: string, ...args: any[]) => plain(f.db.prepare(sql).get(...args)) as any;
const all = (f: any, sql: string, ...args: any[]) => (f.db.prepare(sql).all(...args) as any[]).map(plain);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Test 3 — migration 462
// ---------------------------------------------------------------------------

const sql462 = readFileSync(resolve(M, M462), 'utf8');
const added = [...sql462.matchAll(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/gm)].map((m) => [m[1], m[2]] as const);
const created = [...sql462.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(/gm)].map((m) => m[1]).filter((t) => t !== 'growth_partners');

test('3: migration 462 applies over a fresh build, and adds nothing that already existed', () => {
  assert.ok(newer.includes(M462));
  assert.equal(added.length, 16, 'the sixteen ADD COLUMNs');
  assert.deepEqual(created.sort(), ['channel_experiments', 'custom_kpi_values', 'custom_kpis', 'growth_partner_deals', 'kpi_alerts',
    'market_entry_steps', 'market_localisation', 'obligation_agenda_items', 'obligation_occurrences']);
  const before = build(M462);
  for (const [table, col] of added) {
    const cols = (before.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
    assert.ok(cols.length > 0, `${table} exists before 462`);
    assert.ok(!cols.includes(col), `${table}.${col} did not exist before 462`);
  }
  for (const t of created) {
    assert.equal(before.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), undefined, `${t} is new`);
  }
  // The grep the task asks for (D-t): no earlier file names the columns or the tables.
  const earlier = [BASELINE, ...newer.filter((n) => n < M462).map((n) => readFileSync(resolve(M, n), 'utf8'))].join('\n');
  for (const name of [...created, 'from_company', 'notify_on_ship', 'told_via', 'cac_bar_cents', 'comp_min_cents', 'terms_amount_cents', 'remind_days_json', 'geography_ref']) {
    assert.doesNotMatch(earlier, new RegExp(`\\b${name}\\b`), `${name} appears in no earlier file`);
  }
  const after = build();
  for (const [table, col] of added) {
    assert.ok((after.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((c) => c.name === col), `${table}.${col} after 462`);
  }
  assert.equal(after.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_pre462_snapshot'").get()!.n, 0, 'the snapshots are dropped');
  assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
});

test('3: the growth_partners rebuild keeps every partner\'s id and uid and every revenue row, and admits Co-marketing and Paused', () => {
  const db = build(M462);
  seed(db);
  db.exec(`INSERT INTO growth_partners (id, uid, project_id, name, type, stage, terms, created_by) VALUES
      (3, 'gp3', ${PA}, 'Harbour Reseller', 'reseller', 'signed', '20% of the first year', ${FOUNDER}),
      (9, 'gp9', ${PA}, 'Lantern Agency', 'agency', 'talking', NULL, NULL),
      (11, 'gp11', ${PB}, 'Other venture partner', 'other', 'ended', NULL, NULL);
    INSERT INTO partner_revenue (id, partner_id, month, amount_cents, recorded_by) VALUES
      (5, 3, '2026-08', 120000, ${FOUNDER}), (6, 3, '2026-09', 90000, ${FOUNDER}), (8, 9, '2026-09', 4000, NULL);`);
  assert.throws(() => db.exec(`INSERT INTO growth_partners (uid, project_id, name, type) VALUES ('x', ${PA}, 'X', 'co_marketing')`), /CHECK constraint failed/,
    'before 462 Co-marketing is refused');
  const partners = db.prepare('SELECT id, uid, project_id, name, type, stage, terms, created_by, created_at, updated_at FROM growth_partners ORDER BY id').all();
  const revenue = db.prepare('SELECT * FROM partner_revenue ORDER BY id').all();
  db.exec(sql462);
  assert.deepEqual(db.prepare('SELECT id, uid, project_id, name, type, stage, terms, created_by, created_at, updated_at FROM growth_partners ORDER BY id').all(), partners);
  assert.deepEqual(db.prepare('SELECT * FROM partner_revenue ORDER BY id').all(), revenue, 'the cascade the DROP fired is undone, ids kept');
  db.exec(`INSERT INTO growth_partners (uid, project_id, name, type, stage) VALUES ('cm', ${PA}, 'Co-marketer', 'co_marketing', 'paused')`);
  assert.equal(db.prepare("SELECT stage FROM growth_partners WHERE uid = 'cm'").get()!.stage, 'paused');
  assert.throws(() => db.exec(`UPDATE growth_partners SET terms_pct = 20, terms_amount_cents = 400000 WHERE id = 3`), /CHECK constraint failed/,
    'a percentage and an amount never both');
  // The parent key still cascades after the rebuild.
  db.exec(`INSERT INTO growth_partner_deals (uid, partner_id, customer) VALUES ('d1', 9, 'Example customer')`);
  db.exec('DELETE FROM growth_partners WHERE id = 9');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_revenue WHERE partner_id = 9').get()!.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM growth_partner_deals').get()!.n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

// ---------------------------------------------------------------------------
// Test 4 — the writes
// ---------------------------------------------------------------------------

test('4: Add channel derives the UTM source from the name, a clash gets -2, kind and bar round-trip, and the spend lands this month', async () => {
  const f = fixture();
  const a = await grow(f, FOUNDER, 'POST', '/channels', { name: 'Paid Search (EU)', kind: 'paid_search', cac_bar_cents: 20000, bar_currency: 'EUR', spend_cents: 150000 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.utm_source, 'paid-search-eu');
  const b = await grow(f, FOUNDER, 'POST', '/channels', { name: 'Paid search EU' });
  assert.equal(b.body.utm_source, 'paid-search-eu-2');
  const c = await grow(f, FOUNDER, 'POST', '/channels', { name: 'paid-search-eu' });
  assert.equal(c.body.utm_source, 'paid-search-eu-3');
  const row = one(f, 'SELECT id, kind, cac_bar_cents, bar_currency FROM growth_channels WHERE uid = ?', a.body.uid);
  assert.deepEqual([row.kind, row.cac_bar_cents, row.bar_currency], ['paid_search', 20000, 'eur']);
  const spend = one(f, 'SELECT month, spend_cents, source FROM channel_spend WHERE channel_id = ?', row.id);
  assert.deepEqual([spend.month, spend.spend_cents, spend.source], [new Date().toISOString().slice(0, 7), 150000, 'manual']);
  assert.equal(one(f, 'SELECT bar_currency FROM growth_channels WHERE uid = ?', b.body.uid).bar_currency, null, 'no currency without an amount');
  // An explicit UTM source that clashes is still a 409, and writes nothing.
  const clash = await grow(f, FOUNDER, 'POST', '/channels', { name: 'Again', utm_source: 'paid-search-eu', spend_cents: 100 });
  assert.equal(clash.status, 409);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM growth_channels WHERE name = 'Again'").n, 0);
  const edit = await grow(f, FOUNDER, 'PATCH', `/channels/${b.body.uid}`, { kind: 'content', cac_bar_cents: 9000, spend_cents: 2500 });
  assert.equal(edit.status, 200);
  const edited = one(f, 'SELECT id, kind, cac_bar_cents, bar_currency FROM growth_channels WHERE uid = ?', b.body.uid);
  assert.deepEqual([edited.kind, edited.cac_bar_cents, edited.bar_currency], ['content', 9000, 'usd']);
  assert.equal(one(f, 'SELECT spend_cents FROM channel_spend WHERE channel_id = ?', edited.id).spend_cents, 2500);
  assert.equal((await grow(f, FOUNDER, 'POST', '/channels', { name: 'Bad', kind: 'billboards' })).status, 400);
});

test('4: partner terms keep a percentage and an amount in their own columns; both answer 400; free-text terms still save', async () => {
  const f = fixture();
  const p = await grow(f, FOUNDER, 'POST', '/partners', { name: 'Harbour Reseller', type: 'co_marketing', stage: 'paused', terms_kind: 'rev_share', terms_pct: 20,
    contact_name: 'Example Contact', contact_email: 'Contact@Example.test', renewal_on: '2027-03-01' });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const q = await grow(f, FOUNDER, 'POST', '/partners', { name: 'Lantern Agency', type: 'agency', terms_kind: 'services_fee', terms_amount_cents: 400000, terms_currency: 'eur' });
  assert.equal(q.status, 201);
  const pr = one(f, 'SELECT * FROM growth_partners WHERE uid = ?', p.body.uid);
  assert.deepEqual([pr.type, pr.stage, pr.terms_kind, pr.terms_pct, pr.terms_amount_cents, pr.terms_currency, pr.contact_email, pr.renewal_on],
    ['co_marketing', 'paused', 'rev_share', 20, null, null, 'contact@example.test', '2027-03-01']);
  const qr = one(f, 'SELECT terms_pct, terms_amount_cents, terms_currency FROM growth_partners WHERE uid = ?', q.body.uid);
  assert.deepEqual([qr.terms_pct, qr.terms_amount_cents, qr.terms_currency], [null, 400000, 'eur']);
  const both = await grow(f, FOUNDER, 'POST', '/partners', { name: 'Both', type: 'other', terms_pct: 10, terms_amount_cents: 100 });
  assert.equal(both.status, 400);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM growth_partners WHERE name = 'Both'").n, 0);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/partners/${p.body.uid}`, { terms_pct: 5, terms_amount_cents: 5 })).status, 400);
  // Switching to an amount clears the percentage, so the row never holds both.
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/partners/${p.body.uid}`, { terms_amount_cents: 250000 })).status, 200);
  const sw = one(f, 'SELECT terms_pct, terms_amount_cents, terms_currency FROM growth_partners WHERE uid = ?', p.body.uid);
  assert.deepEqual([sw.terms_pct, sw.terms_amount_cents, sw.terms_currency], [null, 250000, 'usd']);
  const legacy = await grow(f, FOUNDER, 'POST', '/partners', { name: 'Old form', type: 'referral', terms: '10% of the first deal' });
  assert.equal(legacy.status, 201);
  const rows = (await list(f, 'partner-network')).body.records.rows;
  assert.equal(rows.find((r: any) => r.id === legacy.body.uid).terms, '10% of the first deal', 'free text shows when no terms are typed');
  assert.equal(rows.find((r: any) => r.id === q.body.uid).terms, 'Services fee · EUR 4,000');
});

test('4: Enter a KPI writes where the platform keeps it, refuses what it works out itself, and never takes another venture\'s custom KPI', async () => {
  const f = fixture();
  const on = day(-3);
  const mrr = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'mrr', value: 12500, as_of: on });
  assert.equal(mrr.status, 201, JSON.stringify(mrr.body));
  assert.deepEqual([mrr.body.id, mrr.body.source], ['mrr', 'manual']);
  const customers = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'paying_accounts', value: 42, as_of: on });
  assert.equal(customers.status, 201);
  const rows = all(f, 'SELECT snapshot_date, source, mrr, paying_accounts, created_by FROM project_metrics WHERE project_id = ?', PA);
  assert.deepEqual(rows, [{ snapshot_date: on, source: 'manual', mrr: 12500, paying_accounts: 42, created_by: FOUNDER }], 'the same day updates that day\'s manual row');
  for (const as_of of [undefined, '', '2026-02-30', 'yesterday']) {
    const r = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'mrr', value: 1, as_of });
    assert.deepEqual([r.status, r.body.field], [400, 'as_of'], `as_of ${as_of}`);
  }
  assert.deepEqual([(await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'expansion_mrr', value: 1, as_of: on })).body.detail], ['Expansion MRR is worked out from the revenue ledger.']);
  assert.deepEqual([(await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'runway', value: 1, as_of: on })).body.detail], ['Runway is worked out from cash and burn.']);
  assert.equal((await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'churn', value: 140, as_of: on })).status, 400, 'a percentage is 0 to 100');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM project_metrics').n, 1, 'no refusal wrote a row');

  const custom = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', label: 'Weekly demos', unit: 'count', value: 9, as_of: on });
  assert.equal(custom.status, 201);
  assert.match(custom.body.id, /^custom-[a-f0-9]{32}$/);
  const again = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', label: 'WEEKLY DEMOS', value: 11, as_of: day(-1) });
  assert.equal(again.body.id, custom.body.id, 'the same name in another case reuses the KPI');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM custom_kpis').n, 1);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM custom_kpi_values').n, 2);
  const money = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', label: 'Pipeline', unit: 'money', value: 1234.5, as_of: on });
  assert.deepEqual(one(f, 'SELECT value, value_cents FROM custom_kpi_values v JOIN custom_kpis k ON k.id = v.kpi_id WHERE k.label = ?', 'Pipeline'), { value: null, value_cents: 123450 });
  assert.equal(money.status, 201);
  assert.equal((await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', value: 1, as_of: on })).body.field, 'label', 'Custom needs a name');

  const theirs = await call(f, OTHER, 'POST', '/api/cycles/grow/kpis', { project: PB, kpi: 'custom', label: 'Heron KPI', value: 1, as_of: on });
  assert.equal(theirs.status, 201);
  const cross = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: theirs.body.id, value: 5, as_of: on });
  assert.equal(cross.status, 404, 'another venture\'s custom KPI');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM custom_kpi_values v JOIN custom_kpis k ON k.id = v.kpi_id WHERE k.project_id = ?', PB).n, 1);
  assert.equal((await grow(f, FOUNDER, 'POST', '/kpis', { kpi: custom.body.id, value: 13, as_of: on })).status, 201);
  assert.equal(one(f, 'SELECT value FROM custom_kpi_values WHERE as_of = ? AND kpi_id = (SELECT id FROM custom_kpis WHERE label = ?)', on, 'Weekly demos').value, 13);
});

test('4: Open a role goes through createPosting with the caller as host; publish sends it for review and it stays on Team expansion', async () => {
  const f = fixture();
  const r = await grow(f, COFOUNDER, 'POST', '/roles', { title: 'Fractional CFO', team: 'Finance', type: 'fractional', target_start: '2027-01',
    comp_min_cents: 9_000_000, comp_max_cents: 12_000_000, comp_currency: 'EUR', equity_pct: 0.5, publish: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'pending_review');
  const row = one(f, 'SELECT * FROM job_postings WHERE id = ?', r.body.id);
  assert.deepEqual([row.host_user_id, row.project_id, row.employment_type, row.team, row.target_start, row.comp_min_cents, row.comp_max_cents, row.comp_currency, row.equity_pct, row.slug],
    [COFOUNDER, PA, 'fractional', 'Finance', '2027-01', 9_000_000, 12_000_000, 'eur', 0.5, 'fractional-cfo']);
  const listed = (await list(f, 'team-expansion')).body.records.rows;
  assert.deepEqual(listed.map((x: any) => [x.id, x.status, x.state]), [[r.body.id, 'pending_review', 'Pending review']]);
  assert.equal((await grow(f, FOUNDER, 'POST', '/roles', { title: 'Intern', type: 'intern' })).status, 400, 'Open a role takes four types');
  assert.equal((await grow(f, FOUNDER, 'POST', '/roles', { title: 'Odd', type: 'gig' })).status, 400);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM job_postings WHERE title IN ('Intern', 'Odd')").n, 0);
  assert.equal((await grow(f, FOUNDER, 'POST', '/roles', { title: 'Band', comp_min_cents: 10, comp_max_cents: 5 })).status, 400);

  // The host opens a draft; a co-founder who is not its host cannot send it for review.
  const draft = await grow(f, FOUNDER, 'POST', '/roles', { title: 'Engineer', team: 'Product' });
  assert.deepEqual([draft.status, draft.body.status], [201, 'draft']);
  assert.equal(one(f, 'SELECT employment_type FROM job_postings WHERE id = ?', draft.body.id).employment_type, 'full_time');
  const refused = await grow(f, COFOUNDER, 'PATCH', `/roles/${draft.body.id}`, { publish: true, team: 'Platform' });
  assert.equal(refused.status, 403);
  const still = one(f, 'SELECT status, team FROM job_postings WHERE id = ?', draft.body.id);
  assert.deepEqual([still.status, still.team], ['draft', 'Product'], 'the refusal writes nothing');
  const host = await grow(f, FOUNDER, 'PATCH', `/roles/${draft.body.id}`, { publish: true, type: 'contract' });
  assert.deepEqual([host.status, host.body.status], [200, 'pending_review']);
  const other = await grow(f, COFOUNDER, 'POST', '/roles', { title: 'Designer' });
  const admin = await grow(f, ADMIN, 'PATCH', `/roles/${other.body.id}`, { publish: true });
  assert.deepEqual([admin.status, admin.body.status], [200, 'pending_review'], 'an admin submits any posting');
  // Editing without publishing is the venture's writers' (as today).
  assert.equal((await grow(f, COFOUNDER, 'PATCH', `/roles/${draft.body.id}`, { team: 'Platform' })).status, 200);
});

test('4: POST /api/jobs behaves as before, through the same createPosting', async () => {
  const f = fixture();
  const a = await call(f, FOUNDER, 'POST', '/api/jobs', { title: 'Founding Engineer', project_id: PA, employment_type: 'fractional', remote: true });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual([a.body.job.status, a.body.job.employment_type, a.body.job.remote, a.body.job.slug], ['draft', 'fractional', true, 'founding-engineer']);
  const b = await call(f, FOUNDER, 'POST', '/api/jobs', { title: 'Founding Engineer', project_id: PA, employment_type: 'freelance' });
  assert.deepEqual([b.body.job.slug, b.body.job.employment_type], ['founding-engineer-2', 'full_time'], 'the board still normalises its own types');
  assert.equal((await call(f, FOUNDER, 'POST', '/api/jobs', { title: 'No project' })).status, 400);
  assert.equal((await call(f, COFOUNDER, 'POST', `/api/jobs/${a.body.job.id}/submit-review`)).status, 403, 'only its host or an admin');
  assert.equal((await call(f, FOUNDER, 'POST', `/api/jobs/${a.body.job.id}/submit-review`)).body.job.status, 'pending_review');
  assert.equal((await call(f, COFOUNDER, 'POST', `/api/jobs/${a.body.job.id}/close`)).status, 403);
  assert.equal((await call(f, FOUNDER, 'POST', `/api/jobs/${a.body.job.id}/close`)).body.job.status, 'closed');
});

test('4: feedback takes company, notify and a roadmap item of this venture; another venture\'s answers 404; the PATCH changes the email', async () => {
  const f = fixture();
  const fb = await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Export to CSV please', source: 'customer', from_name: 'Example Customer',
    from_email: 'Customer@Example.test', from_company: 'Example Co', theme: 'Exports', roadmap_item_ref: 1, notify_on_ship: true });
  assert.equal(fb.status, 201, JSON.stringify(fb.body));
  const row = one(f, 'SELECT * FROM product_feedback WHERE uid = ?', fb.body.uid);
  assert.deepEqual([row.from_company, row.from_email, row.notify_on_ship, row.roadmap_item_ref, row.roadmap_item_label], ['Example Co', 'customer@example.test', 1, '1', 'CSV export']);
  const cross = await grow(f, FOUNDER, 'POST', '/feedback', { body: 'x', source: 'team', roadmap_item_ref: 2 });
  assert.equal(cross.status, 404);
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/feedback/${fb.body.uid}`, { roadmap_item_ref: 2 })).status, 404);
  const label = await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Old form', source: 'team', roadmap_item_label: 'Typed item' });
  assert.equal(one(f, 'SELECT roadmap_item_label FROM product_feedback WHERE uid = ?', label.body.uid).roadmap_item_label, 'Typed item', 'a label with no ref still saves');
  const edit = await grow(f, FOUNDER, 'PATCH', `/feedback/${fb.body.uid}`, { from_email: 'New@Example.test', body: 'Export to CSV and XLSX', notify_on_ship: false });
  assert.equal(edit.status, 200);
  const after = one(f, 'SELECT from_email, body, notify_on_ship, roadmap_item_ref FROM product_feedback WHERE uid = ?', fb.body.uid);
  assert.deepEqual([after.from_email, after.body, after.notify_on_ship, after.roadmap_item_ref], ['new@example.test', 'Export to CSV and XLSX', 0, '1']);
});

test('4: markets take a Research country and a size; obligations take culture, repeats and reminders', async () => {
  const f = fixture();
  const m = await grow(f, FOUNDER, 'POST', '/markets', { name: 'Spain', geography_ref: 'es', size_cents: 5_000_000_00, size_source: 'Example survey' });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.deepEqual(one(f, 'SELECT geography_ref, size_cents, size_currency, size_source FROM markets WHERE uid = ?', m.body.uid),
    { geography_ref: 'ES', size_cents: 5_000_000_00, size_currency: 'usd', size_source: 'Example survey' });
  assert.equal((await grow(f, FOUNDER, 'POST', '/markets', { name: 'Atlantis', geography_ref: 'ZZ' })).status, 400);
  assert.equal((await grow(f, FOUNDER, 'POST', '/markets', { name: 'France', demand_score: 7 })).body.field, 'demand_source', 'a score still needs its source');
  const ob = await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Team offsite', kind: 'culture', due_at: day(40), repeats: 'yearly', remind_days: [14, 1] });
  assert.equal(ob.status, 201, JSON.stringify(ob.body));
  assert.deepEqual(one(f, 'SELECT event_type, kind, recurrence, remind_days_json FROM compliance_events WHERE id = ?', ob.body.id),
    { event_type: 'culture', kind: 'culture', recurrence: 'annual', remind_days_json: '[14,1]' });
  for (const remind_days of [[1, 2, 3, 4], [91], ['x'], 7]) {
    assert.equal((await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Bad', kind: 'risk', due_at: day(5), remind_days })).status, 400, JSON.stringify(remind_days));
  }
  assert.equal((await grow(f, FOUNDER, 'PATCH', `/obligations/${ob.body.id}`, { repeats: 'quarterly', remind_days: [] })).status, 200);
  assert.deepEqual(one(f, 'SELECT recurrence, remind_days_json FROM compliance_events WHERE id = ?', ob.body.id), { recurrence: 'quarterly', remind_days_json: null });
});

test('4: an advisor gets 403 on every new write; a partner (staff role) writes; another venture\'s founder gets 403', async () => {
  const f = fixture();
  const writes: Array<[string, string, Record<string, unknown>]> = [
    ['POST', '/kpis', { kpi: 'mrr', value: 1, as_of: day(-1) }],
    ['POST', '/roles', { title: 'Engineer' }],
    ['POST', '/channels', { name: 'Content', kind: 'content' }],
    ['POST', '/partners', { name: 'Partner', type: 'co_marketing' }],
    ['POST', '/markets', { name: 'Portugal', size_cents: 100 }],
    ['POST', '/obligations', { title: 'Board', kind: 'culture', due_at: day(9), repeats: 'monthly' }],
    ['POST', '/feedback', { body: 'Hi', source: 'team', from_company: 'Example Co' }],
  ];
  for (const [method, path, body] of writes) {
    assert.equal((await grow(f, ADVISOR, method, path, body)).status, 403, `advisor ${path}`);
    assert.equal((await call(f, OTHER, method, `/api/cycles/grow${path}`, { project: PA, ...body })).status, 403, `other venture ${path}`);
  }
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM activity_logs WHERE entity_type LIKE ?', 'grow.%').n, 0);
  for (const [method, path, body] of writes) {
    const r = await grow(f, PARTNER, method, path, body);
    assert.equal(r.status, 201, `partner ${path}: ${JSON.stringify(r.body)}`);
  }
});

test('4: every write logs one row with project_id, grow.<module> and the record id, and no summary names a person', async () => {
  const f = fixture();
  const fb = await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Faster sync', source: 'customer', from_name: 'Quinn Customer', from_email: 'q@example.test' });
  const ch = await grow(f, FOUNDER, 'POST', '/channels', { name: 'Referral loop' });
  const month = new Date().toISOString().slice(0, 7);
  await grow(f, FOUNDER, 'PUT', `/channels/${ch.body.uid}/spend/${month}`, { spend_cents: 1000 });
  const kpi = await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'net_burn', value: 30000, as_of: day(-2) });
  const role = await grow(f, FOUNDER, 'POST', '/roles', { title: 'Engineer' });
  f.db.exec(`INSERT INTO job_applications (id, posting_id, email, name) VALUES (40, ${role.body.id}, 'applicant@example.test', 'Robin Applicant')`);
  await grow(f, FOUNDER, 'PATCH', '/applications/40/stage', { stage: 'interview' });
  const pt = await grow(f, FOUNDER, 'POST', '/partners', { name: 'Example Partner', type: 'referral', contact_name: 'Casey Contact' });
  await grow(f, FOUNDER, 'PUT', `/partners/${pt.body.uid}/revenue/${month}`, { amount_cents: 5000 });
  const mk = await grow(f, FOUNDER, 'POST', '/markets', { name: 'Italy' });
  const ob = await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Board meeting', kind: 'governance', due_at: day(12) });
  await grow(f, FOUNDER, 'PUT', '/checklist/key_person_cover', { done: true });
  const logs = all(f, "SELECT project_id, entity_type, entity_id, action, details FROM activity_logs WHERE entity_type LIKE 'grow.%' ORDER BY id");
  assert.deepEqual(logs.map((l) => [l.project_id, l.entity_type, l.entity_id, l.action]), [
    [PA, 'grow.product-improvement', fb.body.uid, 'grow_feedback_logged'],
    [PA, 'grow.distribution', ch.body.uid, 'grow_channel_added'],
    [PA, 'grow.distribution', ch.body.uid, 'grow_channel_spend'],
    [PA, 'grow.revenue-and-traction', kpi.body.id, 'grow_kpi_entered'],
    [PA, 'grow.team-expansion', String(role.body.id), 'grow_role_opened'],
    [PA, 'grow.team-expansion', String(role.body.id), 'grow_application_stage'],
    [PA, 'grow.partner-network', pt.body.uid, 'grow_partner_added'],
    [PA, 'grow.partner-network', pt.body.uid, 'grow_partner_revenue'],
    [PA, 'grow.market-expansion', mk.body.uid, 'grow_market_added'],
    [PA, 'grow.durable-company-building', String(ob.body.id), 'grow_obligation_added'],
    [PA, 'grow.durable-company-building', 'key_person_cover', 'grow_checklist_done'],
  ]);
  for (const l of logs) {
    assert.match(l.entity_id, RECORD_ID);
    assert.doesNotMatch(l.details, /Quinn|Robin|Casey|example\.test/, `${l.action}: ${l.details}`);
  }
});

// ---------------------------------------------------------------------------
// Test 5 — the lists
// ---------------------------------------------------------------------------

const TITLES: Record<string, [string, string[], string]> = {
  'product-improvement': ['Feedback', ['source', 'theme', 'status'], '-created_at'],
  distribution: ['Channels', ['state'], 'cac_cents'],
  'revenue-and-traction': ['KPIs', ['source', 'period'], '-period'],
  'team-expansion': ['Open roles', ['status', 'team'], '-applicants'],
  'partner-network': ['Partners', ['type', 'stage'], '-revenue_cents'],
  'market-expansion': ['Markets', ['state'], '-readiness'],
  'durable-company-building': ['Obligations', ['kind', 'due_window'], 'due_at'],
};

test('5: each module sends its records_title, filters and sorts, sorts[0] the default, and every row an id that names no one', async () => {
  const f = fixture();
  await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Faster sync', source: 'customer', from_name: 'Quinn Customer' });
  await grow(f, FOUNDER, 'POST', '/channels', { name: 'Quinn Customer channel' });
  await grow(f, FOUNDER, 'POST', '/roles', { title: 'Engineer', team: 'Product' });
  await grow(f, FOUNDER, 'POST', '/partners', { name: 'Example Partner', type: 'referral' });
  await grow(f, FOUNDER, 'POST', '/markets', { name: 'Italy' });
  await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Board meeting', kind: 'governance', due_at: day(12) });
  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', label: 'Quinn demos', value: 3, as_of: day(-1) });
  for (const [slug, [title, filters, sort]] of Object.entries(TITLES)) {
    const r = await list(f, slug);
    assert.equal(r.status, 200, `${slug}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body.module, { slug, name: r.body.card.name, records_title: title });
    assert.deepEqual(r.body.records.filters.map((x: any) => x.key), filters, slug);
    assert.equal(r.body.records.sorts[0].key, sort, `${slug}'s default sort`);
    assert.ok(r.body.records.rows.length > 0, slug);
    for (const row of r.body.records.rows) {
      assert.match(String(row.id), RECORD_ID, `${slug} row id`);
      assert.doesNotMatch(String(row.id), /quinn|kestrel|engineer|italy/i, `${slug} id holds no name`);
    }
  }
  const kpis = (await list(f, 'revenue-and-traction')).body.records.rows.map((r: any) => r.id);
  assert.deepEqual(kpis.filter((k: string) => !k.startsWith('custom-')).sort(), ['churn', 'expansion_mrr', 'mrr', 'net_burn', 'new_mrr', 'paying_accounts', 'runway']);
  assert.equal(kpis.filter((k: string) => k.startsWith('custom-')).length, 1, 'the custom KPI is its own row');
});

test('5: the default sort applies when none is sent, and two filters joined as the page joins them both apply', async () => {
  const f = fixture();
  const due = (n: number) => day(n);
  await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Later', kind: 'governance', due_at: due(120) });
  await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Soon', kind: 'culture', due_at: due(5) });
  await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Quarter', kind: 'culture', due_at: due(60) });
  await grow(f, FOUNDER, 'POST', '/obligations', { title: 'Missed', kind: 'culture', due_at: due(-3) });
  const rows = (await list(f, 'durable-company-building')).body.records.rows;
  assert.deepEqual(rows.map((r: any) => r.title), ['Missed', 'Soon', 'Quarter', 'Later'], 'Due, soonest first');
  assert.deepEqual(rows.map((r: any) => r.due_window), ['overdue', 'next_30', 'next_90', 'later']);
  const both = (await list(f, 'durable-company-building', `&filter=${encodeURIComponent('kind:culture,due_window:next_90')}`)).body.records.rows;
  assert.deepEqual(both.map((r: any) => r.title), ['Quarter']);
  assert.deepEqual(shapeRecords([{ a: 'x', b: 'y' }, { a: 'x', b: 'z' }], '', 'a:x,b:z', '').length, 1);
  await grow(f, FOUNDER, 'POST', '/feedback', { body: 'One', source: 'customer', theme: 'Exports', status: 'planned' });
  await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Two', source: 'team', theme: 'Exports', status: 'planned' });
  await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Three', source: 'customer', theme: 'Sync', status: 'planned' });
  const fb = (await list(f, 'product-improvement', `&filter=${encodeURIComponent('source:customer,theme:Exports')}`)).body;
  assert.deepEqual(fb.records.rows.map((r: any) => r.body), ['One']);
  assert.deepEqual(fb.records.filters.find((x: any) => x.key === 'theme').options.map((o: any) => o.value), ['Exports', 'Sync']);
  const newest = (await list(f, 'product-improvement')).body.records.rows.map((r: any) => r.body);
  assert.equal(newest.length, 3);
  // KPIs read in the canvas's order (MRR first, custom KPIs last); the default sort, Period, puts the latest first.
  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'mrr', value: 100, as_of: day(-70) });
  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'custom', label: 'Signups', value: 4, as_of: day(-1) });
  const kpis = (await list(f, 'revenue-and-traction')).body.records.rows;
  assert.equal(kpis[0].kpi, 'Signups', 'the latest period first, when no sort is sent');
  assert.equal((await list(f, 'revenue-and-traction', '&sort=kpi')).body.records.rows[0].kpi, 'Burn', 'a sent sort still wins');
});

test('5: Revenue and traction lists Burn, Runway and each custom KPI, Not recorded until it has a value; MRR reads Stripe from the last 35 days', async () => {
  const f = fixture();
  const empty = Object.fromEntries((await list(f, 'revenue-and-traction')).body.records.rows.map((r: any) => [r.id, r]));
  for (const k of ['net_burn', 'runway']) assert.deepEqual([empty[k].value, typeof empty[k].reason], [null, 'string'], k);
  assert.match(empty.runway.reason, /needs cash and burn/);
  // A custom KPI with no value yet is listed, Not recorded.
  f.db.exec(`INSERT INTO custom_kpis (uid, project_id, label, unit) VALUES ('${'a'.repeat(32)}', ${PA}, 'Weekly demos', 'count')`);
  const listed = (await list(f, 'revenue-and-traction')).body.records.rows.find((r: any) => r.id === `custom-${'a'.repeat(32)}`);
  assert.deepEqual([listed.kpi, listed.value, listed.reason], ['Weekly demos', null, 'Not recorded: no value entered yet']);

  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'mrr', value: 9000, as_of: day(-2) });
  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: 'net_burn', value: 20000, as_of: day(-2) });
  f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, cash_balance, source) VALUES (?, ?, ?, ?)').run(PA, day(-2), 240000, 'csv');
  f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?, ?, ?, ?)').run(PA, day(-90), 7000, 'stripe');
  let rows = Object.fromEntries((await list(f, 'revenue-and-traction')).body.records.rows.map((r: any) => [r.id, r]));
  assert.deepEqual([rows.mrr.value, rows.mrr.source], [9000, 'manual'], 'Stripe\'s only row is older than 35 days, so the hand entry');
  assert.deepEqual([rows.net_burn.value, rows.net_burn.source], [20000, 'manual']);
  assert.deepEqual([rows.runway.value, rows.runway.unit], [12, 'months']);
  assert.equal(rows.mrr.period, day(-2).slice(0, 7));
  f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (?, ?, ?, ?)').run(PA, day(-20), 8800, 'stripe');
  rows = Object.fromEntries((await list(f, 'revenue-and-traction')).body.records.rows.map((r: any) => [r.id, r]));
  assert.deepEqual([rows.mrr.value, rows.mrr.source], [8800, 'stripe'], 'a connected source overrides a hand entry');
  await grow(f, FOUNDER, 'POST', '/kpis', { kpi: `custom-${'a'.repeat(32)}`, value: 6, as_of: day(-1) });
  rows = Object.fromEntries((await list(f, 'revenue-and-traction')).body.records.rows.map((r: any) => [r.id, r]));
  assert.deepEqual([rows[`custom-${'a'.repeat(32)}`].value, rows[`custom-${'a'.repeat(32)}`].reason], [6, null]);
  const bySource = (await list(f, 'revenue-and-traction', `&filter=${encodeURIComponent('source:manual')}`)).body.records.rows.map((r: any) => r.id);
  assert.deepEqual(bySource.sort(), [`custom-${'a'.repeat(32)}`, 'net_burn']);
});

test('5: an advisor reads the lists, but feedback rows carry no from_name for a reader who cannot write', async () => {
  const f = fixture();
  await grow(f, FOUNDER, 'POST', '/feedback', { body: 'Faster sync', source: 'customer', from_name: 'Quinn Customer' });
  const advisor = await list(f, 'product-improvement', '', ADVISOR);
  assert.equal(advisor.status, 200);
  assert.equal('from_name' in advisor.body.records.rows[0], false);
  assert.doesNotMatch(JSON.stringify(advisor.body), /Quinn/);
  for (const who of [FOUNDER, COFOUNDER, PARTNER, ADMIN]) {
    assert.equal((await list(f, 'product-improvement', '', who)).body.records.rows[0].from_name, 'Quinn Customer', `writer ${who}`);
  }
  assert.equal((await list(f, 'product-improvement', '', OTHER)).status, 403);
});
