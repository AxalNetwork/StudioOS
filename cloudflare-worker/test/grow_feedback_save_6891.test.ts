/**
 * D6865 part 2 (#6891) — Grow v2 › Customers › Feedback, the Worker half of
 * Save as feedback (the #6099 canvas, GR-24, GR-25, GR-29C): a feedback item
 * saved from an Inbox reply names the reply (`product_feedback.reply_key`,
 * migration 202611220349), the Inbox thread read says which replies are saved
 * and as which item, and the sheets' Customer record chooser reads the
 * venture's contacts from Product improvement's form-options. On real SQLite
 * (the production baseline plus every migration after the cutoff). Every
 * venture, person and reply below is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/grow_feedback_save_6891.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import cycleGrow from '../src/routes/cycle_grow.ts';
import inbox from '../src/routes/grow_inbox.ts';
import { createCycleRecords } from '../src/routes/cycle_records.ts';
import { REPLY_KEY } from '../src/services/growWriters.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const BASELINE = readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-6891-0123456789-abcdef';
const FOUNDER = 1; const ADVISOR = 3; const OTHER = 6;
const PA = 7; const PB = 8;
const MAIL = `mail:${'ab12'.repeat(16)}`;

const newer = readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n)).filter((n) => migrationNumber(n) > BASELINE_CUTOFF).sort(compareMigrations);

// The migrated schema is built once; each test rolls back to it (DDL included: SQLite's savepoints hold it).
let built: DatabaseSync | null = null;
function fixture() {
  if (built) built.exec('ROLLBACK TO fx');
  else {
    built = new DatabaseSync(':memory:');
    built.exec('PRAGMA foreign_keys = ON;');
    built.exec(BASELINE);
    for (const name of newer) built.exec(readFileSync(resolve(M, name), 'utf8'));
    built.exec('SAVEPOINT fx');
  }
  const db = built;
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Founder A', 'fa@example.test'), (20, 'Founder B', 'fb@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES (${FOUNDER}, 'founder@example.test', 'Fay Founder', 'founder', 10),
      (${ADVISOR}, 'advisor@example.test', 'Ada Advisor', 'founder', NULL), (${OTHER}, 'other@example.test', 'Oli Other', 'founder', 20);
    INSERT INTO projects (id, name, founder_id) VALUES (${PA}, 'Kestrel Labs', 10), (${PB}, 'Heron Works', 20);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PA}, ${ADVISOR}, 'advisor', 'accepted');
    INSERT INTO contacts (id, uid, project_id, audience, name, organization, email, status) VALUES
      (11, 'ca1', ${PA}, 'customer', 'Kai Mori', 'Kite Systems', 'kai@kite.test', 'replied'),
      (12, 'ca2', ${PA}, 'customer', 'Lin Park', 'Ostra Depot', 'lin@ostra.test', 'new'),
      (13, 'cb1', ${PB}, 'customer', 'Heron Person', 'Heron Co', 'hp@heron.test', 'replied');
    INSERT INTO contact_replies (id, contact_id, direction, body, created_at) VALUES
      (21, 11, 'inbound', 'A CSV of each depot every Monday would get us over the line.', '2026-10-22 10:00:00'),
      (22, 11, 'outbound', 'Thanks, noted.', '2026-10-22 11:00:00'),
      (23, 12, 'inbound', 'Thursday works.', '2026-10-19 10:00:00'),
      (24, 13, 'inbound', 'Another venture reply.', '2026-10-20 10:00:00');`);
  return { db, env: { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any };
}

const app = new Hono<any>();
app.route('/api/cycles/grow', cycleGrow);
app.route('/api/grow/inbox', inbox);
app.route('/api/cycles', createCycleRecords());

async function call(f: { env: any }, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`); }
}
const save = (f: any, body: Record<string, unknown>, who = FOUNDER) => call(f, who, 'POST', '/api/cycles/grow/feedback',
  { project: PA, body: 'A CSV of each depot every Monday', source: 'customer', from_name: 'Kai Mori', origin: 'inbox_reply', contact_uid: 'ca1', ...body });
const row = (f: any, uid: string) => ({ ...(f.db.prepare('SELECT * FROM product_feedback WHERE uid = ?').get(uid) as any) });

test('a reply key is a recorded reply or a mailbox digest, nothing else', () => {
  assert.ok(REPLY_KEY.test('contact:21'));
  assert.ok(REPLY_KEY.test(MAIL));
  for (const bad of ['contact:0', 'contact:', 'sent:abc', 'mail:ABC', `mail:${'a'.repeat(63)}`, ' contact:21', 'contact:21 ']) assert.equal(REPLY_KEY.test(bad), false, bad);
});

test('Save as feedback from an Inbox reply links the reply, the contact and the origin', async () => {
  const f = fixture();
  const r = await save(f, { reply_key: 'contact:21', theme: 'Fleet CSV', notify_on_ship: true, from_email: 'kai@kite.test' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const saved = row(f, r.body.uid);
  assert.equal(saved.reply_key, 'contact:21');
  assert.equal(saved.contact_uid, 'ca1');
  assert.equal(saved.origin, 'inbox_reply');
  assert.equal(saved.notify_on_ship, 1);
  const log = f.db.prepare("SELECT details FROM activity_logs WHERE action = 'grow_feedback_logged'").all() as any[];
  assert.deepEqual(log.map((l) => l.details), ['Feedback saved from an Inbox reply']);
  // A mailbox reply is a digest: its shape is checked, and it saves.
  const m = await save(f, { reply_key: MAIL });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  assert.equal(row(f, m.body.uid).reply_key, MAIL);
});

test('one reply becomes one feedback item: a second save is a 409 naming the item', async () => {
  const f = fixture();
  const first = await save(f, { reply_key: 'contact:21' });
  const again = await save(f, { reply_key: 'contact:21', body: 'Saved twice' });
  assert.equal(again.status, 409);
  assert.equal(again.body.field, 'reply_key');
  assert.equal(again.body.uid, first.body.uid);
  assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM product_feedback WHERE reply_key = 'contact:21'").get() as any).n, 1);
});

test('a reply that is not an inbound reply of the linked contact in this venture is refused', async () => {
  const f = fixture();
  const cases: [Record<string, unknown>, number, string][] = [
    [{ reply_key: 'contact:22' }, 404, 'reply_key'], // our own outbound answer
    [{ reply_key: 'contact:23' }, 404, 'reply_key'], // another contact's reply in this venture
    [{ reply_key: 'contact:24' }, 404, 'reply_key'], // another venture's reply
    [{ reply_key: 'contact:999' }, 404, 'reply_key'],
    [{ reply_key: 'sent:own-sent' }, 400, 'reply_key'],
    [{ reply_key: 'contact:21', origin: 'typed' }, 400, 'reply_key'],
    [{ reply_key: 'contact:21', contact_uid: null }, 400, 'contact_uid'],
    [{ reply_key: 'contact:21', contact_uid: 'cb1' }, 404, 'contact_uid'],
  ];
  for (const [body, status, field] of cases) {
    const r = await save(f, body);
    assert.equal(r.status, status, JSON.stringify([body, r.body]));
    assert.equal(r.body.field, field, JSON.stringify(body));
  }
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM product_feedback').get() as any).n, 0, 'nothing was written');
  assert.equal((await save(f, { reply_key: 'contact:21' }, ADVISOR)).status, 403, 'an advisor cannot save');
});

test('an interview passage saves with origin Interview and no link; the typed name stays', async () => {
  const f = fixture();
  const r = await call(f, FOUNDER, 'POST', '/api/cycles/grow/feedback', { project: PA, body: 'A file per depot every Monday', source: 'customer', from_name: 'Hanne Vik', from_company: 'Ostra Depot AS', origin: 'interview' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const saved = row(f, r.body.uid);
  assert.deepEqual([saved.origin, saved.contact_uid, saved.reply_key, saved.from_name], ['interview', null, null, 'Hanne Vik']);
  assert.equal((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'grow_feedback_logged'").get() as any).details, 'Feedback saved from an interview');
});

test('the Inbox thread names each reply already saved, in its own thread and venture only', async () => {
  const f = fixture();
  const first = await save(f, { reply_key: 'contact:21' });
  // Another venture's item that happens to carry the same contact uid and key is never read here.
  f.db.exec(`INSERT INTO product_feedback (uid, project_id, body, source, status, contact_uid, origin, reply_key) VALUES ('fb-x', ${PB}, 'x', 'customer', 'open', 'ca1', 'inbox_reply', 'contact:22')`);
  const t = await call(f, FOUNDER, 'GET', `/api/grow/inbox/ca1?project=${PA}`);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.feedback_state, 'ready');
  const byKey = Object.fromEntries(t.body.thread.messages.map((m: any) => [m.key, m.feedback]));
  assert.deepEqual(byKey['contact:21'], { uid: first.body.uid, status: 'open' });
  assert.equal(byKey['contact:22'], null, "another venture's item with this thread's contact and key is not this thread's");
  const other = await call(f, FOUNDER, 'GET', `/api/grow/inbox/ca2?project=${PA}`);
  assert.equal(other.body.thread.messages.find((m: any) => m.key === 'contact:23').feedback, null, "a key saved in another venture's thread is not this one's");
  // A reader sees the tag too; it names an item, not a person.
  const advisor = await call(f, ADVISOR, 'GET', `/api/grow/inbox/ca1?project=${PA}`);
  assert.equal(advisor.status, 200);
  assert.deepEqual(advisor.body.thread.messages.find((m: any) => m.key === 'contact:21').feedback, { uid: first.body.uid, status: 'open' });
});

test('a failed read of the saved replies says so and still draws the thread', async () => {
  const f = fixture();
  f.db.exec('DROP INDEX idx_product_feedback_reply; ALTER TABLE product_feedback DROP COLUMN reply_key;');
  const t = await call(f, FOUNDER, 'GET', `/api/grow/inbox/ca1?project=${PA}`);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(t.body.feedback_state, 'unreadable');
  assert.ok(t.body.thread.messages.length >= 2);
});

test("the sheets' Customer record chooser lists this venture's contacts, for writers only", async () => {
  const f = fixture();
  const o = await call(f, FOUNDER, 'GET', `/api/cycles/grow/modules/product-improvement/form-options?project=${PA}`);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.deepEqual(o.body.contacts.map((c: any) => c.value).sort(), ['ca1', 'ca2']);
  const kai = o.body.contacts.find((c: any) => c.value === 'ca1');
  assert.deepEqual(kai, { value: 'ca1', label: 'Kai Mori · Kite Systems · Customer', name: 'Kai Mori', email: 'kai@kite.test', organization: 'Kite Systems', audience: 'customer', status: 'replied' });
  assert.equal((await call(f, ADVISOR, 'GET', `/api/cycles/grow/modules/product-improvement/form-options?project=${PA}`)).status, 403);
  assert.equal((await call(f, OTHER, 'GET', `/api/cycles/grow/modules/product-improvement/form-options?project=${PA}`)).status, 403);
});
