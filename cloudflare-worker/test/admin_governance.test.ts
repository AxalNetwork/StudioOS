/**
 * `GET /api/admin/security/governance` — canvas H7's privileged-action feed.
 *
 * WHAT THIS FILE IS REALLY GUARDING. H7 draws one feed with a filter bar of
 * five. The zone that shipped from canvas Y2 read `admin_audit_log` alone,
 * and three of those five filters have no rows in that table at all — so the
 * defect this route exists to fix is a log that looks complete and is a
 * quarter of the trail. Two failure modes follow from unioning four stores,
 * and both are asserted here rather than described:
 *
 *   THE SUBJECT-SIDE TWIN. Nearly every admin action writes two rows into
 *   `activity_logs`: one whose `user_id` is the admin who acted, and one
 *   whose `user_id` is the person it happened to. Joining the second as
 *   "actor" names the subject of an action as the person who took it. A
 *   fixture below inserts the twin and the feed must not carry it.
 *
 *   THE MIXED TIMESTAMP. `admin_audit_log.exported_at` holds BOTH
 *   'YYYY-MM-DD HH:MM:SS' (the column default) and full ISO with a 'T'
 *   (routes/admin.ts writes new Date().toISOString()). Those two forms do
 *   not sort against each other lexically, so a merge that sorts on the raw
 *   string interleaves the feed wrongly — silently, and worst for the newest
 *   rows, which are the only ones anyone reads.
 *
 * The DDL is lifted verbatim from `sql/schema_baseline.sql`: a harness that
 * writes its own schema only confirms its own assumptions, and this route
 * joins five tables whose columns it would otherwise be guessing at.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import security from '../src/routes/admin_security.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 701;
const PLAIN_ADMIN = 702;
const VICTIM = 703;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const ALL_TABLES = [
  'users', 'super_admins', 'admin_audit_log', 'activity_logs',
  'impersonation_sessions', 'licence_events', 'territory_licences',
];

function freshDb(tables: string[] = ALL_TABLES) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of tables) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'T. Okafor', 'okafor@example.test');
  u.run(PLAIN_ADMIN, 'admin', 'Plain Admin', 'admin@example.test');
  u.run(VICTIM, 'founder', 'G. Lauzier', 'g@example.test');
  // D35 — Super Admin is an ELEVATION on `admin`, held in a side table.
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const audit = (db: any, action: string, at: string, extra: Record<string, unknown> = {}) =>
  db.prepare(
    `INSERT INTO admin_audit_log (admin_user_id, action, report_type, format, filters_json, viewed_user_id, exported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    SUPER, action, (extra.report_type as string) ?? null, (extra.format as string) ?? null,
    (extra.filters_json as string) ?? null, (extra.viewed_user_id as number) ?? null, at,
  );

const activity = (db: any, action: string, at: string, userId: number, details: string) =>
  db.prepare('INSERT INTO activity_logs (action, details, actor, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(action, details, 'hash', userId, at);

function licence(db: any, ref: string, brand: string) {
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status)
     VALUES (?, ?, ?, ?, 'active')`,
  ).run(`uid-${ref}`, ref, `${ref} SAS`, brand);
  return Number(db.prepare('SELECT id FROM territory_licences WHERE licence_ref = ?').get(ref).id);
}
const licenceEvent = (db: any, licenceId: number, event: string, at: string, note: string | null) =>
  db.prepare(
    'INSERT INTO licence_events (licence_id, event, note, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(licenceId, event, note, SUPER, at);

const impersonation = (db: any, started: string, ended: string | null, context: string | null) =>
  db.prepare(
    'INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
  ).run(SUPER, VICTIM, context, started, ended);

async function call(db: any, actor: number, filter?: string) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const url = `http://x/governance${filter ? `?filter=${filter}` : ''}`;
  const res = await security.fetch(
    new Request(url, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

/** Minutes ago, as SQLite's own 'YYYY-MM-DD HH:MM:SS'. */
const agoSql = (mins: number) =>
  new Date(Date.now() - mins * 60_000).toISOString().slice(0, 19).replace('T', ' ');
