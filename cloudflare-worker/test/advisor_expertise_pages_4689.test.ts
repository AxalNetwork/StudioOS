/**
 * #4689 (Expertise P2) — the four Expertise lists page, every row stays
 * reachable, and every count is over the whole list, never the page shown.
 *
 *   services and proof   200 per page: 200 rows is one page, 201 is two
 *   thinking and links   100 per page: 100 rows is one page, 101 is two
 *   a booking on link 101 stays that link's, never "Booked without a link"
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_expertise_pages_4689.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';
import { pageFacts, pageWindow } from '../src/services/listPage.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
// Every row in a list shares this timestamp, so only the id tie-breaker orders them.
const SAME = '2026-10-01T09:00:00.000Z';

// 21 advisor (201), 22 another advisor (202).
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),(21,'Advisor','a@example.test','advisor',NULL,1),
      (22,'Advisor Two','a2@example.test','advisor',NULL,1);
    INSERT INTO advisors(id,uid,user_id,display_name,email) VALUES (201,'a-1',21,'Advisor','a@example.test'),(202,'a-2',22,'Advisor Two','a2@example.test');
  `);
  const fail = { table: null as null | string };
  const binding = d1Over(db);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: { ...binding, prepare(sql: string) {
    if (fail.table && new RegExp(`FROM ${fail.table}\\b`).test(sql)) {
      const statement: any = { bind: () => statement, all: async () => { throw new Error('D1_ERROR: synthetic read failed'); },
        first: async () => { throw new Error('D1_ERROR: synthetic read failed'); } };
      return statement;
    }
    return binding.prepare(sql);
  } } };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const get = async (path: string, who = 21) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    return { status: res.status, body: await res.json() as any };
  };
  return { db, get, fail };
}

/** Every page of a list, following `next_offset` to the end. */
async function allPages(get: (p: string) => Promise<any>, path: string, key = 'items') {
  const pages: any[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const r = await get(`${path}${path.includes('?') ? '&' : '?'}offset=${offset}`);
    assert.equal(r.status, 200);
    pages.push(r.body);
    offset = (key === 'surfaces' ? r.body.links : r.body.page).next_offset;
    assert.ok(pages.length < 10, 'next_offset ends');
  }
  return pages;
}

function addServices(db: any, n: number) {
  const s = db.prepare('INSERT INTO advisor_services(uid,advisor_id,title,is_active,price_cents,created_at) VALUES (?,?,?,?,?,?)');
  // Every third service is a draft, every fourth unpriced; one service of another advisor's.
  for (let i = 1; i <= n; i += 1) s.run(`svc-${i}`, 201, `Service ${i}`, i % 3 === 0 ? 0 : 1, i % 4 === 0 ? null : 1000 * i, SAME);
  s.run('svc-theirs', 202, 'Theirs', 1, 500, SAME);
}

for (const [n, pages] of [[200, 1], [201, 2]] as const) {
  test(`services: ${n} rows read as ${pages} page(s) of 200, every row once, counts over all ${n}`, async () => {
    const { db, get } = fixture();
    addServices(db, n);
    const read = await allPages(get, '/me/services');
    assert.equal(read.length, pages);
    const uids = read.flatMap((b) => b.items.map((s: any) => s.uid));
    assert.equal(uids.length, n);
    assert.equal(new Set(uids).size, n, 'no service repeats across pages');
    assert.ok(!uids.includes('svc-theirs'));
    const drafts = Math.floor(n / 3);
    const unpriced = Math.floor(n / 4);
    for (const b of read) {
      assert.deepEqual(b.counts, { total: n, live: n - drafts, draft: drafts, priced: n - unpriced, unpriced }, 'the counts are the whole list on every page');
      assert.equal(b.page.total, n);
    }
    assert.deepEqual(read[0].page, { offset: 0, limit: 200, total: n, next_offset: n > 200 ? 200 : null });
    // Same timestamp throughout, so the id tie-breaker alone orders them: live first, then newest id.
    const live = uids.filter((u) => Number(u.slice(4)) % 3 !== 0);
    assert.deepEqual(uids.slice(0, 3), live.slice(0, 3));
    assert.equal(uids[0], `svc-${Number(live[0].slice(4))}`);
    assert.ok(Number(uids[0].slice(4)) > Number(uids[1].slice(4)), 'ties broken by id, newest first');
  });
}

