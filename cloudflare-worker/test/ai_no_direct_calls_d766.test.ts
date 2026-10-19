// D766 (#2094) PR 3 — no Worker file calls a Workers AI model outside the
// router: every run is held, guarded, metered and charged in `run()`. The one
// listed exception is the live transcription WebSocket, with its reason. The
// listing reads the source, so a new direct call fails the build where it is
// written. Build › Brand's logo, the last direct call outside the issue's
// table, runs through the router as `brand_logo`. Each case names the
// mutations it was checked against.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/ai_no_direct_calls_d766.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { ROUTE, IMAGE_PRICED_MODELS, __resetForTest } from '../src/services/aiRouter.ts';
import brand from '../src/routes/brand.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The files allowed to call a model on the binding, each with why. */
const ALLOWED: Record<string, string> = {
  'services/aiRouter.ts': 'The router itself: every run, and the Llama Guard check inside it (D763), is called here.',
  'services/liveTranscription.ts': 'A live WebSocket session, not a call: it is held in blocks and settled on its minutes by its own path (D658), which the router has no shape for.',
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
/** Comments stripped, so a sentence that mentions `env.AI.run` is not a call. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/**
 * Each direct model call: `.AI.run(` on the binding, or `<name>.run(` where
 * `<name>` was taken from the binding (`const ai = env.AI`,
 * `const ai = (env as …).AI`).
 */
function directCalls() {
  const found: string[] = [];
  for (const file of sources(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, '/');
    const s = code(readFileSync(file, 'utf8'));
    const names = [...s.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*[^;\n]*\.AI\s*;/g)].map((m) => m[1]);
    const res = [/\.AI\s*\.\s*run\s*\(/g, ...names.map((n) => new RegExp(`(?<![\\w.])${n}\\s*\\.\\s*run\\s*\\(`, 'g'))];
    for (const re of res) {
      for (const m of s.matchAll(re)) found.push(`${rel}:${s.slice(0, m.index).split('\n').length}`);
    }
  }
  return found;
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('no Worker file calls a model on the AI binding outside the router; the live socket is the one listed exception', () => {
  // Mutations checked: a direct env.AI.run added to a route; one through an alias (`const ai = env.AI`); the router left off the list.
  const calls = directCalls();
  const outside = calls.filter((c) => !ALLOWED[c.replace(/:\d+$/, '')]);
  assert.deepEqual(outside, [], `direct model calls outside the router:\n${outside.join('\n')}`);
  const files = new Set(calls.map((c) => c.replace(/:\d+$/, '')));
  assert.deepEqual([...files].sort(), Object.keys(ALLOWED).sort(), 'an allowed file no longer calls the binding: remove it from the list');
  for (const [file, why] of Object.entries(ALLOWED)) assert.ok(why.length > 40, `${file} needs its reason`);
});

test('the listing finds a direct call written either way, and ignores one in a comment', () => {
  // Mutation checked: the alias pattern dropped from the listing.
  const s = code(`// env.AI.run('x') in a comment\nconst ai = (env as any).AI;\nawait ai.run('m', {});\nawait c.env.AI.run('m', {});`);
  const names = [...s.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*[^;\n]*\.AI\s*;/g)].map((m) => m[1]);
  assert.deepEqual(names, ['ai']);
  assert.equal((s.match(/\.AI\s*\.\s*run\s*\(/g) || []).length, 1, 'the comment is not a call');
  assert.equal((s.match(/(?<![\w.])ai\s*\.\s*run\s*\(/g) || []).length, 1);
});

// 2 ───────────────────────────────────────────────────────────────────────────
function makeAI(handler: (model: string, payload: any) => any) {
  const calls: Array<{ model: string; payload: any }> = [];
  return { calls, async run(model: string, payload: any) { calls.push({ model, payload }); return handler(model, payload); } };
}
async function logo(ai: any, balance = 5_000_000) {
  __resetForTest();
  const f = aiBudgetFixture();
  setFixtureAllowance(f.db, 0); // D783: no plan, and no tokens
  f.db.prepare('INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES(2,?)').run(balance);
  const env: any = { DB: f.DB, AI: withGuard(ai), JWT_SECRET: 'd766-fixture-only-secret', ENVIRONMENT: 'development' };
  const a = new Hono();
  a.onError((e: any, c) => { const st = AUTH_ERROR_STATUSES[e?.message]; return st ? c.json({ detail: e.message }, st) : c.json({ m: String(e?.message) }, 500); });
  a.route('/api/brand', brand);
  const jwt = await new SignJWT({ user_id: 2 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET));
  const r = await a.request('/api/brand/logo', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'A harbour crane', name: 'Harbour' }) }, env);
  const rows = f.db.prepare('SELECT user_id, task, model, surface, rail_page, rail_option, charged_microusd, units_json FROM ai_usage_logs WHERE guard_for IS NULL').all().map((x: any) => ({ ...x }));
  return { status: r.status, body: await r.json() as any, rows };
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 4, 0, 4, 0, 3, 0, 0, 0, 0xff, 0xd9]);

test('Build › Brand\'s logo is the member\'s brand_logo run on FLUX.1 Schnell: held, guarded, charged, with its page', async () => {
  // Mutations checked: the logo run as a system call (userId 0); the image's own mime dropped from the data URL; the rail dropped.
  const ai = makeAI(() => ({ image: Buffer.from(JPEG).toString('base64') }));
  const r = await logo(ai);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.source, 'workers-ai');
  assert.equal(r.body.url, `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
  assert.deepEqual(ai.calls.map((c) => c.model), [ROUTE.brand_logo.model]);
  assert.ok(IMAGE_PRICED_MODELS.has(ROUTE.brand_logo.model), 'priced at the catalogue\'s image rate');
  assert.match(ai.calls[0].payload.prompt, /^A harbour crane\. Flat minimalist vector logo/);
  const [row] = r.rows;
  assert.deepEqual([row.user_id, row.task, row.surface, row.rail_page, row.rail_option], [2, 'brand_logo', '/build/brand', 'build', 'draw:brand/logo']);
  assert.ok(row.charged_microusd > 0, 'the member who pressed was charged');
  assert.deepEqual(JSON.parse(row.units_json), { tiles: 4, steps: 4, tokens_in: 0, tokens_out: 0 }, 'one 1024 × 1024 image, four steps');
});

test('a budget stop answers 402; a model that cannot be reached draws the inline SVG as before', async () => {
  // Mutations checked: the refusal swallowed into the SVG fallback; a model failure answered as a refusal.
  const broke = await logo(makeAI(() => ({ image: 'x' })), 0);
  assert.equal(broke.status, 402, JSON.stringify(broke.body));
  const down = await logo(makeAI(() => { throw new Error('5007: model unavailable'); }));
  assert.equal(down.status, 200);
  assert.equal(down.body.source, 'svg');
  assert.match(down.body.svg, /<svg/);
});
