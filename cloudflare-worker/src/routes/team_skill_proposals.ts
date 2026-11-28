/**
 * D8827 (#8827, D5963) — Eadwyn's version summary and per-conflict proposals on Team › Skills › Compare with Axal.
 * Mounted at `/api/teams`, beside `team_skills.ts`, behind the same `TEAM_AGENTS_ENABLED` switch (404 `team_agents_off`).
 *
 *   POST /skills/:uid/proposals { estimate: true }
 *        → { estimate: { hold_microusd, model }, basis }: what the run would hold; runs, holds and writes nothing
 *   POST /skills/:uid/proposals { quote: { hold_microusd, model } }
 *        → { basis, summary, changed, unchanged, proposals, missing, withheld, receipt }
 *
 * One `workspace_explain` run through `services/aiRouter.ts` (`quoteRun`, then `run` with the quoted hold as its pin),
 * held, guarded and charged in AI tokens like every member press; nothing else calls a model. A run must bring the
 * quote the editor saw: when the hold or model changed, 409 `quote_changed` with a fresh `estimate` and nothing runs.
 *
 * Writers only, as the rebase is: the company's editors (`mayWrite`). HQ admins and members get 403 `not_editor`; a
 * caller who cannot read the skill gets 404. The same lineage checks as `POST /skills/:uid/rebase` come first (an
 * extension, not retired, its company not archived, a readable base with a newer, unsuspended, readable version), so
 * Eadwyn proposes only where a rebase could take the proposal.
 *
 * It stores nothing and writes no draft. A proposal is a rebase choice (`mine` | `axal` | `edit` with a value);
 * accepting one fills in the rebase sheet, and the draft is written only by `POST /skills/:uid/rebase` with
 * `expected_draft_hash` (D8827). `services/agents/skillCompareProposals.ts` decides what may be shown: a proposal
 * naming a tool outside Axal's newest version is withheld (D5963).
 *
 * Refusals: 401; 404 `not_found`; 403 `not_editor` | `support_session_refused`; 422 `not_extension`; 409 `retired` |
 * `company_archived` | `base_unreadable` | `base_retired` | `no_base_update` | `base_suspended` |
 * `company_version_unreadable` | `quote_changed`; 400 `body_invalid`; 403 `assist_off`, 402 a budget stop and 422/503
 * the guard, each in its own words (`refuseRun`); 503 `proposals_unavailable` (the model could not be reached,
 * nothing charged) and `proposals_unmatched` (the answer could not be matched to the comparison).
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import { railFor, refuseRun } from '../util/railContext';
import { run as aiRun, quoteRun, type RunOptions } from '../services/aiRouter';
import { AI_SURFACE } from '../services/aiSurfaces';
import { skillRunRefusal } from '../services/agents/skillModeration';
import {
  PROPOSALS_MAX_TOKENS, PROPOSALS_OPTION, PROPOSALS_PAGE, proposalMessages, readProposals, type ProposalFacts,
} from '../services/agents/skillCompareProposals';
import { teamAgentsEnabled } from './team_agents';
import { baseOf, draftParts, mayRead, mayWrite, skillByUid, threeWay, versionOf, versionParts } from './team_skills';
import { isAdmin } from './_t13t14t15_helpers';
import type { RouteMount } from '../util/routeRegistry';

type C = Context<{ Bindings: Env }>;
type Deps = { runner: typeof aiRun; quoter: typeof quoteRun };
const LIVE: Deps = { runner: aiRun, quoter: quoteRun };

const say = (c: C, status: number, code: string, message: string, extra?: Record<string, unknown>) => refuse(c, status, { code, message, extra });

/** The editor, the skill and the comparison a rebase would use, or the refusal. */
async function facts(c: C): Promise<{ user: User; uid: string; facts: ProposalFacts } | Response> {
  const user = (await requireAuth(c)) as User;
  const s = await skillByUid(c.env, c.req.param('uid') ?? '');
  if (!s || !(await mayRead(c.env, s, user))) return say(c, 404, 'not_found', 'There is no such skill.');
  if (isAdmin(user) || !(await mayWrite(c.env, s, user))) return say(c, 403, 'not_editor', 'Only the company’s editors can ask Eadwyn about rebasing its skills.');
  if ((await selectJwt(c))?.payload.impersonated_by) return say(c, 403, 'support_session_refused', 'Eadwyn does not run inside a support session. Nothing was run.');
  if (s.scope !== 'company' || !s.based_on_skill_uid || s.based_on_version == null) return say(c, 422, 'not_extension', 'Only a company extension has an Axal base to compare.');
  if (s.status === 'retired') return say(c, 409, 'retired', 'A retired skill cannot be rebased, so Eadwyn proposes nothing for it.');
  const company = await c.env.DB.prepare('SELECT archived_at FROM company_profiles WHERE id = ?').bind(s.company_id).first<{ archived_at: string | null }>();
  if (!company || company.archived_at) return say(c, 409, 'company_archived', 'An archived company is read-only.');
  const base = await baseOf(c.env, s).catch(() => null);
  if (!base?.version) return say(c, 409, 'base_unreadable', 'The original Axal base could not be read. Nothing was run.');
  if (base.row.status === 'retired') return say(c, 409, 'base_retired', 'This Axal skill is retired, so there is no newer version to propose from.');
  if (base.row.current_version <= s.based_on_version) return say(c, 409, 'no_base_update', 'There is no newer Axal version to compare with.');
  const newest = await versionOf(c.env, base.row.id, base.row.current_version).catch(() => null);
  if (!newest) return say(c, 409, 'base_unreadable', 'The newer Axal version could not be read. Nothing was run.');
  if (await skillRunRefusal(c.env, base.row.id, newest.version)) return say(c, 409, 'base_suspended', 'The newer Axal version is suspended, so it cannot be rebased onto.');
  // The company's side as GET /base and the rebase read it: the published version, else the draft.
  const current = s.current_version > 0 ? await versionOf(c.env, s.id, s.current_version).catch(() => null) : null;
  if (s.current_version > 0 && !current) return say(c, 409, 'company_version_unreadable', 'Your published company version could not be read. Nothing was run.');
  const mine = current ? versionParts(current) : await draftParts(c.env, s);
  const old = versionParts(base.version);
  const theirs = versionParts(newest);
  return {
    user, uid: s.uid,
    facts: {
      from: s.based_on_version, to: newest.version,
      company: { side: current ? 'version' : 'draft', version: current ? current.version : null },
      base: old, mine, newest: theirs, fields: threeWay(old, theirs, mine),
    },
  };
}

