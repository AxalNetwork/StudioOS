/**
 * D899 (#2678, part 5 of #2434) — Eadwyn's card tools on the Pitch deck editor.
 *
 *   POST /api/decks/:id/cards/:card/assist/quote
 *        { project_id, action, block?, text?, tone?, language?, instruction?, source_keys? }
 *        → { action, option, ai: true, hold_microusd, model } | { action, option, ai: false, reason, message }
 *   POST /api/decks/:id/cards/:card/assist
 *        (the same body)
 *        → { proposal, action, option, before?, after?, block?, title?, cost }
 *
 * `:id` is the version the editor opened (`pitch_decks.id`) and `:card` the
 * card's place in it, from 0. The editor sends the text as it stands, saved or
 * not, and the block it sits in.
 *
 * Each press runs through `run()` as one rail option (`ASSIST_OPTIONS`), is
 * charged to the founder who pressed, and leaves one `ai_rail_proposals` row
 * (D780): Accept places it in the editor and Save writes the version (D777
 * §3). Nothing here writes a version.
 *
 * WHAT IS REFUSED BEFORE ANYTHING RUNS, so it costs nothing:
 *   · a press on a figure bound to a record (a block with a binding, or a
 *     metric tile): 422 `never_fill`, "Figures come from your records. Update
 *     [module] to change this one.";
 *   · an instruction that states a figure: 422 `figure_in_prompt`;
 *   · a chart, table or timeline with nothing recorded to show: 422
 *     `nothing_recorded`.
 * AFTER the run, a wording that names a number the founder's text did not is
 * not placed (422 `figure_in_output`, with what the run charged), and a chart
 * shows only the recorded sources the model named, each series a binding.
 *
 * Mounted in index.ts BEFORE `decks`, beside the other `/api/decks/*` routers.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { parseJsonLoose } from '../services/decks/autofill';
import {
  ACTIONS, ASSIST_OPTIONS, ASSIST_PAGE, CHART_ACTIONS, FIGURE_LINE, INSTRUCTION_MAX, LANGUAGES, TEXT_MAX, TONES,
  chartBlock, chartMessage, chartable, textMessage, wordingOf, wordingProblem, type Action, type ChartAction, type TextAction,
} from '../services/decks/assist';
import { figureRefusal } from '../services/decks/newDeck';
import { readSources, sanitizeBinding, type SourceItem } from '../services/decks/sources';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { auditDeckWrite, getDeckRow, projectOwned } from './decks';
import { mercuryFor } from './deck_sources';

const deckAssist = new Hono<{ Bindings: Env }>();

const today = () => new Date().toISOString().slice(0, 10);
const isChart = (a: Action): a is ChartAction => (CHART_ACTIONS as readonly string[]).includes(a);

type Press = {
  action: Action; option: string; deckId: number; card: number; projectId: number; text: string;
  tone?: string; language?: string; instruction?: string; labels?: string[]; items: SourceItem[]; heading: string;
};

/** The press a request asks for, checked, or the response that refuses it. */
async function pressOf(c: any, user: User): Promise<{ press: Press } | { refused: Response }> {
  const body = await c.req.json().catch(() => ({} as any));
  const deckId = Number(c.req.param('id'));
  const card = Number(c.req.param('card'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { refused: c.json({ error: 'deck id required' }, 400) };
  if (!Number.isSafeInteger(card) || card < 0 || card > 59) return { refused: c.json({ error: 'card must be a card of the deck, from 0' }, 400) };
  const action = String(body?.action || '') as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) return { refused: c.json({ error: `action must be one of ${ACTIONS.join(', ')}` }, 400) };

  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  const projectId = Number(row.project_id);
  let project: any;
  try { project = await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  const { items } = await readSources({ env: c.env, projectId, today: today(), mercury: await mercuryFor(c, user, project) });

  // A figure bound to a record is the record's: the block as the editor holds it, or as the version stored it.
  const block = body?.block && typeof body.block === 'object' ? body.block : null;
  const stored = (() => {
    try {
      const slides = JSON.parse(row.slides || '[]');
      const b = Array.isArray(slides?.[card]?.blocks) ? slides[card].blocks.find((x: any) => x?.id === block?.id) : null;
      return b ?? null;
    } catch { return null; }
  })();
  const bound = [block, stored].map((b) => (b ? sanitizeBinding(b.binding) : null)).find(Boolean)
    ?? (block?.kind === 'metric' || stored?.kind === 'metric' ? { source_key: '' } : null);
  if (!isChart(action) && action !== 'headline' && bound) {
    const module = items.find((i) => i.source_key === bound.source_key)?.module ?? null;
    return { refused: c.json({ error: 'never_fill', refusal: 'never_fill', message: FIGURE_LINE(module), source_key: bound.source_key || null, module }, 422) };
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const heading = typeof body?.heading === 'string' ? body.heading.trim().slice(0, 120) : '';
  const press: Press = { action, option: ASSIST_OPTIONS[action], deckId, card, projectId, text, items, heading };
  if (!isChart(action) && action !== 'headline') {
    if (!text) return { refused: c.json({ error: 'text required: select the words to change' }, 400) };
    if (text.length > TEXT_MAX) return { refused: c.json({ error: `the text is at most ${TEXT_MAX} characters` }, 400) };
  }
  if (action === 'tone') {
    if (!(TONES as readonly string[]).includes(body?.tone)) return { refused: c.json({ error: `tone must be one of ${TONES.join(', ')}` }, 400) };
    press.tone = body.tone;
  }
  if (action === 'translate') {
    if (!(LANGUAGES as readonly string[]).includes(body?.language)) return { refused: c.json({ error: `language must be one of ${LANGUAGES.join(', ')}` }, 400) };
    press.language = body.language;
  }
  if (action === 'ask') {
    const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) return { refused: c.json({ error: 'instruction required: say what to change' }, 400) };
    if (instruction.length > INSTRUCTION_MAX) return { refused: c.json({ error: `the instruction is at most ${INSTRUCTION_MAX} characters` }, 400) };
    const fig = figureRefusal(instruction, projectId, 'an instruction');
    if (fig) return { refused: refuse(c, 422, { code: fig.code, message: fig.message, extra: { figure: fig.figure, source_key: fig.source_key, module: fig.module, href: fig.href } }) };
    press.instruction = instruction;
  }
  if (action === 'headline') {
    const keys: string[] = Array.isArray(body?.source_keys) ? body.source_keys.filter((k: unknown): k is string => typeof k === 'string').slice(0, 6) : [];
    const labels = keys.map((k) => items.find((i) => i.source_key === k && i.state === 'recorded')?.label).filter((l): l is string => Boolean(l));
    if (!labels.length) return { refused: refuse(c, 422, { code: 'nothing_recorded', message: 'Choose at least one recorded figure for the card first. Nothing was run.' }) };
    press.labels = labels;
  }
  if (isChart(action) && !chartable(items).length) {
    return { refused: refuse(c, 422, { code: 'nothing_recorded', message: 'Nothing is recorded to chart yet. Record figures in their modules, and the chart reads them from there. Nothing was run.' }) };
  }
  return { press };
}

/** The run one press makes, as one options object, so the quote and the run read the same input. */
function runOptions(c: any, user: User, p: Press): RunOptions {
  const msg = isChart(p.action)
    ? chartMessage(p.action, chartable(p.items), p.heading)
    : textMessage(p.action as TextAction, p.text, { tone: p.tone, language: p.language, instruction: p.instruction, labels: p.labels });
  // The press names its own option: a header can name the page, never another option's price.
  const rail = { ...railFor(c, { page: ASSIST_PAGE, option: p.option }, `deck:${p.deckId}`), option: p.option };
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.raisePitch,
    rail,
    systemPrompt: msg.system,
    messages: [{ role: 'user', content: msg.user }],
    temperature: isChart(p.action) ? 0.2 : 0.5,
    maxTokens: isChart(p.action) ? 300 : Math.min(1600, 120 + Math.ceil(p.text.length / 2)),
  };
}

/** What a run charged, from its usage row; null when it is not known. */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

deckAssist.post('/:id/cards/:card/assist/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const q = await quoteRun(c.env, runOptions(c, user, p));
  if (q.ok) return c.json({ action: p.action, option: p.option, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ action: p.action, option: p.option, ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? 'AI assistance is off on this page. Your records still fill the figures.' : q.error });
});

