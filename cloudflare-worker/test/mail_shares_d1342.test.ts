/**
 * D1342 (#3550, part 3 of #3547): Network members email each other after a
 * mutual accept, each sharing their own address (migration 649). Synthetic
 * members, the mounted routes and the real migrated schema; `fetch` throws.
 *
 *   · the second accept of an introduction opens the pair and asks both;
 *   · one side sharing reveals nothing; both sharing reveals both;
 *   · a revoke hides the address again at once; sharing again shows it;
 *   · a pair with no mutual accept cannot create or change a share;
 *   · an Explorer reads only their Network matches;
 *   · no address appears in a match's record, a list row not ready, or a notice.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailDrafts from '../src/routes/mail_drafts.ts';
import mailShares from '../src/routes/mail_shares.ts';
import introductions from '../src/routes/introductions.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { MATCHED_LINE, ready, sideState } from '../src/services/mail/shares.ts';
import { ensureIntroNetworkSchema } from '../src/services/introductions.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1342-only-not-a-real-credential'.repeat(2);
// [id, role, founder_id]
const FOUNDER = 2, INVESTOR = 6, EXPLORER = 8, OTHER = 9, STRANGER = 10;
const ADDR = (id: number) => `Synthetic-${id}@Example.invalid`;

async function fixture() {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, display_name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[FOUNDER, 'founder', 100], [INVESTOR, 'investor', null], [EXPLORER, 'exploring', null], [OTHER, 'founder', 300], [STRANGER, 'investor', null]] as const) {
    insert.run(id, role, fid, `Synthetic member ${id}`, `Synthetic ${id}`, ADDR(id), 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100)");
  db.exec("INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,done_at,pains_json,updated_at) VALUES (11,1,'Synthetic Ada','done','2026-10-01','[]','2026-10-02 09:00:00')");
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  await ensureIntroNetworkSchema(env);
  const app = new Hono<any>().route('/api/mail', mailDrafts).route('/api/mail', mailShares).route('/api/introductions', introductions);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  /** Both directions of an introduction between a and b, pending, with uids `a-b` and `b-a`. */
  const propose = (a: number, b: number, status = 'pending') => db.prepare(
    "INSERT INTO intro_propositions (uid, user_id, target_user_id, status, source) VALUES (?, ?, ?, ?, 'matching'), (?, ?, ?, ?, 'matching')",
  ).run(`p${a}x${b}`, a, b, status, `p${b}x${a}`, b, a, status);
  const pairs = () => db.prepare('SELECT * FROM mail_address_shares ORDER BY id').all() as any[];
  const inbox = (user: number) => db.prepare('SELECT type, title, body, link, payload FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(user) as any[];
  return { db, env, app, close, propose, pairs, inbox };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const list = async (f: F, who: number) => (await call(f, who, 'GET', '/api/mail/shares')).body.items as any[];
const share = (f: F, who: number, uid: string, yes: boolean) => call(f, who, 'POST', `/api/mail/shares/${uid}`, { share: yes });

/** A mutual accept through the real routes; returns the pair's uid. */
async function matched(f: F, a: number, b: number): Promise<string> {
  f.propose(a, b);
  assert.equal((await call(f, a, 'POST', `/api/introductions/propositions/p${a}x${b}/accept`)).status, 200);
  assert.equal((await call(f, b, 'POST', `/api/introductions/propositions/p${b}x${a}/accept`)).status, 200);
  const items = await list(f, a);
  assert.equal(items.length >= 1, true);
  return items[0].uid;
}

test('each side\'s state: a revoke wins, then a share, then a decline; ready needs both shared', () => {
  assert.equal(sideState(null, null, null), 'pending');
  assert.equal(sideState('t', null, null), 'shared');
  assert.equal(sideState(null, 't', null), 'declined');
  assert.equal(sideState('t', null, 't'), 'revoked');
  assert.equal(ready('shared', 'shared'), true);
  for (const s of ['pending', 'declined', 'revoked'] as const) assert.equal(ready('shared', s), false, s);
});

test('the second accept of an introduction opens the pair and asks both; one accept opens nothing', async () => {
  const f = await fixture();
  try {
    f.propose(FOUNDER, INVESTOR);
    assert.equal((await call(f, FOUNDER, 'POST', `/api/introductions/propositions/p${FOUNDER}x${INVESTOR}/accept`)).status, 200);
    assert.deepEqual(f.pairs(), [], 'one accept is no match');
    assert.deepEqual(await list(f, FOUNDER), []);
    // Mutation checked: drop askBoth from the accept → no pair and no question.
    assert.equal((await call(f, INVESTOR, 'POST', `/api/introductions/propositions/p${INVESTOR}x${FOUNDER}/accept`)).status, 200);
    const [pair] = f.pairs();
    assert.deepEqual([pair.user_low, pair.user_high, pair.source_kind, pair.source_ref], [FOUNDER, INVESTOR, 'introduction', `p${INVESTOR}x${FOUNDER}`]);
    for (const [who, other] of [[FOUNDER, INVESTOR], [INVESTOR, FOUNDER]]) {
      const ask = f.inbox(who).find((n) => n.type === 'mail_share_request');
      assert.deepEqual([ask?.title, ask?.body, ask?.link], [`Share your email address with Synthetic ${other}?`, MATCHED_LINE, '/email'], String(who));
    }
    assert.equal(MATCHED_LINE, 'You’re matched. Email needs both of you to share an address.', 'D1347 §3\'s words');
  } finally { f.close(); }
});

test('one side sharing reveals nothing; both sharing reveals both; a revoke hides the address again at once', async () => {
  const f = await fixture();
  try {
    const uid = await matched(f, FOUNDER, INVESTOR);
    const first = await list(f, FOUNDER);
    assert.deepEqual([first[0].mine, first[0].theirs, first[0].ready, first[0].address, first[0].person], ['pending', 'pending', false, null, `member:${uid}`]);
    // Mutation checked: serve the address when either side shared → the investor sees it here.
    const one = await share(f, FOUNDER, uid, true);
    assert.deepEqual([one.status, one.body.share.mine, one.body.share.theirs, one.body.share.address], [200, 'shared', 'pending', null]);
    const theirView = (await list(f, INVESTOR))[0];
    assert.deepEqual([theirView.mine, theirView.theirs, theirView.address], ['pending', 'shared', null]);
    assert.match(f.inbox(INVESTOR).at(-1).title, /^Synthetic 2 shared their email address with you$/);
    assert.equal((await share(f, INVESTOR, uid, true)).status, 200);
    const both = [(await list(f, FOUNDER))[0], (await list(f, INVESTOR))[0]];
    assert.deepEqual(both.map((s) => [s.ready, s.address]), [[true, ADDR(INVESTOR).toLowerCase()], [true, ADDR(FOUNDER).toLowerCase()]]);
    assert.equal(f.inbox(FOUNDER).at(-1).title, 'You can now email Synthetic 6');
    // Mutation checked: drop the revoke's revoked_at → the address stays served.
    const revoked = await call(f, FOUNDER, 'DELETE', `/api/mail/shares/${uid}`);
    assert.deepEqual([revoked.status, revoked.body.share.mine, revoked.body.share.address], [200, 'revoked', null]);
    assert.deepEqual([(await list(f, INVESTOR))[0].ready, (await list(f, INVESTOR))[0].address], [false, null], 'hidden from the other at once');
    const again = await call(f, FOUNDER, 'DELETE', `/api/mail/shares/${uid}`);
    assert.deepEqual([again.status, again.body.error], [409, 'not_shared']);
    assert.equal((await share(f, FOUNDER, uid, true)).body.share.ready, true, 'sharing again shows it again');
    // A decline is no share, from either side (the founder is the pair's low side, the investor its high).
    // Mutation checked: keep shared_at on a decline → the address stays served.
    for (const [who, other] of [[INVESTOR, FOUNDER], [FOUNDER, INVESTOR]]) {
      const declined = await share(f, who, uid, false);
      assert.deepEqual([declined.body.share.mine, declined.body.share.ready, declined.body.share.address], ['declined', false, null], String(who));
      assert.equal((await list(f, other))[0].address, null, String(other));
      assert.equal((await share(f, who, uid, true)).body.share.mine, 'shared');
    }
    // A revoke then a share, from the high side too. Mutation checked: keep revoked_at on a share → still hidden.
    assert.equal((await call(f, INVESTOR, 'DELETE', `/api/mail/shares/${uid}`)).body.share.mine, 'revoked');
    assert.equal((await share(f, INVESTOR, uid, true)).body.share.ready, true);
  } finally { f.close(); }
});

test('a pair with no mutual accept cannot create or change a share; another member\'s pair is 404', async () => {
  const f = await fixture();
  try {
    // One side accepted, the other declined: no pair is listed, even lazily.
    f.propose(FOUNDER, STRANGER);
    f.db.prepare("UPDATE intro_propositions SET status = 'accepted' WHERE uid = ?").run(`p${FOUNDER}x${STRANGER}`);
    f.db.prepare("UPDATE intro_propositions SET status = 'declined' WHERE uid = ?").run(`p${STRANGER}x${FOUNDER}`);
    assert.deepEqual(await list(f, FOUNDER), []);
    // A forged pair row without the mutual accept: sharing is refused, and nothing changes.
    f.db.exec(`INSERT INTO mail_address_shares (uid, user_low, user_high, source_kind, source_ref) VALUES ('forged0pair', ${FOUNDER}, ${STRANGER}, 'introduction', 'none')`);
    // Mutation checked: drop the mutual-accept check from setShare → the forged pair shares.
    const forged = await share(f, FOUNDER, 'forged0pair', true);
    assert.deepEqual([forged.status, forged.body.error], [409, 'not_matched']);
    assert.equal((f.db.prepare("SELECT low_shared_at FROM mail_address_shares WHERE uid = 'forged0pair'").get() as any).low_shared_at, null);
    const uid = await matched(f, INVESTOR, OTHER);
    assert.equal((await share(f, INVESTOR, uid, true)).status, 200);
    const untouched = JSON.stringify(f.db.prepare('SELECT * FROM mail_address_shares WHERE uid = ?').get(uid));
    // Mutation checked: drop the member check from the pair's read → another member changes this pair before the 404.
    for (const [method, body] of [['POST', { share: true }], ['POST', { share: false }], ['DELETE', undefined]] as const) {
      const r = await call(f, FOUNDER, method, `/api/mail/shares/${uid}`, body);
      assert.deepEqual([r.status, r.body.error], [404, 'not_found'], `another member's pair, ${method}`);
    }
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM mail_address_shares WHERE uid = ?').get(uid)), untouched, 'nothing changed');
    assert.equal((await call(f, FOUNDER, 'POST', '/api/mail/shares/nope', { share: true })).status, 404);
    assert.deepEqual([(await call(f, INVESTOR, 'POST', `/api/mail/shares/${uid}`, { share: 'yes' })).body.error], ['share_required']);
    const support = await call(f, INVESTOR, 'POST', `/api/mail/shares/${uid}`, { share: true }, { impersonated_by: 1 });
    assert.deepEqual([support.status, support.body.error], [403, 'support_session_refused']);
  } finally { f.close(); }
});

test('an Explorer reads only their Network matches, and a match\'s record carries no address', async () => {
  const f = await fixture();
  try {
    const uid = await matched(f, EXPLORER, FOUNDER);
    const items = await list(f, EXPLORER);
    assert.deepEqual(items.map((i) => [i.person, i.name]), [[`member:${uid}`, 'Synthetic 2']]);
    const pack = await call(f, EXPLORER, 'GET', `/api/mail/context?person=member:${uid}`);
    assert.equal(pack.status, 200, JSON.stringify(pack.body));
    assert.deepEqual([pack.body.person.relationship, pack.body.person.email_ready, pack.body.intents.map((i: any) => i.key)], ['network', false, ['introduce_myself']]);
    assert.deepEqual(pack.body.items.map((i: any) => [i.ref, i.selected, i.link]), [[`member:${uid}`, true, '/email']]);
    // A founder's module record is not an Explorer's.
    assert.equal((await call(f, EXPLORER, 'GET', '/api/mail/context?person=interviewee:11')).status, 404);
    // Another member's match is no record of this one's.
    assert.equal((await call(f, STRANGER, 'GET', `/api/mail/context?person=member:${uid}`)).status, 404);
    // Ready: the record says so, and still carries no address.
    await share(f, EXPLORER, uid, true); await share(f, FOUNDER, uid, true);
    const readyPack = await call(f, EXPLORER, 'GET', `/api/mail/context?person=member:${uid}`);
    assert.equal(readyPack.body.person.email_ready, true);
    assert.doesNotMatch(JSON.stringify(readyPack.body), /example\.invalid/i, 'D414: the record never carries an address');
    // Notices carry no address either.
    for (const who of [EXPLORER, FOUNDER]) assert.doesNotMatch(JSON.stringify(f.inbox(who)), /example\.invalid/i);
  } finally { f.close(); }
});

test('a pair accepted before migration 649 is opened when either member lists their matches, without a notice', async () => {
  const f = await fixture();
  try {
    f.propose(FOUNDER, OTHER, 'accepted');
    const before = f.inbox(FOUNDER).length;
    const items = await list(f, OTHER);
    assert.equal(items.length, 1);
    assert.equal((await list(f, FOUNDER))[0].uid, items[0].uid, 'one pair, whichever side lists it');
    assert.equal(f.pairs().length, 1);
    assert.equal(f.inbox(FOUNDER).length, before, 'no notice for an old pair');
  } finally { f.close(); }
});
