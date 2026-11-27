/**
 * D722 — checking a Google id_token against Google's published keys.
 *
 * WHY THIS EXISTS BESIDE `decodeIdToken` IN routes/auth_google.ts. The redirect
 * callback decodes the id_token without checking its signature, and says why:
 * the token arrives over TLS from Google's token endpoint in direct answer to
 * our own code exchange. The popup path (`POST /api/auth/google/popup`) gets
 * its token the same way, but the code it exchanges was handed to us by the
 * browser rather than by a Google redirect, and nothing else binds that code to
 * this sign-in. So the popup path checks everything a Google id_token can be
 * checked for: the RS256 signature by `kid` against Google's JWKS, the issuer,
 * the audience and authorised party, the clock, the subject and a verified
 * email. `/callback` keeps its own checks in D722 so the fallback path is not
 * changed while the main path is introduced; moving it here is a follow-up.
 *
 * THE KEYS ARE CACHED PER ISOLATE. `googleJwks()` is one module-scope
 * `createRemoteJWKSet`. jose fetches Google's certs once, keeps them for
 * `cacheMaxAge`, and refetches when a token names a `kid` it does not hold
 * (Google rotates its keys), at most once per `cooldownDuration`. The fetch is
 * jose's own, bounded by `timeoutDuration`: the sign-in path may not await a
 * call that can never answer (auth_path_bounded.test.mjs states that rule).
 *
 * NEVER THROWS. Every failure is `{ ok: false, code, reason }`. `code` is what
 * the route answers with; `reason` is for the log and the tests, and is never
 * shown to the person.
 */
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Google documents both spellings of its issuer. */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** How far either clock may be off, in seconds, for `exp` and a future `iat`. */
export const GOOGLE_CLOCK_SKEW_SEC = 300;

/**
 * The oldest token accepted, in seconds since its `iat`. A popup sign-in
 * exchanges its code within seconds of minting it, so a token issued fifteen
 * minutes ago belongs to some other attempt.
 */
export const GOOGLE_TOKEN_MAX_AGE_SEC = 900;

const JWKS_TIMEOUT_MS = 3_000;
const JWKS_COOLDOWN_MS = 30_000;
const JWKS_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

let jwks: JWTVerifyGetKey | null = null;

/** Google's signing keys, fetched once per isolate and refetched on an unknown `kid`. */
export function googleJwks(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_CERTS_URL), {
    timeoutDuration: JWKS_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
  });
  return jwks;
}

export interface GoogleIdentity {
  sub: string;
  /** Lower-cased. */
  email: string;
  name: string | null;
  /**
   * The Google Workspace domain, lower-cased, when the account is a Workspace
   * one; null for a consumer account. With the email it says whether Google is
   * authoritative for the address (`googleIsAuthoritative`).
   */
  hd: string | null;
}

/**
 * Whether Google vouches for the inbox behind `email` today, by Google's own
 * rule ("Using email, email_verified and hd", Sign in with Google docs): a
 * gmail.com address, or a Workspace account (`hd` set). For any other address
 * `email_verified` only says the address was verified when the Google account
 * was made — whoever holds that inbox now may be someone else — so it is not
 * proof of the inbox. googlemail.com is Gmail's legacy spelling of the same
 * mailboxes.
 */
export function googleIsAuthoritative(email: string, hd: string | null | undefined): boolean {
  const e = String(email || '').trim().toLowerCase();
  if (/@(gmail|googlemail)\.com$/.test(e)) return true;
  return typeof hd === 'string' && hd.trim() !== '';
}

export type GoogleIdTokenResult =
  | { ok: true; claims: GoogleIdentity }
  | { ok: false; code: 'token_invalid' | 'email_unverified'; reason: string };

const invalid = (reason: string): GoogleIdTokenResult => ({ ok: false, code: 'token_invalid', reason });

/**
 * Check a Google id_token for `clientId`. `jwks` and `now` (seconds) are
 * injectable for tests; production passes neither.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  opts: { jwks?: JWTVerifyGetKey; now?: number } = {},
): Promise<GoogleIdTokenResult> {
  if (typeof idToken !== 'string' || !idToken || !clientId) return invalid('missing');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, opts.jwks ?? googleJwks(), {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: GOOGLE_CLOCK_SKEW_SEC,
      currentDate: new Date(now * 1000),
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (e) {
    // Google's certs not answering is not a fault in the token; it is named
    // apart so the route does not record it as a refused credential (D200).
    // jose throws its generic error for a certs response that is not a 200
    // JSON key set, and the fetch's own error (not a JOSEError) for a network
    // that did not connect.
    if (!(e instanceof errors.JOSEError)) return invalid('jwks_unavailable');
    if (e instanceof errors.JWKSTimeout) return invalid('jwks_unavailable');
    if (e.code === 'ERR_JOSE_GENERIC') return invalid('jwks_unavailable');
    if (e instanceof errors.JWKSNoMatchingKey) return invalid('unknown_kid');
    if (e instanceof errors.JWSSignatureVerificationFailed) return invalid('signature');
    if (e instanceof errors.JWTExpired) return invalid('expired');
    if (e instanceof errors.JWTClaimValidationFailed) return invalid(`claim_${e.claim || 'unknown'}`);
    return invalid('malformed');
  }

  // `azp` is the client the token was issued to. Google sets it to the same ID
  // as `aud` for a web client; any other value means another client's token.
  if (payload.azp !== undefined && payload.azp !== clientId) return invalid('claim_azp');

  // jose checks `exp` against the skew. `iat` is checked here in both
  // directions, so each bound is one line and reads as the number it is.
  const iat = Number(payload.iat);
  if (!Number.isFinite(iat) || iat > now + GOOGLE_CLOCK_SKEW_SEC) return invalid('iat_future');
  if (now - iat > GOOGLE_TOKEN_MAX_AGE_SEC) return invalid('too_old');

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub || sub.length > 255) return invalid('claim_sub');

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) return invalid('claim_email');
  // Google sends a boolean; some older tokens carried the string.
  const verifiedEmail = payload.email_verified === true || payload.email_verified === 'true';
  if (!verifiedEmail) return { ok: false, code: 'email_unverified', reason: 'email_unverified' };

  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null;
  const hd = typeof payload.hd === 'string' && payload.hd.trim() ? payload.hd.trim().toLowerCase() : null;
  return { ok: true, claims: { sub, email, name, hd } };
}

/** Test seam: forget the cached key set, so a test can count the certs fetches. */
export const __testing = {
  resetJwks: () => { jwks = null; },
};
