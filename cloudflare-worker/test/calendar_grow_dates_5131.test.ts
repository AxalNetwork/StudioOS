/**
 * #5131 (D1486 §e, source 5e of #3723) — Grow's campaign plans, ad flights,
 * Beehiiv newsletter sends and sequence steps on the calendar.
 *
 *   1. Only the venture's readers see them, by `canAccessProject`'s read rule:
 *      the founder, an accepted member; never a pending member, an
 *      investor-only member, another founder or an admin. A second user sees
 *      none of the first user's rows, for every reader.
 *   2. Campaigns and ad flights are all day on their recorded days (a span,
 *      or one edge day); newsletter sends and sequence steps are timed.
 *   3. Rows with no date are not put on the timeline; nor are archived plans,
 *      unpaid channels, a link with no day of its own, a later step or a
 *      blocked channel.
 *   4. None of them is in an .ics file, a feed or a staff scope.
 *   5. A Beehiiv post §b already shows as the member's Publish send is not
 *      shown twice, and §b's kinds are not repeated.
 *
 * In-memory SQLite: the baseline and every post-cutoff migration, no files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { PAGE_ONLY_KINDS, PERSONAL_ONLY_KINDS, eventsToIcs, fetchUserEvents, fetchUserEventsWithSources } from '../src/services/calendar.ts';
import { SOURCES } from '../src/services/calendar/registry.ts';
import { describeItems } from '../src/services/calendar/items.ts';
import { loadSchema } from './_schema_once.mjs';

const FROM = '2026-11-01T00:00:00.000Z', TO = '2026-12-01T00:00:00.000Z';
const KINDS = ['grow_campaign', 'ad_flight', 'newsletter_send', 'sequence_step'] as const;
const UID = (c: string) => c.repeat(32);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  loadSchema(db);
  // 1 founds venture 10 (company 50); 2 founds venture 20; 3 is an accepted co-founder of 10; 4 a pending one;
  // 5 an admin; 6 an investor-only account with an accepted row on 10; 7 is nobody's; 8 an advisor whose extra
  // founder licence and founder_id make them 10's founder; 9 has 10's founder_id but holds no founder licence.
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),(2,'founder','Other founder','two@example.test',102,1),
    (3,'founder','Fixture cofounder','three@example.test',NULL,1),(4,'founder','Pending member','four@example.test',NULL,1),
    (5,'admin','Fixture admin','five@example.test',NULL,1),(6,'investor','Investor member','six@example.test',NULL,1),
    (7,'founder','Nobody','seven@example.test',103,1),(8,'advisor','Licensed founder','eight@example.test',101,1),
    (9,'partner','Stale founder id','nine@example.test',101,1);
   INSERT INTO projects(id,name,founder_id,company_id) VALUES(10,'Fixture venture',101,50),(20,'Other venture',102,NULL);
   INSERT INTO project_members(project_id,user_id,role,status) VALUES(10,3,'cofounder','accepted'),(10,4,'cofounder','pending'),(10,6,'advisor','accepted');
   INSERT INTO account_licences(user_id,licence,source) VALUES(8,'founder','test');
   INSERT INTO grow_campaigns(id,uid,project_id,name,goal,status,starts_on,ends_on,archived_at) VALUES
    (1,'camp-both',10,'Launch push','signups','active','2026-11-03','2026-11-20',NULL),
    (2,'camp-start',10,'Open start','awareness','draft','2026-11-05',NULL,NULL),
    (3,'camp-end',10,'Open end','demos','paused',NULL,'2026-11-25',NULL),
    (4,'camp-nodate',10,'No dates','sales','draft',NULL,NULL,NULL),
    (5,'camp-archived',10,'Archived plan','sales','ended','2026-11-10','2026-11-11','2026-11-01 00:00:00'),
    (6,'camp-overlap',10,'October tail','awareness','ended','2026-10-20','2026-11-02',NULL),
    (7,'camp-other',20,'Other launch','signups','active','2026-11-10','2026-11-12',NULL),
    (8,'camp-outside',10,'December','signups','draft','2026-12-01','2026-12-05',NULL);
   INSERT INTO growth_channels(id,uid,project_id,name,utm_source) VALUES
    (1,'ch-google',10,'Google Ads','google'),(2,'ch-blog',10,'Blog','blog'),(3,'ch-meta',10,'Meta','meta'),(4,'ch-x',20,'X ads','x');
   INSERT INTO grow_campaign_channels(campaign_id,channel_id,budget_type,starts_on,ends_on) VALUES
    (1,1,'lifetime','2026-11-04','2026-11-10'),
    (1,2,'daily','2026-11-06',NULL),
    (1,3,NULL,NULL,NULL),
    (2,2,NULL,'2026-11-07','2026-11-08'),
    (5,1,'daily','2026-11-10','2026-11-11'),
    (7,4,NULL,'2026-11-10','2026-11-12');
   INSERT INTO publish_drafts(id,uid,project_id,module,author_user_id) VALUES(1,'draft-one',10,'distribution',1);
   INSERT INTO publish_sends(id,uid,draft_id,project_id,module,provider_key,destination_label,audience_label,idempotency_key,envelope_json,envelope_hash,status,confirmed_by,scheduled_for,sent_at) VALUES
    (1,'send-news',1,10,'distribution','beehiiv','Newsletter',NULL,'idem-0001','{}','h','sent',1,'2026-11-09 08:00:00','2026-11-09 08:00:00');
   INSERT INTO beehiiv_post_stats(id,integration_id,project_id,publication_id,post_external_id,title,sent_at,publish_send_id,as_of) VALUES
    (1,1,10,'pub_1','post_a','November issue','2026-11-06T15:00:00.000Z',NULL,'2026-11-07'),
    (2,1,10,'pub_1','post_b','Undated draft',NULL,NULL,'2026-11-07'),
    (3,1,10,'pub_1','post_c','From Publish','2026-11-09T08:00:00.000Z',1,'2026-11-09'),
    (4,2,20,'pub_2','post_d','Other issue','2026-11-08T07:30:00.000Z',NULL,'2026-11-08');
   INSERT INTO contacts(id,uid,project_id,audience,name,email,status) VALUES
    (1,'${UID('1')}',10,'customer','Prospect Alpha','alpha@example.test','new'),(2,'${UID('2')}',10,'customer','Prospect Beta','beta@example.test','new'),
    (3,'${UID('3')}',10,'customer','Prospect Gamma','gamma@example.test','new'),(4,'${UID('4')}',10,'customer','Prospect Delta','delta@example.test','new'),
    (5,'${UID('5')}',10,'customer','Prospect Eps','eps@example.test','new'),(6,'${UID('6')}',10,'customer','Prospect Zeta','zeta@example.test','new'),
    (7,'${UID('7')}',20,'customer','Prospect Eta','eta@example.test','new');
   INSERT INTO outreach_sequences(id,uid,project_id,name,state,created_by) VALUES
    (1,'${UID('a')}',10,'Warm intros','active',1),(2,'${UID('b')}',10,'Paused one','paused',1),(3,'${UID('c')}',20,'Other sequence','active',2);
   INSERT INTO outreach_steps(sequence_id,position,channel,wait_days,subject,body) VALUES
    (1,1,'email',0,'Hi','Body'),(1,2,'voice',3,'Note',NULL),(1,3,'whatsapp',2,NULL,NULL),(2,1,'email',0,'Hi','Body'),(3,1,'email',0,'Hi','Body');
   INSERT INTO outreach_enrolments(id,uid,sequence_id,contact_id,current_step,state,next_due_at,enrolled_by) VALUES
    (1,'${UID('d')}',1,1,1,'active','2026-11-05T09:00:00Z',1),
    (2,'${UID('e')}',1,2,2,'active','2026-11-12T10:30:00Z',1),
    (3,'${UID('f')}',1,3,3,'active','2026-11-14T10:30:00Z',1),
    (4,'${UID('0')}',1,4,2,'done',NULL,1),
    (5,'${UID('9')}',1,5,1,'active',NULL,1),
    (6,'${UID('8')}',2,6,1,'active','2026-11-06T09:00:00Z',1),
    (7,'${UID('7')}',3,7,1,'active','2026-11-07T09:00:00Z',2),
    (8,'${UID('6')}',1,6,1,'stopped_replied','2026-11-15T09:00:00Z',1);`);
  return { db, env: { DB: d1Over(db) } as any };
}

async function read(env: any, user: number, role = 'founder', kinds: readonly string[] = KINDS) {
  const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [...kinds], { withCancelled: true });
  assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
  return r.events;
}
const uids = (events: any[], kind: string) => events.filter((e) => e.kind === kind).map((e) => e.source_uid);

test('§e: the registry says Grow, page only, never pushed, never in a staff scope', () => {
  // Mutation checked: a kind not page only → the feed test fails; one left out of PERSONAL_ONLY_KINDS → this fails.
  assert.deepEqual(SOURCES.grow_campaign, { family: 'grow', module: 'Grow › Campaigns', label: 'Campaign', page_only: true, pushable: false });
  assert.deepEqual(SOURCES.ad_flight, { family: 'grow', module: 'Grow › Ads', label: 'Ad flight', page_only: true, pushable: false });
  assert.deepEqual(SOURCES.newsletter_send, { family: 'grow', module: 'Grow › Newsletter', label: 'Newsletter send', page_only: true, pushable: false });
  assert.deepEqual(SOURCES.sequence_step, { family: 'grow', module: 'Grow › Sequences', label: 'Sequence step', page_only: true, pushable: false });
  for (const k of KINDS) {
    assert.ok((PAGE_ONLY_KINDS as readonly string[]).includes(k), k);
    assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), k);
  }
});

test('§e: the venture readers only; a second user sees none of the first user\'s rows, for every reader', async () => {
  // Mutation checked, each reader alone: the venture rule dropped → user 2 or 7 sees venture 10's rows and this fails.
  const { db, env } = fixture();
  try {
    const founder = await read(env, 1);
    assert.deepEqual(uids(founder, 'grow_campaign').sort(), ['camp-both', 'camp-end', 'camp-overlap', 'camp-start']);
    assert.deepEqual(uids(founder, 'ad_flight').sort(), ['camp-both:ch-blog', 'camp-both:ch-google']);
    assert.deepEqual(uids(founder, 'newsletter_send'), ['beehiiv-post-1'], 'post_c is the founder\'s own Publish send, shown by §b');
    assert.deepEqual(uids(founder, 'sequence_step'), [UID('d'), UID('e')]);

    const other = await read(env, 2);
    assert.deepEqual(uids(other, 'grow_campaign'), ['camp-other']);
    assert.deepEqual(uids(other, 'ad_flight'), ['camp-other:ch-x']);
    assert.deepEqual(uids(other, 'newsletter_send'), ['beehiiv-post-4']);
    assert.deepEqual(uids(other, 'sequence_step'), [UID('7')]);
    for (const e of other) assert.equal(e.project_id, 20, `${e.kind} ${e.source_uid}`);
    for (const e of founder) assert.equal(e.project_id, 10, `${e.kind} ${e.source_uid}`);

    // An accepted co-founder reads the venture as the founder does, and post_c too: §b shows that send only to who confirmed it.
    const mate = await read(env, 3);
    assert.deepEqual(uids(mate, 'grow_campaign').sort(), uids(founder, 'grow_campaign').sort());
    assert.deepEqual(uids(mate, 'ad_flight').sort(), uids(founder, 'ad_flight').sort());
    assert.deepEqual(uids(mate, 'newsletter_send'), ['beehiiv-post-1', 'beehiiv-post-3']);
    assert.deepEqual(uids(mate, 'sequence_step'), [UID('d'), UID('e')]);
    // A founder licence held beside another role counts, as canAccessProject's `holdsLicence` does.
    // They did not confirm post_c's send, so, like the co-founder, they see post_c as a newsletter send.
    assert.equal((await read(env, 8, 'advisor')).length, mate.length);

    assert.deepEqual(await read(env, 4), [], 'a pending member is not a member');
    assert.deepEqual(await read(env, 5, 'admin'), [], 'admin access never widens a personal read');
    assert.deepEqual(await read(env, 6, 'investor'), [], 'an investor-only account never reads a venture by membership');
    assert.deepEqual(await read(env, 7), [], 'another founder sees none');
    assert.deepEqual(await read(env, 9, 'partner'), [], 'a founder_id without the founder licence is not the founder');
  } finally { db.close(); }
});

test('§e: campaigns and ad flights all day on their recorded days; sends and steps timed', async () => {
  // Mutation checked: the end not made exclusive (+1 day) → the span checks fail; starts_on read for a one-edge
  // "ends" plan → camp-end's day fails; next_due_at read as a day → the step's all_day fails.
  const { db, env } = fixture();
  try {
    const items = await describeItems(env, { id: 1, role: 'founder' }, await read(env, 1));
    const by = (kind: string, uid: string) => items.find((i) => i.kind === kind && i.source_uid === uid)!;

    const both = by('grow_campaign', 'camp-both');
    assert.equal(both.title, 'Campaign · Launch push');
    assert.equal(both.all_day, true);
    assert.equal(both.start_at, '2026-11-03');
    assert.equal(both.end_at, '2026-11-21', 'the last day is included: the end is exclusive');
    assert.equal(both.status, 'active');
    assert.equal(both.family, 'grow');
    assert.equal(both.href, '/grow/distribution/campaigns/camp-both');
    assert.deepEqual(both.source, { family: 'grow', module: 'Grow › Campaigns', label: 'Campaign', account: null });
    assert.equal(both.my_role.words, 'Your venture’s team');
    const start = by('grow_campaign', 'camp-start');
    assert.equal(start.title, 'Campaign starts · Open start');
    assert.deepEqual([start.start_at, start.end_at, start.all_day], ['2026-11-05', '2026-11-06', true]);
    const end = by('grow_campaign', 'camp-end');
    assert.equal(end.title, 'Campaign ends · Open end');
    assert.deepEqual([end.start_at, end.end_at, end.all_day], ['2026-11-25', '2026-11-26', true]);
    const tail = by('grow_campaign', 'camp-overlap');
    assert.deepEqual([tail.start_at, tail.end_at], ['2026-10-20', '2026-11-03'], 'a plan that overlaps the window keeps its own days');

    const google = by('ad_flight', 'camp-both:ch-google');
    assert.equal(google.title, 'Ad flight · Google Ads · Launch push');
    assert.deepEqual([google.start_at, google.end_at, google.all_day], ['2026-11-04', '2026-11-11', true]);
    assert.equal(google.href, '/grow/distribution/ads');
    assert.deepEqual(google.source, { family: 'grow', module: 'Grow › Ads', label: 'Ad flight', account: null });
    const blog = by('ad_flight', 'camp-both:ch-blog');
    assert.equal(blog.title, 'Ad flight starts · Blog · Launch push', 'paid by its budget type; one day recorded');
    assert.deepEqual([blog.start_at, blog.end_at], ['2026-11-06', '2026-11-07']);

    const post = by('newsletter_send', 'beehiiv-post-1');
    assert.equal(post.title, 'Newsletter sent · November issue');
    assert.equal(post.all_day, false);
    assert.equal(post.start_at, '2026-11-06T15:00:00.000Z');
    assert.equal(post.end_at, '2026-11-06T15:00:00.000Z');
    assert.equal(post.status, 'sent');
    assert.equal(post.href, '/grow/distribution/newsletter');
    assert.deepEqual(post.source, { family: 'grow', module: 'Grow › Newsletter', label: 'Newsletter send', account: null });

    const email = by('sequence_step', UID('d'));
    assert.equal(email.title, 'Email · step 1 · Warm intros');
    assert.equal(email.all_day, false);
    assert.equal(email.start_at, '2026-11-05T09:00:00.000Z');
    assert.equal(email.href, '/grow/distribution/prospects');
    assert.deepEqual(email.source, { family: 'grow', module: 'Grow › Sequences', label: 'Sequence step', account: null });
    const voice = by('sequence_step', UID('e'));
    assert.equal(voice.title, 'Voice note · step 2 · Warm intros');
    assert.equal(voice.start_at, '2026-11-12T10:30:00.000Z');
    // No prospect's name or address reaches a step.
    const text = JSON.stringify(items);
    for (const t of ['Prospect', '@example.test']) assert.ok(!text.includes(t), t);
  } finally { db.close(); }
});

test('§e: no row is invented onto the timeline', async () => {
  // Mutation checked: archived plans kept; the paid rule dropped; the sequence's active state dropped; the step's
  // channel filter dropped; a stopped enrolment kept; an unsent post placed on a guessed day; the window's end widened.
  const { db, env } = fixture();
  try {
    const events = await read(env, 1);
    const seen = new Set(events.map((e) => `${e.kind}:${e.source_uid}`));
    for (const k of [
      'grow_campaign:camp-nodate', // neither day recorded
      'grow_campaign:camp-archived', // archived
      'grow_campaign:camp-outside', // starts on the window's end, which is exclusive
      'ad_flight:camp-both:ch-meta', // a paid channel with no day of its own: its campaign is already shown
      'ad_flight:camp-start:ch-blog', // not a paid channel
      'ad_flight:camp-archived:ch-google', // the campaign is archived
      'newsletter_send:beehiiv-post-2', // never sent
      `sequence_step:${UID('f')}`, // a WhatsApp step: blocked, never due
      `sequence_step:${UID('0')}`, // done
      `sequence_step:${UID('6')}`, // stopped by a reply, though a due time is still on the row
      `sequence_step:${UID('9')}`, // no due time recorded
      `sequence_step:${UID('8')}`, // the sequence is paused
    ]) assert.ok(!seen.has(k), k);
    // Later steps of e1 (voice, three days on) have no stored time: only the step it stands on is shown.
    assert.equal(events.filter((e) => e.source_uid === UID('d')).length, 1);
  } finally { db.close(); }
});

test('§e: none is in an .ics file or a feed, and §b\'s kinds are not repeated', async () => {
  // Mutation checked: a kind not page only → the feed holds it; the publish_send exclusion dropped → post_c is shown twice.
  const { db, env } = fixture();
  try {
    const feed = await fetchUserEvents(env, 1, 'founder', FROM, TO);
    assert.ok(feed.every((e) => !(KINDS as readonly string[]).includes(e.kind)));
    assert.deepEqual(await fetchUserEvents(env, 1, 'founder', FROM, TO, [...KINDS]), [], 'asked for by name, still none');
    const ics = eventsToIcs(feed, 'Fixture');
    for (const t of ['Launch push', 'Google Ads', 'November issue', 'Warm intros']) assert.ok(!ics.includes(t), t);

    // The founder's own Publish send of post_c is §b's item; §e does not show it again.
    const all = await read(env, 1, 'founder', [...KINDS, 'publish_send', 'content_planned']);
    assert.deepEqual(uids(all, 'publish_send'), ['send-news']);
    assert.ok(!all.some((e) => e.kind === 'newsletter_send' && e.source_id === 3));
    for (const k of KINDS) assert.ok(!['publish_send', 'content_planned'].includes(k));
  } finally { db.close(); }
});
