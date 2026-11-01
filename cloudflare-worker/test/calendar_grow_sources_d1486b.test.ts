/**
 * D1486 §b (#3981, source 5b of #3723) — Publish's sends and Grow ›
 * Distribution's planned content on the calendar.
 *
 *   1. Only the venture's team sees them, by Publish's own rule (the founder,
 *      or a member of the venture's company); a send only for the member who
 *      confirmed it. A second user sees none.
 *   2. A planned piece is all day on `planned_on`; a dropped one is not shown.
 *   3. "Sent" only for `status = 'sent'`, on its `sent_at`; a scheduled send
 *      sits on `scheduled_for`; a retracted one is not shown.
 *   4. Neither is in an .ics file or a feed, nor in a staff scope.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration, no files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { PAGE_ONLY_KINDS, PERSONAL_ONLY_KINDS, eventsToIcs, fetchUserEvents, fetchUserEventsWithSources } from '../src/services/calendar.ts';
import { SOURCES } from '../src/services/calendar/registry.ts';
import { describeItems } from '../src/services/calendar/items.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const KINDS = ['publish_send', 'content_planned'] as const;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  // 1 founds venture 10 (company 50); 3 is linked to company 50; 2 founds venture 20; 5 is nobody's.
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1),
    (3,'founder','Fixture teammate','three@example.test',NULL,1),(5,'admin','Fixture admin','five@example.test',NULL,1);
   INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Fixture venture',101,50),(20,'Other venture',102,NULL);
   INSERT INTO user_company_links(uid,company_id,user_id) VALUES('link-three',50,3);
   INSERT INTO publish_drafts(id,uid,project_id,module,author_user_id) VALUES(1,'draft-one',10,'distribution',1),(2,'draft-two',20,'updates',2);
   INSERT INTO publish_sends(id,uid,draft_id,project_id,module,provider_key,destination_label,audience_label,idempotency_key,envelope_json,envelope_hash,status,confirmed_by,scheduled_for,sent_at) VALUES
    (1,'send-sent',1,10,'distribution','linkedin','LinkedIn page','Followers','idem-0001','{}','h','sent',1,'2026-11-04 09:00:00','2026-11-04 09:01:00'),
    (2,'send-later',1,10,'distribution','linkedin','LinkedIn page',NULL,'idem-0002','{}','h','ready',1,'2026-11-09 14:00:00',NULL),
    (3,'send-pulled',1,10,'distribution','linkedin','LinkedIn page',NULL,'idem-0003','{}','h','retracted',1,'2026-11-10 14:00:00','2026-11-10 14:00:00'),
    (4,'send-mate',1,10,'distribution','x','X account',NULL,'idem-0004','{}','h','ready',3,'2026-11-11 08:00:00',NULL),
    (5,'send-other',2,20,'updates','x','Other X',NULL,'idem-0005','{}','h','ready',2,'2026-11-12 08:00:00',NULL),
    (6,'send-left',2,20,'updates','x','Other X',NULL,'idem-0006','{}','h','ready',3,'2026-11-13 08:00:00',NULL);
   INSERT INTO content_calendar_items(id,uid,project_id,title,planned_on,status) VALUES
    (1,'piece-one',10,'Launch post','2026-11-07','planned'),
    (2,'piece-dropped',10,'Old idea','2026-11-08','dropped'),
    (3,'piece-other',20,'Other venture post','2026-11-07','planned');`);
  return { db, env: { DB: d1Over(db) } as any };
}

async function read(env: any, user: number, role = 'founder') {
  const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [...KINDS], { withCancelled: true });
  assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
  return r.events;
}

test('D1486 §b: the registry says Grow, page only, never pushed, never in a staff scope', () => {
  // Mutation checked: page_only false → the feed test fails; a kind left out of PERSONAL_ONLY_KINDS → this fails.
  assert.deepEqual(SOURCES.publish_send, { family: 'grow', module: 'Publish', label: 'Publish send', page_only: true, pushable: false });
  assert.deepEqual(SOURCES.content_planned, { family: 'grow', module: 'Grow › Distribution', label: 'Planned content', page_only: true, pushable: false });
  for (const k of KINDS) {
    assert.ok((PAGE_ONLY_KINDS as readonly string[]).includes(k), k);
    assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), k);
  }
});

test('D1486 §b: the team only, and a send only for who confirmed it; a second user sees none', async () => {
  // Mutation checked: the team predicate dropped (sends or pieces) → send-left reaches 3, or user 2 sees venture 10's pieces; confirmed_by dropped → the teammate's send reaches 1.
  const { db, env } = fixture();
  try {
    const founder = await read(env, 1);
    assert.deepEqual(founder.map((e) => e.source_uid), ['send-sent', 'piece-one', 'send-later']);
    const mate = await read(env, 3);
    assert.deepEqual(mate.map((e) => e.source_uid), ['piece-one', 'send-mate'], 'a company member sees the planned piece and their own send');
    // 3 confirmed send-left for venture 20, whose team they are not on (they left it): Publish would not show it, so neither does the calendar.
    assert.ok(!mate.some((e) => e.source_uid === 'send-left'));
    const other = await read(env, 2);
    assert.deepEqual(other.map((e) => e.source_uid), ['piece-other', 'send-other'], 'another founder sees only their own venture');
    assert.deepEqual(await read(env, 5, 'admin'), [], 'admin access never widens a personal read');
  } finally { db.close(); }
});

test('D1486 §b: "Sent" only when sent, a scheduled send on its time, a planned piece all day', async () => {
  // Mutation checked: the title always "Sent" → the scheduled check fails; planned_on read as a timed instant → all_day fails.
  const { db, env } = fixture();
  try {
    const events = await read(env, 1);
    const items = await describeItems(env, { id: 1, role: 'founder' }, events);
    const sent = items.find((i) => i.source_uid === 'send-sent')!;
    assert.equal(sent.title, 'Sent · LinkedIn page');
    assert.equal(sent.status, 'sent');
    assert.equal(sent.start_at, '2026-11-04T09:01:00.000Z', 'on its sent_at');
    assert.equal(sent.all_day, false);
    assert.equal(sent.notes, 'To Followers');
    assert.equal(sent.href, '/grow/distribution');
    assert.deepEqual(sent.source, { family: 'grow', module: 'Publish', label: 'Publish send', account: null });
    const later = items.find((i) => i.source_uid === 'send-later')!;
    assert.equal(later.title, 'Scheduled · LinkedIn page');
    assert.equal(later.status, 'scheduled');
    assert.equal(later.start_at, '2026-11-09T14:00:00.000Z');
    assert.ok(!items.some((i) => i.source_uid === 'send-pulled'), 'a retracted send is not on the calendar');
    const piece = items.find((i) => i.source_uid === 'piece-one')!;
    assert.equal(piece.all_day, true);
    assert.equal(piece.start_at, '2026-11-07');
    assert.equal(piece.end_at, '2026-11-08');
    assert.equal(piece.href, '/grow/distribution');
    assert.deepEqual(piece.source, { family: 'grow', module: 'Grow › Distribution', label: 'Planned content', account: null });
    assert.ok(!items.some((i) => i.source_uid === 'piece-dropped'), 'a dropped piece is not on the calendar');
  } finally { db.close(); }
});

test('D1486 §b: neither is in an .ics file or a feed', async () => {
  // Mutation checked: a kind not page only → the feed holds it.
  const { db, env } = fixture();
  try {
    const feed = await fetchUserEvents(env, 1, 'founder', FROM, TO);
    assert.ok(feed.every((e) => !(KINDS as readonly string[]).includes(e.kind)));
    assert.deepEqual(await fetchUserEvents(env, 1, 'founder', FROM, TO, [...KINDS]), [], 'asked for by name, still none');
    const ics = eventsToIcs(feed, 'Fixture');
    for (const t of ['LinkedIn page', 'Launch post']) assert.ok(!ics.includes(t), t);
  } finally { db.close(); }
});
