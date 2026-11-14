/**
 * D1322 (#3483, part 4 of #2400) — Use this draft:
 * `POST /api/publish/drafts/from-proposal/:proposalUid`, on the migrated
 * schema with the route mounted on a bare Hono. Proposals are seeded with
 * D780's `proposeRail`, as the rail's run will write them.
 *
 * What #3483 says must be tested, each below by name: Use this draft copies
 * the proposal with `origin = 'eadwyn'` and creates no `publish_sends` row;
 * each refusal (a second press, another member's proposal, another option, a
 * co-founder, an admin, a partner, a support session); two presses make one
 * draft; Discard writes no draft; the raw-SQL guard.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/publish_from_proposal_d1322.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import publishRoutes, { PUBLISH_RAIL_OPTION } from '../src/routes/publish.ts';
import { decideRail, getRail, proposeRail } from '../src/services/railProposals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

test.after(() => removeMigratedDatabases());

const SECRET = 's'.repeat(40); // in-memory test signing seed only
const FOUNDER = 1, COFOUNDER = 2, ADMIN = 3, PARTNER = 4;
const P = 701;
const PAGE = 'Founder · Grow · Product improvement';

const app = new Hono<any>();
app.route('/api/publish', publishRoutes);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'F','f@example.test'),(202,'C','c@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (1,'Founder','founder@example.test','founder',101,1),(2,'Cofounder','co@example.test','founder',202,1),
      (3,'Admin','admin@example.test','admin',101,1),(4,'Partner','partner@example.test','partner',NULL,1);
    INSERT INTO company_profiles(id,uid,company_name) VALUES (1,'co-1','Northwind Data');
    INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (${P},'p-1','Northwind',101,1);
    INSERT INTO user_company_links(uid,company_id,user_id,is_primary_admin) VALUES ('l1',1,1,1),('l2',1,2,0),('l3',1,3,0);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  async function call(who: number, path: string, extra: Record<string, unknown> = {}) {
    const token = await new SignJWT({ user_id: who, ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`https://unit.test${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }, env);
    return { status: res.status, body: await res.json().catch(() => null) as any };
  }
  const propose = (who = FOUNDER, over: Record<string, unknown> = {}, option = PUBLISH_RAIL_OPTION, kind: any = 'draft') => proposeRail(env, {
    userId: who, page: PAGE, option, kind,
    payload: { project: P, module: 'product-improvement', text: 'Shipped in October: bulk CSV import.', source_refs: [{ kind: 'release', id: 9 }], source: 'eadwyn', ...over },
  });
  const use = (who: number, uid: string, extra: Record<string, unknown> = {}) => call(who, `/api/publish/drafts/from-proposal/${uid}`, extra);
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n);
  return { db, env, call, propose, use, count };
}

test('Use this draft copies the proposal as an Eadwyn draft, keeps the proposal, and sends nothing', async () => {
  const f = fixture();
  const proposal = await f.propose();
  const r = await f.use(FOUNDER, proposal.uid);
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.draft.origin, r.body.draft.rail_proposal_uid, r.body.draft.module, r.body.draft.status], ['eadwyn', proposal.uid, 'product-improvement', 'draft']);
  assert.equal(r.body.draft.body.text, 'Shipped in October: bulk CSV import.');
  assert.deepEqual(r.body.draft.source_refs, [{ kind: 'release', id: 9 }]);
  assert.equal(r.body.draft.team_only_included, false);
  const row = f.db.prepare('SELECT * FROM publish_drafts WHERE uid = ?').get(r.body.draft.uid) as any;
  assert.deepEqual([row.origin, row.rail_proposal_uid, row.author_user_id, row.project_id, row.company_id, row.team_only_included], ['eadwyn', proposal.uid, FOUNDER, P, 1, 0]);
  assert.equal(f.count('publish_sends'), 0, 'a proposal never makes a send');
  assert.equal((await getRail(f.env, FOUNDER, proposal.uid))!.status, 'accepted');
});

test('Eadwyn never ticks team-only figures in, whatever the proposal says', async () => {
  const f = fixture();
  const proposal = await f.propose(FOUNDER, { team_only_included: true });
  const r = await f.use(FOUNDER, proposal.uid);
  assert.equal(r.status, 201);
  assert.equal(Number((f.db.prepare('SELECT team_only_included t FROM publish_drafts').get() as any).t), 0);
});

test('a second press is refused and makes no second draft; two presses at once make one draft', async () => {
  const f = fixture();
  const one = await f.propose();
  assert.equal((await f.use(FOUNDER, one.uid)).status, 201);
  const again = await f.use(FOUNDER, one.uid);
  assert.deepEqual([again.status, again.body.error], [409, 'wrong_state']);
  assert.equal(f.count('publish_drafts'), 1);
  const two = await f.propose();
  const both = await Promise.all([f.use(FOUNDER, two.uid), f.use(FOUNDER, two.uid)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  assert.equal(Number((f.db.prepare('SELECT COUNT(*) n FROM publish_drafts WHERE rail_proposal_uid = ?').get(two.uid) as any).n), 1);
  // A draft already made from a proposal still open is not made twice either.
  const three = await f.propose();
  f.db.prepare(`INSERT INTO publish_drafts (uid, project_id, module, author_user_id, origin, rail_proposal_uid) VALUES ('d-pre', ?, 'updates', 1, 'eadwyn', ?)`).run(P, three.uid);
  assert.equal((await f.use(FOUNDER, three.uid)).body.error, 'wrong_state');
  assert.equal((await getRail(f.env, FOUNDER, three.uid))!.status, 'proposed');
  assert.equal(f.count('publish_sends'), 0);
});

test('another member’s proposal, another option or kind, and a malformed payload are refused', async () => {
  const f = fixture();
  const theirs = await f.propose(COFOUNDER);
  assert.deepEqual([(await f.use(FOUNDER, theirs.uid)).status, (await f.use(FOUNDER, theirs.uid)).body.error], [404, 'not_found']);
  const other = await f.propose(FOUNDER, {}, 'draft:update');
  assert.equal((await f.use(FOUNDER, other.uid)).body.error, 'not_found');
  const note = await f.propose(FOUNDER, {}, PUBLISH_RAIL_OPTION, 'note');
  assert.equal((await f.use(FOUNDER, note.uid)).body.error, 'not_found');
  const module = await f.propose(FOUNDER, { module: 'raise' });
  assert.equal((await f.use(FOUNDER, module.uid)).body.error, 'invalid');
  const project = await f.propose(FOUNDER, { project: String(P) });
  assert.equal((await f.use(FOUNDER, project.uid)).body.error, 'invalid');
  assert.equal((await f.use(FOUNDER, 'no-such-proposal')).status, 404);
  assert.equal(f.count('publish_drafts'), 0);
  for (const p of [other, note, module, project]) assert.equal((await getRail(f.env, FOUNDER, p.uid))!.status, 'proposed');
});

test('a co-founder, an admin, a partner and a support session are refused, each on their own proposal', async () => {
  const f = fixture();
  for (const who of [COFOUNDER, ADMIN, PARTNER]) {
    const own = await f.propose(who);
    const r = await f.use(who, own.uid);
    assert.deepEqual([r.status, r.body.error], [403, 'publish_not_allowed'], `user ${who}`);
    assert.equal((await getRail(f.env, who, own.uid))!.status, 'proposed');
  }
  const mine = await f.propose();
  const support = await f.use(FOUNDER, mine.uid, { impersonated_by: 99 });
  assert.equal(support.body.error, 'support_session');
  assert.equal(f.count('publish_drafts'), 0);
  assert.equal((await getRail(f.env, FOUNDER, mine.uid))!.status, 'proposed');
});

test('Discard is D780’s decide: it writes no draft, and Use this draft after it is refused', async () => {
  const f = fixture();
  const proposal = await f.propose();
  assert.equal((await decideRail(f.env, FOUNDER, proposal.uid, 'discard'))!.status, 'discarded');
  assert.equal(f.count('publish_drafts'), 0);
  const r = await f.use(FOUNDER, proposal.uid);
  assert.deepEqual([r.status, r.body.error], [409, 'wrong_state']);
  assert.equal(f.count('publish_drafts'), 0);
});

test('the route never previews, confirms or writes a send', () => {
  const text = readFileSync(new URL('../src/routes/publish.ts', import.meta.url), 'utf8');
  const route = text.slice(text.indexOf("publish.post('/drafts/from-proposal/"), text.indexOf("publish.post('/drafts/:uid/preview'"));
  assert.ok(route.length > 200);
  assert.doesNotMatch(route, /previewFor|confirmSend|publish_sends|claimAndSend/);
});

test('the raw-SQL budget: no interpolated SQL in the publish route', () => {
  const text = readFileSync(new URL('../src/routes/publish.ts', import.meta.url), 'utf8');
  for (const m of text.matchAll(/prepare\(\s*`([^`]*)`/g)) assert.doesNotMatch(m[1], /\$\{/, m[1].slice(0, 60));
});
