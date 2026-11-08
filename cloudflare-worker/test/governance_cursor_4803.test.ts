/**
 * D4803 (#4803, Security v2 Events, SE03): the ledger's cursor and its
 * server-side filters on GET /api/admin/security/governance.
 *
 *   · Load older pages through every row exactly once, newest first, across
 *     the five stores and both timestamp formats, and never splits a second;
 *   · from / to, actor, search (LIKE wildcards are literal), outcome and
 *     source narrow the read in SQL, each store still returning its own
 *     newest rows, so the merge stays exact;
 *   · a value out of shape is a 400 naming its field, never a wider read;
 *   · a filter on the ledger never narrows the Data access zone.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/governance_cursor_4803.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import security, { parseFeedQuery, trimToSecond } from '../src/routes/admin_security.ts';

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
  // D200 — the fifth store. It is post-cutoff, so it is NOT in the baseline:
  // `freshDb` builds it from migration 282 read off disk, seal and all, so the
  // table the route reads is the one that ships.
  'security_events',
];

const SECURITY_EVENTS_MIGRATION = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/282_security_events.sql'), 'utf8',
) + readFileSync(
  // D4691 — the support operator column the feed reads.
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611072219_security_events_support_actor.sql'), 'utf8',
);

function freshDb(tables: string[] = ALL_TABLES) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of tables) {
    if (t === 'security_events') db.exec(SECURITY_EVENTS_MIGRATION);
    else db.exec(ddl(t));
  }
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

/** D200 — one ledger row, stamped in the writer's own SQLite format. */
const securityEvent = (
  db: any, kind: string, factor: string, outcome: string, at: string,
  extra: { userId?: number | null; ip?: string; detail?: string | null; branch?: string } = {},
) =>
  db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, detail, user_id, subject_key, ip_prefix, branch_code, minute, occurred_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
  ).run(
    kind, factor, outcome, extra.detail ?? null, extra.userId ?? null,
    extra.ip ?? '203.0.113.0/24', extra.branch ?? 'hq', at.slice(0, 16), at,
  );

const impersonation = (db: any, started: string, ended: string | null, context: string | null) =>
  db.prepare(
    'INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
  ).run(SUPER, VICTIM, context, started, ended);

