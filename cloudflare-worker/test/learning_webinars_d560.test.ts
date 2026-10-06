/**
 * D560 (#1161) — webinars: migration 391, the Super Admin's authoring
 * (`routes/admin_learning_webinars.ts`) and the member routes
 * (`routes/learning_webinars.ts`).
 *
 * Run on a database built from the baseline and every migration through 391.
 * Webinar times are set relative to the real clock, so each case stands where
 * it needs to in the join window. What is pinned:
 *
 *   - the join link never reaches an unregistered member, never arrives
 *     before 15 minutes ahead of the start, is gone at the end, and is never
 *     in a list;
 *   - a full webinar refuses a registration;
 *   - a past webinar links to its recording once one is attached, and says
 *     "Recording not available" until then;
 *   - only the Super Admin writes, and every write records its actor;
 *   - 391 applies, and the .ics carries the page, not the join link.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_webinars_d560.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import adminLearning from '../src/routes/admin_learning.ts';
import webinars from '../src/routes/learning_webinars.ts';
import adminWebinars from '../src/routes/admin_learning_webinars.ts';
import { joinWindowOpen, JOIN_LEAD_MS } from '../src/services/learningWebinars.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10, PEER = 11, THIRD = 12;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder', [PEER]: 'investor', [THIRD]: 'partner' };
const JOIN = 'https://meet.example.test/room-42';

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) > BASELINE_CUTOFF && migrationNumber(x) < 388)) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  // The Learning migrations, whole and in order, as the deploy applies them.
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort(compareMigrations)
    .filter((x) => migrationNumber(x) >= 388 && /^\d+_learning_/.test(x))) {
    db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  }
  return db;
}
const BUILT = builtFromMigrations();

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  for (const [id, uid, name] of [[SUPER, 'u-super', 'Super Holder'], [PLAIN_ADMIN, 'u-plain', 'Plain Admin'],
    [MEMBER, 'u-mia', 'Mia Member'], [PEER, 'u-pia', 'Pia Peer'], [THIRD, 'u-tom', 'Tom Third']] as const) {
    db.prepare('INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)').run(id, uid, `${uid}@example.test`, name, ROLE[id]);
  }
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  return db;
}

async function tokenFor(who: number) {
  return new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await tokenFor(who)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text, headers: res.headers };
}
const author = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminWebinars, db, who, path, init);
const content = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminLearning, db, who, path, init);
const member = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(webinars, db, who, path, init);

const MIN = 60 * 1000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** A published webinar starting `startIn` from now and lasting `lengthMs`. */
async function published(db: DatabaseSync, startIn: number, lengthMs = 60 * MIN, extra: Record<string, unknown> = {}) {
  const made = await author(db, SUPER, '/webinars', { method: 'POST', body: {
    title: 'Raising in the Nordics', abstract: 'A live session.', host_name: 'Ada Host', timezone: 'Europe/Oslo',
    starts_at: at(startIn), ends_at: at(startIn + lengthMs), join_url: JOIN, ...extra } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const uid = made.body.webinar.uid;
  assert.equal((await author(db, SUPER, `/webinars/${uid}/publish`, { method: 'POST' })).status, 200);
  return uid as string;
}

// ---- the migration ---------------------------------------------------------------

test('391 applies to a database built from the migrations, with its sets as CHECKs', () => {
  const db = seeded();
  for (const t of ['learning_webinars', 'learning_webinar_registrations']) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t), `${t} is missing`);
  }
  db.exec(`INSERT INTO learning_webinars (uid, title, created_by) VALUES ('w', 'W', 1)`);
  const w = db.prepare(`SELECT status, visibility, capacity FROM learning_webinars`).get() as any;
  assert.deepEqual([w.status, w.visibility, w.capacity], ['draft', 'open', null]);
  assert.throws(() => db.exec(`UPDATE learning_webinars SET status = 'live'`), /CHECK/);
  assert.throws(() => db.exec(`UPDATE learning_webinars SET capacity = 0`), /CHECK/);
  assert.throws(() => db.exec(`UPDATE learning_webinars SET starts_at = '2026-11-01T10:00:00.000Z', ends_at = '2026-11-01T09:00:00.000Z'`), /CHECK/);
  db.exec(`INSERT INTO learning_webinar_registrations (webinar_id, user_id) VALUES (1, ${MEMBER})`);
  assert.equal((db.prepare('SELECT attended FROM learning_webinar_registrations').get() as any).attended, null, 'attended is not null before it is recorded');
  assert.throws(() => db.exec(`INSERT INTO learning_webinar_registrations (webinar_id, user_id) VALUES (1, ${MEMBER})`), /UNIQUE/);
});

