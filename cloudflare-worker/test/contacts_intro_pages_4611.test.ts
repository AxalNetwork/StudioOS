/**
 * #4611 finding 8 — the contacts page and the introduction log, past their
 * old caps, with their counts beside them.
 *
 * The audit asked for coverage "beyond the current preview and first-page
 * boundaries, including the 500-contact and 100-request boundaries", and
 * nothing pinned either bound before this. These fixtures carry 505 contacts
 * and 105 requests.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contacts_intro_pages_4611.test.ts
 */
import { AI_LOG_SCHEMA, AI_BUDGET_MIGRATION } from './_ai_budget_fixture.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import contacts from '../src/routes/contacts.ts';
import { CONTACTS_PAGE_DEFAULT } from '../src/routes/contacts.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (f: string) => readFileSync(resolve(here, `../sql/migrations/${f}`), 'utf8');
const JWT_SECRET = 'unit-contacts-pages-4611-secret-0123456789';
const ME = { user: 80, founder_id: 180, projectA: 910, projectB: 911 };
const OTHER = { user: 81, founder_id: 181, project: 912 };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, founder_id INTEGER, partner_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      spinout_lab_active INTEGER, subscription_tier TEXT
    );
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, email TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE landing_pages (id INTEGER PRIMARY KEY, name TEXT, template_kit TEXT);
    CREATE TABLE raise_prospects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, project_id INTEGER NOT NULL, contact_id INTEGER,
      name TEXT, email TEXT, firm TEXT, stage TEXT NOT NULL DEFAULT 'to_contact', notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(migration('127_contacts.sql'));
  db.exec(migration('128_contact_promotion.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'));
  db.exec(migration('166_contact_attribution.sql'));
  db.exec(migration('386_contact_strength_organization.sql'));
  for (const who of [{ ...ME, project: ME.projectA }, OTHER]) {
    db.prepare('INSERT INTO users (id, role, founder_id, name) VALUES (?, ?, ?, ?)').run(who.user, 'founder', who.founder_id, `Founder ${who.user}`);
    db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(who.founder_id, `Founder ${who.user}`);
    db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)').run(who.project, `p${who.project}`, `Startup ${who.project}`, who.founder_id);
  }
  db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, ?)').run(ME.projectB, `p${ME.projectB}`, 'Startup B', ME.founder_id);
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  return db;
}

/**
 * `n` contacts on `project`, each one minute older than the last, so the sort
 * key descends with the index and the keyset walk is deterministic.
 */
