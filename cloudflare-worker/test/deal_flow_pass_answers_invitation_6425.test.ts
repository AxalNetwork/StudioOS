/**
 * #6425 (D6425) — a Deal flow pass answers the viewer's own invitation to the deal.
 *
 * Through the mounted `routes/deal_flow.ts`, on the baseline tables D1238's test builds:
 *   1. a pass on an invited deal from New for you sets the invitation 'passed' with `responded_at`, and the
 *      studio gets `/invitations/respond`'s own notice; the row says the invitation is answered;
 *   2. a pass on a deal that is not an invitation writes no invitation and sends no notice;
 *   3. an invitation answered 'interested' is re-answered 'passed' with a notice, as `/invitations/respond` allows;
 *      one already 'passed' is left alone;
 *   4. a colleague's pass on the firm's row never answers someone else's invitation;
 *   5. a pass whose flow write loses its guard changes no invitation (the two land together or not at all);
 *      a notice that cannot be sent leaves the pass and the answer in place.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_flow_pass_answers_invitation_6425.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/deal_flow.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6425-01234567890123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['entities', 'users', 'founders', 'user_sessions', 'user_company_links', 'company_profiles', 'projects', 'deals', 'deal_invitations', 'commitments',
    'investor_dealroom_members', 'intro_propositions', 'syndicates', 'watchlist_items', 'notifications_inbox', 'notification_outbox']) db.exec(tableFromBaseline(baseline, t));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/618_deal_flow.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/597_company_archive_and_events.sql', 'utf8'));
  db.exec(`
    INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES
      (1,'Synthetic Ivy','ivy@example.test','investor',NULL,'approved',1),(2,'Synthetic Ian','ian@example.test','investor',NULL,'approved',1),
      (5,'Synthetic Studio','studio@example.test','admin',NULL,'approved',1);
    INSERT INTO user_company_links(uid,company_id,user_id) VALUES ('l1',10,1),('l2',10,2);
    INSERT INTO projects(id,uid,name,founder_id,sector,stage,deleted_at) VALUES
      (11,'acme','Synthetic Acme',NULL,'Robotics','seed',NULL),(12,'blue','Synthetic Bluefern',NULL,'Health','seed',NULL);
    INSERT INTO deals(id,project_id,status,amount,target_raise,stage_changed_at) VALUES (101,11,'active',NULL,NULL,NULL),(102,12,'active',NULL,NULL,NULL);
    INSERT INTO deal_invitations(id,deal_id,investor_user_id,invited_by_user_id,message,status,company_id,created_at) VALUES
      (1,101,1,5,'Synthetic look','invited',10,'2026-10-20 10:00:00');
    INSERT INTO investor_dealroom_members(investor_user_id,deal_id,company_id,joined_at) VALUES (1,102,10,'2026-10-23 10:00:00');`);
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production' } as any };
}

async function call(f: any, path: string, who = 1, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/api/deals/flow', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = { 'X-Company-Id': '10', Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET)) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = [console.error, console.warn]; console.error = () => {}; console.warn = () => {};
  try {
    const res = await app.request('/api/deals/flow' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { [console.error, console.warn] = saved; }
}
const invitation = (f: any) => f.db.prepare('SELECT status, responded_at FROM deal_invitations WHERE id = 1').get() as any;
const notices = (f: any) => f.db.prepare("SELECT user_id, type, title, payload FROM notifications_inbox WHERE type = 'deal_invitation_response'").all() as any[];
const PASS = { reason: 'valuation' };

test('1. a pass on an invited deal from New for you answers the invitation and tells the studio', async () => {
  // Mutation checked: the answer statement dropped → the invitation stays 'invited';
  // the notice dropped → no inbox row; the row's invitation field read from the wrong user → null.
  const f = fixture();
  const r = await call(f, '/101/pass', 1, 'POST', { ...PASS, via_key: 'invitation:1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invitation_answered, true);
  assert.equal(r.body.my_invitation, 'passed');
  const inv = invitation(f);
  assert.equal(inv.status, 'passed');
  assert.ok(inv.responded_at, 'responded_at is set');
  const n = notices(f);
  assert.equal(n.length, 1);
  assert.deepEqual([n[0].user_id, n[0].title, JSON.parse(n[0].payload)], [5, 'Synthetic Ivy is passed in a deal', { deal_id: 101, response: 'passed' }]);
});

test('2. a pass on a deal that is not an invitation writes no invitation and sends no notice', async () => {
  const f = fixture();
  const r = await call(f, '/102/pass', 1, 'POST', { ...PASS, via_key: 'room:102' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.invitation_answered, r.body.my_invitation], [false, null]);
  assert.equal(invitation(f).status, 'invited', 'the other deal\'s invitation is untouched');
  assert.equal(notices(f).length, 0);
});

test('3. an \'interested\' answer is re-answered with a notice, as /invitations/respond allows; \'passed\' is left alone', async () => {
  // Mutation checked: `status <> 'passed'` widened to every status → a second notice for an already-passed invitation.
  const f = fixture();
  f.db.exec(`UPDATE deal_invitations SET status = 'interested', responded_at = '2026-10-25 10:00:00' WHERE id = 1`);
  const added = await call(f, '', 1, 'POST', { deal_id: 101 });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.my_invitation, 'interested');
  const r = await call(f, '/101/pass', 1, 'POST', PASS);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invitation_answered, true);
  assert.equal(invitation(f).status, 'passed');
  assert.notEqual(invitation(f).responded_at, '2026-10-25 10:00:00');
  assert.equal(notices(f).length, 1);

  const g = fixture();
  g.db.exec(`UPDATE deal_invitations SET status = 'passed', responded_at = '2026-10-25 10:00:00' WHERE id = 1`);
  await call(g, '', 1, 'POST', { deal_id: 101 });
  const again = await call(g, '/101/pass', 1, 'POST', PASS);
  assert.equal(again.status, 200);
  assert.equal(again.body.invitation_answered, false);
  assert.deepEqual([invitation(g).responded_at, notices(g).length], ['2026-10-25 10:00:00', 0]);
});

test('4. a colleague\'s pass on the firm\'s row never answers someone else\'s invitation', async () => {
  // Mutation checked: the invitation looked up by deal alone (not the viewer) → Ivy's invitation is answered by Ian.
  const f = fixture();
  assert.equal((await call(f, '', 1, 'POST', { deal_id: 101 })).status, 201);
  const flow = await call(f, '', 2);
  assert.equal(flow.body.items.find((i: any) => i.deal_id === 101).my_invitation, null, 'Ian has no invitation of his own');
  const r = await call(f, '/101/pass', 2, 'POST', PASS);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.invitation_answered, false);
  assert.equal(invitation(f).status, 'invited');
  assert.equal(notices(f).length, 0);
});

test('5. the answer lands only with the pass; a failed notice leaves both in place', async () => {
  // Mutation checked: the EXISTS guard dropped → the invitation is answered although the pass was refused (409);
  // the notice awaited without its catch → the pass answers 500 when the inbox cannot be written.
  const f = fixture();
  const inner = f.env.DB;
  // The flow write loses its guard (another pass landed first): it writes nothing.
  f.env.DB = { ...inner, prepare: (sql: string) => inner.prepare(sql.startsWith('INSERT INTO deal_flow_entries') ? sql + ' AND 0' : sql) };
  const lost = await call(f, '/101/pass', 1, 'POST', { ...PASS, via_key: 'invitation:1' });
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  assert.deepEqual([invitation(f).status, notices(f).length], ['invited', 0], 'no answer without the pass');

  const g = fixture();
  g.db.exec('DROP TABLE notifications_inbox; DROP TABLE notification_outbox');
  const r = await call(g, '/101/pass', 1, 'POST', { ...PASS, via_key: 'invitation:1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(invitation(g).status, 'passed', 'the answer stands without its notice');
  assert.equal((g.db.prepare("SELECT stage FROM deal_flow_entries WHERE deal_id = 101").get() as any).stage, 'passed');
});
