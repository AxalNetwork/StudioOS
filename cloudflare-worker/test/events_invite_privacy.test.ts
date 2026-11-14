/**
 * Invite suggestions — privacy regression.
 *
 * GET /events/:id/invite-suggestions must hold two privacy guarantees that a
 * future query change could silently re-open:
 *   1. Opt-in only — it suggests ONLY members who published their assessment
 *      result (assessment_results.published = 1). An unpublished member is
 *      never surfaced, even when their match score would rank them.
 *   2. No raw scores — every match `reason` is a coarse label, never a raw
 *      skill level (the leaky form was "…you 0.0, them 5.0").
 *
 * These drive the REAL events route module against an in-memory SQLite DB
 * loaded with the actual migrations the query path reads — the taxonomy /
 * profile tables (089/091/094), the assessment engine + play tables
 * (107/108, where assessment_results.published lives) and the events core
 * (109) — through the same tiny D1 adapter used by events.test.ts, so the
 * real query runs instead of falling into the cold-schema empty-result branch.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/events_invite_privacy.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import events from '../src/routes/events.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

// ── Tiny D1 adapter over node:sqlite (mirrors events.test.ts) ───────────────
function coerce(args: any[]): any[] {
  return args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let binds: any[] = [];
      const api: any = {
        bind: (...a: any[]) => { binds = coerce(a); return api; },
        async first() {
          const row = db.prepare(sql).get(...binds);
          return row ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...binds) };
        },
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

// The migrations the invite-suggestions query + matching-vector loaders read:
//   089 — skill_categories / skills / value_dimensions (taxonomy)
//   091 — user_skills (per-user skill levels)
//   094 — user_values (per-user value vector — the candidate FROM table)
//   107 — assessment engine; 108 — assessment_results (+ the `published` flag)
//   109 — events / event_registrations / event_invitations
const MIGRATIONS = [
  '089_skills_values_taxonomy.sql',
  '091_user_skill_profile.sql',
  '094_user_values.sql',
  '107_assessment_engine.sql',
  '108_assessment_play.sql',
  '109_events_core.sql',
];

function freshDb() {
  // D1 doesn't enforce FK constraints; node:sqlite does. Disable so the
  // migrations don't require the entire referenced-table graph (users, …) and
  // we can seed the few tables this route actually reads.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const f of MIGRATIONS) {
    db.exec(readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8'));
  }
  // `users` is a core table not created by any of the above migrations — every
  // worker test hand-creates the minimal shape it needs. mi_pro_subscriptions
  // is read best-effort by getCurrentUser; seed it to avoid a noisy warn.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, uid TEXT, email TEXT, name TEXT, role TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT
    );
  `);
  return db;
}

function makeEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { DB: makeD1(db), ENVIRONMENT: 'development', JWT_SECRET };
}

const ctx: any = { waitUntil() {}, passThroughOnException() {} };

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, email: `u${userId}@x.com`, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function authInit(token: string): RequestInit {
  return { method: 'GET', headers: { Authorization: `Bearer ${token}` } };
}

// ── Seed helpers ───────────────────────────────────────────────────────────
function insertUser(db: any, id: number, role: string, name: string) {
  db.prepare(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(id, `u-${id}`, `u${id}@x.com`, name, role);
}

// One value dimension + one strong Engineering skill so seeded members produce
// a real, positive match score against an empty-vector host.
function seedTaxonomy(db: any) {
  db.prepare(`INSERT INTO value_dimensions (id, slug, label) VALUES (1, 'mission', 'Mission')`).run();
  db.prepare(`INSERT INTO skill_categories (slug, label, is_radar_axis) VALUES ('engineering', 'Engineering', 1)`).run();
  db.prepare(`INSERT INTO skills (id, slug, category_slug, label) VALUES (1, 'backend', 'engineering', 'Backend')`).run();
}

// Make `userId` a fully assessed member: a value-vector row (so they enter the
// candidate set, which selects FROM user_values) and a strong Engineering
// skill (so they out-complement the empty-skilled host and score > 0). The
// only thing `published` changes is the assessment opt-in flag — so two members
// seeded identically except for this flag isolate the privacy filter.
function seedAssessedMember(db: any, userId: number, published: number) {
  db.prepare(`INSERT INTO user_values (user_id, dimension_id, score, confidence) VALUES (?, 1, 1.0, 0.9)`)
    .run(userId);
  db.prepare(`INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, 1, 5)`)
    .run(userId);
  db.prepare(
    `INSERT INTO assessment_results (session_id, user_id, game_id, track, published)
     VALUES (?, ?, 1, 'founder_origin_v1', ?)`,
  ).run(userId /* unique session per member */, userId, published);
}

function insertEvent(db: any, e: Record<string, any>): number {
  const cols = Object.keys(e);
  const r = db
    .prepare(`INSERT INTO events (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...coerce(cols.map((k) => e[k])));
  return Number(r.lastInsertRowid);
}

const EVENT_BASE = {
  host_user_id: 1, visibility: 'private', status: 'draft', admin_published: 0,
};

// ── 1. Opt-in only: an unpublished member is never suggested ────────────────
test('invite suggestions surface only members who PUBLISHED their assessment', async () => {
  const db = freshDb();
  insertUser(db, 1, 'founder', 'Host');
  insertUser(db, 2, 'founder', 'Published Member');
  insertUser(db, 3, 'founder', 'Private Member');
  seedTaxonomy(db);
  // Identical scoring inputs — the ONLY difference is the published flag.
  seedAssessedMember(db, 2, 1);
  seedAssessedMember(db, 3, 0);

  const env = makeEnv(db);
  const id = insertEvent(db, { ...EVENT_BASE, slug: 'priv', title: 'Priv', starts_at: '2090-01-01T18:00:00Z' });

  const token = await mintToken(1, 'founder');
  const res = await events.request(`/${id}/invite-suggestions`, authInit(token), env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  const ids = (body.suggestions as any[]).map((s) => Number(s.user_id));
  assert.ok(ids.includes(2), 'the member who published their assessment is suggested');
  assert.ok(!ids.includes(3), 'the member who did NOT publish is never suggested (privacy opt-in)');
});

// ── 2. No raw scores: reasons are coarse labels only ───────────────────────
test('invite-suggestion reasons are coarse labels — never raw skill levels', async () => {
  const db = freshDb();
  insertUser(db, 1, 'founder', 'Host');
  insertUser(db, 2, 'founder', 'Member');
  seedTaxonomy(db);
  seedAssessedMember(db, 2, 1);

  const env = makeEnv(db);
  const id = insertEvent(db, { ...EVENT_BASE, slug: 'reasons', title: 'Reasons', starts_at: '2090-02-02T18:00:00Z' });

  const token = await mintToken(1, 'founder');
  const res = await events.request(`/${id}/invite-suggestions`, authInit(token), env, ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  // The real query path ran (not the cold-schema empty branch) — a scored,
  // published member came back, so the reason assertions below are meaningful.
  assert.ok((body.suggestions as any[]).length > 0, 'the scored published member is suggested');
  for (const s of body.suggestions as any[]) {
    assert.ok(
      !/\d\.\d/.test(String(s.reason)),
      `a suggestion reason must not leak a raw skill level: ${JSON.stringify(s.reason)}`,
    );
  }
});
