/**
 * D8768 (#8768) — one eligibility rule for every skill picker: the directory, the skill page, Assign to agents, an
 * existing agent's Add skills drawer and the Add-an-agent wizard all read a skill's state from here, so no surface
 * filters by its own rule.
 *
 * THE SIX STATES, decided in this order (`eligibilityOf`):
 *   unreadable  the skill's published version (or a fact the gate needs) could not be read; never shown as eligible
 *   listed      in the library, with no published version (`version_not_published`): a draft cannot be attached
 *   published   a published version, and no agent to judge it for (the directory, a skill read without an agent)
 *   attached    the agent already has it, at any version (a retired or suspended skill stays attached)
 *   blocked     `attachCheck` refuses it: retired, suspended by HQ, a tool the sponsor has not approved, a capability
 *   eligible    the agent can be given it now
 *
 * FIT IS A RECOMMENDATION (D4116, #4224). `fitOf` says whether the skill was written for the agent's role or sits in
 * its persona's natural-fit areas. It sorts a list and labels a row; it never removes a skill, and `attachCheck` no
 * longer refuses `role_mismatch`. The gates that stay are a published version, Axal's golden-case bar (an HQ skill is
 * published only past it, D4160) and the sponsor's tool approval.
 *
 * THE CUSTOMER'S JOB LINE (`customerJob`). A published version is immutable, so the routing clause a library
 * description ends in ("… when a finance user supplies …") and any catalogue-planning or infrastructure sentence are
 * removed when a card is read, never by rewriting a version. The editor still sees and edits the stored text.
 *
 * Reads only. Nothing here attaches, publishes or grants anything.
 */
import type { Env } from '../../types';
import { attachCheck, versionOf, versionRoles, versionTags, type SkillRow } from './skillLinks';
import { personaOf, type AreaKey } from './personas';
import { FIRST_TEN } from './skillInputs';
import type { Tag } from './skills';
import type { AgentRow } from './teams';
import type { ToolGrant } from './agentTools';
import type { IntegrationRow } from '../../integrations/registry';
import { configOf, customMcpEnabled, grantableTools } from '../../integrations/customMcp';
import { RADAR_AXES } from '../skillsTaxonomySchema';

export const ELIGIBILITY_STATES = Object.freeze(['listed', 'published', 'eligible', 'attached', 'blocked', 'unreadable'] as const);
export type EligibilityState = typeof ELIGIBILITY_STATES[number];
export type Eligibility = {
  state: EligibilityState;
  /** Why it is not eligible: `version_not_published`, an `attachCheck` code, or `unreadable`; null when eligible, attached or published. */
  code: string | null;
  tool: { key: string; label: string } | null;
  capability?: { code: string; name: string } | null;
  /** A recommendation only: the skill was written for the agent's role, or sits in its persona's natural-fit areas. */
  fit: boolean;
};

/** A persona's area key → the taxonomy axis (`category_slug`) its skills are tagged with; the radar's own table. */
export const AREA_AXIS: Readonly<Record<AreaKey, string>> = Object.freeze({
  product: 'product', engineering: 'engineering', design: 'design', gtm: 'gtm_sales',
  marketing: 'marketing_brand', finance: 'finance_ops', legal: 'legal_compliance', capital: 'capital_network',
});

export type FitAgent = { role_key?: string | null; persona_key?: string | null };

/** The taxonomy axes a skill's tags reach, once each, in the radar's order. */
export function axesOfTags(tags: readonly Tag[], category: ReadonlyMap<string, string>): string[] {
  const hit = new Set(tags.map((t) => category.get(t.slug)).filter((x): x is string => !!x));
  return RADAR_AXES.map((a) => a.slug).filter((s) => hit.has(s));
}

/** Natural fit: the agent's role is among the version's roles, or its persona's natural-fit areas meet the skill's axes. */
export function fitOf(parts: { roles: readonly string[]; tags: readonly Tag[] } | null, agent: FitAgent | null, category: ReadonlyMap<string, string>): boolean {
  if (!parts || !agent) return false;
  if (agent.role_key && parts.roles.includes(agent.role_key)) return true;
  const persona = agent.persona_key ? personaOf(agent.persona_key) : null;
  if (!persona) return false;
  const axes = new Set(axesOfTags(parts.tags, category));
  return persona.natural_fit.some((k) => axes.has(AREA_AXIS[k]));
}

type GateAgent = Pick<AgentRow, 'scope_kind' | 'company_id' | 'project_id' | 'role_key' | 'tool_grants_json'> & { id?: number | null; persona_key?: string | null };

