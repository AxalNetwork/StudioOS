/**
 * Task #6 — Google Cloud Identity Platform (Firebase Auth Phone) REST client.
 *
 * Plain `fetch()` calls against `identitytoolkit.googleapis.com/v1`.
 * Two endpoints are used:
 *   - accounts:sendVerificationCode  → returns sessionInfo (opaque)
 *   - accounts:signInWithPhoneNumber → consumes (sessionInfo, code), returns
 *                                       Firebase ID token + localId (firebase_uid)
 *
 * Required env:
 *   - GCIP_API_KEY        Web API key for the Identity Platform project.
 *
 * Optional env:
 *   - GCIP_RECAPTCHA_TOKEN_FALLBACK  In production, sendVerificationCode
 *     normally requires a reCAPTCHA token minted by the Firebase JS SDK
 *     in the user's browser. Server-only flows can call the API key path
 *     directly, but Google may eventually require attestation. The
 *     frontend passes the recaptcha token through to the worker; if
 *     omitted (e.g. dev), this fallback is used.
 *
 * `isGcipConfigured(env)` returns true when GCIP_API_KEY is present —
 * routes that touch SMS check this first and return 503 on a missing key
 * so the SettingsPage and LoginPage degrade gracefully.
 */
import type { Env } from '../types';

interface GcipEnv extends Env {
  GCIP_API_KEY?: string;
  GCIP_RECAPTCHA_TOKEN_FALLBACK?: string;
}

const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1';

/**
 * Task #6 — Delete a phone factor from the upstream Identity Platform
 * tenant. Required by the SMS-disable flow: clearing the local row alone
 * would let an attacker who later compromised the GCIP project recover
 * the phone→user binding.
 *
 * We call the Identity Toolkit Admin endpoint
 *   POST /v1/projects/{projectId}/accounts:update
 * with `{localId, deleteProvider:["phone"]}`. This requires a service
 * account access token (NOT the public Web API key) — operators provision
 * `GCIP_ADMIN_BEARER_TOKEN` as a worker secret, refreshed by an external
 * job (the access token's 1h TTL is intentionally NOT auto-refreshed
 * inside the worker — keeping a service-account JSON in worker secrets
 * is a larger-blast-radius decision and out of scope here).
 *
 * Behaviour when admin creds are absent: returns `{ok:false, code:'admin_unconfigured'}`
 * and the caller logs + proceeds to wipe local state. This is intentional —
 * the worst case is a stale phone row in GCIP that no longer maps to a
 * StudioOS account; it can't authenticate anything on its own.
 */
export async function deleteGcipPhone(
  env: Env,
  localId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!localId) return { ok: false, code: 'no_local_id', message: 'No GCIP local_id stored' };
  if (!env.GCIP_PROJECT_ID || !env.GCIP_ADMIN_BEARER_TOKEN) {
    return { ok: false, code: 'admin_unconfigured', message: 'GCIP admin credentials not configured' };
  }
  try {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.GCIP_PROJECT_ID)}/accounts:update`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GCIP_ADMIN_BEARER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localId, deleteProvider: ['phone'] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, code: 'gcip_delete_failed', message: `${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, code: 'gcip_delete_error', message: e?.message || 'unknown' };
  }
}

export function isGcipConfigured(env: Env): boolean {
  return !!(env as GcipEnv).GCIP_API_KEY;
}

export interface SendCodeResult {
  ok: true;
  sessionInfo: string;
}
export interface SendCodeError {
  ok: false;
  code: 'invalid_phone' | 'quota_exceeded' | 'recaptcha_required' | 'upstream_error';
  message: string;
}

/**
 * Send the SMS verification code. `phoneE164` must be E.164 (e.g. +14155551234).
 * `recaptchaToken` is the Firebase reCAPTCHA token from the SPA; pass null
 * to fall back to GCIP_RECAPTCHA_TOKEN_FALLBACK (dev / smoke-test only).
 */
export async function sendVerificationCode(
  env: Env,
  phoneE164: string,
  recaptchaToken: string | null,
): Promise<SendCodeResult | SendCodeError> {
  const key = (env as GcipEnv).GCIP_API_KEY;
  if (!key) return { ok: false, code: 'upstream_error', message: 'GCIP not configured' };
  const recaptcha = recaptchaToken || (env as GcipEnv).GCIP_RECAPTCHA_TOKEN_FALLBACK || '';
  const body: Record<string, unknown> = { phoneNumber: phoneE164 };
  if (recaptcha) body.recaptchaToken = recaptcha;
  const res = await fetch(`${ENDPOINT}/accounts:sendVerificationCode?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `upstream ${res.status}`;
    let code: SendCodeError['code'] = 'upstream_error';
    try {
      const err = await res.json() as { error?: { message?: string } };
      const m = err?.error?.message || '';
      message = m || message;
      if (/INVALID_PHONE/i.test(m)) code = 'invalid_phone';
      else if (/QUOTA|TOO_MANY/i.test(m)) code = 'quota_exceeded';
      else if (/CAPTCHA/i.test(m)) code = 'recaptcha_required';
    } catch {}
    return { ok: false, code, message };
  }
  const json = await res.json() as { sessionInfo?: string };
  if (!json.sessionInfo) return { ok: false, code: 'upstream_error', message: 'no sessionInfo' };
  return { ok: true, sessionInfo: json.sessionInfo };
}

export interface VerifyResult {
  ok: true;
  phoneNumber: string;
  localId: string;            // Firebase UID
  idToken: string;
}
export interface VerifyError {
  ok: false;
  code: 'invalid_code' | 'session_expired' | 'upstream_error';
  message: string;
}

export async function signInWithPhoneNumber(
  env: Env,
  sessionInfo: string,
  code: string,
): Promise<VerifyResult | VerifyError> {
  const key = (env as GcipEnv).GCIP_API_KEY;
  if (!key) return { ok: false, code: 'upstream_error', message: 'GCIP not configured' };
  const res = await fetch(`${ENDPOINT}/accounts:signInWithPhoneNumber?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionInfo, code }),
  });
  if (!res.ok) {
    let message = `upstream ${res.status}`;
    let errCode: VerifyError['code'] = 'upstream_error';
    try {
      const err = await res.json() as { error?: { message?: string } };
      const m = err?.error?.message || '';
      message = m || message;
      if (/INVALID_CODE|MISSING_CODE/i.test(m)) errCode = 'invalid_code';
      else if (/SESSION_EXPIRED/i.test(m)) errCode = 'session_expired';
    } catch {}
    return { ok: false, code: errCode, message };
  }
  const json = await res.json() as {
    phoneNumber?: string; localId?: string; idToken?: string;
  };
  if (!json.phoneNumber || !json.localId || !json.idToken) {
    return { ok: false, code: 'upstream_error', message: 'incomplete response' };
  }
  return { ok: true, phoneNumber: json.phoneNumber, localId: json.localId, idToken: json.idToken };
}