/** Minutes ago, as the full ISO routes/admin.ts writes. */
const agoIso = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

test('a plain admin cannot read the governance feed', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(5), { report_type: 'users', format: 'csv' });
  const r = await call(db, PLAIN_ADMIN);
  assert.notEqual(r.status, 200, 'a plain admin read the cross-tenant privileged-action feed');
  assert.equal(r.body.rows, undefined, 'the feed leaked to a plain admin');
});

test('the feed is a union of four stores, not one table', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(50), { report_type: 'users', format: 'csv' });
  activity(db, 'role_changed', agoSql(40), SUPER, 'Admin T. Okafor changed G. Lauzier\'s role');
  impersonation(db, agoSql(30), agoSql(20), 'cap table export failure, ticket #4192');
  const lic = licence(db, 'AXL-004', 'Axal VC Iberia');
  licenceEvent(db, lic, 'suspended', agoSql(10), 'payment default, 41 days, board approved');

  const r = await call(db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sources = new Set(r.body.rows.map((x: any) => x.source));
  assert.deepEqual(
    [...sources].sort(),
    ['activity_logs', 'admin_audit_log', 'impersonation_sessions', 'licence_events'],
    'the feed dropped a store — three of H7\'s five filters live outside admin_audit_log',
  );
  // Newest first, across the stores rather than within each.
  assert.equal(r.body.rows[0].source, 'licence_events');
  assert.equal(r.body.rows[3].source, 'admin_audit_log');
});

test('the subject-side twin is never read as the actor', async () => {
  // `role_changed` names the admin; `your_role_changed` names the person it
  // happened to. Reading the second attributes the action to its victim.
  const db = freshDb();
  activity(db, 'role_changed', agoSql(10), SUPER, 'Admin T. Okafor changed G. Lauzier\'s role from exploring to founder');
  activity(db, 'your_role_changed', agoSql(10), VICTIM, 'Your role was changed from exploring to founder by T. Okafor');
  activity(db, 'account_status_changed', agoSql(9), VICTIM, 'Your account was deactivated by an Axal admin');
  activity(db, 'kyc_approved', agoSql(8), VICTIM, 'Your KYC verification was approved by Axal compliance.');

  const r = await call(db, SUPER);
  assert.equal(r.status, 200);
  const fromActivity = r.body.rows.filter((x: any) => x.source === 'activity_logs');
  assert.equal(fromActivity.length, 1, 'a subject-side row entered the feed');
  assert.equal(fromActivity[0].action, 'role_changed');
  for (const row of r.body.rows) {
    assert.notEqual(row.actor, 'G. Lauzier', 'the subject of an action was named as its actor');
  }
});

test('an ISO timestamp and a SQLite one sort against each other correctly', async () => {
  // The merge sorts on the parsed epoch. Sorting the raw strings puts every
  // 'T' row above every space-form row regardless of when either happened,
  // because 'T' (0x54) sorts above a digit.
  const db = freshDb();
  audit(db, 'analytics_export', agoIso(60), { report_type: 'oldest-but-iso' });
  audit(db, 'publication_publish', agoSql(5), { report_type: 'newest-but-sql' });
  const r = await call(db, SUPER);
  assert.equal(r.status, 200);
  assert.equal(r.body.rows[0].target, 'newest-but-sql', 'the older ISO row sorted above the newer SQLite one');
  assert.equal(r.body.rows[1].target, 'oldest-but-iso');
});

test('a timestamp that will not parse sorts last, not to the top', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', 'not a date', { report_type: 'unparseable' });
  audit(db, 'publication_publish', agoSql(600), { report_type: 'ten hours ago' });
  const r = await call(db, SUPER);
  assert.equal(r.status, 200);
  assert.equal(r.body.rows[0].target, 'ten hours ago');
  assert.equal(r.body.rows[1].target, 'unparseable', 'an unreadable timestamp was treated as the epoch and led the feed');
});

