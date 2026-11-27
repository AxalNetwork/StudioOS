/**
 * D5318 H8 (#5318) — `GET /api/funds` no longer writes; the LP claim runs at
 * sign-in and when an LP row is written for an address an account holds.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/lp_claim_signin_d5318.test.ts
 *
 * Every account, fund and address is synthetic.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { harness } from './_perf_harness.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { claimLpRowsAtSignIn, claimLpRowsForAddress } from '../src/services/lpClaim.ts';
import { lpMembershipScope } from '../src/services/tenancyScope.ts';

const SRC = resolve(import.meta.dirname, '../src');
const src = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

let h: Awaited<ReturnType<typeof harness>>;
let env: any;
before(async () => {
  h = await harness();
  env = { DB: d1Over(h.db) };
  h.db.exec("INSERT INTO vc_funds(id, name) VALUES (71, 'Synthetic fund 71'), (72, 'Synthetic fund 72'), (73, 'Synthetic fund 73')");
});
after(() => h?.close());

const ownerOf = (id: number) => (h.db.prepare('SELECT user_id FROM limited_partners WHERE id = ?').get(id) as any)?.user_id ?? null;

test('the fund list reads an unclaimed LP row by email and writes nothing', async () => {
  // Mutation checked: the claim restored in funds.get('/') → the UPDATE is in
  // the statements and the row is owned after the GET, so both asserts fail.
  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (701, 71, 'SYNTHETIC-4@example.invalid', NULL)");
  const r = await h.request({ who: 4, path: '/api/funds' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.statements.filter((s) => /limited_partners/.test(s) && /^UPDATE/.test(s)), [],
    'the list must not claim');
  assert.equal(ownerOf(701), null, 'the GET left the row as it found it');
});

test('the list still shows the fund an unclaimed LP row grants by email', async () => {
  // The ownership check is unchanged: the list's LP arm is lpMembershipScope,
  // whose unclaimed-email arm still reaches row 701 after the GET above.
  const res = await h.request({ who: 4, path: '/api/funds' });
  const listSql = res.statements.find((s) => s.startsWith('SELECT f.*'));
  assert.ok(listSql && /OR EXISTS/.test(listSql), 'the list still runs its LP arm');
  const scope = lpMembershipScope({ id: 4, role: 'investor', email: 'synthetic-4@example.invalid' } as any, 'lpv');
  const seen = h.db.prepare(`SELECT f.id FROM vc_funds f WHERE EXISTS (SELECT 1 FROM limited_partners lpv WHERE lpv.fund_id = f.id AND ${scope.sql}) ORDER BY f.id`).all(...scope.binds) as any[];
  assert.deepEqual(seen.map((r) => r.id), [71]);
});

test('claimLpRowsAtSignIn links the signed-in account\'s unclaimed rows, never an owned one', async () => {
  // Mutation checked: `WHERE user_id IS NULL` dropped from the claim → row 703 moves to user 4 and this fails.
  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (702, 72, 'synthetic-4@example.invalid', NULL), (703, 73, 'synthetic-4@example.invalid', 2)");
  const r = await claimLpRowsAtSignIn(env, { id: 4, email: 'synthetic-4@example.invalid' });
  assert.ok(r.claimed >= 1);
  assert.equal(ownerOf(702), 4);
  assert.equal(ownerOf(703), 2, 'an owned row is never re-pointed');
  assert.deepEqual(await claimLpRowsAtSignIn(env, { id: 4, email: '' }), { claimed: 0 });
  assert.deepEqual(await claimLpRowsAtSignIn(env, null), { claimed: 0 });
});

test('claimLpRowsForAddress links a new row only to the one verified, active holder of the address', async () => {
  // Mutation checked: `AND email_verified = 1` dropped → row 704 is claimed while user 5 is unverified and this fails;
  // `rows.length !== 1` changed to `=== 0` → row 706 is claimed for an ambiguous address and this fails.
  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (704, 71, 'Synthetic-5@example.invalid', NULL)");
  assert.deepEqual(await claimLpRowsForAddress(env, 'Synthetic-5@example.invalid', 71), { claimed: 0 });
  assert.equal(ownerOf(704), null, 'an unverified address links nothing');

  h.db.exec('UPDATE users SET email_verified = 1 WHERE id = 5');
  assert.deepEqual(await claimLpRowsForAddress(env, 'Synthetic-5@example.invalid', 71), { claimed: 1 });
  assert.equal(ownerOf(704), 5);

  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (705, 72, 'nobody@example.invalid', NULL)");
  assert.deepEqual(await claimLpRowsForAddress(env, 'nobody@example.invalid', 72), { claimed: 0 });
  assert.equal(ownerOf(705), null, 'an address no account holds links nothing');

  h.db.exec("INSERT INTO users(id, role, name, email, is_active, email_verified) VALUES (8, 'investor', 'Synthetic 8', 'twin@example.invalid', 1, 1), (9, 'investor', 'Synthetic 9', 'TWIN@example.invalid', 1, 1)");
  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (706, 72, 'twin@example.invalid', NULL)");
  assert.deepEqual(await claimLpRowsForAddress(env, 'twin@example.invalid', 72), { claimed: 0 });
  assert.equal(ownerOf(706), null, 'an address two accounts hold links nothing');

  h.db.exec('UPDATE users SET is_active = 0 WHERE id = 5');
  h.db.exec("INSERT INTO limited_partners(id, fund_id, email, user_id) VALUES (707, 72, 'synthetic-5@example.invalid', NULL)");
  assert.deepEqual(await claimLpRowsForAddress(env, 'synthetic-5@example.invalid', 72), { claimed: 0 });
  assert.equal(ownerOf(707), null, 'an inactive account is not linked');
});

// ---------- every door claims, and no operator session does ----------

/** The routes that mint a session for the account's own holder. */
const SIGN_INS: Array<[string, number]> = [
  ['routes/auth.ts', 3], // /confirm-verify-email, /login (TOTP or recovery code), /magic/verify
  ['routes/auth_google.ts', 1], // mintGoogleSession
  ['routes/auth_passkey.ts', 1],
  ['routes/auth_sms.ts', 1],
  ['routes/auth_recover.ts', 1], // mintRecoverySession, behind every recovery path
];

