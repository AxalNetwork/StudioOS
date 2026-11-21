/**
 * D6909 part 4 (#6909, canvas PRM20 and PRM22) — Eadwyn's drafts on a mark request
 * (`services/markRequestDrafts.ts`):
 *
 *   POST /api/mark-requests/drafts/quote          { kind: 'reason', project_uid, request_kind } (an investor)
 *                                                 { kind: 'basis', request_uid } (HQ)
 *                                                 → { quote: { hold_microusd, model, confirm_quote } }
 *   POST /api/mark-requests/drafts/run            the same body + confirm_quote → { draft | null, cost }
 *                                                 402 quote_required: no run without the quote
 *   POST /api/mark-requests/drafts/:uid/accept    the same scope fields + { reason? } or { basis?, source?, as_of_date? }
 *                                                 → { draft, kept }   writes the draft only
 *   POST /api/mark-requests/drafts/:uid/discard   the same scope fields → { draft }
 *
 * WHO. A reason: an investor (licence held, not an admin) for a company they hold, the request route's own scope
 * (`investorHeldProjectIds`); not held and not found answer alike. A basis: HQ (`requireAdmin`), on an open request.
 * A draft is its proposer's own row: another member's is 409 `not_open`.
 *
 * WHAT A PRESS WRITES. The draft row and nothing else: no request is sent and no mark is recorded here. The
 * investor still sends the request; HQ still reviews, confirms and records the mark (`POST /api/positions/:uid/marks`).
 *
 * Mounted by the route registry (#4105) under `/api/mark-requests`; the request router names no `/drafts` path.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { quoteRun, run } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { proposeRail } from '../services/railProposals';
import { mapError } from './_t13t14t15_helpers';
import { investorHeldProjectIds, investorActiveCompany } from './_investorProjectScope';
import {
  OPTION_OF, DRAFT_PAGE, REQUEST_KINDS, acceptDraft, basisDraftFrom, basisFacts, basisRecord, discardDraft, latestDraft,
  quoteDigest, reasonDraftFrom, reasonFacts, reasonRecord, runOptions, type BasisFacts, type DraftKind, type ReasonFacts,
} from '../services/markRequestDrafts';

const drafts = new Hono<{ Bindings: Env }>();
const UNAVAILABLE = 'Eadwyn cannot draft right now. Nothing was charged; write it yourself and nothing else changes.';
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function body(c: any): Promise<Record<string, unknown>> {
  const b: unknown = await c.req.json().catch(() => ({}));
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

type Scope = { kind: DraftKind; userId: number; record: string; facts: ReasonFacts | BasisFacts } | { refused: Response };

/** Who is asking, for what, and what the run would read now. Every press re-reads the gate. */
async function scopeOf(c: any, b: Record<string, unknown>, withFacts: boolean): Promise<Scope> {
  if (b.kind === 'reason') {
    const user = (await requireAuth(c)) as User;
    if (user.role === 'admin' || !canViewLpData(user)) return { refused: refuse(c, 403, { code: 'investor_only', message: 'Only an investor drafts a request’s reason.' }) };
    const requestKind = String(b.request_kind ?? 'mark');
    if (!(REQUEST_KINDS as readonly string[]).includes(requestKind)) return { refused: refuse(c, 400, { code: 'bad_kind', message: `request_kind must be one of: ${REQUEST_KINDS.join(', ')}` }) };
    const proj = await c.env.DB.prepare('SELECT id FROM projects WHERE uid = ? AND deleted_at IS NULL').bind(String(b.project_uid ?? '')).first() as { id: number } | null;
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) return { refused: refuse(c, 403, { code: 'not_held', message: 'You can ask Eadwyn only about a company you hold.' }) };
    const projectId = Number(proj.id);
    return {
      kind: 'reason', userId: Number(user.id), record: reasonRecord(projectId),
      facts: withFacts ? await reasonFacts(c.env, Number(user.id), projectId, requestKind, todayUtc()) : (null as any),
    };
  }
  if (b.kind === 'basis') {
    const user = (await requireAdmin(c)) as User;
    const req = await c.env.DB.prepare('SELECT uid, project_id, kind, reason, state FROM portfolio_mark_requests WHERE uid = ?')
      .bind(String(b.request_uid ?? '')).first() as { uid: string; project_id: number; kind: string; reason: string; state: string } | null;
    if (!req) return { refused: refuse(c, 404, { code: 'not_found', message: 'That request is not on the queue.' }) };
    if (withFacts && req.state !== 'open') return { refused: refuse(c, 409, { code: 'not_open_request', message: 'That request is already answered.' }) };
    return {
      kind: 'basis', userId: Number(user.id), record: basisRecord(req.uid),
      facts: withFacts ? await basisFacts(c.env, Number(req.project_id), { kind: req.kind, reason: req.reason }, todayUtc()) : (null as any),
    };
  }
  return { refused: refuse(c, 400, { code: 'invalid', message: 'Say which draft to ask for: a reason or a basis.' }) };
}

