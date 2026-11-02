/**
 * D1557 (#3804, deck v2 C9) — the investor critic on a deck version.
 *
 *   POST /api/decks/:id/critic/quote   { investor_type?, stage? }
 *        → { ai: true, hold_microusd, model, family, writer_family } | { ai: false, reason, message }
 *   POST /api/decks/:id/critic         (the same body)
 *        → { deck_id, version, stage, stage_label, investor_type, persona,
 *            findings: [{ key, source, severity, code, card_uid, card_index, message, action }],
 *            benchmark: { available: true, value: [citation] } | { available: false, reason },
 *            critic: { state: 'ok' | 'off' | 'refused', code?, message?, model?, family?, writer_family?, dropped? },
 *            cost }
 *
 * The rule findings (A23's stage rules, every "Not backed" figure, a market
 * with no source) are free and always answered. The critic's own findings are
 * one run under `deck:critic` on a model whose family differs from the
 * writer's (`services/decks/critic.ts`). The writer is what the deck's build
 * run would use for this founder now: Body's element model, else the build
 * option's resolution, read by quoting that run (nothing runs, nothing is
 * held). A writer that cannot be read, no candidate of another family, or a
 * run answered by the writer's family gives no critic findings, and says so.
 *
 * Nothing is written but one `raise.pitch-deck` activity row naming the
 * version and the count, never a figure or a finding's words.
 *
 * Who: the deck's founders (`projectOwned` with `write`): the run is charged
 * to the founder who asked. Mounted in index.ts BEFORE `decks`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ROUTE, quoteRun, run, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { resolveRailOption } from '../services/ai/railMatrix';
import { ASSIST_PAGE } from '../services/decks/assist';
import { parseJsonLoose } from '../services/decks/autofill';
import { stagePlan } from '../services/decks/stagePlan';
import { AUDIENCES } from '../services/decks/slideModel';
import { citableNorms } from '../services/decks/stageNorms';
import { cardOfSlide, stageFrom } from '../services/narrative/arcs';
import { deckVersion } from '../services/raiseClaims';
import { noteApplies, storedDeckClaims } from '../services/deckCheck';
import { FIGURE_LABEL } from '../services/raiseCycle';
import {
  CRITIC_OPTION, CRITIC_SYSTEM, criticCards, criticFindings, criticMessage, criticModelFor, familyOf, ordered, otherFamily, personaOf, ruleFindings,
} from '../services/decks/critic';
import { railFor, refuseRun } from '../util/railContext';
import { auditDeckWrite, getDeckRow, projectOwned, rowToDeck } from './decks';
import { mercuryFor } from './deck_sources';
import { elementModelFor, runModelOf } from './deck_element_models';
import { NEW_DECK_RAIL } from './deck_new';

const deckCritic = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

type Ask = { deckId: number; projectId: number; deck: any; row: any; project: any; investorType: string | null; stage: string | null };

async function askOf(c: any, user: User): Promise<{ ask: Ask } | { refused: Response }> {
  const body = await c.req.json().catch(() => ({} as any));
  const deckId = Number(c.req.param('id'));
  if (!Number.isSafeInteger(deckId) || deckId <= 0) return { refused: c.json({ error: 'deck id required' }, 400) };
  const stage = body?.stage == null || body.stage === '' ? null : String(body.stage);
  if (stage && !stageFrom(stage)) return { refused: c.json({ error: 'stage must be one of pre_seed, seed, series_a, series_b_plus' }, 400) };
  const investorType = body?.investor_type == null || body.investor_type === '' ? null : String(body.investor_type);
  if (investorType && !(AUDIENCES as readonly string[]).includes(investorType)) return { refused: c.json({ error: `investor_type must be one of ${AUDIENCES.join(', ')}` }, 400) };
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return { refused: c.json({ error: 'not found' }, 404) }; }
  const projectId = Number(row.project_id);
  let project: any;
  try { project = await projectOwned(c, user, projectId, { write: true }); } catch (e: any) {
    return { refused: e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403) };
  }
  return { ask: { deckId, projectId, deck: rowToDeck(row), row, project, investorType, stage } };
}

/** The model the deck's writer would use for this founder now, from a quote of the build run; 'off' with AI off; null when unreadable. */
async function writerModel(c: any, user: User, projectId: number): Promise<string | 'off' | null> {
  let model: string | undefined;
  try { model = runModelOf(await elementModelFor(c.env, user, projectId, 'body')); } catch { return null; }
  const q = await quoteRun(c.env, {
    ...(model ? { model } : {}),
    task: 'rail_write', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch,
    rail: { page: NEW_DECK_RAIL.page, option: NEW_DECK_RAIL.build },
    systemPrompt: '', messages: [{ role: 'user', content: 'quote' }], maxTokens: 16,
  }).catch(() => null);
  if (q && !q.ok && q.refusal === 'assist_off') return 'off';
  return q && q.ok ? q.model ?? null : null;
}

