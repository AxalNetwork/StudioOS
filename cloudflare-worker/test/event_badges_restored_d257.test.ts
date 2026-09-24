/**
 * D257 — the three event-badge seed rows migration 112 inserts never reach a
 * freshly built database, so every event-badge award fails silently.
 *
 * Migration 112 (task #7) sits below BASELINE_CUTOFF = 219, so
 * `migrate-d1 --bootstrap` marks it applied without running a statement of
 * it — its effect reaches a database only if schema_baseline.sql already
 * carries it. schema_baseline.sql carries assessment_badges' SHAPE (the
 * CREATE TABLE) but not its DATA: the dump predates 112, so the three rows
 * it INSERTs are simply absent from a fresh build.
 *
 * `services/eventBadges.ts`'s `grantBadge` (private, called by the exported
 * `awardCheckinBadges` / `awardAgendaSpeakerBadge`) does
 * `INSERT OR IGNORE INTO user_badges (user_id, badge_slug, source) VALUES
 * (?, ?, 'event')`, and `user_badges.badge_slug` is
 * `REFERENCES assessment_badges(slug)`. With no matching row in
 * assessment_badges, that INSERT fails its foreign key — and both exported
 * award functions wrap their whole body in try/catch and only `console.warn`,
 * so the failure never reaches a caller. This is exactly the "reports
 * success (or at least no error) and writes nothing" shape D187's M6 named:
 * event check-in badges have never actually landed on any freshly built
 * database, i.e. every branch.
 *
 * Migration 292 re-runs 112's three rows verbatim, as INSERT OR IGNORE. This
 * file proves the before/after the same way sub_cutoff_restores_d190.test.ts
 * does: a fresh database is built twice off disk (baseline + every migration
 * above the cutoff), once skipping 292 and once not, and the same real
 * award function is driven both times — not a mock, not a direct INSERT.
 *
 * The 26 other assessment badges migrations 108/110 seed (archetype and
 * milestone kinds) are deliberately NOT re-landed here — see D257 in
 * documentation/architecture/DECISIONS.md: nothing in the current codebase
 * awards them, so re-seeding them would restore inert rows, not fix a bug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  awardCheckinBadges,
  EVENT_BADGE_FOUNDING_ATTENDEE,
  EVENT_BADGE_NETWORKER,
} from '../src/services/eventBadges.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL_DIR, 'migrations');
const M292 = '292_restore_event_badges_seed.sql';

const migrationNames = () =>
  readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations);

/**
 * A freshly provisioned database, exactly as `migrate-d1 --bootstrap` leaves
 * one: the baseline, then every migration ABOVE the cutoff. `skip` drops one
 * by filename so the same builder produces the before-half. Foreign keys are
 * explicitly turned ON — node:sqlite's default is asserted below rather than
 * assumed, since the whole defect is a foreign-key failure and a fixture that
 * silently ran without enforcement would prove nothing.
 */
function freshDb(skip: string[] = []) {
  const db = new DatabaseSync(':memory:', {
    enableDoubleQuotedStringLiterals: true,
    enableForeignKeyConstraints: true,
  });
  db.exec(readFileSync(resolve(SQL_DIR, 'schema_baseline.sql'), 'utf8'));
  for (const name of migrationNames()) {
    if (migrationNumber(name) <= BASELINE_CUTOFF || skip.includes(name)) continue;
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* error-tolerant, as the runner is */ }
    }
  }
  return db;
}

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async () => ({ keys: [], list_complete: true }),
  };
}

const envFor = (db: InstanceType<typeof DatabaseSync>) => ({
  DB: d1Over(db), RATE_LIMITS: fakeKV(), TOKENS: fakeKV(),
  ENVIRONMENT: 'development',
});

function makeEvent(db: InstanceType<typeof DatabaseSync>, id: number) {
  db.exec(`
    INSERT INTO events (id, slug, title, starts_at) VALUES
      (${id}, 'event-${id}', 'Event ${id}', '2026-01-0${(id % 9) + 1}T18:00:00Z');
  `);
}

