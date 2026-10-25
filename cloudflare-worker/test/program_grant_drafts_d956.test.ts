/**
 * D956 (#2789, part 3 of #2371) — migration 562 (a grant may be a draft), the
 * draft an approval for one studio opens, D982's write as its one way out,
 * Offer to studios, and what each viewer reads of a program's grant.
 *
 * Run on a database built from the baseline and every migration above the
 * cutoff, as production builds it; 560, 561 and 562 are applied whole and must
 * apply. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/program_grant_drafts_d956.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import adminPrograms from '../src/routes/admin_programs.ts';
import adminProgramProposals from '../src/routes/admin_program_proposals.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import { programCopy } from '../src/services/licencePrograms.ts';
import { NO_COPY_REASON, GRANTS_UNREADABLE, grantStates } from '../src/services/programGrantStates.ts';
import { termsFor } from '../src/services/programGrants.ts';
import { PROGRAM_KEYS } from '../src/services/programRegistry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const REASON = 'Agreed at the October HQ review.';
const WHOLE = ['560_program_registry.sql', '561_program_proposals.sql', '562_program_grants_draft.sql'];

const SUPER = 1, LIS = 2, NAI = 3, LONE = 4, PLAIN = 5;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [LIS]: 'admin', [NAI]: 'admin', [LONE]: 'admin', [PLAIN]: 'admin' };
const TODAY = new Date().toISOString().slice(0, 10);

const files = () => readdirSync(MIGRATIONS).filter((x) => /^\d+_.*\.sql$/.test(x)).sort(compareMigrations)
  .filter((x) => migrationNumber(x) > BASELINE_CUTOFF);

/** The baseline and every migration, `upTo` excluded; the three above applied whole. */
function built(upTo = Infinity): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of files().filter((x) => migrationNumber(x) < upTo)) {
    const sql = readFileSync(resolve(MIGRATIONS, f), 'utf8');
    if (WHOLE.includes(f)) { db.exec(sql); continue; }
    for (const stmt of splitStatements(sql)) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  return db;
}
const BUILT = built();

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const objs = BUILT.prepare(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[];
  for (const o of objs) { try { db.exec(o.sql); } catch { /* views and triggers naming absent objects */ } }
  db.exec('PRAGMA foreign_keys = OFF');
  for (const o of objs.filter((x) => x.type === 'table')) {
    for (const r of BUILT.prepare(`SELECT * FROM "${o.name}"`).all() as any[]) {
      const cols = Object.keys(r);
      db.prepare(`INSERT INTO "${o.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c]));
    }
  }
  const u = db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const [id, name] of [[SUPER, 'Sam Super'], [LIS, 'Lia Lisbon'], [NAI, 'Nia Nairobi'], [LONE, 'Lou Lone'], [PLAIN, 'Pat Plain']] as const) {
    u.run(id, `u-${id}`, `person${id}@example.test`, name, ROLE[id]);
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES
      (1, 'lic-lis', 'PT-001', 'Studio Lisbon Lda', 'Studio Lisbon', 'active', '2027-10-31'),
      (2, 'lic-nai', 'KE-001', 'Studio Nairobi Ltd', 'Studio Nairobi', 'active', '2027-10-31'),
      (3, 'lic-sus', 'ES-001', 'Studio Sevilla SL', 'Studio Sevilla', 'suspended', '2027-10-31');
    INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ${LIS}, 'principal'), (2, ${NAI}, 'principal');
    INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
      VALUES ('lic-lis', 'lis', 'lis.example.test', 'studioos-lis', 'studioos-lis-db', 'linked');`);
  return db;
}

// Mounted as index.ts mounts them: proposals before the programs router.
const app = new Hono<any>();
app.route('/api/admin/programs/proposals', adminProgramProposals);
app.route('/api/admin/programs', adminPrograms);
app.route('/api/admin/program-grants', grantsRoute);

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, env: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: ROLE[who], jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...env } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}
const one = (db: DatabaseSync, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const events = (db: DatabaseSync, licenceId: number) => (db.prepare(
  "SELECT detail_json, note, actor_user_id FROM licence_events WHERE event = 'program_changed' AND licence_id = ? ORDER BY id",
).all(licenceId) as any[]).map((e) => ({ ...e, detail: JSON.parse(e.detail_json) }));
const audit = (db: DatabaseSync, action: string) => db.prepare('SELECT filters_json FROM admin_audit_log WHERE action = ? ORDER BY id').all(action).map((r: any) => JSON.parse(r.filters_json));

/** A proposal sent to HQ by `licence`, as a send OD-PROP has not opened yet would leave it. */
function sent(db: DatabaseSync, uid: string, licence: string | null, name: string) {
  db.prepare(`INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, name, purpose, who_json, grp, join_method, cycle, seats,
      rewards_json, template_keys, tools_json, sent_at) VALUES (?, ?, ?, 'sent', ?, 'A purpose.', '["Founders"]', 'Access', 'By invitation', 'rolling', 20,
      '["None"]', '[]', '{}', '2026-10-16T09:00:00.000Z')`).run(uid, LIS, licence, name);
}
const approve = (db: DatabaseSync, uid: string, outcome = 'approve_studio') =>
  call(db, SUPER, 'POST', `/api/admin/programs/proposals/${uid}/decision`, { outcome });

function grantRow(db: DatabaseSync, licenceId: number, key: string, state: string) {
  db.prepare(`INSERT INTO program_grants (uid, licence_id, program_key, state, requires_signed_schedule, set_by_user_id, set_at)
    VALUES (?, ?, ?, ?, 0, ?, '2026-10-01T00:00:00Z')`).run(`g-${licenceId}-${key}`, licenceId, key, state, SUPER);
}
function openRequest(db: DatabaseSync, branch: string, subject: string | null, program: string, at: string) {
  db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, detail, raised_by_name, status, created_at)
    VALUES (?, ?, 'program_grant', 'Program request', ?, ?, 'A studio admin', 'open', ?)`)
    .run(`esc-${branch}-${program}`, branch, subject, JSON.stringify({ v: 1, request: { program }, note: null }), at);
}

// ─────────────────────────────────────────────── migration 562

test('562 applies to a fresh D1: D982’s rows, ids and index stay; draft and registry keys are taken, anything else refused; the backfill is dated and recorded once', () => {
  const db = built(562);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (1, 'admin', 'Sam Super', 'sam@example.test', 1);
    INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, 'lic-lis', 'PT-001', 'Studio Lisbon Lda', 'Studio Lisbon', 'active');
    INSERT INTO program_grants (id, uid, licence_id, program_key, state, fee_cents, currency, note, set_by_user_id, set_at)
      VALUES (7, 'g-perks', 1, 'perks', 'paused', 120000, 'EUR', 'Paused for the audit.', 1, '2026-09-01T00:00:00Z');
    INSERT INTO program_proposals (uid, created_by_user_id, licence_uid, status, decision, program_key, decided_by_user_id, decided_at, name) VALUES
      ('pp-1', 1, 'lic-lis', 'approved', 'studio', 'demo-night', 1, '2026-10-20T10:00:00Z', 'Demo Night'),
      ('pp-2', 1, 'lic-gone', 'approved', 'studio', 'hardware-sprint', 1, '2026-10-20T10:00:00Z', 'Hardware Sprint'),
      ('pp-3', 1, 'lic-lis', 'approved', 'catalogue', 'open-clinic', 1, '2026-10-20T10:00:00Z', 'Open Clinic'),
      ('pp-4', 1, 'lic-lis', 'declined', NULL, NULL, 1, '2026-10-20T10:00:00Z', 'No');`);
  const before = one(db, 'SELECT * FROM program_grants WHERE id = 7');
  const seal = () => (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'licence_events' ORDER BY name").all() as any[]).map((r) => ({ ...r }));
  const sealBefore = seal();
  const sql = readFileSync(resolve(MIGRATIONS, '562_program_grants_draft.sql'), 'utf8');
  db.exec(sql);
  db.exec(sql);
  const kept = one(db, 'SELECT * FROM program_grants WHERE id = 7');
  assert.deepEqual({ ...kept, proposal_uid: undefined }, { ...before, proposal_uid: undefined }, 'D982’s row is copied whole, with its id');
  assert.equal(kept.proposal_uid, null);
  const drafts = db.prepare("SELECT licence_id, program_key, state, proposal_uid, set_by_user_id, set_at FROM program_grants WHERE state = 'draft'").all() as any[];
  assert.deepEqual(drafts.map((d) => ({ ...d })), [
    { licence_id: 1, program_key: 'demo-night', state: 'draft', proposal_uid: 'pp-1', set_by_user_id: 1, set_at: '2026-10-20T10:00:00Z' },
  ], 'one draft: not for a catalogue approval, a declined proposal or a studio with no licence row, and not twice');
  const ev = events(db, 1);
  assert.equal(ev.length, 1, 'one event, though applied twice');
  assert.deepEqual(ev[0].detail, {
    action: 'draft_opened', program_key: 'demo-night', proposal_uid: 'pp-1',
    changed: [{ key: 'state', before: null, after: 'draft' }], backfilled: true,
  });
  const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'program_grants' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map((r) => r.name);
  assert.deepEqual(idx, ['idx_program_grants_program', 'idx_program_grants_proposal']);
  assert.throws(() => db.exec("INSERT INTO program_grants (uid, licence_id, program_key, state, set_at) VALUES ('x1', 1, 'spinout-lab', 'pending', 'x')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO program_grants (uid, licence_id, program_key, state, set_at) VALUES ('x2', 1, 'Not A Key', 'draft', 'x')"), /CHECK/);
  assert.throws(() => db.exec("INSERT INTO program_grants (uid, licence_id, program_key, state, proposal_uid, set_at) VALUES ('x3', 1, 'other-one', 'draft', 'pp-1', 'x')"), /UNIQUE/);
  // licence_events, and whatever seal it carries, is untouched.
  assert.deepEqual(seal(), sealBefore);
});

