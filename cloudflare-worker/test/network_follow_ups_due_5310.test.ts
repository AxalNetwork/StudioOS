/**
 * #5310 (NW1, owner answer B1): "Needs attention" is overdue follow-ups only, on the member's own book.
 * Synthetic people on the migrated schema.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/network_follow_ups_due_5310.test.ts
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contactImports from '../src/routes/contact_imports.ts';
import { FOLLOW_UPS_DUE_MAX } from '../src/services/linkedinCsvImport.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-5310-only-not-a-real-credential'.repeat(2);

function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(2, 'founder', 'Synthetic member 2', 'synthetic-2@example.invalid');
  u.run(3, 'founder', 'Synthetic member 3', 'synthetic-3@example.invalid');
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,company,title,source) VALUES (?,?,?,?,?,?)');
  nc.run(21, 2, 'Synthetic Ada', 'Example Seed', 'Partner', 'linkedin_csv');
  nc.run(22, 2, 'Synthetic Ben', null, null, 'manual');
  nc.run(31, 3, 'Their Cara', 'Elsewhere', null, 'linkedin_csv');
  db.exec("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (2,'network_connections',21,'linkedin_csv',1)");
  db.exec(`INSERT INTO network_contact_notes(uid,owner_user_id,contact_id,body,created_at) VALUES ('n1',2,21,'Synthetic','2026-09-01 10:00:00'),('n2',2,21,'Later','2026-09-20 10:00:00')`);
  db.exec(`INSERT INTO network_contact_tasks(uid,owner_user_id,contact_id,title,due_on,done_at) VALUES
    ('t-old',2,21,'Send the update','2020-01-05',NULL),
    ('t-newer',2,22,'Ask about the pilot','2020-02-01',NULL),
    ('t-done',2,21,'Done already','2020-01-01','2020-01-02'),
    ('t-future',2,22,'Not yet','2999-01-01',NULL),
    ('t-undated',2,22,'No date',NULL,NULL),
    ('t-theirs',3,31,'Theirs','2020-01-01',NULL)`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/contacts', contactImports);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;
async function get(f: F, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  return { status: res.status, body: await res.json() as any };
}

// Mutation checked: done follow-ups counted (fails); undated or future ones counted (fails); another member's
// read (fails); newest due first (fails); the total read from the page (fails); last_note_at the first note (fails).
test('#5310: overdue open follow-ups only, the member\'s own, oldest due first, with a total that is not the page', async () => {
  const f = fixture();
  try {
    const r = await get(f, 2, '/api/contacts/book/follow-ups-due');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.total, 2);
    assert.deepEqual(r.body.items.map((i: any) => i.task_uid), ['t-old', 't-newer']);
    assert.deepEqual(r.body.items[0], {
      task_uid: 't-old', task_title: 'Send the update', due_on: '2020-01-05',
      contact: { id: 21, name: 'Synthetic Ada', company: 'Example Seed', title: 'Partner', sources: ['linkedin_csv'] },
      last_note_at: '2026-09-20 10:00:00',
    });
    assert.equal(r.body.items[1].last_note_at, null, 'no note recorded is null, never a date');
    const one = await get(f, 2, '/api/contacts/book/follow-ups-due?limit=1');
    assert.deepEqual([one.body.total, one.body.items.length], [2, 1], 'the count is every overdue follow-up');
    assert.deepEqual((await get(f, 3, '/api/contacts/book/follow-ups-due')).body.items.map((i: any) => i.task_uid), ['t-theirs']);
    const capped = await get(f, 2, '/api/contacts/book/follow-ups-due?limit=500');
    assert.ok(capped.body.items.length <= FOLLOW_UPS_DUE_MAX);
  } finally { f.close(); }
});

test('#5310: a follow-up whose contact is not in the member\'s book is never read', async () => {
  const f = fixture();
  try {
    // A stray task row naming another member's contact under this owner.
    f.db.exec("INSERT INTO network_contact_tasks(uid,owner_user_id,contact_id,title,due_on) VALUES ('t-stray',2,31,'Stray','2020-01-01')");
    const r = await get(f, 2, '/api/contacts/book/follow-ups-due');
    assert.ok(!r.body.items.some((i: any) => i.task_uid === 't-stray'));
    assert.equal(r.body.total, 2);
  } finally { f.close(); }
});

// #5310 (NW2): each book row carries its follow-up state and its last recorded activity, from the member's own rows.
// Mutation checked: a done or undated follow-up counted overdue (fails); the next due date taken from a done follow-up
// (fails); last_note_at the first note (fails); another member's follow-up counted (fails); no activity drawn as a date (fails).
test('#5310 (NW2): book rows carry overdue count, next due date, last note and last finished follow-up', async () => {
  const f = fixture();
  try {
    f.db.exec("INSERT INTO network_contact_tasks(uid,owner_user_id,contact_id,title,due_on,done_at) VALUES ('t-theirs-on-mine',3,21,'Not mine','2020-01-01',NULL)");
    const r = await get(f, 2, '/api/contacts/book');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.contacts.map((c: any) => [c.name, c]));
    const pick = (c: any) => [c.open_tasks, c.overdue_tasks, c.next_due_on, c.last_note_at, c.last_done_at];
    assert.deepEqual(pick(by['Synthetic Ada']), [1, 1, '2020-01-05', '2026-09-20 10:00:00', '2020-01-02']);
    assert.deepEqual(pick(by['Synthetic Ben']), [3, 1, '2020-02-01', null, null], 'undated and future follow-ups are open, not overdue');
  } finally { f.close(); }
});
