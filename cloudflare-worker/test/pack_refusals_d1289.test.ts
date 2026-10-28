/**
 * D1289 (#3372, part 4 of #2452) — Add tokens, the Worker's part:
 *
 *   · every pack refusal `tokenPackQuote` can answer has a sentence in the
 *     canvas's words (CRP5), with each figure read from `TOKEN_PACK_LIMITS`;
 *     a new code without a sentence fails here;
 *   · pack parity: a pack's price or size is never typed outside the pack
 *     store (D755 §4), in `frontend/src` or the Worker;
 *   · `add_tokens_opened` (CRP9): one `activity_logs` row holding `from` and
 *     nothing else, through the real router.
 *
 * Each code through the real orders router, with its status and sentence, is
 * pinned in `ai_credits_d755.test.ts`'s "each pack rule" test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pack_refusals_d1289.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { TOKEN_PACK_LIMITS, TOKEN_PACK_REFUSALS, packRefusalBody } from '../src/services/aiCredits.ts';
import { AI_USD_SCALE } from '../src/services/aiBudget.ts';
import budgetRoute, { ADD_TOKENS_FROM } from '../src/routes/ai_budget.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const AI_CREDITS = read('cloudflare-worker/src/services/aiCredits.ts');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

// ───────────────────────────────────────────────────────────── CRP5: the sentences

test('every pack refusal tokenPackQuote can answer has a sentence and a status; a new code without one fails', () => {
  const union = /export type TokenPackRefusal = ([^;]+);/.exec(AI_CREDITS);
  assert.ok(union, 'the refusal union is where it was');
  const declared = [...union![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  // D1366: the quote, its shared limits and the custom amount's quote are where its refusals are returned.
  const fn = (name: string) => { const body = AI_CREDITS.slice(AI_CREDITS.indexOf(name)); return body.slice(0, body.indexOf('\n}\n')); };
  const body = ['export async function tokenPackQuote', 'async function accountLimits', 'async function customAmountQuote'].map(fn).join('\n');
  const returned = [...new Set([...body.matchAll(/return \{ error: '([a-z_]+)' \}/g)].map((m) => m[1]))].sort();
  assert.ok(returned.length >= 7, 'the quote still returns its refusals');
  assert.deepEqual(Object.keys(TOKEN_PACK_REFUSALS).sort(), declared, 'one sentence per declared code');
  for (const code of returned) assert.ok(code in TOKEN_PACK_REFUSALS, `${code} has no sentence`);
  for (const [code, r] of Object.entries(TOKEN_PACK_REFUSALS)) {
    assert.ok([400, 409].includes(r.status), code);
    assert.match(r.message, /^[A-Z].{20,}[.]$/, `${code}: a sentence`);
    assert.doesNotMatch(r.message, /credit|stripe|_/i, `${code}: AI tokens, never credits, and no code in the words`);
    assert.deepEqual(packRefusalBody(code as any), { error: code, message: r.message });
  }
});

test('the sentences are the canvas’s, and each figure is TOKEN_PACK_LIMITS’s, never typed twice', () => {
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_daily_limit.message, `You’ve reached today’s limit of ${TOKEN_PACK_LIMITS.ordersPerDay} pack orders. Try again tomorrow.`);
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_daily_limit.message, 'You’ve reached today’s limit of 5 pack orders. Try again tomorrow.');
  assert.equal(TOKEN_PACK_REFUSALS.token_balance_ceiling.message, 'This pack would take your balance over $1,000.');
  assert.equal(TOKEN_PACK_LIMITS.balanceCeilingMicrousd / AI_USD_SCALE, 1000);
  assert.equal(TOKEN_PACK_REFUSALS.token_packs_on_hold.message, 'Buying tokens is paused on this account while a payment is reviewed. Contact support.');
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_first_purchase_only.message, 'This pack is for your first token purchase, and you have bought tokens before. Choose another pack.');
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_first_purchase_only.status, 409);
  const block = AI_CREDITS.slice(AI_CREDITS.indexOf('export const TOKEN_PACK_REFUSALS'), AI_CREDITS.indexOf('export const packRefusalBody'));
  assert.match(block, /\$\{TOKEN_PACK_LIMITS\.ordersPerDay\}/);
  assert.match(block, /TOKEN_PACK_LIMITS\.balanceCeilingMicrousd/);
  assert.doesNotMatch(block, /1,000|limit of 5\b/, 'no figure typed in the sentences');
  // The orders route answers every refusal from the table, so none is left with a code alone.
  const orders = read('cloudflare-worker/src/routes/orders.ts');
  assert.match(orders, /return c\.json\(packRefusalBody\(aiQuote\.error\), TOKEN_PACK_REFUSALS\[aiQuote\.error\]\.status\);/);
  assert.doesNotMatch(orders, /c\.json\(\{ error: aiQuote\.error \}/);
  // The Super Admin's pack range reads the same limits.
  assert.match(read('cloudflare-worker/src/routes/catalog.ts'), /\$\{TOKEN_PACK_LIMITS\.minFaceCents \/ 100\} to \$\$\{TOKEN_PACK_LIMITS\.maxFaceCents \/ 100\}/);
});

// ───────────────────────────────────────────────────────────── pack parity (D755 §4)

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const p = join(dir, name);
    const st = statSync(resolve(ROOT, p));
    if (st.isDirectory()) { if (!/node_modules|__tests__/.test(name)) out.push(...sources(p)); }
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
/** The code without its comments, so a doc line such as "$25 of tokens" (describing a label) is not read as a typed pack. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** The shapes a typed pack takes: a "$N of tokens" label, a pack field given a number, a list of pack sizes, a "$N pack". */
export const PARITY_RULES: Array<[string, RegExp]> = [
  ['a pack label typed with its amount', /\$\s?(?:[2-9]|\d{2,})[\d,]*(?:\.\d+)? of (?:AI )?tokens/i],
  ['a pack field given a number', /\b(?:face_cents|faceCents|face_usd|bonus_microusd|bonusMicrousd|bonus_usd|credit_microusd|creditMicrousd)\s*:\s*[1-9]/],
  ['a list of pack sizes', /\b(?:PACKS|PACK_SIZES|PACK_AMOUNTS|PACK_PRICES|TOKEN_PACKS)\s*=\s*(?:Object\.freeze\()?\[\s*[\d{'"]/],
  ['a pack priced in words', /\$\s?\d[\d,]*(?:\.\d+)?\s+(?:token\s+)?packs?\b|\bpacks?\s+(?:of|for)\s+\$\s?\d/i],
];

test('pack parity: no pack price or size is typed in frontend/src or the Worker; the pack store holds them all', () => {
  const files = [...sources('frontend/src'), ...sources('cloudflare-worker/src')];
  assert.ok(files.length > 500, 'both trees were read');
  const hits: string[] = [];
  for (const f of files) {
    const src = code(read(f));
    for (const [what, re] of PARITY_RULES) {
      const m = re.exec(src);
      if (m) hits.push(`${f}: ${what}: ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], 'type a pack in HQ › AI allowances › Token packs (the pack store), never in code');
});

test('the parity rules catch what they are for, and leave the rate line and the limits alone', () => {
  const caught = (s: string) => PARITY_RULES.some(([, re]) => re.test(code(s)));
  for (const typed of ["const label = '$25 of tokens';", 'const p = { face_cents: 2500 };', 'export const PACK_SIZES = [5, 10, 25];', "<b>Buy a $10 pack</b>", "'packs for $25'"]) {
    assert.ok(caught(typed), typed);
  }
  for (const fine of ["'$1 of tokens buys $1 of AI use.'", '/** "$25 of tokens" from a pack’s face value */', 'const bonus = whole(x) ? x : 0;', '{ bonus_microusd: 0 }', 'TOKEN_PACK_LIMITS.minFaceCents', 'const PAGE_SIZES = [10, 25, 50];']) {
    assert.ok(!caught(fine), fine);
  }
});

// ───────────────────────────────────────────────────────────── CRP9: add_tokens_opened

async function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd1289-fixture-only-signing-secret', ENVIRONMENT: 'development' } as any;
  f.db.exec(stripForeignKeys(tableFromBaseline(BASELINE, 'user_sessions')));
  return { ...f, env };
}
async function post(f: any, body: unknown, claims: Record<string, unknown> = {}, user = 2) {
  const jti = `jti-${user}-${JSON.stringify(claims)}`;
  f.db.prepare("INSERT OR IGNORE INTO user_sessions (user_id, jti, factor, created_at, last_step_up_at) VALUES (?, ?, 'totp', datetime('now'), datetime('now'))").run(user, jti);
  const jwt = await new SignJWT({ user_id: user, jti, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const r = await budgetRoute.request('/add-tokens/opened', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}
const opened = (f: any) => f.db.prepare("SELECT action, details, actor, user_id FROM activity_logs WHERE action = 'add_tokens_opened'").all().map((r: any) => ({ ...r }));

test('add_tokens_opened: one row holding from and nothing else; an unknown from, a prompt or a support session writes none', async () => {
  const f = await world();
  try {
    const r = await post(f, { from: 'rail', prompt: 'Draft my pitch to Acme', amount_cents: 2500 });
    assert.deepEqual([r.status, r.body], [200, { ok: true, recorded: true }]);
    assert.deepEqual(opened(f), [{ action: 'add_tokens_opened', details: '{"from":"rail"}', actor: '2', user_id: 2 }], 'from only: never the prompt or an amount');
    for (const bad of [{}, { from: 'anywhere' }, { from: 'rail; DROP' }, { from: 42 }]) {
      const b = await post(f, bad);
      assert.equal(b.status, 400, JSON.stringify(bad));
      assert.equal(b.body.error, 'invalid_from');
    }
    const support = await post(f, { from: 'billing' }, { impersonated_by: 1 });
    assert.deepEqual(support.body, { ok: true, recorded: false });
    assert.equal(opened(f).length, 1, 'neither the bad nor the support session wrote a row');
    for (const from of ADD_TOKENS_FROM) assert.match(from, /^[a-z_]{2,20}$/);
    const unauth = await budgetRoute.request('/add-tokens/opened', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"from":"rail"}' }, f.env);
    assert.equal(unauth.status, 401);
  } finally { f.db.close(); }
});

test('the client calls the mounted route', () => {
  assert.match(read('frontend/src/lib/api/aiBudget.js'), /addTokensOpened: \(from\) => request\('\/ai-budget\/add-tokens\/opened', \{ method: 'POST', body: body\(\{ from \}\) \}\)/);
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/ai-budget', aiBudgetRoutes\)/);
});
