/**
 * #4708 part 2 (D4708-p2) — the ledger's Load older across a second that holds more than a page, the fixture
 * #4699 left to this package (D4699 "Not in this package", D4803's `page_split_second`).
 *
 * The cursor works on whole seconds (`trimToSecond`, `parseFeedQuery`): a page ends before the boundary second,
 * and the next read takes rows strictly older. When EVERY row on a page shares one second, the reply's cursor now
 * also carries `skip`, the number of that second's rows already shown, and the next read continues inside the
 * second. Paged through the real router:
 *
 *   · every row comes back exactly once, newest second first, across three stores, both timestamp formats,
 *     sub-second times and ids that cross a digit boundary;
 *   · a second larger than the continuation cap is still bounded per store, and the page still says so;
 *   · a `skip` out of shape, or without a cursor, is a 400 naming the field.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_same_second_4708.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import security from '../src/routes/admin_security.ts';
import { FEED_LIMIT } from '../src/services/adminSecurity/governanceFeed.ts';
import { FEED_SKIP_MAX, parseFeedQuery } from '../src/services/adminSecurity/feedQuery.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 4708;
/** The crowded second, and the instants around it. Fixed stamps: nothing here reads the clock. */
const SECOND = '2026-11-10 09:00:00';

async function freshDb() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  await loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Synthetic Super', 'super@example.invalid', 1)").run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

const audit = (db: any, at: string, tag: string) =>
  db.prepare(`INSERT INTO admin_audit_log (admin_user_id, action, report_type, exported_at) VALUES (?, 'analytics_export', ?, ?)`)
    .run(SUPER, tag, at);
const activity = (db: any, at: string, tag: string) =>
  db.prepare(`INSERT INTO activity_logs (action, details, actor, user_id, created_at) VALUES ('role_changed', ?, 'hash', ?, ?)`)
    .run(tag, SUPER, at);
const securityEvent = (db: any, at: string, n: number) =>
  db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, detail, user_id, subject_key, ip_prefix, branch_code, minute, occurred_at)
     VALUES ('gate', 'totp', 'refused', ?, NULL, ?, '203.0.113.0/24', 'hq', ?, ?)`,
  ).run(`same${n}`, `subject-${n}`, at.slice(0, 16), at);
const licenceEvent = (db: any, at: string, n: number) => {
  if (!db.prepare('SELECT 1 FROM territory_licences WHERE id = 1').get()) {
    db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (1, 'uid-1', 'AXL-001', 'Synthetic SAS', 'Synthetic Brand', 'active')`).run();
  }
  db.prepare('INSERT INTO licence_events (licence_id, event, note, actor_user_id, created_at) VALUES (1, ?, ?, ?, ?)')
    .run('renewed', `older${n}`, SUPER, at);
};

/** `n` milliseconds into the crowded second, as the ISO a writer with sub-second time stores (D124). */
const isoIn = (ms: number) => `2026-11-10T09:00:00.${String(ms).padStart(3, '0')}Z`;

/** The ledger's per-store reads: the statements ordered on the time expression (the Data access zone's are not). */
const FEED_ARM = /ORDER BY datetime\([a-z]\.\w+\) DESC, [a-z]\.id DESC LIMIT \?\s*$/;

