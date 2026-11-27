/**
 * D4805 (#4805, Programs audit 2/7) — Influencer lifecycle transitions commit whole.
 *
 *   1. Admitting writes the application's decision, the referral partner row, the membership, the draft terms,
 *      the Investor Pro grant, the history row (with the membership's id) and the member's notice together.
 *   2. An entitlement failure during admission leaves the application open and NOTHING else written: no member
 *      to find with no entitlement, no partner row, no draft terms, no history, no notice.
 *   3. A decision that loses to another writes nothing at all.
 *   4. A pause whose Investor Pro take-back fails leaves the membership active with its grant, its history
 *      and its notice untouched.
 *   5. A handle takedown that loses to a handle change retires nothing in the handle history.
 *   6. The member's notice is written with the decision and sent after it; a notice that does not land is
 *      retried from the outbox without repeating the decision.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_atomic_d4805.test.ts
 *
 * Every person is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import influencerRoute from '../src/routes/influencer.ts';
import adminInfluencers from '../src/routes/admin_influencers.ts';
import { CONSENT_VERSION } from '../src/services/influencers.ts';
import { retryOutbox, OUTBOX_CLAIM_WINDOW_MS } from '../src/services/programOutbox.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d4805-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, ADMIN = 2, ANA = 3;
const MIGRATION = 'cloudflare-worker/sql/migrations/202611031502_influencer_program.sql';
const DB_TEXT = /injected|SQLITE|RAISE|constraint|D1_ERROR/i;
const REASON = 'Reviewed at the weekly HQ influencer meeting.';

const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();
const SEEDS = (() => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO influencer_tier_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a trigger naming an object replayed later */ } }
  db.exec(SEEDS);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(ANA, 'founder', 'Ana Creator', 'ana@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, ADMIN, ANA]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, `totp-${id}`);
  }
  return db;
}

const app = new Hono<any>();
app.route('/api/influencer', influencerRoute);
app.route('/api/admin/influencers', adminInfluencers);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (/required|step_up|factor|HQ only/i.test(m)) return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

type Race = { match: string; run: () => void };
/** The D1 binding, with a competing write that lands just before the first batch whose first statement names `match`. */
function wrap(db: DatabaseSync, race?: Race) {
  const d1: any = d1Over(db);
  let pending = race ?? null;
  return {
    ...d1,
    prepare(sql: string) { const api = d1.prepare(sql); api.sql = sql; return api; },
    batch: async (stmts: any[]) => {
      if (pending && String(stmts[0]?.sql).includes(pending.match)) { const r = pending; pending = null; r.run(); }
      return d1.batch(stmts);
    },
  };
}

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, race?: Race) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: who, role, jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: wrap(db, race) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}

