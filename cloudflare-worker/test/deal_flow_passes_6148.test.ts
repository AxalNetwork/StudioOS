/**
 * D6148 (#6148) — Pass reasons on Screening read the firm's own passes
 * (`GET /api/deals/flow/passes`), and a pass with a date comes back in New
 * for you on that date, labelled as a return.
 *
 * The same made-up firms, people and deals as deal_flow_d1238.test.ts:
 * 1 Ivy and 2 Ian at firm 10; 3 Oona at firm 20; 5 Ada an admin. Deals 101
 * Acme, 102 Bluefern, 103 Cobalt, 104 Delta, 105 Ember, 106 Gone (deleted).
 * A date "arrives" by writing a past `revisit_at` straight to the row: the
 * pass itself refuses a date that is not after today.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_flow_passes_6148.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_flow.ts';
import { readPasses, scopeFor } from '../src/services/dealFlow.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6148-01234567890123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['entities', 'users', 'founders', 'user_sessions', 'user_company_links', 'company_profiles', 'projects', 'deals', 'deal_invitations', 'commitments',
    'investor_dealroom_members', 'intro_propositions', 'syndicates', 'watchlist_items']) db.exec(tableFromBaseline(baseline, t));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/618_deal_flow.sql', 'utf8'));
  // D1137: resolveActiveCompany refuses an archived company, so the firm needs 597's archived_at.
  db.exec(readFileSync('cloudflare-worker/sql/migrations/597_company_archive_and_events.sql', 'utf8'));
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (40,'Fay','fay@example.test');
    INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES
      (1,'Ivy','ivy@example.test','investor',NULL,'approved',1),(2,'Ian','ian@example.test','investor',NULL,'approved',1),
      (3,'Oona','oona@example.test','investor',NULL,'approved',1),(4,'Fay','fay@example.test','founder',40,'approved',1),
      (5,'Ada','ada@example.test','admin',NULL,'approved',1),(6,'Noor','noor@example.test','investor',NULL,'approved',1),
      (7,'Gone seat','gone@example.test','investor',NULL,'approved',0);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',10,1),('l2',10,2),('l3',20,3),('l7',10,7);
    INSERT INTO projects(id,uid,name,founder_id,sector,stage,deleted_at) VALUES
      (11,'acme','Acme',NULL,'Robotics','seed',NULL),(12,'blue','Bluefern',NULL,'Health','seed',NULL),(13,'cob','Cobalt',NULL,'Climate','seed',NULL),
      (14,'del','Delta',NULL,'Fintech','seed',NULL),(15,'emb','Ember',40,'AI','seed',NULL),(16,'gone','Gone',NULL,'AI','seed','2026-10-01');
    INSERT INTO deals(id,project_id,status,amount,target_raise,stage_changed_at) VALUES
      (101,11,'active',500000,1500000,'2026-10-01 00:00:00'),(102,12,'active',NULL,NULL,NULL),(103,13,'scored',NULL,NULL,NULL),
      (104,14,'active',NULL,NULL,NULL),(105,15,'applied',NULL,NULL,NULL),(106,16,'active',NULL,NULL,NULL);
    INSERT INTO deal_invitations(id,deal_id,investor_user_id,message,status,company_id,created_at) VALUES
      (1,101,1,'Take a look at Acme','invited',10,'2026-10-20 10:00:00'),(2,106,1,'Gone','invited',10,'2026-10-21 10:00:00');
    INSERT INTO commitments(id,deal_id,investor_user_id,amount,status,company_id,created_at) VALUES (1,101,2,25000,'pending',10,'2026-10-22 10:00:00');
    INSERT INTO investor_dealroom_members(investor_user_id,deal_id,company_id,joined_at) VALUES (1,102,10,'2026-10-23 10:00:00');
    INSERT INTO syndicates(id,name,created_by,deal_id,status,created_at) VALUES (1,'Cobalt club',3,103,'open','2026-10-24 10:00:00'),(2,'Closed',3,104,'closed','2026-10-24 10:00:00');
    INSERT INTO watchlist_items(id,uid,owner_user_id,project_id,status,converted_deal_id,converted_at) VALUES (1,'w1',1,14,'converted',104,'2026-10-19 10:00:00');
    INSERT INTO intro_propositions(id,uid,user_id,target_user_id,status,responded_at) VALUES (1,'ip1',1,4,'accepted','2026-10-18 10:00:00');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production' } as any };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown, company: number | null = 10) {
  const app = new Hono<any>(); app.route('/api/deals/flow', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (company != null) headers['X-Company-Id'] = String(company);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = console.error; console.error = () => {};
  try {
    const res = await app.request('/api/deals/flow' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.error = saved; }
}

const FUTURE = '2999-01-01';
const arrive = (f: any, dealId: number, day = '2020-01-02') => f.db.prepare("UPDATE deal_flow_entries SET revisit_at = ? WHERE deal_id = ? AND scope_key = 'c:10'").run(day, dealId);
const studioPass = (f: any, dealId: number) => f.db.prepare("UPDATE deals SET pass_reason = 'team', passed_at = '2026-10-01 00:00:00' WHERE id = ?").run(dealId);

test('Pass reasons counts the firm\'s own passes, the same rows Deal flow counts at Passed', async () => {
  // Mutation checked: the scope dropped from the read → firm 20's pass is counted for firm 10;
  // the stage filter dropped → the sourcing row is counted as a pass.
  const f = fixture();
  assert.equal((await call(f, '/101/pass', 1, 'POST', { reason: 'valuation', revisit: 'date', revisit_at: FUTURE })).status, 200);
  assert.equal((await call(f, '/103/pass', 2, 'POST', { reason: 'valuation' })).status, 200);
  assert.equal((await call(f, '/104/pass', 1, 'POST', { reason: 'team' })).status, 200);
  await call(f, '', 1, 'POST', { deal_id: 102 });
  assert.equal((await call(f, '/105/pass', 3, 'POST', { reason: 'early' }, 20)).status, 200, 'another firm passes on its own row');
  studioPass(f, 102);
  const r = await call(f, '/passes', 2);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const flow = await call(f, '', 2);
  assert.equal(r.body.total, flow.body.by_stage.passed, 'Pass reasons and Deal flow disagree on how many passes the firm has');
  assert.deepEqual([r.body.scope, r.body.total], ['firm', 3]);
  const count = Object.fromEntries(r.body.buckets.map((b: any) => [b.reason, b.count]));
  assert.deepEqual(count, { early: 0, valuation: 2, thesis: 0, team: 1, competitive: 0 }, 'a count is not the firm\'s own');
  assert.equal(r.body.buckets.find((b: any) => b.reason === 'valuation').pct, 67);
  const acme = r.body.items.find((i: any) => i.deal_id === 101);
  assert.deepEqual([acme.reason, acme.revisit, acme.revisit_at, acme.due, acme.venture], ['valuation', 'date', FUTURE, false, 'Acme']);
  assert.equal(r.body.items.find((i: any) => i.deal_id === 103).revisit, 'next_round');
  assert.ok(!r.body.items.some((i: any) => i.deal_id === 105), 'another firm\'s pass reached this firm');
  assert.ok(!r.body.items.some((i: any) => i.deal_id === 102), 'the studio\'s round-level pass is shown as the firm\'s');
  assert.deepEqual(r.body.next_round.detected, false, 'next round is claimed as detected');
  assert.match(r.body.next_round.reason, /not detected/);
});

test('with no passes the share is null, never 0%; another firm and no firm read none of firm 10\'s', async () => {
  const f = fixture();
  await call(f, '/101/pass', 1, 'POST', { reason: 'team' });
  const none = await call(f, '/passes', 3, 'GET', undefined, 20);
  assert.equal(none.status, 200);
  assert.equal(none.body.total, 0);
  for (const b of none.body.buckets) assert.deepEqual([b.count, b.pct], [0, null], 'an empty record printed a share');
  const own = await call(f, '/passes', 1, 'GET', undefined, null);
  assert.deepEqual([own.body.scope, own.body.total], ['you', 0], 'with no firm selected, Ivy read the firm\'s passes');
});

test('only an investor reads Pass reasons: an admin, a founder and no one signed in are refused', async () => {
  const f = fixture();
  const admin = await call(f, '/passes', 5);
  assert.deepEqual([admin.status, admin.body.code], [403, 'investor_required']);
  assert.equal((await call(f, '/passes', 4)).status, 403);
  assert.equal((await call(f, '/passes', null)).status, 401);
});

test('/passes is a literal, never read as a deal id', async () => {
  const src = readFileSync('cloudflare-worker/src/routes/deal_flow.ts', 'utf8');
  const at = src.indexOf("routes.get('/passes'");
  assert.ok(at > 0, 'the passes route is gone');
  for (const param of ["routes.patch('/:dealId'", "routes.post('/:dealId/pass'", "routes.get('/:dealId/events'"]) assert.ok(at < src.indexOf(param), `/passes is registered after ${param}`);
});

test('a pass with a date comes back in New for you on that date, labelled as a return; Next round does not come back', async () => {
  // Mutation checked: the date test dropped → a pass due in 2999 is listed now;
  // the source dropped → the arrived pass never comes back.
  const f = fixture();
  await call(f, '/101/pass', 1, 'POST', { reason: 'valuation', revisit: 'date', revisit_at: FUTURE });
  await call(f, '/103/pass', 1, 'POST', { reason: 'early' });
  const before = await call(f, '/inbox', 2);
  assert.ok(!before.body.items.some((i: any) => i.source === 'revisit'), 'a pass came back before its date');
  assert.deepEqual(before.body.sources.revisit, { available: true });
  arrive(f, 101);
  const after = await call(f, '/inbox', 2);
  const back = after.body.items.filter((i: any) => i.source === 'revisit');
  assert.equal(back.length, 1, JSON.stringify(after.body.items));
  assert.deepEqual([back[0].deal_id, back[0].venture, back[0].return.reason, back[0].return.revisit_at, back[0].can_open], [101, 'Acme', 'valuation', '2020-01-02', true]);
  assert.match(back[0].key, /^revisit:\d+:20200102$/);
  assert.ok(!after.body.items.some((i: any) => i.source === 'revisit' && i.deal_id === 103), 'a Next round pass came back with no round detected');
  assert.deepEqual(after.body.sources.next_round.detected, false);
  assert.equal((await call(f, '/inbox', 3, 'GET', undefined, 20)).body.items.filter((i: any) => i.source === 'revisit').length, 0, 'another firm sees firm 10\'s return');
  // Readable through the service with a fixed today, too.
  const s = await readPasses(f.env, scopeFor({ id: 1 } as any, 10), '2020-01-02');
  assert.equal(s.items.find((i: any) => i.deal_id === 101).due, true);
});

test('a return is hidden by Not for me until a later date, and leaves New for you once moved back onto the board', async () => {
  const f = fixture();
  await call(f, '/101/pass', 1, 'POST', { reason: 'valuation', revisit: 'date', revisit_at: FUTURE });
  arrive(f, 101);
  const key = (await call(f, '/inbox', 1)).body.items.find((i: any) => i.source === 'revisit').key;
  assert.equal((await call(f, `/inbox/${key}/dismiss`, 1, 'POST', {})).status, 200);
  assert.ok(!(await call(f, '/inbox', 1)).body.items.some((i: any) => i.source === 'revisit'), 'Not for me left the return listed');
  arrive(f, 101, '2020-02-03');
  assert.ok((await call(f, '/inbox', 1)).body.items.some((i: any) => i.source === 'revisit'), 'a later date did not bring it back');
  assert.equal((await call(f, '/101', 1, 'PATCH', { stage: 'screening' })).status, 200);
  assert.ok(!(await call(f, '/inbox', 1)).body.items.some((i: any) => i.source === 'revisit'), 'a deal back on the board is still listed as a return');
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 101, via_key: key })).status, 404, 'a return key added the deal a second time');
});