function seedFoundingAttendee(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'attendee@axal.vc', 'Attendee', 'founder', 1);`);
  makeEvent(db, 1);
  db.exec(`INSERT INTO event_registrations (event_id, user_id, status) VALUES (1, 1, 'attended');`);
}

function seedNetworker(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`INSERT INTO users (id, email, name, role, is_active) VALUES (2, 'networker@axal.vc', 'Networker', 'founder', 1);`);
  for (let i = 1; i <= 5; i += 1) {
    makeEvent(db, i);
    db.exec(`INSERT INTO event_registrations (event_id, user_id, status) VALUES (${i}, 2, 'attended');`);
  }
}

const hasBadge = (db: InstanceType<typeof DatabaseSync>, userId: number, slug: string) =>
  (db.prepare(
    'SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ? AND badge_slug = ?',
  ).get(userId, slug) as any).n === 1;

const xpOf = (db: InstanceType<typeof DatabaseSync>, userId: number) =>
  Number((db.prepare('SELECT xp FROM user_xp WHERE user_id = ?').get(userId) as any)?.xp) || 0;

// ── 0 · the fixture actually enforces the constraint the defect turns on ──

test('the fresh-db fixture enforces foreign keys — the assertion the whole file leans on', () => {
  const db = freshDb();
  const enforced = (db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys;
  assert.equal(enforced, 1,
    'PRAGMA foreign_keys is off in this fixture. The defect this file proves IS a foreign-key '
    + 'failure (user_badges.badge_slug REFERENCES assessment_badges(slug)); without enforcement '
    + 'the before-half INSERT would silently succeed and neither half of this file would mean '
    + 'anything.');
});

// ── 1 · the seed rows exist after 292, and not without it ─────────────────

test('292 seeds all three event badges on a fresh build; a build without it has none', () => {
  const slugs = ['event_demo_day_presenter', 'event_networker', 'event_founding_attendee'];

  const after = freshDb();
  for (const slug of slugs) {
    const row = after.prepare('SELECT slug, kind, xp_reward FROM assessment_badges WHERE slug = ?').get(slug) as any;
    assert.ok(row, `${slug} is absent from assessment_badges on a fresh build even with 292 applied`);
    assert.equal(row.kind, 'event', `${slug}'s kind drifted from migration 112's own 'event'`);
  }

  const before = freshDb([M292]);
  for (const slug of slugs) {
    const row = before.prepare('SELECT slug FROM assessment_badges WHERE slug = ?').get(slug);
    assert.equal(row, undefined,
      `${slug} is present on a fresh build WITHOUT 292, so this test proves nothing about 292 — `
      + 'either the baseline gained it, or another migration now seeds it and the two can disagree.');
  }
});

// ── 2 · the reader, driven, paired ─────────────────────────────────────────

test('awardCheckinBadges: Founding Attendee fails silently without 292, and lands with it', async () => {
  const dbBefore = freshDb([M292]);
  seedFoundingAttendee(dbBefore);
  const before = envFor(dbBefore) as any;

  // Best-effort by design: the call itself must not throw...
  await assert.doesNotReject(() => awardCheckinBadges(before, 1));
  // ...but the badge and the XP it should have carried are both absent — the
  // silent-failure shape this migration fixes, not a visible 500.
  assert.equal(hasBadge(dbBefore, 1, EVENT_BADGE_FOUNDING_ATTENDEE), false,
    'Founding Attendee was granted WITHOUT migration 292, so the before-half of this defect '
    + 'cannot be reproduced and the pairing proves nothing');
  assert.equal(xpOf(dbBefore, 1), 0,
    'XP was bumped without the badge row existing to award from — the fixture is not '
    + 'reproducing the FK failure this migration fixes');

  const db = freshDb();
  seedFoundingAttendee(db);
  const env = envFor(db) as any;
  await awardCheckinBadges(env, 1);
  assert.equal(hasBadge(db, 1, EVENT_BADGE_FOUNDING_ATTENDEE), true,
    'Founding Attendee was not granted with 292 applied, even though the user has an attended '
    + 'registration');
  assert.equal(xpOf(db, 1), 50,
    "the user's XP does not carry Founding Attendee's 50 xp_reward after the award");

  // INSERT OR IGNORE — a second award must not double-grant or double-bump.
  await awardCheckinBadges(env, 1);
  assert.equal(xpOf(db, 1), 50,
    're-running the award bumped XP a second time, so the first-grant-only guard did not survive '
    + 'the restore');
});

test('awardCheckinBadges: Networker (5+ attended) fails silently without 292, and lands with it', async () => {
  const dbBefore = freshDb([M292]);
  seedNetworker(dbBefore);
  const before = envFor(dbBefore) as any;
  await assert.doesNotReject(() => awardCheckinBadges(before, 2));
  assert.equal(hasBadge(dbBefore, 2, EVENT_BADGE_NETWORKER), false,
    'Networker was granted WITHOUT migration 292, so the before-half of this defect cannot be '
    + 'reproduced');

  const db = freshDb();
  seedNetworker(db);
  const env = envFor(db) as any;
  await awardCheckinBadges(env, 2);
  assert.equal(hasBadge(db, 2, EVENT_BADGE_NETWORKER), true,
    'Networker was not granted with 292 applied, even though the user has 5 attended '
    + 'registrations');
  // 5 attended registrations also cross the Founding Attendee threshold
  // (attended >= 1), so the total is both rewards: 50 + 100.
  assert.equal(xpOf(db, 2), 150,
    "the user's XP does not carry both Founding Attendee's and Networker's xp_reward "
    + '(50 + 100 = 150) after the award');
});