function seedContacts(db: any, project: number, n: number, prefix: string, audience = 'investor') {
  const insert = db.prepare(
    `INSERT INTO contacts (uid, project_id, audience, email, name, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 1; i <= n; i += 1) {
    const at = new Date(Date.parse('2026-11-09T12:00:00Z') - i * 60_000).toISOString().replace('T', ' ').slice(0, 19);
    insert.run(`${prefix}-${i}`, project, audience, `${prefix}-${i}@example.test`, `${prefix} ${i}`, at);
  }
}

async function call(db: any, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await contacts.request(path, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  return { status: res.status, body: await res.json() as any };
}

// --------------------------------------------------------- the 500 boundary

test('every contact past the old 500 cap is reachable, one page at a time', async () => {
  const db = freshDb();
  seedContacts(db, ME.projectA, 505, 'a');
  const first = await call(db, ME.user, '/');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, CONTACTS_PAGE_DEFAULT);
  assert.equal(first.body.total, 505);
  assert.equal(first.body.has_more, true);

  // Walk the whole collection. 505 rows, 200 at a time, is three pages.
  const seen: string[] = [];
  let cursor: string | null = first.body.next_cursor;
  for (const row of first.body.items) seen.push(row.uid);
  let pages = 1;
  while (cursor) {
    const next = await call(db, ME.user, `/?cursor=${encodeURIComponent(cursor)}`);
    assert.equal(next.status, 200);
    for (const row of next.body.items) seen.push(row.uid);
    // THE TOTAL DOES NOT MOVE. It was tallied from the page before, so it
    // under-reported by exactly however much the cap had cut.
    assert.equal(next.body.total, 505);
    cursor = next.body.next_cursor;
    pages += 1;
  }
  assert.equal(pages, 3);
  assert.equal(seen.length, 505, 'the walk did not reach every contact');
  assert.equal(new Set(seen).size, 505, 'a contact appeared on two pages');
  // Newest first, and the 501st — unreachable before — is in there.
  assert.equal(seen[0], 'a-1');
  assert.ok(seen.includes('a-505'));
});

test('the counts are the whole scope\'s, not the page\'s', async () => {
  const db = freshDb();
  seedContacts(db, ME.projectA, 300, 'inv', 'investor');
  seedContacts(db, ME.projectA, 120, 'adv', 'advisor');
  const page = await call(db, ME.user, '/?limit=10');
  assert.equal(page.body.items.length, 10);
  assert.equal(page.body.page_size, 10);
  // 420 rows across two audiences, counted by SQL over the filter rather than
  // by walking `items` — which is what made both counts page counts.
  assert.equal(page.body.total, 420);
  assert.deepEqual(page.body.counts, { investor: 300, advisor: 120 });
  // And on page two, unchanged.
  const two = await call(db, ME.user, `/?limit=10&cursor=${encodeURIComponent(page.body.next_cursor)}`);
  assert.equal(two.body.total, 420);
  assert.deepEqual(two.body.counts, page.body.counts);
});

// ------------------------------------------- the project filter, before the page

test('the project filter runs on the server, inside the authorized scope and before the limit', async () => {
  const db = freshDb();
  // THE AUDIT'S SHAPE: one startup's contacts dominate the account, so the
  // other's fall outside any account-wide page. 600 on A, 40 on B.
  seedContacts(db, ME.projectA, 600, 'a');
  seedContacts(db, ME.projectB, 40, 'b');

  const b = await call(db, ME.user, `/?project_id=${ME.projectB}`);
  assert.equal(b.status, 200);
  // All 40, and nothing else — the client used to receive A's newest 500 and
  // filter B's out of them, finding none.
  assert.equal(b.body.total, 40);
  assert.equal(b.body.items.length, 40);
  assert.equal(b.body.has_more, false);
  assert.equal(b.body.scope, 'one project');
  for (const row of b.body.items) assert.equal(row.project_id, ME.projectB);

  const a = await call(db, ME.user, `/?project_id=${ME.projectA}`);
  assert.equal(a.body.total, 600);
  // Unfiltered is both startups.
  const all = await call(db, ME.user, '/');
  assert.equal(all.body.total, 640);
  assert.equal(all.body.scope, 'authorized projects');
});

test('a project outside the caller\'s scope is refused, and says nothing about whose it is', async () => {
  const db = freshDb();
  seedContacts(db, ME.projectA, 5, 'a');
  seedContacts(db, OTHER.project, 5, 'x');
  const theirs = await call(db, ME.user, `/?project_id=${OTHER.project}`);
  assert.equal(theirs.status, 403);
  assert.equal(theirs.body.error, 'project_not_authorized');
  // A project that does not exist is refused in the same words, so the refusal
  // confirms nothing about whether it is somebody else's or nobody's.
  const nothing = await call(db, ME.user, '/?project_id=99999');
  assert.equal(nothing.status, 403);
  assert.deepEqual(nothing.body, theirs.body);
  // A non-number is a different complaint: the request is malformed.
  const bad = await call(db, ME.user, '/?project_id=abc');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'project_invalid');
  // And no refusal leaked a row.
  assert.equal((await call(db, ME.user, '/')).body.total, 5);
});

test('a malformed cursor is refused, never read as the first page', async () => {
  const db = freshDb();
  seedContacts(db, ME.projectA, 5, 'a');
  for (const bad of ['nonsense', 'YWJj', 'a'.repeat(500)]) {
    const r = await call(db, ME.user, `/?cursor=${encodeURIComponent(bad)}`);
    assert.equal(r.status, 400, bad);
  }
  // Reading a bad cursor as page one is how a paginated export repeats its
  // first page for ever, which is worse than an error.
  const good = await call(db, ME.user, '/');
  assert.equal(good.status, 200);
  assert.equal(good.body.next_cursor, null);
  assert.equal(good.body.has_more, false);
});

test('two contacts sharing a sort key are both reached exactly once', async () => {
  const db = freshDb();
  // `COALESCE(last_activity_at, created_at)` is not unique, and a keyset cursor
  // over a non-total order loses or repeats a neighbour. `id DESC` is the
  // tiebreaker that makes the order total.
  const at = '2026-11-09 12:00:00';
  const insert = db.prepare(
    `INSERT INTO contacts (uid, project_id, audience, email, name, last_activity_at) VALUES (?, ?, 'investor', ?, ?, ?)`,
  );
  for (let i = 1; i <= 6; i += 1) insert.run(`same-${i}`, ME.projectA, `same-${i}@example.test`, `Same ${i}`, at);

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const r = await call(db, ME.user, `/?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const row of r.body.items) seen.push(row.uid);
    if (!r.body.next_cursor) break;
    cursor = r.body.next_cursor;
  }
  assert.equal(seen.length, 6);
  assert.equal(new Set(seen).size, 6, 'a row with a shared sort key was repeated or skipped');
});
