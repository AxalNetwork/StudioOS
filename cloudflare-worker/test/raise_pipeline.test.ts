/**
 * Raise Pipeline v1 — rounds, prospects (form + import), drawer detail, and
 * investor updates on /api/contacts/raise-*.
 *
 * Drives the REAL contacts Hono router against a node:sqlite-backed D1
 * adapter (mirrors event_badges_xp_level.test.ts). ensureSchema bootstraps
 * every contacts-domain table itself, so only `users` + `projects` (read by
 * requireRole / ownedProjectScope) are hand-created. One shared DB for the
 * whole file: contacts.ts caches ensureSchema behind a module-level flag, so
 * a per-test fresh DB would silently skip the bootstrap.
 *
 * Covers:
 *  - round upsert (create → update, single active row) + raised aggregation
 *    from committed prospects;
 *  - prospect create with contact create-or-link + duplicate 409;
 *  - CSV import created/skipped accounting;
 *  - drawer detail joining the linked contact;
 *  - investor updates: recipients exclude passed, timeline rows logged;
 *  - founder scoping (403 on another founder's project).
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/raise_pipeline.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import contacts from '../src/routes/contacts.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const prepare = (sql: string) => {
    let binds: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { binds = coerce(a); return api; },
      async first() { return db.prepare(sql).get(...binds) ?? null; },
      async all() { return { results: db.prepare(sql).all(...binds) }; },
      async run() {
        const r = db.prepare(sql).run(...binds);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // The raise-updates route batches timeline INSERTs — actually execute them.
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

// One DB + env for the whole file (see header comment).
const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    role TEXT,
    founder_id INTEGER,
    is_active INTEGER DEFAULT 1,
    name TEXT,
    email TEXT
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    founder_id INTEGER,
    name TEXT,
    deleted_at TEXT
  );
  INSERT INTO users (id, role, founder_id, name) VALUES (1, 'founder', 11, 'Alice');
  INSERT INTO users (id, role, founder_id, name) VALUES (2, 'founder', 22, 'Bob');
  INSERT INTO projects (id, founder_id, name) VALUES (100, 11, 'Alpha');
  INSERT INTO projects (id, founder_id, name) VALUES (200, 22, 'Beta');
`);
const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };

async function mintToken(userId: number, role = 'founder'): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(token: string, method: string, path: string, body?: any): Promise<Response> {
  return contacts.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, env);
}

test('round upsert: PUT creates the active round, a second PUT updates it in place', async () => {
  const alice = await mintToken(1);

  const created = await call(alice, 'PUT', '/raise-round', {
    project_id: 100, name: 'Seed', target_amount: 1_500_000, close_date: '2026-12-31',
  });
  assert.equal(created.status, 201);
  const round1: any = await created.json();
  assert.equal(round1.status, 'active');
  assert.equal(round1.target_amount, 1_500_000);

  const updated = await call(alice, 'PUT', '/raise-round', { project_id: 100, target_amount: 2_000_000 });
  assert.equal(updated.status, 200);
  const round2: any = await updated.json();
  assert.equal(round2.id, round1.id, 'second PUT must update, not create a second active round');
  assert.equal(round2.target_amount, 2_000_000);
  assert.equal(round2.name, 'Seed', 'omitted fields keep their value');
  assert.equal(round2.close_date, '2026-12-31');

  const n = db.prepare(`SELECT COUNT(*) AS n FROM raise_rounds WHERE project_id = 100 AND status = 'active'`).get() as any;
  assert.equal(Number(n.n), 1);
});

test('prospect create links a Contacts-hub row; duplicate email is a 409', async () => {
  const alice = await mintToken(1);

  const res = await call(alice, 'POST', '/raise-prospects', {
    project_id: 100, name: 'Jane VC', email: 'Jane@Fund.VC', firm: 'Fund VC', amount: 250000, stage: 'contacted',
  });
  assert.equal(res.status, 201);
  const p: any = await res.json();
  assert.equal(p.email, 'jane@fund.vc', 'email is normalized to lowercase');
  assert.equal(p.stage, 'contacted');
  assert.ok(p.contact_id, 'a contact row is created and linked');

  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(p.contact_id) as any;
  assert.equal(contact.audience, 'investor');
  assert.equal(contact.promoted_to, 'raise');
  assert.equal(Number(contact.promoted_ref_id), Number(p.id), 'contact points back at the prospect');

  const dup = await call(alice, 'POST', '/raise-prospects', { project_id: 100, email: 'jane@fund.vc' });
  assert.equal(dup.status, 409);
});

test('prospect create reuses an existing unpromoted contact instead of duplicating it', async () => {
  const alice = await mintToken(1);
  db.prepare(
    `INSERT INTO contacts (uid, project_id, audience, routed_to, email, status, created_at, updated_at)
     VALUES ('c-reuse', 100, 'investor', 'raise', 'reuse@fund.vc', 'new', datetime('now'), datetime('now'))`,
  ).run();

  const res = await call(alice, 'POST', '/raise-prospects', { project_id: 100, email: 'reuse@fund.vc', name: 'Reused' });
  assert.equal(res.status, 201);
  const p: any = await res.json();

  const contacts_ = db.prepare(`SELECT * FROM contacts WHERE email = 'reuse@fund.vc'`).all() as any[];
  assert.equal(contacts_.length, 1, 'no duplicate contact row');
  assert.equal(Number(contacts_[0].promoted_ref_id), Number(p.id));
  assert.equal(Number(p.contact_id), Number(contacts_[0].id));
});

test('import: counts created rows and reports skipped ones with reasons', async () => {
  const alice = await mintToken(1);
  const res = await call(alice, 'POST', '/raise-prospects/import', {
    project_id: 100,
    rows: [
      { name: 'Imp One', email: 'one@import.vc', amount: 50000 },
      { email: 'jane@fund.vc' },            // already in the pipeline
      { firm: 'No Identity Capital' },      // no name and no email
      { name: 'Imp Two' },                  // name-only is allowed
    ],
  });
  assert.equal(res.status, 200);
  const out: any = await res.json();
  assert.equal(out.created, 2);
  assert.equal(out.total, 4);
  assert.equal(out.skipped.length, 2);
  assert.deepEqual(out.skipped.map((s: any) => s.row).sort(), [2, 3]);
});

test('import caps at 50 rows per request', async () => {
  const alice = await mintToken(1);
  const rows = Array.from({ length: 51 }, (_, i) => ({ name: `Bulk ${i}` }));
  const res = await call(alice, 'POST', '/raise-prospects/import', { project_id: 100, rows });
  assert.equal(res.status, 400);
});

test('GET /raise-round aggregates raised from committed prospects only', async () => {
  const alice = await mintToken(1);

  const jane = db.prepare(`SELECT id FROM raise_prospects WHERE email = 'jane@fund.vc'`).get() as any;
  const commit = await call(alice, 'PUT', `/raise-prospects/${jane.id}`, { stage: 'committed', amount: 300000 });
  assert.equal(commit.status, 200);
  const committed: any = await commit.json();
  assert.equal(committed.stage, 'committed');
  assert.equal(committed.amount, 300000, 'PUT persists amount');

  const res = await call(alice, 'GET', '/raise-round?project_id=100');
  assert.equal(res.status, 200);
  const info: any = await res.json();
  assert.equal(info.raised, 300000, 'only committed prospects count toward raised');
  assert.equal(info.committed_count, 1);
  assert.equal(info.round.target_amount, 2_000_000);
});

test('drawer detail joins the linked contact record', async () => {
  const alice = await mintToken(1);
  const jane = db.prepare(`SELECT id FROM raise_prospects WHERE email = 'jane@fund.vc'`).get() as any;
  const res = await call(alice, 'GET', `/raise-prospects/${jane.id}`);
  assert.equal(res.status, 200);
  const detail: any = await res.json();
  assert.ok(detail.contact, 'detail includes the linked contact');
  assert.equal(detail.contact.email, 'jane@fund.vc');
  assert.equal(detail.contact.audience, 'investor');
});

test('investor update: recipients exclude passed prospects; timelines are logged', async () => {
  const alice = await mintToken(1);

  // Park one prospect in `passed` so it must be excluded.
  const one = db.prepare(`SELECT id FROM raise_prospects WHERE email = 'one@import.vc'`).get() as any;
  await call(alice, 'PUT', `/raise-prospects/${one.id}`, { stage: 'passed' });

  const active = db.prepare(
    `SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = 100 AND stage != 'passed'`,
  ).get() as any;
  const linked = db.prepare(
    `SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = 100 AND stage != 'passed' AND contact_id IS NOT NULL`,
  ).get() as any;

  const res = await call(alice, 'POST', '/raise-updates', {
    project_id: 100, subject: 'March update', body: 'MRR up 40%.',
  });
  assert.equal(res.status, 201);
  const update: any = await res.json();
  assert.equal(update.recipients_count, Number(active.n));
  assert.equal(update.logged_contacts, Number(linked.n));
  assert.ok(update.round_id, 'update is attached to the active round');

  const replies = db.prepare(
    `SELECT body FROM contact_replies WHERE direction = 'outbound' AND body LIKE 'Investor update — March update%'`,
  ).all() as any[];
  assert.equal(replies.length, Number(linked.n), 'one timeline row per linked contact');

  const list = await call(alice, 'GET', '/raise-updates?project_id=100');
  assert.equal(list.status, 200);
  const items: any = await list.json();
  assert.equal(items.items[0].subject, 'March update');
});

test('scoping: another founder gets 403 on someone else\'s project and prospects', async () => {
  const bob = await mintToken(2);

  assert.equal((await call(bob, 'GET', '/raise-round?project_id=100')).status, 403);
  assert.equal((await call(bob, 'PUT', '/raise-round', { project_id: 100, target_amount: 1 })).status, 403);
  assert.equal((await call(bob, 'POST', '/raise-prospects', { project_id: 100, name: 'Sneaky' })).status, 403);
  assert.equal((await call(bob, 'POST', '/raise-updates', { project_id: 100, subject: 'Hi' })).status, 403);

  const jane = db.prepare(`SELECT id FROM raise_prospects WHERE email = 'jane@fund.vc'`).get() as any;
  assert.equal((await call(bob, 'GET', `/raise-prospects/${jane.id}`)).status, 403);
  assert.equal((await call(bob, 'PUT', `/raise-prospects/${jane.id}`, { stage: 'passed' })).status, 403);

  // Bob's own project still works (no cross-contamination).
  const own = await call(bob, 'GET', '/raise-round?project_id=200');
  assert.equal(own.status, 200);
  const info: any = await own.json();
  assert.equal(info.round, null);
  assert.equal(info.raised, 0);
});

test('round validation: bad close_date is rejected to null, subject required for updates', async () => {
  const alice = await mintToken(1);

  const res = await call(alice, 'PUT', '/raise-round', { project_id: 100, close_date: 'not-a-date' });
  assert.equal(res.status, 200);
  const round: any = await res.json();
  assert.equal(round.close_date, null, 'malformed dates are stored as null, not garbage');

  assert.equal((await call(alice, 'POST', '/raise-updates', { project_id: 100, subject: '' })).status, 400);
});
