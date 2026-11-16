/**
 * #4709 (D4709) — Delivery histories: complete, paged, kept as sent, and
 * corrected with attribution.
 *
 * Covers the issue's test list: histories larger than one page (Board,
 * Health, Deliverables, Status reports), tied timestamps at a page boundary,
 * period boundaries in a report's composition, corrections and amendments,
 * input refusals, and a stored value that cannot be read.
 *
 * HARNESS. Copied from `delivery_write_conflicts_5314.test.ts`: the real
 * router against in-memory SQLite, tables built from the migration files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 60;
const OUR_STAFF = 61;      // partner_id 1, can hold a seat
const THEIRS_USER = 62;
const THEIR_STAFF = 63;    // partner_id 2, cannot
const FOUNDER_USER = 64;
const OUR_ENGAGEMENT = 901;
const THEIR_ENGAGEMENT = 902;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
let hook: { re: RegExp; fn: () => void } | null = null;
/** As `delivery_concurrency_4682.test.ts`: run `fn` once, right after the next
 * read whose SQL matches `re` — another request that completed between this
 * request's read and its write. */
function after(re: RegExp, fn: () => void) { hook = { re, fn }; }
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const fire = (sql: string) => {
    if (hook && hook.re.test(sql)) { const h = hook; hook = null; h.fn(); }
  };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const r = db.prepare(sql).get(...b) ?? null; fire(sql); return r; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      const out = [];
      for (const st of x || []) out.push(await st.run().catch(() => ({})));
      return out;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    -- #4673: an engagement's founder_id is a FOUNDER PROFILE (founders.id), and the client's name is
    -- read from it. These fixtures keep the founder's id equal to the user's (FOUNDER_USER) on purpose;
    -- partner_delivery_report_access_4673.test.ts proves the two apart.
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL,
      notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('202611072115_delivery_revisions'));
  // APPLIED, NOT MIRRORED. The two capacity stores are read by `/capacity` and
  // written by its two `PUT`s, so the harness runs their migration files for
  // the same reason it runs 208's: a hand-copied DDL that drifts from the file
  // makes every assertion below true of a schema production does not have.
  db.exec(migration('230_partner_capacity'));
  db.exec(migration('231_partner_internal_hours'));
  db.exec(migration('232_partner_engagement_health'));
  // #5314 part 3: the revisions on health, caps, internal and client hours.
  db.exec(migration('202611111141_5314_delivery_write_versions'));
  // #5314 part 2: the status report's Blocked section and the client review history.
  db.exec(migration('202611111140_5314_status_report_blocked_history'));
  // #4709: blockers kept at send, report amendments and deliverable corrections.
  db.exec(migration('202611152339_4709_delivery_history'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(OUR_STAFF, 'partner', 1, 'Sam', 'sam@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(THEIR_STAFF, 'partner', 2, 'Robin', 'robin@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'y');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 501, 601, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 502, 602, 2, FOUNDER_USER, 9, 15000);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await partnerDelivery.request(path, init, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const ours = { user: OURS_USER, role: 'partner' };


// ---------------------------------------------------------------------------
// #4709
// ---------------------------------------------------------------------------

function setup() {
  const db = freshDb();
  return { db, e: env(db) };
}
const one = (db: any, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;

/** `n` more engagements for this firm, all created in the same second (a tie at every boundary). */
function addEngagements(db: any, n: number, createdAt = '2026-10-01 09:00:00'): number[] {
  const ins = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`);
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = 1000 + i;
    ins.run(id, `e-more-${id}`, 501, 7000 + i, 1, FOUNDER_USER, 9, 1000, createdAt);
    ids.push(id);
  }
  return ids;
}

/** Walk every page of `path` at `limit` a page, returning the rows in order and each page's body. */
async function walk(e: any, path: string, limit: number) {
  const rows: any[] = [];
  const pages: any[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await call(e, 'GET', url, ours);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    pages.push(r.body);
    rows.push(...r.body.items);
    cursor = r.body.page.next_cursor;
    if (!cursor) return { rows, pages };
  }
  throw new Error('the pages never ended');
}

// ── 1. Period filtered before any limit ─────────────────────────────────────

test('#4709: composing an earlier period finds its sends behind more than 50 newer ones', async () => {
  const { db, e } = setup();
  const ins = db.prepare(
    `INSERT INTO engagement_deliverables (uid, engagement_id, title, sent_at, sent_by)
     VALUES (?, ?, ?, ?, 60)`);
  // Two in September, on the period's first and last day; sixty in October.
  ins.run('sep-1', OUR_ENGAGEMENT, 'September first', '2026-09-01T00:00:00Z');
  ins.run('sep-2', OUR_ENGAGEMENT, 'September last', '2026-09-30T23:59:59Z');
  for (let i = 0; i < 60; i += 1) ins.run(`oct-${i}`, OUR_ENGAGEMENT, `October ${i}`, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`);
  // A day either side of September, which must not be swept in.
  ins.run('aug', OUR_ENGAGEMENT, 'August last', '2026-08-31T23:59:59Z');

  const r = await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/report-draft/2026-09`, ours);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.shipped_from_log.map((d: any) => d.title).sort(), ['September first', 'September last']);
  const oct = await call(e, 'GET', `/engagements/${OUR_ENGAGEMENT}/report-draft/2026-10`, ours);
  assert.equal(oct.body.shipped_from_log.length, 60, 'every October send, not the newest 50');
});

// ── 2. Pages with ties: no gaps, no duplicates; figures over the whole book ──

test('#4709: the deliverables log pages through tied send times with no gap or repeat', async () => {
  const { db, e } = setup();
  const ins = db.prepare(
    `INSERT INTO engagement_deliverables (uid, engagement_id, title, sent_at, sent_by, link_url)
     VALUES (?, ?, ?, ?, ?, ?)`);
  // Seven sent in the same second, three in another, four unsent.
  for (let i = 0; i < 7; i += 1) ins.run(`t-${i}`, OUR_ENGAGEMENT, `Tied ${i}`, '2026-10-05T10:00:00Z', 60, null);
  for (let i = 0; i < 3; i += 1) ins.run(`o-${i}`, OUR_ENGAGEMENT, `Older ${i}`, '2026-09-05T10:00:00Z', 60, null);
  // Two of the older ones were signed off by the client: they sit on later pages.
  db.prepare("UPDATE engagement_deliverables SET signed_off_at = '2026-09-20' WHERE uid IN ('o-0', 'o-1')").run();
  for (let i = 0; i < 4; i += 1) ins.run(`u-${i}`, OUR_ENGAGEMENT, `Unsent ${i}`, null, null, null);
  // Another firm's rows are never in the book.
  ins.run('theirs', THEIR_ENGAGEMENT, 'Theirs', '2026-10-05T10:00:00Z', 62, null);

  const whole = await call(e, 'GET', '/deliverables', ours);
  assert.equal(whole.body.items.length, 14);
  assert.equal(whole.body.page.complete, true);
  assert.equal(whole.body.page.next_cursor, null);

  const { rows, pages } = await walk(e, '/deliverables', 3);
  assert.deepEqual(rows.map((d) => d.id), whole.body.items.map((d: any) => d.id), 'paged order is the whole order');
  assert.equal(new Set(rows.map((d) => d.id)).size, 14, 'no row twice');
  assert.equal(pages.length, 5);
  // Sent first, newest first, the higher id first on a tie; unsent last.
  assert.deepEqual(rows.slice(0, 7).map((d) => d.title), [6, 5, 4, 3, 2, 1, 0].map((i) => `Tied ${i}`));
  assert.ok(rows.slice(10).every((d) => d.sent_at === null));
  // The figures are the book's on every page, never the page's.
  for (const p of pages) {
    assert.equal(p.sent_count, 10);
    assert.equal(p.signed_off_count, 2, 'signed off is the book’s, on the first page too');
    assert.equal(p.page.total, 14);
    assert.equal(p.page.complete, false);
  }
});

test('#4709: Board and Health page the whole book; their figures count every engagement', async () => {
  const { db, e } = setup();
  const more = addEngagements(db, 5);
  // One of the tied engagements is blocked, on the last page.
  db.prepare("INSERT INTO engagement_blockers (uid, engagement_id, side, summary, raised_at) VALUES ('b-1', ?, 'ours', 'Keys', '2026-10-02')")
    .run(more[0]);

  for (const path of ['/board', '/health']) {
    const whole = await call(e, 'GET', path, ours);
    assert.equal(whole.body.items.length, 6, path);
    const { rows, pages } = await walk(e, path, 2);
    assert.deepEqual(rows.map((r) => r.engagement_id), whole.body.items.map((r: any) => r.engagement_id), path);
    assert.equal(new Set(rows.map((r) => r.engagement_id)).size, 6, `${path}: no engagement twice`);
    assert.equal(pages.length, 3, path);
    // The tied five come highest id first.
    const tied = rows.map((r) => r.engagement_id).filter((id) => id >= 1000);
    assert.deepEqual(tied, [...more].reverse(), path);
    for (const p of pages) {
      assert.equal(p.page.total, 6, path);
      assert.equal(p.unrated_count, whole.body.unrated_count, `${path}: unrated is the book's`);
    }
  }
  // A page boundary with exactly one row past it: the sixth is still reachable.
  for (const path of ['/board', '/health']) {
    const five = await walk(e, path, 5);
    assert.equal(five.pages.length, 2, path);
    assert.equal(five.rows.length, 6, path);
  }
  const board = await walk(e, '/board', 2);
  for (const p of board.pages) assert.equal(p.needs_attention, 1, 'the blocked engagement counts on the first page too');
  const health = await walk(e, '/health', 2);
  for (const p of health.pages) assert.equal(p.at_risk_count, 1);
});

