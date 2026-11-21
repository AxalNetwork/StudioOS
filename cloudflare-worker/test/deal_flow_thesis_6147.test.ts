/**
 * D6147 (#6147) — New for you's `thesis` source: open rounds whose fit to the
 * investor's own thesis (D1239's scorer) is High, not in the flow, not
 * dismissed and not already brought by another way in; newest first, capped.
 *
 * Real routes and services over the canonical schema. Every firm, person and
 * deal is made up.
 *
 * People: 1 Ivy and 2 Ian, investors at firm 10; 3 Oona, an investor at firm
 * 20; 6 Noor, an investor with no thesis. Ivy, Ian and Oona share one thesis:
 * Robotics or Climate, Seed, Europe, a ticket up to 50,000 USD.
 * Deals (every venture Seed unless said):
 *   201 Arc     Robotics, open, min 20k, a Portuguese market; nobody invited  → match on sector and ticket only
 *   202 Bolt    Health, open, min 20k                                          → 50: below High
 *   203 Cirrus  Robotics, scored (not open)                                    → not an open round
 *   204 Dune    Climate, Growth, open, min 20k, a Portuguese market; Ivy's invitation (interested) → 75, opens
 *   205 Echo    Climate, Growth, open, min 90k; Ivy's invitation (interested)      → 33: below High
 *   207 Gone    Robotics, open, deleted venture
 *   208 Helm    Robotics, open; Ivy invited (still `invited`)                 → arrives as an invitation, not a match
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_flow_thesis_6147.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_flow.ts';
import { THESIS_HIGH_FIT, THESIS_MATCH_CAP, THESIS_NOT_SET, THESIS_UNREADABLE } from '../src/services/dealFlow.ts';
import { tableFromBaseline, splitStatements } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6147-01234567890123456789';
const read = (p: string) => readFileSync(p, 'utf8');
const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
const THESIS = `'["Robotics","Climate"]','["Seed"]','["Europe"]',10000,50000`;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['entities', 'users', 'founders', 'user_sessions', 'user_company_links', 'company_profiles', 'projects', 'deals', 'deal_invitations', 'commitments',
    'investor_dealroom_members', 'intro_propositions', 'syndicates', 'watchlist_items', 'investor_profiles']) db.exec(tableFromBaseline(baseline, t));
  db.exec(read('cloudflare-worker/sql/migrations/599_deal_currency.sql'));
  db.exec(tableFromBaseline(read('cloudflare-worker/sql/migrations/443_grow_stores.sql'), 'markets'));
  for (const sql of splitStatements(read('cloudflare-worker/sql/migrations/462_grow_record_stores.sql'))) if (/ALTER TABLE markets/i.test(sql)) db.exec(sql);
  db.exec(read('cloudflare-worker/sql/migrations/376_research_taxonomy.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/618_deal_flow.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/597_company_archive_and_events.sql'));
  db.exec(`
    INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES
      (1,'Ivy','ivy@example.test','investor',NULL,'approved',1),(2,'Ian','ian@example.test','investor',NULL,'approved',1),
      (3,'Oona','oona@example.test','investor',NULL,'approved',1),(6,'Noor','noor@example.test','investor',NULL,'approved',1);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',10,1),('l2',10,2),('l3',20,3);
    INSERT INTO investor_profiles(user_id,sectors_json,stages_json,geos_json,ticket_min_usd,ticket_max_usd) VALUES (1,${THESIS}),(2,${THESIS}),(3,${THESIS});
    INSERT INTO projects(id,uid,name,founder_id,sector,stage,deleted_at) VALUES
      (21,'arc','Arc',NULL,'Robotics','Seed',NULL),(22,'bolt','Bolt',NULL,'Health','Seed',NULL),(23,'cir','Cirrus',NULL,'Robotics','Seed',NULL),
      (24,'dune','Dune',NULL,'Climate','Growth',NULL),(25,'echo','Echo',NULL,'Climate','Growth',NULL),(27,'gone','Gone',NULL,'Robotics','Seed','2026-10-01'),
      (28,'helm','Helm',NULL,'Robotics','Seed',NULL);
    INSERT INTO deals(id,project_id,status,minimum_check,currency,stage_changed_at) VALUES
      (201,21,'active',20000,'USD','2026-11-06 10:00:00'),(202,22,'active',20000,'USD','2026-11-07 10:00:00'),
      (203,23,'scored',20000,'USD','2026-11-08 10:00:00'),(204,24,'active',20000,'USD','2026-11-05 10:00:00'),
      (205,25,'active',90000,'USD','2026-11-09 10:00:00'),(207,27,'active',20000,'USD','2026-11-10 10:00:00'),
      (208,28,'active',20000,'USD','2026-11-11 10:00:00');
    INSERT INTO deal_invitations(id,deal_id,investor_user_id,message,status,company_id,created_at) VALUES
      (1,204,1,NULL,'interested',10,'2026-11-01 10:00:00'),(2,205,1,NULL,'interested',10,'2026-11-01 10:00:00'),
      (3,208,1,'Helm is raising','invited',10,'2026-11-02 10:00:00');
    INSERT INTO markets(uid,project_id,name,state,geography_ref) VALUES ('m-arc',21,'Portugal','served','PT'),('m-dune',24,'Portugal','served','PT');`);
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
const thesisItems = (r: any) => r.body.items.filter((i: any) => i.source === 'thesis');
const keys = (r: any) => r.body.items.map((i: any) => i.key);

test('a High fit open round arrives as a thesis match with its reasons; below High, not open, deleted or already brought by another way in, it does not', async () => {
  // Mutation checked: threshold 50 → Bolt (50) listed; threshold 80 → Dune (75) dropped; status filter dropped → Cirrus listed;
  // the other-ways-in set ignored → Helm listed twice.
  const f = fixture();
  const r = await call(f, '/inbox');
  assert.equal(r.status, 200);
  assert.deepEqual(thesisItems(r).map((i: any) => [i.key, i.entered_via, i.deal_id, i.reasons]), [
    ['thesis:201', 'thesis', 201, ['sector', 'ticket']],
    ['thesis:204', 'thesis', 204, ['sector', 'region', 'ticket']],
  ]);
  assert.equal(THESIS_HIGH_FIT, 70);
  assert.ok(keys(r).includes('invitation:3'), 'Helm comes as its invitation…');
  assert.ok(!keys(r).includes('thesis:208'), '…and is not repeated as a match');
  assert.deepEqual(r.body.sources.thesis, { recorded: true, available: true, thesis_set: true, threshold: 'high', min_score: 70, cap: THESIS_MATCH_CAP, scan: 200, listed: 2, more: false });
});

test('the audience: an uninvited round is compared only on what the marketplace shows; Open only where DEAL\'s rule holds', async () => {
  // Mutation checked: the venture's stage and markets fed in for every round → Arc's reasons gain stage and region;
  // can_open always true → Arc opens.
  const f = fixture();
  const items = Object.fromEntries(thesisItems(await call(f, '/inbox')).map((i: any) => [i.deal_id, i]));
  assert.deepEqual(items[201].reasons, ['sector', 'ticket'], 'Arc\'s stage and market are not read for an investor it was not shown to');
  assert.equal(items[201].can_open, false);
  assert.equal(items[204].can_open, true, 'Ivy\'s interested invitation opens Dune');
  assert.deepEqual(Object.keys(items[201]).sort(), ['at', 'can_open', 'deal_id', 'entered_via', 'key', 'message', 'reasons', 'round_status', 'sector', 'source', 'venture']);
  assert.equal(items[201].message, null);
});

test('Not for me hides a match for the firm and it does not return; another firm still has it', async () => {
  // Mutation checked: the dismissal clause dropped from the thesis read → thesis:201 returns; `thesis` left out of KEY → 404.
  const f = fixture();
  const d = await call(f, '/inbox/thesis:201/dismiss', 1, 'POST', { reason: 'Not now.' });
  assert.deepEqual([d.status, d.body.ok], [200, true]);
  assert.ok(!keys(await call(f, '/inbox', 1)).includes('thesis:201'));
  assert.ok(!keys(await call(f, '/inbox', 2)).includes('thesis:201'), 'hidden for every seat of the firm');
  assert.ok(keys(await call(f, '/inbox', 3, 'GET', undefined, 20)).includes('thesis:201'), 'still a match for another firm');
  assert.equal((await call(f, '/inbox/thesis:202/dismiss', 1, 'POST', {})).status, 404, 'a round below High is not in the inbox');
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 201, via_key: 'thesis:201' })).status, 404, 'a dismissed match no longer adds');
});

test('Add and Pass take a match into the flow as entered by thesis, and it is no longer new', async () => {
  const f = fixture();
  const add = await call(f, '', 1, 'POST', { deal_id: 201, via_key: 'thesis:201' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.deepEqual([add.body.entered_via, add.body.can_open], ['thesis', false]);
  assert.ok(!keys(await call(f, '/inbox', 2)).includes('thesis:201'));
  const pass = await call(f, '/204/pass', 1, 'POST', { reason: 'valuation', via_key: 'thesis:204' });
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  assert.deepEqual([pass.body.stage, pass.body.entered_via], ['passed', 'thesis']);
  assert.ok(!keys(await call(f, '/inbox', 1)).includes('thesis:204'));
});

test('a broad thesis is capped: the newest matches, the cap stated, more said', async () => {
  // Mutation checked: no cap → 32 listed; oldest first → the first listed is not the newest.
  const f = fixture();
  for (let n = 0; n < 30; n += 1) {
    f.db.exec(`INSERT INTO projects(id,uid,name,sector,stage) VALUES (${300 + n},'p${n}','Bulk ${n}','Robotics','Seed');
      INSERT INTO deals(id,project_id,status,minimum_check,currency,stage_changed_at) VALUES (${400 + n},${300 + n},'active',20000,'USD','2026-11-${String(12 - Math.floor(n / 10)).padStart(2, '0')} ${String(10 + (n % 10)).padStart(2, '0')}:00:00');`);
  }
  const r = await call(f, '/inbox');
  const t = thesisItems(r);
  assert.equal(t.length, THESIS_MATCH_CAP);
  assert.equal(t[0].deal_id, 409, 'the newest round first');
  assert.ok(t.every((x: any, i: number) => i === 0 || Date.parse(t[i - 1].at.replace(' ', 'T') + 'Z') >= Date.parse(x.at.replace(' ', 'T') + 'Z')));
  assert.deepEqual([r.body.sources.thesis.cap, r.body.sources.thesis.listed, r.body.sources.thesis.more], [20, 20, true]);
});

test('the thesis read is bounded: the same statements for 6 open rounds as for 40', async () => {
  // Mutation checked: one geography read per round → the counts differ.
  const count = async (extra: number) => {
    const f = fixture();
    for (let n = 0; n < extra; n += 1) {
      f.db.exec(`INSERT INTO projects(id,uid,name,sector,stage) VALUES (${300 + n},'p${n}','Bulk ${n}','Climate','Seed');
        INSERT INTO deals(id,project_id,status,minimum_check,currency,stage_changed_at) VALUES (${400 + n},${300 + n},'active',20000,'USD','2026-11-01 10:00:00');
        INSERT INTO deal_invitations(deal_id,investor_user_id,status) VALUES (${400 + n},1,'interested');`);
    }
    let n = 0;
    const db = f.env.DB;
    f.env.DB = { ...db, prepare: (sql: string) => { n += 1; return db.prepare(sql); }, batch: db.batch?.bind(db) };
    const r = await call(f, '/inbox');
    assert.equal(r.status, 200);
    return n;
  };
  assert.equal(await count(0), await count(34));
});

test('no thesis is not an error: the source says so, with the way to set it', async () => {
  const f = fixture();
  const r = await call(f, '/inbox', 6, 'GET', undefined, null);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sources.thesis, { recorded: false, available: true, thesis_set: false, reason: THESIS_NOT_SET, threshold: 'high', min_score: 70, cap: 20, scan: 200 });
  assert.equal(thesisItems(r).length, 0);
  f.db.exec(`INSERT INTO investor_profiles(user_id,sectors_json) VALUES (6,'[]')`);
  assert.equal((await call(f, '/inbox', 6, 'GET', undefined, null)).body.sources.thesis.thesis_set, false, 'an empty preference list is no thesis');
});

test('a failed fit read marks only the thesis source unreadable; the other ways in still list', async () => {
  // Mutation checked: the thesis read outside its own try → the whole inbox 503s.
  const f = fixture();
  f.db.exec(`UPDATE investor_profiles SET sectors_json = 'not json' WHERE user_id = 1`);
  const r = await call(f, '/inbox');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sources.thesis, { recorded: false, available: false, unreadable: true, reason: THESIS_UNREADABLE });
  assert.ok(keys(r).includes('invitation:3'));
  assert.equal(thesisItems(r).length, 0);
  const g = fixture();
  g.db.exec('DROP TABLE markets');
  const q = await call(g, '/inbox');
  assert.equal(q.status, 200);
  assert.equal(q.body.sources.thesis.unreadable, true, 'a market read that fails is a failed fit read');
  assert.ok(keys(q).includes('invitation:3'));
});