const ANSWERS = {
  channels: [{ kind: 'youtube', url: 'https://youtube.com/@ana', audience: 42000 }, { kind: 'newsletter', url: 'https://ana.example/news' }],
  regions: ['Europe'], topics: ['Venture building'], why: 'My audience builds companies and needs a studio.',
  consent_version: CONSENT_VERSION, consent: { disclosure: true, no_deal_promotion: true, no_self_referral: true },
};
const row = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const rows = (db: DatabaseSync, sql: string, ...a: any[]) => (db.prepare(sql).all(...a) as any[]).map((r) => ({ ...r }));
const decide = (db: DatabaseSync, uid: string, body: unknown, race?: Race) => call(db, ADMIN, 'POST', `/api/admin/influencers/applications/${uid}/decision`, body, race);
const change = (db: DatabaseSync, uid: string, body: Record<string, unknown>, race?: Race) => call(db, ADMIN, 'PATCH', `/api/admin/influencers/${uid}`, { reason: REASON, ...body }, race);
async function applied(db: DatabaseSync) {
  const r = await call(db, ANA, 'POST', '/api/influencer/apply', ANSWERS);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return row(db, 'SELECT uid FROM influencer_applications WHERE user_id = ?', ANA).uid as string;
}
async function admitted(db: DatabaseSync) {
  const appUid = await applied(db);
  const r = await decide(db, appUid, { admit: 'affiliate_creator' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return row(db, 'SELECT uid FROM influencers WHERE user_id = ?', ANA).uid as string;
}
/** Everything an admission or a change writes, for a before-and-after comparison. */
const snapshot = (db: DatabaseSync) => ({
  application: rows(db, 'SELECT status, tier, decided_by, decided_at FROM influencer_applications'),
  members: rows(db, 'SELECT user_id, tier, status, handle, investor_grant FROM influencers'),
  partners: rows(db, 'SELECT user_id, segment FROM referral_partners'),
  terms: rows(db, 'SELECT status, segment FROM referral_partner_terms'),
  triggers: rows(db, 'SELECT rule_key FROM referral_partner_term_triggers'),
  events: rows(db, 'SELECT user_id, influencer_id, event FROM influencer_events ORDER BY id'),
  user: rows(db, 'SELECT id, investor_tier, investor_subscription_status FROM users WHERE id = ?', ANA),
  outbox: rows(db, 'SELECT kind, delivered_at FROM program_outbox'),
  slugs: rows(db, 'SELECT slug, taken_down FROM slug_history'),
});

test('1. admitting writes the decision, the partner row, the membership, the draft terms, the grant, the history and the notice together', async () => {
  const db = fixture();
  const appUid = await applied(db);
  const r = await decide(db, appUid, { admit: 'affiliate_creator' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = snapshot(db);
  assert.equal(s.application[0].status, 'admitted');
  assert.deepEqual(s.members.map((m) => [m.user_id, m.tier, m.status, m.investor_grant]), [[ANA, 'affiliate_creator', 'active', 1]]);
  assert.deepEqual(s.partners, [{ user_id: ANA, segment: 'influencers' }]);
  assert.equal(s.terms.length, 1);
  assert.equal(s.terms[0].status, 'draft');
  assert.deepEqual([s.user[0].investor_tier, s.user[0].investor_subscription_status], ['professional', 'influencer_grant']);
  const admitted = s.events.filter((e) => e.event === 'admitted');
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].influencer_id, row(db, 'SELECT id FROM influencers WHERE user_id = ?', ANA).id, 'the history row names the membership it created');
  assert.equal(s.outbox.length, 1, 'one notice, written with the decision');
  assert.notEqual(s.outbox[0].delivered_at, null, 'and sent after the commit');
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'influencer_admitted'", ANA).n, 1);
  db.close();
});

test('2. an entitlement failure during admission leaves the application open and nothing else written', async () => {
  const db = fixture();
  const appUid = await applied(db);
  const before = snapshot(db);
  db.exec(`CREATE TRIGGER inject_entitlement BEFORE UPDATE OF investor_tier ON users
    WHEN NEW.investor_subscription_status = 'influencer_grant'
    BEGIN SELECT RAISE(ABORT, 'D1_ERROR: injected entitlement failure: SQLITE_ABORT'); END;`);
  const failed = await decide(db, appUid, { admit: 'affiliate_creator' });
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  assert.doesNotMatch(JSON.stringify(failed.body), DB_TEXT, 'no database text reaches the UI');
  assert.deepEqual(snapshot(db), before, 'no member, partner row, terms, history, grant or notice: the application is still open');
  assert.equal(before.application[0].decided_by, null);

  db.exec('DROP TRIGGER inject_entitlement');
  const retry = await decide(db, appUid, { admit: 'affiliate_creator' });
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(snapshot(db).members.length, 1);
  assert.equal(snapshot(db).events.filter((e) => e.event === 'admitted').length, 1, 'the retry admits once');
  db.close();
});

test('3. a decision that loses to another writes nothing at all', async () => {
  const db = fixture();
  const appUid = await applied(db);
  const race = { match: 'UPDATE influencer_applications', run: () => {
    db.prepare("UPDATE influencer_applications SET status = 'declined', reason = 'Another admin declined it.', decided_by = ?, decided_at = datetime('now')").run(SUPER);
  } };
  const before = snapshot(db);
  const lost = await decide(db, appUid, { admit: 'affiliate_creator' }, race);
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  const after = snapshot(db);
  assert.equal(after.application[0].status, 'declined', 'the other admin\'s decision stands');
  assert.deepEqual({ ...after, application: [] }, { ...before, application: [] }, 'and nothing the admission would have written is there');
  db.close();
});

test('4. a pause whose take-back fails leaves the membership active, with its grant, history and notice untouched', async () => {
  const db = fixture();
  const uid = await admitted(db);
  const before = snapshot(db);
  db.exec(`CREATE TRIGGER inject_takeback BEFORE UPDATE OF investor_tier ON users
    WHEN NEW.investor_subscription_status = 'influencer_ended'
    BEGIN SELECT RAISE(ABORT, 'D1_ERROR: injected take-back failure: SQLITE_ABORT'); END;`);
  const failed = await change(db, uid, { status: 'paused' });
  assert.equal(failed.status, 503, JSON.stringify(failed.body));
  assert.doesNotMatch(JSON.stringify(failed.body), DB_TEXT);
  assert.deepEqual(snapshot(db), before, 'still active, still holding Investor Pro, no history, no notice');

  db.exec('DROP TRIGGER inject_takeback');
  const paused = await change(db, uid, { status: 'paused' });
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  const s = snapshot(db);
  assert.deepEqual([s.members[0].status, s.members[0].investor_grant, s.user[0].investor_tier], ['paused', 0, 'free']);
  assert.equal(s.events.filter((e) => e.event === 'paused').length, 1);
  assert.equal(s.outbox.length, 2, 'the admission\'s notice and the pause\'s');
  db.close();
});

test('5. a handle takedown that loses to a handle change retires nothing', async () => {
  const db = fixture();
  const uid = await admitted(db);
  db.prepare("UPDATE influencers SET handle = 'ana_creator' WHERE user_id = ?").run(ANA);
  const before = snapshot(db);
  const race = { match: 'UPDATE influencers SET tier', run: () => { db.prepare("UPDATE influencers SET handle = 'ana_new' WHERE user_id = ?").run(ANA); } };
  const lost = await change(db, uid, { handle_takedown: true }, race);
  assert.equal(lost.status, 409, JSON.stringify(lost.body));
  const after = snapshot(db);
  assert.equal(after.members[0].handle, 'ana_new', 'the member\'s own change stands');
  assert.deepEqual(after.slugs, before.slugs, 'the handle history was not touched');
  assert.deepEqual(after.events, before.events);
  assert.deepEqual(after.outbox, before.outbox);

  // Without the race, a takedown clears the handle and marks it taken down, with history and a notice.
  const taken = await change(db, uid, { handle_takedown: true });
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  const s = snapshot(db);
  assert.equal(s.members[0].handle, null);
  assert.deepEqual(s.slugs.filter((x) => x.slug === 'ana_new').map((x) => x.taken_down), [1]);
  assert.equal(s.events.filter((e) => e.event === 'handle_taken_down').length, 1);
  db.close();
});

test('6. a notice that does not land is retried from the outbox without repeating the decision', async () => {
  const db = fixture();
  const appUid = await applied(db);
  db.exec(`CREATE TRIGGER inject_inbox BEFORE INSERT ON notifications_inbox
    BEGIN SELECT RAISE(ABORT, 'D1_ERROR: injected inbox failure: SQLITE_ABORT'); END;`);
  const done = await decide(db, appUid, { admit: 'affiliate_creator' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(snapshot(db).members.length, 1, 'the decision stands');
  let o = rows(db, 'SELECT attempts, delivered_at FROM program_outbox');
  assert.deepEqual(o.map((x) => [x.attempts, x.delivered_at]), [[1, null]], 'the notice is pending, tried once');
  const decided = snapshot(db);

  // The inbox comes back. Inside the claim window the row is left alone; past it, the cron sends it.
  db.exec('DROP TRIGGER inject_inbox');
  const env = { DB: d1Over(db) } as any;
  const early = await retryOutbox(env, new Date(Date.now() + 60_000)) as any;
  assert.equal(early.sent, 0, 'a recent attempt is not claimed again');
  const later = await retryOutbox(env, new Date(Date.now() + OUTBOX_CLAIM_WINDOW_MS + 60_000)) as any;
  assert.deepEqual([later.tried, later.sent], [1, 1]);
  o = rows(db, 'SELECT attempts, delivered_at FROM program_outbox');
  assert.equal(o[0].attempts, 2);
  assert.notEqual(o[0].delivered_at, null);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ? AND type = 'influencer_admitted'", ANA).n, 1, 'delivered once');
  assert.deepEqual({ ...snapshot(db), outbox: [] }, { ...decided, outbox: [] }, 'the retry touched nothing else');
  const again = await retryOutbox(env, new Date(Date.now() + 2 * OUTBOX_CLAIM_WINDOW_MS)) as any;
  assert.equal(again.tried, 0, 'a delivered notice is not sent again');
  db.close();
});