test('#4709: the report feed pages by period with ties on the id; its strip is the book', async () => {
  const { db, e } = setup();
  const more = addEngagements(db, 4);
  const ins = db.prepare(
    `INSERT INTO engagement_status_reports (uid, engagement_id, period, state, shipped) VALUES (?, ?, ?, 'draft', 'x')`);
  // Five reports in one period (a tie on every boundary), two in an older one.
  [OUR_ENGAGEMENT, ...more].forEach((id, i) => ins.run(`r-${i}`, id, '2026-10', ));
  ins.run('old-1', OUR_ENGAGEMENT, '2026-09');
  ins.run('old-2', more[0], '2026-09');
  ins.run('theirs', THEIR_ENGAGEMENT, '2026-10');

  const whole = await call(e, 'GET', '/status-reports', ours);
  assert.equal(whole.body.items.length, 7);
  const { rows, pages } = await walk(e, '/status-reports', 2);
  assert.deepEqual(rows.map((r) => r.id), whole.body.items.map((r: any) => r.id));
  assert.equal(new Set(rows.map((r) => r.id)).size, 7);
  assert.deepEqual(rows.map((r) => r.period), ['2026-10', '2026-10', '2026-10', '2026-10', '2026-10', '2026-09', '2026-09']);
  const ids = rows.slice(0, 5).map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'the higher id first within a period');
  for (const p of pages) {
    assert.equal(p.draft_count, 7);
    assert.equal(p.page.total, 7);
  }
});

