/**
 * D897 (#2677, part 3 of #2434) — New deck: audience and round, an outline
 * Eadwyn proposes, then a deck the founder keeps card by card.
 *
 *   GET  /api/decks/new/context?project_id=<id>
 *        → { project_id, audiences, lengths, cards, round, averages, fast_path }
 *   POST /api/decks/new/quote      { project_id, step: outline|build, audience, length, prompt?, outline?, exclude? }
 *        → { step, ai: true, hold_microusd, model } | { step, ai: false, reason, message }
 *   POST /api/decks/outline        { project_id, audience, round_ref?, length, prompt?, start? }
 *        → { proposal, outline: { rows, proposed_by, reason? }, cost }
 *   POST /api/decks/generate       { project_id, proposal_id?, audience?, round_ref?, length?, prompt?, outline?, exclude? }
 *        → { proposal, progress, wording, cost }
 *   POST /api/decks/proposals/:id/keep-slides   { indexes?: number[], all?: true, save?: true }
 *        → { proposal } | { deck }
 *
 * Mounted in index.ts BEFORE `decks`: `GET /api/decks/:id` would otherwise
 * answer `/new/context` (Hono matches in registration order; #2434's worker
 * map §0.1).
 *
 * NOTHING IS A VERSION UNTIL IT IS KEPT. The outline and the built cards are
 * one `pitch_deck_proposals` row (migration 542), replacing the venture's
 * earlier unkept proposal as every fill does (D767). Keep writes a version of
 * the kept cards only, through `insertVersion`, for the outline's audience and
 * round. Every write here logs one `raise.pitch-deck` cycle row, never a figure.
 *
 * WHAT A RUN WRITES. Words only (`services/decks/newDeck.ts`): the outline run
 * (`deck:outline`) picks cards from the catalogue, and the build run
 * (`deck:build`) writes a headline and a sentence per card. Code fills every
 * figure from `readSources`. A prompt or outline row that names a number is
 * refused 422 `figure_in_prompt` before any run, so it costs nothing.
 *
 * COST. `quote` answers what the run would hold now (`quoteRun`, the hold's own
 * arithmetic), so Build deck and Regenerate show their price first; each
 * answer then carries what its run charged, from its usage row. AI off on the
 * page is not a stop: the outline is StudioOS's standard one and the cards are
 * figures only, at no cost. A budget, a pause or the guard refuses as `run()`
 * does everywhere (`refuseRun`); a model that could not answer leaves the
 * figures-only path, and says so.
 *
 * WHO. The deck routes' `projectOwned`: the venture's founders write, an admin
 * reads only (D895), and New deck is on the Raise + Grow plan as /generate was.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureTier } from '../middleware/requireTier';
import { quoteRun, railOptionKey, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { parseJsonLoose } from '../services/decks/autofill';
import { readSources, type SourceItem } from '../services/decks/sources';
import { AUDIENCES } from '../services/decks/slideModel';
import {
  AUDIENCE_CARDS, BUILD_SYSTEM, CARD_CATALOGUE, FAST_PATH_AUDIENCE, LENGTHS, LENGTH_IDS, OUTLINE_SYSTEM, PROMPT_MAX,
  buildCards, buildMessage, cardProgress, excludedOf, figureRefusal, keptIndexes, outlineFromBody, outlineFromModel, outlineMessage,
  standardOutline, wordingFromModel, type Audience, type FigureRefusal, type Length, type OutlineRow, type Wording,
} from '../services/decks/newDeck';
import { proposeRail } from '../services/railProposals';
import { railFor, refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import {
  auditDeckWrite, ensureSchema, getDeckRow, insertVersion, ownedProposal, projectOwned, rowToDeck, rowToProposal,
  sanitizeSlides, themeOfRow,
} from './decks';
import { mercuryFor } from './deck_sources';

const deckNew = new Hono<{ Bindings: Env }>();

export const NEW_DECK_RAIL = { page: 'Founder · Raise · Pitch deck', outline: 'deck:outline', build: 'deck:build' } as const;

const today = () => new Date().toISOString().slice(0, 10);

/** The deck routes' `projectOwned`, with its refusals as they answer them. */
async function venture(c: any, user: User, projectId: number, write: boolean) {
  try {
    return { project: await projectOwned(c, user, projectId, { write }) };
  } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
}