test('proof: 201 claims, the only confirmed one on page 2, still counted on page 1', async () => {
  const { db, get } = fixture();
  const p = db.prepare('INSERT INTO advisor_proof_items(id,uid,advisor_id,title,created_at) VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 201; i += 1) p.run(i, `pr-${i}`, 201, `Claim ${i}`, SAME);
  const consent = db.prepare('INSERT INTO advisor_proof_consents(uid,proof_item_id,attester_name,consent_given,withdrawn_at) VALUES (?,?,?,?,?)');
  // Item 1 is the oldest by id, so the last row of page 2. Item 2 had a consent withdrawn, item 3 one never given.
  consent.run('c-1', 1, 'Named Person', 1, null);
  consent.run('c-2', 2, 'Withdrew', 1, ago(1));
  consent.run('c-3', 3, 'Never gave', 0, null);
  const [one, two] = await allPages(get, '/me/proof');
  assert.equal(one.items.length, 200);
  assert.equal(one.items.filter((x: any) => x.status === 'attested').length, 0, 'no confirmed claim on page 1');
  assert.deepEqual(one.counts, { total: 201, attested: 1, self_stated: 200, awaiting: 1 }, 'the confirmed claim on page 2 is counted; item 3 awaits an answer');
  assert.deepEqual(two.items.map((x: any) => [x.uid, x.status]), [['pr-1', 'attested']]);
  assert.deepEqual(one.page, { offset: 0, limit: 200, total: 201, next_offset: 200 });
  assert.deepEqual(two.page, { offset: 200, limit: 200, total: 201, next_offset: null });
});

function addArticles(db: any, n: number) {
  const a = db.prepare('INSERT INTO articles(id,slug,title,author_user_id,status,views,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)');
  // Article 1, the last row of the shelf, is the most-opened piece; every tenth is a draft.
  for (let i = 1; i <= n; i += 1) {
    a.run(i, `art-${i}`, `Piece ${i}`, 21, i % 10 === 0 ? 'draft' : 'published', i === 1 ? 5000 : i, i % 10 === 0 ? null : SAME, SAME);
  }
  a.run(9999, 'theirs', 'Theirs', 22, 'published', 90000, SAME, SAME);
}

for (const [n, pages] of [[100, 1], [101, 2]] as const) {
  test(`thinking: ${n} pieces read as ${pages} page(s) of 100, counts and reach over all ${n}`, async () => {
    const { db, get } = fixture();
    addArticles(db, n);
    const read = await allPages(get, '/me/thinking');
    assert.equal(read.length, pages);
    const ids = read.flatMap((b) => b.items.map((x: any) => x.id));
    assert.equal(new Set(ids).size, n);
    assert.ok(!ids.includes(9999));
    let published = 0, opens = 0;
    for (let i = 1; i <= n; i += 1) if (i % 10 !== 0) { published += 1; opens += i === 1 ? 5000 : i; }
    for (const b of read) {
      assert.deepEqual(b.counts, { published, drafts: n - published, best_reach: 5000, total_reach: opens, talk_reach: null });
    }
  });
}

test('thinking: the most-opened piece on page 2 is still the best reach on page 1', async () => {
  const { db, get } = fixture();
  addArticles(db, 101);
  const r = await get('/me/thinking');
  assert.ok(!r.body.items.some((x: any) => x.id === 1), 'piece 1 is not on page 1');
  assert.equal(r.body.counts.best_reach, 5000);
});

function addLinks(db: any, n: number) {
  const l = db.prepare('INSERT INTO advisor_booking_links(id,uid,advisor_id,slug,audience,is_active) VALUES (?,?,?,?,?,?)');
  for (let i = 1; i <= n; i += 1) l.run(1000 + i, `l-${i}`, 201, `link-${i}`, 'public', 1);
  l.run(5000, 'l-theirs', 202, 'theirs', 'public', 1);
  let k = 0;
  return (linkId: number | null, status = 'confirmed', advisor = 201) => {
    k += 1;
    db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at) VALUES (?,?,?,?,?)').run(9000 + k, `s-${k}`, advisor, ago(2), ago(2));
    db.prepare('INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status,booking_link_id,created_at,updated_at) VALUES (?,?,?,11,?,?,?,?)')
      .run(`b-${k}`, 9000 + k, advisor, status, linkId, ago(2), ago(2));
  };
}