test('#4709: a page link that is not one, or a page size out of range, is refused', async () => {
  const { e } = setup();
  for (const path of ['/deliverables', '/status-reports', '/board', '/health']) {
    const bad = await call(e, 'GET', `${path}?cursor=not-a-cursor`, ours);
    assert.equal(bad.status, 400, path);
    assert.equal(bad.body.code, 'bad_cursor', path);
    const big = await call(e, 'GET', `${path}?limit=1000`, ours);
    assert.equal(big.body.code, 'bad_limit', path);
    assert.equal((await call(e, 'GET', `${path}?limit=0`, ours)).body.code, 'bad_limit', path);
  }
  // A cursor of the wrong shape for the list is refused too, not read as the first page.
  const twoPart = Buffer.from(JSON.stringify(['2026-10', 5])).toString('base64url');
  assert.equal((await call(e, 'GET', `/deliverables?cursor=${twoPart}`, ours)).body.code, 'bad_cursor');
  const fourPart = Buffer.from(JSON.stringify([0, '2026-10-05', 5, 7])).toString('base64url');
  assert.equal((await call(e, 'GET', `/deliverables?cursor=${fourPart}`, ours)).body.code, 'bad_cursor');
  // The deliverables cursor's first part says sent (0) or unsent (1), and nothing else.
  const badFlag = Buffer.from(JSON.stringify(['0', '2026-10-05', 5])).toString('base64url');
  assert.equal((await call(e, 'GET', `/deliverables?cursor=${badFlag}`, ours)).body.code, 'bad_cursor');
  const threePart = Buffer.from(JSON.stringify(['2026-10', 'x', 5])).toString('base64url');
  assert.equal((await call(e, 'GET', `/board?cursor=${threePart}`, ours)).body.code, 'bad_cursor');
});