/** The plan gate New deck shares with the old /generate; its 402 is the plan's own body. */
function planRefusal(user: User): Response | null {
  try { ensureTier(user, 'studio'); return null; } catch (e) { if (e instanceof Response) return e; throw e; }
}

/** A figure stated where only records may state one: 422, with the module that records it. */
function refuseFigure(c: any, r: FigureRefusal): Response {
  return refuse(c, 422, { code: r.code, message: r.message, extra: { figure: r.figure, source_key: r.source_key, module: r.module, href: r.href } });
}

/** The venture's name, for the deck's title and its Title card; null when it has none. */
async function ventureName(env: Env, projectId: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first<any>().catch(() => null);
  return typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : null;
}

const projectIdOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

type Inputs = { audience: Audience; length: Length; prompt: string; round_ref: string | null };

/** The audience, length, prompt and round a request asks for, checked; a string says what is wrong. */
async function inputsOf(env: Env, projectId: number, body: any, base: Partial<Inputs> = {}): Promise<Inputs | string> {
  const has = (k: string) => body && Object.prototype.hasOwnProperty.call(body, k);
  const audience = has('audience') ? body.audience : base.audience;
  if (!(AUDIENCES as readonly string[]).includes(audience)) return `audience must be one of ${AUDIENCES.join(', ')}`;
  const length = has('length') ? body.length : base.length ?? 'standard';
  if (!LENGTH_IDS.includes(length)) return `length must be one of ${LENGTH_IDS.join(', ')}`;
  const prompt = has('prompt') ? body.prompt ?? '' : base.prompt ?? '';
  if (typeof prompt !== 'string') return 'prompt must be text';
  if (prompt.length > PROMPT_MAX) return `the prompt is at most ${PROMPT_MAX} characters`;
  const round_ref = has('round_ref') ? body.round_ref ?? null : base.round_ref ?? null;
  if (round_ref != null) {
    if (typeof round_ref !== 'string' || round_ref.length > 64) return 'round_ref must be a round of this venture';
    const r = await env.DB.prepare('SELECT 1 AS ok FROM raise_rounds WHERE uid = ? AND project_id = ?').bind(round_ref, projectId).first<any>().catch(() => null);
    if (!r) return 'round_ref must be a round of this venture';
  }
  return { audience, length, prompt: prompt.trim(), round_ref };
}

async function sourcesFor(c: any, user: User, project: any, projectId: number): Promise<SourceItem[]> {
  const { items } = await readSources({ env: c.env, projectId, today: today(), mercury: await mercuryFor(c, user, project) });
  return items;
}

/** The run each press makes, as one options object, so the quote and the run read the same input. */
function runOptions(c: any, user: User, projectId: number, step: 'outline' | 'build', message: string, rows = 0): RunOptions {
  return {
    task: 'rail_write',
    userId: Number(user.id) || 0,
    surface: AI_SURFACE.raisePitch,
    rail: railFor(c, { page: NEW_DECK_RAIL.page, option: step === 'outline' ? NEW_DECK_RAIL.outline : NEW_DECK_RAIL.build }, `project:${projectId}`),
    systemPrompt: step === 'outline' ? OUTLINE_SYSTEM : BUILD_SYSTEM,
    messages: [{ role: 'user', content: message }],
    temperature: 0.4,
    maxTokens: step === 'outline' ? 900 : Math.min(2400, 200 + rows * 110),
  };
}

/** What a run charged, from its usage row; null when it is not known (no row, or a hold waiting for review). */
async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

/** The member's own average charge for one option over their charged runs, or null when they have none. */
async function averageOf(env: Env, userId: number, option: string): Promise<{ runs: number; average_microusd: number } | null> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS runs, AVG(charged_microusd) AS avg FROM ai_usage_logs
      WHERE user_id = ? AND rail_option = ? AND refusal IS NULL AND charged_microusd > 0`,
  ).bind(userId, railOptionKey(option)).first<any>().catch(() => null);
  const runs = Number(row?.runs || 0);
  return runs > 0 ? { runs, average_microusd: Math.round(Number(row.avg)) } : null;
}

/** The venture's active round and its latest call, for PD3; null when none is active. */
async function activeRound(env: Env, projectId: number) {
  const r = await env.DB.prepare(
    "SELECT uid, name, target_amount, close_date FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
  ).bind(projectId).first<any>().catch(() => null);
  if (!r) return null;
  const call = await env.DB.prepare(
    `SELECT instrument,
            (counsel_approved_hash IS NOT NULL AND counsel_approved_hash = terms_hash AND counsel_approved_by IS NOT NULL
             AND counsel_approved_at IS NOT NULL AND counsel_approval_reference IS NOT NULL) AS approved
       FROM round_calls WHERE project_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(projectId).first<any>().catch(() => null);
  const target = r.target_amount == null || !Number.isFinite(Number(r.target_amount)) || Number(r.target_amount) <= 0 ? null : Number(r.target_amount);
  return {
    uid: String(r.uid), name: r.name ?? null, target_amount: target, close_date: r.close_date ?? null,
    instrument: call?.instrument ?? null, reviewed: Number(call?.approved) === 1,
  };
}

