/**
 * D1409 (#3695, part 1) — Eadwyn's writing options in the article editor.
 *
 *   POST /api/articles/:id/assist/quote   { option, input }
 *        → { option, ai: true, hold_microusd, model } | { option, ai: false, reason, message }
 *   POST /api/articles/:id/assist         (the same body)
 *        → { proposal, option, cost: { charged_microusd | null, usage_log_id } }
 *
 * `option` is one of `ARTICLE_OPTION_KEYS` (services/articleAssist.ts). Each
 * press runs once through `run()` as that rail option on "<Profile> · Articles",
 * is charged to the member who pressed, and leaves one `ai_rail_proposals` row.
 * Nothing here writes the article: Insert, Replace and Accept go through
 * `POST /api/ai/rail/proposals/:uid/decide`, and the editor's `PUT
 * /api/articles/:id` saves.
 *
 * THE GATE, in order: signed in; the article's author or an admin
 * (`loadOwned`, else 404 `not_found_or_forbidden`); not published (409
 * `already_published`); not a support session (403 `support_session_refused`).
 * A run's refusals answer as every rail press does (`refuseRun`): 402 for a
 * budget stop, 403 for the switch or a pause, 422 for the guard.
 *
 * Logs carry codes only: never a brief, the article or a model's answer.
 *
 * Mounted in index.ts BEFORE `articles`, at `/api/articles`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { ensureNewsSchema } from '../services/newsSchema';
import {
  ARTICLE_OPTIONS, ARTICLE_OPTION_KEYS, articlePage, articleRecord, guardTextOf, inputOf, isArticleOption, messageOf, payloadOf,
  type ArticleInput, type ArticleOption,
} from '../services/articleAssist';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { loadOwned } from './articles';

const articleAssist = new Hono<{ Bindings: Env }>();

type Press = { id: number; article: any; option: ArticleOption; input: ArticleInput };

/** The article a press may run on, or the response that refuses it. */
export async function gateArticle(c: any, user: User): Promise<{ id: number; article: any } | { refused: Response }> {
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return { refused: c.json({ error: 'not_found_or_forbidden' }, 404) };
  const article = await loadOwned(c.env, id, Number(user.id), String(user.role));
  if (!article) return { refused: c.json({ error: 'not_found_or_forbidden' }, 404) };
  if (article.status === 'published') return { refused: c.json({ error: 'already_published' }, 409) };
  if ((await selectJwt(c))?.payload?.impersonated_by) {
    return { refused: refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot run Eadwyn on a member’s article.' }) };
  }
  return { id, article };
}

async function pressOf(c: any, user: User): Promise<{ press: Press } | { refused: Response }> {
  const gate = await gateArticle(c, user);
  if ('refused' in gate) return gate;
  const body = await c.req.json().catch(() => ({} as any));
  const option = body?.option;
  if (!isArticleOption(option)) {
    return { refused: refuse(c, 400, { code: 'unknown_option', message: `option must be one of ${ARTICLE_OPTION_KEYS.join(', ')}` }) };
  }
  const got = inputOf(option, body?.input);
  if ('field' in got) return { refused: refuse(c, 400, { code: 'invalid_input', message: got.error, extra: { field: got.field } }) };
  return { press: { id: gate.id, article: gate.article, option, input: got.input } };
}

/** The run one press makes, so the quote and the run read the same input. */
function runOptions(c: any, user: User, p: Press): RunOptions {
  const msg = messageOf(p.option, p.article, p.input);
  // The press names its own option: a header can name the page, never another option's price.
  const rail = { ...railFor(c, { page: articlePage(user.role), option: p.option }, articleRecord(p.id)), option: p.option };
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.articles,
    rail,
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    guardText: guardTextOf(p.input),
    temperature: p.option === 'check:article-facts' || p.option === 'draft:article-seo' ? 0.2 : 0.6,
    maxTokens: ARTICLE_OPTIONS[p.option].maxTokens,
  };
}

/** What a run charged, from its usage row; null when it is not known. */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

articleAssist.post('/:id/assist/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const q = await quoteRun(c.env, runOptions(c, user, p));
  if (q.ok) return c.json({ option: p.option, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ option: p.option, ai: false, reason: q.refusal, message: q.error });
});

articleAssist.post('/:id/assist', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const userId = Number(user.id) || 0;
  const opts = runOptions(c, user, p);
  const res = await run(c.env, { ...opts, surface: AI_SURFACE.articles, rail: opts.rail });
  if (!res.ok) {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
  }
  const cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };
  const payload = payloadOf(p.option, res.output, p.input);
  if (!payload) return refuse(c, 422, { code: 'nothing_proposed', message: 'Eadwyn’s answer had nothing to place, so nothing was proposed. It was charged for the run.', extra: { cost } });
  let proposal = null;
  try {
    proposal = await proposeRail(c.env, {
      userId, page: opts.rail!.page, option: p.option, record: articleRecord(p.id), kind: ARTICLE_OPTIONS[p.option].kind,
      payload, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
    });
  } catch {
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'Eadwyn answered, but the proposal could not be kept. It was charged for the run; try again in a moment.', extra: { cost } });
  }
  return c.json({ proposal, option: p.option, cost });
});

export default articleAssist;
