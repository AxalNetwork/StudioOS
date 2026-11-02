/**
 * D1486 §a (#3980, source 5a of #3723) — the meeting bot's calls on the
 * calendar (`services/calendar/botCalls.ts`, family Meetings, module
 * "Validate › Record a session").
 *
 *   1. Owner only: a second user sees none of the first user's runs, and no
 *      staff scope lists them.
 *   2. Epoch milliseconds become ISO; a run starts when the bot joined, else when
 *      it was scheduled, and ends when it left, else at its limit.
 *   3. `done` reads "Recorded"; "Transcript ready" only when the run's session
 *      holds its final transcript, and never before the run is done.
 *   4. Never in an .ics file or a feed; page only and not pushable.
 *   5. Privacy (D886): the reader never reads the meeting link or the
 *      participants, and a failing read logs no title or name.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { FEED_KINDS, PAGE_ONLY_KINDS, PERSONAL_ONLY_KINDS, eventsToIcs, fetchUserEvents, fetchUserEventsWithSources } from '../src/services/calendar.ts';
import { SOURCES } from '../src/services/calendar/registry.ts';
import { describeItems } from '../src/services/calendar/items.ts';
import { BOT_STATE_WORDS, TRANSCRIPT_READY, botCallEvents } from '../src/services/calendar/botCalls.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const READER = readFileSync('cloudflare-worker/src/services/calendar/botCalls.ts', 'utf8');
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const ms = (iso: string) => Date.parse(iso);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1);
   INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(20,'Other venture',102);
   INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES(11,10,'Fixture person'),(12,10,'Second person'),(13,10,'Third person'),(21,20,'Other person');
   INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel) VALUES
    (11,'s-one',11,10,1,'video'),(12,'s-two',12,10,1,'video'),(13,'s-three',13,10,1,'video'),(21,'s-other',21,20,2,'video');`);
  const bot = db.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,status,scheduled_at,started_at,ended_at,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at,participants_enc)
    VALUES (?,?,?,?,'zoom','enc:synthetic-link',?,?,?,?,30,1,2,?,?)`);
  // Done, with its final transcript.
  bot.run('run-done-t', 1, 10, 11, 'done', ms('2026-11-03T11:55:00Z'), ms('2026-11-03T12:00:00Z'), ms('2026-11-03T12:40:00Z'), ms('2026-11-02T00:00:00Z'), 'enc:synthetic-names');
  // Done, no transcript.
  bot.run('run-done', 1, 10, 12, 'done', ms('2026-11-04T09:00:00Z'), ms('2026-11-04T09:02:00Z'), ms('2026-11-04T09:30:00Z'), ms('2026-11-02T00:00:00Z'), null);
  // Queued: not started, so its scheduled time and its 30-minute limit.
  bot.run('run-queued', 1, 10, 13, 'queued', ms('2026-11-20T15:00:00Z'), null, null, ms('2026-11-02T00:00:00Z'), null);
  // Another member's run.
  bot.run('run-other', 2, 20, 21, 'done', ms('2026-11-05T10:00:00Z'), ms('2026-11-05T10:00:00Z'), ms('2026-11-05T10:30:00Z'), ms('2026-11-02T00:00:00Z'), null);
  db.exec(`INSERT INTO interview_transcript_segments(session_id,source,start_ms,end_ms,text) VALUES (11,'final',0,1000,'Synthetic words'),(12,'live',0,1000,'A live passage only'),(13,'final',0,1000,'Not done yet')`);
  return { db, env: { DB: d1Over(db) } as any };
}

const words = (events: any[]) => Object.fromEntries(events.map((e) => [e.source_uid, e.bot.words]));

test('D1486 §a: the member\'s own runs only; a second user sees none, and no staff scope lists them', async () => {
  // Mutation checked: `b.user_id = ?1` dropped → user 1 reads run-other, this fails.
  const { env, db } = fixture();
  try {
    const mine = await botCallEvents(env, 1, FROM, TO);
    assert.deepEqual(mine.map((e) => e.source_uid), ['run-done-t', 'run-done', 'run-queued']);
    const theirs = await botCallEvents(env, 2, FROM, TO);
    assert.deepEqual(theirs.map((e) => e.source_uid), ['run-other']);
    assert.deepEqual(await botCallEvents(env, 3, FROM, TO), [], 'a member with no runs reads none');
    assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes('bot_call'), 'no staff scope has a reader for it');
    const { events, sources } = await fetchUserEventsWithSources(env, 1, 'founder', FROM, TO, ['bot_call']);
    assert.deepEqual(sources, [{ kind: 'bot_call', ok: true, error: null }]);
    assert.equal(events.length, 3);
  } finally { db.close(); }
});

test('D1486 §a: epoch milliseconds become ISO; joined-else-scheduled to left-else-limit', async () => {
  const { env, db } = fixture();
  try {
    const by = Object.fromEntries((await botCallEvents(env, 1, FROM, TO)).map((e) => [e.source_uid, e]));
    assert.deepEqual([by['run-done-t'].start_at, by['run-done-t'].end_at], ['2026-11-03T12:00:00.000Z', '2026-11-03T12:40:00.000Z']);
    assert.deepEqual([by['run-queued'].start_at, by['run-queued'].end_at], ['2026-11-20T15:00:00.000Z', '2026-11-20T15:30:00.000Z']);
    assert.equal(by['run-done-t'].all_day, false);
    assert.equal(by['run-done-t'].title, 'Recorded call · Fixture person');
    assert.equal(by['run-done-t'].location_uri, null, 'the meeting link is never on the item');
    // The window is half open, on the run's start.
    assert.deepEqual((await botCallEvents(env, 1, '2026-11-03T12:00:00.000Z', '2026-11-04T09:02:00.000Z')).map((e) => e.source_uid), ['run-done-t']);
  } finally { db.close(); }
});

test('D1486 §a: done reads Recorded; Transcript ready only with the run\'s final transcript, and never before done', async () => {
  // Mutations checked: the EXISTS dropped (transcript_ready always 1) → run-done says Transcript ready, this fails;
  // the `state === 'done'` guard dropped → run-queued says Transcript ready, this fails.
  const { env, db } = fixture();
  try {
    const w = words(await botCallEvents(env, 1, FROM, TO));
    assert.deepEqual(w, { 'run-done-t': `Recorded · ${TRANSCRIPT_READY}`, 'run-done': 'Recorded', 'run-queued': 'Scheduled' });
    assert.equal(BOT_STATE_WORDS.done, 'Recorded');
    assert.equal(Object.values(BOT_STATE_WORDS).filter((x) => x === 'Recorded').length, 1, 'only done is Recorded');
    // A live passage alone is no transcript; a transcript on a run not yet done is not announced.
    const by = Object.fromEntries((await botCallEvents(env, 1, FROM, TO)).map((e) => [e.source_uid, e.bot]));
    assert.deepEqual([by['run-done'].transcript_ready, by['run-queued'].transcript_ready, by['run-done-t'].transcript_ready], [false, false, true]);
    // The item names its source in plain words.
    const items = await describeItems(env, { id: 1, role: 'founder', email: 'one@example.test' } as any, await botCallEvents(env, 1, FROM, TO));
    assert.deepEqual(items[0].source, { family: 'meetings', module: 'Validate › Record a session', label: 'Recorded call', account: null });
    assert.equal(items[0].href, '/validate/customer-research?project=10');
  } finally { db.close(); }
});

test('D1486 §a: never in an .ics file or a feed, page only and not pushable', async () => {
  const { env, db } = fixture();
  try {
    assert.deepEqual([SOURCES.bot_call.page_only, SOURCES.bot_call.pushable], [true, false]);
    assert.ok((PAGE_ONLY_KINDS as readonly string[]).includes('bot_call'));
    assert.ok(!(FEED_KINDS as readonly string[]).includes('bot_call'));
    const feed = await fetchUserEvents(env, 1, 'founder', FROM, TO);
    assert.ok(!feed.some((e) => e.kind === 'bot_call'), 'the feed and .ics read never include it');
    assert.doesNotMatch(eventsToIcs(feed), /Recorded call/);
  } finally { db.close(); }
});

test('D1486 §a: the reader never reads the link or the participants, and a failing read logs no title or name', async () => {
  // D886: the meeting link and the participants stay encrypted and unread here.
  assert.doesNotMatch(READER.replace(/\/\*[\s\S]*?\*\//g, ''), /meeting_url_enc|participants_enc|payload_enc/);
  const { env, db } = fixture();
  const seen: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { seen.push(JSON.stringify(a)); };
  try {
    db.exec('DROP TABLE interview_transcript_segments');
    const { events, sources } = await fetchUserEventsWithSources(env, 1, 'founder', FROM, TO, ['bot_call']);
    assert.deepEqual([events, sources[0].ok], [[], false], 'only that source fails');
    assert.ok(seen.length >= 1);
    for (const line of seen) assert.doesNotMatch(line, /Fixture person|Recorded call|synthetic-link|zoom/i, 'codes only in the log');
  } finally { console.warn = warn; db.close(); }
});
