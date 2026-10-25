/**
 * D1019 (#2856) — Cap table: who sees what. Migration 575, the five levels,
 * an investor's read through a grant and a relationship, an admin's support
 * read with a reason, the Super Admin's read-only view and log, grants with
 * their audit rows and the side-letter prefill, the access log, and share
 * links by level.
 *
 * On a database built from the baseline and every migration, with 575 applied
 * whole, as production builds it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_access_d1019.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import access, { SUPPORT_REASON_MIN } from '../src/routes/captable_access.ts';
import { simulate } from '../src/services/captable.ts';
import { ownPositionView, redactForAudience } from '../src/services/captableShare.ts';
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
const logCount = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM cap_table_access_log').get() as any).n;

// ---------------------------------------------------------------------------

test('575 applies whole: the grants and the log, and no IP column anywhere in the log', () => {
  const cols = (BUILT.prepare('PRAGMA table_info(cap_table_access_log)').all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['id', 'project_id', 'user_id', 'share_token_id', 'via', 'level', 'reason', 'opened_at']);
  assert.ok(!cols.some((c) => /ip|agent|ua/.test(c)));
  const share = (BUILT.prepare('PRAGMA table_info(captable_share_tokens)').all() as any[]).map((c) => c.name);
  for (const c of ['project_id', 'level', 'holders_attested_at', 'holders_attested_by']) assert.ok(share.includes(c), c);
  const db = fixture();
  assert.throws(() => db.exec(`INSERT INTO cap_table_access_grants (project_id, user_id, level, granted_by) VALUES (${P}, ${INV}, 'investor', ${OWNER})`),
    /UNIQUE/, 'one live grant per person and venture');
  assert.throws(() => db.exec(`INSERT INTO cap_table_access_grants (project_id, level, granted_by) VALUES (${P}, 'summary', ${OWNER})`), /CHECK/);
});

test('each level returns only its fields', async () => {
  const db = fixture();
  const full = await call(db, OWNER, `/${P}`);
  assert.equal(full.status, 200, full.text);
  assert.deepEqual({ l: full.body.level, v: full.body.via, ro: full.body.read_only }, { l: 'full', v: 'owner', ro: false });
  assert.equal(full.body.source, 'model');
  assert.ok(full.text.includes('Founder B') && full.text.includes('"events"'));

  const inv = await call(db, INV, `/${P}`);
  assert.equal(inv.body.level, 'investor');
  assert.ok(inv.text.includes('Founder A'), 'every investor and founder position');
  assert.ok(!inv.text.includes('"events"'), 'no free-text narration');
  assert.equal(inv.body.view.rounds[0].ledger.filter((h: any) => h.type === 'option_pool').length, 1, 'the pool as one line');

  const sum = await call(db, OP, `/${P}`);
  assert.equal(sum.body.level, 'summary');
  assert.deepEqual(Object.keys(sum.body.view).sort(), ['audience', 'disclosure', 'rounds_completed', 'scenario_name', 'summary']);
  for (const name of ['Founder A', 'Harbor Seed Fund', 'shares']) assert.ok(!sum.text.includes(name), `summary shows no ${name}`);

  const own = await call(db, HOLDER, `/${P}`);
  assert.equal(own.body.level, 'own_position', 'a holder sees at least their own position');
  assert.ok(own.body.view.position.length >= 1);
  assert.ok(own.body.view.position.every((h: any) => h.holder === 'Harbor Seed Fund'));
  assert.deepEqual(own.body.view.instruments.map((x: any) => x.amount), [500000]);
  assert.ok(!own.text.includes('Founder A') && !own.text.includes('Other Angel'), 'no other holder named');
  assert.ok(Array.isArray(own.body.view.summary) && own.body.view.summary.length > 0, 'the group split');
});

test('an investor reads only through a grant and a relationship', async () => {
  const db = fixture();
  const none = await call(db, INV_NOGRANT, `/${P}`);
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'not_shared');
  assert.equal(none.body.message, 'The founder has not shared the cap table with you.');
  const unrelated = await call(db, INV_UNRELATED, `/${P}`);
  assert.equal(unrelated.status, 403, 'a Full grant does not open a venture the investor has no relationship with');
  db.exec(`UPDATE cap_table_access_grants SET revoked_at = datetime('now') WHERE user_id = ${INV}`);
  assert.equal((await call(db, INV, `/${P}`)).status, 403, 'a revoked grant shows nothing');
});

test('advisors read Summary by default; Operating Partners only when granted', async () => {
  const db = fixture();
  const adv = await call(db, ADV, `/${P}`);
  assert.deepEqual({ l: adv.body.level, v: adv.body.via }, { l: 'summary', v: 'member' });
  db.exec(`INSERT INTO cap_table_access_grants (project_id, user_id, level, granted_by) VALUES (${P}, ${ADV}, 'none', ${OWNER})`);
  assert.equal((await call(db, ADV, `/${P}`)).status, 403, 'a None grant narrows the advisor');
  assert.equal((await call(db, OP_NOGRANT, `/${P}`)).status, 403);
  const cof = await call(db, COF, `/${P}`);
  assert.deepEqual({ l: cof.body.level, v: cof.body.via, ro: cof.body.read_only }, { l: 'full', v: 'member', ro: true });
});

test('an admin reads the group summary; the full table only for support, with a reason the founder sees', async () => {
  const db = fixture();
  const a = await call(db, ADMIN, `/${P}`);
  assert.deepEqual({ l: a.body.level, v: a.body.via, ro: a.body.read_only }, { l: 'summary', v: 'studio', ro: true });
  const noReason = await call(db, ADMIN, `/${P}/support`, 'POST', { reason: 'check' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'reason_required');
  assert.equal(SUPPORT_REASON_MIN, 10);
  const before = logCount(db);
  const s = await call(db, ADMIN, `/${P}/support`, 'POST', { reason: 'Founder asked us to check the pool' });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual({ l: s.body.level, v: s.body.via, ro: s.body.read_only }, { l: 'full', v: 'support', ro: true });
  assert.equal(logCount(db), before + 1);
  const log = await call(db, OWNER, `/${P}/log`);
  assert.equal(log.body.items[0].via, 'support');
  assert.equal(log.body.items[0].reason, 'Founder asked us to check the pool', 'the founder sees why');
  assert.equal((await call(db, INV, `/${P}/support`, 'POST', { reason: 'Founder asked us to check the pool' })).status, 403);
});

test('the Super Admin reads every venture read only, and the log across companies', async () => {
  const db = fixture();
  const s = await call(db, SUPER, `/${P}`);
  assert.deepEqual({ l: s.body.level, v: s.body.via, ro: s.body.read_only }, { l: 'full', v: 'hq', ro: true });
  await call(db, OWNER, `/${P}`);
  const log = await call(db, SUPER, '/log');
  assert.equal(log.status, 200);
  assert.deepEqual(log.body.items.map((x: any) => x.via), ['owner', 'hq']);
  assert.equal(log.body.items[0].venture, 'Acme Robotics');
  assert.equal((await call(db, ADMIN, '/log')).status, 403);
  assert.equal((await call(db, OWNER, '/log')).status, 403);
  for (const [m, path, body] of [['PUT', `/${P}/grants`, { user_uid: `u-${OP_NOGRANT}`, level: 'summary' }], ['POST', `/${P}/links`, { level: 'summary' }]] as const) {
    assert.equal((await call(db, SUPER, path, m, body)).status, 403, `the Super Admin edits none: ${m} ${path}`);
  }
});

test('every open is logged, and an open that cannot be logged is refused', async () => {
  const db = fixture();
  for (const who of [OWNER, COF, ADV, INV, OP, HOLDER, ADMIN, SUPER]) await call(db, who, `/${P}`);
  const rows = db.prepare('SELECT user_id, via, level FROM cap_table_access_log ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => `${r.user_id}:${r.via}:${r.level}`), [
    `${OWNER}:owner:full`, `${COF}:member:full`, `${ADV}:member:summary`, `${INV}:grant:investor`,
    `${OP}:grant:summary`, `${HOLDER}:grant:own_position`, `${ADMIN}:studio:summary`, `${SUPER}:hq:full`,
  ]);
  const refused = logCount(db);
  await call(db, INV_NOGRANT, `/${P}`);
  assert.equal(logCount(db), refused, 'a refusal is not an open');
  db.exec('DROP TABLE cap_table_access_log');
  const r = await call(db, OWNER, `/${P}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'access_log_unwritable');
  assert.equal(r.body.view, undefined, 'no view without its log row');
});

test('a read that fails is a 5xx, never an empty level', async () => {
  const db = fixture();
  db.exec('DROP TABLE cap_table_scenarios');
  const r = await call(db, OWNER, `/${P}`);
  assert.ok(r.status >= 500, String(r.status));
  const db2 = fixture();
  db2.exec('DROP TABLE cap_table_access_grants');
  assert.ok((await call(db2, INV, `/${P}`)).status >= 500, 'a broken grant store is not "not shared"');
  const empty = fixture();
  empty.exec('DELETE FROM cap_table_scenarios');
  const none = await call(empty, OWNER, `/${P}`);
  assert.deepEqual(none.body.view, { recorded: false, reason: 'No cap table is saved for this venture yet.' });
});

test('grants and revokes are the owner\'s only, each with one audit row; a changed level keeps the old row', async () => {
  const db = fixture();
  assert.equal((await call(db, COF, `/${P}/grants`, 'PUT', { user_uid: `u-${OP_NOGRANT}`, level: 'summary' })).status, 403);
  const list = await call(db, COF, `/${P}/grants`);
  assert.equal(list.status, 200);
  assert.equal(list.body.can_change, false, 'a co-founder reads access');
  assert.equal((await call(db, INV, `/${P}/grants`)).status, 403);

  const g = await call(db, OWNER, `/${P}/grants`, 'PUT', { user_uid: `u-${OP_NOGRANT}`, level: 'summary' });
  assert.equal(g.status, 201, g.text);
  assert.equal((await call(db, OP_NOGRANT, `/${P}`)).body.level, 'summary');
  const again = await call(db, OWNER, `/${P}/grants`, 'PUT', { user_uid: `u-${OP_NOGRANT}`, level: 'investor' });
  assert.equal(again.status, 201);
  const rows = db.prepare(`SELECT level, revoked_at FROM cap_table_access_grants WHERE user_id = ${OP_NOGRANT} ORDER BY id`).all() as any[];
  assert.deepEqual(rows.map((r) => [r.level, r.revoked_at === null]), [['summary', false], ['investor', true]]);
  assert.equal((await call(db, OWNER, `/${P}/grants`, 'PUT', { user_uid: `u-${OP_NOGRANT}`, level: 'owner' })).body.code, 'bad_level');
  assert.equal((await call(db, OWNER, `/${P}/grants`, 'PUT', { user_uid: `u-${OWNER}`, level: 'full' })).body.code, 'owner_needs_no_grant');

  const del = await call(db, OWNER, `/${P}/grants/${again.body.grant.id}`, 'DELETE');
  assert.equal(del.status, 200);
  assert.equal((await call(db, OP_NOGRANT, `/${P}`)).status, 403);
  assert.equal((await call(db, OWNER, `/${P}/grants/${again.body.grant.id}`, 'DELETE')).status, 404);
  const audit = db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'captable_access_%' ORDER BY id").all() as any[];
  assert.deepEqual(audit.map((a) => a.action), ['captable_access_granted', 'captable_access_granted', 'captable_access_revoked']);
});

test('a grant is prefilled from a signed information-rights side letter', async () => {
  const db = fixture();
  db.exec(`INSERT INTO deals (id, project_id) VALUES (5, ${P});
    INSERT INTO esign_envelopes (id, envelope_uuid, deal_id, document_type, document_title, document_body, body_sha256, status, created_by) VALUES
      (1, 'env-letter', 5, 'pro_rata_information_rights_side_letter', 'Side letter', 'x', 'h', 'completed', ${OWNER}),
      (2, 'env-nda', 5, 'mutual_nda', 'NDA', 'x', 'h', 'completed', ${OWNER}),
      (3, 'env-sent', 5, 'pro_rata_information_rights_side_letter', 'Side letter', 'x', 'h', 'sent', ${OWNER});
    INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, signing_token, token_expires_at, status) VALUES
      (1, ${INV_NOGRANT}, 'user7@example.invalid', 't1', '2027-01-01', 'signed'),
      (3, ${INV_NOGRANT}, 'user7@example.invalid', 't3', '2027-01-01', 'signed');`);
  for (const uuid of ['env-nda', 'env-sent', 'nope']) {
    const r = await call(db, OWNER, `/${P}/grants`, 'PUT', { from_envelope: uuid });
    assert.equal(r.body.code, 'not_a_signed_side_letter', uuid);
  }
  const ok = await call(db, OWNER, `/${P}/grants`, 'PUT', { from_envelope: 'env-letter' });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual({ l: ok.body.grant.level, s: ok.body.grant.source, r: ok.body.grant.source_ref }, { l: 'investor', s: 'side_letter', r: 'env-letter' });
  assert.equal((await call(db, INV_NOGRANT, `/${P}`)).body.level, 'investor');
});

test('share links by level: attestation for Investor and Full, expiry, a view cap, revoke, and each view logged', async () => {
  const db = fixture();
  const unattested = await call(db, OWNER, `/${P}/links`, 'POST', { level: 'investor', label: 'Seed data room' });
  assert.equal(unattested.status, 400);
  assert.equal(unattested.body.code, 'holders_not_attested');
  assert.equal((await call(db, OWNER, `/${P}/links`, 'POST', { level: 'own_position' })).body.code, 'bad_level');
  assert.equal((await call(db, OWNER, `/${P}/links`, 'POST', { level: 'summary', expires_in_hours: 0 })).body.code, 'bad_expiry');
  assert.equal((await call(db, COF, `/${P}/links`, 'POST', { level: 'summary' })).status, 403);

  const link = await call(db, OWNER, `/${P}/links`, 'POST', { level: 'investor', label: 'Seed data room', holders_agreed: true, view_limit: 2 });
  assert.equal(link.status, 201, link.text);
  const row = db.prepare('SELECT project_id, level, holders_attested_by, view_limit FROM captable_share_tokens WHERE id = ?').get(link.body.id) as any;
  assert.deepEqual({ ...row }, { project_id: P, level: 'investor', holders_attested_by: OWNER, view_limit: 2 });

  const v1 = await call(db, null, `/shared/${link.body.token}`);
  assert.equal(v1.status, 200, v1.text);
  assert.equal(v1.body.level, 'investor');
  assert.ok(!v1.text.includes('"events"'));
  await call(db, null, `/shared/${link.body.token}`);
  const spent = await call(db, null, `/shared/${link.body.token}`);
  assert.equal(spent.status, 410, 'the view cap holds');
  const views = db.prepare("SELECT via, level, share_token_id, user_id FROM cap_table_access_log WHERE via = 'link'").all() as any[];
  assert.equal(views.length, 2);
  assert.ok(views.every((v) => v.level === 'investor' && v.share_token_id === link.body.id && v.user_id === null));
  const log = await call(db, OWNER, `/${P}/log`);
  assert.equal(log.body.items[0].who, 'Seed data room');

  const sum = await call(db, OWNER, `/${P}/links`, 'POST', { level: 'summary' });
  assert.equal(sum.status, 201, 'Summary names no one, so no attestation');
  assert.equal((await call(db, OWNER, `/${P}/links/${sum.body.id}`, 'DELETE')).status, 200);
  assert.ok([403, 410].includes((await call(db, null, `/shared/${sum.body.token}`)).status), 'a revoked link opens nothing');
  const listed = await call(db, COF, `/${P}/links`);
  assert.equal(listed.body.items.length, 2);
  assert.equal(JSON.stringify(listed.body).includes(link.body.token), false, 'the token is never listed');
  const audit = db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'captable_link_%' ORDER BY id").all() as any[];
  assert.deepEqual(audit.map((a) => a.action), ['captable_link_created', 'captable_link_created', 'captable_link_revoked']);
  assert.equal((await call(db, null, '/shared/not-a-token')).status, 403);
  // The stored row must agree with the signed token: a row moved to another level or venture opens nothing.
  const third = await call(db, OWNER, `/${P}/links`, 'POST', { level: 'full', holders_agreed: true });
  assert.equal(third.status, 201, third.text);
  db.exec(`UPDATE captable_share_tokens SET level = 'summary' WHERE id = ${third.body.id}`);
  assert.equal((await call(db, null, `/shared/${third.body.token}`)).status, 403);
  const fourth = await call(db, OWNER, `/${P}/links`, 'POST', { level: 'summary' });
  assert.equal(fourth.status, 201, 'a second link at one level in the same second is its own link');
  assert.notEqual(fourth.body.token, sum.body.token);
  db.exec(`UPDATE captable_share_tokens SET project_id = ${OTHER_P} WHERE id = ${fourth.body.id}`);
  assert.equal((await call(db, null, `/shared/${fourth.body.token}`)).status, 403);
});

test('the views are built by copying: Summary and Own position carry nothing they may not show', () => {
  const result = simulate(inputs as any) as any;
  const s = redactForAudience(result, 'summary', 'X');
  assert.equal('rounds' in s, false);
  const o = ownPositionView(result, inputs as any, 'harbor seed fund ');
  assert.ok(o.position.length >= 1, 'the holder is matched by name, case and spacing aside');
  assert.ok(!JSON.stringify(o).includes('Founder A') && !JSON.stringify(o).includes('Founder B'), 'no other holder named; the group label "Founders" is the split');
});
