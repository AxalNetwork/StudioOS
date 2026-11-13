/**
 * D1027 (#2864, part 12 of #2432) — the investor's read-only Cap table panel
 * needs two things from D1019's access routes:
 *
 *   · POST /api/captable/access/:projectId/ask (CT15n's "Ask for access"): an
 *     investor related to the venture whom the founder has not shared with asks
 *     once a day; one audit row and the founder told; an unrelated investor is
 *     404, one already shared with is 409, and nothing is granted;
 *   · a grant that names the caller's holder marks the caller's own rows at
 *     Investor level (`mine`), and no other row (CT15's "Your position").
 *
 * On D1019's fixture: the baseline and every migration, 575 applied whole.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_ask_d1027.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import access, { ASK_SENT } from '../src/routes/captable_access.ts';
import { simulate } from '../src/services/captable.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 575 });
  db.exec(readFileSync(resolve(MIGRATIONS, '575_cap_table_access.sql'), 'utf8')); // whole: must apply cleanly
  db.exec(readFileSync(resolve(MIGRATIONS, '202611031740_cap_table_access_requests.sql'), 'utf8')); // D1130: the stored ask
  return db;
}
const BUILT = built();

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  for (const o of BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                                  ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]) {
    try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ }
  }
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

const SUPER = 1, ADMIN = 2, OWNER = 3, COF = 4, ADV = 5, INV = 6, INV_NOGRANT = 7, INV_UNRELATED = 8, OP = 9, OP_NOGRANT = 10, HOLDER = 11;
const ROLE: Record<number, string> = {
  [SUPER]: 'admin', [ADMIN]: 'admin', [OWNER]: 'founder', [COF]: 'founder', [ADV]: 'advisor', [INV]: 'investor',
  [INV_NOGRANT]: 'investor', [INV_UNRELATED]: 'investor', [OP]: 'partner', [OP_NOGRANT]: 'partner', [HOLDER]: 'investor',
};
const P = 10, OTHER_P = 20;

const inputs = {
  founders: [{ name: 'Founder A', shares: 8_000_000 }, { name: 'Founder B', shares: 2_000_000 }],
  option_pool_pct: 10,
  safes: [{ name: 'Harbor Seed Fund', amount: 500_000, cap: 10_000_000, basis: 'post_money' }, { name: 'Other Angel', amount: 100_000, cap: 8_000_000 }],
  rounds: [{ name: 'Seed', pre_money: 12_000_000, investment: 3_000_000, post_round_pool_pct: 10 }],
};

function fixture() {
  const db = fresh();
  for (const [id, role] of Object.entries(ROLE)) {
    db.prepare("INSERT INTO users (id, uid, email, name, role, is_active, founder_id, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?, 'studio')")
      .run(Number(id), `u-${id}`, `user${id}@example.invalid`, `Person ${id}`, role, Number(id) === OWNER ? 40 : null);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Acme Robotics', 40), (${OTHER_P}, 'Other Co', 41);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COF}, 'cofounder', 'accepted'), (${P}, ${ADV}, 'advisor', 'accepted');
    INSERT INTO investor_introductions (uid, investor_user_id, project_id, quarter) VALUES ('i1', ${INV}, ${P}, '2026-Q4'), ('i2', ${INV_NOGRANT}, ${P}, '2026-Q4'), ('i3', ${HOLDER}, ${P}, '2026-Q4');`);
  db.prepare("INSERT INTO cap_table_scenarios (uid, owner_user_id, project_id, name, inputs_json, result_json) VALUES ('main', ?, ?, 'Cap table', ?, ?)")
    .run(OWNER, P, JSON.stringify(inputs), JSON.stringify(simulate(inputs as any)));
  // Grants: the investor at Investor, the unrelated investor (refused anyway), the OP at Summary, the holder at None with a holder name.
  db.exec(`INSERT INTO cap_table_access_grants (project_id, user_id, holder_ref, level, granted_by) VALUES
    (${P}, ${INV}, NULL, 'investor', ${OWNER}), (${P}, ${INV_UNRELATED}, NULL, 'full', ${OWNER}),
    (${P}, ${OP}, NULL, 'summary', ${OWNER}), (${P}, ${HOLDER}, 'Harbor Seed Fund', 'none', ${OWNER});`);
  db.exec(`INSERT INTO cap_table_share_classes(id,project_id,name,kind,authorized_shares) VALUES
    (1,10,'Common','common',NULL),(2,10,'Options','option_pool',1000);
    INSERT INTO cap_table_holders(id,user_id,project_id,name,kind) VALUES
    (101,3,10,'Founder A','founder'),(102,3,10,'Founder B','founder'),(103,3,10,'Harbor Seed Fund','investor'),(104,3,10,'Private Employee','employee');
    INSERT INTO cap_table_issuances(project_id,kind,holder_id,class_id,shares,source,origin,status,note) VALUES
    (10,'founding',101,1,8000,'typed','owner','recorded','Private note'),
    (10,'founding',102,1,2000,'typed','owner','recorded',NULL),
    (10,'priced',103,1,1000,'typed','owner','recorded',NULL),
    (10,'grant',104,2,100,'typed','owner','recorded',NULL),
    (10,'grant',104,2,900,'typed','cofounder','proposed','Pending private');
    INSERT INTO cap_table_issuances(project_id,kind,holder_id,amount_cents,source,origin,status) VALUES
    (10,'safe',103,50000000,'typed','owner','recorded');`);
  return db;
}

const env = (db: DatabaseSync) => ({ DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' }) as any;
async function call(db: DatabaseSync, who: number | null, path: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (who !== null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res: Response = await access.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env(db))
    .catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, body: json, text };
}
const asks = (db: DatabaseSync) => (db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'captable_access_asked'").get() as any).n;

test('ask: a related investor not shared with asks once a day; the founder is told; nothing is granted', async () => {
  const db = fixture();
  const r = await call(db, INV_NOGRANT, `/${P}/ask`, 'POST');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.message, ASK_SENT);
  assert.equal(asks(db), 1);
  const told = db.prepare("SELECT user_id, link FROM notifications_inbox WHERE type = 'captable_access_asked'").all() as any[];
  assert.deepEqual(told.map((n) => n.user_id), [OWNER]);
  assert.equal(told[0].link, `/raise/cap-table/access?project_id=${P}`);
  const again = await call(db, INV_NOGRANT, `/${P}/ask`, 'POST');
  assert.deepEqual([again.status, again.body?.code], [409, 'already_asked']);
  assert.equal(asks(db), 1, 'once a day');
  const grants = (db.prepare(`SELECT COUNT(*) AS n FROM cap_table_access_grants WHERE user_id = ${INV_NOGRANT}`).get() as any).n;
  assert.equal(grants, 0, 'asking grants nothing');
  assert.equal((await call(db, INV_NOGRANT, `/${P}`)).status, 403, 'still not shared');
});

test('ask: refused for one already shared with, an unrelated investor, a non-investor, another venture and anonymous', async () => {
  const db = fixture();
  assert.deepEqual([(await call(db, INV, `/${P}/ask`, 'POST')).body?.code], ['already_shared']);
  assert.equal((await call(db, INV_UNRELATED, `/${P}/ask`, 'POST')).status, 404, 'no relationship, no venture');
  assert.equal((await call(db, INV_NOGRANT, `/${OTHER_P}/ask`, 'POST')).status, 404);
  for (const who of [OP_NOGRANT, OWNER, ADMIN]) assert.equal((await call(db, who, `/${P}/ask`, 'POST')).status, 403, ROLE[who]);
  assert.ok([401, 403].includes((await call(db, null, `/${P}/ask`, 'POST')).status));
  assert.equal(asks(db), 0);
});

test('Your position: a grant naming the caller\'s holder marks their rows at Investor level, and no other', async () => {
  const db = fixture();
  db.exec(`UPDATE cap_table_access_grants SET holder_ref = 'holder:103' WHERE user_id = ${INV}`);
  const r = await call(db, INV, `/${P}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.level, 'investor');
  const mine = r.body.view.founding.filter((row: any) => row.mine).map((row: any) => row.holder);
  assert.deepEqual(mine, ['Harbor Seed Fund']);
  assert.ok(r.body.view.founding.filter((row: any) => !row.mine).every((row: any) => !('mine' in row)));
  db.exec(`UPDATE cap_table_access_grants SET holder_ref = NULL WHERE user_id = ${INV}`);
  const none = await call(db, INV, `/${P}`);
  assert.ok(none.body.view.founding.every((row: any) => !('mine' in row)), 'no holder named, no row marked');
});

// ---------------------------------------------------------------------------
// D1130 (#3010): the ask is stored, and the founder answers it on Access.
// ---------------------------------------------------------------------------
const requestRow = (db: DatabaseSync, who: number) =>
  db.prepare(`SELECT uid, status, requested_level, granted_level, grant_id, resolved_by, note FROM cap_table_access_requests WHERE requester_user_id = ? ORDER BY id DESC LIMIT 1`).get(who) as any;
const liveGrant = (db: DatabaseSync, who: number) =>
  db.prepare(`SELECT id, level, source_ref FROM cap_table_access_grants WHERE project_id = ${P} AND user_id = ? AND revoked_at IS NULL`).all(who) as any[];

test('D1130 ask: stored as one pending request at the asked level, with the note; a bad level or note is refused', async () => {
  const db = fixture();
  assert.equal((await call(db, INV_NOGRANT, `/${P}/ask`, 'POST', { level: 'everything' })).body?.code, 'bad_level');
  assert.equal((await call(db, INV_NOGRANT, `/${P}/ask`, 'POST', { note: 'x'.repeat(501) })).body?.code, 'bad_note');
  assert.equal(requestRow(db, INV_NOGRANT), undefined, 'a refused ask stores nothing');
  const r = await call(db, INV_NOGRANT, `/${P}/ask`, 'POST', { level: 'summary', note: '  For our Q4 review.  ' });
  assert.equal(r.status, 200, r.text);
  const q = requestRow(db, INV_NOGRANT);
  assert.deepEqual([q.status, q.requested_level, q.note, q.grant_id], ['pending', 'summary', 'For our Q4 review.', null]);
  assert.equal(r.body.request.uid, q.uid);
  const def = fixture();
  await call(def, INV_NOGRANT, `/${P}/ask`, 'POST');
  assert.equal(requestRow(def, INV_NOGRANT).requested_level, 'investor', 'no level named: Investor');
  assert.throws(() => db.prepare(`INSERT INTO cap_table_access_requests (uid, project_id, requester_user_id, requested_level) VALUES ('dup', ${P}, ${INV_NOGRANT}, 'full')`).run(),
    /UNIQUE/, 'the store itself holds one pending ask per person and venture');
});

test('D1130 requests: the founders read the pending asks (name and role, no email); others are refused', async () => {
  const db = fixture();
  await call(db, INV_NOGRANT, `/${P}/ask`, 'POST', { level: 'summary' });
  const own = await call(db, OWNER, `/${P}/requests`);
  assert.equal(own.status, 200, own.text);
  assert.equal(own.body.can_change, true);
  assert.deepEqual(own.body.requests.map((x: any) => [x.name, x.role, x.requested_level]), [[`Person ${INV_NOGRANT}`, 'investor', 'summary']]);
  assert.ok(!own.text.includes('@example.invalid'), 'no email leaves the read');
  const cof = await call(db, COF, `/${P}/requests`);
  assert.deepEqual([cof.status, cof.body.can_change, cof.body.requests.length], [200, false, 1]);
  for (const who of [INV_NOGRANT, INV, ADV, OP]) assert.equal((await call(db, who, `/${P}/requests`)).status, 403, ROLE[who]);
});

test('D1130 approve: the owner grants a level (the asked one, or another); the request records it; twice grants once', async () => {
  const db = fixture();
  await call(db, INV_NOGRANT, `/${P}/ask`, 'POST', { level: 'investor' });
  const { uid } = requestRow(db, INV_NOGRANT);
  assert.equal((await call(db, COF, `/${P}/requests/${uid}/approve`, 'POST')).status, 403, 'a co-founder reads and changes nothing');
  assert.equal(liveGrant(db, INV_NOGRANT).length, 0);
  assert.equal((await call(db, OWNER, `/${P}/requests/${uid}/approve`, 'POST', { level: 'none' })).body?.code, 'bad_level');
  const r = await call(db, OWNER, `/${P}/requests/${uid}/approve`, 'POST', { level: 'summary' });
  assert.equal(r.status, 200, r.text);
  const q = requestRow(db, INV_NOGRANT);
  const g = liveGrant(db, INV_NOGRANT);
  assert.equal(g.length, 1);
  assert.deepEqual([q.status, q.granted_level, q.grant_id, q.resolved_by], ['approved', 'summary', g[0].id, OWNER]);
  assert.deepEqual([g[0].level, g[0].source_ref], ['summary', `request:${uid}`]);
  const audit = db.prepare(`SELECT details FROM activity_logs WHERE action = 'captable_access_granted'`).all() as any[];
  assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].details).request_uid, uid);
  const view = await call(db, INV_NOGRANT, `/${P}`);
  assert.deepEqual([view.status, view.body?.level], [200, 'summary'], 'the investor reads at the granted level');
  const again = await call(db, OWNER, `/${P}/requests/${uid}/approve`, 'POST');
  assert.deepEqual([again.status, again.body?.code], [409, 'already_answered']);
  assert.equal(liveGrant(db, INV_NOGRANT).length, 1, 'answered twice, granted once');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'captable_access_granted'`).get() as any).n, 1);
  const told = db.prepare(`SELECT user_id FROM notifications_inbox WHERE type = 'captable_access_approved'`).all() as any[];
  assert.deepEqual(told.map((n) => n.user_id), [INV_NOGRANT]);
  const plain = fixture();
  await call(plain, INV_NOGRANT, `/${P}/ask`, 'POST', { level: 'full' });
  await call(plain, OWNER, `/${P}/requests/${requestRow(plain, INV_NOGRANT).uid}/approve`, 'POST');
  assert.equal(liveGrant(plain, INV_NOGRANT)[0].level, 'full', 'no level named: the asked level');
});

test('D1130 decline: nothing is granted, the asker is told, and can ask again only after a day', async () => {
  const db = fixture();
  await call(db, INV_NOGRANT, `/${P}/ask`, 'POST');
  const { uid } = requestRow(db, INV_NOGRANT);
  assert.equal((await call(db, OWNER, `/${P}/requests/not-a-uid/decline`, 'POST')).status, 404);
  const r = await call(db, OWNER, `/${P}/requests/${uid}/decline`, 'POST');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([requestRow(db, INV_NOGRANT).status, liveGrant(db, INV_NOGRANT).length], ['declined', 0]);
  assert.equal((await call(db, OWNER, `/${P}/requests/${uid}/approve`, 'POST')).body?.code, 'already_answered', 'a declined ask cannot be approved later');
  assert.equal(liveGrant(db, INV_NOGRANT).length, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'captable_access_declined' AND user_id = ${INV_NOGRANT}`).get() as any).n, 1);
  assert.equal((await call(db, INV_NOGRANT, `/${P}/ask`, 'POST')).body?.code, 'already_asked', 'within a day of the decline');
  db.exec(`UPDATE cap_table_access_requests SET resolved_at = datetime('now', '-2 days') WHERE uid = '${uid}'`);
  assert.equal((await call(db, INV_NOGRANT, `/${P}/ask`, 'POST')).status, 200, 'a day later, a new ask');
  assert.equal((await call(db, OWNER, `/${P}/requests`)).body.requests.length, 1);
});
