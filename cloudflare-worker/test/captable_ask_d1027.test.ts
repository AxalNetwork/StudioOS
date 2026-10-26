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
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import access, { ASK_SENT } from '../src/routes/captable_access.ts';
import { simulate } from '../src/services/captable.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function built(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 575)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec(readFileSync(resolve(MIGRATIONS, '575_cap_table_access.sql'), 'utf8')); // whole: must apply cleanly
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
