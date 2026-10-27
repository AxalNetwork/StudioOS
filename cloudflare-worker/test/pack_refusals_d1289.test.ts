/**
 * D1289 (#3372, part 4 of #2452) — every pack refusal answers with a sentence
 * (CRP5), and no pack price or size is typed anywhere but the pack store
 * (D755 §4).
 *
 * The router half, each code to its status and sentence through
 * `POST /api/orders/intent`, is `ai_credits_d755`'s "each pack rule" case,
 * which reads `TOKEN_PACK_REFUSALS`; the first-purchase rule is
 * `token_pack_offers_d790`'s. This file pins the table itself and the parity.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/pack_refusals_d1289.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_PACK_LIMITS, TOKEN_PACK_REFUSALS } from '../src/services/aiCredits.ts';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import aiBudgetRoute, { ADD_TOKENS_FROM } from '../src/routes/ai_budget.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The codes `tokenPackQuote` can refuse with, read from its own body. */
function quoteCodes(): string[] {
  const src = read('cloudflare-worker/src/services/aiCredits.ts');
  const start = src.indexOf('export async function tokenPackQuote(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  return [...new Set([...body.matchAll(/return \{ error: '([a-z_]+)' \}/g)].map((m) => m[1]))].sort();
}

test('every refusal tokenPackQuote can give has a sentence and a status, and nothing else does', () => {
  const codes = quoteCodes();
  assert.ok(codes.length >= 7, `read ${codes.length} codes`);
  assert.deepEqual(Object.keys(TOKEN_PACK_REFUSALS).sort(), codes, 'a new code without a sentence, or a sentence for no code, fails here');
  for (const [code, r] of Object.entries(TOKEN_PACK_REFUSALS)) {
    assert.ok([400, 409].includes(r.status), code);
    assert.match(r.message, /^[A-Z].+\.$/, `${code}: a sentence`);
    assert.ok(!/[a-z]+_[a-z_]+/.test(r.message), `${code}: no code inside the sentence`);
    assert.ok(!/credit/i.test(r.message), `${code}: AI tokens, never credits (D793)`);
    assert.ok(!/stripe|card_declined|\bdecline/i.test(r.message), `${code}: never a Stripe code or a bank's words`);
  }
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_first_purchase_only.status, 409, 'D790 kept its status');
});

test('the canvas\'s words, with their figures from TOKEN_PACK_LIMITS, never typed twice', () => {
  assert.equal(TOKEN_PACK_REFUSALS.token_pack_daily_limit.message, `You’ve reached today’s limit of ${TOKEN_PACK_LIMITS.ordersPerDay} pack orders. Try again tomorrow.`);
  assert.equal(TOKEN_PACK_REFUSALS.token_balance_ceiling.message, 'This pack would take your balance over $1,000.');
  assert.equal(TOKEN_PACK_REFUSALS.token_packs_on_hold.message, 'Buying tokens is paused on this account while a payment is reviewed. Contact support.');
  assert.equal(TOKEN_PACK_REFUSALS.promo_not_for_token_packs.message, 'Promo codes don’t apply to token packs. Offers show on the pack.');
  const src = read('cloudflare-worker/src/services/aiCredits.ts');
  const table = src.slice(src.indexOf('export const TOKEN_PACK_REFUSALS'), src.indexOf('});', src.indexOf('export const TOKEN_PACK_REFUSALS')));
  assert.match(table, /\$\{TOKEN_PACK_LIMITS\.ordersPerDay\}/);
  assert.match(table, /\$\{dollars\(TOKEN_PACK_LIMITS\.balanceCeilingMicrousd\)\}/);
  assert.ok(!/\b5 pack orders|\$1,000/.test(table), 'the figures are read, not typed');
  // The route answers from the table alone: no pack sentence is typed in it.
  const orders = read('cloudflare-worker/src/routes/orders.ts');
  assert.match(orders, /const refusal = TOKEN_PACK_REFUSALS\[aiQuote\.error\];\s*return c\.json\(\{ error: aiQuote\.error, message: refusal\.message \}, refusal\.status\);/);
  assert.ok(!/first token purchase/.test(orders), 'D790\'s sentence moved to the table');
});

// ---------------------------------------------------------------- parity

