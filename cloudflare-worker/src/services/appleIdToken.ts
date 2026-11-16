/**
 * D6957 — Sign in with Apple: the client secret, the token exchange and the
 * id_token check.
 *
 * WHAT APPLE SENDS. /api/auth/apple/start asks Apple for `code id_token` with
 * `response_mode=form_post`, so Apple's page POSTs back an authorization code,
 * an id_token carrying our nonce, the state, and (on the very first
 * authorization only) a `user` JSON with the person's name. The route checks
 * the posted id_token here (signature, issuer, audience, clock and nonce),
 * then exchanges the code with Apple's token endpoint and checks the id_token
 * that answer carries the same way. Both must name the same subject. A posted
 * id_token alone is never trusted: the exchange proves the code is live and
 * was issued to this Services ID.
 *
 * THE CLIENT SECRET is a short-lived ES256 JWT signed with the private key
 * from Apple Developer (Keys → Sign in with Apple), as Apple specifies: `iss`
 * the Team ID, `sub` the Services ID, `aud` https://appleid.apple.com, `kid`
 * the key's ID. It is minted per exchange and lives five minutes, so a rotated
 * key needs only the secret replaced (D6957, "Rotating the key").
 *
 * THE KEYS ARE CACHED PER ISOLATE, as googleIdToken.ts does it: one
 * `createRemoteJWKSet`, refetched on an unknown `kid`, every fetch bounded.
 *
 * NEVER THROWS. Every failure is `{ ok: false, code, reason }`; `reason` is
 * for logs and tests and is never shown to the person.
 */
import { createRemoteJWKSet, jwtVerify, errors, SignJWT, importPKCS8 } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

export const APPLE_CLOCK_SKEW_SEC = 300;
/** A sign-in finishes within minutes of Apple minting the token. */
export const APPLE_TOKEN_MAX_AGE_SEC = 900;
const CLIENT_SECRET_TTL_SEC = 300;

const JWKS_TIMEOUT_MS = 3_000;
const JWKS_COOLDOWN_MS = 30_000;
const JWKS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TOKEN_FETCH_TIMEOUT_MS = 10_000;

let jwks: JWTVerifyGetKey | null = null;

export function appleJwks(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(APPLE_KEYS_URL), {
    timeoutDuration: JWKS_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
  });
  return jwks;
}

/** The four settings a deployment needs before the Apple button may show. */
export interface AppleConfig {
  servicesId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
}

export function appleConfig(env: {
  APPLE_SIGNIN_SERVICES_ID?: string;
  APPLE_SIGNIN_TEAM_ID?: string;
  APPLE_SIGNIN_KEY_ID?: string;
  APPLE_SIGNIN_PRIVATE_KEY?: string;
}): AppleConfig | null {
  const servicesId = String(env.APPLE_SIGNIN_SERVICES_ID || '').trim();
  const teamId = String(env.APPLE_SIGNIN_TEAM_ID || '').trim();
  const keyId = String(env.APPLE_SIGNIN_KEY_ID || '').trim();
  const privateKey = String(env.APPLE_SIGNIN_PRIVATE_KEY || '').trim();
  if (!servicesId || !teamId || !keyId || !privateKey) return null;
  return { servicesId, teamId, keyId, privateKey };
}

/**
 * The .p8 file's contents. A secret pasted through a dashboard sometimes
 * arrives with literal `\n` in place of line breaks; both shapes are read.
 */
