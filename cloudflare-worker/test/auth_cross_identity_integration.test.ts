/**
 * Task #4 — Integration regression test for the Google-OAuth cross-account
 * leak.
 *
 * Reproduces the exact bug:
 *   1. Browser has a stale admin (or admin impersonation) Bearer token
 *      living in localStorage.
 *   2. A different real user signs in via Google; the callback sets the
 *      `studioos_auth` httpOnly cookie for THAT user.
 *   3. The next `/api/auth/me` request ships BOTH headers:
 *         Authorization: Bearer <stale admin token>
 *         Cookie: studioos_auth=<fresh partner token>
 *   4. Pre-fix, `extractJwt` preferred Bearer unconditionally and `getCurrentUser`
 *      returned the admin row. Post-fix, `selectJwt` returns the cookie payload.
 *
 * This test asserts the post-fix behaviour by exercising `selectJwt` directly
 * with real signed JWTs and a fake Hono context. It does NOT spin up the full
 * worker (that would require D1 + KV bindings) — `getCurrentUser` itself is
 * exercised by the existing live deploy; the unit-level guarantee that the
 * selection picks the cookie is what was missing per code review.
 *
 * Run via:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/auth_cross_identity_integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createJWT, selectJwt } from '../src/auth.ts';

const ENV = { JWT_SECRET: 'a'.repeat(48) } as any;

/** Build a minimal Hono-shaped context that selectJwt can consume. */
function makeCtx(headers: Record<string, string>) {
  return {
    env: ENV,
    req: {
      header: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? undefined,
      path: '/api/auth/me',
    },
  } as any;
}

test('integration — stale admin Bearer + fresh partner cookie → cookie wins (regression)', async () => {
  const adminBearer = await createJWT(ENV, 1, 'admin@axal.vc', 'admin', undefined, 'admin-jti');
  const partnerCookie = await createJWT(ENV, 42, 'generativefinance@gmail.com', 'partner', undefined, 'partner-jti');

  const ctx = makeCtx({
    Authorization: `Bearer ${adminBearer}`,
    Cookie: `studioos_auth=${partnerCookie}; studioos_csrf=abc`,
  });

  const sel = await selectJwt(ctx);
  assert.ok(sel, 'selectJwt must resolve to a token');
  assert.equal(Number(sel!.payload.user_id), 42, 'cookie (partner) must win over stale admin Bearer');
  assert.equal(sel!.payload.role, 'partner');
  assert.equal(sel!.payload.jti, 'partner-jti');
});

test('integration — stale admin IMPERSONATION Bearer + fresh partner cookie → cookie wins', async () => {
  // Admin (id=1) was impersonating user 5; the Bearer carries impersonated_by=1.
  // A different real user (id=42) then signed in via Google.
  const impBearer = await createJWT(ENV, 5, 'impersonated@axal.vc', 'founder', 1, 'imp-jti');
  const partnerCookie = await createJWT(ENV, 42, 'generativefinance@gmail.com', 'partner', undefined, 'partner-jti');

  const ctx = makeCtx({
    Authorization: `Bearer ${impBearer}`,
    Cookie: `studioos_auth=${partnerCookie}`,
  });

  const sel = await selectJwt(ctx);
  assert.ok(sel);
  assert.equal(Number(sel!.payload.user_id), 42, 'fresh cookie must win — Bearer.impersonated_by !== cookie.user_id');
});

test('integration — legitimate impersonation (admin cookie + impersonation Bearer for admin) → bearer wins', async () => {
  // Real admin (id=1) cookie + admin impersonating user 99 via Bearer.
  // Both present, bearer.impersonated_by === cookie.user_id → bearer wins.
  const adminCookie = await createJWT(ENV, 1, 'admin@axal.vc', 'admin', undefined, 'admin-jti');
  const impBearer = await createJWT(ENV, 99, 'target@axal.vc', 'founder', 1, 'imp-jti');

  const ctx = makeCtx({
    Authorization: `Bearer ${impBearer}`,
    Cookie: `studioos_auth=${adminCookie}`,
  });

  const sel = await selectJwt(ctx);
  assert.ok(sel);
  assert.equal(Number(sel!.payload.user_id), 99, 'legitimate impersonation must still resolve to impersonated user');
  assert.equal(Number(sel!.payload.impersonated_by), 1);
});

test('integration — cookie only present → cookie wins', async () => {
  const cookieTok = await createJWT(ENV, 7, 'u7@axal.vc', 'partner', undefined, 'jti-7');
  const ctx = makeCtx({ Cookie: `studioos_auth=${cookieTok}` });
  const sel = await selectJwt(ctx);
  assert.ok(sel);
  assert.equal(Number(sel!.payload.user_id), 7);
});

test('integration — bearer only present → bearer wins', async () => {
  const bTok = await createJWT(ENV, 7, 'u7@axal.vc', 'partner', undefined, 'jti-7');
  const ctx = makeCtx({ Authorization: `Bearer ${bTok}` });
  const sel = await selectJwt(ctx);
  assert.ok(sel);
  assert.equal(Number(sel!.payload.user_id), 7);
});

test('integration — both undecodable / absent → null', async () => {
  const ctx = makeCtx({});
  assert.equal(await selectJwt(ctx), null);
});

test('integration — bearer undecodable, cookie valid → cookie wins (graceful)', async () => {
  const cookieTok = await createJWT(ENV, 7, 'u7@axal.vc', 'partner', undefined, 'jti-7');
  const ctx = makeCtx({
    Authorization: 'Bearer not-a-jwt',
    Cookie: `studioos_auth=${cookieTok}`,
  });
  const sel = await selectJwt(ctx);
  assert.ok(sel);
  assert.equal(Number(sel!.payload.user_id), 7);
});
