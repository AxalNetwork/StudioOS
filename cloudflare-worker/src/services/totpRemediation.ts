/**
 * Task #6 — Deploy-time TOTP remediation.
 *
 * Pre-Task #1/#33, the registration flow stored the user's TOTP base32
 * secret in `users.password_hash`. That column is now reserved for real
 * credential storage, and Task #1 introduced a lazy on-login migration
 * via `loadTotp()`. Reviewer feedback on Task #6 required a deploy-time
 * sweep that migrates EVERY remaining legacy row immediately AND emails
 * each affected user a forced-reset link, so they're not silently sitting
 * on insecure storage waiting for their next login.
 *
 * The sweep is:
 *   - idempotent: repeated runs over a clean DB are a no-op (filtered by
 *     the BASE32 regex + missing-auth_totp-row predicate).
 *   - paginated: processes users in 200-row batches so a single invocation
 *     can't blow the worker's CPU budget on a large tenant.
 *   - resilient: each user's migration + email is wrapped in its own
 *     try/catch so one failure doesn't poison the whole batch.
 *   - observable: returns `{scanned, migrated, emailed, failed}` and emits
 *     `console.info` for every successful migration (mirroring the
 *     assistant retention sweep's logging style).
 *
 * Trigger surfaces:
 *   - `POST /api/admin/maintenance/totp-remediation` — admin-only, returns
 *     the sweep result. Operators run this immediately after a deploy.
 *   - Daily cron at 04:20 UTC (10 mins after the assistant retention sweep)
 *     as a belt-and-braces backup so we never silently regress.
 */
import type { Env } from '../types';
import { encryptColumn } from './columnCipher';
import { sendVerificationEmail } from './email';
import { generateToken, hashToken } from '../auth';
import { hashEmail } from '../util/hashEmail';

const BASE32_RE = /^[A-Z2-7]{16,64}$/;

export interface RemediationResult {
  scanned: number;
  migrated: number;
  emailed: number;
  failed: number;
}

interface CandidateRow {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
  totp_recovery_codes: string | null;
}

export async function runTotpRemediation(env: Env): Promise<RemediationResult> {
  const out: RemediationResult = { scanned: 0, migrated: 0, emailed: 0, failed: 0 };
  let lastId = 0;
  // Cap at 5000 users per invocation so a runaway loop can't stall the
  // worker — operators can re-run the endpoint until `migrated === 0`.
  const MAX_PASSES = 25;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Only fetch users whose password_hash plausibly looks like a base32
    // TOTP secret AND that don't yet have an auth_totp row. Doing the
    // length filter in SQL keeps batches small.
    const rs = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.password_hash, u.totp_recovery_codes
         FROM users u
         LEFT JOIN auth_totp t ON t.user_id = u.id
        WHERE u.id > ?
          AND t.user_id IS NULL
          AND u.password_hash IS NOT NULL
          AND length(u.password_hash) BETWEEN 16 AND 64
        ORDER BY u.id ASC
        LIMIT 200`
    ).bind(lastId).all<CandidateRow>();
    const rows = rs.results || [];
    if (!rows.length) break;
    lastId = Number(rows[rows.length - 1].id);

    for (const r of rows) {
      out.scanned++;
      if (!BASE32_RE.test(r.password_hash)) continue;
      try {
        const ct = await encryptColumn(env, 'auth_totp', 'secret', r.id, r.password_hash);
        let recovery: string[] = [];
        try {
          const arr = JSON.parse(r.totp_recovery_codes || '[]');
          if (Array.isArray(arr)) recovery = arr.filter((s) => typeof s === 'string');
        } catch {}

        // Mint a single-use verification token so the email's CTA lands the
        // user on the existing /verify-email + setup-totp re-pair flow.
        // Reuses the same column the registration flow already populates.
        const verifyToken = generateToken();
        const verifyHash = await hashToken(verifyToken);
        const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO auth_totp (user_id, secret_ct, recovery_hashes)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO NOTHING`
          ).bind(r.id, ct, JSON.stringify(recovery)),
          // Drop the legacy secret AND set password_reset_required so the
          // login route's existing recovery flow gates them into a re-pair.
          env.DB.prepare(
            `UPDATE users
                SET password_hash = NULL,
                    password_reset_required = 1,
                    verification_token = ?,
                    verification_token_expires = ?
              WHERE id = ?`
          ).bind(verifyHash, expires, r.id),
        ]);
        out.migrated++;

        // Best-effort forced-reset email. We deliberately swallow failures
        // — the migration row is the source of truth; the user can also
        // request a new email from /forgot-password if this one bounces.
        const url = `${env.APP_URL || 'https://axal.vc'}/verify-email?token=${encodeURIComponent(verifyToken)}&purpose=totp_repair`;
        try {
          const ok = await sendVerificationEmail(env, r.email, r.name || 'there', url);
          if (ok) out.emailed++;
        } catch (e) {
          console.warn(`[totpRemediation] email send failed user=${r.id}: ${(e as Error).message}`);
        }

        try {
          const eh = await hashEmail(r.email);
          await env.DB.prepare(
            `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
          ).bind(
            'totp_remediation_migrated',
            'Legacy TOTP secret migrated to auth_totp; forced-reset email queued',
            eh, r.id,
          ).run();
        } catch {}

        console.info(`[totpRemediation] migrated user=${r.id} (forced reset queued)`);
      } catch (e) {
        out.failed++;
        console.error(`[totpRemediation] failed user=${r.id}: ${(e as Error).message}`);
      }
    }
    if (rows.length < 200) break;
  }
  return out;
}
