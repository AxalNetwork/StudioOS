/**
 * D301 — the Telegram and X aggregators drafted false zeros from tables that
 * do not exist.
 *
 * `safeCount` returned `0` on ANY failure, table-not-found included, so five
 * queries (advisor_sessions, introductions, matches, partner_office_hours,
 * refer_earn_payouts — none of which any migration has ever created) posted
 * a confident zero every week. Every window comparison in
 * telegramAggregator.ts was also a bare string comparison against an ISO
 * bind (`created_at >= ?`), which drops every row from the window's first
 * day: the stored timestamp has no `T`, and `' ' < 'T'` lexically.
 *
 * This file drives the real, exported functions against a real
 * node:sqlite database built from the full baseline — not a mock, and not
 * a re-implementation of the SQL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { previewAudience, runAggregator } from '../src/services/telegramAggregator.ts';
import { previewXAll, previewXAudience, runXAggregator } from '../src/services/xAggregator.ts';
import { d1Over } from './_d1_sqlite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '../sql');

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(readFileSync(resolve(SQL_DIR, 'schema_baseline.sql'), 'utf8'));
  return db;
}

const envFor = (db) => ({ DB: d1Over(db) });

function seedUser(db, id, email) {
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES (${id}, '${email}', 'Test User', 'founder', 1);`);
}

function seedTelegramChannel(db, audience, chatId) {
  db.exec(`
    INSERT INTO telegram_channels (slug, label, chat_id, audience, enabled)
    VALUES ('${audience}-ch', '${audience}', '${chatId}', '${audience}', 1);
  `);
}

function seedXAccount(db) {
  db.exec(`INSERT INTO x_accounts (id, handle, enabled) VALUES (1, 'axalvc', 1);`);
}

const isoWindow = (days) => {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - days * 86400_000);
  return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
};

test('a booking on the window\'s first day is counted (the datetime() fix)', async () => {
  const db = freshDb();
  seedUser(db, 1, 'a@axal.vc');
  const { periodStart } = isoWindow(7);
  // SQLite-format timestamp on the exact first instant of the window — a
  // bare string comparison against the ISO bind (which has a 'T') drops
  // this row, since ' ' < 'T' lexically at that position.
  const sqliteStamp = periodStart.replace('T', ' ').replace(/\.\d+Z$/, '');
  db.exec(`
    INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status, created_at)
    VALUES ('b1', 1, 1, 1, 'confirmed', '${sqliteStamp}');
  `);
  const env = envFor(db);
  const draft = await previewAudience(env, 'founders', 7);
  assert.equal(draft.payload.advisor_sessions, 1,
    'a booking created at the exact start of the window was not counted — the window predicate is still a bare '
    + 'string comparison rather than datetime() on both sides');
});

test('a missing table reads unreadable, never 0', async () => {
  const db = freshDb();
  db.exec('DROP TABLE advisor_bookings;');
  const env = envFor(db);
  const draft = await previewAudience(env, 'founders', 7);
  assert.equal(draft.payload.advisor_sessions, null,
    'advisor_sessions payload field is not null after dropping advisor_bookings — a failed read must never '
    + 'report a count, and 0 is a count');
  assert.match(draft.body_md, /Unreadable/,
    'the founders draft does not say the sessions count could not be read after the table was dropped');
});

test('a failed read never prints "Quiet week"', async () => {
  const db = freshDb();
  db.exec('DROP TABLE projects;');
  const env = envFor(db);
  const draft = await previewAudience(env, 'public', 7);
  assert.doesNotMatch(draft.body_md, /Quiet week/,
    'the public draft printed "Quiet week" even though the ventures read failed — a failed read must say it '
    + 'could not be read, never be folded into the below-K_MIN quiet state');
  assert.match(draft.body_md, /Unreadable/,
    'the public draft does not say the ventures count could not be read');
});

test('the X advisors draft is not drafted and says why, and no draft row is written for it', async () => {
  const db = freshDb();
  seedUser(db, 1, 'a@axal.vc');
  seedXAccount(db);
  const env = envFor(db);

  const draft = await previewXAudience(env, 'advisors', 7);
  assert.equal(draft.drafted, false,
    'the X advisors draft reports drafted:true even though partner_office_hours (its only figure) was never '
    + 'built and nothing replaces it');
  assert.ok(draft.reason && draft.reason.length > 0,
    'the X advisors draft has no reason string explaining why it is not drafted');

  const all = await previewXAll(env, 7);
  const advisorsInAll = all.find((d) => d.audience === 'advisors');
  assert.equal(advisorsInAll.drafted, false,
    'previewXAll does not carry drafted:false through for the advisors entry');

  const out = await runXAggregator(env, { adminId: 1, accountId: 1, periodDays: 7 });
  const advisorsPosts = db.prepare(`SELECT COUNT(*) AS n FROM x_posts WHERE source_kind = 'advisors_brief'`).get().n;
  assert.equal(advisorsPosts, 0,
    'runXAggregator wrote an x_posts row for the advisors draft, which has nothing to say');
  assert.ok(!out.drafted.some((d) => d.audience === 'advisors'),
    'runXAggregator reports an advisors draft as drafted even though it carries no figure');
});

test('a cancelled booking is excluded and a no_show is counted', async () => {
  const db = freshDb();
  seedUser(db, 1, 'a@axal.vc');
  const { periodStart, periodEnd } = isoWindow(7);
  const mid = new Date((new Date(periodStart).getTime() + new Date(periodEnd).getTime()) / 2).toISOString();
  db.exec(`
    INSERT INTO advisor_bookings (uid, slot_id, advisor_id, founder_user_id, status, created_at) VALUES
      ('b1', 1, 1, 1, 'cancelled', '${mid}'),
      ('b2', 2, 1, 1, 'no_show', '${mid}'),
      ('b3', 3, 1, 1, 'confirmed', '${mid}');
  `);
  const env = envFor(db);
  const draft = await previewAudience(env, 'founders', 7);
  assert.equal(draft.payload.advisor_sessions, 2,
    'expected 2 sessions counted (no_show + confirmed), cancelled excluded; a cancelled booking was still counted');
});

test('investor_introductions is counted, never intro_propositions (which double-counts)', async () => {
  const db = freshDb();
  seedUser(db, 1, 'investor@axal.vc');
  seedUser(db, 2, 'founder@axal.vc');
  const { periodStart, periodEnd } = isoWindow(7);
  const mid = new Date((new Date(periodStart).getTime() + new Date(periodEnd).getTime()) / 2).toISOString();
  db.exec(`
    INSERT INTO investor_introductions (uid, investor_user_id, founder_user_id, quarter, created_at)
    VALUES ('ii1', 1, 2, '2026-Q3', '${mid}');
    INSERT INTO intro_propositions (uid, user_id, target_user_id, created_at) VALUES
      ('ip1', 1, 2, '${mid}'), ('ip2', 2, 1, '${mid}');
  `);
  const env = envFor(db);
  const draft = await previewAudience(env, 'founders', 7);
  assert.equal(draft.payload.investor_introductions, 1,
    'expected exactly the 1 investor_introductions row; intro_propositions rows (a different, reciprocal store) '
    + 'must never be counted here — they would double-count and inflate the figure');
});

test('the five fictitious tables are gone from both aggregator files', async () => {
  const telegramSrc = readFileSync(resolve(HERE, '../src/services/telegramAggregator.ts'), 'utf8');
  const xSrc = readFileSync(resolve(HERE, '../src/services/xAggregator.ts'), 'utf8');
  for (const pattern of [/FROM\s+advisor_sessions\b/i, /FROM\s+introductions\b/i, /FROM\s+matches\b/i, /FROM\s+partner_office_hours\b/i, /FROM\s+refer_earn_payouts\b/i]) {
    assert.ok(!pattern.test(telegramSrc), `telegramAggregator.ts still matches ${pattern}`);
    assert.ok(!pattern.test(xSrc), `xAggregator.ts still matches ${pattern}`);
  }
});

test('runAggregator (Telegram) persists a draft for every audience with a channel — all five keep at least one figure', async () => {
  const db = freshDb();
  seedUser(db, 1, 'a@axal.vc');
  for (const audience of ['public', 'founders', 'investors', 'advisors', 'partners', 'alumni']) {
    seedTelegramChannel(db, audience, `-100${audience.length}`);
  }
  const env = envFor(db);
  const out = await runAggregator(env, 1, 7);
  const audiences = out.drafted.map((d) => d.audience).sort();
  assert.deepEqual(audiences, ['advisors', 'alumni', 'founders', 'investors', 'partners', 'public'],
    'not every Telegram audience drafted, even though each still has at least one measured figure after the fix');
});
