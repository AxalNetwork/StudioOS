/**
 * #4715 — a founder holds a session's meeting link once the host has
 * confirmed it, not when they ask for it.
 *
 *   · GET /api/partner-office-hours/bookings/me carries `meeting_url` only on
 *     a confirmed or completed booking; every row says `has_meeting_link`;
 *   · the tentative calendar copy a new booking pushes (advisor and partner)
 *     carries no link; the confirmation's push does.
 *
 * Real router, on the migrated schema. Synthetic people.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/booking_meeting_link_4715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import partnerOfficeHours from '../src/routes/partner_office_hours.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';

const SECRET = 'test'.repeat(16); // the shared synthetic seed (see .gitleaksignore)
const PARTNER_USER = 21, FOUNDER = 22;
const LINK = 'https://meet.example.test/room-b';
test.after(() => removeMigratedDatabases());

function fixture() {
  const db = migratedDatabase();
  db.exec(`INSERT INTO partners (id, uid, name, email) VALUES (7, 'p-7', 'Synthetic Partner', 'partner@example.test');
    INSERT INTO users (id, email, name, role, is_active, partner_id) VALUES
      (${PARTNER_USER}, 'p@example.test', 'Pat', 'partner', 1, 7),
      (${FOUNDER}, 'f@example.test', 'Fran', 'founder', 1, NULL);`);
  const s = db.prepare("INSERT INTO partner_office_hour_slots (id, uid, partner_id, starts_at, ends_at, capacity, meeting_url, is_cancelled) VALUES (?, ?, 7, '2026-12-01T15:00:00Z', '2026-12-01T16:00:00Z', 3, ?, 0)");
  const b = db.prepare("INSERT INTO partner_bookings (id, uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 7, ?, ?, '2026-11-07', '2026-11-07')");
  // One slot per status, each with a link; slot 9 has none.
  const statuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  statuses.forEach((st, i) => { s.run(i + 1, `slot-${i + 1}`, LINK); b.run(i + 1, `pb-${st}`, i + 1, FOUNDER, st); });
  s.run(9, 'slot-9', null); b.run(9, 'pb-nolink', 9, FOUNDER, 'confirmed');
  return db;
}

async function get(db: any, path: string, who: number) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
  const res = await partnerOfficeHours.request(path, { headers: { Cookie: `studioos_auth=${jwt}` } },
    { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any);
  const body = await res.json() as any;
  assert.equal(res.status, 200, JSON.stringify(body));
  return Object.fromEntries(body.items.map((x: any) => [x.uid, x]));
}

test('a founder’s own bookings carry the link only once confirmed or completed', async () => {
  const items = await get(fixture(), '/bookings/me', FOUNDER);
  for (const uid of ['pb-confirmed', 'pb-completed']) {
    assert.equal(items[uid].meeting_url, LINK, `${uid} carries the link`);
    assert.equal(items[uid].has_meeting_link, true);
  }
  for (const uid of ['pb-pending', 'pb-cancelled', 'pb-no_show']) {
    assert.ok(!('meeting_url' in items[uid]), `${uid} carries no meeting_url`);
    assert.ok(!JSON.stringify(items[uid]).includes('meet.example.test'));
    assert.equal(items[uid].has_meeting_link, true, `${uid} still says a link exists`);
  }
  assert.equal(items['pb-nolink'].has_meeting_link, false);
  assert.equal(items['pb-pending'].starts_at, '2026-12-01T15:00:00Z', 'the session time still reads');
});

test('the status filter applies the same rule', async () => {
  const items = await get(fixture(), '/bookings/me?status=pending', FOUNDER);
  assert.deepEqual(Object.keys(items), ['pb-pending']);
  assert.ok(!('meeting_url' in items['pb-pending']));
});

test('the partner’s own booking list keeps every link', async () => {
  const items = await get(fixture(), '/me/bookings', PARTNER_USER);
  assert.equal(items['pb-pending'].meeting_url, LINK, 'the host sees the link on a pending request');
});

for (const [file, idExpr] of [
  ['../src/routes/partner_office_hours.ts', "id: `partner_office_hour:${rowId}`"],
  ['../src/routes/advisors.ts', "id: `advisor_booking:${rowId}`"],
] as const) {
  test(`${file.split('/').pop()}: the tentative calendar copy carries no link; the confirmation does`, () => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = src.indexOf(idExpr);
    assert.ok(start > 0, 'the booking push is found');
    const push = src.slice(start, src.indexOf('onAxalSessionCreated(c.env, ev)', start));
    assert.match(push, /ics_status: 'TENTATIVE'/);
    assert.match(push, /location_uri: null,/, 'the tentative push names no link');
    assert.doesNotMatch(push, /meeting_url/, 'nor reads one');
    const confirm = src.slice(src.indexOf('function deferCalendarConfirm'));
    assert.match(confirm.slice(0, 2500), /location_uri: row\.meeting_url/, 'the confirmation carries it');
  });
}