deckNew.get('/new/context', async (c) => {
  const user = await requireAuth(c);
  const projectId = projectIdOf(c.req.query('project_id'));
  if (!projectId) return c.json({ error: 'project_id required' }, 400);
  const got = await venture(c, user, projectId, false);
  if ('refused' in got) return got.refused;
  const userId = Number(user.id) || 0;
  return c.json({
    project_id: projectId,
    audiences: AUDIENCES.map((id) => ({ id, ...AUDIENCE_CARDS[id] })),
    lengths: LENGTHS,
    cards: CARD_CATALOGUE.map(({ card, title, purpose, sources, appendix }) => ({ card, title, purpose, sources, appendix: Boolean(appendix) })),
    standard: Object.fromEntries(LENGTH_IDS.map((l) => [l, standardOutline(l as Length)])),
    round: await activeRound(c.env, projectId),
    averages: { outline: await averageOf(c.env, userId, NEW_DECK_RAIL.outline), build: await averageOf(c.env, userId, NEW_DECK_RAIL.build) },
    fast_path: { audience: FAST_PATH_AUDIENCE, length: 'standard' },
    prompt_max: PROMPT_MAX,
  });
});

/** The outline rows a build uses: the request's, else the proposal's, else the length's standard deck. */
function rowsFor(body: any, outline: any, length: Length, projectId: number): { rows: OutlineRow[] } | { response: { error: string; refusal?: any } } {
  if (body && Object.prototype.hasOwnProperty.call(body, 'outline')) {
    const got = outlineFromBody(body.outline, projectId);
    return 'rows' in got ? got : { response: got };
  }
  if (Array.isArray(outline?.rows) && outline.rows.length) {
    const got = outlineFromBody(outline.rows, projectId);
    if ('rows' in got) return got;
  }
  return { rows: standardOutline(length) };
}

deckNew.post('/new/quote', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return c.json({ error: 'project_id required' }, 400);
  const step = body?.step === 'outline' ? 'outline' : body?.step === 'build' ? 'build' : null;
  if (!step) return c.json({ error: 'step must be outline or build' }, 400);
  const got = await venture(c, user, projectId, true);
  if ('refused' in got) return got.refused;
  const inputs = await inputsOf(c.env, projectId, body);
  if (typeof inputs === 'string') return c.json({ error: inputs }, 400);
  const refused = figureRefusal(inputs.prompt, projectId);
  if (refused) return refuseFigure(c, refused);
  const items = await sourcesFor(c, user, got.project, projectId);
  let opts: RunOptions;
  if (step === 'outline') {
    opts = runOptions(c, user, projectId, 'outline', outlineMessage({ ...inputs, items }));
  } else {
    const picked = rowsFor(body, null, inputs.length, projectId);
    if ('response' in picked) return picked.response.refusal ? refuseFigure(c, picked.response.refusal) : c.json({ error: picked.response.error }, 400);
    const excluded = excludedOf(body?.exclude ?? null);
    if (typeof excluded === 'string') return c.json({ error: excluded }, 400);
    opts = runOptions(c, user, projectId, 'build', buildMessage({ ...inputs, rows: picked.rows, items, ventureName: await ventureName(c.env, projectId), exclude: new Set(excluded) }), picked.rows.length);
  }
  const q = await quoteRun(c.env, opts);
  if (q.ok) return c.json({ step, ai: true, hold_microusd: q.hold_microusd, model: q.model });
  return c.json({ step, ai: false, reason: q.refusal, message: q.error });
});