// ── 3. A sent report keeps the blockers it was sent with ────────────────────

test('#4709: a sent report shows the blockers open when it was sent; today’s are labelled as now', async () => {
  const { db, e } = setup();
  const keys = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Waiting on keys', side: 'client' })).body;
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2026-10`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: '2026-10', shipped: 'Spec', next_up: 'Build', blocked: 'Keys' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const sent = await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours, {});
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.blockers_at_send_recorded, true);
  assert.deepEqual(sent.body.blockers_at_send.map((b: any) => [b.side, b.summary]), [['client', 'Waiting on keys']]);

  // After the send: that blocker clears and a new one is raised.
  await call(e, 'PATCH', `/blockers/${keys.id}`, ours, { cleared_at: '2026-11-02' });
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Vendor outage', side: 'ours' });
  // And a draft for the next period, which reads live.
  await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2026-11`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: '2026-11', shipped: 'More' });

  const list = (await call(e, 'GET', '/status-reports', ours)).body;
  const oct = list.items.find((r: any) => r.period === '2026-10');
  const nov = list.items.find((r: any) => r.period === '2026-11');
  assert.equal(oct.blockers_source, 'at_send');
  assert.deepEqual(oct.blockers.map((b: any) => b.summary), ['Waiting on keys'], 'what was blocked then, not now');
  assert.deepEqual(oct.current_blockers.map((b: any) => b.summary), ['Vendor outage'], 'now, labelled as now');
  assert.equal(nov.blockers_source, 'live');
  assert.deepEqual(nov.blockers.map((b: any) => b.summary), ['Vendor outage']);
  assert.equal(list.client_blocked_count, 1, 'the sent report was blocked on the client when it was sent');

  // Kept with the report: the stored record cannot be rewritten after the send.
  assert.throws(() => db.prepare("UPDATE engagement_status_reports SET blockers_at_send = '[]' WHERE id = ?").run(saved.body.id), /status_report_sent/);
});