async function quoteFor(c: any, s: Exclude<Scope, { refused: Response }>) {
  const opts = runOptions(s.userId, s.kind, s.record, s.facts);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return { opts, q, confirm: null as string | null };
  return { opts, q, confirm: await quoteDigest(s.userId, s.record, s.kind, s.facts, q.model, q.hold_microusd) };
}

drafts.post('/drafts/quote', async (c) => {
  try {
    const s = await scopeOf(c, await body(c), true);
    if ('refused' in s) return s.refused;
    const got = await quoteFor(c, s);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: UNAVAILABLE });
    return c.json({ quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } });
  } catch (e) { return mapError(c, e); }
});

drafts.post('/drafts/run', async (c) => {
  try {
    const b = await body(c);
    const s = await scopeOf(c, b, true);
    if ('refused' in s) return s.refused;
    const got = await quoteFor(c, s);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: UNAVAILABLE });
    // No run without the quote the member saw: this draft, this input, the model and the hold it named.
    if (typeof b.confirm_quote !== 'string' || b.confirm_quote !== got.confirm) {
      return refuse(c, 402, {
        code: 'quote_required', message: 'Confirm the cost before Eadwyn drafts. Nothing was run.',
        extra: { quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } },
      });
    }
    // The surface and rail are runOptions' own, restated here so the D552 and D765 guards read them at the call.
    const res = await run(c.env, { ...got.opts, model: got.q.model, surface: AI_SURFACE.portfolioPositions, rail: got.opts.rail });
    if (!res.ok) {
      const stop = refuseRun(c, res);
      if (stop) return stop;
      return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
    }
    const usageLogId = res.usageLogId ?? null;
    const charged = usageLogId
      ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, s.userId).first<{ charged_microusd: number | null }>().catch(() => null)
      : null;
    const cost = { usage_log_id: usageLogId, charged_microusd: charged?.charged_microusd == null ? null : Number(charged.charged_microusd) };
    const made = s.kind === 'reason' ? reasonDraftFrom(res.output ?? '', s.facts as ReasonFacts) : basisDraftFrom(res.output ?? '', s.facts as BasisFacts);
    // A new draft replaces the member's earlier open draft of the same kind on the same record.
    await c.env.DB.prepare(
      `UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND rail_page = ? AND record_ref = ? AND rail_option = ? AND status = 'proposed'`,
    ).bind(s.userId, DRAFT_PAGE, s.record, OPTION_OF[s.kind]).run();
    if (made) {
      await proposeRail(c.env, {
        userId: s.userId, page: DRAFT_PAGE, option: OPTION_OF[s.kind], record: s.record, kind: s.kind === 'reason' ? 'draft' : 'proposal',
        payload: made as unknown as Record<string, unknown>, model: res.usage?.model ?? got.q.model, usageLogId,
      });
    }
    return c.json({ draft: made ? await latestDraft(c.env, s.userId, s.kind, s.record) : null, cost });
  } catch (e) { return mapError(c, e); }
});

function press(verb: 'accept' | 'discard') {
  return async (c: any) => {
    try {
      const b = await body(c);
      const s = await scopeOf(c, b, false);
      if ('refused' in s) return s.refused;
      const uid = String(c.req.param('uid') || '');
      const edit = s.kind === 'reason'
        ? (b.reason === undefined ? null : { reason: b.reason })
        : (['basis', 'source', 'as_of_date'].some((k) => b[k] !== undefined) ? { basis: b.basis, source: b.source, as_of_date: b.as_of_date } : null);
      const out = verb === 'accept' ? await acceptDraft(c.env, s.userId, s.record, uid, edit) : await discardDraft(c.env, s.userId, s.record, uid);
      if (!out.ok) return refuse(c, out.status, { code: out.code, message: out.message });
      return c.json({ draft: out.draft, kept: out.kept });
    } catch (e) { return mapError(c, e); }
  };
}

drafts.post('/drafts/:uid/accept', press('accept'));
drafts.post('/drafts/:uid/discard', press('discard'));

export default drafts;

export const mount: RouteMount = { path: '/api/mark-requests', router: drafts };
