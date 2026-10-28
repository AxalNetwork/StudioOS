/**
 * D1352 (#3567, part 3 of #3564): the Worker reads the LinkedIn page needs.
 * Synthetic people on the migrated schema.
 *
 *   · GET /api/contacts/book: the member's own book only, each row with its
 *     sources (so the page says "From LinkedIn"), note count and open
 *     follow-ups; search by name or company, `%` and `_` taken literally.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contactImports from '../src/routes/contact_imports.ts';
import { BOOK_PAGE } from '../src/services/linkedinCsvImport.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1352-only-not-a-real-credential'.repeat(2);

function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(2, 'founder', 'Synthetic member 2', 'synthetic-2@example.invalid');
  u.run(3, 'founder', 'Synthetic member 3', 'synthetic-3@example.invalid');
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,title,source,linkedin_url,connected_on) VALUES (?,?,?,?,?,?,?,?,?)');
  nc.run(21, 2, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'CTO', 'linkedin_csv', 'https://www.linkedin.com/in/synthetic-ada', '2024-03-12');
  nc.run(22, 2, 'Synthetic Bob', null, '100%_Co', null, 'manual', null, null);
  nc.run(23, 2, 'Synthetic Carl', null, 'Acme', null, 'csv', null, null);
  nc.run(31, 3, 'Their Ada', null, 'Acme', null, 'linkedin_csv', null, null);
  const src = db.prepare("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (?,'network_connections',?,?,?)");
  src.run(2, 21, 'linkedin_csv', 1); src.run(2, 23, 'csv', 1); src.run(2, 23, 'linkedin_csv', 0); src.run(3, 31, 'linkedin_csv', 1);
  db.exec("INSERT INTO network_contact_notes(uid,owner_user_id,contact_id,body) VALUES ('n1',2,21,'Synthetic note')");
  db.exec("INSERT INTO network_contact_tasks(uid,owner_user_id,contact_id,title,done_at) VALUES ('t1',2,21,'Follow up',NULL),('t2',2,21,'Done one','2026-10-01')");
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

test('the book is the member\'s own, each row with its sources, notes and open follow-ups', async () => {
  const f = fixture();
  try {
    const r = await get(f, 2, '/api/contacts/book');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.total, r.body.page, r.body.page_size], [3, 1, BOOK_PAGE]);
    assert.deepEqual(r.body.contacts.map((c: any) => [c.id, c.sources, c.notes, c.open_tasks]), [
      [21, ['linkedin_csv'], 1, 1], [22, [], 0, 0], [23, ['csv', 'linkedin_csv'], 0, 0],
    ]);
    assert.equal(r.body.contacts[0].linkedin_url, 'https://www.linkedin.com/in/synthetic-ada', 'the member\'s own row, whole');
    const theirs = await get(f, 3, '/api/contacts/book');
    assert.deepEqual(theirs.body.contacts.map((c: any) => c.id), [31], 'another member sees only their own');
    assert.deepEqual((await get(f, 3, '/api/contacts/book?q=synthetic')).body.contacts, []);
  } finally { f.close(); }
});

test('search by name or company; % and _ are literal', async () => {
  const f = fixture();
  try {
    assert.deepEqual((await get(f, 2, '/api/contacts/book?q=acme')).body.contacts.map((c: any) => c.id), [21, 23]);
    assert.deepEqual((await get(f, 2, '/api/contacts/book?q=BOB')).body.contacts.map((c: any) => c.id), [22]);
    assert.deepEqual((await get(f, 2, '/api/contacts/book?q=100%25_')).body.contacts.map((c: any) => c.id), [22]);
    assert.deepEqual((await get(f, 2, '/api/contacts/book?q=%25')).body.contacts.map((c: any) => c.id), [22], '% matches only a literal %');
    assert.deepEqual((await get(f, 2, '/api/contacts/book?page=2')).body.contacts, []);
    assert.equal((await get(f, 2, '/api/contacts/book?page=2')).body.total, 3);
  } finally { f.close(); }
});