async function call(db: any, query = '') {
  const jwt = await new SignJWT({ user_id: SUPER, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const base = d1Over(db);
  const limits: number[] = [];
  const DB = {
    ...base,
    prepare(sql: string) {
      const p = base.prepare(sql);
      const w: any = {
        bind(...a: unknown[]) { if (FEED_ARM.test(sql)) limits.push(Number(a.at(-1))); p.bind(...a); return w; },
        all: () => p.all(), first: (c?: string) => p.first(c), run: () => p.run(),
      };
      return w;
    },
  };
  const res = await security.fetch(
    new Request(`http://x/governance${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${jwt}` } }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any, limits };
}

/** Every page from newest to oldest, following the cursor exactly as the page sends it back. */
async function walk(db: any) {
  const pages: any[] = [];
  let cursor: { before: string; skip?: number } | null = null;
  for (let n = 0; n < 30; n += 1) {
    const q = cursor
      ? [`before=${encodeURIComponent(cursor.before)}`, cursor.skip ? `skip=${cursor.skip}` : ''].filter(Boolean).join('&')
      : '';
    const r = await call(db, q);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pages.push({ ...r.body, limits: r.limits });
    if (!r.body.cursor) break;
    cursor = r.body.cursor;
  }
  return pages;
}

const secondOf = (at: string) => Math.floor(Date.parse(at.includes('T') ? at : `${at.replace(' ', 'T')}Z`) / 1000);

test('a second holding more than two pages is paged through whole: no row skipped, none repeated', async () => {
  const db = await freshDb();
  // Five rows in later seconds.
  for (let i = 5; i < 10; i += 1) audit(db, `2026-11-10 09:00:0${i}`, `newer${i}`);
  // 150 rows in ONE second: 70 audit rows (40 ISO with milliseconds, 30 SQLite format, their ids crossing 9 → 10
  // and 99 → 100), 50 security events and 30 admin-side activity rows.
  for (let i = 0; i < 70; i += 1) audit(db, i < 40 ? isoIn(999 - i * 7) : SECOND, `same${i}`);
  for (let i = 0; i < 50; i += 1) securityEvent(db, SECOND, i);
  for (let i = 0; i < 30; i += 1) activity(db, SECOND, `same${i}`);
  // Twenty older rows in other stores and seconds.
  for (let i = 0; i < 10; i += 1) licenceEvent(db, `2026-11-10 08:59:${String(50 - i).padStart(2, '0')}`, i);
  for (let i = 0; i < 10; i += 1) audit(db, `2026-11-10 08:58:${String(50 - i).padStart(2, '0')}`, `older${i}`);
  const total = 5 + 150 + 20;

  const pages = await walk(db);
  const keys = pages.flatMap((p) => p.rows.map((r: any) => r.key));
  const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepEqual(repeated, [], 'a row came back on two pages');
  assert.equal(keys.length, total, `${keys.length} of ${total} rows reached: a row was skipped`);

  const seconds = pages.flatMap((p) => p.rows.map((r: any) => secondOf(r.at)));
  for (let i = 1; i < seconds.length; i += 1) assert.ok(seconds[i - 1] >= seconds[i], `row ${i} is in a newer second than the one above it`);

  // The shape of the walk: the later seconds, then two pages wholly inside the crowded second, then the rest.
  assert.deepEqual(pages.map((p) => p.rows.length), [5, FEED_LIMIT, FEED_LIMIT, 50]);
  assert.deepEqual(pages.map((p) => p.page_split_second), [false, true, true, false]);
  assert.deepEqual(pages.map((p) => p.cursor?.skip ?? null), [null, 60, 120, null]);
  assert.equal(pages.at(-1).cursor, null, 'the last page still offers Load older');
  // Bounded: a continuation reads at most the rows already shown plus one page from each store.
  for (const [i, p] of pages.entries()) {
    const skip = i === 0 ? 0 : pages[i - 1].cursor?.skip ?? 0;
    assert.ok(p.limits.length >= 3, `page ${i}: the store reads were not seen`);
    for (const n of p.limits) assert.equal(n, FEED_LIMIT + skip, `page ${i}: a store read ${n}`);
  }
  // Mutation checked (#4708 part 2), each failing this test: dropping no rows after the merge (a row on two
  // pages); a cursor without `skip` (the rest of the second lost); the pre-part-2 merge order, milliseconds and
  // then the key as text, which is not the stores' own order (a row on two pages); a store page not widened by
  // `skip` (rows lost).
});

test('a second larger than the continuation cap stays bounded, and the page says the rest of it is not reached', async () => {
  const db = await freshDb();
  const crowd = FEED_LIMIT + FEED_SKIP_MAX + 40;
  for (let i = 0; i < crowd; i += 1) securityEvent(db, SECOND, i);
  for (let i = 0; i < 3; i += 1) audit(db, `2026-11-10 08:58:0${i}`, `older${i}`);
  const pages = await walk(db);
  for (const p of pages) for (const n of p.limits) assert.ok(n <= FEED_LIMIT + FEED_SKIP_MAX, `a store read ${n} rows`);
  const keys = pages.flatMap((p) => p.rows.map((r: any) => r.key));
  assert.equal(new Set(keys).size, keys.length, 'a row came back on two pages');
  // Ten pages continue inside the second; the eleventh is past the cap, so its cursor goes past the second and
  // the page says so, as D4803's did for every such page.
  const capped = pages.find((p) => p.page_split_second && !p.cursor?.skip);
  assert.ok(capped, 'no page reported the second it could not continue');
  assert.equal(pages.filter((p) => p.cursor?.skip).length, FEED_SKIP_MAX / FEED_LIMIT);
  assert.ok(keys.some((k) => k.startsWith('audit:')), 'the rows older than the crowded second were never reached');
});

test('a skip out of shape, or without a cursor, is a 400 naming the field', async () => {
  const db = await freshDb();
  for (const q of ['skip=60', `before=${encodeURIComponent(SECOND)}&skip=0`, `before=${encodeURIComponent(SECOND)}&skip=-1`,
    `before=${encodeURIComponent(SECOND)}&skip=1.5`, `before=${encodeURIComponent(SECOND)}&skip=abc`,
    `before=${encodeURIComponent(SECOND)}&skip=${FEED_SKIP_MAX + 1}`]) {
    const r = await call(db, q);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.field, 'skip', q);
    assert.equal(r.body.rows, undefined, `${q} still returned rows`);
  }
  // In shape, the read includes the cursor's whole second and records what it applied.
  const p = parseFeedQuery((k) => ({ before: '2026-11-10T09:00:00.420Z', skip: '60' } as Record<string, string>)[k]);
  assert.ok(p.ok);
  if (!p.ok) return;
  assert.equal(p.query.upper, '2026-11-10 09:00:01');
  assert.deepEqual(p.query.skip, { second: Date.parse('2026-11-10T09:00:00Z'), rows: 60 });
  assert.deepEqual(p.query.applied, { before: '2026-11-10T09:00:00.420Z', skip: 60 });
});
