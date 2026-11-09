/**
 * D4636 (#4636) — a company update's authority, published versions and
 * per-recipient deliveries, on the real schema (baseline + every migration,
 * `loadSchema`) and the real routes.
 *
 * Synthetic fixtures only: one venture (id 7) owned by FOUNDER, a cofounder
 * seat (TEAM), a pipeline investor with an account (INVESTOR) and one without,
 * and a follower (NETWORK).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/update_lifecycle_d4636.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import updates from '../src/routes/portfolio_updates.ts';
import {
  DeliveryNotAttempted, STALE_ATTEMPT_MS, ensurePublished, reserveDeliveries, runDeliveries,
  type DeliveryProvider, type DeliveryRow,
} from '../src/services/updateLifecycle.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 1; const INVESTOR = 2; const TEAM = 3; const NETWORK = 4; const ADMIN = 5; const OTHER = 6;

async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, founder_id, name, email, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  u.run(FOUNDER, 'founder', 10, 'Fay', 'fay@co.example');
  u.run(INVESTOR, 'investor', null, 'Ivy', 'ivy@fund.example');
  u.run(TEAM, 'founder', 11, 'Tom', 'tom@co.example');
  u.run(NETWORK, 'founder', 12, 'Nia', 'nia@else.example');
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example');
  u.run(OTHER, 'founder', 13, 'Oli', 'oli@co.example');
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture', 10)`).run();
  const m = db.prepare(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, ?, ?, 'accepted')`);
  m.run(TEAM, 'cofounder'); m.run(OTHER, 'cofounder');
  const pr = db.prepare(`INSERT INTO raise_prospects (uid, project_id, name, email, stage) VALUES (?, 7, ?, ?, 'contacted')`);
  pr.run('rp1', 'Ivy', 'IVY@fund.example');
  pr.run('rp2', 'No Account', 'nobody@fund.example');
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any;
  const { ensureFollowsSchema } = await import('../src/routes/follows.ts');
  await ensureFollowsSchema(env);
  db.prepare(`INSERT INTO follows (follower_user_id, entity_type, entity_id) VALUES (?, 'project', 7)`).run(NETWORK);
  return { db, env };
}

const app = new Hono<any>();
app.route('/api/portfolio-updates', updates);
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p.catch(() => {})); }, passThroughOnException() {} };

async function call(db: DatabaseSync, userId: number, method: string, path: string, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t/api/portfolio-updates${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, ctx as any);
  const text = await res.text();
  await Promise.all(pending.splice(0));
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}

const one = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).get(...args) as any;
const all = (db: DatabaseSync, sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];
const inboxCount = (db: DatabaseSync, userId?: number) => {
  if (!one(db, "SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = 'notifications_inbox'")) return 0;
  return userId == null ? one(db, 'SELECT COUNT(*) AS n FROM notifications_inbox').n
    : one(db, 'SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ?', userId).n;
};

async function draft(db: DatabaseSync, author = FOUNDER, audience = { investors: true, team: true, network: true }) {
  const created = await call(db, author, 'POST', '', { project_id: 7, title: 'October', body: 'Words', status: 'draft' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const saved = await call(db, author, 'PUT', `/${created.body.uid}/share`, { audience });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return created.body.uid as string;
}

// ── Current authority on an existing update ─────────────────────────────────

test('a seat removed after the draft was written stops its change, submission and send; restored, they work again', async () => {
  const { db } = await fixture();
  const uid = await draft(db, TEAM);
  db.prepare(`UPDATE project_members SET status = 'removed' WHERE project_id = 7 AND user_id = ?`).run(TEAM);
  for (const [method, path, body] of [['PUT', `/${uid}`, { title: 'Changed' }], ['PUT', `/${uid}/share`, { highlights: [] }],
    ['POST', `/${uid}/submit`, undefined], ['POST', `/${uid}/send`, undefined]] as const) {
    const r = await call(db, TEAM, method, path, body);
    assert.deepEqual([r.status, r.body.code], [403, 'share_not_allowed'], `${method} ${path} after the seat was removed`);
  }
  const row = one(db, 'SELECT title, status, published_version, sent_at FROM portfolio_updates WHERE uid = ?', uid);
  assert.deepEqual([row.title, row.status, row.published_version, row.sent_at], ['October', 'draft', null, null], 'nothing moved');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM update_recipients').n, 0);
  // Downgraded to an advisor seat: read-only on the venture, so still refused.
  db.prepare(`UPDATE project_members SET status = 'accepted', role = 'advisor' WHERE project_id = 7 AND user_id = ?`).run(TEAM);
  assert.equal((await call(db, TEAM, 'POST', `/${uid}/submit`)).status, 403, 'an advisor seat cannot submit');
  db.prepare(`UPDATE project_members SET role = 'cofounder' WHERE project_id = 7 AND user_id = ?`).run(TEAM);
  assert.equal((await call(db, TEAM, 'POST', `/${uid}/submit`)).status, 200, 'the restored seat submits');
  // Another writer on the venture is not the author: an update is changed by its author or an admin.
  assert.equal((await call(db, OTHER, 'PUT', `/${uid}`, { title: 'Not mine' })).status, 403);
  // Mutation checked: replacing operateRefusal's canShareUpdate condition with `false` fails the first loop (200, not 403).
});

test('"Ask again" re-checks the author\'s authority before anyone is notified', async () => {
  const { db } = await fixture();
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, submitted_at, sent_at)
    VALUES ('old', 7, ?, 'Old', 'submitted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run(TEAM);
  const id = one(db, `SELECT id FROM portfolio_updates WHERE uid = 'old'`).id;
  db.prepare(`INSERT INTO update_asks (uid, update_id, kind, text) VALUES ('ask1', ?, 'customer', 'An intro')`).run(id);
  db.prepare(`INSERT INTO update_recipients (update_id, audience, user_id, delivered_via) VALUES (?, 'investor', ?, 'notification')`).run(id, INVESTOR);
  db.prepare(`UPDATE project_members SET status = 'removed' WHERE project_id = 7 AND user_id = ?`).run(TEAM);
  const r = await call(db, TEAM, 'POST', '/asks/ask1/ask-again');
  assert.deepEqual([r.status, r.body.code], [403, 'share_not_allowed']);
  assert.equal(inboxCount(db, INVESTOR), 0, 'nobody was asked again');
  // Mutation checked: restoring the author-only check (no authority call) on ask-again makes this answer 200 and notify.
});

// ── Published versions ──────────────────────────────────────────────────────

test('submitting twice keeps the first publication, its time and its version; followers hear once', async () => {
  const { db } = await fixture();
  const uid = await draft(db);
  const first = await call(db, FOUNDER, 'POST', `/${uid}/submit`);
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.version, first.body.status], [1, 'submitted']);
  await new Promise((r) => setTimeout(r, 5));
  const again = await call(db, FOUNDER, 'POST', `/${uid}/submit`);
  assert.equal(again.status, 200);
  assert.equal(again.body.submitted_at, first.body.submitted_at, 'the original publication time stands');
  assert.equal(again.body.published_at, first.body.submitted_at);
  assert.equal(again.body.version, 1);
  const v = all(db, 'SELECT version, published_at, published_by_user_id FROM portfolio_update_versions v JOIN portfolio_updates u ON u.id = v.update_id WHERE u.uid = ?', uid);
  assert.deepEqual(v.map((x) => [x.version, x.published_at, x.published_by_user_id]), [[1, first.body.submitted_at, FOUNDER]]);
  assert.equal(inboxCount(db, NETWORK), 1, 'the follower is told once');
  // Mutation checked: re-stamping submitted_at in the submit route before ensurePublished fails the time equality;
  // notifying followers on every submit (ignoring `published`) fails the follower count.
});

test('an update published before versions gets version 1 from the row as it stood, by its author, at its original time', async () => {
  const { db } = await fixture();
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, body, status, submitted_at)
    VALUES ('legacy', 7, ?, 'Q3', 'As sent', 'submitted', '2026-07-01T09:00:00Z')`).run(FOUNDER);
  const r = await call(db, ADMIN, 'POST', '/legacy/submit');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.submitted_at, r.body.version], ['2026-07-01T09:00:00Z', 1]);
  const v = one(db, `SELECT v.title, v.body, v.published_at, v.published_by_user_id FROM portfolio_update_versions v JOIN portfolio_updates u ON u.id = v.update_id WHERE u.uid = 'legacy'`);
  assert.deepEqual([v.title, v.body, v.published_at, v.published_by_user_id], ['Q3', 'As sent', '2026-07-01T09:00:00Z', FOUNDER]);
  assert.equal(inboxCount(db, NETWORK), 0, 'recording a version is not a new publication');
  // Mutation checked: attributing the backfilled version to the caller (`publisher = actorId`) fails the published_by check.
});

test('a correction is the next version, by its actor with its reason; the published version it replaces never changes', async () => {
  const { db } = await fixture();
  const uid = await draft(db);
  const pub = await call(db, FOUNDER, 'POST', `/${uid}/submit`);
  const fixed = await call(db, ADMIN, 'PUT', `/${uid}`, { title: 'October (restated)', correction_reason: 'MRR excluded a refund', expected_version: 1 });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.deepEqual([fixed.body.title, fixed.body.version, fixed.body.submitted_at], ['October (restated)', 2, pub.body.submitted_at]);
  const versions = await call(db, FOUNDER, 'GET', `/${uid}/versions`);
  assert.equal(versions.status, 200);
  assert.deepEqual(versions.body.items.map((v: any) => [v.version, v.title, v.published_by.user_id, v.correction_reason]), [
    [1, 'October', FOUNDER, null],
    [2, 'October (restated)', ADMIN, 'MRR excluded a refund'],
  ]);
  assert.notEqual(versions.body.items[0].content_sha256, versions.body.items[1].content_sha256);
  // A writer who read version 1 cannot land on top of version 2.
  const stale = await call(db, FOUNDER, 'PUT', `/${uid}`, { title: 'Late', expected_version: 1 });
  assert.deepEqual([stale.status, stale.body.code], [409, 'changed_since_open']);
  assert.equal(one(db, 'SELECT title FROM portfolio_updates WHERE uid = ?', uid).title, 'October (restated)');
  // Two corrections from the same read: one lands, the other is told the update changed.
  const both = await Promise.all([
    call(db, FOUNDER, 'PUT', `/${uid}`, { title: 'A' }), call(db, ADMIN, 'PUT', `/${uid}`, { title: 'B' }),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM portfolio_update_versions v JOIN portfolio_updates u ON u.id = v.update_id WHERE u.uid = ?', uid).n, 3);
  const v1 = one(db, 'SELECT v.title FROM portfolio_update_versions v JOIN portfolio_updates u ON u.id = v.update_id WHERE u.uid = ? AND v.version = 1', uid);
  assert.equal(v1.title, 'October', 'version 1 is as published');
  // The share sheet edits drafts only.
  assert.deepEqual((await call(db, FOUNDER, 'PUT', `/${uid}/share`, { highlights: [] })).body.code, 'update_published');
  // Mutation checked: dropping the `expected_version` comparison lets the stale correction land (200, title 'Late');
  // dropping the row UPDATE's `published_version = ?`/EXISTS guard and the version-uid check lets both concurrent
  // corrections answer 200.
});

// ── Deliveries ─────────────────────────────────────────────────────────────

test('two concurrent sends reserve each recipient once for the version, and each delivery is attempted once', async () => {
  const { db } = await fixture();
  const uid = await draft(db);
  const [a, b] = await Promise.all([call(db, FOUNDER, 'POST', `/${uid}/send`), call(db, FOUNDER, 'POST', `/${uid}/send`)]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
  const rows = all(db, 'SELECT recipient_key, version_id, delivery_state, attempts FROM update_recipients ORDER BY id');
  assert.deepEqual(rows.map((r) => r.recipient_key).sort(), ['email:nobody@fund.example', `user:${INVESTOR}`, `user:${NETWORK}`, `user:${OTHER}`, `user:${TEAM}`].sort());
  assert.equal(new Set(rows.map((r) => r.version_id)).size, 1, 'one version');
  assert.ok(rows.every((r) => r.attempts === 1), JSON.stringify(rows));
  for (const who of [INVESTOR, TEAM, OTHER, NETWORK]) assert.equal(inboxCount(db, who), 1, `user ${who} notified once`);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM portfolio_update_versions').n, 1, 'published once');
  assert.equal(one(db, `SELECT delivery_state FROM update_recipients WHERE user_id IS NULL`).delivery_state, 'undeliverable');
  // Mutation checked: changing the reservation to a plain INSERT (no ON CONFLICT) makes one send fail on the unique
  // index (500); removing `AND delivery_state = ?` from the claim lets both sends attempt (attempts 2, two inbox rows).
});

test('a send after a correction delivers the new version; earlier deliveries stay with the version they carried', async () => {
  const { db } = await fixture();
  const uid = await draft(db, FOUNDER, { investors: true, team: false, network: false });
  const first = await call(db, FOUNDER, 'POST', `/${uid}/send`);
  assert.equal(first.body.version, 1);
  assert.equal((await call(db, FOUNDER, 'PUT', `/${uid}`, { title: 'Restated', correction_reason: 'Typo' })).status, 200);
  const second = await call(db, FOUNDER, 'POST', `/${uid}/send`);
  assert.deepEqual([second.status, second.body.version, second.body.sent_at], [200, 2, first.body.sent_at]);
  const byVersion = all(db, `SELECT v.version, COUNT(*) AS n FROM update_recipients r JOIN portfolio_update_versions v ON v.id = r.version_id GROUP BY v.version ORDER BY v.version`);
  assert.deepEqual(byVersion.map((x) => [x.version, x.n]), [[1, 2], [2, 2]]);
  assert.equal(inboxCount(db, INVESTOR), 2, 'one notice per version');
  // Mutation checked: setting sent_at on every send (no COALESCE) fails the sent_at equality.
});

test('an ambiguous delivery whose notification exists is reconciled as delivered by the next send, without a second notice', async () => {
  const { db } = await fixture();
  const uid = await draft(db, FOUNDER, { investors: true, team: false, network: false });
  assert.equal((await call(db, FOUNDER, 'POST', `/${uid}/send`)).status, 200);
  // The provider wrote its record but the outcome was never stored: the row is still held by an old attempt.
  const d = one(db, 'SELECT id, delivery_uid FROM update_recipients WHERE user_id = ?', INVESTOR);
  db.prepare(`UPDATE update_recipients SET delivery_state = 'attempting', delivered_via = NULL, provider_ref = NULL, attempt_claim = 'old',
    last_attempt_at = ? WHERE id = ?`).run(new Date(Date.now() - STALE_ATTEMPT_MS - 60_000).toISOString(), d.id);
  const again = await call(db, FOUNDER, 'POST', `/${uid}/send`);
  assert.equal(again.status, 200);
  const row = one(db, 'SELECT delivery_state, provider_ref FROM update_recipients WHERE id = ?', d.id);
  assert.equal(row.delivery_state, 'delivered');
  assert.equal(row.provider_ref, String(one(db, `SELECT id FROM notifications_inbox WHERE json_extract(payload, '$.delivery_uid') = ?`, d.delivery_uid).id));
  assert.equal(inboxCount(db, INVESTOR), 1, 'reconciled, not re-sent');
  // Mutation checked: making `find` return null makes the row stay ambiguous (state assertion fails); making the
  // stale-attempt branch call attempt() instead of reconcile() sends a second notice (count 2).
});

// ── The delivery service, with a provider that fails on purpose ─────────────

function fakeProvider(plan: Record<number, 'ok' | 'not_attempted' | 'throws' | 'declined'>, records: Record<string, string> = {}) {
  const sent: number[] = [];
  const p: DeliveryProvider = {
    async send(d: DeliveryRow) {
      const what = plan[Number(d.user_id)] ?? 'ok';
      if (what === 'not_attempted') throw new DeliveryNotAttempted('fixture: stopped before sending');
      sent.push(Number(d.user_id));
      if (what === 'throws') throw new Error('fixture: provider timed out after accepting');
      return what === 'declined' ? null : `ref-${d.user_id}-${sent.length}`;
    },
    async find(d: DeliveryRow) { return records[d.delivery_uid] ?? null; },
  };
  return { p, sent };
}

async function reserved(db: DatabaseSync, env: any) {
  db.prepare(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, title, status, created_at, updated_at)
    VALUES ('svc', 7, ?, 'Svc', 'draft', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`).run(FOUNDER);
  const row = one(db, `SELECT * FROM portfolio_updates WHERE uid = 'svc'`);
  const { version } = await ensurePublished(env, row, FOUNDER, '2026-11-02T00:00:00Z');
  await reserveDeliveries(env, row.id, version, [INVESTOR, TEAM, NETWORK].map((id) => ({ audience: 'team', user_id: id, email: null, label: null })), FOUNDER, '2026-11-02T00:00:00Z');
  return version;
}

const states = (db: DatabaseSync) => Object.fromEntries(all(db, 'SELECT user_id, delivery_state FROM update_recipients WHERE user_id IS NOT NULL').map((r) => [r.user_id, r.delivery_state]));

test('a failed delivery is retried; an ambiguous one is reconciled from the provider record and never sent twice', async () => {
  const { db, env } = await fixture();
  const version = await reserved(db, env);
  const run1 = fakeProvider({ [INVESTOR]: 'not_attempted', [TEAM]: 'throws', [NETWORK]: 'ok' });
  const s1 = await runDeliveries(env, version.id, run1.p);
  assert.deepEqual(states(db), { [INVESTOR]: 'failed', [TEAM]: 'ambiguous', [NETWORK]: 'delivered' });
  assert.deepEqual([s1.delivered, s1.states.failed, s1.states.ambiguous], [1, 1, 1]);
  const teamUid = one(db, 'SELECT delivery_uid FROM update_recipients WHERE user_id = ?', TEAM).delivery_uid;
  // The retry: the provider holds a record for the ambiguous attempt.
  const run2 = fakeProvider({}, { [teamUid]: 'ref-found' });
  const s2 = await runDeliveries(env, version.id, run2.p);
  assert.deepEqual(states(db), { [INVESTOR]: 'delivered', [TEAM]: 'delivered', [NETWORK]: 'delivered' });
  assert.deepEqual(run2.sent, [INVESTOR], 'only the failed delivery is sent again');
  assert.equal(one(db, 'SELECT provider_ref FROM update_recipients WHERE user_id = ?', TEAM).provider_ref, 'ref-found');
  assert.equal(s2.delivered, 3);
  assert.deepEqual(all(db, 'SELECT attempts FROM update_recipients ORDER BY user_id').map((r) => r.attempts), [2, 2, 1]);
  // Mutation checked: treating every thrown error as `failed` (dropping the DeliveryNotAttempted test) records TEAM as
  // failed and re-sends it (the state and run2.sent assertions fail).
});

test('an ambiguous delivery with no provider record stays ambiguous until the sender asks to resend it', async () => {
  const { db, env } = await fixture();
  const version = await reserved(db, env);
  await runDeliveries(env, version.id, fakeProvider({ [TEAM]: 'throws' }).p);
  const quiet = fakeProvider({});
  await runDeliveries(env, version.id, quiet.p);
  assert.deepEqual([states(db)[TEAM], quiet.sent], ['ambiguous', []], 'not re-sent blind');
  assert.match(one(db, 'SELECT not_delivered_reason FROM update_recipients WHERE user_id = ?', TEAM).not_delivered_reason, /could not be confirmed/);
  const asked = fakeProvider({});
  await runDeliveries(env, version.id, asked.p, { resendAmbiguous: true });
  assert.deepEqual([states(db)[TEAM], asked.sent], ['delivered', [TEAM]]);
  // Mutation checked: resending an unconfirmed ambiguous delivery regardless of `resendAmbiguous` fails "not re-sent blind".
});

test('a declined delivery is an outcome, not a failure: a later send does not try it again', async () => {
  const { db, env } = await fixture();
  const version = await reserved(db, env);
  await runDeliveries(env, version.id, fakeProvider({ [INVESTOR]: 'declined' }).p);
  assert.equal(states(db)[INVESTOR], 'declined');
  const later = fakeProvider({});
  await runDeliveries(env, version.id, later.p);
  assert.deepEqual(later.sent, []);
  // Mutation checked: adding 'declined' to the states runDeliveries attempts makes `later.sent` [INVESTOR].
});

test('a delivery claimed by a send in progress is left to it', async () => {
  const { db, env } = await fixture();
  const version = await reserved(db, env);
  db.prepare(`UPDATE update_recipients SET delivery_state = 'attempting', attempt_claim = 'live', last_attempt_at = ? WHERE user_id = ?`)
    .run(new Date().toISOString(), TEAM);
  const run = fakeProvider({});
  await runDeliveries(env, version.id, run.p);
  assert.deepEqual(run.sent.sort(), [INVESTOR, NETWORK].sort());
  assert.equal(states(db)[TEAM], 'attempting');
  // Mutation checked: dropping the STALE_ATTEMPT_MS comparison turns the fresh claim ambiguous (state assertion fails).
});
