/**
 * /api/ai — what the AI gateway is doing on the caller's behalf.
 *
 * The gateway itself is `services/aiRouter.ts` and predates this file by a
 * long way. What did not exist was any way for the person spending the money
 * to see it: the only rollup over `ai_usage_logs` is `/api/monitoring/ai-usage`
 * behind `requireAdmin`, so the AI rail's spend meter had to be fed by props.
 *
 * Deliberately read-only and self-scoped. Nothing here can change a cap, and
 * nothing here reads another account's usage — the org view already exists and
 * is admin-gated. See `aiUsageSelfScope`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { loadMyAiSpend } from '../services/aiSpend';
import { ROUTE, PRICE_USD_PER_1M_TOKENS } from '../services/aiRouter';

const ai = new Hono<{ Bindings: Env }>();

// GET /api/ai/me/spend — the caller's own month-to-date and today figures,
// the caps the router enforces, and their last run.
ai.get('/me/spend', async (c) => {
  const user = await requireAuth(c);
  const report = await loadMyAiSpend(c.env, user as any, new Date());
  return c.json({ ok: true, ...report });
});

/**
 * GET /api/ai/pricing — the routing table and the price list, as the router
 * actually holds them.
 *
 * The rail quotes a cost before a run and shows a receipt after it, and
 * `assistCost.js` says in its own header that the two must come from one
 * calculation because "two functions drifting apart is exactly how a user is
 * quoted one price and shown another". The same argument applies one level up:
 * the calculation is shared, but the PRICES were not. The canvases carry
 * hand-written per-1M figures, and nothing tied them to
 * `PRICE_USD_PER_1M_TOKENS`, which is what the receipt is computed from.
 *
 * So the estimate is quoted at whatever the frontend was last told, and the
 * receipt at what the router actually charges. This endpoint removes the
 * second copy: the frontend derives its prices from the same table.
 *
 * Neither the routes nor the prices are secret — Workers AI pricing is
 * published, and the routing table says which open model handles which task.
 * It still requires auth, because it describes internal wiring and there is no
 * reason to serve it anonymously.
 *
 * Static per deploy, so it is cacheable; the router's own price comment says
 * the figures only have to be stable, not perfect.
 */
ai.get('/pricing', async (c) => {
  await requireAuth(c);
  const routes: Record<string, { model: string; fallback_chain: string[] }> = {};
  for (const [task, entry] of Object.entries(ROUTE)) {
    routes[task] = { model: entry.model, fallback_chain: entry.fallbackChain ?? [] };
  }
  return c.json({
    ok: true,
    // Per 1M tokens, USD — the unit every model price list and every canvas
    // states, so no conversion happens at the boundary.
    unit: 'usd_per_1m_tokens',
    prices: PRICE_USD_PER_1M_TOKENS,
    routes,
  });
});

export default ai;