// ─────────────────────────────────────────────── the draft

test('an approval for this studio only opens a draft and its event; a catalogue approval opens none; the studio reads Not granted', async () => {
  const db = fresh();
  sent(db, 'pp-1', 'lic-lis', 'Regional Demo Night');
  sent(db, 'pp-2', 'lic-lis', 'Open Clinic');
  assert.equal((await approve(db, 'pp-1')).status, 200);
  assert.equal((await approve(db, 'pp-2', 'approve_catalogue')).status, 200);
  const d = one(db, "SELECT * FROM program_grants WHERE program_key = 'regional-demo-night'");
  assert.deepEqual([d.licence_id, d.state, d.proposal_uid, d.set_by_user_id], [1, 'draft', 'pp-1', SUPER]);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM program_grants WHERE program_key = 'open-clinic'").n, 0);
  const ev = events(db, 1);
  assert.deepEqual(ev.map((e) => [e.detail.action, e.detail.program_key, e.detail.proposal_uid, e.actor_user_id]), [['draft_opened', 'regional-demo-night', 'pp-1', SUPER]]);
  assert.deepEqual(audit(db, 'program.proposal.decide').map((a) => a.draft_grant ?? null), [true, null]);
  // The studio's catalogue: the draft reads Not granted, and nothing is granted.
  const cat = (await call(db, LIS, 'GET', '/api/admin/programs?weeks=4')).body;
  assert.deepEqual(cat.programs.rows.find((r: any) => r.key === 'regional-demo-night').grant, { state: 'not_granted' });
  assert.equal(cat.nothing_granted, true);
  // HQ's copy to the branch does not carry it.
  assert.equal((await programCopy({ DB: d1Over(db) } as any, 1)).grants.length, 0);
});

