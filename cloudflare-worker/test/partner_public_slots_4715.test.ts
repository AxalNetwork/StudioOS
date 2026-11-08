/**
 * #4715 — a partner's office-hour slots as another member reads them
 * (`GET /api/partner-office-hours/partners/:uid/slots`). The meeting link and
 * the partner's slot notes go to the partner, an admin, and a founder whose
 * booking on that slot is confirmed or completed; everyone else sees only
 * `has_meeting_link`. The same rule D4715 set for advisor slots.
 *
 * Real router, real SQLite from the schema baseline. Synthetic people.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_public_slots_4715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import partnerOfficeHours from '../src/routes/partner_office_hours.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'test'.repeat(16); // the shared synthetic seed (see .gitleaksignore)
const PARTNER_USER = 21, FOUNDER = 22, OTHER_FOUNDER = 23, ADMIN = 30, OTHER_PARTNER_USER = 24;
const LINK = 'https://meet.example.test/room-p';
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO partners (id, uid, name, email) VALUES (7, 'p-7', 'Synthetic Partner', 'partner@example.test'),
      (8, 'p-8', 'Other Partner', 'other@example.test');
    INSERT INTO users (id, email, name, role, is_active, partner_id) VALUES
      (${PARTNER_USER}, 'p@example.test', 'Pat', 'partner', 1, 7),
      (${OTHER_PARTNER_USER}, 'q@example.test', 'Quin', 'partner', 1, 8),
      (${FOUNDER}, 'f@example.test', 'Fran', 'founder', 1, NULL),
      (${OTHER_FOUNDER}, 'o@example.test', 'Otto', 'founder', 1, NULL),
      (${ADMIN}, 'a@example.test', 'Ada', 'admin', 1, NULL);`);
  const s = db.prepare('INSERT INTO partner_office_hour_slots (id, uid, partner_id, starts_at, ends_at, capacity, meeting_url, notes, is_cancelled) VALUES (?, ?, 7, ?, ?, 2, ?, ?, 0)');
  s.run(1, 'slot-1', later(1), later(1.1), LINK, 'Partner note one');
  s.run(2, 'slot-2', later(2), later(2.1), LINK, 'Partner note two');
  s.run(3, 'slot-3', later(3), later(3.1), null, null);
  const b = db.prepare("INSERT INTO partner_bookings (uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES (?, ?, 7, ?, ?, '2026-11-07', '2026-11-07')");
  b.run('pb-1', 1, FOUNDER, 'confirmed');
  b.run('pb-2', 2, FOUNDER, 'pending');
  return db;
}

async function slots(db: any, who: number) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const res = await partnerOfficeHours.request('/partners/p-7/slots', { headers: { Cookie: `studioos_auth=${jwt}` } },
    { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  return Object.fromEntries(body.items.map((x: any) => [x.uid, x]));
}

test('a founder with no booking sees no link and no notes, only whether a link exists', async () => {
  const items = await slots(fixture(), OTHER_FOUNDER);
  assert.equal(Object.keys(items).length, 3);
  for (const s of Object.values(items) as any[]) {
    assert.ok(!('meeting_url' in s), `${s.uid} carries no meeting_url`);
    assert.ok(!('notes' in s), `${s.uid} carries no notes`);
    assert.ok(!JSON.stringify(s).includes('meet.example.test'));
  }
  assert.equal(items['slot-1'].has_meeting_link, true);
  assert.equal(items['slot-3'].has_meeting_link, false);
  assert.equal(items['slot-1'].taken, 1, 'the booking count still reads');
});

test('a founder sees the link on the slot their confirmed booking holds, not on a pending one', async () => {
  const items = await slots(fixture(), FOUNDER);
  assert.equal(items['slot-1'].meeting_url, LINK);
  assert.equal(items['slot-1'].notes, 'Partner note one');
  assert.ok(!('meeting_url' in items['slot-2']), 'a pending booking does not open the link');
});

test('a completed booking keeps the link; a cancelled one does not', async () => {
  const db = fixture();
  db.prepare("UPDATE partner_bookings SET status = 'completed' WHERE uid = 'pb-1'").run();
  db.prepare("UPDATE partner_bookings SET status = 'cancelled' WHERE uid = 'pb-2'").run();
  const items = await slots(db, FOUNDER);
  assert.equal(items['slot-1'].meeting_url, LINK);
  assert.ok(!('meeting_url' in items['slot-2']));
});

test('another partner reads the slots as any member does', async () => {
  const items = await slots(fixture(), OTHER_PARTNER_USER);
  assert.ok(!('meeting_url' in items['slot-1']));
  assert.ok(!('notes' in items['slot-1']));
});

for (const [who, label] of [[PARTNER_USER, 'the partner'], [ADMIN, 'an admin']] as const) {
  test(`${label} sees every slot whole`, async () => {
    const items = await slots(fixture(), who);
    assert.equal(items['slot-1'].meeting_url, LINK);
    assert.equal(items['slot-2'].notes, 'Partner note two');
    assert.equal(items['slot-3'].meeting_url, null);
  });
}
