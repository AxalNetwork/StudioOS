/**
 * D991 (#2802) — Partner profiles part 2: a profile's review, its history and
 * the member's notice. Migration 557.
 *
 *   recordCapture    a writer saved answers: one `captured` row by source, and
 *                    if the profile already has a verdict, the verdict stays
 *                    and `changed_after_review_at` is set (owner decision 3).
 *   rejectReasonProblem  the rule a rejection's reason must meet.
 *   recordDecision   a verdict: who and when on the profile, the reason a
 *                    member reads, a history row, and the flag cleared.
 *   reopenProfile    back in the queue: the verdict stays in the history.
 *   tellMember       the member is told a verdict by email and in their inbox.
 *   profileHistory   the history read, newest first.
 *
 * A profile is named by its reference in every row and log line, never by its
 * email. The history is append-only: nothing here updates or deletes a row.
 */
import type { Env } from '../types';
import { notify } from './notify';

export const CAPTURE_SOURCES = ['chat', 'invitation', 'eadwyn'] as const;
export type CaptureSource = typeof CAPTURE_SOURCES[number];
export const VERDICTS = ['verified', 'rejected'] as const;
export type Verdict = typeof VERDICTS[number];

export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 2000;
export const REOPEN_REASON_MAX = 2000;
export const HISTORY_LIMIT_MAX = 100;

export const PROFILE_NOTICE_TYPE = 'partner_profile_reviewed';
export const PROFILE_NOTICE_LINK = '/inbox';

const nowIso = () => new Date().toISOString();

/**
 * A writer saved a partner's answers. Best effort: a failure is logged by
 * reference and never fails the writer's own save, which has already landed.
 */
export async function recordCapture(env: Env, email: string, source: CaptureSource): Promise<void> {
  let ref: string | null = null;
  try {
    const row = await env.DB.prepare(
      'SELECT ref, admin_status FROM partner_profiles WHERE LOWER(email) = LOWER(?) LIMIT 1',
    ).bind(email).first<{ ref: string | null; admin_status: string | null }>();
    if (!row?.ref) return;
    ref = row.ref;
    const at = nowIso();
    const stmts = [
      env.DB.prepare(
        `INSERT INTO partner_profile_events (profile_ref, kind, source, created_at) VALUES (?, 'captured', ?, ?)`,
      ).bind(ref, source, at),
    ];
    if (row.admin_status === 'verified' || row.admin_status === 'rejected') {
      stmts.push(env.DB.prepare(
        'UPDATE partner_profiles SET changed_after_review_at = ? WHERE ref = ?',
      ).bind(at, ref));
    }
    await env.DB.batch(stmts);
  } catch (e) {
    console.error('[partner-profile-review] capture not recorded', ref ?? 'no ref', source, (e as Error)?.message);
  }
}

/** The sentence a rejection's reason fails on, or null when it is fine. */
export function rejectReasonProblem(reason: unknown): string | null {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < REJECT_REASON_MIN) {
    return `A rejection needs a reason of at least ${REJECT_REASON_MIN} characters. The member reads it.`;
  }
  if (text.length > REJECT_REASON_MAX) return `A rejection's reason is at most ${REJECT_REASON_MAX} characters.`;
  return null;
}

/**
 * A verdict on the profile with this email. Writes who and when, the reason
 * (only on a rejection), clears the changed-after flag, and adds the history
 * row, in one batch. Returns the profile's reference and the time.
 */
export async function recordDecision(
  env: Env, email: string, verdict: Verdict, adminUserId: number, reason: string | null,
): Promise<{ ref: string; reviewed_at: string } | null> {
  const row = await env.DB.prepare('SELECT ref FROM partner_profiles WHERE email = ? LIMIT 1')
    .bind(email).first<{ ref: string | null }>();
  if (!row?.ref) return null;
  const at = nowIso();
  const text = verdict === 'rejected' ? String(reason ?? '').trim() : null;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_profiles
          SET reviewed_at = ?, reviewed_by = ?, reject_reason = ?, changed_after_review_at = NULL
        WHERE ref = ?`,
    ).bind(at, adminUserId, text, row.ref),
    env.DB.prepare(
      `INSERT INTO partner_profile_events (profile_ref, kind, admin_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(row.ref, verdict, adminUserId, text, at),
  ]);
  return { ref: row.ref, reviewed_at: at };
}

export type ReopenResult =
  | { ok: true; ref: string; reopened_at: string }
  | { ok: false; status: 404 | 409; code: string; message: string };

/**
 * Back in the queue. The profile reads pending with no reviewer, date, reason
 * or flag; the verdict it had stays in the history. Nobody is told (PRF5d).
 * A profile that has no verdict has nothing to reopen.
 */
