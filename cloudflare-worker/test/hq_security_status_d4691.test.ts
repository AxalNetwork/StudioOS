/**
 * D4691 (#4691) — HQ · Security: one identity shape, one set of session
 * statuses, partial reads that say "unreadable", and backup/restore evidence
 * that is validated and dated before it is believed.
 *
 * The SQL the routes run is run here, against a real SQLite database, and its
 * answers are compared with the shared status functions row by row — so a
 * count, a list and a tile cannot use two different definitions without this
 * file failing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import security from '../src/routes/admin_security.ts';
import { requireFactor } from '../src/auth.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  listActiveSessions, countActiveSessions, listLiveImpersonations, countSupportSessions,
} from '../src/services/userSessions.ts';
import {
  userSessionStatus, supportSessionStatus, parseStoredTs, BRANCH_SUPPORT_MINUTES, SESSION_STATUS_DEFINITIONS,
} from '../src/services/sessionStatus.ts';
import { SUPPORT_SESSION_MINUTES } from '../src/rpc/branchOps.ts';
import {
  networkOf, securityEventIdentity, supportIdentity, userIdentity,
} from '../src/services/securityIdentity.ts';
import { ipPrefix, recordSecurityEvent } from '../src/services/securityEvents.ts';
import {
  readBackupHeartbeat, readRestoreDrill, validateHeartbeat, validateDrillMarker,
  BACKUP_STALE_AFTER_HOURS, DRILL_STALE_AFTER_DAYS, EVIDENCE_SCHEMA_VERSION,
} from '../src/services/backup.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 701;
const HOLDER = 702;
const FLOORED = 703;
const OTHER = 704;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const LEDGER = read('cloudflare-worker/sql/migrations/282_security_events.sql')
  + read('cloudflare-worker/sql/migrations/202611072219_security_events_support_actor.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

const TABLES = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'impersonation_sessions'];

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of TABLES) db.exec(ddl(t));
  db.exec(LEDGER);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, jwt_min_iat) VALUES (?, ?, ?, ?, 1, ?)');
  u.run(SUPER, 'admin', 'Sam Super', 'super@axal.example', null);
  u.run(HOLDER, 'founder', 'Hana Holder', 'hana@example.com', null);
  // Signed out everywhere an hour ago: every session minted before then is below the floor.
  u.run(FLOORED, 'founder', 'Flo Floored', 'flo@example.com', Math.floor(Date.now() / 1000) - 3600);
  u.run(OTHER, 'founder', 'Olu Other', 'olu@example.com', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES ('jti-super', ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(SUPER);
  return db;
}

/** A grid of account sessions covering every status and the boundaries between them. */
function seedSessionGrid(db: any) {
  const s = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, ip, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, datetime('now', ?), datetime('now'), ?)`,
  );
  s.run('g-active', HOLDER, 'password', '203.0.113.77', '-2 hours', null);
  s.run('g-expired', HOLDER, 'password', '203.0.113.78', '-25 hours', null);
  s.run('g-revoked', HOLDER, 'password', '203.0.113.79', '-1 hours', '2026-01-01 00:00:00');
  s.run('g-floor-before', FLOORED, 'totp', '198.51.100.9', '-2 hours', null);
  s.run('g-floor-after', FLOORED, 'totp', '198.51.100.10', '-10 minutes', null);
  // A branch support token lives thirty minutes, not a day.
  s.run('g-support-live', OTHER, 'hq_support', '2001:db8:abcd:12::1', '-10 minutes', null);
  s.run('g-support-expired', OTHER, 'hq_support', '2001:db8:abcd:12::2', '-2 hours', null);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('g-unstamped', ?, 'password', 'not a time')`).run(OTHER);
}

/** Support sessions: HQ (ceiling applies) and branch (admin_user_id = 0, thirty minutes). */
function seedSupportGrid(db: any) {
  const i = db.prepare(
    `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at)
     VALUES (?, ?, ?, datetime('now', ?), ?)`,
  );
  i.run(SUPER, HOLDER, 'fresh hq', '-10 minutes', null);
  i.run(SUPER, HOLDER, 'extended hq', '-50 minutes', null); // past the first token, inside the ceiling
  i.run(SUPER, OTHER, 'abandoned hq', '-5 hours', null);
  i.run(SUPER, OTHER, 'closed hq', '-3 hours', '2026-01-01 00:00:00');
  i.run(0, OTHER, 'branch live', '-5 minutes', null);
  i.run(0, OTHER, 'branch past', '-50 minutes', null);
}

