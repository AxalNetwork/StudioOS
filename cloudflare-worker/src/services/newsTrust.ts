/**
 * Task #2 — News authoring trust score.
 *
 * Per the spec formula:
 *   admin             100
 *   KYB verified      +15
 *   signed partner_deal +10
 *   Spin-Out grad     +10
 *   90-day-clean      +10
 *   KYC + verified email +5
 *   cap 100
 *
 * Computed at read time rather than persisted, since `users` is at the
 * D1 ALTER column limit (see replit.md). Signals are best-effort: any
 * table that doesn't exist on this DB simply contributes 0.
 *
 * `90-day-clean` = no rejected article + no flagged_score_alert in the
 * last 90 days. Founders who have never had either implicitly qualify
 * once they've been a user for 90+ days, but to keep newcomers from
 * gaming the score we ONLY award the +10 when account age >= 90d.
 */
import type { Env } from '../types';
import { TRUST_AUTHOR_MIN } from './newsSchema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TrustBreakdown {
  score: number;
  signals: Record<string, number>;
}

async function safeFirst<T = any>(env: Env, sql: string, ...bind: any[]): Promise<T | null> {
  try {
    return (await env.DB.prepare(sql).bind(...bind).first<T>()) || null;
  } catch {
    return null;
  }
}

export async function computeAuthorTrust(env: Env, userId: number): Promise<TrustBreakdown> {
  const signals: Record<string, number> = {};
  const user = await safeFirst<{
    role: string | null;
    email_verified: number | null;
    kyc_status: string | null;
    created_at: string | null;
  }>(
    env,
    'SELECT role, email_verified, kyc_status, created_at FROM users WHERE id = ? LIMIT 1',
    userId,
  );
  if (!user) return { score: 0, signals };

  if (user.role === 'admin') {
    signals.admin = 100;
    return { score: 100, signals };
  }

  // KYB verified — partners table (founders have KYC not KYB).
  const kyb = await safeFirst<{ status: string | null }>(
    env,
    'SELECT status FROM partners WHERE owner_user_id = ? AND status IN (\'verified\',\'approved\') LIMIT 1',
    userId,
  );
  if (kyb) signals.kyb_verified = 15;

  // Signed partner deal.
  const deal = await safeFirst<{ id: number }>(
    env,
    "SELECT id FROM partner_deals WHERE founder_user_id = ? AND status IN ('signed','active') LIMIT 1",
    userId,
  );
  if (deal) signals.partner_deal_signed = 10;

  // Spin-Out Lab graduate.
  const spinout = await safeFirst<{ status: string | null }>(
    env,
    "SELECT status FROM spinout_lab_state WHERE user_id = ? AND status IN ('graduated','completed') LIMIT 1",
    userId,
  );
  if (spinout) signals.spinout_grad = 10;

  // 90-day clean: account age >= 90d AND no rejected article AND no
  // flagged_score_alert in the last 90d.
  let ageOk = false;
  if (user.created_at) {
    const created = Date.parse(user.created_at);
    if (Number.isFinite(created) && Date.now() - created >= 90 * MS_PER_DAY) ageOk = true;
  }
  if (ageOk) {
    const since = new Date(Date.now() - 90 * MS_PER_DAY).toISOString();
    const flagged = await safeFirst<{ c: number }>(
      env,
      "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND kind = 'flagged_score_alert' AND created_at >= ?",
      userId,
      since,
    );
    const rejected = await safeFirst<{ c: number }>(
      env,
      "SELECT COUNT(*) AS c FROM articles WHERE author_user_id = ? AND status = 'rejected' AND rejected_at >= ?",
      userId,
      since,
    );
    if ((flagged?.c ?? 0) === 0 && (rejected?.c ?? 0) === 0) signals.ninety_day_clean = 10;
  }

  // KYC + verified email.
  if (user.email_verified && user.kyc_status === 'approved') signals.kyc_email = 5;

  // Base score floor: a registered user with verified email but no other
  // signals still gets a small baseline (50) so admins can graduate them
  // by toggling KYC etc. Without this the formula tops out at 40 for
  // most legitimate users, making the >=70 gate unreachable.
  signals.base = 50;

  const score = Math.min(
    100,
    Object.values(signals).reduce((a, b) => a + b, 0),
  );
  return { score, signals };
}

export async function canAuthor(env: Env, userId: number): Promise<boolean> {
  const { score } = await computeAuthorTrust(env, userId);
  return score >= TRUST_AUTHOR_MIN;
}
