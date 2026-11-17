/** D6397 (#6397): HQ-only, audited, no-model Fund Admin prompt reads. */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireFundAdminReader, fundAdminAccess } from '../services/fundAdminAccess';
import { FUND_ADMIN_PROMPTS, fundAdminAnswer, type FundAdminPrompt, type FundAdminAnswerFacts } from '../services/ai/fundAdminAnswers';
import { fundAdminOverview } from '../services/fundAdminOverview';
import { readFundCalls } from '../services/fundCallLedger';
import { Funds } from '../models/funds';
const router = new Hono<{ Bindings: Env }>();
router.get('/', async c => {
  const user = await requireFundAdminReader(c);
  const prompt = c.req.query('prompt');
  if (!prompt || !Object.hasOwn(FUND_ADMIN_PROMPTS, prompt)) return c.json({ error: 'bad_prompt' }, 400);
  const raw = c.req.query('fund');
  if (raw !== undefined && (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) return c.json({ error: 'bad_fund' }, 400);
  const today = new Date().toISOString().slice(0, 10);
  const access = await fundAdminAccess(c);
  const facts: FundAdminAnswerFacts = { overview: await fundAdminOverview(c.env, user, today), ledgers: {}, funds: {} };
  const selected = facts.overview?.funds.state === 'ok' ? facts.overview.funds.items.filter(fund => raw === undefined || fund.fund_id === Number(raw)) : [];
  if (prompt === 'explain:fund-outstanding' || (prompt === 'identify:fund-overdue-lps' && selected.length === 1)) {
    for (const fund of selected) {
      try { facts.ledgers[fund.fund_id] = await readFundCalls(c.env, fund.fund_id, today); }
      catch { facts.ledgers[fund.fund_id] = 'unreadable'; }
    }
  }
  if (prompt === 'identify:fund-incomplete-setup' && selected.length === 1) {
    const id = selected[0].fund_id;
    try { facts.funds[id] = await Funds.getById(c.env, id); }
    catch { facts.funds[id] = 'unreadable'; }
  }
  const answer = fundAdminAnswer(facts, prompt as FundAdminPrompt, raw === undefined ? null : Number(raw), access);
  if (!answer) return c.json({ error: 'fund_not_administered' }, 404);
  return c.json(answer, answer.state === 'unreadable' ? 503 : 200);
});
export const mount: RouteMount = { path: '/api/fund-admin/ask', router: router };
export default router;
