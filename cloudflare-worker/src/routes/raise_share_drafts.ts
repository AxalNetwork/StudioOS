/**
 * D6897 part 3 (#6897, canvas D6054 RA-27 A and RA-30) — Eadwyn's drafts for Share outside Axal: a proposed pack
 * selection for one reader, with a reason per item, and a one-sentence covering line for the readiness snapshot
 * (`services/raiseShareProposals.ts`).
 *
 *   GET  /api/cycles/raise/share-drafts               { drafts: [...] }  the member's latest of each kind
 *   POST /api/cycles/raise/share-drafts/quote         body { kind, audience? } → { quote: { hold_microusd, model, confirm_quote } }
 *   POST /api/cycles/raise/share-drafts/run           body { kind, audience?, confirm_quote } → { draft, cost }
 *                                                     402 quote_required: no run without the quote
 *                                                     200 { draft: null } when nothing Eadwyn returned survived the check
 *   POST /api/cycles/raise/share-drafts/:uid/accept   body { line? } → { draft, tick?, dropped?, line? }
 *   POST /api/cycles/raise/share-drafts/:uid/discard  → { draft }
 *
 * WHO. The venture's founders, through the Evidence gate (`evidenceScope(c, true)` in `cycle_raise.ts`): an
 * admin, capital staff, an investor and a support session are refused as on every Share outside Axal route. A
 * draft is its proposer's own row: another founder's is 409 `not_open`.
 *
 * WHAT A PRESS WRITES. Accept and discard write the proposal only, and one activity row on the venture. No pack,
 * link, snapshot, sharing or item is written here: the founder still ticks, edits and makes the pack or the
 * snapshot in the composer. Eadwyn never sends anything.
 *
 * Mounted by the route registry (#4105) under the Raise cycle's prefix; it names no path that router serves.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { quoteRun, run } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { logCycleWrite } from '../services/cycleActivity';
import { proposeRail } from '../services/railProposals';
import type { RaiseEvidenceContext } from '../services/raiseEvidence';
import { evidenceFailure, evidenceScope } from './cycle_raise';
import {
  OPTION_OF, PROPOSALS_PAGE, acceptDraft, audienceOf, discardDraft, isDraftKind, lineDraftFrom, lineFacts, listDrafts, packDraftFrom,
  packFacts, quoteDigest, recordOf, runOptions, type DraftKind, type LineFacts, type Outcome, type PackFacts,
} from '../services/raiseShareProposals';

const drafts = new Hono<{ Bindings: Env }>();

const UNAVAILABLE = 'Eadwyn cannot be asked right now. Nothing was charged. Every part of Share outside Axal works without a draft.';

async function body(c: any): Promise<Record<string, unknown>> {
  const b: unknown = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

type Asked = { kind: DraftKind; facts: PackFacts | LineFacts } | { refused: Response };

/** What one press would send: the kind, and the input read now. */
async function askedOf(c: any, ctx: RaiseEvidenceContext, b: Record<string, unknown>): Promise<Asked> {
  if (!isDraftKind(b.kind)) return { refused: refuse(c, 400, { code: 'invalid', message: 'Say which draft to ask for: a pack selection or a covering line.' }) };
  if (b.kind === 'pack') {
    const audience = audienceOf(b.audience);
    if (!audience) return { refused: refuse(c, 400, { code: 'invalid_audience', message: 'Say who the pack is for, in one short line with no email or link.' }) };
    const facts = await packFacts(ctx.env, ctx.projectId, audience);
    if (!facts) return { refused: refuse(c, 503, { code: 'evidence_unreadable', message: 'The evidence could not be read, so Eadwyn was not asked. Nothing was charged.' }) };
    if (!facts.items.length) return { refused: refuse(c, 409, { code: 'empty', message: 'Nothing is shared beyond Private yet, so there is nothing to propose. Share an item first.' }) };
    return { kind: 'pack', facts };
  }
  return { kind: 'covering-line', facts: await lineFacts(ctx.env, ctx.projectId) };
}

/** The quote for this founder, this draft and this input now, with the digest a run must carry. */
async function quoteFor(c: any, ctx: RaiseEvidenceContext, kind: DraftKind, facts: PackFacts | LineFacts) {
  const userId = Number(ctx.user.id);
  const opts = runOptions(userId, ctx.projectId, kind, facts);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return { opts, q, confirm: null as string | null };
  return { opts, q, confirm: await quoteDigest(userId, ctx.projectId, kind, facts, q.model, q.hold_microusd) };
}

drafts.get('/share-drafts', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    return c.json({ drafts: await listDrafts(c.env, Number(ctx.user.id), ctx.projectId) });
  } catch (e) { return evidenceFailure(c, e); }
});

