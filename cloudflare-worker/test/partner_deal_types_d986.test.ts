/**
 * D986 (#2776, part 5 of #2376) — partner deal types per licence: HQ's reads
 * and step-up write, the push to the branch's copy, the studio's own read, and
 * the branch's invitation write refusing a type the licence does not allow.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, as `program_grants_d982.test.ts` builds it, so migration 555
 * runs as it ships. Every studio, person and address is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import hqRoute from '../src/routes/admin_partner_deal_types.ts';
import mineRoute from '../src/routes/licence_partner_deal_types.ts';
import partnersRoute from '../src/routes/admin_partners.ts';
import { assembleLicenceRecord } from '../src/services/licencePush.ts';
import { applyLicenceCopy } from '../src/rpc/branchOps.ts';
import { ALL_PARTNER_DEAL_TYPES } from '../src/services/partnerDeals.ts';
import { DEAL_TYPE_LABELS, NOT_PUSHED_SENTENCE, NOT_RECORDED_SENTENCE, normalizeTypes, notAllowedRefusal } from '../src/services/partnerDealTypes.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, PLAIN_ADMIN = 2, HOLDER = 3, MEMBER = 4;
const LIVE = 'lic_live', ENDED = 'lic_term', OTHER = 'lic_other';
const REASON = 'Agreed at the October HQ review.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Pat Plain', 'pat@example.test');
  u.run(HOLDER, 'admin', 'Hal Holder', 'hal@example.test');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN_ADMIN, HOLDER, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const lic = db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?, ?, ?, ?, ?, ?)');
  lic.run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active');
  lic.run(2, ENDED, 'AXL-002', 'Studio West SAS', 'Studio West', 'terminated');
  lic.run(3, OTHER, 'AXL-003', 'Studio East SAS', 'Studio East', 'active');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/partner-deal-types', hqRoute);
app.route('/api/licence', mineRoute);
app.route('/api/admin/partners', partnersRoute);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), APP_URL: 'https://app.example.test', ...extra } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const save = (db: DatabaseSync, uid: string, body: Record<string, unknown>, who = SUPER) =>
  call(db, who, 'PUT', `/admin/partner-deal-types/licences/${uid}`, { reason: REASON, ...body });
const events = (db: DatabaseSync) => (db.prepare("SELECT licence_id, detail_json, note, actor_user_id FROM licence_events WHERE event = 'program_changed' ORDER BY id").all() as any[])
  .map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));

test('migration 555: one row per licence, holding a JSON array, and the branch copy\'s column', () => {
  const db = fixture();
  db.prepare("INSERT INTO licence_partner_deal_types (licence_id, types_json, updated_at) VALUES (1, '[]', 'now')").run();
  assert.throws(() => db.prepare("INSERT INTO licence_partner_deal_types (licence_id, types_json, updated_at) VALUES (1, '[]', 'now')").run(), /UNIQUE|PRIMARY/);
  for (const bad of ['{"a":1}', 'not json', '"equity_partnership"']) {
    assert.throws(() => db.prepare('INSERT INTO licence_partner_deal_types (licence_id, types_json, updated_at) VALUES (3, ?, \'now\')').run(bad), /CHECK/, bad);
  }
  const cols = (db.prepare("PRAGMA table_info('branch_licence')").all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('partner_deal_types_json'));
});

test('normalizeTypes: known types in catalogue order, unknown refused, null clears', () => {
  assert.deepEqual(normalizeTypes(['custom', 'EQUITY_PARTNERSHIP', 'custom']), ['equity_partnership', 'custom']);
  assert.deepEqual(normalizeTypes([]), []);
  assert.equal(normalizeTypes(null), null);
  assert.throws(() => normalizeTypes(['equity_partnership', 'rev_share']), /unknown_deal_type/);
  assert.throws(() => normalizeTypes('equity_partnership'), /invalid_types/);
  assert.deepEqual(Object.keys(DEAL_TYPE_LABELS), ALL_PARTNER_DEAL_TYPES, 'a deal type has no label, or a label has no type');
  const r = notAllowedRefusal(['equity_partnership', 'capital_partnership', 'custom'], ['equity_partnership']);
  assert.equal(r?.message, "This studio's licence does not allow Capital partnership and Custom deal. HQ sets which partner deal types a studio may offer.");
  assert.equal(notAllowedRefusal(['equity_partnership'], ['equity_partnership', 'custom']), null);
});

test('HQ reads: every licence Not recorded until set, Super Admin only, and an unknown licence is 404', async () => {
  const db = fixture();
  const list = await call(db, SUPER, 'GET', '/admin/partner-deal-types');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.catalogue.map((t: any) => t.type), ALL_PARTNER_DEAL_TYPES);
  assert.deepEqual(list.body.licences.map((l: any) => [l.uid, l.recorded, l.types, l.reason]), [
    [LIVE, false, null, NOT_RECORDED_SENTENCE], [ENDED, false, null, NOT_RECORDED_SENTENCE], [OTHER, false, null, NOT_RECORDED_SENTENCE],
  ]);
  assert.equal((await call(db, PLAIN_ADMIN, 'GET', '/admin/partner-deal-types')).status, 403);
  assert.equal((await call(db, PLAIN_ADMIN, 'GET', `/admin/partner-deal-types/licences/${LIVE}`)).status, 403);
  const one = await call(db, SUPER, 'GET', `/admin/partner-deal-types/licences/${LIVE}`);
  assert.equal(one.status, 200);
  assert.deepEqual([one.body.recorded, one.body.types, one.body.reason, one.body.history], [false, null, NOT_RECORDED_SENTENCE, []]);
  assert.equal((await call(db, SUPER, 'GET', '/admin/partner-deal-types/licences/lic_none')).status, 404);
});

test('HQ write: the step-up bar, a reason, known types; one program_changed event; unchanged refused; an empty list and a clear', async () => {
  const db = fixture();
  assert.equal((await save(db, LIVE, { types: ['equity_partnership'] }, PLAIN_ADMIN)).status, 403);
  assert.equal((await save(db, LIVE, { types: ['equity_partnership'], reason: 'short' })).body.error, 'reason_required');
  assert.equal((await save(db, LIVE, {})).body.error, 'types_required');
  const unknown = await save(db, LIVE, { types: ['equity_partnership', 'rev_share'] });
  assert.deepEqual([unknown.status, unknown.body.error, unknown.body.unknown], [400, 'unknown_deal_type', ['rev_share']]);
  assert.equal((await save(db, ENDED, { types: ['custom'] })).status, 409);
  assert.equal((await save(db, 'lic_none', { types: ['custom'] })).status, 404);
  db.prepare("UPDATE user_sessions SET created_at = datetime('now', '-3 hours') WHERE user_id = ?").run(SUPER);
  assert.equal((await save(db, LIVE, { types: ['custom'] })).status, 403, 'a stale step-up is refused');
  assert.equal((await call(db, SUPER, 'GET', `/admin/partner-deal-types/licences/${LIVE}`)).status, 200, 'a read needs no fresh step-up');
  db.prepare("UPDATE user_sessions SET created_at = datetime('now') WHERE user_id = ?").run(SUPER);
  assert.equal(events(db).length, 0, 'a refused write left an event');

  const ok = await save(db, LIVE, { types: ['services_partnership', 'equity_partnership'] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.recorded, ok.body.types], [true, ['equity_partnership', 'services_partnership']]);
  const [e1] = events(db);
  assert.deepEqual([e1.licence_id, e1.note, e1.actor_user_id], [1, REASON, SUPER]);
  assert.deepEqual(e1.detail, { action: 'deal_types_changed', program_key: null, before: null, after: ['equity_partnership', 'services_partnership'], reason: REASON });

  const same = await save(db, LIVE, { types: ['equity_partnership', 'services_partnership'] });
  assert.deepEqual([same.status, same.body.error], [409, 'unchanged']);

  const none = await save(db, LIVE, { types: [] });
  assert.deepEqual([none.status, none.body.recorded, none.body.types], [200, true, []]);
  const cleared = await save(db, LIVE, { types: null });
  assert.deepEqual([cleared.status, cleared.body.recorded, cleared.body.types], [200, false, null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_partner_deal_types').get().n, 0);
  assert.deepEqual(events(db).map((e) => [e.detail.before, e.detail.after]), [
    [null, ['equity_partnership', 'services_partnership']],
    [['equity_partnership', 'services_partnership'], []],
    [[], null],
  ]);
  const one = await call(db, SUPER, 'GET', `/admin/partner-deal-types/licences/${LIVE}`);
  assert.deepEqual(one.body.history.map((h: any) => h.after), [null, [], ['equity_partnership', 'services_partnership']], 'history newest first');
  // Only licence 1 changed.
  const list = await call(db, SUPER, 'GET', '/admin/partner-deal-types');
  assert.deepEqual(list.body.licences.map((l: any) => l.recorded), [false, false, false]);
});

test('the push carries the set, the branch writes it, and an older push never overwrites a newer one', async () => {
  const hq = fixture();
  const lic = hq.prepare('SELECT * FROM territory_licences WHERE uid = ?').get(LIVE) as any;
  const envOf = (db: DatabaseSync, extra: Record<string, unknown> = {}) => ({ DB: d1Over(db), JWT_SECRET, ...extra }) as any;
  const unset = await assembleLicenceRecord(envOf(hq), lic, '2026-10-20T09:00:00Z');
  assert.equal(unset.partner_deal_types_json, 'null', 'an unset licence must push the JSON null');
  await save(hq, LIVE, { types: ['capital_partnership'] });
  const set = await assembleLicenceRecord(envOf(hq), lic, '2026-10-20T10:00:00Z');
  assert.equal(set.partner_deal_types_json, '["capital_partnership"]');
  // A store that cannot be read leaves the key out, so the branch keeps its set.
  const broken = fixture();
  broken.exec('DROP TABLE licence_partner_deal_types');
  const saved = console.warn; console.warn = () => {};
  try {
    const partial = await assembleLicenceRecord(envOf(broken), lic, '2026-10-20T10:30:00Z');
    assert.equal(Object.prototype.hasOwnProperty.call(partial, 'partner_deal_types_json'), false);
  } finally { console.warn = saved; }

  const branch = fixture();
  const FR = envOf(branch, { BRANCH_CODE: 'fr' });
  await applyLicenceCopy(FR, set);
  const col = () => (branch.prepare('SELECT partner_deal_types_json AS j FROM branch_licence WHERE id = 1').get() as any).j;
  assert.equal(col(), '["capital_partnership"]');
  await applyLicenceCopy(FR, { ...unset, pushed_at: '2026-10-19T09:00:00Z' });
  assert.equal(col(), '["capital_partnership"]', 'an older push overwrote a newer set');
  const { partner_deal_types_json: _drop, ...without } = { ...set, pushed_at: '2026-10-21T09:00:00Z' } as any;
  await applyLicenceCopy(FR, without);
  assert.equal(col(), '["capital_partnership"]', 'a push without the key cleared the set');
});

test('the studio reads its own: the bound Administrator on HQ, an admin on a branch, each state said', async () => {
  const db = fixture();
  let mine = await call(db, HOLDER, 'GET', '/licence/mine/partner-deal-types');
  assert.deepEqual([mine.status, mine.body.source, mine.body.recorded, mine.body.types, mine.body.reason], [200, 'hq', false, null, NOT_RECORDED_SENTENCE]);
  await save(db, LIVE, { types: ['equity_partnership', 'custom'] });
  await save(db, OTHER, { types: ['capital_partnership'] });
  mine = await call(db, HOLDER, 'GET', '/licence/mine/partner-deal-types');
  assert.deepEqual([mine.body.recorded, mine.body.types], [true, ['equity_partnership', 'custom']], 'the Administrator read another licence');
  assert.equal((await call(db, PLAIN_ADMIN, 'GET', '/licence/mine/partner-deal-types')).status, 404);

  const branch = fixture();
  const FR = { BRANCH_CODE: 'fr' };
  const read = () => call(branch, PLAIN_ADMIN, 'GET', '/licence/mine/partner-deal-types', undefined, FR);
  branch.prepare("INSERT INTO branch_licence (id, licence_uid, territory, status, pushed_at) VALUES (1, 'lic_live', 'FR', 'active', '2026-10-20T09:00:00Z')").run();
  assert.deepEqual([(await read()).body.state, (await read()).body.reason], ['not_pushed', NOT_PUSHED_SENTENCE]);
  branch.prepare("UPDATE branch_licence SET partner_deal_types_json = 'null'").run();
  assert.deepEqual([(await read()).body.state, (await read()).body.reason], ['not_recorded', NOT_RECORDED_SENTENCE]);
  branch.prepare(`UPDATE branch_licence SET partner_deal_types_json = '["services_partnership"]'`).run();
  const got = await read();
  assert.deepEqual([got.status, got.body.source, got.body.recorded, got.body.types], [200, 'branch_copy', true, ['services_partnership']]);
  assert.equal((await call(branch, MEMBER, 'GET', '/licence/mine/partner-deal-types', undefined, FR)).status, 403);
  branch.prepare("UPDATE branch_licence SET partner_deal_types_json = '{\"oops\":1}'").run();
  assert.equal((await read()).status, 503, 'an unreadable copy must not read as Not recorded');
});

test('the branch invitation write refuses a type the licence does not allow, naming it; unset keeps every type; HQ is not limited', async () => {
  const invite = (db: DatabaseSync, types: string[], extra: Record<string, unknown>) =>
    call(db, PLAIN_ADMIN, 'POST', '/admin/partners/invitations', { recipient_email: 'partner@example.test', recipient_name: 'Pia Partner', allowed_deal_types: types }, extra);
  const branch = fixture();
  const FR = { BRANCH_CODE: 'fr' };
  branch.prepare(`INSERT INTO branch_licence (id, licence_uid, territory, status, pushed_at, partner_deal_types_json)
                  VALUES (1, 'lic_live', 'FR', 'active', '2026-10-20T09:00:00Z', '["services_partnership","custom"]')`).run();
  const count = () => (branch.prepare('SELECT COUNT(*) AS n FROM partner_invitations').get() as any).n;

  const refused = await invite(branch, ['services_partnership', 'capital_partnership'], FR);
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'deal_type_not_allowed');
  assert.match(refused.body.message, /does not allow Capital partnership\./);
  assert.deepEqual([refused.body.not_allowed, refused.body.allowed], [['capital_partnership'], ['services_partnership', 'custom']]);
  assert.equal(count(), 0, 'a refused invitation was written');

  const ok = await invite(branch, ['services_partnership'], FR);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(count(), 1);

  // HQ recorded none: every type stays open (D986 §3), and so before 555's push.
  for (const raw of ['null', null]) {
    branch.prepare('UPDATE branch_licence SET partner_deal_types_json = ?').run(raw);
    assert.equal((await invite(branch, ['capital_partnership'], FR)).status, 201, String(raw));
  }
  // An empty list is a decision: nothing may be offered.
  branch.prepare("UPDATE branch_licence SET partner_deal_types_json = '[]'").run();
  assert.equal((await invite(branch, ['custom'], FR)).status, 422);
  // A copy that cannot be read refuses rather than guesses.
  branch.prepare("UPDATE branch_licence SET partner_deal_types_json = 'garbage'").run();
  assert.equal((await invite(branch, ['custom'], FR)).status, 503);

  // HQ's own deployment: no licence to limit, whatever HQ set for its licences.
  const hq = fixture();
  await save(hq, LIVE, { types: [] });
  assert.equal((await invite(hq, ['capital_partnership'], {})).status, 201);
});