/** Source files under a directory, tests and the pack store's own tests aside. */
function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(join(ROOT, d))) {
      const p = join(d, name);
      if (statSync(join(ROOT, p)).isDirectory()) { if (!/node_modules|__tests__|\btest\b/.test(name)) walk(p); continue; }
      if (/\.(m?js|jsx|ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** Code with its comments removed: a comment may show a label's format, code may not hold a pack's figure. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/**
 * A pack's price or size typed as text ("$25 of tokens", "a $10 pack") or as a
 * pack-store field with a figure. Two things are not a pack's figure: the rate
 * ("$1 of tokens buys $1 of AI use", D755 §1) and a field set to 0 (no bonus).
 */
const PACK_FIGURE = [
  /\$\s?\d[\d,]*(\.\d+)?\s+(of\s+(AI\s+)?tokens(?!\s+buys)|(token\s+)?pack\b)/i,
  /\b(credit_microusd|bonus_microusd|face_cents|faceCents)\s*:\s*[1-9]/,
];

export function packFigures(files: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lines = code(read(f)).split('\n');
    lines.forEach((line, i) => { if (PACK_FIGURE.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  return hits;
}

test('pack parity: no pack price or size is typed anywhere but the pack store, in the Worker or the frontend (D755 §4)', () => {
  const files = [...sources('cloudflare-worker/src'), ...sources('frontend/src')];
  assert.ok(files.length > 500, `read ${files.length} files`);
  assert.deepEqual(packFigures(files), [], 'a pack figure is read from the pack store (`ai_token_packs`, `/api/public/plans-and-packs`), never typed');
});

test('the parity scan sees what it is for, and leaves comments and limits alone', () => {
  const hit = (s: string) => PACK_FIGURE.some((re) => re.test(code(s)));
  assert.ok(hit("const label = '$25 of tokens';"));
  assert.ok(hit('`Buy a $10 pack`'));
  assert.ok(hit('{ credit_microusd: 25000000 }'));
  assert.ok(hit('const p = { faceCents: 2500 };'));
  assert.ok(!hit('/** "$25 of tokens" from a pack\'s face value */'), 'a comment showing the format is not a figure');
  assert.ok(!hit('// e.g. $25 of tokens'));
  assert.ok(!hit('minFaceCents: 500,'), 'TOKEN_PACK_LIMITS is a bound, not a pack');
  assert.ok(!hit("'$1 of tokens buys $1 of AI use.'"), 'the rate is not a pack');
  assert.ok(!hit('{ on_sale: true, bonus_microusd: 0 }'), 'no bonus is not a figure');
  assert.ok(hit("'$1 of tokens'"), 'a $1 pack named as a pack still counts');
  assert.ok(!hit("const url = 'https://x.test/a'; // $25 of tokens"));
  assert.equal(relative(ROOT, ROOT), '');
});

// ---------------------------------------------------------------- add_tokens_opened


const SECRET = 'd1289-fixture-only-signing-secret';
function opened() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const name of ['users', 'super_admins', 'user_sessions', 'mi_pro_subscriptions', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(baseline, name)));
  db.exec(read('cloudflare-worker/sql/migrations/277_user_recovery_state.sql'));
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (7, 'founder', 'Mia', 'mia@example.test')").run();
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (7, 'j7', 'totp', datetime('now'))").run();
  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  async function post(body: unknown, signedIn = true) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signedIn) headers.Authorization = `Bearer ${await new SignJWT({ user_id: 7, jti: 'j7' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    const res = await aiBudgetRoute.request('/add-tokens-opened', { method: 'POST', headers, body: JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  const rows = () => db.prepare("SELECT user_id, action, details, actor FROM activity_logs WHERE action = 'add_tokens_opened' ORDER BY id").all().map((r: any) => ({ ...r }));
  return { db, post, rows };
}

test('add_tokens_opened: one row holding `from` and nothing else, once per entry point per ten minutes', async () => {
  const f = opened();
  assert.deepEqual(await f.post({ from: 'models', prompt: 'write my deck', amount: 25 }), { status: 200, body: { recorded: true } });
  assert.deepEqual(await f.post({ from: 'models' }), { status: 200, body: { recorded: false } }, 'the same entry point again is the same row');
  assert.deepEqual((await f.post({ from: 'rail' })).body, { recorded: true }, 'another entry point is its own row');
  assert.deepEqual(f.rows(), [
    { user_id: 7, action: 'add_tokens_opened', details: '{"from":"models"}', actor: 'member' },
    { user_id: 7, action: 'add_tokens_opened', details: '{"from":"rail"}', actor: 'member' },
  ], 'nothing but `from`: no prompt, no figure');
  f.db.exec("UPDATE activity_logs SET created_at = datetime('now', '-9 minutes')");
  assert.deepEqual((await f.post({ from: 'models' })).body, { recorded: false }, 'nine minutes on, it is still the same opening');
  f.db.exec("UPDATE activity_logs SET created_at = datetime('now', '-11 minutes')");
  assert.deepEqual((await f.post({ from: 'models' })).body, { recorded: true }, 'after ten minutes it is a new opening');
});

test('add_tokens_opened: a sign-in is required, and only a known entry point is recorded', async () => {
  const f = opened();
  assert.notEqual((await f.post({ from: 'models' }, false)).status, 200);
  for (const from of ['', 'somewhere', 'models; DROP TABLE users', 42, null]) {
    assert.deepEqual((await f.post({ from })).status, 400, String(from));
  }
  assert.deepEqual(f.rows(), []);
  assert.ok(ADD_TOKENS_FROM.includes('refused_run' as any) && ADD_TOKENS_FROM.includes('billing' as any));
});
