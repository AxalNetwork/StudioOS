/**
 * D5247 (#5247) — each Security store records its last good read, and the Overview's `sources[]` carry it with the
 * store's own age: Stale past that age, Not recorded with no time, never Stale for a store with no age.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/security_source_freshness_5247.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminSecurity from '../src/routes/admin_security.ts';
import {
  SOURCE_AGES, SECURITY_SOURCES, sourceFreshness,
} from '../src/services/securitySourceFreshness.ts';
import { BACKUP_STALE_AFTER_HOURS, DRILL_STALE_AFTER_DAYS } from '../src/services/backup.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = ['d5247', 'freshness', 'fixture', 'secret'].join('-');
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// ─────────────────────────────────────────────────────── the age rules ──

const NOW = Date.UTC(2026, 10, 10, 12);

test('a store aged from its last read: current inside its age, Stale past it, Not recorded with no read', () => {
  // security_events, 6 h. Mutations checked: `>` → `<`; the age read from another store; a missing time as now.
  assert.equal(SOURCE_AGES.security_events.age_hours, 6);
  const at = (hoursAgo: number) => sourceFreshness({
    source: 'security_events', answered: false, recorded: { last_read_at: iso(NOW - hoursAgo * H), evidence_at: null }, now: NOW,
  });
  assert.equal(at(5).freshness, 'current');
  assert.equal(at(7).freshness, 'stale');
  assert.equal(at(7).last_good_at, iso(NOW - 7 * H), 'the age is shown from the last good read');
  const never = sourceFreshness({ source: 'security_events', answered: false, recorded: null, now: NOW });
  assert.equal(never.freshness, 'not_recorded');
  assert.equal(never.last_read_at, null, 'no time is invented for a store never read');
  assert.equal(never.last_good_at, null);
  const now = sourceFreshness({ source: 'security_events', answered: true, recorded: { last_read_at: iso(NOW - 70 * H), evidence_at: null }, now: NOW });
  assert.equal(now.freshness, 'current', 'a read that answered is this moment\'s read');
  assert.equal(now.last_read_at, iso(NOW));
});

test('a store aged from its own evidence: the backup heartbeat is Stale past 26 h even when the read answered', () => {
  // backup_d1, the owner's ~26 h. Mutations checked: the age measured from the read rather than the evidence.
  assert.equal(SOURCE_AGES.backup_d1.age_hours, 26);
  assert.equal(SOURCE_AGES.backup_d1.age_hours, BACKUP_STALE_AFTER_HOURS, 'one age with services/backup.ts');
  const hb = (hoursAgo: number) => sourceFreshness({ source: 'backup_d1', answered: true, evidence_at: iso(NOW - hoursAgo * H), now: NOW });
  assert.equal(hb(25).freshness, 'current');
  assert.equal(hb(27).freshness, 'stale', 'a successful read of an old heartbeat is not a recent backup');
  assert.equal(hb(27).last_good_at, iso(NOW - 27 * H));
  // An unreadable bucket still says how old the last good evidence was.
  const down = sourceFreshness({
    source: 'backup_d1', answered: false, recorded: { last_read_at: iso(NOW - H), evidence_at: iso(NOW - 30 * H) }, now: NOW,
  });
  assert.equal(down.freshness, 'stale');
  assert.equal(down.evidence_at, iso(NOW - 30 * H));
  const neverWritten = sourceFreshness({ source: 'backup_d1', answered: true, evidence_at: null, recorded: null, now: NOW });
  assert.equal(neverWritten.freshness, 'not_recorded', 'a bucket that answered with no heartbeat has no evidence time');
});

test('the restore drill is aged by its own window from its marker', () => {
  assert.equal(SOURCE_AGES.restore_drill.age_hours, DRILL_STALE_AFTER_DAYS * 24);
  const d = (days: number) => sourceFreshness({ source: 'restore_drill', answered: true, evidence_at: iso(NOW - days * 24 * H), now: NOW });
  assert.equal(d(DRILL_STALE_AFTER_DAYS - 1).freshness, 'current');
  assert.equal(d(DRILL_STALE_AFTER_DAYS + 1).freshness, 'stale');
});

test('sanctions screenings have no age and are never Stale, however old the last read', () => {
  // Mutation checked: sanctions given an age.
  assert.equal(SOURCE_AGES.sanctions_screenings.age_hours, null);
  const old = sourceFreshness({
    source: 'sanctions_screenings', answered: false, recorded: { last_read_at: iso(NOW - 400 * 24 * H), evidence_at: null }, now: NOW,
  });
  assert.equal(old.freshness, 'no_age');
  assert.equal(old.last_read_at, iso(NOW - 400 * 24 * H), 'the time is still reported');
  assert.equal(sourceFreshness({ source: 'sanctions_screenings', answered: false, recorded: null, now: NOW }).freshness, 'no_age');
});

test('every store has an age rule with its reason, in key order, and only sanctions has none', () => {
  assert.deepEqual([...SECURITY_SOURCES], [...SECURITY_SOURCES].sort(), 'SOURCE_AGES is kept in key order (D4134)');
  for (const s of SECURITY_SOURCES) assert.ok(SOURCE_AGES[s].basis.length > 20, `${s} says where its age comes from`);
  assert.deepEqual(SECURITY_SOURCES.filter((s) => SOURCE_AGES[s].age_hours === null), ['sanctions_screenings']);
});

// ─────────────────────────────────────────────────────────── the routes ──

function harness(objects: Record<string, unknown> | 'down' = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active, tfa_methods) VALUES (1, 'admin', 'Sue', 'sue@example.test', 1, '[\"totp\"]')").run();
  db.prepare('INSERT INTO super_admins (user_id) VALUES (1)').run();
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (1, 's-1', 'totp', 'totp', ?)").run(sqlNow());
  const BACKUPS = {
    async get(k: string) {
      if (objects === 'down') throw new Error('r2 down');
      if (!(k in objects)) return null;
      const v = objects[k];
      return { async json() { return v; } };
    },
  };
  const app = new Hono<any>();
  app.route('/api/admin/security', adminSecurity);
  const env = { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.example.test', DB: d1Over(db), BACKUPS };
  async function get(path: string) {
    const token = await new SignJWT({ user_id: 1, jti: 's-1' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, env));
      return { status: res.status, body: await res.json().catch(() => null) as any };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  const recorded = (source: string) => db.prepare('SELECT last_read_at, evidence_at FROM security_source_reads WHERE source = ?').get(source) as any;
  return { db, get, recorded };
}

const heartbeat = (hoursAgo: number) => {
  const t = Date.now() - hoursAgo * H;
  return { schema_version: 1, at: iso(t), source: 'gha', kind: 'd1', key: 'd1/studioos-db/backup.sql', size_bytes: 4096 };
};
const bySource = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.source ?? r.table, r]));

test('/overview returns each store with its read time and age, and records the good reads', async () => {
  // Mutations checked: recording a failed read; `sources` dropped from the reply.
  const { get, recorded } = harness({ 'heartbeat-d1.json': heartbeat(30) });
  const ov = await get('/api/admin/security/overview');
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  const s = bySource(ov.body.sources);
  assert.deepEqual(Object.keys(s).sort(), [
    'admin_audit_log', 'backup_d1', 'backup_kv', 'impersonation_sessions', 'restore_drill', 'sanctions_screenings', 'security_events',
  ]);
  assert.equal(s.admin_audit_log.answered, true);
  assert.equal(s.admin_audit_log.freshness, 'current');
  assert.equal(s.admin_audit_log.age_hours, 24);
  assert.ok(Date.parse(s.admin_audit_log.last_read_at) > Date.now() - 60_000);
  assert.equal(s.backup_d1.freshness, 'stale', 'a 30-hour-old heartbeat is past 26 h');
  assert.equal(s.backup_d1.age_hours, 26);
  assert.equal(s.backup_kv.freshness, 'not_recorded', 'no KV heartbeat was ever written');
  assert.equal(s.sanctions_screenings.freshness, 'no_age');
  assert.ok(recorded('admin_audit_log')?.last_read_at, 'the good read is recorded');
  assert.ok(s.backup_d1.evidence_at, 'the heartbeat\'s recovery point is the evidence time');
  assert.equal(recorded('backup_d1')?.evidence_at, s.backup_d1.evidence_at, 'the heartbeat stamp is kept with the read');
});

test('a store that fails keeps its last good read, and turns Stale only once that read is past its age', async () => {
  // Mutations checked: a failed read moving last_read_at; a failed read shown as current.
  const { db, get, recorded } = harness();
  const eightHoursAgo = iso(Date.now() - 8 * H);
  const oneHourAgo = iso(Date.now() - H);
  db.prepare('INSERT INTO security_source_reads (source, last_read_at) VALUES (?, ?)').run('security_events', oneHourAgo);
  db.exec('DROP TABLE security_events');
  let s = bySource((await get('/api/admin/security/overview')).body.sources);
  assert.equal(s.security_events.answered, false);
  assert.equal(s.security_events.last_read_at, oneHourAgo, 'a failed read never moves the last good read');
  assert.equal(s.security_events.freshness, 'current');
  assert.equal(recorded('security_events').last_read_at, oneHourAgo);
  db.prepare('UPDATE security_source_reads SET last_read_at = ? WHERE source = ?').run(eightHoursAgo, 'security_events');
  s = bySource((await get('/api/admin/security/overview')).body.sources);
  assert.equal(s.security_events.freshness, 'stale', 'past 6 h with no good read since');
  assert.equal(s.security_events.last_good_at, eightHoursAgo);
});

test('an unreadable bucket keeps the heartbeat\'s last good evidence, and no record is Not recorded', async () => {
  const { db, get } = harness('down');
  db.prepare('INSERT INTO security_source_reads (source, last_read_at, evidence_at) VALUES (?, ?, ?)')
    .run('backup_d1', iso(Date.now() - 2 * H), iso(Date.now() - 20 * H));
  const s = bySource((await get('/api/admin/security/overview')).body.sources);
  assert.equal(s.backup_d1.answered, false);
  assert.equal(s.backup_d1.freshness, 'current', '20 h of evidence is inside 26 h');
  assert.equal(s.backup_kv.answered, false);
  assert.equal(s.backup_kv.freshness, 'not_recorded');
  assert.equal(s.backup_kv.last_good_at, null);
});

test('/governance\'s ledger sources carry the same fields, licence events aged a week', async () => {
  const { db, get } = harness();
  db.prepare('INSERT INTO security_source_reads (source, last_read_at) VALUES (?, ?)').run('licence_events', iso(Date.now() - 8 * 24 * H));
  db.exec('DROP TABLE licence_events');
  const g = await get('/api/admin/security/governance');
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const s = bySource(g.body.sources);
  assert.equal(s.licence_events.available, false);
  assert.equal(s.licence_events.age_hours, 24 * 7);
  assert.equal(s.licence_events.freshness, 'stale');
  assert.equal(s.admin_audit_log.available, true);
  assert.equal(s.admin_audit_log.freshness, 'current');
  assert.equal(s.admin_audit_log.table, 'admin_audit_log', 'the ledger row keeps its own key');
  assert.equal('source' in s.admin_audit_log, false);
});

test('an unreadable record table costs the times, never the page', async () => {
  const { db, get } = harness();
  db.exec('DROP TABLE security_source_reads');
  const ov = await get('/api/admin/security/overview');
  assert.equal(ov.status, 200);
  const s = bySource(ov.body.sources);
  assert.equal(s.admin_audit_log.freshness, 'current', 'this read answered');
  assert.equal(s.backup_d1.freshness, 'not_recorded');
});

test('a heartbeat that is no longer valid evidence keeps the last valid one\'s time, and is aged from it', async () => {
  // Mutation checked: the recorded evidence overwritten with NULL by a read that found none.
  const { db, get, recorded } = harness({ 'heartbeat-d1.json': { kind: 'd1' } });
  const valid = iso(Date.now() - 30 * H);
  db.prepare('INSERT INTO security_source_reads (source, last_read_at, evidence_at) VALUES (?, ?, ?)').run('backup_d1', iso(Date.now() - 40 * H), valid);
  const s = bySource((await get('/api/admin/security/overview')).body.sources);
  assert.equal(s.backup_d1.answered, true, 'the bucket answered');
  assert.equal(s.backup_d1.evidence_at, valid);
  assert.equal(s.backup_d1.freshness, 'stale');
  assert.equal(recorded('backup_d1').evidence_at, valid, 'an invalid heartbeat does not erase the last valid one');
  assert.ok(Date.parse(recorded('backup_d1').last_read_at) > Date.now() - 60_000, 'the read itself is recorded');
});
