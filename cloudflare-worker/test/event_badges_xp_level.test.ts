/**
 * Task #7 — Member level can't go briefly stale when two badges are earned at once.
 *
 * `grantBadge` (services/eventBadges.ts) bumps XP with an atomic
 * `xp = xp + reward`, then recomputes `user_xp.level` from a *separate* read of
 * the new total. If two different first-time badge awards for the same user race,
 * the older recompute could write last and settle the level on a stale (lower)
 * value — the XP total stays correct, but the level briefly disagrees with it.
 *
 * The fix guards the level write to the exact total it was derived from
 * (`UPDATE ... SET level = ? WHERE user_id = ? AND xp = ?`), so a stale recompute
 * becomes a no-op once a concurrent award has moved xp on. These tests drive the
 * REAL exported award path (awardAgendaSpeakerBadge → grantBadge) against an
 * in-memory SQLite DB loaded with the actual assessment migrations.
 *
 *   1. Normal single-award path is unchanged: correct XP + matching level, and
 *      the award is idempotent (no double-bump on re-award).
 *   2. Concurrency regression: a concurrent XP bump injected at the exact
 *      read-then-update gap can NOT clobber the level with a stale value.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/event_badges_xp_level.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { awardAgendaSpeakerBadge, EVENT_BADGE_DEMO_DAY_PRESENTER } from '../src/services/eventBadges.ts';
import { levelForXp } from '../src/services/assessmentScoring.ts';

// ── Tiny D1 adapter over node:sqlite (mirrors events_paid_tickets.test.ts) ───
function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

// `hooks.afterReadXp` fires AFTER the read-back `SELECT xp FROM user_xp` has
// captured its row but BEFORE that (now stale) row is returned to grantBadge —
// deterministically reproducing the window in which a concurrent award bumps xp.
function makeD1(db: InstanceType<typeof DatabaseSync>, hooks: { afterReadXp?: (db: any) => void } = {}) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() {
          const row = db.prepare(sql).get(...binds);
          if (hooks.afterReadXp && /SELECT\s+xp\s+FROM\s+user_xp/i.test(sql)) {
            hooks.afterReadXp(db);
          }
          return row ?? null;
        },
        async all() { return { results: db.prepare(sql).all(...binds) }; },
        async run() {
          const r = db.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { return stmts; },
  };
}

// 107 (assessment_badges) + 108 (user_xp / user_badges) are all grantBadge needs.
// awardAgendaSpeakerBadge also reads users.role, so hand-create a minimal users
// table. FK enforcement off so we don't need the full referenced graph.
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const f of ['107_assessment_engine.sql', '108_assessment_play.sql']) {
    db.exec(readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8'));
  }
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, role TEXT)`);
  return db;
}

function seedFounder(db: InstanceType<typeof DatabaseSync>, userId: number) {
  db.prepare(`INSERT INTO users (id, role) VALUES (?, 'founder')`).run(userId);
}

function seedBadge(db: InstanceType<typeof DatabaseSync>, slug: string, xpReward: number) {
  db.prepare(
    `INSERT INTO assessment_badges (slug, label, kind, xp_reward) VALUES (?, ?, 'event', ?)`,
  ).run(slug, slug, xpReward);
}

function readXp(db: InstanceType<typeof DatabaseSync>, userId: number): { xp: number; level: number } | null {
  const r = db.prepare(`SELECT xp, level FROM user_xp WHERE user_id = ?`).get(userId) as any;
  return r ? { xp: Number(r.xp), level: Number(r.level) } : null;
}

const ENV_EXTRA = { ENVIRONMENT: 'development' };

test('single demo-day-presenter award: correct XP + matching level, and idempotent', async () => {
  const db = freshDb();
  const userId = 7;
  const reward = 150; // levelForXp(150) === 2, so this exercises a real level bump
  seedFounder(db, userId);
  seedBadge(db, EVENT_BADGE_DEMO_DAY_PRESENTER, reward);
  const env: any = { DB: makeD1(db), ...ENV_EXTRA };

  await awardAgendaSpeakerBadge(env, userId, 'demo_day');

  const after = readXp(db, userId);
  assert.ok(after, 'user_xp row should exist after the award');
  assert.equal(after!.xp, reward, 'xp equals the badge reward');
  assert.equal(after!.level, levelForXp(reward), 'level matches levelForXp(total)');
  assert.equal(after!.level, 2, 'sanity: levelForXp(150) is 2');

  const badges = (db.prepare(`SELECT COUNT(*) AS n FROM user_badges WHERE user_id = ?`).get(userId) as any).n;
  assert.equal(Number(badges), 1, 'exactly one badge row');

  // Re-award: INSERT OR IGNORE no-ops, so XP/level must not move (no double-bump).
  await awardAgendaSpeakerBadge(env, userId, 'demo_day');
  const again = readXp(db, userId)!;
  assert.equal(again.xp, reward, 're-award does not double-bump xp');
  assert.equal(again.level, levelForXp(reward), 're-award leaves level correct');
});

test('concurrent XP bump at the read-then-update gap cannot leave the level stale', async () => {
  const db = freshDb();
  const userId = 9;
  const reward = 60; // levelForXp(60) === 1
  seedFounder(db, userId);
  seedBadge(db, EVENT_BADGE_DEMO_DAY_PRESENTER, reward);

  // Simulate a SECOND, concurrent first-time badge award (also +60 xp) that lands
  // — increment + correct level recompute — in the gap between grantBadge reading
  // the total and writing the level. Fires exactly once.
  let fired = false;
  const concurrentReward = 60; // total becomes 120 → levelForXp(120) === 2
  const hooks = {
    afterReadXp: (raw: any) => {
      if (fired) return;
      fired = true;
      raw.prepare(`UPDATE user_xp SET xp = xp + ?, level = ? WHERE user_id = ?`)
        .run(concurrentReward, levelForXp(reward + concurrentReward), userId);
    },
  };
  const env: any = { DB: makeD1(db, hooks), ...ENV_EXTRA };

  await awardAgendaSpeakerBadge(env, userId, 'demo_day');

  const after = readXp(db, userId)!;
  assert.equal(fired, true, 'the injected concurrent bump must have run');
  assert.equal(after.xp, reward + concurrentReward, 'xp total is the sum of both awards');
  // The guarded level write must NOT have clobbered the fresher level back to
  // levelForXp(60)=1 — it must stay consistent with the authoritative total.
  assert.equal(after.level, levelForXp(after.xp), 'level matches the authoritative total');
  assert.equal(after.level, 2, 'sanity: levelForXp(120) is 2, not the stale 1');
});