test('visibility: a booking on link 101 stays on link 101, never in "Booked without a link"', async () => {
  const { db, get } = fixture();
  const book = addLinks(db, 101);
  book(1001, 'pending');      // link 1, page 1
  book(1101, 'confirmed');    // link 101, page 2
  book(1101, 'completed');    // link 101, page 2
  book(null, 'confirmed');    // no link
  book(5000, 'confirmed');    // the other advisor's link, on this advisor: no link of theirs
  const [one, two] = await allPages(get, '/me/visibility', 'surfaces');
  const key = (b: any, k: string) => b.surfaces.find((s: any) => s.key === k);
  assert.equal(one.surfaces.filter((s: any) => s.kind === 'booking_link').length, 100);
  assert.equal(key(one, 'link:l-101'), undefined, 'link 101 is not on page 1');
  assert.deepEqual([key(one, 'no_link').requests, key(one, 'no_link').by_status], [2, { confirmed: 2 }],
    'only the booking with no link and the one on a link that is not theirs');
  assert.deepEqual([key(two, 'link:l-101').requests, key(two, 'link:l-101').by_status], [2, { confirmed: 1, completed: 1 }]);
  assert.deepEqual([key(two, 'no_link').requests], [2], 'the same no-link figure on every page');
  for (const b of [one, two]) {
    assert.deepEqual(b.requests, { total: 5, by_status: { pending: 1, confirmed: 3, completed: 1 } }, 'every request in the window, whatever page');
    assert.equal(b.links.total, 101);
  }
  assert.deepEqual(one.links, { offset: 0, limit: 100, total: 101, next_offset: 100 });
  assert.deepEqual(two.links, { offset: 100, limit: 100, total: 101, next_offset: null });
});

test('visibility: 100 links are one page; a failed link read is null everywhere, never a zero', async () => {
  const { db, get, fail } = fixture();
  addLinks(db, 100)(1100);
  const r = await get('/me/visibility');
  assert.deepEqual(r.body.links, { offset: 0, limit: 100, total: 100, next_offset: null });
  assert.equal(r.body.surfaces.find((s: any) => s.key === 'link:l-100').requests, 1);
  fail.table = 'advisor_booking_links';
  const bad = await get('/me/visibility');
  assert.equal(bad.status, 200);
  assert.deepEqual([bad.body.surfaces, bad.body.links, bad.body.requests, bad.body.unreadable], [null, null, null, true]);
  assert.equal(bad.body.writing.published, 0, 'the writing block still answers');
});

test('a failed count read is an error, never a page with a zero total', async () => {
  const { db, get, fail } = fixture();
  addServices(db, 3);
  fail.table = 'advisor_services';
  const r = await get('/me/services');
  assert.equal(r.status, 500);
  assert.equal(r.body.counts, undefined);
});

test('the page window: limit clamped to 1..max, offset never negative; next_offset ends at the total', () => {
  assert.deepEqual(pageWindow({}, 200), { offset: 0, limit: 200 });
  assert.deepEqual(pageWindow({ limit: '1000', offset: '-5' }, 200), { offset: 0, limit: 200 });
  assert.deepEqual(pageWindow({ limit: '0', offset: '7' }, 100), { offset: 7, limit: 1 });
  assert.deepEqual(pageWindow({ limit: 'x', offset: '2.5' }, 100), { offset: 0, limit: 100 });
  assert.deepEqual(pageFacts({ offset: 0, limit: 100 }, 100, 100), { offset: 0, limit: 100, total: 100, next_offset: null });
  assert.deepEqual(pageFacts({ offset: 0, limit: 100 }, 101, 100), { offset: 0, limit: 100, total: 101, next_offset: 100 });
  assert.deepEqual(pageFacts({ offset: 300, limit: 100 }, 101, 0), { offset: 300, limit: 100, total: 101, next_offset: null });
});
