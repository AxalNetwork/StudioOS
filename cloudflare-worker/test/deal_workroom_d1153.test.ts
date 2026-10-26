/**
 * D1153 (#3058, part 5 of #2421) — the working tabs' Worker routes: the data
 * room's door for an investor (DL8) and their request (DL9), the round as a
 * count and a total (DL11), and a withdrawal that needs a reason (DL12).
 *
 * Real routes over the canonical schema. Every person and deal is made up.
 * People: 1 Ivy and 2 Ian, investors invited to deal 101 (Acme, founder 4
 * Fay); 3 Oona, an investor on no deal; 4 Fay, the founder; 5 Ada, an admin;
 * 6 Wren, an investor whose only commitment is withdrawn.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_workroom_d1153.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_workroom.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d1153-01234567890123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['entities', 'users', 'founders', 'user_sessions', 'user_company_links', 'projects', 'deals', 'deal_invitations', 'commitments',
    'data_room_grants', 'pairwise_ndas', 'activity_logs']) db.exec(tableFromBaseline(baseline, t));
  db.exec("ALTER TABLE deals ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'"); // a later migration's column
  db.exec(readFileSync('cloudflare-worker/sql/migrations/595_data_room_access_requests.sql', 'utf8').split('INSERT OR IGNORE INTO data_room_access_requests')[0]);
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (40,'Fay','fay@example.test');
    INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES
      (1,'Ivy','ivy@example.test','investor',NULL,'approved',1),(2,'Ian','ian@example.test','investor',NULL,'approved',1),
      (3,'Oona','oona@example.test','investor',NULL,'approved',1),(4,'Fay','fay@example.test','founder',40,'approved',1),
      (5,'Ada','ada@example.test','admin',NULL,'approved',1),(6,'Wren','wren@example.test','investor',NULL,'approved',1);
    INSERT INTO projects(id,uid,name,founder_id,sector,stage) VALUES (11,'acme-uid','Acme',40,'Robotics','seed');
    INSERT INTO deals(id,project_id,status,amount,target_raise,currency) VALUES (101,11,'active',NULL,1500000,'USD');
    INSERT INTO deal_invitations(id,deal_id,investor_user_id,status) VALUES (1,101,1,'invited'),(2,101,2,'invited');
    INSERT INTO commitments(id,uid,deal_id,investor_user_id,amount,status,notes) VALUES
      (1,'c-ivy',101,1,50000,'pending','Ivy private note'),(2,'c-ian',101,2,80000,'confirmed','Ian private note'),
      (3,'c-ian-old',101,2,10000,'withdrawn',NULL),(4,'c-wren-old',101,6,99000,'withdrawn',NULL);`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production' } as any };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/api/deals', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = { log: console.log, error: console.error }; console.log = () => {}; console.error = () => {};
  try {
    const res = await app.request('/api/deals' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.log = saved.log; console.error = saved.error; }
}

test('only an investor on the deal: a founder and an admin are refused, and a deal you are not on answers as one that is not there', async () => {
  // Mutation checked: the role check removed; the relationship check removed.
  const f = fixture();
  assert.equal((await call(f, '/101/room-access', 4)).status, 403);
  assert.equal((await call(f, '/101/round', 5)).status, 403);
  assert.equal((await call(f, '/101/room-access', 3)).status, 404, 'Oona is on no deal');
  assert.equal((await call(f, '/999/round', 1)).status, 404);
  assert.equal((await call(f, '/101/round', null)).status, 401);
});

test('the room\'s door: no grant and no request; asking writes one open request, a second ask writes nothing, and a live grant refuses the ask', async () => {
  // Mutation checked: the message cap removed; a granted investor allowed to ask.
  const f = fixture();
  const before = await call(f, '/101/room-access', 1);
  assert.deepEqual([before.status, before.body.granted, before.body.request, before.body.project_uid, before.body.founder_user_id], [200, null, null, 'acme-uid', 4]);
  assert.equal((await call(f, '/101/room-access/request', 1, 'POST', { message: 'x'.repeat(2001) })).status, 400);
  const asked = await call(f, '/101/room-access/request', 1, 'POST', { message: 'We would like to see the model.' });
  assert.deepEqual([asked.status, asked.body.created], [200, true]);
  assert.deepEqual([(await call(f, '/101/room-access/request', 1, 'POST', {})).body.created], [false], 'one open request per investor and venture');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM data_room_access_requests WHERE investor_user_id = 1 AND source = 'deal_page'").get().n, 1);
  assert.equal((await call(f, '/101/room-access', 1)).body.request.state, 'open');
  f.db.exec("INSERT INTO data_room_grants(uid,project_id,investor_user_id,granted_by_user_id,status) VALUES ('g2',11,2,4,'active')");
  f.db.exec("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status,valid_until) VALUES (4,2,'active','2027-10-09 00:00:00')");
  const ian = await call(f, '/101/room-access', 2);
  assert.deepEqual([ian.body.granted, ian.body.nda], [{ expires_at: null }, { status: 'on_file', valid_until: '2027-10-09 00:00:00' }]);
  assert.equal((await call(f, '/101/room-access/request', 2, 'POST', {})).status, 409, 'the room is already open to Ian');
});

test('the round is a count of investors and a total: no name, no note and no single amount of another investor', async () => {
  // Mutation checked: a withdrawn commitment counted; the pending total folded into the confirmed one.
  const f = fixture();
  const r = await call(f, '/101/round', 1);
  assert.deepEqual(r.body, { investors: 2, confirmed_total: 80000, pending_total: 50000, currency: 'USD' });
  const raw = JSON.stringify(r.body);
  for (const leak of ['Ian', 'Ivy', 'private note', 'c-ian']) assert.ok(!raw.includes(leak), leak);
});

test('a withdrawal needs a reason; it is kept with the withdrawal, and only your own live commitment can be withdrawn', async () => {
  // Mutation checked: the reason not required; the record written when nothing was withdrawn; another investor's commitment withdrawn.
  const f = fixture();
  const none = await call(f, '/101/commitments/c-ivy/withdrawal', 1, 'POST', { reason: '   ' });
  assert.deepEqual([none.status, none.body.error], [400, 'reason_required']);
  assert.equal(f.db.prepare("SELECT status FROM commitments WHERE uid = 'c-ivy'").get().status, 'pending', 'nothing changed');
  assert.equal((await call(f, '/101/commitments/c-ivy/withdrawal', 1, 'POST', { reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await call(f, '/101/commitments/c-ian/withdrawal', 1, 'POST', { reason: 'Not mine' })).status, 404, 'Ian\'s commitment is not Ivy\'s');
  assert.equal(f.db.prepare("SELECT status FROM commitments WHERE uid = 'c-ian'").get().status, 'confirmed');
  const ok = await call(f, '/101/commitments/c-ivy/withdrawal', 1, 'POST', { reason: 'Our fund closed its allocation.' });
  assert.equal(ok.status, 200);
  assert.equal(f.db.prepare("SELECT status FROM commitments WHERE uid = 'c-ivy'").get().status, 'withdrawn');
  const logs = f.db.prepare("SELECT action, details, user_id, entity_id FROM activity_logs WHERE action = 'deal_commitment_withdrawn'").all();
  assert.equal(logs.length, 1);
  assert.deepEqual([JSON.parse(logs[0].details).reason, logs[0].user_id, logs[0].entity_id], ['Our fund closed its allocation.', 1, '101']);
  assert.equal((await call(f, '/101/commitments/c-ivy/withdrawal', 1, 'POST', { reason: 'Again' })).status, 404, 'already withdrawn');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'deal_commitment_withdrawn'").get().n, 1, 'no record without a withdrawal');
  assert.equal(f.db.prepare('SELECT capital_committed FROM deals WHERE id = 101').get().capital_committed, 80000);
});

test('the wiring: mounted before the deal routes, with no new interpolated SQL, and no reason or message in a log line', () => {
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  assert.ok(index.indexOf("app.route('/api/deals', dealWorkroom)") > 0);
  assert.ok(index.indexOf("app.route('/api/deals', dealWorkroom)") < index.indexOf("app.route('/api/deals', deals)"), 'before deals, so its literal paths win');
  const src = readFileSync('cloudflare-worker/src/routes/deal_workroom.ts', 'utf8');
  assert.ok(!/prepare\(`[^`]*\$\{/.test(src), 'every statement is bound');
  for (const line of src.split('\n').filter((l) => /console\.(log|warn|error)/.test(l))) assert.ok(!/reason|message|body/.test(line.replace(/'[^']*'/g, '')), line);
});
