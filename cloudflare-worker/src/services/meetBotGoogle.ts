/**
 * D3678 (#3678): Eadwyn AI joins Google Meet signed in as its own Workspace
 * account (`eadwyn@axal.vc`, the owner's answer A), not as an anonymous guest.
 *
 * THE SECRETS stay on the site Worker (PRODUCTION.md §4):
 * - `MEET_BOT_GOOGLE_EMAIL`, `MEET_BOT_GOOGLE_PASSWORD`: the account;
 * - `MEET_BOT_GOOGLE_TOTP`: the authenticator's base32 setup key.
 *
 * WHAT THE CONTAINER GETS. The bot host is a separate Worker, so it cannot read
 * these. A running bot asks for them over its signed callback
 * (`POST /api/meeting-bots/:uid/meet-credentials`, or the diagnostic's own),
 * the way Zoom's run credentials reach it (D886 §12). It gets the email and
 * password once, and a fresh six-digit code each time Google asks for one. The
 * TOTP key never leaves this Worker: the code is computed here (RFC 6238,
 * HMAC-SHA-1, 30-second step), so a container that is compromised holds at
 * most a code that expires in 30 seconds.
 *
 * Nothing here logs, stores or returns a secret anywhere but the answer to
 * that signed request, which is `no-store`.
 */
import type { Env } from '../types';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Whether all three secrets are set; with any missing, the bot keeps its anonymous join. */
export function meetSignInConfigured(env: Env): boolean {
  return !!env.MEET_BOT_GOOGLE_EMAIL?.includes('@') && !!env.MEET_BOT_GOOGLE_PASSWORD && !!base32(env.MEET_BOT_GOOGLE_TOTP ?? '');
}

/** RFC 4648 base32, as an authenticator's setup key is written: spaces and case ignored, padding optional. */
export function base32(text: string): Uint8Array | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return out.length ? new Uint8Array(out) : null;
}

/** RFC 6238 TOTP over RFC 4226's HOTP: the code for `key` at `nowMs`. */
export async function totp(key: Uint8Array, nowMs: number, opts: { digits?: number; stepSeconds?: number; hash?: 'SHA-1' | 'SHA-256' | 'SHA-512' } = {}): Promise<string> {
  const digits = opts.digits ?? TOTP_DIGITS, step = opts.stepSeconds ?? TOTP_STEP_SECONDS;
  const counter = Math.floor(nowMs / 1000 / step);
  const msg = new Uint8Array(8);
  // The counter is a 64-bit big-endian integer; JavaScript's safe range covers every real time.
  new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  new DataView(msg.buffer).setUint32(4, counter >>> 0);
  const hmacKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: opts.hash ?? 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export type MeetCredentialStep = 'account' | 'code';
/** The body a runtime sends: `{}` for the account, `{"step":"code"}` for a code. Anything else is refused. */
export function credentialStep(raw: string): MeetCredentialStep | null {
  if (raw === '{}') return 'account';
  if (raw === '{"step":"code"}') return 'code';
  return null;
}

/**
 * The answer to one signed request. With the secrets missing it is 404
 * `meet_signin_unconfigured`, which the runtime reads as "join as a guest".
 */
export async function meetCredentials(env: Env, step: MeetCredentialStep, now = Date.now()): Promise<Response> {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (!meetSignInConfigured(env)) return new Response(JSON.stringify({ code: 'meet_signin_unconfigured' }), { status: 404, headers });
  const body = step === 'account'
    ? { email: env.MEET_BOT_GOOGLE_EMAIL!, password: env.MEET_BOT_GOOGLE_PASSWORD! }
    : { code: await totp(base32(env.MEET_BOT_GOOGLE_TOTP!)!, now), valid_ms: TOTP_STEP_SECONDS * 1000 - (now % (TOTP_STEP_SECONDS * 1000)) };
  return new Response(JSON.stringify(body), { status: 200, headers });
}