function runOptions(c: C, user: User, uid: string, f: ProposalFacts): RunOptions {
  const { systemPrompt, messages } = proposalMessages(f);
  return {
    task: 'workspace_explain', userId: Number(user.id), systemPrompt, messages, maxTokens: PROPOSALS_MAX_TOKENS, temperature: 0.2,
    surface: AI_SURFACE.teamSkillCompare, rail: railFor(c, { page: PROPOSALS_PAGE, option: PROPOSALS_OPTION }, `skill:${uid}`),
  };
}

/** The versions the proposals are about, so the page can tell when its comparison has moved on. */
const basisOf = (f: ProposalFacts) => ({ based_on_version: f.from, version: f.to, company: f.company });

/** What the run settled at, from its own usage rows (the guard's included); null when it cannot be read. */
async function chargedOf(env: Env, userId: number, usageLogId: number | null | undefined): Promise<number | null> {
  if (usageLogId == null) return null;
  try {
    const rows = (await env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE user_id = ? AND (id = ? OR guard_for = ?)')
      .bind(userId, usageLogId, usageLogId).all<{ charged_microusd: number | null }>()).results ?? [];
    return rows.length && rows.every((r) => Number.isSafeInteger(r.charged_microusd)) ? rows.reduce((n, r) => n + Number(r.charged_microusd), 0) : null;
  } catch { return null; }
}

async function propose(c: C, deps: Deps): Promise<Response> {
  const b = await c.req.json().catch(() => null) as Record<string, any> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return say(c, 400, 'body_invalid', 'Send { estimate: true } or the quote you approved as a JSON object.');
  const got = await facts(c);
  if (got instanceof Response) return got;
  const opts = runOptions(c, got.user, got.uid, got.facts);
  const q = await deps.quoter(c.env, opts);
  if (!q.ok) return refuseRun(c, q) ?? say(c, 503, 'proposals_unavailable', 'Eadwyn is not available right now. Nothing was run, and nothing was charged.');
  const estimate = { hold_microusd: q.hold_microusd, model: q.model };
  if (b.estimate === true) return c.json({ estimate, basis: basisOf(got.facts) });
  // No run without the quote the editor saw: this comparison, this model and this hold.
  if (!b.quote || b.quote.hold_microusd !== q.hold_microusd || b.quote.model !== q.model) {
    return say(c, 409, 'quote_changed', 'The cost of this read changed. Check the new hold, then ask again. Nothing was run.', { estimate });
  }
  const r = await deps.runner(c.env, {
    ...opts, task: opts.task, surface: opts.surface, rail: opts.rail, model: q.model, pinMicrousd: q.hold_microusd,
  });
  const stop = refuseRun(c, r);
  if (stop) return stop;
  if (!r.ok) return say(c, 503, 'proposals_unavailable', 'Eadwyn could not be reached. Nothing was proposed, and nothing was charged.');
  const answer = readProposals(r.output, got.facts);
  if (!answer) return say(c, 503, 'proposals_unmatched', 'Eadwyn’s answer could not be matched to this comparison, so nothing is shown. Nothing was saved.');
  const charged = await chargedOf(c.env, Number(got.user.id), r.usageLogId);
  return c.json({ basis: basisOf(got.facts), ...answer, receipt: { held_microusd: q.hold_microusd, charged_microusd: charged } });
}

function withSwitch(router: Hono<{ Bindings: Env }>) {
  router.use('/skills/:uid/proposals', async (c, next) => {
    if (!teamAgentsEnabled(c.env)) return c.json({ error: 'team_agents_off' }, 404);
    await next();
  });
  return router;
}

/** The same route over a stub model and quote, for tests. */
export function createSkillProposalsRouter(deps: Partial<Deps> = {}) {
  const d: Deps = { ...LIVE, ...deps };
  const router = withSwitch(new Hono<{ Bindings: Env }>());
  router.post('/skills/:uid/proposals', (c) => propose(c, d));
  return router;
}

// The explicit route on the mounted router, so the auth inventory and the API drift scanner read it.
const skillProposals = withSwitch(new Hono<{ Bindings: Env }>());
skillProposals.post('/skills/:uid/proposals', (c) => propose(c, LIVE));
export default skillProposals;

export const mount: RouteMount = { path: '/api/teams', router: skillProposals };