const envFor = (db: any, DB?: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: DB ?? d1Over(db) }) as any;

/** A D1 whose statements matching `pattern` fail, and every other statement runs. */
function failing(db: any, pattern: RegExp) {
  const inner = d1Over(db) as any;
  const boom = () => { throw new Error('simulated read failure'); };
  return {
    ...inner,
    prepare(sql: string) {
      if (!pattern.test(sql)) return inner.prepare(sql);
      const stmt = { bind: () => stmt, first: async () => boom(), all: async () => boom(), run: async () => boom() };
      return stmt;
    },
  };
}

async function jwtFor(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function app() {
  const a = new Hono();
  a.route('/', security);
  a.onError((err: any, c) => {
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[String(err?.message ?? '')];
    if (mapped) return c.json({ detail: err.message }, mapped as 401 | 403);
    return c.json({ detail: 'Internal server error', msg: String(err?.message) }, 500);
  });
  return a;
}

async function get(db: any, path: string, DB?: any) {
  const token = await jwtFor({ user_id: SUPER, role: 'admin', jti: 'jti-super' });
  const res = await app().fetch(new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${token}` } }), envFor(db, DB));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const sessionId = (db: any, jti: string) => Number((db.prepare('SELECT id FROM user_sessions WHERE jti = ?').get(jti) as any).id);

// ───────────────────────────────────────────── status consistency ──

test('account sessions: the list, its total and the shared predicate agree on every row of the grid', async () => {
  const db = freshDb();
  seedSessionGrid(db);
  const all = db.prepare(
    `SELECT s.*, u.jwt_min_iat FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id`,
  ).all() as any[];
  const now = Date.now();
  const expected = all.filter((r) => userSessionStatus(r, now) === 'active').map((r) => Number(r.id)).sort();
  const list = await listActiveSessions(envFor(db), null);
  assert.deepEqual(list.rows.map((r) => r.id).sort(), expected, 'the SQL list and the shared predicate disagree');
  assert.equal(await countActiveSessions(envFor(db)), expected.length, 'the count and the list disagree');
  assert.equal(list.total, expected.length);
  for (const r of list.rows) assert.equal(r.status, 'active');

  const statusOf = (jti: string) => userSessionStatus(all.find((r) => r.jti === jti), now);
  assert.equal(statusOf('g-active'), 'active');
  assert.equal(statusOf('g-expired'), 'expired');
  assert.equal(statusOf('g-revoked'), 'revoked');
  assert.equal(statusOf('g-floor-before'), 'signed_out');
  assert.equal(statusOf('g-floor-after'), 'active');
  assert.equal(statusOf('g-support-live'), 'active');
  assert.equal(statusOf('g-support-expired'), 'expired', 'a branch support token outlived its thirty minutes');
  assert.equal(statusOf('g-unstamped'), 'unknown');
  assert.ok(!expected.includes(sessionId(db, 'g-support-expired')), 'an expired support token was listed as active');
});

test('support sessions: the overview count, the Sessions list, the feed and Data access use one rule', async () => {
  const db = freshDb();
  seedSupportGrid(db);
  const env = envFor(db);
  const rows = db.prepare('SELECT * FROM impersonation_sessions ORDER BY id').all() as any[];
  const now = Date.now();
  const byStatus = (st: string) => rows.filter((r) => supportSessionStatus(r, now) === st).map((r) => r.context).sort();
  assert.deepEqual(byStatus('live'), ['branch live', 'extended hq', 'fresh hq']);
  assert.deepEqual(byStatus('not_closed'), ['abandoned hq', 'branch past']);
  assert.deepEqual(byStatus('ended'), ['closed hq']);

  const live = await listLiveImpersonations(env);
  assert.deepEqual(live.map((r) => r.context).sort(), byStatus('live'));
  assert.deepEqual(await countSupportSessions(env), { open: 5, live: 3, not_closed: 2 });

  const overview = await get(db, '/overview');
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.impersonations.active, 3, 'the tile counted open records, not live sessions');
  assert.equal(overview.body.impersonations.not_closed, 2);
  const sessions = await get(db, '/sessions');
  assert.equal(sessions.body.impersonations.rows.length, overview.body.impersonations.active,
    'the tile and the list it sits above disagree');
  assert.deepEqual(sessions.body.definitions, SESSION_STATUS_DEFINITIONS);

  const feed = await get(db, '/governance?filter=impersonations');
  const outcome = Object.fromEntries(feed.body.rows.map((r: any) => [r.target.split(' · ')[1]?.replace(/"/g, ''), r.outcome]));
  assert.equal(outcome['extended hq'], 'live', 'an HQ session inside its ceiling read as not closed');
  assert.equal(outcome['abandoned hq'], 'not closed');
  assert.equal(outcome['branch past'], 'not closed', 'a branch session past its thirty minutes read as live');
  const access = feed.body.data_access.impersonations.items;
  assert.equal(access.filter((d: any) => d.live).length, 3);
  assert.equal(access.filter((d: any) => d.overdue).length, 2);
});

test('the branch support lifetime is the one branchOps mints with', () => {
  assert.equal(BRANCH_SUPPORT_MINUTES, SUPPORT_SESSION_MINUTES);
});

test('parseStoredTs reads SQLite and ISO stamps as UTC, and nothing else', () => {
  assert.equal(parseStoredTs('2026-11-07 10:00:00'), Date.UTC(2026, 10, 7, 10));
  assert.equal(parseStoredTs('2026-11-07T10:00:00Z'), Date.UTC(2026, 10, 7, 10));
  assert.equal(parseStoredTs('2026-11-07T10:00:00'), Date.UTC(2026, 10, 7, 10), 'a zoneless ISO stamp is UTC, as in SQLite');
  assert.ok(Number.isNaN(parseStoredTs('yesterday')));
  assert.ok(Number.isNaN(parseStoredTs(null)));
});

// ───────────────────────────────────────────── identity separation ──

test('networks: compressed, mapped and malformed addresses bucket by one rule; a stored bucket is checked', () => {
  assert.equal(ipPrefix('2001:db8::1'), '2001:db8:0::/48');
  assert.equal(ipPrefix('2001:0DB8:0000:0001::5'), '2001:db8:0::/48');
  assert.equal(ipPrefix('::1'), '0:0:0::/48');
  assert.equal(ipPrefix('::ffff:203.0.113.9'), '203.0.113.0/24');
  assert.equal(ipPrefix('2001:db8:abcd:12::1'), '2001:db8:abcd::/48');
  assert.equal(ipPrefix('1:2:3'), 'unknown');
  assert.equal(ipPrefix('999.1.1.1'), 'unknown');
  assert.equal(ipPrefix('a.b.c.d'), 'unknown');
  assert.equal(networkOf('203.0.113.0/24'), '203.0.113.0/24');
  assert.equal(networkOf('203.0.113.7'), 'unknown', 'an address passed through as if it were a bucket');
  assert.equal(networkOf('2001:db8:::/48'), 'unknown');
});

test('the Sessions list names a network bucket, never an address, and a branch support token as support', async () => {
  const db = freshDb();
  seedSessionGrid(db);
  const r = await get(db, '/sessions');
  assert.equal(r.status, 200);
  const wire = JSON.stringify(r.body);
  for (const ip of ['203.0.113.77', '2001:db8:abcd:12::1']) assert.ok(!wire.includes(ip), `the address ${ip} went out on the wire`);
  const active = r.body.rows.find((x: any) => x.id === sessionId(db, 'g-active'));
  assert.equal(active.network, '203.0.113.0/24');
  assert.deepEqual([active.holder.kind, active.holder.user_id], ['user', HOLDER]);
  const support = r.body.rows.find((x: any) => x.id === sessionId(db, 'g-support-live'));
  assert.equal(support.network, '2001:db8:abcd::/48');
  assert.equal(support.holder.kind, 'support', 'a branch support token read as the account holder');
  assert.equal(support.holder.on_behalf_of.user_id, OTHER);
});

test('security events: a refused attempt is its network, a gate refusal is its caller, a support caller is the operator', () => {
  const refused = securityEventIdentity({
    kind: 'signin', outcome: 'refused', user_id: HOLDER, subject_name: 'Hana Holder', ip_prefix: '198.51.100.0/24',
  });
  assert.equal(refused.actor.kind, 'network', 'the account a refused attempt named was shown as its actor');
  assert.equal(refused.actor.network, '198.51.100.0/24');
  assert.equal(refused.subject?.user_id, HOLDER);

  const gate = securityEventIdentity({ kind: 'gate', user_id: HOLDER, subject_name: 'Hana Holder', ip_prefix: 'x' });
  assert.deepEqual([gate.actor.kind, gate.actor.user_id, gate.actor.network], ['user', HOLDER, 'unknown']);

  const viaSupport = securityEventIdentity({
    kind: 'gate', user_id: HOLDER, subject_name: 'Hana Holder', support_user_id: SUPER, support_name: 'Sam Super',
  });
  assert.deepEqual([viaSupport.actor.kind, viaSupport.actor.user_id, viaSupport.actor.on_behalf_of?.user_id], ['support', SUPER, HOLDER]);

  const branchSupport = securityEventIdentity({ kind: 'step_up', user_id: HOLDER, subject_name: 'Hana Holder', support_user_id: 0 });
  assert.deepEqual([branchSupport.actor.kind, branchSupport.actor.user_id], ['support', null]);

  assert.equal(userIdentity(null).kind, 'system', 'an act with no account read as a person');
  assert.equal(supportIdentity({ id: 0 }, { id: HOLDER }).label, 'HQ support operator');
});

test('a gate refusal inside a support session is recorded as the operator\'s, and does not fold into the holder\'s own', async () => {
  const db = freshDb();
  const env = envFor(db);
  const gated = new Hono();
  gated.get('/x', async (c) => { await requireFactor(c as any, 'totp'); return c.json({ ok: true }); });
  gated.onError((_e, c) => c.json({ detail: 'refused' }, 403));
  // The support token: the operator's id rides in `impersonated_by`, with no session row of its own.
  const support = await jwtFor({ user_id: HOLDER, role: 'founder', impersonated_by: SUPER });
  const res = await gated.fetch(new Request('http://x/x', { headers: { Authorization: `Bearer ${support}`, 'cf-connecting-ip': '203.0.113.5' } }), env);
  assert.equal(res.status, 403);
  // The holder's own refusal in the same minute, from the same network.
  await recordSecurityEvent(env, { kind: 'gate', factor: 'totp', outcome: 'refused', detail: 'factor_required', userId: HOLDER, email: 'hana@example.com', ip: '203.0.113.5' });
  const rows = db.prepare('SELECT user_id, support_user_id, subject_key FROM security_events ORDER BY id').all() as any[];
  assert.equal(rows.length, 2, 'the operator\'s refusal and the holder\'s were folded into one row');
  assert.deepEqual([rows[0].user_id, rows[0].support_user_id], [HOLDER, SUPER]);
  assert.equal(rows[1].support_user_id, null);
  assert.notEqual(rows[0].subject_key, rows[1].subject_key);

  const feed = await get(db, '/governance?filter=auth');
  const kinds = feed.body.rows.map((r: any) => r.actor_identity.kind).sort();
  assert.deepEqual(kinds, ['support', 'user']);
  const sup = feed.body.rows.find((r: any) => r.actor_identity.kind === 'support');
  assert.equal(sup.actor, 'Sam Super');
  assert.match(sup.target, /on behalf of Hana Holder/);
});

test('the feed names an act with no account as the platform, never a blank', async () => {
  const db = freshDb();
  db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, exported_at) VALUES (0, 'scheduled_sweep', datetime('now'))`).run();
  const feed = await get(db, '/governance?filter=all');
  const row = feed.body.rows.find((r: any) => r.action === 'scheduled_sweep');
  assert.deepEqual([row.actor_identity.kind, row.actor], ['system', 'System']);
});