test('#4709: a report sent before blockers were kept reads Not recorded, and a sent report with none open records none', async () => {
  const { db, e } = setup();
  // Sent before this change: no record of what was open.
  db.prepare(
    `INSERT INTO engagement_status_reports (uid, engagement_id, period, state, shipped, sent_at, sent_by)
     VALUES ('legacy', ?, '2026-08', 'sent', 'Old', '2026-09-01T00:00:00Z', 60)`).run(OUR_ENGAGEMENT);
  // A stored record that cannot be read is treated the same way, not as a crash or as "nothing".
  db.prepare(
    `INSERT INTO engagement_status_reports (uid, engagement_id, period, state, shipped, sent_at, sent_by, blockers_at_send)
     VALUES ('garbled', ?, '2026-07', 'sent', 'Older', '2026-08-01T00:00:00Z', 60, '{not json')`).run(OUR_ENGAGEMENT);
  // Readable JSON that is not a list of blockers is not a record of one either.
  db.prepare(
    `INSERT INTO engagement_status_reports (uid, engagement_id, period, state, shipped, sent_at, sent_by, blockers_at_send)
     VALUES ('object', ?, '2026-06', 'sent', 'Oldest', '2026-07-01T00:00:00Z', 60, '{"side":"client"}')`).run(OUR_ENGAGEMENT);
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Open now', side: 'client' });
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2026-10`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: '2026-10', shipped: 'Spec' });
  // Clear it before the send: this report was sent with nothing open.
  const open = one(db, 'SELECT id FROM engagement_blockers WHERE summary = ?', 'Open now');
  await call(e, 'PATCH', `/blockers/${open.id}`, ours, { cleared_at: '2026-10-30' });
  await call(e, 'POST', `/status-reports/${saved.body.id}/send`, ours, {});
  await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Raised later', side: 'client' });

  const list = (await call(e, 'GET', '/status-reports', ours)).body;
  const by = (p: string) => list.items.find((r: any) => r.period === p);
  for (const p of ['2026-08', '2026-07', '2026-06']) {
    assert.equal(by(p).blockers_source, 'not_recorded', p);
    assert.deepEqual(by(p).blockers, [], p);
    assert.equal(by(p).blockers_at_send_recorded, false, p);
    assert.match(by(p).blockers_at_send_note, /^Not recorded/, p);
    assert.deepEqual(by(p).current_blockers.map((b: any) => b.summary), ['Raised later'], p);
  }
  assert.equal(by('2026-10').blockers_source, 'at_send');
  assert.deepEqual(by('2026-10').blockers, [], 'nothing was open at the send, and that was recorded');
  assert.equal(list.blockers_not_recorded_count, 3);
  assert.equal(list.blocked_count, 0, 'no report was blocked as sent, whatever is open today');
});

// ── 4. Amendments: added, never written over ────────────────────────────────

test('#4709: a sent report is amended with attribution; the report itself is unchanged', async () => {
  const { db, e } = setup();
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/2026-10`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: '2026-10', shipped: 'Spec v1', next_up: 'Build' });
  const id = saved.body.id;
  const draft = await call(e, 'POST', `/status-reports/${id}/amendments`, ours, { note: 'Too early' });
  assert.equal(draft.status, 409);
  assert.equal(draft.body.code, 'report_draft');

  await call(e, 'POST', `/status-reports/${id}/send`, ours, {});
  const before = one(db, 'SELECT * FROM engagement_status_reports WHERE id = ?', id);
  assert.equal((await call(e, 'POST', `/status-reports/${id}/amendments`, ours, { note: '   ' })).body.code, 'empty_amendment');
  assert.equal((await call(e, 'POST', `/status-reports/${id}/amendments`, ours, { note: { x: 1 } })).body.code, 'bad_input');

  const a = await call(e, 'POST', `/status-reports/${id}/amendments`, { user: OUR_STAFF, role: 'partner' }, { note: 'Shipped was v2, not v1.' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.shipped, 'Spec v1', 'the report as the client received it');
  assert.equal(a.body.amendments.length, 1);
  assert.equal(a.body.amendments[0].note, 'Shipped was v2, not v1.');
  assert.equal(a.body.amendments[0].amended_by, OUR_STAFF);
  assert.equal(a.body.amendments[0].amended_by_name, 'Sam');
  assert.ok(a.body.amendments[0].amended_at);
  assert.deepEqual(one(db, 'SELECT * FROM engagement_status_reports WHERE id = ?', id), before, 'not one column of the report moved');

  const listed = (await call(e, 'GET', '/status-reports', ours)).body.items.find((r: any) => r.id === id);
  assert.deepEqual(listed.amendments.map((x: any) => x.note), ['Shipped was v2, not v1.']);
  // Another firm cannot amend it.
  assert.equal((await call(e, 'POST', `/status-reports/${id}/amendments`, { user: THEIRS_USER, role: 'partner' }, { note: 'x' })).status, 404);
  // Append-only.
  assert.throws(() => db.prepare("UPDATE engagement_status_report_amendments SET note = 'changed'").run(), /append_only/);
  assert.throws(() => db.prepare('DELETE FROM engagement_status_report_amendments').run(), /append_only/);
});

