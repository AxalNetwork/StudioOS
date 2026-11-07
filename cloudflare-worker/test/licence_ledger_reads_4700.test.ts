/**
 * #4700 (Licences audit 5/7) — the ledger is read a page at a time and a
 * licence's requests are scoped on the server.
 *
 *   1. The ledger pages at 100, 101 and 450 licences without a statement
 *      binding more than D1's 100 values, every licence exactly once, in one
 *      stable order, with a total that counts every match.
 *   2. Search (reference, brand, entity, a held country), kind and status run
 *      in SQL, before the page.
 *   3. `/summary` is over the whole ledger: coverage, renewals and counts do
 *      not change with the page.
 *   4. `/:uid/requests` returns HQ-origin AND branch-origin requests for the
 *      licence, finds them behind more than 100 unrelated open requests, pages
 *      with a cursor and counts the total; an unreadable register or board is
 *      said, never shown as none.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_ledger_reads_4700.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminLicences, { hydrate } from '../src/routes/admin_licences.ts';
import { ID_CHUNK, idChunks } from '../src/services/licenceLedgerReads.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const ESCALATIONS = ['259_hq_escalations', '261_branch_escalations', '288_escalation_delivery', '296_escalation_relation']
  .map((n) => read(`cloudflare-worker/sql/migrations/${n}.sql`));

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 10;
const D1_MAX_BINDS = 100;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

/** A D1 stand-in that refuses what D1 refuses: more than 100 bound values. */
function makeD1(db: InstanceType<typeof DatabaseSync>, seen: { maxBinds: number }) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => {
          if (x.length > D1_MAX_BINDS) throw new Error(`too many SQL variables: ${x.length}`);
          seen.maxBinds = Math.max(seen.maxBinds, x.length);
          b = coerce(x); return api;
        },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
}

const STATUSES = ['active', 'suspended', 'pending_activation', 'draft', 'terminated'];

function ledgerDb(n: number, opts: { register?: boolean; board?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      licence_ref TEXT NOT NULL, legal_entity_name TEXT NOT NULL, brand_name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'subsidiary', status TEXT NOT NULL DEFAULT 'draft',
      renews_on TEXT, annual_fee_cents INTEGER, currency TEXT NOT NULL DEFAULT 'EUR');
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      country_code TEXT NOT NULL UNIQUE);
    CREATE TABLE licence_seats (licence_id INTEGER NOT NULL, seat_type TEXT NOT NULL, seats_licensed INTEGER NOT NULL);
  `);
  if (opts.register !== false) {
    db.exec(`CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live');`);
  }
  if (opts.board !== false) for (const m of ESCALATIONS) db.exec(m);
  db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)').run(SUPER, 'admin', 'Sue Hart');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const ins = db.prepare(`INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, kind, status, renews_on, annual_fee_cents)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const seat = db.prepare('INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (?, ?, ?)');
  for (let i = 1; i <= n; i += 1) {
    const ref = `AXL-${String(i).padStart(4, '0')}`;
    const r = ins.run(`lic_${i}`, ref, `Entity ${i} SAS`, `Brand ${i}`, i % 3 === 0 ? 'white_label' : 'subsidiary',
      STATUSES[i % STATUSES.length], i % 2 ? `2027-${String((i % 12) + 1).padStart(2, '0')}-15` : null, 1000 * i);
    seat.run(Number(r.lastInsertRowid), 'founder', i);
  }
  return db;
}

