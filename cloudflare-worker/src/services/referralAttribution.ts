/**
 * Task #8 — Universal Referral Attribution.
 *
 * First-touch attribution for PURCHASES, distinct from the registration-time
 * `referrals` table. A visitor arriving with `?ref=CODE` has the code stored
 * in a client cookie (`axal_ref`); the first time they create a PaymentIntent
 * while authenticated we record a first-touch row (30-day window) and return
 * the active attribution so the PI can be stamped with the referral metadata.
 *
 * On `payment_intent.succeeded` the billing webhook reads that metadata,
 * computes a commission from the product's `commission_pct`, and queues a
 * post-charge Connect transfer via the existing referral payouts pipeline.
 */
import type { Env } from '../types';
import { resolveReferralCode, normaliseReferralCode } from './referrals/resolveCode';

// Mirrors the payouts approval window so a purchase attributed today is still
// inside the refund/clawback window when its commission is evaluated.
export const ATTRIBUTION_WINDOW_DAYS = 30;

let _schemaReady = false;
export async function ensureAttributionSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS referral_attributions (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id                     INTEGER NOT NULL UNIQUE,
      referral_code               TEXT NOT NULL,
      referrer_user_id            INTEGER NOT NULL,
      first_touch_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at                  TIMESTAMP NOT NULL,
      converted_payment_intent_id TEXT,
      converted_at                TIMESTAMP,
      created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
       ON referral_attributions(referrer_user_id)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch { /* idempotent */ } }
  _schemaReady = true;
}

export interface ResolvedAttribution {
  referralCode: string;
  referrerUserId: number;
}

/**
 * Record a first-touch attribution (if the cookie carries a valid, non-self
 * code and the buyer has none yet) and return the buyer's ACTIVE, non-expired
 * attribution — whichever was recorded first. Returns null when there's no
 * usable attribution. Never throws: attribution must never block a purchase.
 */
export async function captureAndResolveAttribution(
  env: Env,
  buyerUserId: number,
  cookieCode: string | null | undefined,
): Promise<ResolvedAttribution | null> {
  try {
    await ensureAttributionSchema(env);

    // First-touch capture: only when a code is present, resolves to a real
    // referrer, and that referrer isn't the buyer themselves. INSERT OR IGNORE
    // keeps the earliest attribution (user_id UNIQUE) so first-touch wins.
    const normalized = normaliseReferralCode(cookieCode);
    if (normalized) {
      const referrerUserId = await resolveReferralCode(env, cookieCode);
      if (referrerUserId && referrerUserId !== buyerUserId) {
        const expiresAt = new Date(Date.now() + ATTRIBUTION_WINDOW_DAYS * 86400_000).toISOString();
        await env.DB.prepare(
          `INSERT OR IGNORE INTO referral_attributions
             (user_id, referral_code, referrer_user_id, expires_at)
           VALUES (?, ?, ?, ?)`,
        ).bind(buyerUserId, normalized, referrerUserId, expiresAt).run();
      }
    }

    // Return the active (non-expired, non-self) attribution for this buyer.
    const row = await env.DB.prepare(
      `SELECT referral_code, referrer_user_id
         FROM referral_attributions
        WHERE user_id = ?
          AND referrer_user_id != ?
          AND expires_at > CURRENT_TIMESTAMP
        LIMIT 1`,
    ).bind(buyerUserId, buyerUserId).first<{ referral_code: string; referrer_user_id: number }>();
    if (!row) return null;
    return { referralCode: row.referral_code, referrerUserId: Number(row.referrer_user_id) };
  } catch (e) {
    console.warn('[referralAttribution] capture/resolve failed:', (e as Error).message);
    return null;
  }
}

/**
 * Stamp the first PaymentIntent that converted an attribution. Idempotent:
 * only sets converted_* the first time (keeps the earliest converting PI).
 */
export async function markAttributionConverted(
  env: Env,
  buyerUserId: number,
  paymentIntentId: string,
): Promise<void> {
  try {
    await ensureAttributionSchema(env);
    await env.DB.prepare(
      `UPDATE referral_attributions
          SET converted_payment_intent_id = ?, converted_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND converted_payment_intent_id IS NULL`,
    ).bind(paymentIntentId, buyerUserId).run();
  } catch (e) {
    console.warn('[referralAttribution] markConverted failed:', (e as Error).message);
  }
}

/** Parse the `axal_ref` value out of a raw Cookie header. */
export function readRefCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === 'axal_ref') {
      try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return part.slice(eq + 1).trim(); }
    }
  }
  return null;
}