// ── 5. A sent deliverable is corrected, never silently rewritten ────────────

test('#4709: a sent deliverable needs a reason to change; the values it replaced are kept with who and when', async () => {
  const { db, e } = setup();
  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours,
    { title: 'Spec', version: 'v1', link_url: 'https://example.com/spec', sent_at: '2026-10-05' })).body;
  assert.ok(d.id, JSON.stringify(d));

  const silent = await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { link_url: 'https://example.com/other' });
  assert.equal(silent.status, 409);
  assert.equal(silent.body.code, 'deliverable_sent');
  assert.equal(one(db, 'SELECT link_url FROM engagement_deliverables WHERE id = ?', d.id).link_url, 'https://example.com/spec');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_deliverable_corrections').n, 0);

  // Unsending is a change to what the client was handed, too.
  assert.equal((await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { sent_at: null })).body.code, 'deliverable_sent');

  const fixed = await call(e, 'PATCH', `/deliverables/${d.id}`, { user: OUR_STAFF, role: 'partner' },
    { link_url: 'https://example.com/spec-v1', correction_reason: 'The first link was the draft folder.' });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(fixed.body.link_url, 'https://example.com/spec-v1');
  assert.equal(fixed.body.corrections.length, 1);
  const k = fixed.body.corrections[0];
  assert.deepEqual(k.was, { title: 'Spec', version: 'v1', link_url: 'https://example.com/spec', sent_at: '2026-10-05' });
  assert.equal(k.revision, 0);
  assert.equal(k.reason, 'The first link was the draft folder.');
  assert.equal(k.corrected_by, OUR_STAFF);
  assert.equal(k.corrected_by_name, 'Sam');
  assert.ok(k.corrected_at);

  // An edit that changes nothing the client was handed needs no reason and leaves no correction.
  assert.equal((await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { title: 'Spec' })).status, 200);
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_deliverable_corrections').n, 1);

  // The log carries the corrections with the row.
  const listed = (await call(e, 'GET', '/deliverables', ours)).body.items.find((x: any) => x.id === d.id);
  assert.deepEqual(listed.corrections.map((x: any) => x.reason), ['The first link was the draft folder.']);

  // An unsent deliverable is still the firm's draft: edited freely, deleted freely.
  const draft = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Draft' })).body;
  assert.equal((await call(e, 'PATCH', `/deliverables/${draft.id}`, ours, { title: 'Draft 2' })).status, 200);
  assert.equal((await call(e, 'DELETE', `/deliverables/${draft.id}`, ours)).status, 200);

  // A sent one is never deleted.
  const del = await call(e, 'DELETE', `/deliverables/${d.id}`, ours);
  assert.equal(del.status, 409);
  assert.equal(del.body.code, 'deliverable_sent');
  assert.ok(one(db, 'SELECT id FROM engagement_deliverables WHERE id = ?', d.id));

  assert.throws(() => db.prepare("UPDATE engagement_deliverable_corrections SET reason = 'x'").run(), /append_only/);
  assert.throws(() => db.prepare('DELETE FROM engagement_deliverable_corrections').run(), /append_only/);
});

test('#4709: a correction that races another edit records only the write that landed', async () => {
  const { db, e } = setup();
  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours,
    { title: 'Spec', version: 'v1', sent_at: '2026-10-05' })).body;
  // Another request changes the version (not the title) between this read and its write.
  after(/FROM engagement_deliverables d/, () =>
    db.prepare("UPDATE engagement_deliverables SET version = 'v2', revision = revision + 1 WHERE id = ?").run(d.id));
  const r = await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { title: 'Spec 2', correction_reason: 'Renamed' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ks = db.prepare('SELECT * FROM engagement_deliverable_corrections').all() as any[];
  assert.equal(ks.length, 1, 'the write that lost left no correction behind');
  assert.equal(ks[0].revision, 1, 'the correction names the revision it replaced');
  assert.equal(ks[0].version, 'v2', 'and the values that revision held');
});