// ───────────────────────────────────────────────────── partial reads ──

test('/overview: each failed read is its own unreadable state, and the rest of the page still answers', async () => {
  const cases: Array<[RegExp, (b: any) => void]> = [
    [/COUNT\(\*\) AS n FROM admin_audit_log/, (b) => assert.equal(b.audit.available, false)],
    [/GROUP BY kyc_status/, (b) => { assert.equal(b.kyc_available, false); assert.equal(b.kyc, null); }],
    [/AS with_mfa/, (b) => assert.equal(b.mfa.available, false)],
    [/WHERE deletion_requested_at IS NOT NULL/, (b) => {
      assert.equal(b.dsr.available, false);
      assert.deepEqual(b.dsr.by_branch, [], 'an unreadable list was grouped as "0 open"');
    }],
  ];
  for (const [pattern, check] of cases) {
    const db = freshDb();
    const r = await get(db, '/overview', failing(db, pattern));
    assert.equal(r.status, 200, `one failed read (${pattern}) cost the whole page: ${JSON.stringify(r.body)}`);
    check(r.body);
    assert.equal(r.body.sessions.available, true, 'an unrelated tile went down with it');
  }
  const ok = await get(freshDb(), '/overview');
  assert.deepEqual([ok.body.audit.available, ok.body.mfa.available, ok.body.kyc_available, ok.body.dsr.available], [true, true, true, true]);
});

