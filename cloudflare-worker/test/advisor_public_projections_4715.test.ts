/**
 * #4715 — what the advisor routes show one member about another.
 *
 *   GET /api/advisors and /match   no advisor's account email; id and user_id stay
 *   GET /api/advisors/:uid/slots   the meeting link and slot notes go to the advisor,
 *                                  an admin, and a founder whose booking on that slot
 *                                  is confirmed or completed; everyone else sees only
 *                                  `has_meeting_link`
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_public_projections_4715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const LINK = 'https://meet.example.test/room-1';

// 11 founder who booked slot 1 (confirmed) and slot 2 (pending); 12 another founder;
// 21 the advisor; 30 an admin.
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(102,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),(12,'Other','o@example.test','founder',102,1),
      (21,'Advisor','a@example.test','advisor',NULL,1),(30,'Admin','ad@example.test','admin',NULL,1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor','a@example.test',1);
  `);
  const s = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity,meeting_url,notes) VALUES (?,?,?,?,?,?,?,?)');
  s.run(1, 's-1', 201, later(1), later(1.1), 2, LINK, 'Advisor note one');
  s.run(2, 's-2', 201, later(2), later(2.1), 2, LINK, 'Advisor note two');
  s.run(3, 's-3', 201, later(3), later(3.1), 1, null, null);
  const b = db.prepare('INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status) VALUES (?,?,?,?,?)');
  b.run('b-1', 1, 201, 11, 'confirmed');
  b.run('b-2', 2, 201, 11, 'pending');
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const get = async (path: string, who: number) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  return { db, get };
}

const byUid = (items: any[]) => Object.fromEntries(items.map((x) => [x.uid, x]));

test('slots: a founder with no booking sees no link and no notes, only whether a link exists', async () => {
  const { get } = fixture();
  const r = await get('/a-1/slots', 12);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3);
  for (const s of r.body.items) {
    assert.ok(!('meeting_url' in s), `slot ${s.uid} carries no meeting_url`);
    assert.ok(!('notes' in s), `slot ${s.uid} carries no notes`);
    assert.ok(!JSON.stringify(s).includes('meet.example.test'));
  }
  const slots = byUid(r.body.items);
  assert.equal(slots['s-1'].has_meeting_link, true);
  assert.equal(slots['s-3'].has_meeting_link, false);
  assert.equal(slots['s-1'].taken, 1, 'the booking counts still read');
  assert.equal(slots['s-1'].available, 1);
});

test('slots: a founder sees the link on the slot their confirmed booking holds, not on a pending one', async () => {
  const { get } = fixture();
  const slots = byUid((await get('/a-1/slots', 11)).body.items);
  assert.equal(slots['s-1'].meeting_url, LINK);
  assert.equal(slots['s-1'].notes, 'Advisor note one');
  assert.ok(!('meeting_url' in slots['s-2']), 'a pending booking does not open the link');
  assert.ok(!('notes' in slots['s-2']));
});

test('slots: a completed booking keeps the link; a cancelled one does not', async () => {
  const { db, get } = fixture();
  db.prepare("UPDATE advisor_bookings SET status = 'completed' WHERE uid = 'b-1'").run();
  db.prepare("UPDATE advisor_bookings SET status = 'cancelled' WHERE uid = 'b-2'").run();
  const slots = byUid((await get('/a-1/slots', 11)).body.items);
  assert.equal(slots['s-1'].meeting_url, LINK);
  assert.ok(!('meeting_url' in slots['s-2']));
});

for (const [who, label] of [[21, 'the advisor'], [30, 'an admin']] as const) {
  test(`slots: ${label} sees every slot whole`, async () => {
    const { get } = fixture();
    const slots = byUid((await get('/a-1/slots', who)).body.items);
    assert.equal(slots['s-1'].meeting_url, LINK);
    assert.equal(slots['s-2'].notes, 'Advisor note two');
    assert.equal(slots['s-3'].meeting_url, null);
  });
}

test('directory and match: no advisor email, id and user_id kept', async () => {
  const { get } = fixture();
  const list = await get('', 12);
  assert.equal(list.status, 200);
  const items = list.body.items ?? list.body;
  assert.equal(items.length, 1);
  assert.ok(!('email' in items[0]));
  assert.ok(!JSON.stringify(list.body).includes('a@example.test'));
  assert.equal(items[0].id, 201);
  assert.equal(items[0].user_id, 21);
  const match = await get('/match', 12);
  assert.equal(match.status, 200);
  const rows = match.body.items ?? match.body.matches ?? match.body;
  assert.ok(Array.isArray(rows) && rows.length === 1, 'the advisor is matched');
  assert.ok(!('email' in rows[0].advisor));
  assert.ok(!JSON.stringify(match.body).includes('a@example.test'));
  assert.equal(rows[0].advisor.user_id, 21);
});
