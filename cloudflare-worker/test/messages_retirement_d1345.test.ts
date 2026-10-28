/** D1345: mounted tombstones, guarded removal, and scoped Email handoffs on real SQLite. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import worker from '../src/index.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { contextPack } from '../src/services/mail/contextPack.ts';
import { draftAsk, ticked, draftMessages } from '../src/services/mail/drafts.ts';
import { intentFor } from '../src/services/mail/intents.ts';

const sqlRoot = new URL('../sql/', import.meta.url);
const migration = readFileSync(new URL('migrations/650_retire_messages.sql', sqlRoot), 'utf8');
const oldTables = ['message_threads', 'messages', 'message_thread_participants', 'message_attachments'];
const SECRET = 'd1345-only-'.repeat(8); // Generated fixture signing key; never a service credential.
const ctx: any = { waitUntil() {}, passThroughOnException() {} };
after(removeMigratedDatabases);
function beforeDrop() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(new URL('schema_baseline.sql', sqlRoot), 'utf8'));
  for (const name of readdirSync(new URL('migrations/', sqlRoot)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF && migrationNumber(n) < 650).sort(compareMigrations)) {
    db.exec(readFileSync(new URL('migrations/' + name, sqlRoot), 'utf8'));
  }
  return db;
}
const hasTable = (db: DatabaseSync, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);

test('empty migrated stores disappear, including the assertion helper', () => {
  const db = beforeDrop();
  try {
    for (const table of oldTables) assert.ok(hasTable(db, table), table);
    db.exec(migration);
    for (const table of [...oldTables, 'd1345_messages_empty_guard']) assert.equal(hasTable(db, table), false, table);
    assert.ok(hasTable(db, 'mail_drafts'), 'Email drafts survive');
  } finally { db.close(); }
});

for (const occupied of oldTables) test(`any row in ${occupied} prevents every DROP`, () => {
  const db = beforeDrop();
  try {
    // Minimal fixture tables preserve each production table's identity; the guard must count all four.
    db.exec(`DROP TABLE ${occupied}; CREATE TABLE ${occupied}(id INTEGER); INSERT INTO ${occupied} VALUES(1)`);
    assert.throws(() => db.exec(migration), /CHECK constraint failed/);
    for (const table of oldTables) assert.ok(hasTable(db, table), table);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${occupied}`).get()!.n, 1);
  } finally { db.close(); }
});

async function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,is_active,subscription_tier) VALUES
    (1,'LP A','lp-a@example.invalid','investor',1,'studio'),(2,'LP B','lp-b@example.invalid','investor',1,'studio'),
    (3,'GP','gp@example.invalid','investor',1,'studio'),(4,'Advisor A','advisor-a@example.invalid','advisor',1,'studio'),
    (5,'Advisor B','advisor-b@example.invalid','advisor',1,'studio'),(6,'Client','client@example.invalid','founder',1,'studio'),
    (7,'Admin','admin@example.invalid','admin',1,'studio');
    INSERT INTO vc_funds(id,name,gp_name,gp_user_id,gp_email) VALUES (1,'Synthetic Fund','Synthetic GP',3,'document-only@example.invalid'),(2,'Other Fund','Other GP',3,'other@example.invalid');
    INSERT INTO limited_partners(id,fund_id,user_id,email,status) VALUES (1,1,1,'lp-b@example.invalid','committed'),(2,2,2,'lp-b@example.invalid','committed');
    INSERT INTO advisors(id,uid,display_name,email,user_id) VALUES(1,'adv-a','Advisor A','advisor-a@example.invalid',4),(2,'adv-b','Advisor B','advisor-b@example.invalid',5);
    INSERT INTO advisor_engagements(id,uid,advisor_id,founder_user_id,client_name) VALUES (1,'eng-a',1,6,'Synthetic Client'),(2,'eng-b',2,6,'Other Client');
    INSERT INTO advisor_deliverables(id,uid,advisor_id,engagement_id,client_name,title) VALUES(1,'del-a',1,1,'Synthetic Client','Synthetic Board Brief'),(2,'del-b',2,2,'Other Client','Other Brief');`);
  const real = d1Over(db);
  const seen: string[] = [];
  const env: any = { DB: { ...real, prepare(sql: string) { seen.push(sql); return real.prepare(sql); } },
    JWT_SECRET: SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), TOKENS: memKV() };
  const token = async (who: number) => new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const call = async (path: string, method = 'GET', who?: number) => worker.fetch(new Request(`https://unit.test${path}`, {
    method, headers: who ? { authorization: `Bearer ${await token(who)}` } : {},
  }), env, ctx);
  const user = (id: number) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
  return { db, env, seen, call, user };
}

test('the real Worker returns 410 for the root and all old operations without touching retired stores', async () => {
  const f = await fixture();
  try {
    for (const [path, method] of [
      ['/api/messages', 'GET'], ['/api/messages', 'POST'], ['/api/messages/old-thread', 'GET'],
      ['/api/messages/old-thread/send', 'POST'], ['/api/messages/old-thread/read', 'POST'],
      ['/api/messages/old-thread/archive', 'POST'], ['/api/messages/old-thread/attachments', 'POST'],
      ['/api/messages/attachments/old/link', 'GET'], ['/api/messages/anything/nested', 'DELETE'],
    ]) for (const who of [undefined, 1, 7]) {
      const res = await f.call(path, method, who);
      assert.equal(res.status, 410, `${method} ${path} member ${who}`);
      assert.deepEqual(await res.json(), { code: 'messages_retired', detail: 'Messages is now Email.', moved_to: '/email' });
    }
    assert.equal(f.seen.some((sql) => /\b(?:message_threads|messages|message_thread_participants|message_attachments)\b/.test(sql)), false);
    assert.notEqual((await f.call('/api/mail/context?person=fund_gp:1', 'GET', 1)).status, 410, 'Email remains mounted');
  } finally { f.db.close(); }
});

test('the LP composer resolves only the own fund and the account GP, including legacy self membership', async () => {
  const f = await fixture();
  try {
    const res = await f.call('/api/mail/context?person=fund_gp:1', 'GET', 1);
    assert.equal(res.status, 200);
    const pack: any = await res.json();
    assert.equal(pack.person.address, 'gp@example.invalid');
    assert.equal(pack.person.relationship, 'fund_gp');
    assert.ok(intentFor(pack.person.relationship, 'ask_question'));
    const { ask, pack: fresh } = await draftAsk(f.env, f.user(1), { person: 'fund_gp:1', intent: 'ask_question', tone: 'direct', length: 'short', refs: ['fund_gp:1'], blocks: [] });
    assert.match(draftMessages(fresh, ask, ticked(fresh, ask.refs), [])[1].content, /Fund: Synthetic Fund/);
    assert.match(pack.items[0].text, /Synthetic Fund/);
    assert.doesNotMatch(JSON.stringify(pack), /document-only|Other Fund|lp-b@/);
    for (const who of [2, 4, 7]) assert.equal((await f.call('/api/mail/context?person=fund_gp:1', 'GET', who)).status, 404);
    assert.equal((await f.call('/api/mail/context?person=fund_gp:2', 'GET', 1)).status, 404);
    f.db.exec("INSERT INTO limited_partners(id,fund_id,email,status) VALUES(3,1,'LP-B@EXAMPLE.INVALID','committed')");
    assert.equal((await f.call('/api/mail/context?person=fund_gp:1', 'GET', 2)).status, 200);
    f.db.exec('UPDATE vc_funds SET gp_user_id=NULL WHERE id=1');
    assert.equal((await f.call('/api/mail/context?person=fund_gp:1', 'GET', 1)).status, 404);
  } finally { f.db.close(); }
});

test('a work product resolves through the own advisor engagement, without requiring a booking', async () => {
  const f = await fixture();
  try {
    const pack = await contextPack(f.env, f.user(4), 'work_product:1');
    assert.deepEqual([pack.person.name, pack.person.address, pack.person.relationship], ['Client', 'client@example.invalid', 'founder']);
    assert.match(pack.items[0].text, /Synthetic Board Brief/);
    assert.equal(pack.items[0].link, '/practice/delivery');
    const { ask, pack: fresh } = await draftAsk(f.env, f.user(4), { person: 'work_product:1', intent: 'check_in', tone: 'warm', length: 'short', refs: ['work_product:1'], blocks: [] });
    assert.match(draftMessages(fresh, ask, ticked(fresh, ask.refs), [])[1].content, /Work product: Synthetic Board Brief/);
    for (const who of [1, 5, 6, 7]) assert.equal((await f.call('/api/mail/context?person=work_product:1', 'GET', who)).status, 404);
    f.db.exec('UPDATE advisor_deliverables SET engagement_id=2 WHERE id=1');
    assert.equal((await f.call('/api/mail/context?person=work_product:1', 'GET', 4)).status, 404, 'mismatched advisor is refused');
    f.db.exec('UPDATE advisor_deliverables SET engagement_id=1 WHERE id=1; UPDATE advisor_engagements SET founder_user_id=NULL WHERE id=1');
    assert.equal((await f.call('/api/mail/context?person=work_product:1', 'GET', 4)).status, 404, 'unlinked client is refused');
  } finally { f.db.close(); }
});
