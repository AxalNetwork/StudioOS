/**
 * /api/ai — what the AI gateway is doing on the caller's behalf.
 *
 * The gateway itself is `services/aiRouter.ts` and predates this file by a
 * long way. What did not exist was any way for the person spending the money
 * to see it: the only rollup over `ai_usage_logs` is `/api/monitoring/ai-usage`
 * behind `requireAdmin`, so the AI rail's spend meter had to be fed by props.
 *
 * Self-scoped throughout: nothing here reads another account's usage — the org
 * view already exists and is admin-gated (see `aiUsageSelfScope`) — and nothing
 * here can change a cap.
 *
 * It was read-only until `POST /workspace/explain`, and that endpoint is why
 * the workspace rail is allowed to name a model at all. The rule the rail's
 * guards encode is that a surface may quote a model and a price only if it
 * really runs that task; the four registered surfaces earned their card by
 * having a call site, and until this route existed no workspace did. The
 * registration follows the call, never the other way round.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { loadMyAiSpend } from '../services/aiSpend';
import { ROUTE, PRICE_USD_PER_1M_TOKENS, run as aiRun } from '../services/aiRouter';
import { classifyInput } from '../services/advisor/guardrails';

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

/**
 * What the model is told it is for. Written as a boundary rather than a
 * persona, because everything it is stopped from doing is something the
 * product has been caught doing before.
 *
 * The one rule that matters: it is shown ONLY the lines the rail is already
 * displaying, and it may not go beyond them. A page whose coverage says "3
 * quotes out, 1 decided" cannot support a sentence about win rate, and a model
 * that writes one anyway has produced the same fabricated fact that
 * `NotRecorded`, `Unrecorded` and `ZoneBody` exist across this codebase to
 * prevent — with a currency symbol in front of it and a model's authority
 * behind it.
 */
const WORKSPACE_EXPLAIN_PROMPT = [
  'You read back what a workspace page is currently showing, for the person looking at it.',
  '',
  'You are given the page name and the exact summary lines the page has already',
  'rendered. Those lines are everything you know.',
  '',
  'Rules:',
  '- Never state a fact that is not in the lines you were given. Do not estimate,',
  '  extrapolate, or fill a gap from general knowledge about businesses.',
  '- If the lines do not support a conclusion, say which line is missing instead',
  '  of reaching one anyway. "Nothing here records X" is a useful answer.',
  '- No advice about raising money, investing, taxes, or legal structure.',
  '- Plain sentences. No headings, no bullet lists, no markdown.',
  '- At most four sentences.',
  '',
  'You are drafting a note the person will read and may keep. You are not acting',
  'for them and nothing you write is sent, saved or shared by you.',
].join('\n');

/**
 * POST /api/ai/workspace/explain — read back one workspace zone.
 *
 * Body: { workspace, zone?, coverage: string[] }
 *
 * `coverage` is the SAME array the rail already renders under its Coverage
 * block — counts and labels the page has fetched, e.g. "12 accessible
 * positions". Deliberately not the rows themselves: the rail's coverage lines
 * are already the page's own summary of itself, they carry no personal data,
 * and sending the underlying records would put a client's name into a prompt
 * to satisfy a feature nobody asked for that of.
 */
ai.post('/workspace/explain', async (c) => {
  const user = await requireAuth(c);

  const body = await c.req.json<{ workspace?: string; zone?: string; coverage?: unknown }>()
    .catch(() => null);
  const workspace = String(body?.workspace || '').trim().slice(0, 60);
  const zone = String(body?.zone || '').trim().slice(0, 60);
  const coverage = (Array.isArray(body?.coverage) ? body!.coverage : [])
    .slice(0, 12)
    .map((line) => String(line).trim().slice(0, 200))
    .filter(Boolean);

  if (!workspace) return c.json({ error: 'workspace is required' }, 400);
  // A page with nothing on it has nothing to read back, and an "explanation"
  // of an empty page is precisely the invented content this endpoint's prompt
  // spends its length forbidding.
  if (coverage.length === 0) {
    return c.json({
      error: 'nothing_to_read',
      message: 'This page has not loaded anything to summarise yet.',
    }, 400);
  }

  const subject = zone ? `${workspace} · ${zone}` : workspace;
  const facts = coverage.map((l) => `- ${l}`).join('\n');

  // The same input classifier the advisor surface runs. These lines are
  // generated by our own pages, so a block here is unlikely — which is the
  // reason to keep it rather than to drop it: the day a page starts echoing
  // user-entered text into a coverage line, this is what stands between that
  // text and the model.
  const safety = await classifyInput(c.env, user.id, facts);
  if (safety.blocked) {
    return c.json({
      error: 'safety_block',
      message: 'That page summary could not be sent for review.',
      category: safety.category,
    }, 422);
  }

  const r = await aiRun(c.env, {
    task: 'workspace_explain',
    userId: user.id,
    systemPrompt: WORKSPACE_EXPLAIN_PROMPT,
    messages: [{ role: 'user', content: `Page: ${subject}\n\nWhat the page is showing:\n${facts}` }],
    maxTokens: 320,
    temperature: 0.2,
  });

  // `run` never throws — it returns a refusal with a usage row instead — so a
  // budget stop and a model outage both arrive here rather than as a 500, and
  // both keep their reason.
  if (!r.ok) {
    return c.json({
      ok: false,
      refusal: r.refusal ?? null,
      message: r.refusal === 'budget_user_month' || r.refusal === 'budget_user_day'
        ? 'This month\u2019s AI budget is spent. Nothing was run.'
        : 'The model could not be reached. Nothing was run, and nothing was charged.',
      usage: { model: r.usage.model, est_cost_usd: 0 },
    }, 503);
  }

  return c.json({
    ok: true,
    text: r.output || '',
    usage: {
      model: r.usage.model,
      est_cost_usd: r.usage.est_cost_usd,
      cached: r.usage.cached,
      fallback_used: r.usage.fallback_used,
    },
  });
});

export default ai;
