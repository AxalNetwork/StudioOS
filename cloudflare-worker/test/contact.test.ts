/**
 * Task #6 (NICE-MKT-07) — Contact form → GitHub Issue handler guards.
 *
 * Drives the real `contact` Hono app via app.request() with a mock env.
 * The live GitHub round-trip cannot be exercised in CI (the
 * GITHUB_ISSUES_TOKEN secret only exists in the prod Worker), so these
 * lock in the two honest, offline-verifiable paths plus input validation:
 *   (a) honeypot filled  → 200 {ok:true}, returns BEFORE any GitHub/env read
 *   (b) valid submission with no GITHUB_ISSUES_TOKEN → 503 github_token_missing
 *   (c) missing required fields → 400
 *
 * Turnstile fails OPEN in non-production when TURNSTILE_SECRET_KEY is unset
 * (see services/turnstile.ts), so (b) reaches the token check without any
 * network call.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contact.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import contact from '../src/routes/contact.ts';

const VALID = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  subject: 'Partnership enquiry',
  message: 'This is a sufficiently long contact message.',
};

function post(body: Record<string, unknown>, env: Record<string, unknown> = {}) {
  return contact.request(
    '/contact',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

test('honeypot submission returns 200 ok without creating an issue', async () => {
  const res = await post({ ...VALID, hp: 'i-am-a-bot' }, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('valid submission with no GitHub token returns 503 github_token_missing', async () => {
  const res = await post(VALID, { ENVIRONMENT: 'development' });
  assert.equal(res.status, 503);
  const json = (await res.json()) as { code?: string };
  assert.equal(json.code, 'github_token_missing');
});

test('missing required fields returns 400', async () => {
  const res = await post({ name: '', email: '', subject: '', message: '' }, { ENVIRONMENT: 'development' });
  assert.equal(res.status, 400);
});
