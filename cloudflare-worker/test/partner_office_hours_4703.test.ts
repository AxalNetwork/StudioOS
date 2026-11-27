/**
 * D4703 (#4703) part 2: partner office hours get the booking fixes part 1
 * made to advisor bookings (`advisors.ts`), because the flow is a copy of it.
 *
 *   · a slot cancelled with bookings on it cleans up each one's calendar copy;
 *   · confirm and cancel write only from the status they read;
 *   · a new booking's calendar copy is tentative until the partner confirms.
 *
 * Real router, real SQLite from the schema baseline. Synthetic people.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import partnerOfficeHours from '../src/routes/partner_office_hours.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'test'.repeat(16); // the shared synthetic seed (see .gitleaksignore)
const PARTNER_USER = 21, FOUNDER = 22, OTHER_FOUNDER = 23;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO partners (id, name, email, company) VALUES (7, 'Synthetic Partner', 'partner@example.test', 'Example Partners');
    INSERT INTO users (id, email, name, role, is_active, partner_id) VALUES
      (${PARTNER_USER}, 'p@example.test', 'Pat', 'partner', 1, 7),
      (${FOUNDER}, 'f@example.test', 'Fran', 'founder', 1, NULL),
      (${OTHER_FOUNDER}, 'o@example.test', 'Otto', 'founder', 1, NULL);
    INSERT INTO partner_office_hour_slots (id, uid, partner_id, starts_at, ends_at, capacity, is_cancelled)
      VALUES (1, 'slot-1', 7, '2026-12-01T15:00:00Z', '2026-12-01T16:00:00Z', 3, 0);`);
  return db;
}
const book = (db: any, id: number, founder: number, status: string) =>
  db.prepare("INSERT INTO partner_bookings (id, uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES (?, ?, 1, 7, ?, ?, '2026-11-07', '2026-11-07')")
    .run(id, `pb-${id}`, founder, status);

async function call(DB: any, method: string, path: string, who: number, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const deferred: Promise<unknown>[] = [];
  const init: RequestInit = { method, headers: { Cookie: `studioos_auth=${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const res = await partnerOfficeHours.request(path, init, { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any,
    { waitUntil(p: Promise<unknown>) { deferred.push(p); }, passThroughOnException() {} } as any);
  await Promise.allSettled(deferred);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

/** The D1 binding, recording each calendar lookup's booking id and each calendar push's event. */
function watching(db: any) {
  const base = d1Over(db);
  const looked: number[] = [];
  return {
    looked,
    DB: { ...base, prepare(sql: string) {
      const st = base.prepare(sql);
      if (!/FROM calendar_sync_records/.test(sql)) return st;
      return { ...st, bind: (...b: any[]) => { looked.push(Number(b[1])); return st.bind(...b); } };
    } },
  };
}

test('cancelling a slot cleans up each of its bookings’ calendar copies', async () => {
  // Mutation checked: the slot delete's deferCalendarCancel removed → no lookups.
  const db = fixture();
  book(db, 31, FOUNDER, 'confirmed'); book(db, 32, OTHER_FOUNDER, 'pending');
  const w = watching(db);
  const r = await call(w.DB, 'DELETE', '/me/slots/1', PARTNER_USER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bookings_cancelled, 2);
  assert.deepEqual(w.looked.sort(), [31, 32]);
  assert.deepEqual(db.prepare('SELECT status FROM partner_bookings ORDER BY id').all().map((x: any) => x.status), ['cancelled', 'cancelled']);
});

test('a confirm that races a cancel changes nothing and says so', async () => {
  // Mutation checked: `AND status = ?` removed → the confirm overwrites the cancel.
  const db = fixture();
  book(db, 41, FOUNDER, 'pending');
  const base = d1Over(db);
  const racing = { ...base, prepare(sql: string) {
    if (sql.startsWith('UPDATE partner_bookings SET status=?')) db.exec("UPDATE partner_bookings SET status = 'cancelled' WHERE id = 41");
    return base.prepare(sql);
  } };
  const r = await call(racing, 'POST', '/bookings/41/confirm', PARTNER_USER);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT status FROM partner_bookings WHERE id = 41').get() as any).status, 'cancelled');
  book(db, 42, OTHER_FOUNDER, 'pending');
  assert.equal((await call(d1Over(db), 'POST', '/bookings/42/confirm', PARTNER_USER)).status, 200);
});

test('a new booking’s calendar copy is tentative, and confirming it pushes it firm', async () => {
  // Mutation checked: the booking's ics_status removed → the push carries no TENTATIVE.
  const src = readFileSync(new URL('../src/routes/partner_office_hours.ts', import.meta.url), 'utf8');
  const push = src.slice(src.indexOf("id: `partner_office_hour:${rowId}`"), src.indexOf('onAxalSessionCreated(c.env, ev)'));
  assert.match(push, /status: 'pending',\s*\n\s*ics_status: 'TENTATIVE' as const/, 'the first push is tentative');
  assert.match(src, /if \(opts\.nextStatus === 'confirmed'\) deferCalendarConfirm\(c, id\);/, 'confirm pushes again');
  assert.match(src.slice(src.indexOf('function deferCalendarConfirm')), /ics_status: 'CONFIRMED'/, 'as confirmed');
});
