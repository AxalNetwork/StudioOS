/**
 * #4573 (Performance P1) — deterministic D1 statement budgets for
 * representative API flows, measured through the whole Worker
 * (`_perf_harness.ts`: every middleware, the migrated schema, synthetic
 * accounts). No network and no model calls; nothing here is timing-based, so
 * it cannot flake.
 *
 * Each budget is the count measured at the baseline commit (the report in
 * documentation/audits/PERFORMANCE_BASELINE_2026-11-06.md), split into `auth` (resolving the
 * caller), `telemetry` (the observability middleware's writes) and `route`.
 * A change that adds a statement to a flow fails here and has to say why; a
 * change that removes some lowers the budget in the same PR, so the gain is
 * kept. Authorization outcomes are pinned beside the counts, so a cheaper
 * flow can never be a flow that stopped checking access.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/perf_budgets_4573.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AUTH_SQL, FLOWS, categoryOf, harness, repeats } from './_perf_harness.ts';

/** flow → [status, auth, telemetry, route]. Auth is 4 from H1 on (it was 7, and 13 on /api/funds, at the baseline). */
export const BUDGETS: Record<string, [number, number, number, number]> = {
  health: [200, 0, 0, 0],
  'auth.me': [200, 4, 2, 3],
  'projects.list': [200, 4, 2, 2],
  'projects.read': [200, 4, 2, 3],
  dashboard: [200, 4, 2, 0],
  notifications: [200, 4, 2, 1],
  search: [200, 4, 2, 0],
  'decks.by_project': [200, 4, 2, 4],
  'data_room.shared': [200, 4, 2, 1],
  'research.overview': [200, 4, 2, 21],
  'funds.list': [200, 4, 2, 2],
  'projects.read.other_tenant': [403, 4, 2, 2],
};

let h: Awaited<ReturnType<typeof harness>>;
before(async () => { h = await harness(); });
after(() => h?.close());

test('every flow has a budget, and every budget a flow', () => {
  assert.deepEqual(Object.keys(BUDGETS).sort(), FLOWS.map((f) => f.name).sort());
});

test('each flow answers as before and stays within its D1 statement budget, by category', async () => {
  // Mutation checked: an extra `SELECT 1` in getCurrentUser → every authenticated flow's auth count fails;
  // the observability middleware's activity_logs write duplicated → every telemetry count fails;
  // the project read's ownership check removed → projects.read.other_tenant answers 200 and fails.
  for (const flow of FLOWS) {
    await h.request(flow); // the first request creates lazily-made tables and fills caches
    const r = await h.request(flow);
    const [status, auth, telemetry, route] = BUDGETS[flow.name];
    assert.equal(r.status, status, `${flow.name}: status`);
    assert.ok(r.auth <= auth, `${flow.name}: ${r.auth} auth statements, budget ${auth}`);
    assert.ok(r.telemetry <= telemetry, `${flow.name}: ${r.telemetry} telemetry statements, budget ${telemetry}`);
    assert.ok(r.route <= route, `${flow.name}: ${r.route} route statements, budget ${route}\n${r.statements.filter((s) => categoryOf(s) === 'route').join('\n')}`);
  }
});

test('the counts are deterministic: the same request twice runs the same statements', async () => {
  for (const flow of FLOWS) {
    const a = await h.request(flow);
    const b = await h.request(flow);
    assert.deepEqual(a.statements, b.statements, flow.name);
  }
});

test('H1: every authenticated flow resolves its caller once', async () => {
  // Mutation checked: the memo in getCurrentUser removed → the caller's reads repeat and this fails.
  // Before H1 the user row was read twice per signed-in request, and four times on /api/funds.
  for (const flow of FLOWS.filter((f) => f.who)) {
    const r = await h.request(flow);
    const callerRepeats = repeats(r.statements).filter((x) => AUTH_SQL.includes(x.sql));
    assert.deepEqual(callerRepeats, [], `${flow.name} resolves its caller more than once`);
  }
});