// ---- the join link ---------------------------------------------------------------

test('the join link never reaches an unregistered member, and never before its window', async () => {
  const db = seeded();
  const soon = await published(db, 10 * MIN);           // inside the 15-minute lead
  const later = await published(db, 30 * MIN);          // before its window
  const live = await published(db, -10 * MIN, 30 * MIN); // running now
  const over = await published(db, -90 * MIN, 30 * MIN); // ended
  for (const uid of [soon, later, live, over]) {
    const r = await member(db, MEMBER, `/webinars/${uid}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.webinar.join_url, null, `an unregistered member got the link (${uid})`);
    assert.doesNotMatch(r.text, /meet\.example\.test/, 'the link appeared somewhere in the payload');
  }
  for (const uid of [soon, later, live]) {
    assert.equal((await member(db, MEMBER, `/webinars/${uid}/registration`, { method: 'POST' })).status, 201);
  }
  db.prepare(`INSERT INTO learning_webinar_registrations (webinar_id, user_id) SELECT id, ? FROM learning_webinars WHERE uid = ?`).run(MEMBER, over);
  assert.equal((await member(db, MEMBER, `/webinars/${soon}`)).body.webinar.join_url, JOIN, 'the link is missing inside the 15-minute lead');
  assert.equal((await member(db, MEMBER, `/webinars/${live}`)).body.webinar.join_url, JOIN, 'the link is missing while it runs');
  const early = await member(db, MEMBER, `/webinars/${later}`);
  assert.deepEqual([early.body.webinar.join_url, early.body.webinar.join], [null, 'not_yet'], 'the link arrived before its window');
  const ended = await member(db, MEMBER, `/webinars/${over}`);
  assert.deepEqual([ended.body.webinar.join_url, ended.body.webinar.join], [null, 'ended'], 'the link outlived the webinar');
  const list = await member(db, MEMBER, '/webinars?when=upcoming');
  assert.equal(list.body.webinars.length, 3);
  assert.doesNotMatch(list.text, /meet\.example\.test/, 'a list carried the join link');
  assert.equal((await member(db, PEER, `/webinars/${soon}`)).body.webinar.join_url, null, 'another member saw it through someone else\'s registration');
  await author(db, SUPER, `/webinars/${live}/cancel`, { method: 'POST' });
  const off = await member(db, MEMBER, `/webinars/${live}`);
  assert.deepEqual([off.body.webinar.status, off.body.webinar.join_url, off.body.webinar.join], ['cancelled', null, 'cancelled']);
  // The function at its edges.
  const w = { starts_at: '2026-11-01T10:00:00.000Z', ends_at: '2026-11-01T11:00:00.000Z' };
  const start = Date.parse(w.starts_at);
  assert.equal(joinWindowOpen(w, start - JOIN_LEAD_MS - 1), false);
  assert.equal(joinWindowOpen(w, start - JOIN_LEAD_MS), true);
  assert.equal(joinWindowOpen(w, Date.parse(w.ends_at) - 1), true);
  assert.equal(joinWindowOpen(w, Date.parse(w.ends_at)), false);
});

// ---- capacity ---------------------------------------------------------------------

test('a full webinar refuses a registration; unregistering frees the seat', async () => {
  const db = seeded();
  const uid = await published(db, 2 * 24 * 60 * MIN, 60 * MIN, { capacity: 2 });
  assert.equal((await member(db, MEMBER, `/webinars/${uid}/registration`, { method: 'POST' })).status, 201);
  assert.equal((await member(db, MEMBER, `/webinars/${uid}/registration`, { method: 'POST' })).status, 200, 'registering twice is not idempotent');
  assert.equal((await member(db, PEER, `/webinars/${uid}/registration`, { method: 'POST' })).status, 201);
  const full = await member(db, THIRD, `/webinars/${uid}/registration`, { method: 'POST' });
  assert.deepEqual([full.status, full.body.error], [409, 'full'], 'a full webinar took a registration');
  const seen = (await member(db, THIRD, `/webinars/${uid}`)).body.webinar;
  assert.deepEqual([seen.capacity, seen.registered_count, seen.seats_left], [2, 2, 0]);
  assert.equal((await member(db, PEER, `/webinars/${uid}/registration`, { method: 'DELETE' })).status, 200);
  assert.equal((await member(db, THIRD, `/webinars/${uid}/registration`, { method: 'POST' })).status, 201, 'a freed seat was not offered');
  const lower = await author(db, SUPER, `/webinars/${uid}`, { method: 'PATCH', body: { capacity: 1 } });
  assert.deepEqual([lower.status, lower.body.error], [400, 'capacity_below_registrations']);
  const open = await published(db, 2 * 24 * 60 * MIN);
  const unl = (await member(db, MEMBER, `/webinars/${open}`)).body.webinar;
  assert.deepEqual([unl.capacity, unl.seats_left], [null, null], 'no capacity read as a number of seats');
});

// ---- the recording ---------------------------------------------------------------

test('a past webinar links to its recording once one is attached', async () => {
  const db = seeded();
  const uid = await published(db, -3 * 60 * MIN, 60 * MIN);
  const before = await member(db, MEMBER, `/webinars/${uid}`);
  assert.deepEqual(before.body.recording, { available: false, reason: 'Recording not available' });
  const reading = (await content(db, SUPER, '/items', { method: 'POST', body: { kind: 'reading', title: 'Notes', body: 'x' } })).body.item;
  const notVideo = await author(db, SUPER, `/webinars/${uid}/recording`, { method: 'PUT', body: { item_uid: reading.uid } });
  assert.deepEqual([notVideo.status, notVideo.body.error], [400, 'not_a_video']);
  const video = (await content(db, SUPER, '/items', { method: 'POST', body: { kind: 'video', title: 'Replay', video_url: 'https://youtu.be/replay' } })).body.item;
  assert.equal((await author(db, SUPER, `/webinars/${uid}/recording`, { method: 'PUT', body: { item_uid: video.uid } })).status, 200);
  assert.equal((await member(db, MEMBER, `/webinars/${uid}`)).body.recording.available, false, 'a draft recording was linked');
  await content(db, SUPER, `/items/${video.uid}/publish`, { method: 'POST' });
  const after = await member(db, MEMBER, `/webinars/${uid}`);
  assert.deepEqual(after.body.recording, { available: true, item_uid: video.uid, href: `/learning/videos/${video.uid}` });
  const past = await member(db, MEMBER, '/webinars?when=past');
  assert.deepEqual(past.body.webinars.map((w: any) => [w.uid, w.recording.href]), [[uid, `/learning/videos/${video.uid}`]]);
  assert.equal((await member(db, MEMBER, '/webinars?when=upcoming')).body.webinars.length, 0, 'a past webinar was listed as upcoming');
  await author(db, SUPER, `/webinars/${uid}/recording`, { method: 'PUT', body: { item_uid: null } });
  assert.equal((await member(db, MEMBER, `/webinars/${uid}`)).body.recording.reason, 'Recording not available');
});

// ---- gates -----------------------------------------------------------------------

test('only the Super Admin writes, and every write records its actor', async () => {
  const db = seeded();
  const body = { title: 'Pitch clinic', starts_at: at(60 * MIN), ends_at: at(120 * MIN), join_url: JOIN };
  for (const who of [MEMBER, PLAIN_ADMIN]) {
    assert.equal((await author(db, who, '/webinars', { method: 'POST', body })).status, 403, `user ${who} created a webinar`);
    assert.equal((await author(db, who, '/webinars')).status, 403, `user ${who} listed drafts`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM learning_webinars').get() as any).n, 0);
  const bad = await author(db, SUPER, '/webinars', { method: 'POST', body: { ...body, join_url: 'http://meet.example.test/x' } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'bad_join_url'], 'a non-https join link was stored');
  assert.equal((await author(db, SUPER, '/webinars', { method: 'POST', body: { ...body, timezone: 'Mars/Olympus' } })).body.error, 'bad_timezone');
  assert.equal((await author(db, SUPER, '/webinars', { method: 'POST', body: { ...body, ends_at: body.starts_at } })).body.error, 'bad_ends_at');
  const made = (await author(db, SUPER, '/webinars', { method: 'POST', body })).body.webinar;
  const draft = await member(db, MEMBER, `/webinars/${made.uid}`);
  assert.equal(draft.status, 404, 'a member read a draft webinar');
  assert.equal((await member(db, MEMBER, `/webinars/${made.uid}/registration`, { method: 'POST' })).status, 404, 'a member registered for a draft');
  await author(db, SUPER, `/webinars/${made.uid}`, { method: 'PATCH', body: { capacity: 30 } });
  await author(db, SUPER, `/webinars/${made.uid}/publish`, { method: 'POST' });
  await member(db, MEMBER, `/webinars/${made.uid}/registration`, { method: 'POST' });
  assert.equal((await author(db, SUPER, `/webinars/${made.uid}/registrations/u-mia`, { method: 'PATCH', body: { attended: true } })).status, 200);
  await author(db, SUPER, `/webinars/${made.uid}/cancel`, { method: 'POST' });
  const audit = db.prepare(`SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action LIKE 'learning.webinar.%' ORDER BY id`).all() as any[];
  assert.deepEqual(audit.map((a) => [a.admin_user_id, a.action]), [
    [SUPER, 'learning.webinar.create'], [SUPER, 'learning.webinar.update'], [SUPER, 'learning.webinar.publish'],
    [SUPER, 'learning.webinar.attendance'], [SUPER, 'learning.webinar.cancel'],
  ]);
  assert.ok(audit.every((a) => a.filters_json.includes(made.uid)), 'an audit row does not name its webinar');
  const detail = await author(db, SUPER, `/webinars/${made.uid}`);
  assert.deepEqual(detail.body.registrations.map((x: any) => [x.uid, x.name, x.attended]), [['u-mia', 'Mia Member', true]]);
  assert.doesNotMatch(detail.text, /@example\.test/, 'the registrations list carried an email');
});

test('the .ics file carries the webinar\'s page and times, never the join link', async () => {
  const db = seeded();
  const uid = await published(db, 10 * MIN);
  await member(db, MEMBER, `/webinars/${uid}/registration`, { method: 'POST' });
  const ics = await member(db, MEMBER, `/webinars/${uid}/calendar.ics`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type') || '', /text\/calendar/);
  assert.match(ics.text, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT[\s\S]*SUMMARY:Raising in the Nordics/);
  assert.match(ics.text, new RegExp(`UID:webinar-${uid}@axal\\.vc`));
  assert.match(ics.text, new RegExp(`URL:http://localhost/learning/webinars/${uid}`));
  assert.match(ics.text, /DTSTART:\d{8}T\d{6}Z/);
  assert.doesNotMatch(ics.text, /meet\.example\.test/, 'the calendar file carried the join link');
});