async function token(userId: number) {
  return new SignJWT({ user_id: userId, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function client(db: InstanceType<typeof DatabaseSync>) {
  const seen = { maxBinds: 0 };
  const app = new Hono<any>();
  app.route('/api/admin/licences', adminLicences);
  const env = { DB: makeD1(db, seen), JWT_SECRET };
  const get = async (path: string, userId: number = SUPER) => {
    const res = await app.request(`/api/admin/licences${path}`, { headers: { Authorization: `Bearer ${await token(userId)}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
  return { get, seen };
}

async function pageAll(get: (p: string) => Promise<{ status: number; body: any }>, query: string, limit: number) {
  const uids: string[] = [];
  let cursor: string | null = null;
  let total = -1;
  let pages = 0;
  do {
    const r = await get(`?limit=${limit}${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.items.length <= limit);
    total = r.body.total;
    uids.push(...r.body.items.map((l: any) => l.uid));
    cursor = r.body.next_cursor;
    pages += 1;
    assert.ok(pages < 100, 'the cursor never ends');
  } while (cursor);
  return { uids, total, pages };
}

test('#4700 ids go to D1 in chunks of at most 90', () => {
  assert.ok(ID_CHUNK < D1_MAX_BINDS);
  const ids = Array.from({ length: 451 }, (_, i) => i + 1);
  const chunks = idChunks(ids);
  assert.deepEqual(chunks.map((c) => c.part.length), [90, 90, 90, 90, 90, 1]);
  assert.deepEqual(chunks.flatMap((c) => c.part), ids);
  assert.equal(chunks[5].placeholders, '?');
  assert.deepEqual(idChunks([]), []);
});

test('#4700 hydrate binds at most one chunk per statement, whoever hands it 450 licences', async () => {
  const db = ledgerDb(450);
  const seen = { maxBinds: 0 };
  const rows = db.prepare('SELECT * FROM territory_licences ORDER BY id').all() as any[];
  // Mutation checked: ID_CHUNK past 100 → D1 refuses the statement here.
  const out = await hydrate({ DB: makeD1(db, seen) } as any, rows);
  assert.equal(out.length, 450);
  assert.equal(out[449].seats.founder, 450);
  assert.ok(seen.maxBinds <= ID_CHUNK);
});

for (const n of [100, 101, 450]) {
  test(`#4700 the ledger at ${n} licences: every licence once, one stable order, no statement past D1's bind limit`, async () => {
    const db = ledgerDb(n);
    const { get, seen } = client(db);
    const a = await pageAll(get, '', 100);
    assert.equal(a.total, n);
    assert.equal(a.uids.length, n);
    assert.equal(new Set(a.uids).size, n, 'a licence appeared twice');
    assert.ok(seen.maxBinds <= D1_MAX_BINDS);
    // The same order at a different page size: deterministic.
    const b = await pageAll(get, '', 37);
    assert.deepEqual(b.uids, a.uids);
    // The console's order: active first, terminated last.
    const first = (await get('?limit=1')).body.items[0];
    assert.equal(first.status, 'active');
    // A page is hydrated: seats come back for each of its rows.
    const page = (await get('?limit=100')).body.items;
    assert.ok(page.every((l: any) => l.seats.founder === Number(l.uid.slice(4))), 'a page lost its seats');
  });
}

test('#4700 search, kind and status run in SQL, before the page, and the total counts the matches', async () => {
  const db = ledgerDb(120);
  db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)').run(77, 'FR');
  const { get } = client(db);
  const wl = await pageAll(get, '&kind=white_label', 10);
  assert.equal(wl.total, 40);
  assert.equal(wl.uids.length, 40);
  const active = await get('?status=active&limit=5');
  assert.equal(active.body.total, 24);
  assert.ok(active.body.items.every((l: any) => l.status === 'active'));
  assert.deepEqual((await get('?q=AXL-0042')).body.items.map((l: any) => l.uid), ['lic_42']);
  assert.deepEqual((await get('?q=Entity%20119')).body.items.map((l: any) => l.uid), ['lic_119']);
  assert.deepEqual((await get('?q=fr')).body.items.map((l: any) => l.uid), ['lic_77'], 'a held country finds its licence');
  // LIKE's own characters are searched for, not obeyed.
  assert.equal((await get('?q=%25')).body.total, 0);
  assert.equal((await get('?kind=franchise')).status, 400);
  assert.equal((await get('?cursor=nonsense')).status, 400);
});

test('#4700 the summary is the whole ledger whichever page is open', async () => {
  const db = ledgerDb(150);
  const t = db.prepare('INSERT INTO licence_territories (licence_id, country_code) VALUES (?, ?)');
  t.run(1, 'FR'); t.run(1, 'BE'); t.run(149, 'DE'); t.run(150, 'IT'); // 149 % 5 == 4 → terminated, so DE is not held
  const { get } = client(db);
  const s = (await get('/summary')).body;
  const held = Object.fromEntries(s.coverage.map((c: any) => [c.uid, c.territories]));
  assert.deepEqual(held, { lic_1: ['BE', 'FR'], lic_150: ['IT'] }, 'licence 150 is on the last page; terminated 149 holds nothing');
  assert.equal(s.counts.total, 150);
  assert.equal(s.counts.by_kind.white_label, 50);
  assert.equal(s.counts.by_status.terminated, 30);
  // 75 odd licences carry a renewal date, 15 of them terminated.
  assert.equal(s.renewals.total, 60);
  assert.equal(s.renewals.items.length, 50);
  assert.equal(s.renewals.complete, false);
  const dates = s.renewals.items.map((r: any) => r.renews_on);
  assert.deepEqual([...dates].sort(), dates, 'soonest first');
});

function seedRequests(db: InstanceType<typeof DatabaseSync>) {
  db.prepare(`INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name) VALUES (?, ?, ?, ?, ?)`)
    .run('lic_1', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr-db');
  const esc = db.prepare(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status, created_at, due_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const add = (uid: string, branch: string, kind: string, ref: string | null, status = 'open', at = '2026-11-01T00:00:00Z') => {
    esc.run(uid, branch, kind, `Subject ${uid}`, ref, status, at, '2026-11-10T00:00:00Z');
  };
  // 150 unrelated open requests of the panel's kinds, all OLDER than this licence's.
  for (let i = 0; i < 150; i += 1) add(`other_${i}`, 'hq', 'renewal', 'lic_2', 'open', `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`);
  add('hq_req', 'hq', 'terms_change', 'lic_1');                      // HQ-origin, against this licence
  add('branch_req', 'fr', 'seat_increase', null, 'open', '2026-11-02T00:00:00Z'); // its branch raised it
  add('branch_other', 'de', 'seat_increase', null);                  // another branch
  add('hq_answered', 'hq', 'renewal', 'lic_1', 'answered');          // not open
  add('hq_wrong_kind', 'hq', 'content', 'lic_1');                    // not a panel kind
}

test('#4700 a licence\'s requests: HQ-origin and branch-origin, found behind 150 unrelated ones', async () => {
  const db = ledgerDb(3);
  seedRequests(db);
  const { get } = client(db);
  const r = await get('/lic_1/requests');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.available, true);
  assert.equal(r.body.branch_code, 'fr');
  assert.equal(r.body.branch_readable, true);
  assert.equal(r.body.total, 2);
  assert.deepEqual(r.body.items.map((i: any) => i.uid), ['hq_req', 'branch_req']);
  assert.equal(r.body.next_cursor, null);
  assert.ok(r.body.items.every((i: any) => ['ok', 'due_soon', 'past'].includes(i.sla)), 'each row carries its band');
  assert.ok('request' in r.body.items[0], 'each row carries its request view');
});

test('#4700 a licence\'s requests page with a cursor and the total stays the total', async () => {
  const db = ledgerDb(3);
  seedRequests(db);
  const { get } = client(db);
  const p1 = await get('/lic_2/requests?limit=100');
  assert.equal(p1.body.total, 150);
  assert.equal(p1.body.items.length, 100);
  assert.ok(p1.body.next_cursor);
  const p2 = await get(`/lic_2/requests?limit=100&cursor=${encodeURIComponent(p1.body.next_cursor)}`);
  assert.equal(p2.body.items.length, 50);
  assert.equal(p2.body.next_cursor, null);
  const all = [...p1.body.items, ...p2.body.items].map((i: any) => i.uid);
  assert.equal(new Set(all).size, 150);
  assert.equal((await get('/lic_2/requests?cursor=%5B1%5D')).status, 400);
  assert.equal((await get('/nope/requests')).status, 404);
});

test('#4700 an unreadable register or board is said, never shown as none', async () => {
  const noRegister = ledgerDb(2, { register: false });
  noRegister.exec(`INSERT INTO hq_escalations (uid, branch_code, kind, subject, subject_ref, status)
                   VALUES ('h1', 'hq', 'renewal', 'Renew', 'lic_1', 'open')`);
  const a = await client(noRegister).get('/lic_1/requests');
  assert.equal(a.body.branch_readable, false, 'branch-origin requests were not looked for, and it says so');
  assert.equal(a.body.total, 1);
  const noBoard = ledgerDb(2, { board: false });
  const b = await client(noBoard).get('/lic_1/requests');
  assert.equal(b.status, 200);
  assert.equal(b.body.available, false);
  assert.match(b.body.reason, /unknown — not none/);
});

test('#4700 the reads are Super Admin\'s', async () => {
  const db = ledgerDb(2);
  db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)').run(11, 'admin', 'Not Super');
  const { get } = client(db);
  for (const p of ['', '/summary', '/lic_1/requests']) {
    const r = await get(p, 11);
    assert.ok(r.status >= 400, `${p} answered a non-super admin`);
  }
});