export async function reopenProfile(env: Env, ref: string, adminUserId: number, reason: string | null): Promise<ReopenResult> {
  const row = await env.DB.prepare('SELECT admin_status FROM partner_profiles WHERE ref = ?')
    .bind(ref).first<{ admin_status: string | null }>();
  if (!row) return { ok: false, status: 404, code: 'profile_not_found', message: 'No partner profile has that reference.' };
  if (row.admin_status !== 'verified' && row.admin_status !== 'rejected') {
    return { ok: false, status: 409, code: 'not_reviewed', message: 'This profile has no verdict, so there is nothing to reopen.' };
  }
  const at = nowIso();
  const text = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, REOPEN_REASON_MAX) : null;
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE partner_profiles
          SET admin_status = 'pending', reviewed_at = NULL, reviewed_by = NULL, reject_reason = NULL,
              changed_after_review_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE ref = ? AND admin_status IN ('verified', 'rejected')`,
    ).bind(ref),
    env.DB.prepare(
      `INSERT INTO partner_profile_events (profile_ref, kind, admin_user_id, reason, created_at)
       SELECT ?, 'reopened', ?, ?, ? WHERE EXISTS (SELECT 1 FROM partner_profiles WHERE ref = ? AND admin_status = 'pending')`,
    ).bind(ref, adminUserId, text, at, ref),
  ]);
  if (!(Number((updated as any)?.meta?.changes) > 0)) {
    return { ok: false, status: 409, code: 'not_reviewed', message: 'This profile has no verdict, so there is nothing to reopen.' };
  }
  return { ok: true, ref, reopened_at: at };
}

/**
 * What the member was sent. `email` is `sent` or `not_sent` when this sent it
 * directly, and `by_settings` when `notify` owns it: the member's own email
 * settings decide whether it goes, as for every other notice.
 */
export type MemberNotice = { in_app: boolean; email: 'sent' | 'not_sent' | 'by_settings' } | null;

/**
 * The member is told a verdict by email and in their inbox. With an account,
 * through `notify` on both channels, uncategorised so neither quiet hours nor
 * the digest holds it; with none, by email alone, as there is no inbox to
 * write to. Null when nothing could be sent; the verdict stands either way.
 */
export async function tellMember(
  env: Env, profile: { email: string; user_id: number | null; ref: string }, verdict: Verdict, reason: string | null,
): Promise<MemberNotice> {
  const title = verdict === 'verified'
    ? 'Your Axal partner profile is verified'
    : 'Your Axal partner profile was not verified';
  const body = verdict === 'verified'
    ? 'An Axal admin reviewed your partner profile and verified it.'
    : `An Axal admin reviewed your partner profile and did not verify it. Their reason: ${String(reason ?? '').trim()}`;
  try {
    let userId = profile.user_id;
    if (userId == null) {
      const u = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1')
        .bind(profile.email).first<{ id: number }>();
      userId = u?.id ?? null;
    }
    if (userId != null) {
      const id = await notify(env, {
        userId, type: PROFILE_NOTICE_TYPE, title, body, link: PROFILE_NOTICE_LINK,
        payload: { verdict, ref: profile.ref }, channels: ['in_app', 'email'],
      });
      return id == null ? null : { in_app: true, email: 'by_settings' };
    }
    const { sendNotificationEmail } = await import('./email');
    const sent = await sendNotificationEmail(env, profile.email, `[Axal] ${title}`, body);
    return { in_app: false, email: sent ? 'sent' : 'not_sent' };
  } catch (e) {
    console.error('[partner-profile-review] member notice failed', profile.ref, (e as Error)?.message);
    return null;
  }
}

/**
 * The history, newest first. A decision names the admin who made it, for the
 * admin reading the page ("recorded in the profile's history under your
 * name", PRF5d); a capture names its source.
 */
export async function profileHistory(env: Env, ref: string, limit: number, offset: number) {
  const [rows, total] = await Promise.all([
    env.DB.prepare(
      `SELECT e.kind, e.source, e.reason, e.created_at, e.admin_user_id, u.name AS admin_name
         FROM partner_profile_events e
         LEFT JOIN users u ON u.id = e.admin_user_id
        WHERE e.profile_ref = ?
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ? OFFSET ?`,
    ).bind(ref, limit, offset).all<{
      kind: string; source: string | null; reason: string | null; created_at: string;
      admin_user_id: number | null; admin_name: string | null;
    }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM partner_profile_events WHERE profile_ref = ?')
      .bind(ref).first<{ n: number }>(),
  ]);
  return {
    items: (rows.results || []).map((r) => ({
      kind: r.kind,
      source: r.source,
      reason: r.reason,
      created_at: r.created_at,
      by: r.admin_user_id == null ? null : { user_id: r.admin_user_id, name: r.admin_name ?? null },
    })),
    total: Number(total?.n) || 0,
    limit, offset,
  };
}
