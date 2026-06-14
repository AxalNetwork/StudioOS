/**
 * BLOCK-AUTH-02 — WebAuthn passkeys.
 *
 * Mounted at /api/auth/passkey. Four ceremonies + management:
 *   GET    /register-options   (auth) — start enrolment
 *   POST   /register-verify    (auth) — finish enrolment {response,label}
 *   POST   /auth-options              — start sign-in {email?}
 *   POST   /auth-verify               — finish sign-in {response} → mints session
 *   GET    /list               (auth) — list this user's passkeys
 *   DELETE /:id                (auth) — remove a passkey
 *
 * A passkey assertion mints a FULL-assurance session (factor='passkey') — it is
 * a strong, phishing-resistant factor, so it satisfies requireStepUp() just like
 * a fresh TOTP. Challenges are single-use, ~5 min, stored in D1 (not KV) because
 * the ceremony is a strict request/response pair and KV is eventually consistent.
 */
import { Hono } from 'hono';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  createJWT, requireAuth, setAuthCookies, generateCsrfToken,
  revokeStaleCrossIdentitySession,
} from '../auth';
import { ensureAuthBlockersSchema } from '../services/authBlockersSchema';
import { hashEmail } from '../util/hashEmail';
import { rpID, rpName, expectedOrigins } from '../util/webauthn';

const passkey = new Hono<{ Bindings: Env }>();

const CHALLENGE_TTL_MIN = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function err(c: any, label: string, friendly: string, e: unknown, status = 500) {
  console.error(`[PASSKEY:${label}]`, e);
  return c.json({ error: friendly }, status);
}

async function readJson(c: any): Promise<any> {
  try { return await c.req.json(); } catch { return {}; }
}

// Decode the base64url challenge the authenticator echoed back inside
// clientDataJSON. This is the value we look up to claim the single-use row,
// so a stale/forged ceremony can never be replayed against a live challenge.
function challengeFromResponse(resp: any): string | null {
  try {
    const cdj = resp?.response?.clientDataJSON;
    if (!cdj || typeof cdj !== 'string') return null;
    const json = isoBase64URL.toUTF8String(cdj);
    const data = JSON.parse(json);
    return typeof data?.challenge === 'string' ? data.challenge : null;
  } catch { return null; }
}