/** Replaces the venture's unkept proposal with this one (D767: one per venture); returns its id. */
async function writeProposal(env: Env, projectId: number, baseDeckId: number, title: string, slides: any[], outline: any, userId: number): Promise<number> {
  const res = await env.DB.batch([
    env.DB.prepare('DELETE FROM pitch_deck_proposals WHERE project_id = ?').bind(projectId),
    env.DB.prepare(
      `INSERT INTO pitch_deck_proposals (project_id, base_deck_id, slides, title, method_id, created_by, outline_json, kept_slides_json)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL)`,
    ).bind(projectId, baseDeckId, JSON.stringify(slides), title, userId || null, JSON.stringify(outline)),
  ]);
  return Number((res[1] as any)?.meta?.last_row_id || 0);
}

async function proposalRow(env: Env, id: number) {
  return env.DB.prepare('SELECT * FROM pitch_deck_proposals WHERE id = ?').bind(id).first<any>();
}

/** The version a New deck sits beside: the one it starts from, else the current one, else none (0). */
async function baseDeckId(env: Env, projectId: number, start: any): Promise<number | string> {
  if (start?.kind === 'version') {
    const id = projectIdOf(start.deck_id);
    const row = id ? await env.DB.prepare('SELECT id FROM pitch_decks WHERE id = ? AND project_id = ?').bind(id, projectId).first<any>() : null;
    if (!row) return 'start.deck_id must be a version of this venture';
    return Number(row.id);
  }
  if (start != null && start?.kind !== 'blank') return 'start.kind must be blank or version; a template starts from POST /api/decks/apply-method';
  const cur = await env.DB.prepare('SELECT id FROM pitch_decks WHERE project_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').bind(projectId).first<any>();
  return Number(cur?.id) || 0;
}

deckNew.post('/outline', async (c) => {
  const user = await requireAuth(c);
  const plan = planRefusal(user);
  if (plan) return plan;
  const body = await c.req.json().catch(() => ({} as any));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return c.json({ error: 'project_id required' }, 400);
  const got = await venture(c, user, projectId, true);
  if ('refused' in got) return got.refused;
  await ensureSchema(c.env);
  const inputs = await inputsOf(c.env, projectId, body);
  if (typeof inputs === 'string') return c.json({ error: inputs }, 400);
  // A prompt that states a figure is refused before anything runs: it costs nothing.
  const refused = figureRefusal(inputs.prompt, projectId);
  if (refused) return refuseFigure(c, refused);
  const base = await baseDeckId(c.env, projectId, body?.start ?? null);
  if (typeof base === 'string') return c.json({ error: base }, 400);

  const items = await sourcesFor(c, user, got.project, projectId);
  const userId = Number(user.id) || 0;
  const ask = runOptions(c, user, projectId, 'outline', outlineMessage({ ...inputs, items }));
  // D552 and D765: the page and the rail context are named at the call, as every run() names them.
  const res = await run(c.env, { ...ask, surface: AI_SURFACE.raisePitch, rail: ask.rail });
  let rows: OutlineRow[] | null = null;
  let reason: string | null = null;
  if (res.ok) {
    rows = outlineFromModel(parseJsonLoose<any>(res.output), inputs.length);
    if (!rows) reason = 'Eadwyn’s outline could not be read, so this is the standard outline for the length you chose.';
  } else if (res.refusal === 'assist_off') {
    reason = 'AI assistance is off on this page, so this is the standard outline for the length you chose. Nothing was charged.';
  } else {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    reason = 'Eadwyn could not answer, so this is the standard outline for the length you chose. Nothing was charged.';
  }
  const proposedBy = rows ? 'Eadwyn' : 'StudioOS';
  rows = rows ?? standardOutline(inputs.length);

  let railUid: string | null = null;
  if (proposedBy === 'Eadwyn') {
    // D780: the run's draft, kept as Eadwyn wrote it; the founder's edits travel with Build deck.
    try {
      const p = await proposeRail(c.env, {
        userId, page: NEW_DECK_RAIL.page, option: NEW_DECK_RAIL.outline, record: `project:${projectId}`, kind: 'draft',
        payload: { rows, audience: inputs.audience, length: inputs.length }, model: res.usage?.model ?? null, usageLogId: res.usageLogId ?? null,
      });
      railUid = p.uid;
    } catch { railUid = null; }
  }
  const outline = {
    audience: inputs.audience, round_ref: inputs.round_ref, length: inputs.length, prompt: inputs.prompt,
    start: body?.start?.kind === 'version' ? { kind: 'version', deck_id: base } : { kind: 'blank' },
    rows, proposed_by: proposedBy, rail_proposal_uid: railUid,
  };
  const title = `${(await ventureName(c.env, projectId)) || 'Venture'} — Pitch deck`;
  const id = await writeProposal(c.env, projectId, base, title, [], outline, userId);
  await auditDeckWrite(c, user, projectId, 'deck_outline_proposed', 'Deck outline proposed');
  return c.json({
    proposal: rowToProposal(await proposalRow(c.env, id)),
    outline: { rows, proposed_by: proposedBy, ...(reason ? { reason } : {}) },
    cost: { charged_microusd: res.ok ? await chargedOf(c.env, res.usageLogId, userId) : 0, usage_log_id: res.usageLogId ?? null },
  }, 201);
});

