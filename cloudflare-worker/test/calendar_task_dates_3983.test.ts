/**
 * #3983 (D1486 §d): the dated task stores on the calendar.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/calendar_task_dates_3983.test.ts
 *
 *   1. Each store shows its owner's rows only, and a second user sees none of
 *      them: a workflow task and a build card by assignee, a contact follow-up
 *      by the venture's founder, a milestone by the delivering partner.
 *   2. Done and cancelled rows are hidden (and an archived card, a deleted
 *      venture's card, a cancelled engagement's milestone).
 *   3. Every item is all day on its due date, names its source in plain words,
 *      and links where it belongs.
 *   4. All four are page only: never in an .ics file or a feed, never in a
 *      staff scope.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration; synthetic rows.
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

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const DIR = 'cloudflare-worker/sql/migrations';
const MIGRATIONS = readdirSync(DIR).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort().map((n) => readFileSync(`${DIR}/${n}`, 'utf8'));
const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const KINDS = ['workflow_task', 'mvp_task', 'contact_task', 'engagement_milestone'] as const;
const FOUNDER = 1, SECOND = 2, PARTNER = 3, OTHER_PARTNER = 4, OUTSIDER = 5;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,partner_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,NULL,1),
    (2,'founder','Second founder','two@example.test',102,NULL,1),
    (3,'partner','Fixture partner','three@example.test',NULL,301,1),
    (4,'partner','Other partner','four@example.test',NULL,302,1),
    (5,'investor','Outsider','five@example.test',NULL,NULL,1);
   INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(20,'Second venture',102);
   INSERT INTO projects(id,name,founder_id,deleted_at) VALUES(30,'Deleted venture',101,'2026-10-01 00:00:00');
   INSERT INTO workflows(id,type,title,owner_user_id) VALUES(1,'ops','Fixture workflow',1);
   INSERT INTO workflow_tasks(id,workflow_id,title,assignee_user_id,status,due_date) VALUES
    (1,1,'Send board pack',1,'todo','2026-11-10'),
    (2,1,'Finished task',1,'done','2026-11-11'),
    (3,1,'Dropped task',1,'cancelled','2026-11-12'),
    (4,1,'Review deck',2,'in_progress','2026-11-13 09:00:00'),
    (5,1,'Next month',1,'todo','2026-12-05');
   INSERT INTO mvp_tasks(id,deal_id,title,assigned_to,status,due_date) VALUES
    (1,10,'Ship login',1,'todo','2026-11-14'),
    (2,10,'Shipped card',1,'done','2026-11-15'),
    (3,10,'Pricing page',2,'review','2026-11-15'),
    (4,30,'Deleted venture card',1,'todo','2026-11-16'),
    (5,10,'Archived card',1,'archived','2026-11-17'),
    (6,10,'Cancelled card',1,'cancelled','2026-11-17');
   INSERT INTO contacts(id,uid,project_id,audience,name,email) VALUES
    (1,'contact-1',10,'customer','Fixture contact','c1@example.test'),
    (2,'contact-2',20,'customer','Second contact','c2@example.test');
   INSERT INTO contact_tasks(id,contact_id,title,due_date,done) VALUES
    (1,1,'Send pricing','2026-11-18',0),
    (2,1,'Already sent','2026-11-19',1),
    (3,2,'Call back','2026-11-20',0);
   INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status) VALUES
    (1,'eng-1',1,1,301,101,10,1000,'in_progress'),
    (2,'eng-2',2,2,302,102,20,1000,'accepted');
   INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status,cancelled_at) VALUES
    (3,'eng-3',3,3,301,101,10,1000,'cancelled','2026-10-20 00:00:00');
   INSERT INTO engagement_milestones(id,uid,engagement_id,title,due_at) VALUES
    (1,'ms-1',1,'Kickoff deck','2026-11-21'),
    (3,'ms-3',2,'Other delivery','2026-11-23'),
    (4,'ms-4',3,'Cancelled delivery','2026-11-24');
   INSERT INTO engagement_milestones(id,uid,engagement_id,title,due_at,completed_at) VALUES
    (2,'ms-2',1,'Done delivery','2026-11-22','2026-11-20 10:00:00');`);
  return { db, env: { DB: d1Over(db) } as any };
}

const page = async (env: any, user: number, role: string, kinds: readonly string[] = KINDS) => {
  const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [...kinds], { withCancelled: true });
  assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
  return r.events.map((e) => [e.kind, e.title]);
};

test('workflow_task and mvp_task: the assignee sees their own open rows; a second user sees none of them', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder', ['workflow_task']), [['workflow_task', 'Due · Send board pack']], 'done, cancelled and next month are not shown');
    assert.deepEqual(await page(env, SECOND, 'founder', ['workflow_task']), [['workflow_task', 'Due · Review deck']], 'only their own');
    assert.deepEqual(await page(env, FOUNDER, 'founder', ['mvp_task']), [['mvp_task', 'Due · Ship login']], 'done, archived, cancelled and a deleted venture\'s card are not shown');
    assert.deepEqual(await page(env, SECOND, 'founder', ['mvp_task']), [['mvp_task', 'Due · Pricing page']], 'only their own');
    assert.deepEqual(await page(env, OUTSIDER, 'investor'), [], 'an outsider sees none');
  } finally { db.close(); }
});

test('contact_task: the venture\'s founder sees its open follow-ups; another founder sees only their own', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder', ['contact_task']), [['contact_task', 'Follow up · Send pricing']], 'a done follow-up is not shown');
    assert.deepEqual(await page(env, SECOND, 'founder', ['contact_task']), [['contact_task', 'Follow up · Call back']]);
    assert.deepEqual(await page(env, PARTNER, 'partner', ['contact_task']), [], 'a partner sees no founder\'s contacts');
    const { events } = await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, ['contact_task'], { withCancelled: true });
    assert.ok(!/@example\.test/.test(JSON.stringify(events)), 'no contact email reaches the item');
  } finally { db.close(); }
});

test('engagement_milestone: the delivering partner sees its open milestones; another partner and the founder see none', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, PARTNER, 'partner', ['engagement_milestone']), [['engagement_milestone', 'Milestone · Kickoff deck']], 'completed and cancelled-engagement milestones are not shown');
    assert.deepEqual(await page(env, OTHER_PARTNER, 'partner', ['engagement_milestone']), [['engagement_milestone', 'Milestone · Other delivery']], 'only their own');
    assert.deepEqual(await page(env, FOUNDER, 'founder', ['engagement_milestone']), [], 'the founder reads no milestones today');
    assert.deepEqual(await page(env, OUTSIDER, 'investor', ['engagement_milestone']), []);
  } finally { db.close(); }
});

test('every item is all day on its due date, names its source in plain words, and links where it belongs', async () => {
  const { db, env } = fixture();
  try {
    const founder = await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, [...KINDS], { withCancelled: true });
    const partner = await fetchUserEventsWithSources(env, PARTNER, 'partner', FROM, TO, [...KINDS], { withCancelled: true });
    const items = [
      ...await describeItems(env, { id: FOUNDER, role: 'founder' }, founder.events),
      ...await describeItems(env, { id: PARTNER, role: 'partner' }, partner.events),
    ];
    const by = Object.fromEntries(items.map((i) => [i.kind, i]));
    assert.deepEqual(Object.keys(by).sort(), [...KINDS].sort());
    assert.deepEqual([by.workflow_task.all_day, by.workflow_task.start_at, by.workflow_task.end_at], [true, '2026-11-10', '2026-11-11']);
    assert.deepEqual([by.mvp_task.all_day, by.mvp_task.start_at, by.mvp_task.end_at], [true, '2026-11-14', '2026-11-15']);
    assert.deepEqual([by.contact_task.all_day, by.contact_task.start_at, by.contact_task.end_at], [true, '2026-11-18', '2026-11-19']);
    assert.deepEqual([by.engagement_milestone.all_day, by.engagement_milestone.start_at, by.engagement_milestone.end_at], [true, '2026-11-21', '2026-11-22']);
    // A due date stored with a time is still a day.
    const second = await fetchUserEventsWithSources(env, SECOND, 'founder', FROM, TO, ['workflow_task'], { withCancelled: true });
    assert.deepEqual([second.events[0].start_at, second.events[0].end_at], ['2026-11-13', '2026-11-14']);
    assert.deepEqual(by.engagement_milestone.source, { family: 'tasks', module: 'Engagements › Milestones', label: 'Engagement milestone', account: null });
    for (const k of KINDS) {
      assert.equal(by[k].source.family, 'tasks', k);
      assert.equal(by[k].family, 'deadlines', k);
    }
    assert.deepEqual(KINDS.map((k) => by[k].href), [null, '/build/board', '/contacts', '/delivery/health']);
    assert.deepEqual(KINDS.map((k) => by[k].my_role.words), ['Assigned to you', 'Assigned to you', 'Your venture’s follow-up', 'You deliver this']);
  } finally { db.close(); }
});

test('all four are page only: never in an .ics file or a feed, and never in a staff scope', async () => {
  const { db, env } = fixture();
  try {
    for (const k of KINDS) {
      assert.equal(SOURCES[k].page_only, true, k);
      assert.equal(SOURCES[k].pushable, false, k);
      assert.ok((PAGE_ONLY_KINDS as readonly string[]).includes(k) && !(FEED_KINDS as readonly string[]).includes(k), k);
      assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), `${k} never enters a staff scope`);
    }
    for (const [user, role] of [[FOUNDER, 'founder'], [PARTNER, 'partner']] as const) {
      const feed = await fetchUserEvents(env, user, role, FROM, TO);
      assert.ok(feed.every((e) => !(KINDS as readonly string[]).includes(e.kind)));
      assert.deepEqual(await fetchUserEvents(env, user, role, FROM, TO, [...KINDS]), [], 'asked for by name, still none');
      const ics = eventsToIcs(feed, 'Fixture');
      for (const t of ['Due ·', 'Follow up ·', 'Milestone ·']) assert.ok(!ics.includes(t), t);
    }
  } finally { db.close(); }
});