/** The critic's candidates: its option's models, else the reasoning route's. */
function candidates(): string[] {
  const row = resolveRailOption(ASSIST_PAGE, CRITIC_OPTION);
  const ids = row?.models?.map((m) => m.id) ?? [];
  return ids.length ? ids : [...(ROUTE.rail_reason.alternates ?? [ROUTE.rail_reason.model])];
}

/** Everything the critic reads, and the free findings. */
async function readAll(c: any, user: User, a: Ask) {
  const plan = await stagePlan(c.env, {
    projectId: a.projectId, slides: a.deck.slides, audience: a.deck.audience, stage: a.stage, investorType: a.investorType,
    mercury: await mercuryFor(c, user, a.project ?? { founder_id: null, company_id: null }), today: today(),
  });
  const cards = criticCards(a.deck.slides, cardOfSlide);
  let notBacked: Array<{ uid: string; slide: number | null; label: string }> = [];
  let claims: 'ok' | 'unreadable' = 'ok';
  try {
    notBacked = (await storedDeckClaims(c.env, a.projectId, deckVersion(a.row)))
      .filter((cl) => cl.state === 'not_backed' && !noteApplies(cl))
      .map((cl) => {
        const m = /^slide:(\d+)#/.exec(String(cl.field_key));
        return { uid: cl.uid, slide: m ? Number(m[1]) : null, label: (FIGURE_LABEL as Record<string, string>)[cl.claim_kind] ?? cl.claim_kind };
      });
  } catch { claims = 'unreadable'; }
  const findings = ruleFindings({ cards, warnings: plan.warnings, order: plan.order, notBacked });
  let benchmark: { available: true; value: string[] } | { available: false; reason: string };
  try {
    const norms = await citableNorms(c.env, a.projectId, plan.stage, plan.investor_type);
    benchmark = norms.available ? { available: true, value: norms.value.map((n) => n.citation) } : norms;
  } catch { benchmark = { available: false, reason: 'The stage benchmarks could not be read.' }; }
  return { plan, cards, findings, benchmark, claims };
}

function criticRun(c: any, user: User, a: Ask, model: string, read: Awaited<ReturnType<typeof readAll>>): RunOptions {
  const rail = { ...railFor(c, { page: ASSIST_PAGE, option: CRITIC_OPTION }, `deck:${a.deckId}`), option: CRITIC_OPTION };
  return {
    model, task: 'rail_reason', userId: Number(user.id) || 0, surface: AI_SURFACE.raisePitch, rail,
    systemPrompt: CRITIC_SYSTEM,
    messages: [{ role: 'user', content: criticMessage({
      persona: personaOf(read.plan.investor_type), stageLabel: read.plan.stage_label, cards: read.cards,
      already: read.findings, benchmarks: read.benchmark.available ? read.benchmark.value : null,
    }) }],
    temperature: 0.3, maxTokens: 1400,
  };
}

async function chargedOf(env: Env, usageLogId: number | null | undefined, userId: number): Promise<number | null> {
  if (!usageLogId) return null;
  const row = await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<any>().catch(() => null);
  return row?.charged_microusd == null ? null : Number(row.charged_microusd);
}

