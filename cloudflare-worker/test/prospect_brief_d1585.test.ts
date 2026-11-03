/**
 * D1585 (#3832, deck v2 F6) — the brief for an investor meeting.
 *
 *   1. One brief per prospect, from what is recorded: who and where they
 *      stand, the meeting asked for, the last one met, their deck links with
 *      views, read time and signals, their own objections first, then what
 *      others raised. No model runs, and no email is in it.
 *   2. Another venture's prospect is 404; staff are pointed at a support read.
 *   3. A part that cannot be read says so; it never reads as "none".
 *   4. An investor meeting on the calendar carries its prospect, for "Prep".
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/prospect_brief_d1585.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import raise from '../src/routes/cycle_raise.ts';
import { prospectBrief, BRIEF_BASIS, ELSEWHERE_MAX } from '../src/services/prospectBrief.ts';
import { investorMeetingEvents } from '../src/services/calendar/investorMeetings.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const mig = (n: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${n}`), 'utf8');
const FOUNDER = 1;
const OTHER_FOUNDER = 2;
const ADMIN = 30;
const NOW = new Date('2026-11-10T12:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'activity_logs', 'raise_prospects', 'pitch_decks', 'calendar_events', 'pitch_deck_share_tokens', 'data_room_files', 'dd_requests', 'deals', 'commitments', 'raise_rounds', 'raise_closes', 'raise_pro_rata', 'investor_profiles', 'network_connections']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(mig('463_raise_record_stores.sql'));
  const tokenCols = new Set((db.prepare('PRAGMA table_info(pitch_deck_share_tokens)').all() as any[]).map((r) => r.name));
  for (const col of ['revoked_at', 'last_viewed_at']) if (!tokenCols.has(col)) db.exec(`ALTER TABLE pitch_deck_share_tokens ADD COLUMN ${col} TEXT`);
  db.exec(mig('624_narrative_objection_answers.sql'));
  for (const col of ['next_step TEXT', 'next_step_due TEXT', 'warm_path TEXT']) db.exec(`ALTER TABLE raise_prospects ADD COLUMN ${col}`);
  db.exec(`ALTER TABLE raise_prospect_events ADD COLUMN starts_at TEXT; ALTER TABLE raise_prospect_events ADD COLUMN calendar_item_uid TEXT;
    CREATE TABLE deck_share_views (id INTEGER PRIMARY KEY, share_token_id INTEGER, deck_id INTEGER, read_seconds INTEGER NOT NULL DEFAULT 0, created_at TEXT);
    CREATE TABLE IF NOT EXISTS user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE IF NOT EXISTS company_profiles(id INTEGER PRIMARY KEY, archived_at TEXT);`);
  db.exec(mig('740_raise_prospect_signals.sql'));
  db.exec(`
    INSERT INTO users (id, role, founder_id, name, email, is_active, kyc_status) VALUES
      (1, 'founder', 11, 'Fixture Founder', 'founder@example.test', 1, 'approved'),
      (2, 'founder', 22, 'Fixture Other', 'other@example.test', 1, 'approved'),
      (30, 'admin', NULL, 'Fixture Admin', 'admin@example.test', 1, 'approved');
    INSERT INTO projects (id, uid, name, founder_id, company_id) VALUES (101, 'p-101', 'Fixture AI Co', 11, 10), (202, 'p-202', 'Fixture Other Co', 22, 20);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
    INSERT INTO raise_prospects (id, uid, project_id, name, firm, email, stage, next_step, next_step_due, warm_path) VALUES
      (1, 'pa', 101, 'Ada Fixture', 'Bluefern Capital', 'ada@example.test', 'meeting', 'Send the model', '2026-11-12', 'Via Bea'),
      (2, 'pb', 101, 'Bo Fixture', 'Fund B', 'bo@example.test', 'contacted', NULL, NULL, NULL),
      (3, 'pc', 101, 'Cy Fixture', 'Fund C', NULL, 'contacted', NULL, NULL, NULL),
      (9, 'px', 202, 'Other Fixture', 'Other Fund', 'other@example.test', 'meeting', NULL, NULL, NULL);
    INSERT INTO raise_prospect_events (id, prospect_id, kind, note, starts_at, calendar_item_uid, created_at) VALUES
      (10, 1, 'call', 'Intro call', '2026-10-20T15:00:00Z', 'cal-10', '2026-10-18 09:00:00'),
      (11, 1, 'meeting', 'Partner meeting', '2026-11-14T16:00:00Z', 'cal-11', '2026-11-01 09:00:00'),
      (12, 1, 'meeting', 'Follow-up', '2026-11-20T16:00:00Z', 'cal-12', '2026-11-02 09:00:00'),
      (13, 1, 'note', 'Asked about churn', NULL, NULL, '2026-11-03 09:00:00'),
      (90, 9, 'meeting', 'Other venture', '2026-11-14T16:00:00Z', 'cal-90', '2026-11-01 09:00:00');
    INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES
      (1, 'Churn looks high', NULL, '2026-11-03 09:00:00'),
      (1, 'churn looks  HIGH', NULL, '2026-11-04 09:00:00'),
      (1, 'Market too small', 'We sell to three segments', '2026-11-02 09:00:00'),
      (2, 'Market too small', NULL, '2026-11-01 09:00:00'),
      (2, 'Team lacks a CTO', NULL, '2026-11-01 09:00:00'),
      (3, 'Team lacks a CTO', NULL, '2026-11-01 09:00:00'),
      (3, 'Pricing unclear', NULL, '2026-11-01 09:00:00'),
      (3, 'Market too small', NULL, '2026-11-01 08:00:00'),
      (2, 'Too early', NULL, '2026-11-01 09:00:00'),
      (3, 'Burn too high', NULL, '2026-11-01 09:00:00'),
      (9, 'Secret other venture objection', NULL, '2026-11-01 09:00:00');
    INSERT INTO pitch_decks (id, project_id, version, slides, title) VALUES (5, 101, 1, '[]', 'Seed deck'), (6, 202, 1, '[]', 'Other deck');
    INSERT INTO pitch_deck_share_tokens (id, deck_id, token_hash, expires_at, prospect_id, created_at, revoked_at, last_viewed_at) VALUES
      (40, 5, 'h40', '2027-01-01', 1, '2026-11-05 10:00:00', NULL, '2026-11-07 10:00:00'),
      (41, 5, 'h41', '2027-01-01', 1, '2026-11-01 10:00:00', '2026-11-02 10:00:00', NULL),
      (42, 5, 'h42', '2027-01-01', 2, '2026-11-05 10:00:00', NULL, NULL),
      (60, 6, 'h60', '2027-01-01', 1, '2026-11-05 10:00:00', NULL, NULL);
    INSERT INTO deck_share_views (id, share_token_id, deck_id, read_seconds, created_at) VALUES
      (70, 40, 5, 200, '2026-11-05 11:00:00'), (71, 40, 5, 130, '2026-11-07 10:00:00');
    INSERT INTO raise_prospect_signals (uid, project_id, prospect_id, share_token_id, deck_id, view_id, kind, occurred_at) VALUES
      ('s1', 101, 1, 40, 5, 70, 'first_view', '2026-11-05 11:00:00'), ('s2', 101, 1, 40, 5, 71, 'revisit', '2026-11-07 10:00:00');
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  return { db, env };
}

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/cycles/raise', raise);
  a.onError((e, c) => c.json({ error: e.message }, e.message === 'Unauthorized' ? 401 : 500));
  return a;
})();

async function call(env: any, path: string, who: number = FOUNDER) {
  const headers: Record<string, string> = { 'X-Company-Id': who === OTHER_FOUNDER ? '20' : '10' };
  headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who, role: who === ADMIN ? 'admin' : 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const r = await app.request(path, { headers }, env);
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, body, text };
}

test('D1585: one brief from what is recorded — who, the meeting, last met, deck links with signals, their objections first', async () => {
  const { env } = fixture();
  let ran = 0;
  env.AI = { run: async () => { ran += 1; return {}; } };
  const b = await prospectBrief(env, 101, 1, { eventId: 11, now: NOW });
  assert.ok(b);
  assert.deepEqual(b!.prospect, { id: 1, name: 'Ada Fixture', firm: 'Bluefern Capital', stage: 'meeting', warm_path: 'Via Bea', next_step: 'Send the model', next_step_due: '2026-11-12' });
  assert.deepEqual(b!.meeting, { event_id: 11, kind: 'meeting', starts_at: '2026-11-14T16:00:00Z', note: 'Partner meeting' });
  assert.deepEqual(b!.last_met, { event_id: 10, kind: 'call', at: '2026-10-20T15:00:00Z' });
  // Mutation checked: the asked-for event ignored → the brief prepares the earliest upcoming one; with no event it still does:
  assert.equal((await prospectBrief(env, 101, 1, { eventId: 12, now: NOW }))!.meeting!.event_id, 12, 'the meeting asked for');
  assert.equal((await prospectBrief(env, 101, 1, { now: NOW }))!.meeting!.event_id, 11, 'else the next one');
  assert.equal((await prospectBrief(env, 101, 1, { eventId: 90, now: NOW }))!.meeting!.event_id, 11, 'another prospect\'s event is ignored');

  assert.equal(b!.deck.state, 'ok');
  const links = (b!.deck as any).links;
  assert.deepEqual(links.map((l: any) => l.link_id), [40, 41], 'this venture\'s links for them, newest first; never another venture\'s deck');
  assert.deepEqual([links[0].views, links[0].read_seconds, links[0].deck_title], [2, 330, 'Seed deck']);
  assert.deepEqual(links[0].signals.map((s: any) => s.words), ['Opened', 'Revisited after 48 h']);
  assert.deepEqual([links[1].revoked, links[1].views, links[1].read_seconds], [true, 0, 0]);

  assert.equal(b!.objections.state, 'ok');
  const o = b!.objections as any;
  // Mutation checked: `theirs` sorted by the venture's count → "Market too small" (3 rows) first and this fails.
  assert.deepEqual(o.theirs.map((x: any) => [x.text, x.of_prospect]), [['churn looks HIGH', 2], ['Market too small', 1]], 'the newest words, their own count');
  assert.ok(o.elsewhere.every((x: any) => x.of_prospect === 0), 'only what others raised');
  assert.equal(o.elsewhere.length, ELSEWHERE_MAX);
  assert.ok(!JSON.stringify(b).includes('Secret other venture'), 'never another venture\'s feedback');

  assert.equal(b!.timeline.state, 'ok');
  assert.deepEqual((b!.timeline as any).items.map((t: any) => t.kind), ['note', 'meeting', 'meeting', 'call']);
  assert.equal(b!.basis, BRIEF_BASIS);
  assert.doesNotMatch(JSON.stringify(b), /@example\.test/, 'no email in the brief');
  assert.equal(ran, 0, 'no model runs');
});

test('D1585: the route — the founder reads it; another venture\'s prospect is 404; staff are pointed at a support read', async () => {
  const { env } = fixture();
  const ok = await call(env, '/api/cycles/raise/prospects/1/brief?project=101&event=11');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.meeting.event_id, 11);
  assert.doesNotMatch(ok.text, /@example\.test/);
  // Mutation checked: the brief read without `project_id = ?` → prospect 9 answers 200 here.
  assert.equal((await call(env, '/api/cycles/raise/prospects/9/brief?project=101')).status, 404, 'another venture\'s prospect');
  assert.equal((await call(env, '/api/cycles/raise/prospects/1/brief?project=101', OTHER_FOUNDER)).status, 403, 'not this venture\'s founder');
  assert.equal((await call(env, '/api/cycles/raise/prospects/x/brief?project=101')).status, 404);
  const staff = await call(env, '/api/cycles/raise/prospects/1/brief?project=101', ADMIN);
  assert.equal(staff.status, 403);
  assert.match(staff.text, /support_read_required/);
});

test('D1585: a part that cannot be read says so, and the rest still answers', async () => {
  const { db, env } = fixture();
  db.exec('DROP TABLE deck_share_views; DROP TABLE raise_prospect_feedback;');
  const b = await prospectBrief(env, 101, 1, { now: NOW });
  // Mutation checked: a failed deck read answering `{ state: 'ok', links: [] }` → this fails.
  assert.deepEqual(b!.deck, { state: 'unreadable' });
  assert.deepEqual(b!.objections, { state: 'unreadable' });
  assert.equal(b!.timeline.state, 'ok');
  assert.equal(b!.prospect.name, 'Ada Fixture');
  db.exec('DROP TABLE raise_prospect_events;');
  const c = await prospectBrief(env, 101, 1, { now: NOW });
  assert.deepEqual([c!.timeline, c!.meeting, c!.last_met], [{ state: 'unreadable' }, null, null]);
  const none = await prospectBrief(env, 101, 3, { now: NOW });
  assert.equal(none!.meeting, null);
});

test('D1585: an investor meeting on the founder\'s calendar carries its prospect, for Prep', async () => {
  const { env } = fixture();
  const items = await investorMeetingEvents(env, FOUNDER, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z');
  assert.deepEqual(items.map((i) => [i.source_id, i.prospect_id, i.project_id]), [[11, 1, 101], [12, 1, 101]]);
});
