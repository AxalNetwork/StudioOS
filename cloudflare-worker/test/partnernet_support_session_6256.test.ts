/**
 * D6256 (#9016) — a support session never writes a member's partner network.
 *
 * The real partnernet router on node:sqlite with the migrated schema. Every
 * write handler the router declares is driven twice, each on its own fresh
 * database seeded so the write would succeed:
 *
 *   1. with a support-session token (`impersonated_by`): 403
 *      `support_session_refused`, and not one row in any table changes;
 *   2. with the member's own token: the write succeeds and changes rows.
 *
 * The list of writes is read from the router itself, so a write handler added
 * later fails here until it is listed — and, being listed, proves it refuses.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/partnernet_support_session_6256.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet from '../src/routes/partnernet.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

after(() => removeMigratedDatabases());

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const IDA = 10; // the member
const PAM = 20; // accepted tie
const OLI = 30; // Ida asked Oli (pending)
const LEO = 40; // second accepted tie, to remove
const NED = 50; // shares a deal with Ida, no tie yet
const GUS = 60; // asked Ida (pending), for her answer

type Db = InstanceType<typeof DatabaseSync>;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: Db) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { success: true, results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function seeded(): Db {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin@example.test', 'Ada Admin', 'admin');
  u.run(IDA, 'ida@example.test', 'Ida Investor', 'investor');
  u.run(PAM, 'pam@example.test', 'Pam Partner', 'partner');
  u.run(OLI, 'oli@example.test', 'Oli Outsider', 'investor');
  u.run(LEO, 'leo@example.test', 'Leo Lender', 'investor');
  u.run(NED, 'ned@example.test', 'Ned Neighbour', 'partner');
  u.run(GUS, 'gus@example.test', 'Gus Guest', 'investor');
  // A shared deal, so a tie request to Ned is one the member may make (D6636).
  db.exec("INSERT INTO projects (id, uid, name) VALUES (900, 'shared-9016', 'Synthetic shared venture')");
  db.exec('INSERT INTO deals (id, project_id) VALUES (900, 900)');
  for (const id of [IDA, NED]) {
    db.prepare("INSERT INTO deal_invitations (deal_id, investor_user_id, status) VALUES (900, ?, 'invited')").run(id);
  }
  const rel = db.prepare(`INSERT INTO partner_relationships (id, partner_a_id, partner_b_id, relationship_type, strength_score, metadata, status, requested_by, requested_at)
                          VALUES (?, ?, ?, 'co_investor', 60, '{}', ?, ?, '2026-11-01T00:00:00.000Z')`);
  rel.run(1, IDA, PAM, 'accepted', IDA);
  rel.run(2, IDA, OLI, 'pending', IDA);
  rel.run(3, IDA, LEO, 'accepted', LEO);
  rel.run(4, IDA, GUS, 'pending', GUS);
  db.prepare(`INSERT INTO partner_interactions (uid, relationship_id, kind, note, interacted_at, recorded_by)
              VALUES ('int9016', 1, 'call', 'Synthetic call', '2026-11-02T00:00:00.000Z', ?)`).run(IDA);
  db.prepare(`INSERT INTO partner_reminders (uid, relationship_id, remind_at, note, done, created_by)
              VALUES ('rem9016', 1, '2026-12-01', 'Synthetic reminder', 0, ?)`).run(IDA);
  db.prepare(`INSERT INTO partner_book_contacts (uid, owner_user_id, name, email)
              VALUES ('book9016', ?, 'Synthetic Contact', 'contact@example.test')`).run(IDA);
  return db;
}

/** Every row of every table, so "nothing changed" means nothing. */
function snapshot(db: Db): string {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
  return JSON.stringify(out);
}

async function call(db: Db, method: string, path: string, body: unknown, claims: Record<string, unknown> = {}) {
  const tok = await new SignJWT({ user_id: IDA, role: 'investor', ...claims })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await partnernet.request(path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const SUPPORT = { impersonated_by: ADMIN };

/** Each write the router declares, with a request the member may make. */
const WRITES: Record<string, { path: string; body?: unknown; unchecked?: string }> = {
  'POST /relationships': { path: '/relationships', body: { partner_id: NED, relationship_type: 'co_investor' } },
  'POST /relationships/:id/respond': { path: '/relationships/4/respond', body: { decision: 'accept' } },
  'POST /relationships/:id/withdraw': { path: '/relationships/2/withdraw' },
  'POST /relationships/:id/remove': { path: '/relationships/3/remove' },
  'PATCH /relationships/:id': { path: '/relationships/1', body: { strength_score: 75, private_note: 'Synthetic note' } },
  'POST /relationships/:id/interactions': { path: '/relationships/1/interactions', body: { note: 'Synthetic coffee', kind: 'meeting' } },
  'POST /relationships/:id/interactions/:uid/void': { path: '/relationships/1/interactions/int9016/void' },
  'POST /relationships/:id/reminders': { path: '/relationships/1/reminders', body: { remind_at: '2027-01-15', note: 'Synthetic follow-up' } },
  'PATCH /reminders/:uid': { path: '/reminders/rem9016', body: { done: true } },
  // Its row is written once #9015 lands; until then logActivity's insert fails and is swallowed.
  'POST /activity/log': { path: '/activity/log', body: { action_type: 'dashboard_view' }, unchecked: '#9015' },
  'POST /book': { path: '/book', body: { name: 'Synthetic Person', relationship: 'prospect' } },
  'PATCH /book/:uid/relationship': { path: '/book/book9016/relationship', body: { relationship: 'client' } },
  'PATCH /book/:uid/owner': { path: '/book/book9016/owner', body: { firm_owner_id: IDA } },
  'POST /book/:uid/interactions': { path: '/book/book9016/interactions', body: { happened_at: '2026-11-03', note: 'Synthetic lunch' } },
};

test('the router declares exactly the writes this test drives, so a new one cannot skip the refusal', () => {
  const declared = [...new Set(
    partnernet.routes
      .filter((r) => r.method !== 'ALL' && !['GET', 'HEAD', 'OPTIONS'].includes(r.method))
      .map((r) => `${r.method} ${r.path}`),
  )].sort();
  assert.deepEqual(declared, Object.keys(WRITES).sort());
});

for (const [route, req] of Object.entries(WRITES)) {
  const method = route.split(' ')[0];

  test(`${route}: a support session is refused with support_session_refused and writes nothing`, async () => {
    const db = seeded();
    try {
      const before = snapshot(db);
      const r = await call(db, method, req.path, req.body, SUPPORT);
      assert.deepEqual([r.status, r.body?.error], [403, 'support_session_refused']);
      assert.equal(typeof r.body?.message, 'string');
      assert.equal(snapshot(db), before, 'no row changed');
    } finally { db.close(); }
  });

  test(`${route}: the member's own write still succeeds`, async () => {
    const db = seeded();
    try {
      const before = snapshot(db);
      const r = await call(db, method, req.path, req.body);
      assert.ok(r.status >= 200 && r.status < 300, `${route} answered ${r.status} ${JSON.stringify(r.body)}`);
      if (!req.unchecked) assert.notEqual(snapshot(db), before, 'the write changed rows');
    } finally { db.close(); }
  });
}

test('reads stay open to a support session', async () => {
  const db = seeded();
  try {
    const r = await call(db, 'GET', '/reminders', undefined, SUPPORT);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((i: any) => i.uid), ['rem9016']);
  } finally { db.close(); }
});
