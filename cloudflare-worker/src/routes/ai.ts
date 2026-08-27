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

const ai = new Hono<{ Bindings: Env }>();

// GET /api/ai/me/spend — the caller's own month-to-date and today figures,
// the caps the router enforces, and their last run.
ai.get('/me/spend', async (c) => {
  const user = await requireAuth(c);
  const report = await loadMyAiSpend(c.env, user as any, new Date());
  return c.json({ ok: true, ...report });
});

export default ai;