async function call(db: any, actor: number, query = '') {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const url = `http://x/governance${query ? `?${query}` : ''}`;
  const res = await security.fetch(
    new Request(url, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}


/** An instant `mins` minutes and `secs` seconds ago, as SQLite stamps it. */
const sqlAt = (mins: number, secs = 0) =>
  new Date(Date.now() - mins * 60_000 - secs * 1000).toISOString().slice(0, 19).replace('T', ' ');
/** The same instant as the full ISO `routes/admin.ts` writes. */
const isoAt = (mins: number, secs = 0) => new Date(Date.now() - mins * 60_000 - secs * 1000).toISOString();

/** Every page from newest to oldest, following the cursor. */
async function walk(db: any, query = '') {
  const pages: any[] = [];
  let before: string | null = null;
  for (let n = 0; n < 20; n += 1) {
    const q = [query, before ? `before=${encodeURIComponent(before)}` : ''].filter(Boolean).join('&');
    const r = await call(db, SUPER, q);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pages.push(r.body);
    if (!r.body.cursor) break;
    before = r.body.cursor.before;
  }
  return pages;
}

test('Load older reaches every row once, newest first, across stores and both timestamp formats', async () => {
  const db = freshDb();
  // 70 audit rows in ISO, 70 security events in SQLite format, interleaved by
  // the minute, so no store's own 60 covers the merged first page.
  for (let i = 0; i < 70; i += 1) {
    audit(db, 'analytics_export', isoAt(i * 2, 10), { report_type: `r${i}` });
    securityEvent(db, 'signin', 'password', 'refused', sqlAt(i * 2 + 1), { detail: `d${i}` });
  }
  const pages = await walk(db);
  assert.ok(pages.length >= 3, `${pages.length} pages for 140 rows at 60 a page`);
  const keys = pages.flatMap((p) => p.rows.map((r: any) => r.key));
  assert.equal(keys.length, 140, 'a row was lost or repeated across pages');
  assert.equal(new Set(keys).size, 140);
  const ts = pages.flatMap((p) => p.rows.map((r: any) => Date.parse(r.at.includes('T') ? r.at : `${r.at.replace(' ', 'T')}Z`)));
  for (let i = 1; i < ts.length; i += 1) assert.ok(ts[i - 1] >= ts[i], `row ${i} is newer than the one above it`);
  assert.equal(pages.at(-1).cursor, null, 'the last page still offers Load older');
  assert.equal(pages[0].more, true);
});

test('a page never ends inside a second: rows sharing the boundary second all come on the next page', async () => {
  const db = freshDb();
  for (let i = 0; i < 58; i += 1) audit(db, 'analytics_export', sqlAt(1, i), { report_type: `a${i}` });
  // Five rows in one second straddle the 60th position.
  for (let i = 0; i < 5; i += 1) securityEvent(db, 'gate', 'totp', 'refused', sqlAt(5), { detail: `same${i}`, ip: `203.0.113.${i}/32` });
  for (let i = 0; i < 4; i += 1) audit(db, 'analytics_export', sqlAt(10, i), { report_type: `old${i}` });
  const pages = await walk(db);
  const first = pages[0].rows.map((r: any) => r.key);
  assert.equal(first.filter((k: string) => k.startsWith('security:')).length, 0, 'the boundary second was split');
  const all = pages.flatMap((p) => p.rows.map((r: any) => r.key));
  assert.equal(all.length, 67);
  assert.equal(new Set(all).size, 67);
  assert.equal(pages[0].page_split_second, false);
});

test('from and to keep the read inside the range, whole days in UTC', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', '2026-11-03 23:59:59', { report_type: 'before-range' });
  audit(db, 'analytics_export', '2026-11-04T00:00:00.000Z', { report_type: 'first-second' });
  securityEvent(db, 'signin', 'password', 'refused', '2026-11-05 23:59:59', { detail: 'last-second' });
  audit(db, 'analytics_export', '2026-11-06 00:00:00', { report_type: 'after-range' });
  const r = await call(db, SUPER, 'from=2026-11-04&to=2026-11-05');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const got = r.body.rows.map((x: any) => x.target || x.action).join('|');
  assert.match(got, /first-second/);
  assert.match(got, /last-second/);
  assert.doesNotMatch(got, /before-range|after-range/);
  assert.deepEqual(r.body.applied, { from: '2026-11-04', to: '2026-11-05' });
});

test('actor, search, outcome and source narrow the read; LIKE wildcards are searched for literally', async () => {
  const db = freshDb();
  audit(db, 'analytics_export', sqlAt(1), { report_type: 'members_50%' });
  audit(db, 'analytics_export', sqlAt(2), { report_type: 'members_500' });
  activity(db, 'role_changed', sqlAt(3), VICTIM, 'changed by victim');
  securityEvent(db, 'signin', 'password', 'refused', sqlAt(4), { detail: 'bad_password' });
  securityEvent(db, 'step_up', 'totp', 'ok', sqlAt(5), { userId: SUPER, detail: 'passed' });
  impersonation(db, sqlAt(6), sqlAt(5), 'ticket A');
  impersonation(db, sqlAt(1), null, 'ticket B');

  const pct = await call(db, SUPER, `q=${encodeURIComponent('50%')}`);
  assert.deepEqual(pct.body.rows.map((x: any) => x.key).filter((k: string) => k.startsWith('audit:')).length, 1, '"50%" matched "500"');

  const mine = await call(db, SUPER, `actor=${VICTIM}`);
  assert.deepEqual([...new Set(mine.body.rows.map((x: any) => x.source))], ['activity_logs']);

  const refused = await call(db, SUPER, 'outcome=refused');
  assert.deepEqual(refused.body.rows.map((x: any) => `${x.source}:${x.outcome}`), ['security_events:refused']);
  assert.deepEqual(refused.body.sources.map((x: any) => x.table), ['security_events'], 'a store that cannot hold a refusal was read');

  const ended = await call(db, SUPER, 'outcome=ended');
  assert.deepEqual(ended.body.rows.map((x: any) => x.outcome), ['ended']);
  const live = await call(db, SUPER, 'outcome=live');
  assert.deepEqual(live.body.rows.map((x: any) => x.outcome), ['live']);

  const lic = licence(db, 'AXL-004', 'Axal VC Iberia');
  licenceEvent(db, lic, 'suspended', sqlAt(7), 'payment default');
  const one = await call(db, SUPER, 'source=licence_events');
  assert.deepEqual(one.body.sources.map((x: any) => x.table), ['licence_events']);
  assert.deepEqual(one.body.rows.map((x: any) => [x.source, x.tenant]), [['licence_events', 'Axal VC Iberia']]);

  // The quick category and a filter combine.
  const authRefused = await call(db, SUPER, 'filter=auth&outcome=ok');
  assert.deepEqual(authRefused.body.rows.map((x: any) => x.action), ['step_up.totp']);
});

test('a value out of shape is a 400 naming its field, never a wider read', async () => {
  const db = freshDb();
  for (const [q, field] of [
    ['before=yesterday', 'before'], ['from=04-11-2026', 'from'], ['to=2026-11-40x', 'to'],
    ['from=2026-11-06&to=2026-11-05', 'from'], ['actor=1%20OR%201', 'actor'], ['actor=0', 'actor'],
    ['outcome=maybe', 'outcome'], ['source=users', 'source'], [`q=${'x'.repeat(101)}`, 'q'],
  ]) {
    const r = await call(db, SUPER, q);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.field, field, q);
    assert.equal(r.body.rows, undefined, `${q} still returned rows`);
  }
});