test('every sign-in claims through the one shared helper', () => {
  // Mutation checked: the claim removed from /magic/verify → auth.ts has 2 calls and this fails.
  for (const [rel, n] of SIGN_INS) {
    const s = src(rel);
    const calls = (s.match(/await claimLpRowsAtSignIn\(c\.env, user\)/g) || []).length;
    assert.equal(calls, n, `${rel}: ${calls} sign-in claims, expected ${n}`);
    assert.equal((s.match(/createJWT\(c\.env, user\.id/g) || []).length, n, `${rel}: a session mint without a claim beside it`);
  }
});

test('operator and unverified sessions do not claim', () => {
  // Impersonation and support hand-offs act as the target, so a link written
  // there would name the wrong actor; a deck-share sign-up holds an address
  // nobody has verified yet.
  for (const rel of ['routes/admin.ts', 'rpc/branchOps.ts', 'routes/deck_share_actions.ts']) {
    assert.doesNotMatch(src(rel), /claimLpRows(?:AtSignIn|ByEmail|ForAddress)\s*\(/, rel);
  }
});

test('writing an LP row claims it for the account that already holds the address', () => {
  // Mutation checked: the call removed from POST /:id/lps → this fails.
  const funds = src('routes/funds.ts');
  const create = funds.slice(funds.indexOf("funds.post('/:id/lps'"), funds.indexOf("funds.post('/:id/lps'") + 2500);
  assert.match(create, /LPs\.create\([\s\S]*?claimLpRowsForAddress\(c\.env, \(lp as any\)\.email, fundId\)/);
  const capital = src('routes/capital.ts');
  assert.match(capital, /INSERT INTO limited_partners[\s\S]{0,900}?claimLpRowsForAddress\(c\.env, lp\?\.email, Number\(fund\.id\)\)/);
});

test('the fund list handler itself makes no claim', () => {
  const funds = src('routes/funds.ts');
  const start = funds.indexOf("funds.get('/', async");
  const body = funds.slice(start, funds.indexOf('\n});', start));
  assert.doesNotMatch(body, /claimLpRows\w*\s*\(/);
});
