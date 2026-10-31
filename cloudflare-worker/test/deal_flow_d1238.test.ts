/**
 * D1238 (#3251, part 2 of #2423) — an investor firm's own deal flow
 * (migration 618), its events, its routes and the New for you inbox.
 *
 * Real routes and services over the canonical schema. Every firm, person and
 * deal is made up.
 *
 * People: 1 Ivy and 2 Ian, investors at firm 10; 3 Oona, an investor at firm
 * 20; 4 Fay, a founder; 5 Ada, an admin; 6 Noor, an investor with no firm.
 * Deals: 101 Acme (invited Ivy, committed Ian), 102 Bluefern (Ivy joined the
 * room), 103 Cobalt (open syndicate), 104 Delta (Ivy's watchlist converted),
 * 105 Ember (Fay's venture; Ivy accepted an introduction to Fay), 106 Gone
 * (deleted venture).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_flow_d1238.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_flow.ts';
import { INVESTOR_PRO_EXEMPT } from '../src/middleware/requireInvestorTier.ts';
import { daysIn } from '../src/services/dealFlow.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d1238-01234567890123456789';
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
const roundOf = (f: any, id: number) => (f.db.prepare('SELECT status FROM deals WHERE id=?').get(id) as any).status;
const keys = (r: any) => r.body.items.map((i: any) => i.key);

// ---------------------------------------------------------------- the flow and its firm

test('a firm keeps one flow: a seat adds a deal, every seat reads it with its days in stage; another firm and no firm read none of it', async () => {
  // Mutation checked: the scope dropped from the read → Oona sees firm 10's row; the firm key read as the user's → Ian sees nothing.
  const f = fixture();
  const add = await call(f, '', 1, 'POST', { deal_id: 101 });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.deepEqual([add.body.stage, add.body.entered_via, add.body.owner.user_id, add.body.can_open, add.body.venture, add.body.round_status, add.body.ask], ['sourcing', 'added', 1, true, 'Acme', 'active', 1500000]);
  const ian = await call(f, '', 2);
  assert.deepEqual([ian.status, ian.body.scope, ian.body.items.map((i: any) => i.deal_id), ian.body.by_stage.sourcing], [200, 'firm', [101], 1]);
  assert.equal((await call(f, '', 3, 'GET', undefined, 20)).body.items.length, 0, 'another firm reads none of it');
  assert.equal((await call(f, '', 1, 'GET', undefined, null)).body.items.length, 0, 'with no firm selected, Ivy reads her own flow, which is empty');
  assert.equal((await call(f, '', 1, 'GET', undefined, 20)).body.items.length, 0, 'a firm Ivy is not linked to is no firm: her own flow');
  assert.equal((await call(f, '/101', 3, 'PATCH', { stage: 'screening' }, 20)).status, 404, 'another firm cannot move it');
  assert.equal((await call(f, '/101/pass', 3, 'POST', { reason: 'team' }, 20)).status, 200, 'firm 20 passing on its own row…');
  assert.equal((await call(f, '', 2)).body.items[0].stage, 'sourcing', '…leaves firm 10\'s row as it was');
});

test('days in stage are whole days from the last move; a missing time is null, never 0', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(daysIn('2026-10-20 11:00:00', now), 6);
  assert.equal(daysIn('2026-10-26T11:59:00Z', now), 0);
  assert.equal(daysIn(null, now), null);
  assert.equal(daysIn('not a date', now), null);
});

test('only an investor has a deal flow; a founder, an admin and no one signed in are refused', async () => {
  const f = fixture();
  assert.deepEqual([(await call(f, '', 4)).status, (await call(f, '', 5)).status, (await call(f, '', null)).status], [403, 403, 401]);
  assert.equal((await call(f, '', 4, 'POST', { deal_id: 101 })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM deal_flow_entries').get().n, 0);
});

test('a row opens its deal only where DEAL\'s rule holds: Ivy is invited to Acme; Bluefern opens nothing', async () => {
  // Mutation checked: can_open always true.
  const f = fixture();
  await call(f, '', 1, 'POST', { deal_id: 102 });
  await call(f, '', 1, 'POST', { deal_id: 101 });
  const rows = Object.fromEntries((await call(f, '', 1)).body.items.map((i: any) => [i.deal_id, i.can_open]));
  assert.deepEqual(rows, { 101: true, 102: false });
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 106 })).status, 404, 'a deleted venture\'s deal cannot be added');
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 999 })).status, 404);
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 101 })).status, 409, 'already in the flow');
});

// ---------------------------------------------------------------- moves

test('Closing only after a commitment: refused for Bluefern; allowed for Acme, where a seat of the firm committed', async () => {
  // Mutation checked: the commitment check removed (add and move); a withdrawn commitment counted; the firm's seats not counted.
  const f = fixture();
  await call(f, '', 1, 'POST', { deal_id: 102 });
  const refused = await call(f, '/102', 1, 'PATCH', { stage: 'closing' });
  assert.deepEqual([refused.status, refused.body.code], [409, 'closing_needs_commitment']);
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 104, stage: 'closing' })).status, 409);
  await call(f, '', 1, 'POST', { deal_id: 101 });
  const ok = await call(f, '/101', 1, 'PATCH', { stage: 'closing' });
  assert.deepEqual([ok.status, ok.body.stage], [200, 'closing'], 'Ian\'s commitment is the firm\'s');
  f.db.exec("UPDATE commitments SET status='withdrawn'");
  await call(f, '/101', 1, 'PATCH', { stage: 'commit' });
  assert.equal((await call(f, '/101', 1, 'PATCH', { stage: 'closing' })).status, 409, 'a withdrawn commitment is none');
  assert.equal((await call(f, '/101', 6, 'PATCH', { stage: 'closing' }, null)).status, 404, 'Noor has no row');
});

test('a move records its event and resets days in stage; the owner is a seat of the firm; the note is kept, not its text in the events', async () => {
  // Mutation checked: no event on a move; an owner outside the firm accepted; a deactivated seat accepted.
  const f = fixture();
  await call(f, '', 1, 'POST', { deal_id: 101 });
  f.db.exec("UPDATE deal_flow_entries SET stage_changed_at='2026-10-01 00:00:00'");
  assert.ok((await call(f, '', 1)).body.items[0].days_in_stage > 20);
  const moved = await call(f, '/101', 2, 'PATCH', { stage: 'diligence', owner_user_id: 2, note: 'Check the IP assignment.' });
  assert.deepEqual([moved.status, moved.body.stage, moved.body.owner.user_id, moved.body.days_in_stage, moved.body.note], [200, 'diligence', 2, 0, 'Check the IP assignment.']);
  assert.deepEqual((await call(f, '/101', 1, 'PATCH', { owner_user_id: 3 })).body.code, 'invalid_owner', 'Oona is another firm');
  assert.deepEqual((await call(f, '/101', 1, 'PATCH', { owner_user_id: 7 })).body.code, 'invalid_owner', 'a deactivated seat');
  assert.deepEqual((await call(f, '/101', 1, 'PATCH', { stage: 'passed' })).body.code, 'use_pass');
  const ev = await call(f, '/101/events', 1);
  assert.deepEqual(ev.body.items.map((e: any) => [e.kind, e.from, e.to, e.by.user_id]), [['entered', null, 'sourcing', 1], ['moved', 'sourcing', 'diligence', 2], ['owner', null, null, 2], ['note', null, null, 2]]);
  assert.doesNotMatch(JSON.stringify(ev.body), /IP assignment/);
});

// ---------------------------------------------------------------- pass

test('a pass needs one of the five reasons, keeps the round open, and can come back at a date', async () => {
  // Mutation checked: a pass writing deals.status; the reason not required; a past revisit date accepted; leaving Passed keeping the pass on the row.
  const f = fixture();
  await call(f, '', 1, 'POST', { deal_id: 101 });
  assert.equal((await call(f, '/101/pass', 1, 'POST', {})).body.code, 'reason_required');
  assert.equal((await call(f, '/101/pass', 1, 'POST', { reason: 'boring' })).body.code, 'reason_required');
  assert.equal((await call(f, '/101/pass', 1, 'POST', { reason: 'early', revisit: 'date', revisit_at: '2001-01-01' })).body.code, 'invalid_revisit');
  const pass = await call(f, '/101/pass', 1, 'POST', { reason: 'early', revisit: 'date', revisit_at: '2099-03-15', note: 'Revisit once the second pilot converts.' });
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  assert.deepEqual([pass.body.stage, pass.body.pass.reason, pass.body.pass.revisit, pass.body.pass.revisit_at], ['passed', 'early', 'date', '2099-03-15']);
  assert.equal(roundOf(f, 101), 'active', 'the round stays open for every other investor');
  assert.equal(f.db.prepare('SELECT pass_reason FROM deals WHERE id=101').get().pass_reason, null);
  assert.equal((await call(f, '/101/pass', 1, 'POST', { reason: 'team' })).status, 409, 'already passed');
  // Moving back clears the pass from the row and keeps it in the events.
  const back = await call(f, '/101', 1, 'PATCH', { stage: 'screening' });
  assert.deepEqual([back.body.stage, back.body.pass], ['screening', null]);
  assert.deepEqual({ ...f.db.prepare('SELECT pass_reason, passed_at, revisit FROM deal_flow_entries WHERE deal_id=101').get() }, { pass_reason: null, passed_at: null, revisit: null });
  assert.deepEqual((await call(f, '/101/events', 1)).body.items.filter((e: any) => e.kind === 'passed').map((e: any) => e.reason), ['early']);
});

test('a pass on a deal not yet in the flow adds it as passed, from its New for you item', async () => {
  const f = fixture();
  const p = await call(f, '/102/pass', 1, 'POST', { reason: 'thesis', via_key: 'room:102' });
  assert.deepEqual([p.status, p.body.stage, p.body.entered_via, p.body.pass.revisit], [200, 'passed', 'requested', 'next_round']);
  assert.equal(roundOf(f, 102), 'active');
});

// ---------------------------------------------------------------- New for you

test('New for you lists each way in not yet in the flow, newest first, and leaves out a deleted venture', async () => {
  // Mutation checked: a source dropped; a closed syndicate listed; the deleted venture listed; deals in the flow not left out.
  const f = fixture();
  const r = await call(f, '/inbox', 1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i: any) => [i.key, i.entered_via, i.deal_id]), [
    ['syndicate:1', 'syndicate', 103], ['room:102', 'requested', 102], ['invitation:1', 'invited', 101],
    ['watchlist:1', 'watchlist', 104], ['introduction:1:105', 'introduction', 105],
  ]);
  assert.equal(r.body.items.find((i: any) => i.key === 'invitation:1').message, 'Take a look at Acme');
  assert.deepEqual(r.body.sources.thesis.recorded, false);
  // Ian's commitment is his own way in.
  assert.ok(keys(await call(f, '/inbox', 2)).includes('commitment:1'));
  await call(f, '', 1, 'POST', { deal_id: 101, via_key: 'invitation:1' });
  assert.ok(!keys(await call(f, '/inbox', 1)).includes('invitation:1'), 'in the flow: no longer new');
  assert.ok(!keys(await call(f, '/inbox', 2)).includes('commitment:1'), 'the firm\'s flow has it, so Ian\'s commitment is no longer new either');
  assert.equal((await call(f, '', 1)).body.items[0].entered_via, 'invited');
});

test('Not for me hides an item for the firm, with an optional reason; an unknown or stale key is refused', async () => {
  // Mutation checked: the key not checked against the inbox; dismissed items still listed.
  const f = fixture();
  const d = await call(f, '/inbox/syndicate:1/dismiss', 1, 'POST', { reason: 'Not our sector.' });
  assert.deepEqual([d.status, d.body.ok], [200, true]);
  assert.ok(!keys(await call(f, '/inbox', 2)).includes('syndicate:1'), 'hidden for every seat of the firm');
  assert.ok(keys(await call(f, '/inbox', 3, 'GET', undefined, 20)).includes('syndicate:1'), 'still new for another firm');
  assert.equal((await call(f, '/inbox/syndicate:2/dismiss', 1, 'POST', {})).status, 404, 'a closed syndicate is not in the inbox');
  assert.equal((await call(f, '/inbox/anything/dismiss', 1, 'POST', {})).status, 404);
  assert.equal((await call(f, '/inbox/room:102/dismiss', 1, 'POST', { reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 103, via_key: 'syndicate:1' })).status, 404, 'a dismissed item no longer adds');
});

test('one unreadable source is named and the rest still answer', async () => {
  const f = fixture();
  f.db.exec('DROP TABLE syndicates');
  const r = await call(f, '/inbox', 1);
  assert.equal(r.status, 200);
  assert.equal(r.body.sources.syndicate.unreadable, true);
  assert.ok(keys(r).includes('invitation:1') && !keys(r).some((k: string) => k.startsWith('syndicate')));
});

// ---------------------------------------------------------------- the wiring

test('the wiring: mounted before the deal routes, under the Professional gate, and no new interpolated SQL', () => {
  const index = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  const at = (s: string) => index.indexOf(s);
  assert.ok(at("app.route('/api/deals/flow', dealFlow);") > 0);
  assert.ok(at("app.route('/api/deals/flow', dealFlow);") < at("app.route('/api/deals', dealContext);"), 'before dealContext and deals, so flow is never a deal id');
  // D1421: the prefix arrays live in middleware/paywallPrefixes.ts; index.ts imports and mounts them.
  assert.match(readFileSync('cloudflare-worker/src/middleware/paywallPrefixes.ts', 'utf8'), /export const INVESTOR_PRO_PREFIXES[^=]*= \[[^\]]*'\/api\/deals'/);
  assert.match(index, /import \{ STUDIO_PREFIXES, INVESTOR_PRO_PREFIXES \} from '\.\/middleware\/paywallPrefixes';/);
  for (const [m, p] of [['GET', '/api/deals/flow'], ['GET', '/api/deals/flow/inbox'], ['POST', '/api/deals/flow/101/pass'], ['PATCH', '/api/deals/flow/101']]) {
    assert.ok(!INVESTOR_PRO_EXEMPT.some((e) => e.method === m && e.path.test(p)), `${m} ${p} stays Professional`);
  }
  const src = readFileSync('cloudflare-worker/src/services/dealFlow.ts', 'utf8');
  assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, 'no ${} inside a prepared statement');
  assert.doesNotMatch(src, /UPDATE deals\b/, 'nothing here writes deals');
});