test('a filter on the ledger never narrows the Data access zone', async () => {
  const db = freshDb();
  impersonation(db, sqlAt(30), sqlAt(20), 'ticket A');
  impersonation(db, sqlAt(10), null, 'ticket B');
  const r = await call(db, SUPER, 'outcome=refused');
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 0);
  assert.equal(r.body.data_access.impersonations.items.length, 2, 'the zone lost sessions to a ledger filter');
});

test('a plain admin is still refused, filters or not', async () => {
  const db = freshDb();
  const r = await call(db, PLAIN_ADMIN, 'q=export');
  assert.notEqual(r.status, 200);
});

test('parseFeedQuery binds normalised instants; trimToSecond holds back only the boundary second', () => {
  const p = parseFeedQuery((k) => ({ before: '2026-11-07T14:12:08.120Z', to: '2026-11-08', q: 'a_b!' } as any)[k]);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.equal(p.query.upper, '2026-11-07 14:12:08', 'the earlier of the cursor and the range end');
  assert.equal(p.query.like, '%a!_b!!%');
  // A cursor later than the range's end is bounded by the end, not by itself.
  const late = parseFeedQuery((k) => ({ before: '2026-11-20 09:00:00', to: '2026-11-08' } as any)[k]);
  assert.ok(late.ok && late.query.upper === '2026-11-09 00:00:00');
  const rows = [{ ts: 3000 }, { ts: 2500 }, { ts: 2100 }, { ts: 1900 }];
  assert.deepEqual(trimToSecond(rows, true).page.map((r) => r.ts), [3000, 2500, 2100]);
  assert.deepEqual(trimToSecond(rows, false).page.length, 4, 'nothing is held back when nothing older exists');
  assert.equal(trimToSecond([{ ts: 2100 }, { ts: 2200 }], true).split, true);
});