test('#4709: a correction that loses a race to another edit is not recorded', async () => {
  const { db, e } = setup();
  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours,
    { title: 'Spec', sent_at: '2026-10-05' })).body;
  const r = await call(e, 'PATCH', `/deliverables/${d.id}`, ours,
    { title: 'Spec 2', correction_reason: 'Renamed', expected_revision: 7 });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'delivery_changed');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_deliverable_corrections').n, 0);
  assert.equal(one(db, 'SELECT title FROM engagement_deliverables WHERE id = ?', d.id).title, 'Spec');
});

// ── 6. Inputs ───────────────────────────────────────────────────────────────

test('#4709: dates that are not dates are refused with one fixed sentence', async () => {
  const { db, e } = setup();
  const bad = ['2026-02-30', '2026-13-01', 'tomorrow', '05/10/2026', '2026-10-05T25:00:00Z', 20261005, true, { at: 1 }, ['2026-10-05']];
  for (const v of bad) {
    const d = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'X', sent_at: v });
    assert.equal(d.status, 400, `deliverable ${JSON.stringify(v)}`);
    assert.equal(d.body.code, 'bad_date');
    assert.equal(d.body.detail, 'The sent date must be a date, like 2026-11-15.');
    const m = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'X', due_at: v });
    assert.equal(m.body.code, 'bad_date', `milestone ${JSON.stringify(v)}`);
  }
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_deliverables').n, 0, 'nothing stored');
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_milestones').n, 0);

  const seat = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, granted_at: '2026-02-30' });
  assert.equal(seat.body.code, 'bad_date');
  const health = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/health`, ours,
    { satisfaction: 4, satisfaction_source: 'Call', satisfaction_at: 'last week' });
  assert.equal(health.body.code, 'bad_date');

  // Good ones pass: a date, an ISO time, blank (cleared).
  for (const v of ['2026-10-05', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00.120+02:00', '']) {
    const ok = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Ok', due_at: v });
    assert.equal(ok.status, 200, `${v}: ${JSON.stringify(ok.body)}`);
  }
  // A milestone holding a value from before the checks can still be renamed.
  db.prepare("INSERT INTO engagement_milestones (uid, engagement_id, title, due_at) VALUES ('legacy', ?, 'Old', 'next sprint')").run(OUR_ENGAGEMENT);
  const legacy = one(db, "SELECT id FROM engagement_milestones WHERE uid = 'legacy'");
  const rename = await call(e, 'PATCH', `/milestones/${legacy.id}`, ours, { title: 'Old, renamed' });
  assert.equal(rename.status, 200, JSON.stringify(rename.body));
  assert.equal((await call(e, 'PATCH', `/milestones/${legacy.id}`, ours, { due_at: 'never' })).body.code, 'bad_date');
});

test('#4709: a deliverable link is http or https, with no credentials in it', async () => {
  const { db, e } = setup();
  const bad = ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'file:///etc/passwd',
    'https://user:pw@example.com/x', 'example.com/no-scheme', 'https://', 42, ['https://example.com'], `https://example.com/${'a'.repeat(600)}`];
  for (const v of bad) {
    const r = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'X', link_url: v });
    assert.equal(r.status, 400, `${JSON.stringify(v).slice(0, 40)}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, 'bad_link');
    assert.equal(r.body.detail, 'The link must be a web address starting with https:// or http://.');
  }
  assert.equal(one(db, 'SELECT COUNT(*) AS n FROM engagement_deliverables').n, 0);
  const ok = await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'X', link_url: ' https://example.com/a?b=1 ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.link_url, 'https://example.com/a?b=1');
  assert.equal((await call(e, 'PATCH', `/deliverables/${ok.body.id}`, ours, { link_url: 'javascript:void(0)' })).body.code, 'bad_link');
  assert.equal((await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: { t: 1 } })).body.code, 'bad_input');
});
