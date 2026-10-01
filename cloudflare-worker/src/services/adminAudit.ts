/**
 * D159 — ONE `logAdminAction`, because the four copies had drifted and the
 * drift was a missing audit write.
 *
 * MEASURED BEFORE THIS FILE EXISTED. `logAdminAction` was declared four times
 * with the same five-parameter signature, and they did NOT do the same thing:
 *
 *   · routes/admin_exploring.ts:83     activity_logs  +  admin_audit_log
 *   · routes/admin_partners.ts:46      activity_logs  +  admin_audit_log
 *   · routes/admin_advisor_audit.ts:37 activity_logs  ONLY
 *   · services/matchAudit.ts           activity_logs  ONLY — and its own header
 *                                      said it "mirrors admin_advisor_audit.ts
 *                                      ::logAdminAction (same columns)", which
 *                                      was true, and is exactly how it
 *                                      inherited the gap.
 *
 * WHAT THAT COST, and it is not bookkeeping. HQ's H7 governance feed
 * (routes/admin_security.ts `GET /governance`) unions four stores, and an
 * action reaches it two ways only: from `admin_audit_log`, which
 * FEED_AUDIT_ALL_SQL reads unfiltered, or from `activity_logs` — but that arm
 * is `WHERE l.action IN (?,?,?,?,?,?,?,?)` against `ACTOR_SIDE_ACTIONS`, a
 * fixed list of eight (`role_changed`, `user_toggled`, four KYC actions, two
 * contract actions). So four privileged admin actions reached NEITHER arm:
 *
 *   · advisor_shadow_cleared    an admin clears a user's AI-safety shadow flag
 *   · advisor_locked            an admin locks an advisor
 *   · advisor_unlocked          an admin unlocks one
 *   · match_list_generated      an admin generates a match list over people
 *
 * They are invisible on the one screen whose entire subject is privileged
 * actions, and `/security/overview`'s `audit.total` undercounts by exactly
 * them. D156 sealed `admin_audit_log` against UPDATE and DELETE three days
 * ago; a row that never arrives gets nothing from that seal.
 *
 * WHY THE TABLE BOOTSTRAP MOVES IN HERE TOO. The two copies that did write to
 * `admin_audit_log` swallowed the failure under a bare catch whose comment read
 * "admin_audit_log may not exist in some envs" — while
 * `ensureAdminAuditLogTable` (routes/admin.ts) exists precisely so that it
 * does, and nine other writers call it first. The catch was hiding a condition
 * its own neighbour already fixes. This helper calls it
 * and keeps the catch for what remains genuinely best-effort: an audit write
 * must never be the reason an admin action fails after it has happened.
 *
 * THE TARGET, and why it is read from the details rather than passed. The feed
 * renders its Target column from `LEFT JOIN users t ON t.id = a.viewed_user_id`,
 * and the two copies that wrote to the table bound only three columns, so every
 * row they wrote had a blank target. Across the eleven call sites, five name a
 * person and the key for it is `target_user_id` — in FOUR of the five. The
 * fifth, `partner_firm_link_set` (routes/admin_partners.ts), passed `user_id`,
 * so attaching an account to a partner firm would have been recorded with no
 * subject at all: the quiet version of this same bug, surviving the fix for it.
 * D159 renames that one key and a guard pins the spelling, because a convention
 * that is only four-fifths true is not a convention — it is a coincidence with
 * one counter-example already in the tree.
 *
 * The validation mirrors the callers' own (`Number.isFinite(uid) && uid > 0`)
 * rather than being stricter: a helper that silently dropped a target its
 * caller had already validated would be the quieter version of this same bug.
 */
import type { Env } from '../types';
import { hashEmail } from '../util/hashEmail';
import { ensureAdminAuditLogTable } from '../routes/admin';

/**
 * The subject of an admin action, when it has one.
 *
 * Returns null for absent, non-numeric, non-finite and non-positive values —
 * an id we cannot trust is not a target, and `viewed_user_id` left null renders
 * as no target rather than as the wrong person.
 */
export function targetUserIdOf(details: Record<string, unknown>): number | null {
  const raw = details?.target_user_id;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/**
 * Record one privileged admin action in both stores that carry one.
 *
 * `activity_logs` gets the hashed-actor row (T22.1); `admin_audit_log` gets the
 * row HQ's governance feed reads. Each write has its own try/catch: a failure
 * in one must not cost the other, and neither may throw into the handler — the
 * action has already happened, and a recorded act undone by its own audit would
 * be worse than the gap this file closes.
 */
export async function logAdminAction(
  env: Env,
  adminUserId: number,
  adminEmail: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  const payload = JSON.stringify(details ?? {});

  try {
    const actor = await hashEmail(adminEmail || '');
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, payload, actor, adminUserId).run();
  } catch (e) {
    // The action name, never interpolated into the format string: a template
    // literal in a console call is the `unsafe-formatstring` shape this repo
    // has already had to fix once.
    console.warn('[adminAudit] activity_logs write failed', action, (e as Error).message);
  }

  try {
    await ensureAdminAuditLogTable(env);
    await env.DB.prepare(
      `INSERT INTO admin_audit_log (admin_user_id, action, viewed_user_id, filters_json) VALUES (?, ?, ?, ?)`,
    ).bind(adminUserId, action, targetUserIdOf(details), payload).run();
  } catch (e) {
    console.warn('[adminAudit] admin_audit_log write failed', action, (e as Error).message);
  }
}