test('a studio whose licence row is gone gets no draft, and the approval still lands', async () => {
  const db = fresh();
  sent(db, 'pp-1', 'lic-gone', 'Lost Studio Night');
  assert.equal((await approve(db, 'pp-1')).status, 200);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM program_grants').n, 0);
  assert.equal(one(db, "SELECT status FROM program_proposals WHERE uid = 'pp-1'").status, 'approved');
  assert.deepEqual(audit(db, 'program.proposal.decide').map((a) => a.draft_grant), [false]);
});

test('D982’s grant write takes a draft to granted, once, with its proposal; every other move from a draft is refused', async () => {
  const db = fresh();
  sent(db, 'pp-1', 'lic-lis', 'Regional Demo Night');
  await approve(db, 'pp-1');
  const base = '/api/admin/program-grants/licences/lic-lis/regional-demo-night';
  for (const [method, path] of [['PATCH', base], ['POST', `${base}/pause`], ['POST', `${base}/resume`], ['POST', `${base}/end`]] as const) {
    const r = await call(db, SUPER, method, path, { reason: REASON, terms: { fee_cents: 100 } });
    assert.equal(r.status, 409, `${method} ${path}`);
    assert.ok(['not_granted', 'wrong_state'].includes(r.body.error), r.body.error);
    if (method === 'PATCH') assert.match(r.body.message, /is a draft/, 'says why, not "changed while you were changing it"');
  }
  assert.equal(one(db, "SELECT state FROM program_grants WHERE program_key = 'regional-demo-night'").state, 'draft');
  // A term that only a nine program carries does not apply to a program D955 added.
  assert.deepEqual(termsFor('regional-demo-night'), ['starts_on', 'ends_on', 'ends_with_licence', 'fee_cents', 'currency', 'playbook', 'brand', 'reporting', 'requires_signed_schedule']);
  assert.equal((await call(db, SUPER, 'POST', base, { reason: REASON, terms: { credits_per_quarter: 4 } })).body.error, 'invalid_terms');
  const ok = await call(db, SUPER, 'POST', base, { reason: REASON, terms: { fee_cents: 50000, currency: 'eur' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.grant.state, ok.body.grant.terms.fee_cents, ok.body.grant.terms.currency], ['granted', 50000, 'EUR']);
  const row = one(db, "SELECT state, proposal_uid FROM program_grants WHERE program_key = 'regional-demo-night'");
  assert.deepEqual([row.state, row.proposal_uid], ['granted', 'pp-1']);
  const last = events(db, 1).at(-1)!;
  assert.deepEqual([last.detail.action, last.detail.from_draft, last.detail.proposal_uid, last.detail.changed[0]],
    ['granted', true, 'pp-1', { key: 'state', before: 'draft', after: 'granted' }]);
  assert.equal(last.note, REASON);
  // Granted now: a second grant is a duplicate; once ended, it may be granted again.
  assert.equal((await call(db, SUPER, 'POST', base, { reason: REASON })).body.error, 'already_granted');
  assert.equal((await call(db, SUPER, 'POST', `${base}/end`, { reason: REASON })).status, 200);
  const again = await call(db, SUPER, 'POST', base, { reason: REASON });
  assert.deepEqual([again.status, again.body.grant.state, events(db, 1).at(-1)!.detail.action], [200, 'granted', 'regranted']);
});

test('a program D955 added is granted only from its draft, and a frozen licence takes no draft', async () => {
  const db = fresh();
  sent(db, 'pp-1', 'lic-lis', 'Regional Demo Night');
  await approve(db, 'pp-1');
  const other = await call(db, SUPER, 'POST', '/api/admin/program-grants/licences/lic-nai/regional-demo-night', { reason: REASON });
  assert.deepEqual([other.status, other.body.error], [422, 'not_grantable']);
  assert.equal((await call(db, SUPER, 'POST', '/api/admin/program-grants/licences/lic-nai/no-such-program', { reason: REASON })).status, 404);
  db.exec("UPDATE program_grants SET licence_id = 3 WHERE program_key = 'regional-demo-night'");
  const frozen = await call(db, SUPER, 'POST', '/api/admin/program-grants/licences/lic-sus/regional-demo-night', { reason: REASON });
  assert.deepEqual([frozen.status, frozen.body.error], [409, 'licence_frozen']);
});

// ─────────────────────────────────────────────── Offer to studios

const offer = (db: DatabaseSync, key: string, grantable: unknown, who = SUPER, reason = REASON) =>
  call(db, who, 'PUT', `/api/admin/programs/${key}/grantable`, { grantable, reason });

test('Offer to studios: off keeps every grant and counts them; on needs a published playbook; the canvas’s refusals; audited and in Activity', async () => {
  const db = fresh();
  grantRow(db, 1, 'spinout-lab', 'granted');
  grantRow(db, 2, 'spinout-lab', 'paused');
  const off = await offer(db, 'spinout-lab', false);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.deepEqual(off.body, { program_key: 'spinout-lab', grantable: false, grants_kept: { granted: 1, paused: 1 } });
  assert.deepEqual((db.prepare("SELECT state FROM program_grants WHERE program_key = 'spinout-lab' ORDER BY id").all() as any[]).map((r) => r.state), ['granted', 'paused']);
  // Spin-Out Lab has no published playbook (D954), so it cannot be switched back on, on either page.
  const on = await offer(db, 'spinout-lab', true);
  assert.deepEqual([on.status, on.body.code], [409, 'not_published']);
  const viaDefaults = await call(db, SUPER, 'PUT', '/api/admin/program-grants/defaults/spinout-lab', { reason: REASON, grantable: true });
  assert.deepEqual([viaDefaults.status, viaDefaults.body.error], [409, 'not_published']);
  db.exec("INSERT INTO program_playbook_versions (program_key, version, published_at) VALUES ('spinout-lab', 1, '2026-10-24T00:00:00Z')");
  assert.equal((await offer(db, 'spinout-lab', true)).status, 200);
  assert.equal(one(db, "SELECT grantable FROM program_grant_defaults WHERE program_key = 'spinout-lab'").grantable, 1);
  assert.deepEqual([(await offer(db, 'spinout-lab', true)).body.code], ['no_change']);
  // The canvas's refusals.
  assert.equal((await offer(db, 'product-testing', true)).body.code, 'runs_at_hq');
  assert.equal((await offer(db, 'investor-cohorts', true)).body.code, 'not_built');
  assert.equal((await offer(db, 'ai-native-venture', true)).body.code, 'not_published', 'its draft says: when HQ publishes it');
  db.exec("INSERT INTO program_playbook_versions (program_key, version, published_at) VALUES ('ai-native-venture', 1, '2026-10-24T00:00:00Z')");
  assert.equal((await offer(db, 'ai-native-venture', true)).body.code, 'not_grantable', 'D982’s readiness still holds it');
  sent(db, 'pp-1', null, 'Open Clinic');
  await approve(db, 'pp-1', 'approve_catalogue');
  assert.equal((await offer(db, 'open-clinic', true)).body.code, 'not_offerable');
  assert.equal((await offer(db, 'no-such-program', true)).status, 404);
  assert.equal((await offer(db, 'perks', 'yes')).body.code, 'bad_grantable');
  assert.equal((await offer(db, 'perks', false, SUPER, 'short')).body.code, 'reason_required');
  assert.equal((await offer(db, 'perks', false, PLAIN)).status, 403);
  // Audited, and listed in the program's Activity.
  assert.deepEqual(audit(db, 'program.grant.offer').map((a) => [a.program_key, a.grantable]), [['spinout-lab', false], ['spinout-lab', true]]);
  const act = (await call(db, SUPER, 'GET', '/api/admin/programs/spinout-lab/activity')).body;
  assert.deepEqual(act.rows.filter((r: any) => r.kind === 'program.grant.offer').map((r: any) => r.concerns.grantable), [true, false]);
});

// ─────────────────────────────────────────────── what each viewer reads

function studio(db: DatabaseSync) {
  grantRow(db, 1, 'perks', 'granted');
  grantRow(db, 1, 'learning', 'paused');
  grantRow(db, 1, 'mentor-cohorts', 'ended');
  grantRow(db, 2, 'perks', 'granted');
  openRequest(db, 'hq', 'lic-lis', 'referral-partners', '2026-10-20 09:00:00');
  openRequest(db, 'hq', 'lic-lis', 'referral-partners-2', '2026-10-19 09:00:00');
  openRequest(db, 'lis', null, 'refer-and-earn', '2026-10-18 09:00:00');
  openRequest(db, 'hq', 'lic-nai', 'spinout-lab', '2026-10-17 09:00:00');
  db.exec("UPDATE hq_escalations SET detail = json_object('v', 1, 'request', json_object('program', 'referral-partners')) WHERE uid = 'esc-hq-referral-partners-2'");
}
const gradeOf = async (db: DatabaseSync, who: number) => {
  const body = (await call(db, who, 'GET', '/api/admin/programs?weeks=4')).body;
  return { body, by: Object.fromEntries(body.programs.rows.map((r: any) => [r.key, r.grant])) };
};

test('a deployed studio’s Admin reads its licence’s state in the canvas’s words', async () => {
  const db = fresh();
  studio(db);
  const { body, by } = await gradeOf(db, LIS);
  assert.deepEqual(body.grants, { available: true, viewer: 'licence', held_because: null });
  assert.equal(body.nothing_granted, false);
  assert.deepEqual(by.perks, { state: 'granted', in_force: true });
  assert.deepEqual(by.learning, { state: 'paused' });
  assert.deepEqual(by['mentor-cohorts'], { state: 'ended' });
  assert.deepEqual(by['referral-partners'], { state: 'requested', since: '2026-10-19 09:00:00' }, 'the oldest open request on HQ’s lane');
  assert.deepEqual(by['refer-and-earn'], { state: 'requested', since: '2026-10-18 09:00:00' }, 'and from its branch’s lane');
  assert.deepEqual(by['spinout-lab'], { state: 'not_granted' }, 'another studio’s request is not this one’s');
  assert.deepEqual(by['product-testing'], { state: 'runs_at_hq' });
  assert.deepEqual([by['ai-native-venture'], by['investor-cohorts']], [{ state: 'not_offered' }, { state: 'not_offered' }]);
  // An ended grant asked for again reads Requested.
  openRequest(db, 'hq', 'lic-lis', 'mentor-cohorts', '2026-10-21 09:00:00');
  assert.deepEqual((await gradeOf(db, LIS)).by['mentor-cohorts'], { state: 'requested', since: '2026-10-21 09:00:00' });
  // `/:key` reads the same, with D982's switch.
  const one = (await call(db, LIS, 'GET', '/api/admin/programs/perks')).body;
  assert.deepEqual([one.grant, one.grantable], [{ state: 'granted', in_force: true }, true]);
  assert.equal((await call(db, LIS, 'GET', '/api/admin/programs/product-testing')).body.grantable, false);
});

test('nothing granted: a deployed studio holding no granted row says so', async () => {
  const db = fresh();
  grantRow(db, 1, 'perks', 'paused');
  const { body } = await gradeOf(db, LIS);
  assert.equal(body.nothing_granted, true);
});

test('the held mode: an admin bound to no licence, and a licence administrator whose studio is not deployed', async () => {
  const db = fresh();
  studio(db);
  for (const [who, because] of [[LONE, /not linked to a licence/], [NAI, /not deployed/]] as const) {
    const { body, by } = await gradeOf(db, who);
    assert.equal(body.grants.viewer, 'held');
    assert.match(body.grants.held_because, because);
    assert.equal(body.nothing_granted, false);
    assert.deepEqual(by.perks, { state: 'hq_held' }, 'never their own studio’s grant');
    assert.deepEqual(by['spinout-lab'], { state: 'hq_held' }, 'never Requested');
    assert.deepEqual(by['product-testing'], { state: 'runs_at_hq' });
    assert.deepEqual(by['ai-native-venture'], { state: 'not_offered' });
    for (const g of Object.values(by)) assert.ok(['hq_held', 'not_offered', 'runs_at_hq'].includes((g as any).state));
  }
});

test('a Super Admin reads how many studios hold each program, or HQ only', async () => {
  const db = fresh();
  studio(db);
  sent(db, 'pp-1', 'lic-lis', 'Regional Demo Night');
  await approve(db, 'pp-1');
  const { body, by } = await gradeOf(db, SUPER);
  assert.equal(body.grants.viewer, 'super_admin');
  assert.deepEqual(by.perks, { state: 'granted_to', granted_count: 2 });
  assert.deepEqual(by.learning, { state: 'granted_to', granted_count: 0 }, 'paused is not granted');
  assert.deepEqual(by['product-testing'], { state: 'hq_only', granted_count: null });
  assert.deepEqual(by['ai-native-venture'], { state: 'hq_only', granted_count: null });
  assert.deepEqual(by['regional-demo-night'], { state: 'granted_to', granted_count: 0 }, 'a draft is not granted');
  await offer(db, 'perks', false);
  assert.deepEqual((await gradeOf(db, SUPER)).by.perks, { state: 'hq_only', granted_count: null });
});

test('a grant read that fails is unreadable on every row, never a state, and the rest of the catalogue still answers', async () => {
  const db = fresh();
  studio(db);
  db.exec('DROP TABLE hq_escalations');
  const { body, by } = await gradeOf(db, LIS);
  assert.deepEqual(body.grants, { available: false, unreadable: true, reason: GRANTS_UNREADABLE });
  assert.equal(body.nothing_granted, null);
  for (const k of PROGRAM_KEYS) assert.deepEqual(by[k], { available: false, unreadable: true, reason: GRANTS_UNREADABLE }, k);
  assert.equal(body.programs.available, true);
  assert.equal((await call(db, LIS, 'GET', '/api/admin/programs/perks')).body.grant.unreadable, true);
});

test('on a branch the state is the copy HQ pushed and the branch’s own open requests; no copy is unreadable, never Not granted', async () => {
  const db = fresh();
  const env = { DB: d1Over(db), BRANCH_CODE: 'lis' } as any;
  db.exec("INSERT INTO branch_licence (id, licence_uid, licence_ref, brand_name, status, renewal_at, pushed_at) VALUES (1, 'lic-lis', 'PT-001', 'Studio Lisbon', 'active', '2027-10-31', '2026-10-24T00:00:00Z')");
  const none = await grantStates(env, { mode: 'branch' }, ['perks'], TODAY);
  assert.deepEqual(none, { available: false, unreadable: true, reason: NO_COPY_REASON });
  grantRow(db, 1, 'perks', 'granted');
  grantRow(db, 1, 'learning', 'paused');
  const copy = await programCopy({ DB: d1Over(db) } as any, 1);
  db.prepare('UPDATE branch_licence SET program_grants_json = ? WHERE id = 1').run(JSON.stringify({ ...copy, offered: { ...copy.offered, 'mentor-cohorts': false } }));
  db.prepare(`INSERT INTO branch_escalations (hq_uid, kind, subject, detail, status, created_at, updated_at)
    VALUES ('h1', 'program_grant', 'Program request', ?, 'open', '2026-10-22 08:00:00', '2026-10-22 08:00:00'),
           ('h2', 'program_grant', 'Program request', ?, 'undelivered', '2026-10-22 08:00:00', '2026-10-22 08:00:00')`)
    .run(JSON.stringify({ v: 1, request: { program: 'spinout-lab' } }), JSON.stringify({ v: 1, request: { program: 'refer-and-earn' } }));
  const read = await grantStates(env, { mode: 'branch' }, ['perks', 'learning', 'spinout-lab', 'refer-and-earn', 'mentor-cohorts', 'product-testing'], TODAY);
  assert.equal(read.available, true);
  assert.deepEqual((read as any).states, {
    perks: { state: 'granted', in_force: true },
    learning: { state: 'paused' },
    'spinout-lab': { state: 'requested', since: '2026-10-22 08:00:00' },
    'refer-and-earn': { state: 'not_granted' },
    'mentor-cohorts': { state: 'not_offered' },
    'product-testing': { state: 'runs_at_hq' },
  });
  assert.equal((read as any).nothing_granted, false);
  db.exec("UPDATE branch_licence SET program_grants_json = '{\"grants\": 3}'");
  assert.equal((await grantStates(env, { mode: 'branch' }, ['perks'], TODAY)).available, false);
});
