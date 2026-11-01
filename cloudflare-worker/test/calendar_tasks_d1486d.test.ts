/**
 * #3983 (D1486 §d, source 5d of #3723): tasks and engagement milestones on
 * the calendar.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/calendar_tasks_d1486d.test.ts
 *
 *   1. workflow_task: assigned to the member, or unassigned in a workflow the
 *      member owns; a second user sees none of the first's.
 *   2. mvp_task: assigned to the member who can read the board, or unassigned
 *      on the member's own venture; an assignee who cannot read the board, and
 *      another founder, see none.
 *   3. contact_task: created by the member on a contact of their own venture,
 *      named by the contact's name and never an email.
 *   4. engagement_milestone: the member's partner firm only, on an engagement
 *      that is not cancelled.
 *   5. Done, cancelled and completed rows are hidden, and a due date that is not
 *      a date is skipped.
 *   6. All day on the due day, the Tasks family and plain-word sources; never in
 *      an .ics file, a feed or a staff scope.
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
const FOUNDER = 1, SECOND = 2, ADMIN = 3, PARTNER = 4, OTHER_PARTNER = 5, OTHER_FOUNDER = 6;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,partner_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,NULL,1),
    (2,'founder','Second member','two@example.test',NULL,NULL,1),
    (3,'admin','Fixture admin','three@example.test',NULL,NULL,1),
    (4,'partner','Fixture partner','four@example.test',NULL,7,1),
    (5,'partner','Other partner','five@example.test',NULL,8,1),
    (6,'founder','Other founder','six@example.test',105,NULL,1);
   INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(50,'Other venture',105);
   INSERT INTO workflows(id,type,title,status,project_id,owner_user_id) VALUES
    (1,'strategic','Fixture workflow','active',10,1),
    (2,'strategic','Studio workflow','active',NULL,3);
   INSERT INTO workflow_tasks(id,workflow_id,title,status,assignee_user_id,due_date) VALUES
    (1,1,'Draft the data room','todo',1,'2026-11-05'),
    (2,1,'Unassigned in my workflow','todo',NULL,'2026-11-06'),
    (3,1,'For the second member','todo',2,'2026-11-07'),
    (4,1,'Already done','done',1,'2026-11-08'),
    (5,2,'Studio task','todo',NULL,'2026-11-09'),
    (6,1,'Timed task','in_progress',1,'2026-11-10 09:30:00'),
    (7,1,'Cancelled task','cancelled',1,'2026-11-11');
   INSERT INTO mvp_tasks(id,deal_id,title,status,assigned_to,due_date) VALUES
    (1,10,'Ship the login','todo',1,'2026-11-12'),
    (2,10,'Unassigned card','todo',NULL,'2026-11-13'),
    (3,10,'Card for the second member','todo',2,'2026-11-14'),
    (4,10,'Card for the admin','in_progress',3,'2026-11-15'),
    (5,10,'Shipped card','done',1,'2026-11-16'),
    (6,50,'Other venture card','todo',NULL,'2026-11-17'),
    (7,10,'Archived card','archived',NULL,'2026-11-18');
   INSERT INTO contacts(id,uid,project_id,audience,name,email) VALUES
    (1,'contact-one',10,'customer','Fixture customer','customer@example.test'),
    (2,'contact-two',50,'customer','Other customer','other@example.test');
   INSERT INTO contact_tasks(id,contact_id,title,due_date,done,created_by) VALUES
    (1,1,'Call back','2026-11-19',0,1),
    (2,1,'Second member note','2026-11-20',0,2),
    (3,1,'Done call','2026-11-21',1,1),
    (4,2,'Not my venture','2026-11-22',0,1),
    (5,1,'Not a date','next week',0,1);
   INSERT INTO engagements(id,uid,need_id,quote_id,partner_id,founder_id,project_id,price,status,cancelled_at) VALUES
    (1,'eng-one',1,1,7,1,10,1000,'accepted',NULL),
    (2,'eng-two',2,2,8,1,10,1000,'accepted',NULL),
    (3,'eng-three',3,3,7,1,10,1000,'cancelled','2026-10-30 00:00:00');
   INSERT INTO engagement_milestones(id,uid,engagement_id,title,due_at,completed_at) VALUES
    (1,'ms-one',1,'Kickoff report','2026-11-23',NULL),
    (2,'ms-two',1,'Completed milestone','2026-11-24','2026-11-02 00:00:00'),
    (3,'ms-three',2,'Other firm milestone','2026-11-25',NULL),
    (4,'ms-four',3,'Cancelled engagement milestone','2026-11-26',NULL);`);
  return { db, env: { DB: d1Over(db) } as any };
}

const page = async (env: any, user: number, role: string, kind: (typeof KINDS)[number]) => {
  const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [kind], { withCancelled: true });
  assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
  return r.events.map((e) => e.title);
};

test('workflow_task: assigned to the member, or unassigned in a workflow they own; a second user sees none of theirs', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder', 'workflow_task'), ['Draft the data room', 'Unassigned in my workflow', 'Timed task']);
    assert.deepEqual(await page(env, SECOND, 'founder', 'workflow_task'), ['For the second member'], 'their own assignment only');
    assert.deepEqual(await page(env, ADMIN, 'admin', 'workflow_task'), ['Studio task'], 'an admin sees their own workflow, not the venture\'s');
    assert.deepEqual(await page(env, OTHER_FOUNDER, 'founder', 'workflow_task'), []);
  } finally { db.close(); }
});

test('mvp_task: assigned to the member who can read the board, or unassigned on their own venture', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder', 'mvp_task'), ['Ship the login', 'Unassigned card']);
    assert.deepEqual(await page(env, SECOND, 'founder', 'mvp_task'), [], 'an assignee who cannot read the board sees none');
    assert.deepEqual(await page(env, ADMIN, 'admin', 'mvp_task'), ['Card for the admin'], 'an admin reads the board; only their own card');
    assert.deepEqual(await page(env, OTHER_FOUNDER, 'founder', 'mvp_task'), ['Other venture card'], 'their own venture only');
  } finally { db.close(); }
});

test('contact_task: created by the member on their own venture\'s contact, by the contact\'s name and never an email', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder', 'contact_task'), ['Call back · Fixture customer']);
    assert.deepEqual(await page(env, SECOND, 'founder', 'contact_task'), [], 'a task on a venture that is not theirs');
    assert.deepEqual(await page(env, OTHER_FOUNDER, 'founder', 'contact_task'), [], 'another founder sees no task they did not create');
    const { events } = await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, ['contact_task'], { withCancelled: true });
    assert.ok(!/@example\.test/.test(JSON.stringify(events)), 'no email reaches the item');
  } finally { db.close(); }
});

test('engagement_milestone: the member\'s partner firm only, on an engagement that is not cancelled', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, PARTNER, 'partner', 'engagement_milestone'), ['Kickoff report']);
    assert.deepEqual(await page(env, OTHER_PARTNER, 'partner', 'engagement_milestone'), ['Other firm milestone']);
    assert.deepEqual(await page(env, FOUNDER, 'founder', 'engagement_milestone'), [], 'the client founder reads no firm\'s milestones');
  } finally { db.close(); }
});

test('done, cancelled, archived and completed rows are hidden, and a due date that is not a date is skipped', async () => {
  const { db, env } = fixture();
  try {
    const all = (await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, [...KINDS], { withCancelled: true })).events.map((e) => e.title);
    for (const t of ['Already done', 'Cancelled task', 'Shipped card', 'Archived card', 'Done call', 'Not a date']) assert.ok(!all.includes(t), t);
    const firm = (await fetchUserEventsWithSources(env, PARTNER, 'partner', FROM, TO, [...KINDS], { withCancelled: true })).events.map((e) => e.title);
    for (const t of ['Completed milestone', 'Cancelled engagement milestone']) assert.ok(!firm.includes(t), t);
  } finally { db.close(); }
});

test('all day on the due day, in the Tasks family, with plain-word sources and their own pages', async () => {
  const { db, env } = fixture();
  try {
    const { events } = await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, [...KINDS], { withCancelled: true });
    const items = await describeItems(env, { id: FOUNDER, role: 'founder' }, events);
    const by = (title: string) => items.find((i) => i.title === title)!;
    const timed = by('Timed task');
    assert.deepEqual([timed.all_day, timed.start_at, timed.end_at], [true, '2026-11-10', '2026-11-11'], 'a time on the due date is still its day');
    for (const i of items) assert.equal(i.all_day, true, i.title);
    assert.deepEqual(by('Draft the data room').source, { family: 'tasks', module: 'Dashboard › My tasks', label: 'Task', account: null });
    assert.deepEqual(by('Ship the login').source, { family: 'tasks', module: 'Build › Board', label: 'Board card', account: null });
    assert.deepEqual(by('Call back · Fixture customer').source, { family: 'tasks', module: 'Network › Contacts', label: 'Contact task', account: null });
    assert.deepEqual([by('Draft the data room').href, by('Ship the login').href, by('Call back · Fixture customer').href], ['/dashboard', '/build/board', '/contacts']);
    assert.ok(items.every((i) => i.family === 'tasks'));
    const firm = await describeItems(env, { id: PARTNER, role: 'partner' },
      (await fetchUserEventsWithSources(env, PARTNER, 'partner', FROM, TO, ['engagement_milestone'], { withCancelled: true })).events);
    assert.deepEqual(firm[0].source, { family: 'tasks', module: 'Operations › Engagements', label: 'Milestone', account: null });
    assert.equal(firm[0].href, '/partner/operations/engagements');
    assert.deepEqual([firm[0].start_at, firm[0].end_at], ['2026-11-23', '2026-11-24']);
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
      for (const t of ['Draft the data room', 'Ship the login', 'Call back', 'Kickoff report']) assert.ok(!ics.includes(t), t);
    }
  } finally { db.close(); }
});