deckNew.post('/generate', async (c) => {
  const user = await requireAuth(c);
  const plan = planRefusal(user);
  if (plan) return plan;
  const body = await c.req.json().catch(() => ({} as any));
  const projectId = projectIdOf(body?.project_id);
  if (!projectId) return c.json({ error: 'project_id required' }, 400);
  const got = await venture(c, user, projectId, true);
  if ('refused' in got) return got.refused;
  await ensureSchema(c.env);

  // From an outline proposal (PD5's Build deck), or straight from the records (PD2's fast path).
  let proposal: any = null;
  if (body?.proposal_id != null) {
    const row = await ownedProposal(c, user, Number(body.proposal_id));
    if (row instanceof Response) return row;
    if (Number(row.project_id) !== projectId) return c.json({ error: 'not found' }, 404);
    proposal = rowToProposal(row);
  }
  const prior = proposal?.outline ?? {};
  const inputs = await inputsOf(c.env, projectId, body, {
    audience: prior.audience ?? FAST_PATH_AUDIENCE, length: prior.length, prompt: prior.prompt, round_ref: prior.round_ref,
  });
  if (typeof inputs === 'string') return c.json({ error: inputs }, 400);
  const refused = figureRefusal(inputs.prompt, projectId);
  if (refused) return refuseFigure(c, refused);
  const picked = rowsFor(body, prior, inputs.length, projectId);
  if ('response' in picked) return picked.response.refusal ? refuseFigure(c, picked.response.refusal) : c.json({ error: picked.response.error }, 400);
  const rows = picked.rows;
  // PD4: the records the founder unticked are on no card; a build without the key keeps the outline's choice.
  const excluded = excludedOf(body && Object.prototype.hasOwnProperty.call(body, 'exclude') ? body.exclude : prior.exclude ?? null);
  if (typeof excluded === 'string') return c.json({ error: excluded }, 400);
  const exclude = new Set(excluded);

  const items = await sourcesFor(c, user, got.project, projectId);
  const name = await ventureName(c.env, projectId);
  const userId = Number(user.id) || 0;
  const ask = runOptions(c, user, projectId, 'build', buildMessage({ ...inputs, rows, items, ventureName: name, exclude }), rows.length);
  const res = await run(c.env, { ...ask, surface: AI_SURFACE.raisePitch, rail: ask.rail });
  let wording: Wording[] = rows.map(() => ({ headline: null, body: null }));
  let dropped = 0;
  let by: 'Eadwyn' | 'none' = 'none';
  let reason: string | null = null;
  if (res.ok) {
    const w = wordingFromModel(parseJsonLoose<any>(res.output), rows.length);
    wording = w.byIndex;
    dropped = w.dropped;
    by = wording.some((x) => x.headline || x.body) ? 'Eadwyn' : 'none';
    if (by === 'none') reason = 'Eadwyn’s words could not be read. The figures are from your records; the cards carry their titles.';
  } else if (res.refusal === 'assist_off') {
    reason = 'AI assistance is off on this page. Your records still fill the figures; the cards carry their titles. Nothing was charged.';
  } else {
    const stop = refuseRun(c, res);
    if (stop) return stop;
    reason = 'Eadwyn could not answer. The figures are from your records; the cards carry their titles. Nothing was charged.';
  }

  const { slides, problems } = buildCards(rows, items, wording, name, exclude);
  if (problems.length) return c.json({ error: 'cards_unsound', problems }, 500);
  const stored = sanitizeSlides(slides);
  const outline = { ...prior, audience: inputs.audience, round_ref: inputs.round_ref, length: inputs.length, prompt: inputs.prompt, rows, exclude: excluded,
    proposed_by: prior.proposed_by ?? 'StudioOS', start: prior.start ?? { kind: 'blank' }, rail_proposal_uid: prior.rail_proposal_uid ?? null };
  const title = `${name || 'Venture'} — Pitch deck`;
  let id: number;
  if (proposal) {
    await c.env.DB.prepare('UPDATE pitch_deck_proposals SET slides = ?, title = ?, outline_json = ?, kept_slides_json = NULL WHERE id = ?')
      .bind(JSON.stringify(stored), title, JSON.stringify(outline), proposal.id).run();
    id = Number(proposal.id);
  } else {
    const base = await baseDeckId(c.env, projectId, null);
    id = await writeProposal(c.env, projectId, typeof base === 'number' ? base : 0, title, stored, outline, userId);
  }
  await auditDeckWrite(c, user, projectId, 'deck_built', 'Deck proposal built from records');
  return c.json({
    proposal: rowToProposal(await proposalRow(c.env, id)),
    progress: cardProgress(rows, items, wording, exclude),
    wording: { by, dropped, ...(reason ? { reason } : {}) },
    cost: { charged_microusd: res.ok ? await chargedOf(c.env, res.usageLogId, userId) : 0, usage_log_id: res.usageLogId ?? null },
  }, 201);
});

