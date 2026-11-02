/**
 * D1464 (#4021) — the founder's list of reasoned support reads: the Data
 * room's new `GET /api/data-room/:p/support-reads`, and the reader's kind on
 * Capital relationships' existing history (`capitalSupportHistory`). Real
 * SQLite on the canonical schema (the baseline, then every migration above
 * the cutoff); all people and reasons are synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/support_reads_d1464.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { JWT_SECRET, token } from './_esign_harness.ts';
import dataRoom from '../src/routes/data_room.ts';
import { capitalSupportHistory, CAPITAL_SUPPORT_ACTION } from '../src/services/capRelAccess.ts';
import { supportPage, supportReadHistory } from '../src/services/supportReads.ts';

const MIGRATIONS = new URL('../sql/migrations/', import.meta.url);
const ddl = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  for (const n of readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(readFileSync(new URL(n, MIGRATIONS), 'utf8'));
  }
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as any[]).map((r) => r.sql).join(';\n');
  db.close(); return out;
})();

const OWNER = 1, COFOUNDER = 2, OTHER = 3, INVESTOR = 4, ADMIN = 900, SUPER = 901;
const ROLE: Record<number, string> = { [OWNER]: 'founder', [COFOUNDER]: 'founder', [OTHER]: 'founder', [INVESTOR]: 'investor', [ADMIN]: 'admin', [SUPER]: 'admin' };
const app = new Hono<any>().route('/api/data-room', dataRoom);
app.onError((e: any, c: any) => (e instanceof Response ? e : c.json({ error: String(e?.message || '') }, 500)));

function fixture({ poison = null as RegExp | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }); db.exec(ddl);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active,subscription_tier) VALUES
      (1,'founder','Synthetic founder','founder@example.com',11,1,'studio'),(2,'founder','Synthetic co-founder','co@example.com',22,1,'studio'),
      (3,'founder','Other founder','other@example.com',33,1,'studio'),(4,'investor','Synthetic investor','investor@example.com',NULL,1,'free'),
      (900,'admin','Synthetic admin','admin@example.com',NULL,1,'studio'),(901,'admin','Synthetic HQ','hq@example.com',NULL,1,'studio');
    INSERT INTO super_admins(user_id) VALUES (901);
    INSERT INTO projects(id,uid,name,founder_id) VALUES (1,'room-one','Synthetic venture',11),(2,'room-two','Other venture',33);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,2,'cofounder','accepted');
    INSERT INTO activity_logs(id,project_id,user_id,entity_type,action,details,actor,created_at) VALUES
      (1,1,1,'raise.data-room','data_room_support_read','{"admin_user_id":900,"reason":"Quarterly portfolio review","read_only":true}','user:900','2026-11-01 09:00:00'),
      (2,1,1,'raise.data-room','data_room_support_read','{"admin_user_id":901,"reason":"Support request","read_only":true}','user:901','2026-11-01 10:00:00'),
      (3,1,1,'raise.data-room','data_room_support_read','not json','user:777','2026-11-01 11:00:00'),
      (4,1,1,'raise.capital-relationships','${CAPITAL_SUPPORT_ACTION}','{"admin_user_id":901,"reason":"Due diligence","page":1}','user:901','2026-11-01 12:00:00'),
      (5,2,3,'raise.data-room','data_room_support_read','{"admin_user_id":900,"reason":"Other venture reason"}','user:900','2026-11-01 13:00:00');`);
  const binding = d1Over(db);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) {
    if (poison && poison.test(sql)) return { bind: () => ({ all: async () => { throw new Error('Synthetic private failure'); }, first: async () => { throw new Error('x'); }, run: async () => { throw new Error('x'); } }) } as any;
    return binding.prepare(sql);
  } } };
  const call = async (who: number, path: string) => {
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const r = await app.request('/api/data-room' + path, { headers: { Authorization: `Bearer ${await token(who, ROLE[who])}` } }, env);
      return { status: r.status, body: await r.json().catch(() => null) as any };
    } finally { [console.warn, console.error] = saved; }
  };
  return { db, env, call };
}

test("the owner and an accepted co-founder read the room's support reads: who, Studio admin or HQ, the reason and when, newest first", async () => {
  const f = fixture();
  for (const who of [OWNER, COFOUNDER]) {
    const r = await f.call(who, '/room-one/support-reads');
    assert.equal(r.status, 200, String(who));
    assert.deepEqual(r.body.reads.map((x: any) => [x.id, x.reader.name, x.reader.kind, x.reason, x.created_at]), [
      [3, null, null, null, '2026-11-01 11:00:00'],
      [2, 'Synthetic HQ', 'super_admin', 'Support request', '2026-11-01 10:00:00'],
      [1, 'Synthetic admin', 'admin', 'Quarterly portfolio review', '2026-11-01 09:00:00'],
    ], 'a missing reader and an unreadable reason are null, never guessed; capital and other ventures are not here');
    assert.equal(r.body.has_more, false);
    assert.doesNotMatch(JSON.stringify(r.body), /@example|admin_user_id/, 'no email and no account id in the answer');
  }
});

test('an admin, an investor and another founder are not the room: 404, and nothing of it is said', async () => {
  const f = fixture();
  for (const who of [ADMIN, SUPER, INVESTOR, OTHER]) {
    const r = await f.call(who, '/room-one/support-reads');
    assert.equal(r.status, 404, String(who));
    assert.doesNotMatch(JSON.stringify(r.body), /Quarterly|Synthetic/);
  }
});

test('a list that cannot be read is 503 with its own code, never an empty list and never the private error', async () => {
  const f = fixture({ poison: /FROM activity_logs a LEFT JOIN users u/ });
  const r = await f.call(OWNER, '/room-one/support-reads');
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'support_history_unreadable');
  assert.equal(r.body.reads, undefined);
  assert.doesNotMatch(JSON.stringify(r.body), /Synthetic private/);
});

test('25 to a page, with has_more; a bad page is page 1', async () => {
  const f = fixture();
  const insert = f.db.prepare("INSERT INTO activity_logs(project_id,user_id,entity_type,action,details,actor) VALUES (1,1,'raise.data-room','data_room_support_read',?,'user:900')");
  for (let i = 0; i < 25; i += 1) insert.run(JSON.stringify({ reason: `Synthetic reason ${i}` }));
  const one = await f.call(OWNER, '/room-one/support-reads?page=1');
  assert.equal(one.body.reads.length, 25); assert.equal(one.body.has_more, true);
  const two = await f.call(OWNER, '/room-one/support-reads?page=2');
  assert.equal(two.body.reads.length, 3); assert.equal(two.body.has_more, false);
  for (const bad of ['0', '-1', 'x', '1.5', '']) assert.equal(supportPage(bad), 1, bad);
  assert.equal((await f.call(OWNER, '/room-one/support-reads?page=x')).body.page, 1);
});

test("Capital relationships' history carries the reader's kind from the same rule", async () => {
  const f = fixture();
  const capital = await capitalSupportHistory(f.env, 1, 1);
  assert.deepEqual(capital.reads.map((x: any) => [x.reader.name, x.reader.kind, x.reason]), [['Synthetic HQ', 'super_admin', 'Due diligence']]);
  const shared = await supportReadHistory(f.env, 1, CAPITAL_SUPPORT_ACTION, 1);
  assert.deepEqual(shared.reads.map((x: any) => x.reader.kind), ['super_admin']);
});