/** True when the skill has no published version a pin could name. */
export const isUnpublished = (s: Pick<SkillRow, 'status' | 'current_version'>) => s.status === 'draft' || !(Number(s.current_version) > 0);

/**
 * The one rule. `agent` null judges the skill alone (the directory); `pinned` is the version the agent already has.
 * A read that throws is `unreadable`, never eligible and never dropped.
 */
export async function eligibilityOf(env: Env, agent: GateAgent | null, s: SkillRow, opts: { pinned?: number | null; category: ReadonlyMap<string, string> }): Promise<Eligibility> {
  const none = { tool: null, fit: false };
  if (isUnpublished(s)) return { state: 'listed', code: 'version_not_published', ...none };
  let v;
  try { v = await versionOf(env, s.id, s.current_version); } catch { v = null; }
  if (!v) return { state: 'unreadable', code: 'unreadable', ...none };
  const fit = fitOf({ roles: versionRoles(v), tags: versionTags(v) }, agent, opts.category);
  if (!agent) return { state: 'published', code: null, tool: null, fit };
  const pinned = opts.pinned ?? null;
  if (pinned != null) return { state: 'attached', code: null, tool: null, fit };
  let blocked;
  try { blocked = await attachCheck(env, agent, s, s.current_version, null); } catch { return { state: 'unreadable', code: 'unreadable', tool: null, fit }; }
  if (blocked) return { state: 'blocked', code: blocked.code, tool: blocked.tool ?? null, ...(blocked.capability ? { capability: blocked.capability } : {}), fit };
  return { state: 'eligible', code: null, tool: null, fit };
}

export type EligibilityCounts = { listed: number; published: number; eligible: number; attached: number; blocked: number; unreadable: number; drafts: number };

/**
 * The counts a surface shows. `listed` is everything in the library the caller may know of, drafts included;
 * `published` every skill with a published version; `drafts` the listed skills with none, `hiddenDrafts` among them
 * (drafts the caller may count but not read, owner's Q1 option A).
 */
export function countEligibility(states: readonly EligibilityState[], hiddenDrafts = 0): EligibilityCounts {
  const n = (s: EligibilityState) => states.filter((x) => x === s).length;
  const drafts = n('listed') + hiddenDrafts;
  return {
    listed: states.length + hiddenDrafts,
    published: n('published') + n('eligible') + n('attached') + n('blocked'),
    eligible: n('eligible'), attached: n('attached'), blocked: n('blocked'), unreadable: n('unreadable'), drafts,
  };
}

/** Per taxonomy axis, the same counts, so a picker can say "Legal: 20 listed, none published". A skill in two areas counts in both. */
export function areaEligibility(rows: ReadonlyArray<{ axes: readonly string[]; state: EligibilityState }>): Array<{ area: string } & EligibilityCounts> {
  return RADAR_AXES.map((a) => ({ area: a.slug, ...countEligibility(rows.filter((r) => r.axes.includes(a.slug)).map((r) => r.state)) }));
}

/** Natural fit first, then the state (eligible, attached, blocked, then the rest), then most used, then by name. */
const STATE_ORDER: Record<EligibilityState, number> = { eligible: 0, attached: 1, published: 2, blocked: 3, unreadable: 4, listed: 5 };
export function byEligibility<T extends { eligibility: Eligibility; used_by?: number | null; name: string }>(a: T, b: T): number {
  return Number(b.eligibility.fit) - Number(a.eligibility.fit)
    || STATE_ORDER[a.eligibility.state] - STATE_ORDER[b.eligibility.state]
    || (Number(b.used_by) || 0) - (Number(a.used_by) || 0)
    || a.name.localeCompare(b.name);
}

// ── The customer's job line ───────────────────────────────────────────────────

