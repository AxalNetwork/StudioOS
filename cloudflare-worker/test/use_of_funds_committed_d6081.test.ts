/**
 * D6081 (#6081): Use of funds reads Committed from the round. The plan read's
 * `committed` block is Capital relationships' commitments read (the figures
 * `GET /cycles/raise/capital-relationships/commitments` serves), under that
 * tool's access rules; an unread value is never $0.
 *
 * Real SQL on node:sqlite through the mounted routes. Every name, email and
 * amount is invented.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/use_of_funds_committed_d6081.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { committedRead } from '../src/services/useOfFunds/read.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const secret = 'synthetic-d6081-test-jwt-not-a-credential';
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const roles = ['founder', 'founder', 'admin', 'partner', 'investor'];
const app = new Hono(); app.route('/api/cycles/raise', cycleRaise as any);

function fixture({ round = true }: { round?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['founders', 'users', 'projects', 'activity_logs', 'user_company_links', 'company_profiles', 'super_admins', 'mi_pro_subscriptions',
    'roadmap_okrs', 'integrations', 'cap_table_scenarios', 'financial_models', 'raise_rounds', 'raise_prospects', 'raise_pro_rata', 'raise_closes',
    'spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'data_room_files', 'deals', 'commitments']) db.exec(tableFromBaseline(baseline, name));
  for (const n of ['442_raise_cycle_stores.sql', '463_raise_record_stores.sql', '436_round_calls.sql', '520_mercury_raise_feeds.sql', '249_project_metrics.sql',
    '606_use_of_funds_scenarios.sql', '202611082130_uof_scenario_revision.sql', '202611101555_5375_uof_hire_revision.sql', '599_deal_currency.sql',
    '597_company_archive_and_events.sql']) db.exec(mig(n));
  const personal = mig('477_mercury_personal.sql');
  const start = personal.indexOf('CREATE TABLE IF NOT EXISTS mercury_personal_matches');
  db.exec(personal.slice(start, personal.indexOf('\n', personal.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_mercury_personal_match_target'))));
  db.exec(mig('490_mercury_raise_receipts.sql'));
  db.exec(mig('607_raise_money_cents.sql'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(11,'Synthetic owner','owner@example.test'),(22,'Other owner','other@example.test'); INSERT INTO projects(id,name,founder_id,company_id) VALUES(1,'Synthetic venture',11,10),(2,'Other venture',22,20);");
  roles.forEach((role, i) => db.prepare('INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES(?,?,?,?,?,1)').run(i + 1, role, `Synthetic ${i + 1}`, `member-${i + 1}@example.test`, i === 1 ? 22 : i === 0 ? 11 : null));
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('link-one',1,10),('link-two',2,20)");
  if (round) db.exec("INSERT INTO raise_rounds (id, uid, project_id, name, target_amount, status) VALUES (1, 'r-1', 1, 'Seed', 1500000, 'active'), (2, 'r-2', 2, 'Seed', 900000, 'active')");
  db.exec(`INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage, amount, commit_status) VALUES
    (1, 'pk', 1, 'Fixture K', 'Fund K', 'fundk@example.test', 'committed', 1000000, 'signed'),
    (2, 'pm', 1, 'Fixture M', 'Angel M', 'angelm@example.test', 'committed', 450000, 'wired'),
    (3, 'pa', 1, 'Fixture A', 'Angel A', 'anglea@example.test', 'committed', 75000, 'soft'),
    (4, 'pn', 1, 'Fixture N', 'Fund N', 'fundn@example.test', 'committed', 30000, NULL),
    (9, 'po', 2, 'Fixture O', 'Other Fund', 'other@example.test', 'committed', 800000, 'signed')`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: secret, ENVIRONMENT: 'development' } as any };
}
async function get(f: any, path: string, who = 1, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: roles[who - 1], ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
  const res = await app.request(`/api/cycles/raise${path}`, { headers: { Authorization: `Bearer ${token}` } }, f.env);
  return { status: res.status, body: await res.json() as any };
}

test('D6081 the plan reads Committed from the round: the commitments read\'s figures, its statuses and Remaining', async () => {
  const f = fixture();
  const plan = await get(f, '/use-of-funds/plan?project=1');
  assert.equal(plan.status, 200);
  const c = plan.body.committed;
  assert.equal(c.state, 'ok');
  assert.equal(c.source, 'Capital relationships');
  assert.equal(c.href, '/raise/capital-relationships/commitments?project_id=1');
  assert.equal(c.value.counted_cents, 145000000, 'Signed and Wired count; Soft and no status do not');
  assert.equal(c.value.target_cents, 150000000);
  assert.equal(c.value.remaining_cents, 5000000);
  assert.deepEqual(c.value.statuses.map((s: any) => s.label), ['Signed', 'Wired']);
  // The same figures the Capital relationships route serves.
  const cr = await get(f, '/capital-relationships/commitments?project=1');
  assert.equal(cr.status, 200);
  assert.equal(cr.body.totals.counted_cents, c.value.counted_cents);
  assert.equal(cr.body.round.target_cents, c.value.target_cents);
  // Compare carries the same block.
  const base = plan.body.base.value.id;
  const cmp = await get(f, `/use-of-funds/compare?project=1&ids=${base}`);
  assert.equal(cmp.status, 200);
  assert.deepEqual(cmp.body.committed, c);
});

test('D6081 a counted commitment with no amount keeps Remaining back; a real zero is a zero', async () => {
  const f = fixture();
  f.db.exec("UPDATE raise_prospects SET amount=NULL WHERE id=2");
  let c = (await get(f, '/use-of-funds/plan?project=1')).body.committed;
  assert.equal(c.state, 'ok'); assert.equal(c.value.amount_not_recorded, 1); assert.equal(c.value.remaining_cents, null);
  f.db.exec("DELETE FROM raise_prospects WHERE project_id=1");
  c = (await get(f, '/use-of-funds/plan?project=1')).body.committed;
  assert.equal(c.state, 'ok'); assert.equal(c.value.counted_cents, 0); assert.equal(c.value.remaining_cents, 150000000);
});

test('D6081 no active round is Not recorded with the Commitments link', async () => {
  const f = fixture({ round: false });
  const c = (await get(f, '/use-of-funds/plan?project=1')).body.committed;
  assert.equal(c.state, 'not_recorded');
  assert.equal(c.value, null);
  assert.equal(c.href, '/raise/capital-relationships/commitments?project_id=1');
  assert.match(c.reason, /No active round is recorded/);
});

test('D6081 unreadable commitments are Unavailable, never a partial sum or $0', async () => {
  for (const table of ['deals', 'raise_prospects', 'raise_rounds']) {
    const f = fixture();
    f.db.exec(`DROP TABLE ${table}`);
    const r = await get(f, '/use-of-funds/plan?project=1');
    assert.equal(r.status, 200, table);
    assert.equal(r.body.committed.state, 'unavailable', `${table} unreadable`);
    assert.equal(r.body.committed.value, null);
    assert.match(r.body.committed.reason, /Remaining is not shown\. It is not \$0\./);
  }
});

test('D6081 an admin, a support session and a non-member read no commitment figure (capRelAccess)', async () => {
  const f = fixture();
  const admin = await get(f, '/use-of-funds/plan?project=1', 3);
  assert.equal(admin.status, 200, 'an admin still reads the plan');
  assert.equal(admin.body.committed.state, 'refused');
  assert.equal(admin.body.committed.value, null);
  assert.ok(!JSON.stringify(admin.body.committed).includes('145000000'));
  // Capital relationships refuses the same admin the same read.
  assert.equal((await get(f, '/capital-relationships/commitments?project=1', 3)).status, 403);
  const support = await get(f, '/use-of-funds/plan?project=1', 1, { impersonated_by: 3 });
  assert.equal(support.status, 200);
  assert.equal(support.body.committed.state, 'refused');
  // Directly: an investor and another venture's founder are refused before any commitment SQL.
  const user = (id: number) => f.db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
  for (const who of [2, 5]) {
    const c = await committedRead(f.env, { projectId: 1, user: user(who), founderUserId: 1 }, false);
    assert.equal(c.state, 'refused', `user ${who}`);
  }
  // Access that cannot be checked is Unavailable, not refused and not a figure.
  const broken = { DB: { prepare: () => { throw new Error('down'); } } } as any;
  assert.equal((await committedRead(broken, { projectId: 1, user: user(1), founderUserId: 1 }, true)).state, 'unavailable');
});

test('D6081 a round that cannot be read is Unavailable, never "no round"', async () => {
  const f = fixture();
  const real = f.env.DB;
  const roundOnly = /FROM raise_rounds\s+WHERE project_id = \? AND status = 'active' ORDER BY id DESC LIMIT 1/;
  const env = { ...f.env, DB: { ...real, prepare: (sql: string) => roundOnly.test(sql)
    ? { bind: () => ({ first: async () => { throw new Error('down'); } }) } : real.prepare(sql) } } as any;
  const user = f.db.prepare('SELECT * FROM users WHERE id=1').get() as any;
  const c = await committedRead(env, { projectId: 1, user, founderUserId: 1 }, true);
  assert.equal(c.state, 'unavailable');
  assert.equal(c.value, null);
});
