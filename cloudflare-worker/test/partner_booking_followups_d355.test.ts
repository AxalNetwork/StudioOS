/**
 * Office Hours follow-ups — D355, migrations 360 and 361.
 *
 * Runs the service's real SQL on SQLite (`_d1_sqlite.mjs`) over the REAL
 * migration DDL, so a wrong predicate fails because the wrong row is written
 * or read, not because a string moved. What the owner decided, asserted:
 *   * action items: founder AND partner add and tick; each item records who
 *     added it; only the author rewords or deletes; a stranger learns nothing;
 *   * ratings: only the booking's founder, only a completed session, 1–5, one
 *     per booking; the partner sees it on their own session, comment included;
 *   * the average is shown from the first rating, always with its count, and a
 *     partner nobody rated is absent — never an average of 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import {
  listItems, addItem, updateItem, deleteItem, myItems, rateBooking, ratingSummary, LINKED_TOOLS,
} from '../src/services/partnerBookingFollowups';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const M360 = read('cloudflare-worker/sql/migrations/360_partner_booking_action_items.sql');
const M361 = read('cloudflare-worker/sql/migrations/361_partner_booking_ratings.sql');
const ROUTES = read('cloudflare-worker/src/routes/partner_office_hours.ts');
const API = read('frontend/src/lib/api.js');

const SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, partner_id INTEGER);
  CREATE TABLE partners (id INTEGER PRIMARY KEY);
  CREATE TABLE partner_bookings (
    id INTEGER PRIMARY KEY, uid TEXT, slot_id INTEGER, partner_id INTEGER NOT NULL,
    founder_user_id INTEGER NOT NULL, topic TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'pending',
    cancel_reason TEXT, created_at TEXT, updated_at TEXT
  );
  ${M360}
  ${M361}
`;
const SEED = `
  INSERT INTO partners VALUES (7), (8), (9);
  INSERT INTO users VALUES (1, 'founder', NULL), (2, 'partner', 7), (3, 'founder', NULL), (4, 'partner', 8), (5, 'admin', NULL);
  INSERT INTO partner_bookings (id, partner_id, founder_user_id, status) VALUES
    (100, 7, 1, 'confirmed'),
    (101, 7, 1, 'completed'),
    (102, 7, 1, 'cancelled'),
    (103, 8, 3, 'completed'),
    (104, 7, 3, 'completed');
`;
const U = {
  ada: { id: 1, role: 'founder', partner_id: null },
  pat: { id: 2, role: 'partner', partner_id: 7 },
  eve: { id: 3, role: 'founder', partner_id: null },
  other: { id: 4, role: 'partner', partner_id: 8 },
  staff: { id: 5, role: 'admin', partner_id: null },
} as any;

function setup() {
  const { DB, db } = makeD1(SCHEMA, SEED);
  return { env: { DB } as any, db };
}
const itemRows = (db: any) => db.prepare('SELECT booking_id, title, created_by_user_id, created_by_role, done_at IS NOT NULL AS done, completed_by_user_id FROM partner_booking_action_items ORDER BY id').all().map((r: any) => ({ ...r }));

test('both parties add items, and each item records who added it and from which side', async () => {
  const { env, db } = setup();
  const a: any = await addItem(env, { bookingId: 100, user: U.ada, title: ' File 83(b) ', linkedTool: '83b', dueDate: '2026-10-01' });
  const b: any = await addItem(env, { bookingId: 100, user: U.pat, title: 'Send the SAFE template', linkedTool: null, dueDate: undefined });
  assert.ok(!('refused' in a) && !('refused' in b));
  assert.deepEqual(itemRows(db), [
    { booking_id: 100, title: 'File 83(b)', created_by_user_id: 1, created_by_role: 'founder', done: 0, completed_by_user_id: null },
    { booking_id: 100, title: 'Send the SAFE template', created_by_user_id: 2, created_by_role: 'partner', done: 0, completed_by_user_id: null },
  ]);
  const seenByPartner: any = await listItems(env, 100, U.pat);
  assert.equal(seenByPartner.side, 'partner');
  assert.deepEqual(seenByPartner.items.map((i: any) => [i.title, i.added_by, i.added_by_you]), [
    ['File 83(b)', 'founder', false], ['Send the SAFE template', 'partner', true],
  ]);
});

test('a stranger — another founder, another partner, staff — gets the missing-booking 404 and writes nothing', async () => {
  const { env, db } = setup();
  for (const u of [U.eve, U.other, U.staff]) {
    const out: any = await addItem(env, { bookingId: 100, user: u, title: 'x', linkedTool: null, dueDate: null });
    assert.equal(out.refused?.status, 404);
    assert.equal(out.refused.code, 'booking_not_found');
    assert.equal(((await listItems(env, 100, u)) as any).refused?.status, 404);
  }
  assert.equal(((await listItems(env, 99999, U.ada)) as any).refused?.code, 'booking_not_found', 'same code as a stranger');
  assert.deepEqual(itemRows(db), []);
});

test('either party ticks; only the author rewords or deletes', async () => {
  const { env, db } = setup();
  const { item }: any = await addItem(env, { bookingId: 100, user: U.ada, title: 'Draft the deck', linkedTool: 'pitch-deck', dueDate: null });
  const ticked: any = await updateItem(env, { itemId: item.id, user: U.pat, patch: { done: true } });
  assert.equal(ticked.item.done, true);
  assert.equal(itemRows(db)[0].completed_by_user_id, 2, 'the tick records who ticked');

  const reword: any = await updateItem(env, { itemId: item.id, user: U.pat, patch: { title: 'Something else' } });
  assert.equal(reword.refused?.code, 'not_the_author');
  const del: any = await deleteItem(env, item.id, U.pat);
  assert.equal(del.refused?.code, 'not_the_author');
  assert.equal(itemRows(db)[0].title, 'Draft the deck');

  const reopened: any = await updateItem(env, { itemId: item.id, user: U.ada, patch: { done: false, title: 'Draft the deck v2' } });
  assert.equal(reopened.item.done, false);
  assert.deepEqual([itemRows(db)[0].title, itemRows(db)[0].completed_by_user_id], ['Draft the deck v2', null]);
  assert.deepEqual(await deleteItem(env, item.id, U.ada), { ok: true });
  assert.deepEqual(itemRows(db), []);
});

test('a stranger cannot tick or delete an item by id', async () => {
  const { env, db } = setup();
  const { item }: any = await addItem(env, { bookingId: 100, user: U.ada, title: 'Keep me', linkedTool: null, dueDate: null });
  assert.equal(((await updateItem(env, { itemId: item.id, user: U.eve, patch: { done: true } })) as any).refused?.code, 'action_item_not_found');
  assert.equal(((await deleteItem(env, item.id, U.other)) as any).refused?.code, 'action_item_not_found');
  assert.deepEqual(itemRows(db).map((r: any) => r.done), [0]);
});

test('bad input is refused before anything is written', async () => {
  const { env, db } = setup();
  const t = (args: any) => addItem(env, { bookingId: 100, user: U.ada, title: 'ok', linkedTool: null, dueDate: null, ...args }) as any;
  assert.equal((await t({ title: '   ' })).refused.code, 'title_required');
  assert.equal((await t({ linkedTool: '../admin' })).refused.code, 'invalid_linked_tool');
  assert.equal((await t({ dueDate: '2026-02-30' })).refused.code, 'invalid_due_date');
  assert.equal((await t({ dueDate: 'tomorrow' })).refused.code, 'invalid_due_date');
  assert.equal((await addItem(env, { bookingId: 102, user: U.ada, title: 'x', linkedTool: null, dueDate: null }) as any).refused.code, 'booking_cancelled');
  assert.deepEqual(itemRows(db), []);
  assert.ok(LINKED_TOOLS.includes('83b' as any) && LINKED_TOOLS.length === 17);
});

test('my items span both sides and leave out cancelled sessions', async () => {
  const { env, db } = setup();
  await addItem(env, { bookingId: 100, user: U.ada, title: 'on a live session', linkedTool: null, dueDate: null });
  await addItem(env, { bookingId: 104, user: U.eve, title: 'eve and pat', linkedTool: null, dueDate: null });
  await addItem(env, { bookingId: 103, user: U.eve, title: 'eve and other', linkedTool: null, dueDate: null });
  db.exec(`INSERT INTO partner_booking_action_items (booking_id, title, created_by_user_id, created_by_role) VALUES (102, 'on a cancelled session', 1, 'founder')`);
  assert.deepEqual(((await myItems(env, U.ada)) as any).items.map((i: any) => i.title), ['on a live session']);
  assert.deepEqual(((await myItems(env, U.pat)) as any).items.map((i: any) => i.title).sort(), ['eve and pat', 'on a live session']);
  assert.deepEqual(((await myItems(env, U.staff)) as any).items, []);
});

const ratingRows = (db: any) => db.prepare('SELECT booking_id, partner_id, founder_user_id, rating, comment FROM partner_booking_ratings ORDER BY booking_id').all().map((r: any) => ({ ...r }));

test('only the founder rates, only a completed session, 1–5, one per booking', async () => {
  const { env, db } = setup();
  assert.equal(((await rateBooking(env, { bookingId: 101, user: U.pat, rating: 5, comment: null })) as any).refused?.code, 'founder_only');
  assert.equal(((await rateBooking(env, { bookingId: 101, user: U.eve, rating: 5, comment: null })) as any).refused?.status, 404);
  assert.equal(((await rateBooking(env, { bookingId: 100, user: U.ada, rating: 5, comment: null })) as any).refused?.code, 'not_completed');
  for (const bad of [0, 6, 4.5, '5']) {
    assert.equal(((await rateBooking(env, { bookingId: 101, user: U.ada, rating: bad, comment: null })) as any).refused?.code, 'invalid_rating');
  }
  assert.deepEqual(ratingRows(db), []);
  await rateBooking(env, { bookingId: 101, user: U.ada, rating: 3, comment: ' ok ' });
  await rateBooking(env, { bookingId: 101, user: U.ada, rating: 4, comment: 'better on reflection' });
  assert.deepEqual(ratingRows(db), [{ booking_id: 101, partner_id: 7, founder_user_id: 1, rating: 4, comment: 'better on reflection' }]);
});

test('the average shows from the first rating with its count; an unrated partner is absent, never 0', async () => {
  const { env } = setup();
  assert.deepEqual(await ratingSummary(env), { items: [] });
  await rateBooking(env, { bookingId: 101, user: U.ada, rating: 5, comment: null });
  assert.deepEqual(await ratingSummary(env), { items: [{ partner_id: 7, average: 5, count: 1 }] });
  await rateBooking(env, { bookingId: 104, user: U.eve, rating: 4, comment: null });
  await rateBooking(env, { bookingId: 103, user: U.eve, rating: 2, comment: null });
  const s: any = await ratingSummary(env);
  assert.deepEqual(s.items.sort((a: any, b: any) => a.partner_id - b.partner_id), [
    { partner_id: 7, average: 4.5, count: 2 },
    { partner_id: 8, average: 2, count: 1 },
  ]);
});

test('the booking lists carry the rating — run on SQLite, so the partner sees it on their session with the comment', async () => {
  const { env, db } = setup();
  db.exec('CREATE TABLE partner_office_hour_slots (id INTEGER PRIMARY KEY, starts_at TEXT, ends_at TEXT, meeting_url TEXT)');
  await rateBooking(env, { bookingId: 101, user: U.ada, rating: 4, comment: 'sharp on pricing' });
  const sqls = [...ROUTES.matchAll(/`(SELECT b\.\*, s\.starts_at[\s\S]*?)`/g)].map((m) => m[1]);
  assert.equal(sqls.length, 4, 'both statuses of both list endpoints');
  const partnerSql = sqls.filter((q) => /WHERE b\.partner_id = \?/.test(q));
  const founderSql = sqls.filter((q) => /WHERE b\.founder_user_id = \?/.test(q));
  assert.equal(partnerSql.length, 2);
  assert.equal(founderSql.length, 2);
  const pick = (rows: any[]) => rows.map((r: any) => ({ id: r.id, rating: r.rating, rating_comment: r.rating_comment })).sort((a, b) => a.id - b.id);
  const partnerAll = pick(db.prepare(partnerSql.find((q) => !/b\.status = \?/.test(q))!).all(7));
  assert.deepEqual(partnerAll.find((r) => r.id === 101), { id: 101, rating: 4, rating_comment: 'sharp on pricing' });
  assert.deepEqual(partnerAll.find((r) => r.id === 104), { id: 104, rating: null, rating_comment: null }, 'unrated is null, never 0');
  assert.deepEqual(pick(db.prepare(partnerSql.find((q) => /b\.status = \?/.test(q))!).all(7, 'completed')), [
    { id: 101, rating: 4, rating_comment: 'sharp on pricing' }, { id: 104, rating: null, rating_comment: null },
  ]);
  assert.deepEqual(pick(db.prepare(founderSql.find((q) => /b\.status = \?/.test(q))!).all(1, 'completed')), [
    { id: 101, rating: 4, rating_comment: 'sharp on pricing' },
  ]);
  assert.equal(pick(db.prepare(founderSql.find((q) => !/b\.status = \?/.test(q))!).all(1)).length, 3);
});

test('the routes pass the session user and relay refusals; no request field becomes the actor', () => {
  const block = ROUTES.slice(ROUTES.indexOf('// D355 —'), ROUTES.indexOf('// Task #1 (AG)'));
  assert.doesNotMatch(block, /user:\s*\{|user_id|founder_user_id:\s*body|partner_id:\s*body/);
  assert.equal((block.match(/const user = await requireAuth\(c\);/g) || []).length, 6);
  assert.match(block, /return refuse\(c, f\.status, \{ code: f\.code, message: f\.message \}\);/);
  assert.doesNotMatch(block, /c\.req\.query\(/, 'no query string reaches the follow-up SQL');
});

test('the api.js methods exist, target the mounted routes, and send no user id', () => {
  const start = API.indexOf('listBookingActionItems:');
  const block = API.slice(start, API.indexOf('partnerRatingSummary:', start) + 90);
  assert.match(block, /\/partner-office-hours\/bookings\/\$\{encodeURIComponent\(bookingId\)\}\/action-items/);
  assert.match(block, /\/partner-office-hours\/action-items\/me/);
  assert.match(block, /\/partner-office-hours\/bookings\/\$\{encodeURIComponent\(bookingId\)\}\/rating/);
  assert.match(block, /partnerRatingSummary: \(\) => request\('\/partner-office-hours\/ratings\/summary'\)/);
  assert.doesNotMatch(block, /user_id|userId/);
});