const NO_WRITER = 'The deck writer’s model could not be read, so the critic cannot be kept to another model family. Nothing was run.';
const AI_OFF = 'AI assistance is off on this page. The rule findings still show.';
const NO_FAMILY = 'No critic model of another family than the writer’s is offered, so the critic was not run.';

deckCritic.post('/:id/critic/quote', async (c) => {
  const user = await requireAuth(c);
  const got = await askOf(c, user);
  if ('refused' in got) return got.refused;
  const a = got.ask;
  const writer = await writerModel(c, user, a.projectId);
  if (writer === 'off') return c.json({ ai: false, reason: 'assist_off', message: AI_OFF });
  if (!writer) return c.json({ ai: false, reason: 'writer_unknown', message: NO_WRITER });
  const model = criticModelFor(candidates(), writer);
  if (!model) return c.json({ ai: false, reason: 'no_other_family', message: NO_FAMILY, writer_family: familyOf(writer) });
  const read = await readAll(c, user, a);
  const q = await quoteRun(c.env, { ...criticRun(c, user, a, model, read), surface: AI_SURFACE.raisePitch });
  if (!q.ok) return c.json({ ai: false, reason: q.refusal, message: q.refusal === 'assist_off' ? AI_OFF : q.error });
  return c.json({ ai: true, hold_microusd: q.hold_microusd, model: q.model, family: familyOf(q.model), writer_family: familyOf(writer) });
});

deckCritic.post('/:id/critic', async (c) => {
  const user = await requireAuth(c);
  const got = await askOf(c, user);
  if ('refused' in got) return got.refused;
  const a = got.ask;
  const userId = Number(user.id) || 0;
  const read = await readAll(c, user, a);
  const writer = await writerModel(c, user, a.projectId);
  const model = writer && writer !== 'off' ? criticModelFor(candidates(), writer) : null;
  let findings = read.findings;
  let critic: Record<string, unknown>;
  let cost = { charged_microusd: 0 as number | null, usage_log_id: null as number | null };
  if (writer === 'off') critic = { state: 'off', message: AI_OFF };
  else if (!writer) critic = { state: 'refused', code: 'writer_unknown', message: NO_WRITER };
  else if (!model) critic = { state: 'refused', code: 'no_other_family', message: NO_FAMILY, writer_family: familyOf(writer) };
  else {
    const res = await run(c.env, { ...criticRun(c, user, a, model, read), surface: AI_SURFACE.raisePitch });
    if (!res.ok) {
      if (res.refusal === 'assist_off') critic = { state: 'off', message: AI_OFF };
      else {
        const stop = refuseRun(c, res);
        if (stop) return stop;
        critic = { state: 'refused', code: 'model_unavailable', message: 'The critic could not answer. Nothing was charged.' };
      }
    } else {
      cost = { charged_microusd: await chargedOf(c.env, res.usageLogId, userId), usage_log_id: res.usageLogId ?? null };
      const answered = res.usage?.model ?? model;
      if (!otherFamily(answered, writer)) {
        // A fallback reached the writer's own family: its findings are not shown (the family rule), and it was charged.
        critic = { state: 'refused', code: 'same_family', message: 'The critic’s answer came from the writer’s own model family, so it is not shown. It was charged for the run.', model: answered, family: familyOf(answered), writer_family: familyOf(writer) };
      } else {
        const got2 = criticFindings(parseJsonLoose<any>(res.output), read.cards, read.benchmark.available ? read.benchmark.value : null);
        findings = [...findings, ...got2.findings];
        critic = { state: 'ok', model: answered, family: familyOf(answered), writer_family: familyOf(writer), dropped: got2.dropped };
      }
    }
  }
  await auditDeckWrite(c, user, a.projectId, 'deck_critic_run', `v${Number(a.deck.version) || 1}: ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  return c.json({
    deck_id: a.deckId, version: a.deck.version, stage: read.plan.stage, stage_label: read.plan.stage_label, investor_type: read.plan.investor_type,
    persona: personaOf(read.plan.investor_type), findings: ordered(findings), benchmark: read.benchmark,
    ...(read.claims === 'unreadable' ? { claims: 'unreadable' } : {}), critic, cost,
  });
});

export default deckCritic;