async function storeChallenge(env: Env, challenge: string, userId: number | null, kind: 'registration' | 'authentication') {
  const expires = new Date(Date.now() + CHALLENGE_TTL_MIN * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?)`,
  ).bind(challenge, userId, kind, expires).run();
}

// Atomic single-use claim — succeeds only for an unused, unexpired challenge of
// the right kind. Returns the row so the caller can scope by user_id.
async function claimChallenge(env: Env, challenge: string, kind: 'registration' | 'authentication') {
  return env.DB.prepare(
    `UPDATE webauthn_challenges SET used_at = CURRENT_TIMESTAMP
       WHERE challenge = ? AND kind = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       RETURNING challenge, user_id`,
  ).bind(challenge, kind).first<{ challenge: string; user_id: number | null }>();
}

// ───────────────────────────────────────────── registration (enrolment) ──
passkey.get('/register-options', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const user = await requireAuth(c);
    const existing = await c.env.DB.prepare(
      `SELECT credential_id, transports FROM passkeys WHERE user_id = ?`,
    ).bind(user.id).all<{ credential_id: string; transports: string | null }>();

    const options = await generateRegistrationOptions({
      rpName: rpName(c.env),
      rpID: rpID(c.env),
      userID: new TextEncoder().encode(String(user.id)) as Uint8Array<ArrayBuffer>,
      userName: user.email,
      userDisplayName: user.name || user.email,
      attestationType: 'none',
      excludeCredentials: (existing.results || []).map((r) => ({
        id: r.credential_id,
        transports: safeTransports(r.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await storeChallenge(c.env, options.challenge, user.id, 'registration');
    return c.json(options);
  } catch (e) {
    if (e instanceof Response) return e;
    return err(c, 'register-options', 'Could not start passkey registration.', e);
  }
});

passkey.post('/register-verify', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const user = await requireAuth(c);
    const body = await readJson(c);
    const response = body?.response;
    const label = String(body?.label || '').trim().slice(0, 60) || 'Passkey';
    if (!response) return c.json({ error: 'Missing registration response' }, 400);

    const challenge = challengeFromResponse(response);
    if (!challenge) return c.json({ error: 'Malformed registration response' }, 400);
    const claimed = await claimChallenge(c.env, challenge, 'registration');
    if (!claimed || Number(claimed.user_id) !== Number(user.id)) {
      return c.json({ error: 'Registration challenge expired. Please try again.' }, 400);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigins(c.env),
        expectedRPID: rpID(c.env),
        requireUserVerification: false,
      });
    } catch (e) {
      return err(c, 'register-verify', 'We could not verify that passkey. Please try again.', e, 400);
    }
    if (!verification.verified || !verification.registrationInfo) {
      return c.json({ error: 'Passkey verification failed.' }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
    try {
      await c.env.DB.prepare(
        `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        user.id,
        credential.id,
        isoBase64URL.fromBuffer(credential.publicKey),
        credential.counter ?? 0,
        JSON.stringify(credential.transports || []),
        credentialDeviceType || null,
        credentialBackedUp ? 1 : 0,
        aaguid || null,
        label,
      ).run();
    } catch (e: any) {
      if (String(e?.message || '').includes('UNIQUE')) {
        return c.json({ error: 'That passkey is already registered.' }, 409);
      }
      return err(c, 'register-verify', 'Could not save your passkey. Please try again.', e);
    }

    try {
      const eh = await hashEmail(user.email);
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id)
         VALUES ('passkey_registered', ?, ?, ?)`,
      ).bind(`passkey registered (email_hash=${eh})`, eh, user.id).run();
    } catch {}

    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return err(c, 'register-verify', 'Could not complete passkey registration.', e);
  }
});

// ─────────────────────────────────────────────────── authentication (login) ──
passkey.post('/auth-options', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const body = await readJson(c);
    const email = String(body?.email || '').toLowerCase().trim();

    let userId: number | null = null;
    let allowCredentials: { id: string; transports?: any }[] | undefined;
    if (email && EMAIL_RE.test(email)) {
      const sql = getSQL(c.env);
      try {
        const rows = await sql`SELECT id FROM users WHERE email = ${email}`;
        if (rows.length) {
          userId = Number(rows[0].id);
          const keys = await c.env.DB.prepare(
            `SELECT credential_id, transports FROM passkeys WHERE user_id = ?`,
          ).bind(userId).all<{ credential_id: string; transports: string | null }>();
          allowCredentials = (keys.results || []).map((r) => ({
            id: r.credential_id,
            transports: safeTransports(r.transports),
          }));
        }
      } finally { await sql.end(); }
    }

    const options = await generateAuthenticationOptions({
      rpID: rpID(c.env),
      userVerification: 'preferred',
      allowCredentials,
    });
    // user_id may be null (discoverable login) — we resolve the user from the
    // matched credential at verify time.
    await storeChallenge(c.env, options.challenge, userId, 'authentication');
    return c.json(options);
  } catch (e) {
    return err(c, 'auth-options', 'Could not start passkey sign-in.', e);
  }
});

passkey.post('/auth-verify', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const body = await readJson(c);
    const response = body?.response;
    if (!response?.id) return c.json({ error: 'Missing passkey response' }, 400);

    const challenge = challengeFromResponse(response);
    if (!challenge) return c.json({ error: 'Malformed passkey response' }, 400);
    const claimed = await claimChallenge(c.env, challenge, 'authentication');
    if (!claimed) return c.json({ error: 'Sign-in challenge expired. Please try again.' }, 400);

    // Resolve the credential the authenticator used.
    const stored = await c.env.DB.prepare(
      `SELECT id, user_id, credential_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?`,
    ).bind(String(response.id)).first<{
      id: number; user_id: number; credential_id: string; public_key: string; counter: number; transports: string | null;
    }>();
    if (!stored) return c.json({ error: 'Unrecognized passkey.' }, 401);
    // If the challenge was scoped to a user (targeted login), it must match.
    if (claimed.user_id != null && Number(claimed.user_id) !== Number(stored.user_id)) {
      return c.json({ error: 'Passkey does not match this account.' }, 401);
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: expectedOrigins(c.env),
        expectedRPID: rpID(c.env),
        credential: {
          id: stored.credential_id,
          publicKey: isoBase64URL.toBuffer(stored.public_key),
          counter: Number(stored.counter) || 0,
          transports: safeTransports(stored.transports),
        },
        requireUserVerification: false,
      });
    } catch (e) {
      return err(c, 'auth-verify', 'We could not verify that passkey. Please try again.', e, 401);
    }
    if (!verification.verified) return c.json({ error: 'Passkey verification failed.' }, 401);

    // Advance the signature counter (clone-detection) + stamp last use.
    try {
      await c.env.DB.prepare(
        `UPDATE passkeys SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(verification.authenticationInfo.newCounter, stored.id).run();
    } catch {}

    // Load the user and mint a FULL-assurance session (factor='passkey').
    const sql = getSQL(c.env);
    let user: any;
    try {
      const rows = await sql`SELECT * FROM users WHERE id = ${stored.user_id}`;
      if (!rows.length) { await sql.end(); return c.json({ error: 'Account not found.' }, 401); }
      user = rows[0];
      if (Number(user.is_active ?? 1) === 0) { await sql.end(); return c.json({ error: 'Your Axal account is inactive. Contact support.' }, 403); }

      const jti = crypto.randomUUID();
      const jwtToken = await createJWT(c.env, user.id, user.email, user.role, undefined, jti);
      const ua = (c.req.header('user-agent') || '').slice(0, 500);
      const ip = (c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64);
      try {
        await sql`INSERT INTO user_sessions (user_id, jti, user_agent, ip, factor, assurance_level)
                  VALUES (${user.id}, ${jti}, ${ua || null}, ${ip || null}, 'passkey', 'full')`;
      } catch (e) { console.error('[PASSKEY:auth-verify] session insert failed', e); }

      const eh = await hashEmail(user.email);
      await sql`INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('user_login_passkey', ${`passkey sign-in (email_hash=${eh})`}, ${eh}, ${user.id})`;
      await sql.end();

      await revokeStaleCrossIdentitySession(c, user.id);
      const csrf = generateCsrfToken();
      setAuthCookies(c, jwtToken, csrf);
      return c.json({
        token: jwtToken,
        csrf_token: csrf,
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        expires_in: 24 * 3600,
      });
    } catch (e) {
      try { await sql.end(); } catch {}
      return err(c, 'auth-verify', 'Could not complete passkey sign-in.', e);
    }
  } catch (e) {
    return err(c, 'auth-verify', 'Could not complete passkey sign-in.', e);
  }
});

