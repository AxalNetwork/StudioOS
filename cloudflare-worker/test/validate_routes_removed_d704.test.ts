/**
 * D704 (#1666) — Validate's Interviews, Pain map and Hypotheses pages become
 * their modules. PR 1 (this part): the spend history follows them.
 *
 * Runs already recorded on an old page path are never rewritten. The two spend
 * reads count them under the module that holds the feature now
 * (`AI_SURFACE_ALIASES`): the per-page figure of `GET /api/ai/me/spend?surface=`
 * and `/account/usage`'s By page breakdown (`by_surface`). Each counts the
 * caller's own rows only. A read of an old path itself still counts only that
 * path's rows.
 *
 * `ai_usage_logs` is the baseline's DDL plus migration 319's `surface` column,
 * so the fixture runs the migration's own SQL rather than a hand-typed copy.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/validate_routes_removed_d704.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AI_SURFACE, AI_SURFACE_ALIASES } from '../src/services/aiSurfaces.ts';
import { normaliseSurface } from '../src/services/aiRouter.ts';
import { loadMyAiSpend } from '../src/services/aiSpend.ts';
import ai from '../src/routes/ai.ts';
import { createJWT } from '../src/auth.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SCHEMA = `${tableFromBaseline(read('cloudflare-worker/sql/schema_baseline.sql'), 'ai_usage_logs')}
${read('cloudflare-worker/sql/migrations/319_ai_usage_surface.sql')}`;

const OLD_TO_MODULE: Array<[string, string]> = [
  ['/validate/interviews', '/validate/customer-research'],
  ['/validate/pain-map', '/validate/problem-discovery'],
  ['/validate/hypotheses', '/validate/experiments'],
];

// ── 9 (PR 1). The alias ─────────────────────────────────────────────────────

test('9. AI_SURFACE_ALIASES is frozen and maps exactly the three retired pages to their modules', () => {
  assert.equal(Object.isFrozen(AI_SURFACE_ALIASES), true);
  assert.deepEqual(Object.entries(AI_SURFACE_ALIASES), OLD_TO_MODULE);
  for (const [, target] of OLD_TO_MODULE) {
    assert.equal(normaliseSurface(target), target, `${target} is not a path the router records unchanged`);
  }
  // Decision 8: the value moves in PR 2, with the redirects and D552.md.
  assert.equal(AI_SURFACE.validateInterviews, '/validate/interviews');
});

// ── 10. Spend alias, own rows only ──────────────────────────────────────────

const A = 21;
const B = 22;
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
/** 'YYYY-MM-DD HH:MM:SS', `seconds` before now: the route reads the wall clock. */
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
const LAST_MONTH = (() => {
  const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); d.setUTCHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
})();

/** For one old page and its module: A's runs on both, B's on the old page. */
function seedFor(old: string, mod: string) {
  return `
INSERT INTO ai_usage_logs (user_id, task, model, est_cost_usd, created_at, surface) VALUES
  (${A}, 'transcribe',        'm-old',      0.0030, '${ago(60)}',   '${old}'),
  (${A}, 'transcribe',        'm-old-past', 0.5000, '${LAST_MONTH}', '${old}'),
  (${A}, 'workspace_explain', 'm-module',   0.0020, '${ago(30)}',   '${mod}'),
  (${A}, 'workspace_explain', 'm-other',    0.0040, '${ago(90)}',   '/build/board'),
  (${B}, 'transcribe',        'm-theirs',   9.0000, '${ago(10)}',   '${old}');`;
}

/** A real SQLite `ai_usage_logs`, and a stub session for `requireAuth`, as ai_surface_d552 does. */
function routeEnv(userId: number, seed: string) {
  const { DB } = makeD1(SCHEMA, seed);
  const stub = (q: string) => {
    const api: any = {
      bind: () => api,
      first: async () => (/FROM user_sessions/i.test(q) ? { revoked_at: null, step_up_due_at: null } : null),
      all: async () => ({
        results: /FROM\s+users/i.test(q)
          ? [{ id: userId, email: `u${userId}@example.test`, role: 'founder', is_active: 1, name: 'U' }]
          : [],
      }),
      run: async () => ({ meta: { changes: 0 } }),
    };
    return api;
  };
  return {
    JWT_SECRET,
    DB: {
      prepare: (q: string) => (/ai_usage_logs/.test(q) ? DB.prepare(q) : stub(q)),
      exec: async () => ({ count: 0, duration: 0 }),
    },
  } as any;
}

async function spendOf(userId: number, surface: string, seed: string) {
  const env = routeEnv(userId, seed);
  const token = await createJWT(env, userId, `u${userId}@example.test`, 'founder', undefined, `jti-${userId}`);
  const res = await ai.request(`/me/spend?surface=${encodeURIComponent(surface)}`, { headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal(res.status, 200, surface);
  return res.json() as Promise<any>;
}

for (const [old, mod] of OLD_TO_MODULE) {
  test(`10. ${mod} counts the caller's runs on ${old}, this month, and only the caller's`, async () => {
    const seed = seedFor(old, mod);
    const a = await spendOf(A, mod, seed);
    assert.equal(a.recorded, true);
    assert.equal(a.month.calls, 2, 'A\'s two this-month runs: the old page\'s and the module\'s');
    assert.equal(Number(a.month.spend_usd.toFixed(4)), 0.005);
    assert.equal(a.last_run.model, 'm-module', 'the newer of the two is the last run');

    const b = await spendOf(B, mod, seed);
    assert.equal(b.month.calls, 1, 'B counts B\'s own old-page run only');
    assert.equal(b.last_run.model, 'm-theirs');

    const oldItself = await spendOf(A, old, seed);
    assert.equal(oldItself.month.calls, 1, 'a read of the old path counts that path only, not the module');
    assert.equal(oldItself.last_run.model, 'm-old');
  });

  test(`10. /account/usage's By page folds ${old} into ${mod}, and still adds up to the month`, async () => {
    const { DB } = makeD1(SCHEMA, seedFor(old, mod));
    const r = await loadMyAiSpend({ DB } as any, { id: A, role: 'founder' }, new Date());
    assert.equal(r.by_surface_recorded, true);
    const by = new Map(r.by_surface.map((s) => [s.surface, s]));
    assert.equal(by.has(old), false, 'the retired page keeps its own entry');
    assert.equal(by.get(mod)?.calls, 2);
    assert.equal(Number(by.get(mod)!.spend_usd.toFixed(4)), 0.005);
    // The query orders board ($0.004), old page ($0.003), module ($0.002); folded, the module ($0.005) leads.
    assert.deepEqual(r.by_surface.map((s) => s.surface), [mod, '/build/board'], 're-sorted by spend after the fold');
    const sum = r.by_surface.reduce((s, x) => s + x.spend_usd, 0);
    assert.equal(Number(sum.toFixed(4)), Number(r.month.spend_usd!.toFixed(4)), 'the breakdown does not add up to the month');
  });
}

test('10. the reads bind the alias: no value is interpolated into SQL', () => {
  const src = read('cloudflare-worker/src/services/aiSpend.ts');
  assert.equal((src.match(/u\.surface IN \(\?, \?\)/g) || []).length, 2, 'the month sum and the last run');
  assert.match(src, /\.bind\(\.\.\.scope\.binds, surface, also, mKey\)/);
  assert.match(src, /\.bind\(\.\.\.scope\.binds, surface, also, asAt\)/);
  assert.doesNotMatch(read('cloudflare-worker/src/services/aiRouter.ts'), /AI_SURFACE_ALIASES/, 'the router records the path it is given');
});
