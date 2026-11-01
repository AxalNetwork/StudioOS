/**
 * D1484 (#3977, part 1 of #3723) — the calendar's source registry, the plain
 * names on every item, D1208's three readers wired, and the manual reader.
 *
 *   1. The registry's keys equal READERS' keys equal the kind union, and the
 *      derived lists (PAGE_ONLY_KINDS, COPYABLE_KINDS, the route's
 *      PUSHABLE_KINDS, FAMILY_OF) agree with it.
 *   2. No label or module is a table name from schema_baseline.sql.
 *   3. The three D1208 kinds and `manual` reach their owner only: a second
 *      synthetic user sees none, and one user's manual rows never reach another.
 *   4. None of them is in an .ics file or a feed.
 *   5. Each item carries `source`, and a deadline stays all day.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration, no files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { KNOWN_KINDS, PAGE_ONLY_KINDS, FEED_KINDS, PERSONAL_ONLY_KINDS, fetchUserEvents, fetchUserEventsWithSources, eventsToIcs } from '../src/services/calendar.ts';
import { SOURCES, SOURCE_FAMILIES, pageOnlyKinds, pushableKinds } from '../src/services/calendar/registry.ts';
import { COPYABLE_KINDS, FAMILY_OF, describeItems } from '../src/services/calendar/items.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const SERVICE = readFileSync('cloudflare-worker/src/services/calendar.ts', 'utf8');
const ROUTE = readFileSync('cloudflare-worker/src/routes/calendar.ts', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const NEW_KINDS = ['interview_call', 'cohort_date', 'deal_closing', 'manual'] as const;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1),
    (4,'investor','Fixture investor','four@example.test',NULL,1),(6,'investor','Other investor','six@example.test',NULL,1);
   INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(20,'Other venture',102);
   INSERT INTO deals(id,uid,project_id,closing_deadline) VALUES(100,'deal-one',10,'2026-11-15');
   INSERT INTO investor_dealroom_members(investor_user_id,deal_id) VALUES(4,100);
   INSERT INTO cohort_cycles(id,year,month,start_at,end_at,status) VALUES(10,2026,11,'2026-11-01T04:00:00Z','2026-11-30T05:00:00Z','active');
   INSERT INTO week_windows(cohort_cycle_id,week_number,unlock_at,deadline_at) VALUES(10,1,'2026-11-01T04:00:00Z','2026-11-08T04:59:00Z');
   UPDATE users SET spinout_lab_active=1,spinout_lab_started_at='2026-11-02T10:00:00Z' WHERE id=1;
   INSERT INTO discovery_interviews(id,project_id,interviewee_name) VALUES(11,10,'Fixture person');
   INSERT INTO interview_sessions(id,uid,interview_id,project_id,created_by_user_id,channel) VALUES(11,'session-one',11,10,1,'video');
   INSERT INTO interview_channel_refs(id,uid,provider,external_ref,session_id,interview_id,user_id,join_url,starts_at,ends_at) VALUES
    (11,'call-one','zoom','synthetic-one',11,11,1,'https://example.test/one','2026-11-03 12:00:00','2026-11-03 12:30:00');
   INSERT INTO calendar_events(uid,user_id,source,kind,external_uri,title,start_at,end_at,status) VALUES
    ('axal:manual:one',1,'manual','other','axal:manual:one','Fixture own event','2026-11-05T09:00:00.000Z','2026-11-05T10:00:00.000Z','scheduled'),
    ('axal:manual:two',2,'manual','other','axal:manual:two','Other own event','2026-11-06T09:00:00.000Z','2026-11-06T10:00:00.000Z','scheduled');`);
  return { db, env: { DB: d1Over(db) } as any };
}

test('D1484: registry keys equal READERS keys equal the union, and every derived list agrees with it', () => {
  const union = [...(SERVICE.match(/\n {2}kind: ((?:'\w+'(?:\s*\|\s*)?)+);/)?.[1] || '').matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.equal(union.length, 23); // #3959: Learning joined; D1486 §b (#3981): Publish sends and planned content; §c (#3982): round_close and nda_expiry; §d (#3983): four task stores.
  assert.deepEqual(Object.keys(SOURCES).sort(), union);
  assert.deepEqual([...KNOWN_KINDS].sort(), union);
  assert.deepEqual(Object.keys(FAMILY_OF).sort(), union);
  assert.deepEqual([...PAGE_ONLY_KINDS], pageOnlyKinds());
  assert.deepEqual([...FEED_KINDS].sort(), union.filter((k) => !SOURCES[k as keyof typeof SOURCES].page_only));
  assert.deepEqual([...COPYABLE_KINDS].sort(), pushableKinds().sort());
  const routeSet = [...(ROUTE.match(/const PUSHABLE_KINDS = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '').matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(routeSet, pushableKinds().sort());
  for (const k of NEW_KINDS) {
    assert.equal(SOURCES[k].page_only, true, `${k} is page only`);
    assert.equal(SOURCES[k].pushable, false, `${k} is not pushable`);
    assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), `${k} never enters a staff scope`);
  }
  for (const s of Object.values(SOURCES)) assert.ok(SOURCE_FAMILIES.includes(s.family));
});

test('D1484: no label or module is a table name', () => {
  const tables = new Set([...BASELINE.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?(\w+)/gi)].map((m) => m[1].toLowerCase()));
  for (const m of MIGRATIONS) for (const t of m.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?(\w+)/gi)) tables.add(t[1].toLowerCase());
  assert.ok(tables.size > 100 && tables.has('calendar_events'), 'the table names parsed');
  for (const [kind, s] of Object.entries(SOURCES)) {
    for (const words of [s.label, s.module]) {
      const tokens = [words.toLowerCase(), ...words.toLowerCase().split(/[\s›·,]+/).filter(Boolean)];
      for (const t of tokens) assert.ok(!tables.has(t) || !t.includes('_'), `${kind}: "${words}" names the table ${t}`);
      assert.ok(!tables.has(words.toLowerCase()), `${kind}: "${words}" is a table name`);
      assert.doesNotMatch(words, /_/, `${kind}: "${words}" reads like a column or a table`);
    }
  }
});

test('D1484: the three D1208 kinds and manual reach their owner only', async () => {
  const { db, env } = fixture();
  try {
    const kindsOf = async (user: number, role: string) => {
      const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [...NEW_KINDS], { withCancelled: true });
      assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
      return r.events;
    };
    const founder = await kindsOf(1, 'founder');
    assert.deepEqual([...new Set(founder.map((e) => e.kind))].sort(), ['cohort_date', 'interview_call', 'manual']);
    assert.deepEqual(founder.filter((e) => e.kind === 'manual').map((e) => e.title), ['Fixture own event']);
    const investor = await kindsOf(4, 'investor');
    assert.deepEqual(investor.map((e) => e.kind), ['deal_closing']);
    // A second synthetic user sees none of the first's, and only their own manual row.
    const other = await kindsOf(2, 'founder');
    assert.deepEqual(other.map((e) => [e.kind, e.title]), [['manual', 'Other own event']]);
    assert.deepEqual(await kindsOf(6, 'investor'), []);
  } finally { db.close(); }
});

test('D1484: none of them is in an .ics file or a feed', async () => {
  const { db, env } = fixture();
  try {
    const feed = await fetchUserEvents(env, 1, 'founder', FROM, TO);
    assert.ok(feed.every((e) => !(NEW_KINDS as readonly string[]).includes(e.kind)));
    assert.deepEqual(await fetchUserEvents(env, 1, 'founder', FROM, TO, [...NEW_KINDS]), [], 'asked for by name, still none');
    const ics = eventsToIcs(feed, 'Fixture');
    for (const t of ['Fixture own event', 'Interview · Fixture person', 'Cohort 2026-11']) assert.ok(!ics.includes(t), t);
  } finally { db.close(); }
});

test('D1484: every item carries its source in plain words, and a deadline stays all day', async () => {
  const { db, env } = fixture();
  try {
    const { events } = await fetchUserEventsWithSources(env, 4, 'investor', FROM, TO, ['deal_closing'], { withCancelled: true });
    const [item] = await describeItems(env, { id: 4, role: 'investor' }, events);
    assert.deepEqual(item.source, { family: 'deadlines', module: 'Deals › Closings', label: 'Deal closing', account: null });
    assert.equal(item.all_day, true);
    assert.equal(item.href, '/deals/100');
    const mine = await fetchUserEventsWithSources(env, 1, 'founder', FROM, TO, ['interview_call', 'manual'], { withCancelled: true });
    const items = await describeItems(env, { id: 1, role: 'founder' }, mine.events);
    const call = items.find((i) => i.kind === 'interview_call')!;
    assert.equal(call.all_day, false);
    assert.equal(call.source.module, 'Validate › Customer research');
    assert.equal(items.find((i) => i.kind === 'manual')!.source.label, 'Your event');
  } finally { db.close(); }
});
