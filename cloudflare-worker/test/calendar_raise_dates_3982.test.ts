/**
 * #3982 (D1486 §c, source 5c of #3723): a round's close and an NDA's expiry on
 * the calendar.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/calendar_raise_dates_3982.test.ts
 *
 *   1. round_close: the venture's founder and its accepted co-founder see the
 *      active round's close; a closed round, a pending member and another
 *      founder see none.
 *   2. nda_expiry: each party sees "NDA with <the other's name> expires", by
 *      name and never by email; a third user sees none; an expired, revoked or
 *      voided NDA is not shown.
 *   3. Both are all day, name their source, and are in no .ics file or feed.
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
const KINDS = ['round_close', 'nda_expiry'] as const;
const FOUNDER = 1, COFOUNDER = 2, PENDING = 3, OTHER_FOUNDER = 5, INVESTOR = 4, OUTSIDER = 6;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const m of MIGRATIONS) db.exec(m);
  db.exec(`INSERT INTO users(id,role,name,email,founder_id,is_active) VALUES
    (1,'founder','Fixture founder','one@example.test',101,1),
    (2,'founder','Fixture cofounder','two@example.test',NULL,1),
    (3,'founder','Pending member','three@example.test',NULL,1),
    (4,'investor','Fixture investor','four@example.test',NULL,1),
    (5,'founder','Other founder','five@example.test',105,1),
    (6,'investor','Outside investor','six@example.test',NULL,1);
   INSERT INTO projects(id,name,founder_id) VALUES(10,'Fixture venture',101),(50,'Other venture',105);
   INSERT INTO project_members(project_id,user_id,role,status) VALUES(10,2,'cofounder','accepted'),(10,3,'cofounder','pending');
   INSERT INTO raise_rounds(id,uid,project_id,name,close_date,status) VALUES
    (1,'round-open',10,'Seed','2026-11-20','active'),
    (2,'round-closed',10,'Pre-seed','2026-11-10','closed'),
    (3,'round-other',50,'Other seed','2026-11-21','active');
   INSERT INTO pairwise_ndas(id,party_a_user_id,party_b_user_id,status,valid_until) VALUES
    (1,1,4,'active','2026-11-25 00:00:00'),
    (2,5,4,'expired','2026-11-12 00:00:00'),
    (3,1,6,'revoked','2026-11-14 00:00:00');
   INSERT INTO pairwise_ndas(id,party_a_user_id,party_b_user_id,status,valid_until,voided_at) VALUES
    (4,5,6,'active','2026-11-16 00:00:00','2026-10-30 00:00:00');`);
  return { db, env: { DB: d1Over(db) } as any };
}

const page = async (env: any, user: number, role: string) => {
  const r = await fetchUserEventsWithSources(env, user, role, FROM, TO, [...KINDS], { withCancelled: true });
  assert.ok(r.sources.every((s) => s.ok), JSON.stringify(r.sources));
  return r.events.map((e) => [e.kind, e.title]);
};

test('round_close: the venture\'s founder and its accepted co-founder see the active round\'s close; nobody else does', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, FOUNDER, 'founder'), [['round_close', 'Round closes · Seed'], ['nda_expiry', 'NDA with Fixture investor expires']]);
    assert.deepEqual(await page(env, COFOUNDER, 'founder'), [['round_close', 'Round closes · Seed']], 'an accepted co-founder');
    assert.deepEqual(await page(env, PENDING, 'founder'), [], 'a pending member sees no round');
    assert.deepEqual(await page(env, OTHER_FOUNDER, 'founder'), [['round_close', 'Round closes · Other seed']], 'their own venture\'s round only');
    assert.deepEqual(await page(env, INVESTOR, 'investor').then((r) => r.filter(([k]) => k === 'round_close')), [], 'an investor reads closings through deal_closing');
  } finally { db.close(); }
});

test('nda_expiry: each party sees the other\'s name, never an email; a third user sees none; expired, revoked or voided is not shown', async () => {
  const { db, env } = fixture();
  try {
    assert.deepEqual(await page(env, INVESTOR, 'investor'), [['nda_expiry', 'NDA with Fixture founder expires']]);
    assert.deepEqual((await page(env, FOUNDER, 'founder')).filter(([k]) => k === 'nda_expiry'), [['nda_expiry', 'NDA with Fixture investor expires']]);
    assert.deepEqual(await page(env, OUTSIDER, 'investor'), [], 'a revoked NDA and a voided one are not shown');
    assert.deepEqual((await page(env, OTHER_FOUNDER, 'founder')).filter(([k]) => k === 'nda_expiry'), [], 'an expired NDA is not shown');
    const { events } = await fetchUserEventsWithSources(env, INVESTOR, 'investor', FROM, TO, ['nda_expiry'], { withCancelled: true });
    const text = JSON.stringify(events);
    assert.ok(!/@example\.test/.test(text), 'no email reaches the item');
    assert.equal(events[0].notes, null, 'nothing else about the NDA');
  } finally { db.close(); }
});

test('both are all day on their recorded day, name their source in plain words, and link where they belong', async () => {
  const { db, env } = fixture();
  try {
    const { events } = await fetchUserEventsWithSources(env, FOUNDER, 'founder', FROM, TO, [...KINDS], { withCancelled: true });
    const items = await describeItems(env, { id: FOUNDER, role: 'founder' }, events);
    const round = items.find((i) => i.kind === 'round_close')!, nda = items.find((i) => i.kind === 'nda_expiry')!;
    assert.deepEqual([round.all_day, round.start_at, round.end_at], [true, '2026-11-20', '2026-11-21']);
    assert.deepEqual([nda.all_day, nda.start_at, nda.end_at], [true, '2026-11-25', '2026-11-26']);
    assert.deepEqual(round.source, { family: 'raise', module: 'Raise › Round', label: 'Round close', account: null });
    assert.deepEqual(nda.source, { family: 'raise', module: 'Raise › NDAs', label: 'NDA expiry', account: null });
    assert.equal(round.family, 'deadlines');
    assert.equal(round.href, '/raise/capital-relationships');
  } finally { db.close(); }
});

test('both are page only: never in an .ics file or a feed, and never in a staff scope', async () => {
  const { db, env } = fixture();
  try {
    for (const k of KINDS) {
      assert.equal(SOURCES[k].page_only, true, k);
      assert.equal(SOURCES[k].pushable, false, k);
      assert.ok((PAGE_ONLY_KINDS as readonly string[]).includes(k) && !(FEED_KINDS as readonly string[]).includes(k), k);
      assert.ok((PERSONAL_ONLY_KINDS as readonly string[]).includes(k), `${k} never enters a staff scope`);
    }
    const feed = await fetchUserEvents(env, FOUNDER, 'founder', FROM, TO);
    assert.ok(feed.every((e) => !(KINDS as readonly string[]).includes(e.kind)));
    assert.deepEqual(await fetchUserEvents(env, FOUNDER, 'founder', FROM, TO, [...KINDS]), [], 'asked for by name, still none');
    const ics = eventsToIcs(feed, 'Fixture');
    for (const t of ['Round closes', 'NDA with']) assert.ok(!ics.includes(t), t);
  } finally { db.close(); }
});
