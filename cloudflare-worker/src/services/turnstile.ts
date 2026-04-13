import type { Env } from '../types';

interface TurnstileResponse {
  success: boolean;
  'error-codes': string[];
  challenge_ts?: string;
  hostname?: string;
}

export async function verifyTurnstile(env: Env, token: string, ip?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn('[TURNSTILE] No TURNSTILE_SECRET_KEY configured — bot protection disabled. Set the secret to enable.');
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

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
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