drafts.post('/share-drafts/quote', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const asked = await askedOf(c, ctx, await body(c));
    if ('refused' in asked) return asked.refused;
    const got = await quoteFor(c, ctx, asked.kind, asked.facts);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: UNAVAILABLE });
    return c.json({ quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } });
  } catch (e) { return evidenceFailure(c, e); }
});

drafts.post('/share-drafts/run', async (c) => {
  try {
    const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
    const userId = Number(ctx.user.id);
    const b = await body(c);
    const asked = await askedOf(c, ctx, b);
    if ('refused' in asked) return asked.refused;
    const { kind, facts } = asked;
    const got = await quoteFor(c, ctx, kind, facts);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: UNAVAILABLE });
    // No run without the quote the founder saw: this draft, this input, the model and the hold it named.
    if (typeof b.confirm_quote !== 'string' || b.confirm_quote !== got.confirm) {
      return refuse(c, 402, {
        code: 'quote_required', message: 'Confirm the cost before Eadwyn drafts. Nothing was run.',
        extra: { quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } },
      });
    }
    // The surface and rail are runOptions' own, restated here so the D552 and D765 guards read them at the call.
    const res = kind === 'pack'
      ? await run(c.env, { ...got.opts, model: got.q.model, surface: AI_SURFACE.raiseEvidence, rail: got.opts.rail })
      : await run(c.env, { ...got.opts, model: got.q.model, surface: AI_SURFACE.raiseReadiness, rail: got.opts.rail });
    if (!res.ok) {
      const stop = refuseRun(c, res);
      if (stop) return stop;
      return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
    }
    const usageLogId = res.usageLogId ?? null;
    const charged = usageLogId
      ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<{ charged_microusd: number | null }>().catch(() => null)
      : null;
    const cost = { usage_log_id: usageLogId, charged_microusd: charged?.charged_microusd == null ? null : Number(charged.charged_microusd) };
    const made = kind === 'pack' ? packDraftFrom(res.output ?? '', facts as PackFacts) : lineDraftFrom(res.output ?? '');
    // A new draft replaces the founder's earlier open draft of the same kind.
    await c.env.DB.prepare(
      `UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND rail_page = ? AND record_ref = ? AND rail_option = ? AND status = 'proposed'`,
    ).bind(userId, PROPOSALS_PAGE, recordOf(ctx.projectId), OPTION_OF[kind]).run();
    if (made) {
      await proposeRail(c.env, {
        userId, page: PROPOSALS_PAGE, option: OPTION_OF[kind], record: recordOf(ctx.projectId), kind: kind === 'pack' ? 'proposal' : 'draft',
        payload: made as unknown as Record<string, unknown>, model: res.usage?.model ?? got.q.model, usageLogId,
      });
    }
    await logCycleWrite(c.env, { projectId: ctx.projectId, userId, cycle: 'raise', module: 'fundraising-readiness', entityId: null,
      action: kind === 'pack' ? 'share_pack_drafted' : 'share_line_drafted',
      summary: made ? (kind === 'pack' ? 'Eadwyn proposed a pack selection' : 'Eadwyn drafted a covering line') : 'Eadwyn returned no usable draft' });
    const now = (await listDrafts(c.env, userId, ctx.projectId)).find((d) => d.kind === kind && d.status === 'proposed') ?? null;
    return c.json({ draft: made ? now : null, cost });
  } catch (e) { return evidenceFailure(c, e); }
});

/** One press on one of the founder's own drafts; the Evidence gate is read on every press. */
function press(verb: 'accept' | 'discard') {
  return async (c: any) => {
    try {
      const ctx = await evidenceScope(c, true); if (ctx instanceof Response) return ctx;
      const userId = Number(ctx.user.id);
      const uid = String(c.req.param('uid') || '');
      const b = verb === 'accept' ? await body(c) : {};
      const out: Outcome = verb === 'accept'
        ? await acceptDraft(c.env, userId, ctx.projectId, uid, b.line)
        : await discardDraft(c.env, userId, ctx.projectId, uid);
      if (!out.ok) return refuse(c, out.status, { code: out.code, message: out.message });
      await logCycleWrite(c.env, { projectId: ctx.projectId, userId, cycle: 'raise', module: 'fundraising-readiness', entityId: null,
        action: verb === 'accept' ? 'share_draft_accepted' : 'share_draft_discarded',
        summary: verb === 'accept' ? (out.draft.status === 'edited' ? 'Eadwyn draft edited and kept' : 'Eadwyn draft accepted') : 'Eadwyn draft discarded' });
      const { ok: _ok, ...rest } = out;
      return c.json(rest);
    } catch (e) { return evidenceFailure(c, e); }
  };
}

drafts.post('/share-drafts/:uid/accept', press('accept'));
drafts.post('/share-drafts/:uid/discard', press('discard'));

export default drafts;

export const mount: RouteMount = { path: '/api/cycles/raise', router: drafts };