function pem(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export async function appleClientSecret(cfg: AppleConfig, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await importPKCS8(pem(cfg.privateKey), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.servicesId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + CLIENT_SECRET_TTL_SEC)
    .sign(key);
}

/** SHA-256 of the browser's nonce, base64url — what goes to Apple as `nonce`. */
export async function hashNonce(raw: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const b = new Uint8Array(d);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface AppleIdentity {
  sub: string;
  /** Lower-cased; null when Apple sent no address. */
  email: string | null;
  /** A Hide My Email relay address. */
  privateEmail: boolean;
}

export type AppleIdTokenResult =
  | { ok: true; claims: AppleIdentity }
  | { ok: false; code: 'token_invalid' | 'email_unverified'; reason: string };

const invalid = (reason: string): AppleIdTokenResult => ({ ok: false, code: 'token_invalid', reason });

const truthy = (v: unknown) => v === true || v === 'true';

/**
 * Check an Apple id_token for `clientId`. `nonce` is the hashed nonce sent to
 * Apple; when given, the token must carry it, and when `nonce` is null a
 * token that carries one is still accepted (the token endpoint's answer, whose
 * subject the caller compares with the posted, nonce-checked token).
 */
export async function verifyAppleIdToken(
  idToken: string,
  clientId: string,
  nonce: string | null,
  opts: { jwks?: JWTVerifyGetKey; now?: number } = {},
): Promise<AppleIdTokenResult> {
  if (typeof idToken !== 'string' || !idToken || !clientId) return invalid('missing');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, opts.jwks ?? appleJwks(), {
      algorithms: ['RS256'],
      issuer: APPLE_ISSUER,
      audience: clientId,
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: APPLE_CLOCK_SKEW_SEC,
      currentDate: new Date(now * 1000),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (e) {
    if (!(e instanceof errors.JOSEError)) return invalid('jwks_unavailable');
    if (e instanceof errors.JWKSTimeout) return invalid('jwks_unavailable');
    if (e.code === 'ERR_JOSE_GENERIC') return invalid('jwks_unavailable');
    if (e instanceof errors.JWKSNoMatchingKey) return invalid('unknown_kid');
    if (e instanceof errors.JWSSignatureVerificationFailed) return invalid('signature');
    if (e instanceof errors.JWTExpired) return invalid('expired');
    if (e instanceof errors.JWTClaimValidationFailed) return invalid(`claim_${e.claim || 'unknown'}`);
    return invalid('malformed');
  }

  const iat = Number(payload.iat);
  if (!Number.isFinite(iat) || iat > now + APPLE_CLOCK_SKEW_SEC) return invalid('iat_future');
  if (now - iat > APPLE_TOKEN_MAX_AGE_SEC) return invalid('too_old');

  if (nonce !== null && payload.nonce !== nonce) return invalid('nonce');

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub || sub.length > 255) return invalid('claim_sub');

  const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim().toLowerCase() : null;
  // Apple sends the flag as a boolean or the string "true".
  if (email && !truthy(payload.email_verified)) return { ok: false, code: 'email_unverified', reason: 'email_unverified' };
  const privateEmail = truthy(payload.is_private_email) || !!email?.endsWith('@privaterelay.appleid.com');
  return { ok: true, claims: { sub, email, privateEmail } };
}

/**
 * Whether Apple vouches for the inbox behind `email` today: a Hide My Email
 * relay address (Apple runs it for this person and this app), or an iCloud
 * address (icloud.com, me.com, mac.com — Apple hosts the mailbox). Any other
 * address was verified when the Apple ID was made and may have changed hands
 * since, so, as for Google (D722), it binds to an Axal VC account only after
 * an email link proves the inbox.
 */
export function appleIsAuthoritative(email: string | null, privateEmail: boolean): boolean {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (privateEmail && e.endsWith('@privaterelay.appleid.com')) return true;
  return /@(icloud|me|mac)\.com$/.test(e);
}

export type AppleExchangeResult = { ok: true; idToken: string } | { ok: false; reason: string };

/** Exchange the authorization code at Apple's token endpoint. Bounded; never throws. */
export async function exchangeAppleCode(cfg: AppleConfig, code: string, redirectUri: string): Promise<AppleExchangeResult> {
  let secret: string;
  try {
    secret = await appleClientSecret(cfg);
  } catch (e) {
    console.error('[auth_apple] client secret could not be signed', (e as Error)?.message);
    return { ok: false, reason: 'client_secret' };
  }
  const body = new URLSearchParams({
    client_id: cfg.servicesId,
    client_secret: secret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  let resp: Response;
  try {
    resp = await fetch(APPLE_TOKEN_URL, {
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  } catch (e) {
    console.error('[auth_apple] token endpoint fetch failed', (e as Error)?.message);
    return { ok: false, reason: 'network' };
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // Apple's error body is {"error":"invalid_grant"} and the like: no secrets.
    console.warn('[auth_apple] token exchange failed', resp.status, txt.slice(0, 120));
    return { ok: false, reason: `status_${resp.status}` };
  }
  const data = await resp.json().catch(() => null) as { id_token?: string } | null;
  return typeof data?.id_token === 'string' && data.id_token
    ? { ok: true, idToken: data.id_token }
    : { ok: false, reason: 'no_id_token' };
}

/** Test seam: forget the cached key set. */
export const __testing = {
  resetJwks: () => { jwks = null; },
};
