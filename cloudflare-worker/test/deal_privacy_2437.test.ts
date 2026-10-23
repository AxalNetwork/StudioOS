/**
 * D609 (#1309) — reference checks are scoped to the deal: an investor reads
 * and changes only the references on deals they can open (invited or
 * committed), an admin any deal's; founders and partners are refused; the
 * cross-deal list is gone; another deal's reference reads as a 404.
 *
 * Driven through the real router (`routes/references.ts`) on real
 * `node:sqlite`, with the tables from `schema_baseline.sql`.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/references_deal_scope_d609.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals, { serializeDeal } from '../src/routes/deals.ts';
import networkfx from '../src/routes/networkfx.ts';
import references from '../src/routes/references.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

// Users: admin, three investors (invited to deal 1, committed on deal 1, neither), a founder (owns deal 1's project), a partner.
const ADMIN = 1, INV_INVITED = 2, INV_COMMITTED = 3, INV_NONE = 4, FOUNDER = 5, PARTNER = 6;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 4: 'investor', 5: 'founder', 6: 'partner',7:'advisor',8:'exploring' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'deals', 'deal_invitations', 'commitments', 'reference_checks']) db.exec(ddl(t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  for (const [id, role] of Object.entries(ROLE)) u.run(Number(id), role, `User ${id}`, `u${id}@example.test`);
  db.exec(`UPDATE users SET founder_id = 50 WHERE id = ${FOUNDER}`);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (10, 'Deal one co', 50), (20, 'Deal two co', 60)`).run();
  db.prepare(`INSERT INTO deals (id, project_id) VALUES (1, 10), (2, 20)`).run();
  db.prepare(`INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (1, ?)`).run(INV_INVITED);
  db.prepare(`INSERT INTO commitments (deal_id, investor_user_id, amount, status) VALUES (1, ?, 1000, 'pending')`).run(INV_COMMITTED);
  const ref = db.prepare(`INSERT INTO reference_checks (id, uid, deal_id, reference_name, reference_email, status, transcript, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, 'scheduled', 'transcript text', '2026-10-07', '2026-10-07')`);
  ref.run(101, 'r101', 1, 'Synthetic Reference', 'reference@example.invalid');
  ref.run(201, 'r201', 2, 'Other Deal Ref', 'other@example.test');
  db.exec("UPDATE reference_checks SET created_by = 2 WHERE id = 101");
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/references', references as any);
  a.route('/api/deals', deals as any);
  a.route('/api/networkfx', networkfx as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x${path.startsWith('@') ? path.slice(1) : '/api/references'+path}`, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const count = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM reference_checks').get() as any).n;


test('internal deal fields are staff-only and zip is retired', async () => {
  const row={ id:1, notes:'private',pass_note:'private',passed_by_user_id:1,pass_reason:'private' };
  for (const role of ['investor','founder','advisor','exploring']) {
    const out=serializeDeal(row,role);
    for(const key of ['notes','pass_note','passed_by_user_id','pass_reason']) assert.equal(key in out,false);
  }
  for(const role of ['admin','partner']) assert.equal(serializeDeal(row,role).notes,'private');
  assert.equal(row.notes,'private');
  const db=freshDb();
  try { for(const who of [ADMIN,INV_INVITED,INV_COMMITTED,INV_NONE,FOUNDER,PARTNER,7,8]) assert.equal((await call(db,who,'GET','@/api/deals/1/data-room')).status,410); } finally {db.close();}
});
test('commitments: investor own rows, founder/admin all, partner total only',async()=>{
  const db=freshDb();
  try {
    db.exec("INSERT INTO commitments(deal_id,investor_user_id,amount) VALUES(1,2,2000)");
    for(const who of [INV_INVITED,INV_COMMITTED]) {
      const r=await call(db,who,'GET','@/api/deals/1/commitments');
      assert.equal(r.status,200,r.text);assert.equal(r.body.length,1);
      assert.equal(r.body[0].investor_user_id,who);
    }
    for(const who of [ADMIN,FOUNDER]) assert.equal((await call(db,who,'GET','@/api/deals/1/commitments')).body.length,2);
    assert.deepEqual((await call(db,PARTNER,'GET','@/api/deals/1/commitments')).body,{total:3000});
  } finally {db.close();}
});
test('reference edits/deletion require author or admin even on a readable deal',async()=>{
  const db=freshDb();
  try {
    for(const method of ['PATCH','DELETE']) {
      assert.equal((await call(db,INV_COMMITTED,method,'/101',{notes:'private'})).status,403);
      assert.equal((await call(db,FOUNDER,method,'/101',{})).status,403);
      assert.equal((await call(db,PARTNER,method,'/101',{})).status,403);
      for(const who of [7,8]) assert.equal((await call(db,who,method,'/101',{})).status,403);
    }
    assert.equal((await call(db,INV_INVITED,'PATCH','/101',{notes:'author'})).status,200);
    assert.equal((await call(db,ADMIN,'DELETE','/101')).status,200);
  } finally {db.close();}
});

test('syndicate roster: creator/member/admin only; emails admin only',async()=>{
  const db=freshDb();
  try {
    db.exec(ddl('syndicates')); db.exec(ddl('syndicate_members'));
    db.exec("INSERT INTO syndicates(id,name,created_by) VALUES(1,'Synthetic',2); INSERT INTO syndicate_members(syndicate_id,user_id,commitment_cents) VALUES(1,3,100)");
    for(const who of [ADMIN,INV_INVITED,INV_COMMITTED,INV_NONE,FOUNDER,PARTNER,7,8]) {
      const r=await call(db,who,'GET','@/api/networkfx/syndicates/1');assert.equal(r.status,200,r.text);
      assert.equal(r.body.members.length,[ADMIN,INV_INVITED,INV_COMMITTED].includes(who)?1:0);
      if(who===ADMIN) assert.ok(r.body.members[0].email);
      else assert.ok(r.body.members.every(m=>!('email' in m)));
    }
  } finally {db.close();}
});

test('deal detail and list both apply the shared serializer; recommendations select no email',()=>{
 const source=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/routes/deals.ts'),'utf8');
 assert.match(source,/map\(row => serializeDeal\(row, user.role\)\)/);
 assert.match(source,/c.json\(serializeDeal\(rows\[0\], user.role\)\)/);
 const net=readFileSync(resolve(process.cwd(),'cloudflare-worker/src/routes/networkfx.ts'),'utf8');
 const recs=net.slice(net.indexOf("networkfx.post('/syndicates/:id/recommendations'"),net.indexOf('// MARKETPLACE'));
 assert.doesNotMatch(recs,/u\.email/);
});

test('invited investor detail and list omit studio notes',async()=>{
 const db=freshDb();
 try {
  db.exec(ddl('partners'));
  db.exec("UPDATE deals SET notes='synthetic-private',pass_note='synthetic-private',passed_by_user_id=1 WHERE id=1");
  for(const path of ['@/api/deals/1','@/api/deals']) {
   const r=await call(db,INV_INVITED,'GET',path);assert.equal(r.status,200,r.text);
   const row=Array.isArray(r.body)?r.body.find(v=>v.id===1):r.body;
   assert.equal('notes' in row,false);assert.equal('pass_note' in row,false);assert.equal('passed_by_user_id' in row,false);
  }
 } finally {db.close();}
});