// ─────────────────────────────────────────────────────────── management ──
passkey.get('/list', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const user = await requireAuth(c);
    const rows = await c.env.DB.prepare(
      `SELECT id, name, device_type, backed_up, created_at, last_used_at
         FROM passkeys WHERE user_id = ? ORDER BY created_at DESC`,
    ).bind(user.id).all();
    return c.json({ passkeys: rows.results || [] });
  } catch (e) {
    if (e instanceof Response) return e;
    return err(c, 'list', 'Could not load your passkeys.', e);
  }
});

passkey.delete('/:id', async (c) => {
  try {
    await ensureAuthBlockersSchema(c.env);
    const user = await requireAuth(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid passkey id' }, 400);
    const res = await c.env.DB.prepare(
      `DELETE FROM passkeys WHERE id = ? AND user_id = ?`,
    ).bind(id, user.id).run();
    if (!res.meta?.changes) return c.json({ error: 'Passkey not found' }, 404);
    try {
      const eh = await hashEmail(user.email);
      await c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id)
         VALUES ('passkey_removed', ?, ?, ?)`,
      ).bind(`passkey removed (email_hash=${eh})`, eh, user.id).run();
    } catch {}
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return err(c, 'delete', 'Could not remove that passkey.', e);
  }
});

function safeTransports(raw: string | null): any {
  if (!raw) return undefined;
  try { const v = JSON.parse(raw); return Array.isArray(v) && v.length ? v : undefined; } catch { return undefined; }
}

export default passkey;
