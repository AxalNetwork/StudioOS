/**
 * Task #11 — Lazy bootstrap + blended-score helper for the User Skill Profile.
 *
 * Mirrors services/skillsTaxonomySchema.ts: migration 091 is the canonical
 * apply path, but several recent migrations have landed un-applied on prod, so
 * a CREATE TABLE IF NOT EXISTS on the cold path keeps the skill-profile /
 * radar / matching routes self-healing on a D1 that has not yet had 091 run.
 *
 * Cached per isolate (no re-execution on every hot request).
 */
import type { Env } from '../types';
import { getSQL } from '../db';

let _ready = false;

export async function ensureSkillProfileSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_skills (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        skill_id     INTEGER NOT NULL REFERENCES skills(id),
        self_level   INTEGER NOT NULL DEFAULT 0,
        evidence_url TEXT,
        years        REAL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_id, skill_id),
        CHECK (self_level >= 0 AND self_level <= 5)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_skills_user
        ON user_skills (user_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_user_skills_skill
        ON user_skills (skill_id)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS skill_endorsements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        endorser_id INTEGER NOT NULL REFERENCES users(id),
        endorsee_id INTEGER NOT NULL REFERENCES users(id),
        skill_id    INTEGER NOT NULL REFERENCES skills(id),
        level       INTEGER NOT NULL DEFAULT 0,
        note        TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (endorser_id, endorsee_id, skill_id),
        CHECK (level >= 0 AND level <= 5),
        CHECK (endorser_id <> endorsee_id)
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorsee
        ON skill_endorsements (endorsee_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skill_endorsements_endorser
        ON skill_endorsements (endorser_id)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_skill_endorsements_skill
        ON skill_endorsements (skill_id)`),
    ]);
    _ready = true;
  } catch (err) {
    console.warn('[skillProfileSchema] ensure failed', err);
  }
}

/** Blend weights — peer endorsements dominate self-assessment when present. */
export const SELF_WEIGHT = 0.4;
export const PEER_WEIGHT = 0.6;

export interface BlendedSkill {
  skill_id: number;
  self: number;        // 0..5 self rating (0 when unrated)
  peer_avg: number;    // mean endorsement level (0 when none)
  peer_count: number;  // number of distinct endorsements
  blended: number;     // PEER-weighted blend, falls back to self when no peers
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-skill blended proficiency for a single user. The union of every skill
 * the user self-rated AND every skill anyone has endorsed them on.
 *
 *   blended = SELF_WEIGHT*self + PEER_WEIGHT*peer_avg   (when peer_count > 0)
 *   blended = self                                       (no endorsements)
 *
 * Exported so the downstream radar / matching services can reuse the exact
 * blend without re-deriving the formula.
 */
export async function computeBlendedSkills(env: Env, userId: number): Promise<BlendedSkill[]> {
  await ensureSkillProfileSchema(env);
  const sql = getSQL(env);

  const selfRows = await sql`
    SELECT skill_id, self_level FROM user_skills WHERE user_id = ${userId}`;
  const peerRows = await sql`
    SELECT skill_id, AVG(level) AS peer_avg, COUNT(*) AS peer_count
    FROM skill_endorsements WHERE endorsee_id = ${userId}
    GROUP BY skill_id`;

  const byId = new Map<number, BlendedSkill>();
  for (const r of selfRows) {
    const id = Number(r.skill_id);
    byId.set(id, { skill_id: id, self: Number(r.self_level) || 0, peer_avg: 0, peer_count: 0, blended: 0 });
  }
  for (const r of peerRows) {
    const id = Number(r.skill_id);
    const entry = byId.get(id) || { skill_id: id, self: 0, peer_avg: 0, peer_count: 0, blended: 0 };
    entry.peer_avg = Number(r.peer_avg) || 0;
    entry.peer_count = Number(r.peer_count) || 0;
    byId.set(id, entry);
  }

  const out: BlendedSkill[] = [];
  for (const e of byId.values()) {
    e.blended = e.peer_count > 0
      ? round2(SELF_WEIGHT * e.self + PEER_WEIGHT * e.peer_avg)
      : round2(e.self);
    e.peer_avg = round2(e.peer_avg);
    out.push(e);
  }
  out.sort((a, b) => a.skill_id - b.skill_id);
  return out;
}