/** A sentence about how the library is planned, routed or hosted: an issue or decision number, or infrastructure words. */
const BOILERPLATE = /(#\d{2,}|\bD\d{3,}\b|\bTODO\b|\bwrangler\b|\bCloudflare\b|\bD1\b|\bcatalogue (wave|slot|roadmap|planning)|\broadmap (wave|slot|item for the catalogue)|\b(route|routes) (to|this skill)\b|\bUse (this|it) (skill )?when\b|\bUse when\b)/i;

/**
 * The job, in the customer's words: the stored description without a routing clause or planning text.
 *   · a sentence matching `BOILERPLATE` is dropped (unless it is the only one);
 *   · a trailing unfinished sentence ("…" or "...") is dropped when a finished one precedes it, else the ellipsis goes;
 *   · a final " when …" clause that says when to route to the skill is cut, keeping a following ", <verb>ing …"
 *     (or ", without <verb>ing …") phrase or ": list"; "only when" is a constraint on the output and stays. The
 *     inputs the clause named are on the card as Needs (`skillInputsOf`) where D4667 records them.
 * Never empty: when every rule would empty it, the stored text is returned trimmed.
 */
export function customerJob(text: unknown): string | null {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return null;
  let sentences = raw.match(/[^.!?…]+(?:[.!?]+|…|\.\.\.|$)/g)?.map((x) => x.trim()).filter(Boolean) ?? [raw];
  const kept = sentences.filter((x) => !BOILERPLATE.test(x));
  if (kept.length) sentences = kept;
  const last = sentences[sentences.length - 1];
  if (/(…|\.\.\.)$/.test(last)) {
    if (sentences.length > 1) sentences = sentences.slice(0, -1);
    else sentences = [last.replace(/\s*(…|\.\.\.)$/, '').trim() + '.'];
  }
  sentences = sentences.map(cutRoutingClause);
  const out = sentences.join(' ').trim();
  return out || raw;
}

function cutRoutingClause(sentence: string): string {
  const m = /^(.*?\S)\s+when\s+(.+?)([.!?])?$/i.exec(sentence);
  if (!m || /\bonly$/i.test(m[1]) || m[1].split(/\s+/).length < 3) return sentence;
  const clause = m[2];
  const end = m[3] ?? '.';
  const participle = /,\s+((?:without|while|by)\s+[a-z]+ing\b.*|[a-z]+ing\b.*)$/i.exec(clause);
  if (participle) return `${m[1]}, ${participle[1]}${end}`;
  const list = /:\s+(.+)$/.exec(clause);
  if (list) return `${m[1]}: ${list[1]}${end}`;
  return `${m[1]}${end}`;
}

// ── Required inputs ──────────────────────────────────────────────────────────

export type InputLine = { field: string; required: boolean };

/** What a skill needs, from D4667's matrix (`skillInputs.ts`); null when its inputs are not recorded ("Not recorded"). */
export function skillInputsOf(slug: string | null | undefined): InputLine[] | null {
  const hit = slug ? FIRST_TEN.find((s) => s.slug === slug) : null;
  return hit ? hit.needs.map((n) => ({ field: n.field, required: n.required })) : null;
}

// ── A published alternative to a draft ───────────────────────────────────────

export type AltCandidate = { uid: string; name: string; output_kind: string; axes: readonly string[]; used_by: number };

/**
 * A published skill to offer instead of one that cannot be attached: it shares an area with the target, the same
 * output kind first, then the most used, then by name. Null when none shares an area.
 */
export function pickAlternative(target: { uid: string; output_kind: string; axes: readonly string[] }, candidates: readonly AltCandidate[]): AltCandidate | null {
  const axes = new Set(target.axes);
  const scored = candidates.filter((c) => c.uid !== target.uid && c.axes.some((a) => axes.has(a)))
    .map((c) => ({ c, shared: c.axes.filter((a) => axes.has(a)).length, same: c.output_kind === target.output_kind }));
  scored.sort((x, y) => Number(y.same) - Number(x.same) || y.shared - x.shared || y.c.used_by - x.c.used_by || x.c.name.localeCompare(y.c.name));
  return scored[0]?.c ?? null;
}

// ── An agent not yet added ───────────────────────────────────────────────────

/**
 * The read tools the sponsor could approve for a new agent at the wizard's step 3: every approved, pinned read tool
 * on their own connected MCP servers (the same offer `GET /api/teams/tools` lists and `checkGrants` accepts).
 * Null when it could not be read, so a skill that needs a tool is `unreadable`, never eligible.
 */
export async function sponsorToolPool(env: Env, sponsorId: number): Promise<ToolGrant[] | null> {
  if (!customMcpEnabled(env)) return [];
  try {
    const rows = (await env.DB.prepare("SELECT * FROM integrations WHERE user_id = ? AND provider_key LIKE 'custom:%' ORDER BY id")
      .bind(sponsorId).all<IntegrationRow>()).results ?? [];
    return rows.filter((r) => configOf(r)).flatMap((r) => {
      const offer = grantableTools(r);
      return offer.connected ? offer.tools.map((tool) => ({ integration_uid: r.provider_key.slice('custom:'.length), tool })) : [];
    });
  } catch { return null; }
}

/** The tools a skill needs that the wizard's step 3 will ask for: each in the pool, once. */
export function toolsToGrant(tools: readonly string[], pool: readonly ToolGrant[]): string[] {
  const have = new Set(pool.map((g) => g.tool));
  return [...new Set(tools.filter((t) => have.has(t)))];
}

