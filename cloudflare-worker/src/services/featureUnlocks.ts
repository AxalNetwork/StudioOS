/**
 * Task #7 — À La Carte feature unlocks.
 *
 * A purchased à la carte SKU grants time-bounded (or permanent) access to a
 * single feature, keyed by `feature_key`, without a subscription. The billing
 * webhook writes a `feature_unlocks` row on `payment_intent.succeeded` for a
 * PaymentIntent carrying `metadata.kind === 'alacarte'`; feature gates read this
 * table for a non-expired row.
 *
 * Storage is the `feature_unlocks` table (migration 098). As with the rest of
 * the worker, an idempotent in-code bootstrap mirrors the migration so the table
 * exists even before the migration is applied.
 */
import type { Env } from '../types';

export interface FeatureUnlockRow {
  id: number;
  user_id: number;
  feature_key: string;
  expires_at: string | null;
  source_payment_intent_id: string | null;
  created_at: string;
}

let _schemaReady = false;

/** Idempotent schema bootstrap — mirrors migration 098_feature_unlocks.sql. */
export async function ensureFeatureUnlockSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS feature_unlocks (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'user_id INTEGER NOT NULL, ' +
        'feature_key TEXT NOT NULL, ' +
        'expires_at TEXT, ' +
        'source_payment_intent_id TEXT, ' +
        "created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
        ')',
    );
    await env.DB.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_unlocks_pi ' +
        'ON feature_unlocks(source_payment_intent_id)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_feature_unlocks_user_feature ' +
        'ON feature_unlocks(user_id, feature_key)',
    );
    _schemaReady = true;
  } catch (e) {
    console.warn('[featureUnlocks] ensureFeatureUnlockSchema failed:', (e as Error).message);
  }
}

/**
 * Write (idempotently) an unlock row for a successful à la carte purchase.
 * Keyed on `source_payment_intent_id` (UNIQUE) so a re-delivered webhook is a
 * no-op. `unlockDays`:
 *   - a positive number → expires_at = now + unlockDays
 *   - 0 / null / undefined → permanent (expires_at = NULL)
 */
export async function writeFeatureUnlock(
  env: Env,
  args: {
    userId: number;
    featureKey: string;
    paymentIntentId: string;
    unlockDays?: number | null;
  },
): Promise<void> {
  await ensureFeatureUnlockSchema(env);
  const days = Number(args.unlockDays);
  const expiresAt = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86_400_000).toISOString()
    : null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO feature_unlocks
       (user_id, feature_key, expires_at, source_payment_intent_id)
     VALUES (?, ?, ?, ?)`,
  ).bind(args.userId, args.featureKey, expiresAt, args.paymentIntentId).run();
}

/**
 * True when the user holds an active (non-expired) unlock for `featureKey`.
 * A row with NULL `expires_at` is permanent; otherwise the expiry must be in
 * the future.
 */
export async function hasFeatureUnlock(
  env: Env,
  userId: number,
  featureKey: string,
): Promise<boolean> {
  await ensureFeatureUnlockSchema(env);
  const row = await env.DB.prepare(
    `SELECT 1 FROM feature_unlocks
      WHERE user_id = ? AND feature_key = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      LIMIT 1`,
  ).bind(userId, featureKey).first();
  return !!row;
}

/** List the caller's currently-active unlocks (for the frontend to reflect). */
export async function listActiveUnlocks(
  env: Env,
  userId: number,
): Promise<Array<{ feature_key: string; expires_at: string | null }>> {
  await ensureFeatureUnlockSchema(env);
  const res = await env.DB.prepare(
    `SELECT feature_key, expires_at FROM feature_unlocks
      WHERE user_id = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY created_at DESC`,
  ).bind(userId).all<{ feature_key: string; expires_at: string | null }>();
  return res.results ?? [];
}