test('only a licence event names a tenant, and the reason is in the payload', async () => {
  const db = freshDb();
  const lic = licence(db, 'AXL-004', 'Axal VC Iberia');
  licenceEvent(db, lic, 'suspended', agoSql(5), 'payment default, 41 days, board approved');
  audit(db, 'analytics_export', agoSql(6), { report_type: 'members', format: 'csv' });
  impersonation(db, agoSql(7), null, 'ticket #4192');

  const r = await call(db, SUPER);
  const bySource = Object.fromEntries(r.body.rows.map((x: any) => [x.source, x]));
  assert.equal(bySource.licence_events.tenant, 'Axal VC Iberia');
  assert.equal(bySource.admin_audit_log.tenant, null, 'an export was attributed to a subsidiary');
  assert.equal(bySource.impersonation_sessions.tenant, null, 'an impersonation was attributed to a subsidiary');
  assert.equal(r.body.tenant_available, false);
  assert.match(r.body.tenant_reason, /U1/, 'the blank column does not name why it is blank');
  // The row that CAN name one carries its reference and its note, which is
  // what H7's "Target and reason" column is for.
  assert.match(bySource.licence_events.target, /AXL-004/);
  assert.match(bySource.licence_events.target, /payment default, 41 days, board approved/);
});

test('each filter reads only the stores that hold its rows', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(9), { report_type: 'members', format: 'csv' });
  audit(db, 'publication_publish', agoSql(8), { report_type: 'digest' });
  activity(db, 'user_toggled', agoSql(7), SUPER, 'Admin T. Okafor deactivated user G. Lauzier');
  activity(db, 'contract_voided', agoSql(6), SUPER, 'Admin voided a contract');
  impersonation(db, agoSql(5), null, 'ticket #4192');
  const lic = licence(db, 'AXL-004', 'Axal VC Iberia');
  licenceEvent(db, lic, 'suspended', agoSql(4), 'payment default');
  licenceEvent(db, lic, 'renewed', agoSql(3), 'term 3 renewal');

  const sourcesOf = async (f: string) => {
    const r = await call(db, SUPER, f);
    assert.equal(r.status, 200, `${f}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.filter, f);
    return r;
  };

  const imp = await sourcesOf('impersonations');
  assert.deepEqual([...new Set(imp.body.rows.map((x: any) => x.source))], ['impersonation_sessions']);

  const lc = await sourcesOf('licence_changes');
  assert.deepEqual([...new Set(lc.body.rows.map((x: any) => x.source))], ['licence_events']);
  assert.equal(lc.body.rows.length, 2, 'a licence-changes filter must carry every licence event, not only the alarming ones');

  const susp = await sourcesOf('suspensions');
  assert.deepEqual(
    [...new Set(susp.body.rows.map((x: any) => x.source))].sort(),
    ['activity_logs', 'licence_events'],
    'suspension is recorded in two stores and the filter must read both',
  );
  // A renewal is not a suspension, and a contract void is not one either.
  assert.equal(susp.body.rows.length, 2, JSON.stringify(susp.body.rows));
  assert.ok(susp.body.rows.every((x: any) => x.action === 'licence suspended' || x.action === 'user_toggled'));

  const ex = await sourcesOf('exports');
  assert.deepEqual([...new Set(ex.body.rows.map((x: any) => x.source))], ['admin_audit_log']);
  assert.equal(ex.body.rows.length, 1, 'a publication is not an export');
  assert.equal(ex.body.rows[0].action, 'analytics_export');
});

test('an unknown filter falls back to the whole feed rather than to nothing', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(5), { report_type: 'members' });
  const r = await call(db, SUPER, 'licences');
  assert.equal(r.status, 200);
  assert.equal(r.body.filter, 'all', 'a stale bookmark narrowed the feed to a filter nobody defined');
  assert.equal(r.body.rows.length, 1);
});

test('one unreadable store does not silence the other three', async () => {
  // `impersonation_sessions` is created lazily, so a database that has never
  // impersonated has no table at all. That is unreadable, not "no sessions".
  const db = freshDb(ALL_TABLES.filter((t) => t !== 'impersonation_sessions'));
  audit(db, 'analytics_export', agoSql(5), { report_type: 'members' });
  const r = await call(db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rows.length, 1, 'the readable stores were dropped along with the unreadable one');
  const bad = r.body.sources.find((x: any) => x.table === 'impersonation_sessions');
  assert.equal(bad.available, false);
  assert.match(bad.reason, /could not be read/);
  assert.equal(r.body.data_access.impersonations.available, false,
    'the data-access zone reported an unreadable store as an empty one');
  assert.match(r.body.data_access.impersonations.reason, /could not be read/);
  assert.equal(r.body.data_access.exports.available, true, 'the readable half of the zone was suppressed too');
});

test('a live support session shows its remaining minutes; one past the limit is "not closed"', async () => {
  const db = freshDb();
  impersonation(db, agoSql(9), null, 'ticket #4192');            // live, inside the limit
  impersonation(db, agoSql(200), null, 'never closed');          // open long past 30m
  impersonation(db, agoSql(300), agoSql(279), 'ended early');    // 21 minutes, closed

  const r = await call(db, SUPER);
  assert.equal(r.status, 200);
  const items = r.body.data_access.impersonations.items;
  assert.equal(r.body.data_access.expiry_minutes, 30, 'the limit is not the one the token is minted with');
  const byContext = Object.fromEntries(items.map((x: any) => [x.meta.split(' · ').pop(), x]));
  assert.equal(byContext['ticket #4192'].dur, '21m left');
  assert.equal(byContext['ticket #4192'].live, true);
  assert.equal(byContext['ticket #4192'].overdue, false);
  // THE ONE THAT MATTERS. The token expired at thirty minutes; the closing
  // write is best-effort, so an open row past the limit means the RECORD was
  // never closed. "0m left" would say somebody is still inside.
  assert.equal(byContext['never closed'].dur, 'not closed');
  assert.equal(byContext['never closed'].overdue, true);
  assert.equal(byContext['ended early'].dur, '21m');
  assert.equal(byContext['ended early'].live, false);
});

test('an export is listed as a moment, not a window', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(5), { report_type: 'members', format: 'csv' });
  const r = await call(db, SUPER);
  const items = r.body.data_access.exports.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].dur, 'complete');
  assert.match(items[0].what, /Export · members/);
  assert.match(items[0].meta, /T\. Okafor/);
  assert.match(items[0].meta, /csv/);
});

test('both halves of the data-access zone stamp time the same way', async () => {
  // The two halves come from stores that stamp differently — SQLite's
  // 'YYYY-MM-DD HH:MM:SS' against full ISO with a 'T' and milliseconds — and
  // side by side in one zone that reads as two kinds of fact.
  const db = freshDb();
  impersonation(db, agoSql(5), null, 'ticket #4192');
  audit(db, 'analytics_export', agoIso(6), { report_type: 'members', format: 'csv' });
  const r = await call(db, SUPER);
  const metas = [
    r.body.data_access.impersonations.items[0].meta,
    r.body.data_access.exports.items[0].meta,
  ];
  for (const m of metas) {
    assert.match(m, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?![:\d])/, `${m} is not trimmed to the minute`);
    assert.doesNotMatch(m, /T\d{2}:/, `${m} still carries the ISO T`);
    assert.doesNotMatch(m, /\.\d{3}Z/, `${m} still carries milliseconds`);
  }
});

test('the reason an admin typed reaches the feed, from whichever store holds it', async () => {
  const db = freshDb();
  impersonation(db, agoSql(5), null, 'cap table export failure, ticket #4192');
  audit(db, 'security_force_reauth', agoSql(6), {
    filters_json: JSON.stringify({ reason: 'credential stuffing against three admin accounts', affected: 41 }),
  });
  const lic = licence(db, 'AXL-004', 'Axal VC Iberia');
  licenceEvent(db, lic, 'suspended', agoSql(7), 'payment default, 41 days, board approved');

  const r = await call(db, SUPER);
  const by = Object.fromEntries(r.body.rows.map((x: any) => [x.source, x]));
  assert.match(by.impersonation_sessions.target, /"cap table export failure, ticket #4192"/);
  assert.match(by.admin_audit_log.target, /"credential stuffing against three admin accounts"/);
  assert.match(by.licence_events.target, /"payment default, 41 days, board approved"/);
  // `affected` is not a reason and must not be quoted as one.
  assert.doesNotMatch(by.admin_audit_log.target, /41/);
});

test('only a non-empty STRING reason is lifted out of filters_json', async () => {
  // The lift has to be picky in three directions, and each was a live
  // mutation escape before this test existed: another field is not a reason,
  // a number is not a reason, and an empty one is not a reason either. A
  // quoted clause on this row is a claim that somebody typed it.
  const db = freshDb();
  audit(db, 'billing_refund', agoSql(5), {
    report_type: 'no-reason-field', filters_json: JSON.stringify({ affected: 41, dispute_id: 'dp_7' }),
  });
  audit(db, 'billing_refund', agoSql(6), {
    report_type: 'numeric-reason', filters_json: JSON.stringify({ reason: 4192 }),
  });
  audit(db, 'billing_refund', agoSql(7), {
    report_type: 'blank-reason', filters_json: JSON.stringify({ reason: '   ' }),
  });
  const r = await call(db, SUPER);
  assert.equal(r.body.rows.length, 3);
  for (const row of r.body.rows) {
    assert.doesNotMatch(row.target, /"/, `${row.target} carries a quoted reason nobody typed`);
  }
  assert.deepEqual(
    r.body.rows.map((x: any) => x.target),
    ['no-reason-field', 'numeric-reason', 'blank-reason'],
  );
});

test('filters_json that is not JSON does not take the request down', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', agoSql(5), { report_type: 'members', filters_json: '{not json' });
  const r = await call(db, SUPER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rows.length, 1);
  assert.equal(r.body.rows[0].target, 'members');
});

test('the two panels H7 draws with no store behind them say so', async () => {
  const db = freshDb();
  const r = await call(db, SUPER);
  assert.equal(r.body.guardrails.available, false);
  assert.match(r.body.guardrails.reason, /No guardrail-hit/);
  assert.equal(r.body.tenant_view_available, false, 'the "Return to HQ view" overlay is claimed to exist');
  assert.match(r.body.tenant_view_reason, /U1/);
});

test('the guardrail sentence is one constant, not two literals that can drift', async () => {
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_security.ts'), 'utf8',
  );
  const sentence = 'No guardrail-hit, flagged-output or token-anomaly counter is stored for the AI rails.';
  assert.equal(
    src.split(sentence).length - 1, 1,
    'the AI-safety sentence is written twice — /overview and /governance must share one constant',
  );
  assert.equal(src.split('absent(NO_AI_SAFETY_STORE)').length - 1, 2);
});

test('every filter is one the artboard draws, and the payload names what each reads', async () => {
  const db = freshDb();
  const r = await call(db, SUPER);
  assert.deepEqual(
    r.body.filters.map((f: any) => f.label),
    ['All actions', 'Impersonations', 'Licence changes', 'Suspensions', 'Exports'],
  );
  for (const f of r.body.filters) assert.ok(f.reads, `${f.key} does not say which store it reads`);
});
