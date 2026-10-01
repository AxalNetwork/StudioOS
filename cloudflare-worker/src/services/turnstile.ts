import type { Env } from '../types';

interface TurnstileResponse {
  success: boolean;
  'error-codes': string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstile(env: Env, token: string, ip?: string): Promise<boolean> {
  // Epic 11 — fail CLOSED in production when the secret is unset. The
  // previous fail-open meant a misconfigured prod deploy silently disabled
  // the entire bot-protection layer on /register. Dev/preview keep the
  // fail-open path so local iteration doesn't require Turnstile.
  if (!env.TURNSTILE_SECRET_KEY) {
    const envName = ((env as unknown as { ENVIRONMENT?: string }).ENVIRONMENT || '').toLowerCase();
    if (envName === 'production' || envName === 'prod') {
      console.error('[TURNSTILE] No TURNSTILE_SECRET_KEY in production — failing closed.');
      return false;
    }
    console.warn('[TURNSTILE] No TURNSTILE_SECRET_KEY configured — bot protection disabled (dev). Set the secret to enable.');
    return true;
  }

  if (!token) {
    console.warn('[TURNSTILE] No token provided');
    return false;
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', env.TURNSTILE_SECRET_KEY);
    formData.append('response', token);
    if (ip) formData.append('remoteip', ip);

    // A DEADLINE, BECAUSE THIS SITS IN FRONT OF SIGN-IN. Without it a
    // siteverify that never answers holds the whole request open — and the
    // `catch` below, which already fails closed, cannot run: a stall is not an
    // error. Five seconds is generous for a call that normally takes tens of
    // milliseconds, and a timeout lands in the same catch as any other failure,
    // so an unreachable verifier refuses rather than hangs.
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(5_000),
    });

    const data = await res.json() as TurnstileResponse;

    if (!data.success) {
      console.warn('[TURNSTILE] Verification failed:', data['error-codes']);
    }

    return data.success;
  } catch (e) {
    console.error('[TURNSTILE] Verification error:', e);
    return false;
  }
}