deckAssist.post('/:id/cards/:card/assist', async (c) => {
  const user = await requireAuth(c);
  const got = await pressOf(c, user);
  if ('refused' in got) return got.refused;
  const p = got.press;
  const userId = Number(user.id) || 0;
  const res = await run(c.env, runOptions(c, user, p));
  if (!res.ok) {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
  }
  const cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };

  let payload: Record<string, unknown>;
  let answer: Record<string, unknown>;
  if (isChart(p.action)) {
    const made = chartBlock(p.action, parseJsonLoose<any>(res.output), p.items);
    if (!made) return refuse(c, 422, { code: 'no_figures_chosen', message: 'Eadwyn named no recorded figure to show, so nothing was placed. It was charged for the run.', extra: { cost } });
    payload = { deck_id: p.deckId, card: p.card, action: p.action, block: made.block, title: made.title };
    answer = { block: made.block, title: made.title };
  } else {
    const after = wordingOf(res.output, p.action === 'headline' ? 120 : TEXT_MAX);
    const problem = wordingProblem(p.action as TextAction, p.text, after);
    if (problem) return refuse(c, 422, { code: 'figure_in_output', message: `${problem} It was charged for the run.`, extra: { cost } });
    payload = { deck_id: p.deckId, card: p.card, action: p.action, before: p.text, after };
    answer = { before: p.text, after };
  }
  let proposal = null;
  try {
    proposal = await proposeRail(c.env, {
      userId, page: ASSIST_PAGE, option: p.option, record: `deck:${p.deckId}`, kind: 'proposal',
      payload, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
    });
  } catch {
    return refuse(c, 503, { code: 'proposal_unsaved', message: 'Eadwyn answered, but the proposal could not be kept. It was charged for the run; try again in a moment.', extra: { cost } });
  }
  await auditDeckWrite(c, user, p.projectId, 'deck_card_assist_proposed', `Card ${p.card + 1}: ${p.action} proposed`);
  return c.json({ proposal, action: p.action, option: p.option, ...answer, cost });
});

export default deckAssist;
