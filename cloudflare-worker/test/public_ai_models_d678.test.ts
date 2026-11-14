/**
 * D678 (#1552) — `GET /api/public/ai-models`, the model registry the public
 * Intelligence page reads.
 *
 *   · one row per task class in the router's `ROUTE`, its label from
 *     `aiCatalog.ts`, its default model, that model's name and provider;
 *   · the rows are read from the router, so changing a default changes the row;
 *   · only the safe fields: no price, no fallback chain, no alternates, no
 *     cache setting reaches a logged-out reader;
 *   · no session needed, and the answer is cacheable for the five minutes
 *     `/stats` keeps;
 *   · the path is on the anonymous-read allowlist, so it never waits on a
 *     role-schema repair.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_ai_models_d678.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import publicRoutes, { publicAiModels } from '../src/routes/public.ts';
import { ROUTE } from '../src/services/aiRouter.ts';
import { TASK_LABELS, MODEL_NAMES } from '../src/services/aiCatalog.ts';

const SAFE = ['feature', 'model', 'name', 'provider'];

test('one row per router task, read from the router and the catalog', () => {
  const rows = publicAiModels();
  // D764: the rail_<kind> tasks have no fixed model, so the public list leaves them out (D761).
  const tasks = Object.keys(ROUTE).filter((t) => !t.startsWith('rail_'));
  assert.equal(rows.length, tasks.length, 'every task the router runs has a row');
  tasks.forEach((task, i) => {
    const entry = ROUTE[task as keyof typeof ROUTE];
    assert.deepEqual(rows[i], {
      feature: TASK_LABELS[task as keyof typeof TASK_LABELS],
      model: entry.model,
      name: MODEL_NAMES[entry.model] ?? entry.model,
      provider: entry.provider,
    });
  });
  assert.ok(rows.some((r) => r.feature === 'Safety check' && /llama-guard/.test(r.model)), 'the guard is listed as what it is');
});

test('a changed default changes the row: nothing is copied', () => {
  const was = ROUTE.explain.model;
  try {
    (ROUTE.explain as { model: string }).model = '@cf/test/swapped-model';
    const row = publicAiModels().find((r) => r.feature === TASK_LABELS.explain);
    assert.equal(row?.model, '@cf/test/swapped-model');
    assert.equal(row?.name, '@cf/test/swapped-model', 'a model with no catalog name shows its id, not a guessed name');
  } finally {
    (ROUTE.explain as { model: string }).model = was;
  }
});

test('GET /ai-models answers without a session, with the safe fields only, cacheable', async () => {
  const res = await publicRoutes.request('/ai-models', {}, {} as never);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /^public, max-age=300, s-maxage=300$/);
  const body = await res.json() as { ok: boolean; models: Record<string, unknown>[] };
  assert.equal(body.ok, true);
  assert.equal(body.models.length, Object.keys(ROUTE).filter((t) => !t.startsWith('rail_')).length);
  assert.ok(!body.models.some((r) => /rail_/.test(String(r.feature))), 'no rail_<kind> task reaches the public list');
  for (const row of body.models) {
    assert.deepEqual(Object.keys(row).sort(), [...SAFE].sort(), 'no price, chain, alternates or cache field leaks');
  }
  const text = JSON.stringify(body);
  for (const leak of ['fallback', 'alternates', 'cacheTtl', 'price', 'in_per_1m', 'usd']) {
    assert.ok(!text.includes(leak), `${leak} must not reach a logged-out reader`);
  }
});

test('the path is an anonymous read that skips the role-schema repair', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const list = index.slice(index.indexOf('const ROLE_SCHEMA_SAFE_ANONYMOUS_READS'), index.indexOf('function requiresBlockingRoleSchemaBootstrap'));
  assert.ok(list.includes("'/api/public/ai-models'"));
});
