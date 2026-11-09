/**
 * #4578 (D4578) — the link /register asks for right after it created an account is worded as finishing that account,
 * not as a returning member's sign-in; every other caller of /magic/start keeps the sign-in email, and the answer is
 * the same either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import auth from '../src/routes/auth.ts';
import { send } from '../src/services/email/send.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}
function env() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const sent: any[] = [];
  return {
    sent,
    env: {
      USE_CF_QUEUE: 'true', APP_URL: 'https://axal.vc', ENVIRONMENT: 'development', JWT_SECRET: 'unit-test-jwt-secret-4578-0123456789abcdef',
      JOB_QUEUE: { send: async (body: any) => { sent.push(body); } },
      DB: d1Over(db),
      // The rate limiter's store: an in-memory KV, so every bucket starts empty.
      ...Object.fromEntries(['RATE_LIMITS'].map((k) => [k, kv()])),
    } as any,
  };
}
async function start(e: any, body: Record<string, unknown>, ip: string) {
  const res = await auth.request('/magic/start', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body),
  }, e);
  return { status: res.status, body: await res.json().catch(() => null) };
}

test('/magic/start with purpose signup sends the new-account email; without it, the sign-in email; same answer', async () => {
  const a = env();
  const signup = await start(a.env, { email: 'new.person@example.test', purpose: 'signup' }, '203.0.113.1');
  const signin = await start(a.env, { email: 'returning@example.test' }, '203.0.113.2');
  const other = await start(a.env, { email: 'other@example.test', purpose: 'anything' }, '203.0.113.3');
  assert.deepEqual([signup.status, signin.status, other.status], [202, 202, 202]);
  assert.deepEqual(signup.body, signin.body, 'the answer does not reveal which email was sent');
  const keys = a.sent.map((s) => [s.payload.to, s.payload.template_key]);
  // Mutation checked: always sending auth_magic_link fails the first pair.
  assert.deepEqual(keys, [
    ['new.person@example.test', 'auth_signup_link'],
    ['returning@example.test', 'auth_magic_link'],
    ['other@example.test', 'auth_magic_link'],
  ]);
});

test('the new-account email finishes creating the account and names the review; it never says "sign in"', async () => {
  const sent: any[] = [];
  const e = { USE_CF_QUEUE: 'true', APP_URL: 'https://axal.vc', JOB_QUEUE: { send: async (b: any) => { sent.push(b); } },
    DB: { prepare() { return { bind() { return this; }, async run() { return { meta: { last_row_id: 1 } }; }, async first() { return null; } }; } } };
  const url = 'https://axal.vc/api/auth/magic/verify?token=example-token';
  assert.equal((await send(e as any, 'auth_signup_link', 'p@example.test', { name: 'Pat', magic_url: url })).ok, true);
  const p = sent[0].payload;
  assert.equal(p.subject, 'Finish creating your Axal VC account');
  assert.match(p.text, /finish creating your Axal VC account/i);
  assert.match(p.text, /reviews your membership/);
  assert.ok(p.text.includes(url));
  assert.doesNotMatch(`${p.subject}\n${p.text}`, /sign[ -]?in/i);
  // The returning member's email is unchanged.
  await send(e as any, 'auth_magic_link', 'q@example.test', { name: 'Quinn', magic_url: url });
  assert.equal(sent[1].payload.subject, 'Your Axal sign-in link');
});
