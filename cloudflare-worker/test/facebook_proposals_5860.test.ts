/** D5860 (#5860): real Facebook decision routes and SQL, fixed clock, synthetic ventures and connections. */
import test, { before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import cycleGrow from '../src/routes/cycle_grow.ts';
import { channelRows } from '../src/services/growCycle.ts';
import { acceptFacebookProposal, facebookPart, linkOf, linkPage, purgeFacebookConnection, syncFacebook, unlinkPage } from '../src/services/facebook/grow.ts';
import { FOUNDER, COFOUNDER, ADVISOR, INVESTOR, PID, ROLE, growDb } from './_mercury_grow_fixture.ts';

const NOW = Date.UTC(2026, 10, 18, 12);
before(() => mock.timers.enable({ apis: ['Date'], now: NOW }));
after(() => mock.timers.reset());
const migrations = 'cloudflare-worker/sql/migrations';
const FB = 81;
const PAGE = '801';
const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);

async function world(t: any, owner = FOUNDER) {
  const w = await growDb();
  t.after(() => w.db.close());
  w.db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  w.db.exec(readFileSync(`${migrations}/202611041912_growth_channel_details.sql`, 'utf8'));
  w.db.exec(readFileSync(`${migrations}/435_connector_companies.sql`, 'utf8'));
  for (const issue of [5859, 5860]) {
    const file = readdirSync(migrations).find(f => new RegExp(`^\\d{12}_${issue}_facebook_`).test(f))!;
    w.db.exec(readFileSync(`${migrations}/${file}`, 'utf8'));
  }
  w.db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (?, 'fb', ?, 'facebook', 'active', 'oauth2')").run(FB, owner);
  w.db.prepare('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (?, 70, 1)').run(FB);
  if (owner === FOUNDER) w.db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (70, ?)').run(owner);
  await linkPage(w.env, { integrationId: FB, projectId: PID, userId: owner, pageId: PAGE, pageName: 'Synthetic Page' });
  return w;
}
const proposal = (w: any) => w.db.prepare('SELECT * FROM facebook_proposals WHERE project_id = ? AND subject = ?').get(PID, PAGE) as any;
const channels = (w: any) => w.db.prepare("SELECT * FROM growth_channels WHERE project_id = ? AND utm_source = 'facebook'").all(PID) as any[];
async function call(w: any, verb: string, id = proposal(w).id, who = FOUNDER, extra = {}, support = false) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], ...(support ? { impersonated_by: 3 } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const response = await app.request(`/api/cycles/grow/facebook/proposals/${id}/${verb}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: PID, ...extra }),
  }, w.env);
  return { status: response.status, body: await response.json() as any };
}
const sync = (w: any) => syncFacebook(w.env, { followers: async () => null, insights: async () => [] }, {
  integrationId: FB, projectId: PID, pageId: PAGE, today: '2026-11-18', cursor: null, backfilled: true,
});
const part = (w: any, who = FOUNDER, support = false, writer = true) => facebookPart(w.env, PID, 'distribution', { userId: who, support, writer });

test('link and repeated sync offer one proposal before any insights exist; acceptance creates the attributed channel through its writer', async t => {
  const w = await world(t);
  await sync(w); await sync(w);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM facebook_proposals').get().n, 1);
  const p = (await part(w)) as any;
  assert.equal(p.state, 'not_recorded');
  assert.deepEqual([p.proposal.state, p.proposal.can_decide, p.proposal.sentence], ['pending', true, 'Link your Facebook Page to a Distribution channel?']);
  assert.equal(channels(w).length, 0);
  const accepted = await call(w, 'accept');
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual([channels(w).length, channels(w)[0].utm_source, channels(w)[0].created_by], [1, 'facebook', FOUNDER]);
  assert.deepEqual([proposal(w).state, proposal(w).growth_channel_id, proposal(w).decided_by, Boolean(proposal(w).decided_at)], ['accepted', channels(w)[0].id, FOUNDER, true]);
  w.db.prepare("UPDATE contacts SET utm_json = '{\"utm_source\":\"facebook\"}', created_at = '2026-11-18' WHERE uid = 'ct1'").run();
  const rows = await channelRows({ env: w.env, projectId: PID, now: NOW, href: () => '' });
  assert.equal(rows.find(c => c.utm_source === 'facebook')?.customers, 1);
  const activity = JSON.stringify(w.db.prepare('SELECT action, user_id, details FROM activity_logs').all());
  assert.match(activity, /grow_channel_added/);
  assert.match(activity, /grow_facebook_channel_accepted/);
  assert.ok(!activity.includes('Synthetic Page'));
  assert.equal((await call(w, 'accept')).status, 409);
  assert.equal((await call(w, 'dismiss')).status, 409);
  await sync(w);
  assert.equal(channels(w).length, 1);
  assert.equal((await part(w) as any).proposal.channel.uid, channels(w)[0].uid);
});

test('accept links an existing Facebook channel and refuses a foreign or different-source choice', async t => {
  const w = await world(t);
  const wrong = await call(w, 'accept', undefined, FOUNDER, { growth_channel_uid: 'ch-google' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'wrong_source');
  assert.match(wrong.body.detail, /UTM source is facebook/);
  assert.equal((await call(w, 'accept', undefined, FOUNDER, { growth_channel_uid: 'foreign' })).status, 404);
  assert.equal((await call(w, 'accept', undefined, FOUNDER, { growth_channel_uid: 42 })).status, 400);
  assert.equal(proposal(w).state, 'pending');
  w.db.prepare("INSERT INTO growth_channels (uid, project_id, name, utm_source) VALUES ('existing-facebook', ?, 'Existing', 'facebook')").run(PID);
  assert.equal((await call(w, 'accept', undefined, FOUNDER, { growth_channel_uid: 'existing-facebook' })).status, 200);
  assert.deepEqual([channels(w).length, channels(w)[0].uid], [1, 'existing-facebook']);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'grow_channel_added'").get().n, 0);
});

test('dismissal stays final through sync and unlink/relink, and is logged', async t => {
  const w = await world(t);
  const id = proposal(w).id;
  assert.equal((await call(w, 'dismiss')).status, 200);
  await sync(w);
  await unlinkPage(w.env, PID, FB);
  await linkPage(w.env, { integrationId: FB, projectId: PID, userId: FOUNDER, pageId: PAGE, pageName: 'Renamed' });
  assert.equal(proposal(w).id, id);
  assert.equal(proposal(w).state, 'dismissed');
  assert.equal((await part(w) as any).proposal, null);
  assert.equal((await call(w, 'accept')).status, 409);
  assert.equal(channels(w).length, 0);
  assert.equal(w.db.prepare("SELECT user_id FROM activity_logs WHERE action = 'grow_facebook_channel_dismissed'").get().user_id, FOUNDER);
});

test('only the connection-owning venture writer decides; support, observers, other ventures and old Pages are refused', async t => {
  const w = await world(t, COFOUNDER);
  w.db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (82, 'other-fb', ?, 'facebook', 'active', 'oauth2')").run(FOUNDER);
  w.db.exec('INSERT INTO integration_companies (integration_id, company_id, enabled) VALUES (82, 70, 1)');
  w.db.prepare('INSERT INTO user_company_links (company_id, user_id) VALUES (70, ?)').run(FOUNDER);
  assert.equal((await part(w, FOUNDER) as any).proposal.can_decide, false);
  assert.equal((await part(w, COFOUNDER) as any).proposal.can_decide, true);
  assert.equal((await part(w, COFOUNDER, true) as any).proposal.can_decide, false);
  assert.equal((await part(w, COFOUNDER, false, false) as any).proposal.can_decide, false);
  for (const verb of ['accept', 'dismiss']) {
    const otherConnection = await call(w, verb, undefined, FOUNDER);
    assert.equal(otherConnection.status, 409);
    assert.equal(otherConnection.body.error, 'venture_served');
    assert.equal((await call(w, verb, undefined, ADVISOR)).status, 403);
    assert.equal((await call(w, verb, undefined, INVESTOR)).status, 403);
    assert.equal((await call(w, verb, undefined, COFOUNDER, {}, true)).status, 403);
    assert.equal((await call(w, verb, undefined, COFOUNDER, { project: 999 })).status, 404);
    assert.equal((await call(w, verb, 'bad', COFOUNDER)).status, 404);
  }
  const old = proposal(w).id;
  await linkPage(w.env, { integrationId: FB, projectId: PID, userId: COFOUNDER, pageId: '802', pageName: 'Another Page' });
  assert.equal((await call(w, 'accept', old, COFOUNDER)).status, 404);
  assert.equal((await call(w, 'dismiss', old, COFOUNDER)).status, 404);
  const current = (await part(w, COFOUNDER) as any).proposal.id;
  w.db.prepare('UPDATE integration_companies SET enabled = 0 WHERE integration_id = ?').run(FB);
  assert.equal((await part(w, COFOUNDER) as any).proposal.can_decide, false);
  assert.equal((await call(w, 'accept', current, COFOUNDER)).status, 403);
  w.db.prepare('UPDATE integration_companies SET enabled = 1 WHERE integration_id = ?').run(FB);
  assert.equal((await call(w, 'accept', current, COFOUNDER)).status, 200);
});

test('concurrent accepts create exactly one channel and a concurrent dismissal cannot undo acceptance', async t => {
  const w = await world(t);
  const results = await Promise.all([call(w, 'accept'), call(w, 'accept'), call(w, 'dismiss')]);
  assert.ok(results.some(r => r.status === 200));
  assert.equal(channels(w).length, proposal(w).state === 'accepted' ? 1 : 0);
  assert.ok(results.every(r => r.status === 200 || r.status === 409));
  const reserved = await world(t);
  const link = (await linkOf(reserved.env, PID))!;
  let dismiss: any;
  await assert.rejects(acceptFacebookProposal(reserved.env, PID, proposal(reserved).id, FOUNDER, link, null, async () => {
    dismiss = await call(reserved, 'dismiss');
    throw new Error('writer unavailable');
  }), /writer unavailable/);
  assert.equal(dismiss.status, 409);
  assert.equal((await part(reserved) as any).proposal.state, 'pending');
  assert.equal((await call(reserved, 'accept')).status, 200);
  assert.equal(channels(reserved).length, 1);
});

test('retry recovers a channel created before the decision finished; disconnect purges proposals and preserves the venture channel', async t => {
  const w = await world(t);
  w.db.prepare("UPDATE facebook_proposals SET state = 'accepted', decided_by = ? WHERE id = ?").run(FOUNDER, proposal(w).id);
  w.db.prepare("INSERT INTO growth_channels (uid, project_id, name, utm_source) VALUES ('partial-facebook', ?, 'Recovered', 'facebook')").run(PID);
  assert.equal((await call(w, 'accept')).status, 200);
  assert.equal(channels(w).length, 1);
  await purgeFacebookConnection(w.env, FB);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM facebook_proposals').get().n, 0);
  assert.equal(channels(w).length, 1);
});

test('changing the connection that serves the same Page preserves dismissal and ignores a stale sync', async t => {
  const w = await world(t);
  assert.equal((await call(w, 'dismiss')).status, 200);
  const id = proposal(w).id;
  await unlinkPage(w.env, PID, FB);
  w.db.prepare("INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (82, 'replacement-fb', ?, 'facebook', 'active', 'oauth2')").run(COFOUNDER);
  await linkPage(w.env, { integrationId: 82, projectId: PID, userId: COFOUNDER, pageId: PAGE, pageName: 'Same Page' });
  await sync(w);
  assert.deepEqual([proposal(w).id, proposal(w).state, proposal(w).integration_id], [id, 'dismissed', 82]);
  await purgeFacebookConnection(w.env, FB);
  assert.equal(proposal(w).state, 'dismissed');
  assert.equal((await part(w, COFOUNDER) as any).proposal, null);
  await purgeFacebookConnection(w.env, 82);
  assert.equal(proposal(w), undefined);
});

test('the migration offers existing Page links a proposal without syncing and preserves decisions on replay', async t => {
  const w = await world(t);
  w.db.exec('DELETE FROM facebook_proposals');
  const migration = readdirSync(migrations).find(f => /^\d{12}_5860_facebook_proposals\.sql$/.test(f))!;
  w.db.exec(readFileSync(`${migrations}/${migration}`, 'utf8'));
  assert.equal((await part(w) as any).proposal.state, 'pending');
  assert.equal((await call(w, 'dismiss')).status, 200);
  w.db.exec(readFileSync(`${migrations}/${migration}`, 'utf8'));
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM facebook_proposals').get().n, 1);
  assert.equal((await part(w) as any).proposal, null);
});
