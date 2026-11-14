// Task #7 — Cross-system event badges.
//
// Isolated, best-effort award helpers invoked from the event routes when a
// principal checks in or is set as an agenda speaker. Kept OUT of assessment.ts
// (re-implementing the assessment engine's own award flow is out of scope for
// this phase): this module only *grants* the three event-participation badges
// seeded by migration 112 and bumps XP, reusing the same idempotent
// INSERT OR IGNORE + user_xp pattern as assessment.ts.
//
// Every entry point is wrapped so a cold/partial assessment schema or any DB
// error never propagates into the event route's response — badges are a
// side-effect, never a precondition for check-in / agenda success. The
// schema is ensured lazily (ensureAssessmentSchema) so an event-only D1 that
// has never run an assessment still gets the badge tables on first award.
import type { Env } from '../types';
import { ensureAssessmentSchema } from './assessmentSchema';
import { levelForXp } from './assessmentScoring';

export const EVENT_BADGE_DEMO_DAY_PRESENTER = 'event_demo_day_presenter';
export const EVENT_BADGE_NETWORKER = 'event_networker';
export const EVENT_BADGE_FOUNDING_ATTENDEE = 'event_founding_attendee';

const NETWORKER_THRESHOLD = 5;

/**
 * Grant a single badge to a user and bump XP by its xp_reward — but only on the
 * FIRST grant (INSERT OR IGNORE → meta.changes > 0, so concurrent check-ins
 * can't double-award or double-bump). The XP bump sits immediately adjacent to
 * the insert. Returns true when newly awarded. Caller wraps the try/catch.
 */
async function grantBadge(env: Env, userId: number, slug: string): Promise<boolean> {
  const ins: any = await env.DB.prepare(
    `INSERT OR IGNORE INTO user_badges (user_id, badge_slug, source) VALUES (?, ?, 'event')`,
  ).bind(userId, slug).run();
  if (!(ins?.meta?.changes && ins.meta.changes > 0)) return false;

  const b: any = await env.DB.prepare(
    `SELECT xp_reward FROM assessment_badges WHERE slug = ?`,
  ).bind(slug).first();
  const reward = Number(b?.xp_reward) || 0;
  if (reward > 0) {
    // Atomic increment (xp = xp + reward) so two different first-time badge
    // awards for the same user can't clobber each other's bump via a stale
    // read. Level is recomputed from the resulting authoritative total.
    await env.DB.prepare(
      `INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET xp = xp + ?, updated_at = datetime('now')`,
    ).bind(userId, reward, levelForXp(reward), reward).run();
    const after: any = await env.DB.prepare(`SELECT xp FROM user_xp WHERE user_id = ?`)
      .bind(userId).first();
    const total = Number(after?.xp) || reward;
    // Recompute level from the total we just read, but GUARD the write to that
    // exact xp: `AND xp = ?` makes the update a no-op if a concurrent award has
    // since bumped xp past `total`. So a stale (lower) level derived from an
    // older read can never clobber a fresher one — the award that reads the
    // final total lands the correct level, while xp itself is always right via
    // the atomic increment above. levelForXp stays the single source of truth
    // for the curve (no fragile SQL sqrt()).
    await env.DB.prepare(
      `UPDATE user_xp SET level = ?, updated_at = datetime('now')
        WHERE user_id = ? AND xp = ?`,
    ).bind(levelForXp(total), userId, total).run();
  }
  return true;
}

/**
 * Award the check-in driven badges: Founding Attendee on the first attended
 * registration, Networker once the user has 5+ attended registrations.
 * Best-effort — swallows every error so check-in never fails on a badge.
 */
export async function awardCheckinBadges(env: Env, userId: number | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await ensureAssessmentSchema(env);
    const row: any = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM event_registrations WHERE user_id = ? AND status = 'attended'`,
    ).bind(userId).first();
    const attended = Number(row?.n) || 0;
    if (attended >= 1) await grantBadge(env, userId, EVENT_BADGE_FOUNDING_ATTENDEE);
    if (attended >= NETWORKER_THRESHOLD) await grantBadge(env, userId, EVENT_BADGE_NETWORKER);
  } catch (e) {
    console.warn('[eventBadges] awardCheckinBadges failed', (e as Error).message);
  }
}

/**
 * Award the Demo Day Presenter badge to an agenda speaker — gated to demo_day
 * events whose speaker is a founder (the badge's intent; awarding any speaker
 * would dilute it across advisors/admins). Skips silently if the role lookup or
 * schema isn't available. Best-effort.
 */
export async function awardAgendaSpeakerBadge(
  env: Env,
  userId: number | null | undefined,
  eventType: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  if (eventType !== 'demo_day') return;
  try {
    const who: any = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(userId).first();
    if (!who || who.role !== 'founder') return;
    await ensureAssessmentSchema(env);
    await grantBadge(env, userId, EVENT_BADGE_DEMO_DAY_PRESENTER);
  } catch (e) {
    console.warn('[eventBadges] awardAgendaSpeakerBadge failed', (e as Error).message);
  }
}
