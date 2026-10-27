/**
 * Re-sending an account's email verification link: one account
 * (`POST /api/admin/users/:user_id/resend-verification`, `routes/admin.ts`)
 * and many (`POST /api/admin/accounts/resend-verification`, D1303,
 * `routes/admin_accounts.ts`) share this, so both rotate the token, send and
 * record the same way.
 *
 * The verify route (`routes/auth.ts`) hashes the token it is given and
 * compares it with `users.verification_token`, so the HASH is stored and the
 * raw token goes only into the emailed link, with a 24-hour lifetime. The
 * email is best-effort: when it cannot be sent the token is still rotated, so
 * an admin can verify the account another way, and the activity row says so.
 * Nothing logged holds the address: the row names the account by id and the
 * hash of its email.
 */
import type { Env } from '../types';
import { hashToken } from '../auth';
import { hashEmail } from '../util/hashEmail';

export const VERIFICATION_TTL_MS = 24 * 3600 * 1000;

export interface ResendTarget { id: number; email: string; name: string | null }

/** Rotates the account's verification token and emails the link. Returns whether the email went. */
export async function resendVerification(env: Env, admin: { id: number; email: string; name?: string | null }, target: ResendTarget): Promise<{ emailed: boolean }> {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const rawToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const tokenHash = await hashToken(rawToken);
  const expires = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await env.DB.prepare('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?')
    .bind(tokenHash, expires, target.id).run();

  let emailed = false;
  try {
    const { sendVerificationEmail } = await import('./email');
    const verifyUrl = `${env.APP_URL || 'https://axal.vc'}/verify-email?token=${rawToken}`;
    emailed = await sendVerificationEmail(env, target.email, target.name || '', verifyUrl);
  } catch (e) {
    console.error('[resend-verification] email send failed', (e as Error)?.name || 'error');
  }

  try {
    const adminHash = await hashEmail(admin.email);
    const targetHash = await hashEmail(target.email);
    await env.DB.prepare('INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)')
      .bind('admin_resent_verification',
        `Admin ${admin.name ?? ''} re-sent verification email to user_id=${target.id} (email_hash=${targetHash})${emailed ? '' : ' (email send failed — token still rotated)'}`,
        adminHash, admin.id).run();
  } catch { /* the send stands without its row, as it always did */ }
  return { emailed };
}
