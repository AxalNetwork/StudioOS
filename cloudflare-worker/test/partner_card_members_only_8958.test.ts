/**
 * D8958 (#8958) — a partner's directory profile is Members only, enforced in
 * the Worker (#6981, the owner's answer of 2026-11-27).
 *
 * `GET /api/public/p/:partner_slug` (routes/public.ts `publicPartnerCard`) and
 * the `/partners/<slug>` link card (services/socialCards.ts), over an
 * in-memory D1 built from the baseline and every migration. Every name, code
 * and address is synthetic.
 *
 *   1. Signed out: the display name and `members_only` only, never cached.
 *   2. Signed in: the profile.
 *   3. Unlisted, inactive and missing are one 404, signed in or out.
 *   4. A referral code resolves while signed out, to the name only.
 *   5. A token that names no active account reads as signed out.
 *   6. The link card (always read signed out) carries the name and nothing of the profile.
 *   7. The authorization ledger records the gate and names this file.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/partner_card_members_only_8958.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import publicRoutes from '../src/routes/public.ts';
import { serveSocialCard } from '../src/services/socialCards.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const JWT_SECRET = 'synthetic-8958-only-not-a-real-credential'.repeat(2);

const MEMBER = 1;   // an active member
const GONE = 2;     // an account that is no longer active

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${MEMBER}, 'mia-member', 'mia@example.invalid', 'Mia Member', 'founder', 1),
      (${GONE}, 'old-account', 'old@example.invalid', 'Old Account', 'founder', 0);
    INSERT INTO partners (id, uid, name, email, company, specialization, referral_code, status, directory_listed) VALUES
      (1, 'listed-p', 'Listed Partner', 'lp@example.invalid', 'Synthetic Counsel LLP', 'Synthetic tax law', 'LISTCODE1', 'active', 1),
      (2, 'quiet-p', 'Quiet Partner', 'qp@example.invalid', 'Quiet Advisory LLP', 'Synthetic audits', 'QUIETCODE', 'active', 0),
      (3, 'paused-p', 'Paused Partner', 'pp@example.invalid', 'Paused Firm LLP', 'Synthetic payroll', 'PAUSEDCODE', 'inactive', 1);
  `);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/public', publicRoutes);
  return { db, env, app };
}

async function token(userId: number) {
  return new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function get(f: ReturnType<typeof fixture>, key: string, as: number | null = null, rawToken?: string) {
  const headers: Record<string, string> = {};
  const t = rawToken ?? (as === null ? null : await token(as));
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await f.app.request(`/api/public/p/${encodeURIComponent(key)}`, { headers }, f.env);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), cacheControl: res.headers.get('cache-control') };
}

const PROFILE_WORDS = /listed-p|Synthetic Counsel|Synthetic tax law|lp@example|LISTCODE1/;

test('1. signed out: the display name and members_only only, and the answer is not cached', async () => {
  // Mutation checked: the signed-out branch removed (everyone gets the profile) → this fails;
  // the Cache-Control header removed → this fails.
  const f = fixture();
  const r = await get(f, 'listed-p');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { name: 'Listed Partner', members_only: true });
  assert.doesNotMatch(r.text, PROFILE_WORDS, 'no uid, company, specialization, address or code');
  assert.equal(r.cacheControl, 'private, no-store');
});

test('2. signed in: the profile, not cached either', async () => {
  const f = fixture();
  const r = await get(f, 'LISTED-P', MEMBER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    uid: 'listed-p', handle: 'listed-p', name: 'Listed Partner',
    company: 'Synthetic Counsel LLP', specialization: 'Synthetic tax law',
  });
  assert.equal(r.cacheControl, 'private, no-store');
});

test('3. unlisted, inactive and missing: the same 404 for every caller', async () => {
  // Mutation checked: the gate as the old `status = 'active'` alone → the unlisted partner answers 200;
  // the listed flag alone (status dropped) → the inactive partner answers 200.
  const f = fixture();
  const missing = await get(f, 'no-such-partner');
  assert.equal(missing.status, 404);
  for (const as of [null, MEMBER]) {
    for (const key of ['quiet-p', 'QUIETCODE', 'paused-p', 'PAUSEDCODE', 'no-such-partner']) {
      const r = await get(f, key, as);
      assert.equal(r.status, 404, `${key} as ${as}`);
      assert.equal(r.text, missing.text, `${key} as ${as}: the same bytes as a miss`);
      assert.doesNotMatch(r.text, /Quiet|Paused/);
    }
  }
});

test('4. a referral code resolves while signed out, to the display name only; signed in, to the profile', async () => {
  // Mutation checked: the referral_code match removed → the code answers 404.
  const f = fixture();
  const out = await get(f, 'listcode1');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { name: 'Listed Partner', members_only: true });
  assert.doesNotMatch(out.text, PROFILE_WORDS, 'the code never maps back to the uid for a signed-out caller');
  const inside = await get(f, 'LISTCODE1', MEMBER);
  assert.equal(inside.status, 200);
  assert.equal(inside.body.uid, 'listed-p');
  assert.equal(inside.body.company, 'Synthetic Counsel LLP');
});

test('5. a token that names no active account, or does not verify, reads as signed out', async () => {
  const f = fixture();
  const gone = await get(f, 'listed-p', GONE);
  assert.deepEqual(gone.body, { name: 'Listed Partner', members_only: true });
  const forged = await new SignJWT({ user_id: MEMBER }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode('some-other-secret-that-is-long-enough-to-sign'));
  const bad = await get(f, 'listed-p', null, forged);
  assert.deepEqual(bad.body, { name: 'Listed Partner', members_only: true });
});

const SHELL = `<!doctype html><html><head>
  <!-- BEGIN og:managed — generated by scripts/prerender-og.mjs. Edit
       frontend/src/lib/ogRegistry.js instead; changes here are overwritten. -->
    <title>Axal VC StudioOS</title>
  <!-- END og:managed -->
</head><body><div id="root"></div></body></html>`;

async function card(f: ReturnType<typeof fixture>, path: string) {
  const env = { ...f.env, ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) } };
  const saved = console.warn; console.warn = () => {};
  try {
    const res = (await serveSocialCard(new Request(`https://axal.vc${path}`), env))!;
    return res.text();
  } finally { console.warn = saved; }
}

test('6. the /partners/<slug> link card carries the display name and nothing of the profile', async () => {
  // Mutation checked: the card's description back to company · specialization → this fails.
  const f = fixture();
  const listed = await card(f, '/partners/listed-p');
  assert.match(listed, /<title>Listed Partner — Axal VC StudioOS<\/title>/);
  assert.doesNotMatch(listed, /Synthetic Counsel|Synthetic tax law/);
  assert.match(listed, /Members only/);
  const byCode = await card(f, '/partners/LISTCODE1');
  assert.match(byCode, /<title>Listed Partner — Axal VC StudioOS<\/title>/);
  assert.doesNotMatch(byCode, /Synthetic Counsel|Synthetic tax law/);
  const miss = await card(f, '/partners/no-such-partner');
  assert.equal(await card(f, '/partners/quiet-p'), miss);
  assert.equal(await card(f, '/partners/paused-p'), miss);
});

test('7. the authorization ledger records the gate as optional sign-in, verified by this file', () => {
  const ledger = JSON.parse(readFileSync(resolve(ROOT, 'scripts/baselines/auth-inventory/%2Fapi%2Fpublic.json'), 'utf8'));
  const entry = ledger['GET /api/public/p/:partner_slug'];
  assert.equal(entry.review, 'optional_auth');
  assert.equal(entry.state, 'verified');
  assert.equal(entry.test, 'cloudflare-worker/test/partner_card_members_only_8958.test.ts');
  assert.match(entry.note, /D8958/);
});