test('AI safety: a failed rule breakdown is unreadable beside readable totals, never an empty list', async () => {
  const db = freshDb();
  db.exec('CREATE TABLE advisor_turn_audit (id INTEGER PRIMARY KEY, refusal_reason TEXT, shadow_flagged INTEGER, guardrail_category TEXT, created_at TEXT)');
  const r = await get(db, '/overview', failing(db, /GROUP BY COALESCE\(guardrail_category/));
  const e = r.body.ai_safety.enforcement;
  assert.equal(e.available, true, 'the totals were readable');
  assert.equal(e.breakdown_available, false);
  assert.deepEqual([e.rules, e.states, e.unclassified], [null, null, null], 'an unread breakdown came back as "no rule fired"');
  const ok = await get(db, '/overview');
  assert.equal(ok.body.ai_safety.enforcement.breakdown_available, true);
  assert.deepEqual(ok.body.ai_safety.enforcement.rules, []);
});

// ─────────────────────────────────────────────────────────── evidence ──

const NOW = Date.UTC(2026, 10, 7, 12);
const HB = {
  schema_version: 1, at: '2026-11-07T02:25:00Z', source: 'gha', kind: 'd1',
  key: 'd1/studioos-db/backup-2026-11-07.sql', size_bytes: 4096,
  sha256: 'a'.repeat(64), exported_at: '2026-11-07T02:11:00Z',
};
const DRILL = {
  schema_version: 1, at: '2026-11-01T06:03:10Z', outcome: 'passed', duration_s: 41, source: 'gha', step: 'teardown',
  exit_code: 0, backup_key: 'd1/studioos-db/backup-2026-10-31.sql', run_id: '9', rpo_met: true, rto_met: true,
};
const bucket = (objects: Record<string, unknown>) => ({
  async get(k: string) {
    if (!(k in objects)) return null;
    const v = objects[k];
    return { async json() { if (typeof v === 'string') return JSON.parse(v); return v; } };
  },
});

test('backup heartbeat: a valid, recent heartbeat is fresh; past its window it is stale, never healthy', async () => {
  const fresh = await readBackupHeartbeat({ BACKUPS: bucket({ 'heartbeat-d1.json': HB }) } as any, 'd1', NOW) as any;
  assert.deepEqual([fresh.available, fresh.state, fresh.fresh, fresh.versioned, fresh.recovery_point], [true, 'fresh', true, true, HB.exported_at]);
  const later = NOW + (BACKUP_STALE_AFTER_HOURS + 1) * 3_600_000;
  const stale = await readBackupHeartbeat({ BACKUPS: bucket({ 'heartbeat-d1.json': HB }) } as any, 'd1', later) as any;
  assert.deepEqual([stale.available, stale.state, stale.fresh], [true, 'stale', false]);
  // Measured from the export's start, not from when the heartbeat landed.
  const edge = Date.parse(HB.exported_at) + BACKUP_STALE_AFTER_HOURS * 3_600_000 + 60_000;
  assert.equal(((await readBackupHeartbeat({ BACKUPS: bucket({ 'heartbeat-d1.json': HB }) } as any, 'd1', edge)) as any).fresh, false);
  const legacy = { ...HB } as Record<string, unknown>;
  delete legacy.schema_version;
  const unversioned = validateHeartbeat(legacy, 'd1', NOW);
  assert.ok(unversioned.ok && unversioned.value.versioned === false, 'a pre-version heartbeat is read as schema 1');
});

test('backup heartbeat: malformed evidence is invalid, each for its own reason', async () => {
  const bads: Array<[string, unknown]> = [
    ['empty object', {}],
    ['unknown version', { ...HB, schema_version: 2 }],
    ['wrong kind', { ...HB, kind: 'kv' }],
    ['no time', { ...HB, at: undefined }],
    ['zoneless time', { ...HB, at: '2026-11-07 02:25:00' }],
    ['future time', { ...HB, at: '2026-11-08T02:25:00Z' }],
    ['no object key', { ...HB, key: '' }],
    ['non-D1 key', { ...HB, key: 'kv/TOKENS/x.jsonl' }],
    ['zero size', { ...HB, size_bytes: 0 }],
    ['size as text', { ...HB, size_bytes: '4096' }],
    ['bad digest', { ...HB, sha256: 'xyz' }],
    ['export after heartbeat', { ...HB, exported_at: '2026-11-07T03:30:00Z' }],
    ['array', [HB]],
  ];
  for (const [what, body] of bads) {
    const r = await readBackupHeartbeat({ BACKUPS: bucket({ 'heartbeat-d1.json': body }) } as any, 'd1', NOW) as any;
    assert.deepEqual([r.available, r.state], [false, 'invalid'], `${what} read as a recorded backup`);
  }
  const notJson = await readBackupHeartbeat({ BACKUPS: bucket({ 'heartbeat-d1.json': '{oops' }) } as any, 'd1', NOW) as any;
  assert.equal(notJson.state, 'invalid');
  const none = await readBackupHeartbeat({ BACKUPS: bucket({}) } as any, 'd1', NOW) as any;
  assert.equal(none.state, 'never_written');
  const unbound = await readBackupHeartbeat({} as any, 'd1', NOW) as any;
  assert.equal(unbound.state, 'unreadable');
});

test('restore drill: a recent pass is fresh; an old pass is stale; missed targets are carried', async () => {
  const fresh = await readRestoreDrill({ BACKUPS: bucket({ 'drill-d1.json': DRILL }) } as any, NOW) as any;
  assert.deepEqual([fresh.state, fresh.fresh, fresh.rpo_met], ['last_run_passed', true, true]);
  const later = Date.parse(DRILL.at) + (DRILL_STALE_AFTER_DAYS + 1) * 86_400_000;
  const stale = await readRestoreDrill({ BACKUPS: bucket({ 'drill-d1.json': DRILL }) } as any, later) as any;
  assert.deepEqual([stale.state, stale.fresh], ['last_run_passed', false], 'an old pass vouched for recovery today');
  const missed = await readRestoreDrill({ BACKUPS: bucket({ 'drill-d1.json': { ...DRILL, rpo_met: false } }) } as any, NOW) as any;
  assert.equal(missed.rpo_met, false);
});

test('restore drill: malformed or contradictory markers are invalid, never a pass', () => {
  const bads: Array<[string, unknown]> = [
    ['unknown version', { ...DRILL, schema_version: 3 }],
    ['passed with a failing exit', { ...DRILL, exit_code: 2 }],
    ['failed with exit 0', { ...DRILL, outcome: 'failed' }],
    ['exit as text', { ...DRILL, exit_code: '0' }],
    ['passed naming no backup', { ...DRILL, backup_key: null }],
    ['no time', { ...DRILL, at: null }],
    ['future time', { ...DRILL, at: '2027-01-01T00:00:00Z' }],
    ['target as text', { ...DRILL, rpo_met: 'yes' }],
    ['negative duration', { ...DRILL, duration_s: -1 }],
  ];
  for (const [what, body] of bads) {
    assert.equal(validateDrillMarker(body, NOW).ok, false, `${what} was accepted as a drill marker`);
  }
  assert.equal(validateDrillMarker({ ...DRILL, outcome: 'failed', exit_code: 2, backup_key: null }, NOW).ok, true);
});

test('the writers stamp the schema version the reader knows', () => {
  assert.equal(EVIDENCE_SCHEMA_VERSION, 1);
  assert.match(read('.github/workflows/backup-d1.yml'), /"schema_version": 1,/);
  assert.match(read('scripts/dr-drill.sh'), /'\{schema_version: 1, at: \$at,/);
  assert.match(read('cloudflare-worker/src/services/backup.ts'), /schema_version: EVIDENCE_SCHEMA_VERSION,\n\s+at: new Date\(\)\.toISOString\(\)/);
});