/**
 * Keep chosen cards (PD6 B). `indexes` adds to what is kept, `all` keeps every
 * card, and `save` writes the kept cards, in the proposal's order, as the new
 * current version and removes the proposal. Each press logs one row.
 */
deckNew.post('/proposals/:id/keep-slides', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const row = await ownedProposal(c, user, Number(c.req.param('id')) || 0);
  if (row instanceof Response) return row;
  const body = await c.req.json().catch(() => ({} as any));
  const proposal = rowToProposal(row);
  const slides: any[] = proposal.slides;
  if (!slides.length) return c.json({ error: 'this proposal has no cards yet; build the deck first' }, 409);
  if (body?.indexes != null && !Array.isArray(body.indexes)) return c.json({ error: 'indexes must be a list of card positions' }, 400);
  const asked = body?.all === true ? slides.map((_, i) => i) : keptIndexes(body?.indexes, slides.length);
  if (Array.isArray(body?.indexes) && asked.length !== body.indexes.length) return c.json({ error: `indexes must be card positions from 0 to ${slides.length - 1}, each once` }, 400);
  const kept = keptIndexes([...(proposal.kept ?? []), ...asked], slides.length);
  const projectId = Number(row.project_id);

  if (body?.save === true) {
    if (!kept.length) return c.json({ error: 'keep at least one card before saving' }, 400);
    // The outline's audience and round; else (a fill or a template) the version it was proposed over.
    const baseRow = await c.env.DB.prepare('SELECT audience, round_ref, theme_json FROM pitch_decks WHERE id = ? AND project_id = ?')
      .bind(row.base_deck_id, projectId).first<any>().catch(() => null);
    const o = proposal.outline;
    const meta = {
      audience: o?.audience ?? baseRow?.audience ?? null,
      round_ref: o ? o.round_ref ?? null : baseRow?.round_ref ?? null,
      theme: baseRow ? themeOfRow(baseRow) : null,
    };
    const deckId = await insertVersion(c.env, projectId, kept.map((i) => slides[i]), row.title || 'Pitch deck', Number(user.id) || null, meta);
    await c.env.DB.prepare('DELETE FROM pitch_deck_proposals WHERE id = ?').bind(row.id).run();
    await auditDeckWrite(c, user, projectId, 'deck_kept', `Kept ${kept.length} of ${slides.length} cards as a new version`);
    return c.json({ deck: rowToDeck(await getDeckRow(c.env, deckId)), kept });
  }

  if (!asked.length) return c.json({ error: 'name the cards to keep, or all' }, 400);
  await c.env.DB.prepare('UPDATE pitch_deck_proposals SET kept_slides_json = ? WHERE id = ?').bind(JSON.stringify(kept), row.id).run();
  await auditDeckWrite(c, user, projectId, 'deck_cards_kept', `Kept ${asked.length} card${asked.length === 1 ? '' : 's'} of the proposal`);
  return c.json({ proposal: rowToProposal(await proposalRow(c.env, Number(row.id))) });
});

export default deckNew;
