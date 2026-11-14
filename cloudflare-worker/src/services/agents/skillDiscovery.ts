/**
 * D4538 part 4 (#5966, of #4538) — task-to-skill discovery as a pure service: the hard eligibility gate, then
 * ranking stages 1 to 3, in the response shape of `documentation/architecture/SKILL_DISCOVERY_CONTRACT.md`.
 *
 * Pure: it takes the agent's facts (role, company, granted tools) and the catalogue's skill facts (each skill's
 * published version) and returns `{ outcome, candidates, blocked, clarify, abstain_reason, stages }`. It reads no
 * store, writes nothing, calls no model and sends nothing anywhere; it never attaches a skill (attaching stays
 * `PUT /api/teams/agents/:uid/skills`, through `attachCheck`). No route serves it yet (#5967).
 *
 * THE GATE (`gateOf`), in `attachCheck`'s order (`skillLinks.ts`), then discovery's:
 *   not_found              another company's skill, or a draft the caller may not read: listed nowhere
 *   version_not_published  no published version, so nothing an attach could pin
 *   skill_retired          retired
 *   skill_suspended        HQ suspended it (D4161, D4534): the caller passes `skillRunRefusal`'s answer
 *   role_mismatch          the version does not list the agent's role
 *   tool_not_approved      a tool of the version is not in the agent's grants, named `{ key, label }`
 *   output_mismatch        `output_kind` was asked for, and the skill produces another
 *   input_unavailable      SEAM: only when the caller passes `seams.inputs` (#4667); never guessed here
 *   not_runnable           SEAM: only when the caller passes `seams.runnable` (#4534); never guessed here
 * A skill that fails is never a candidate. `blocked` lists the task-relevant ones with their code, except
 * `not_found`, which would disclose the skill.
 *
 * RANKING, over eligible skills only:
 *   1. role and taxonomy fit: the role is already required by the gate; a tag that `taxonomy_focus` names, or whose
 *      slug words the task uses, is reported and multiplies the score (FOCUS_BOOST, AREA_BOOST);
 *   2. task relevance: BM25 (k1 1.2, b 0.75) of the task's terms against the version's name (x3), purpose (x2),
 *      steps (x1) and tag slug words (x1), IDF over the skills the caller may read; terms are lower-cased, stop
 *      words dropped, lightly stemmed (`terms`). Lexical, in the Worker: nothing leaves it (D4538-p4.md);
 *   3. output compatibility: an asked-for kind is already a gate; a task that says "draft" or "write" prefers a
 *      draft (OUTPUT_BOOST). Inputs are not checked: stage 3 says so.
 * Stages 4 (quality) and 5 (operational) have no source: every candidate's `evaluation` and `operational` read
 * `{ available: false, reason }`. Use count is never an input.
 *
 * OUTCOMES. `no_suitable_skill` when the task asks for an act no skill does (sending, booking, paying: `ACTS`) or
 * when no eligible skill reaches MIN_COVERAGE of the task's terms; `ambiguous` (every candidate `low`, with a
 * `clarify` question) when the second candidate scores within AMBIGUOUS_RATIO of the first, or the task names one
 * term two skills share; otherwise `recommend`. `version` is always the published version an attach would pin.
 */
import { missingTools, type OutputKind, type Tag } from './skills';
import { toolLabel, type AttachCode } from './skillLinks';

export type DiscoveryCode = AttachCode | 'output_mismatch' | 'input_unavailable' | 'not_runnable';

/** The agent the skill would run on, as the server reads it (`agentByUid`), never as a client claims it. */
export type DiscoveryAgent = { role: string; company: number | string | null; tools: readonly string[] };

/** One catalogue skill, described by its current published version. */
export type DiscoverySkill = {
  uid: string; scope: 'hq' | 'company'; company: number | string | null;
  status: 'draft' | 'published' | 'retired';
  /** The caller's read gate on the skill (a draft they may not read is false). */
  readable: boolean;
  /** The current published version; null or 0 when none was ever published. */
  version: number | null;
  /** `skillRunRefusal` at `version` (D4534): true when HQ's suspension covers it. */
  suspended: boolean;
  name: string; purpose: string; steps: readonly string[];
  roles: readonly string[]; tools: readonly string[]; output_kind: string; taxonomy: readonly Pick<Tag, 'slug'>[];
  /** Adoption, carried for display by a caller. Never a ranking input. */
  use_count?: number | null;
};

export type DiscoveryRequest = { task: string; output_kind?: OutputKind | null; taxonomy_focus?: readonly string[]; limit?: number };

/**
 * The gate's two seams. Discovery does not guess either: without one, its code is never returned and stage 3 or
 * the gate reports that the check did not run.
 */
export type DiscoverySeams = {
  /** #4667: false when the skill's inputs cannot be read for this scope. */
  inputs?: (s: DiscoverySkill) => boolean;
  /** #4534: false when the execution contract refuses the skill for this agent. */
  runnable?: (s: DiscoverySkill) => boolean;
};

export type Refusal = { code: DiscoveryCode; tool?: { key: string; label: string } };
export type Unavailable = { available: false; reason: string };
export type Reason = { signal: 'task' | 'role' | 'taxonomy' | 'output'; text: string };
export type Candidate = {
  skill_uid: string; name: string; version: number; reasons: Reason[];
  fit: { role: true; taxonomy: string[] }; missing: never[];
  evaluation: Unavailable; operational: Unavailable;
  confidence: 'high' | 'medium' | 'low'; uncertainty: string | null;
  /** Stage 2's numbers, so a reader can inspect the order: BM25 after the stage 1 and 3 boosts, and coverage. */
  score: number; coverage: number;
};
export type BlockedSkill = { skill_uid: string; name: string; code: Exclude<DiscoveryCode, 'not_found'>; tool?: { key: string; label: string } };
export type Stage = { stage: 1 | 2 | 3 | 4 | 5; name: string; used: string | null; available: boolean; reason: string | null };
export type Discovery = {
  outcome: 'recommend' | 'ambiguous' | 'no_suitable_skill';
  candidates: Candidate[]; blocked: BlockedSkill[]; clarify: string | null; abstain_reason: string | null; stages: Stage[];
};

export const LIMIT_DEFAULT = 5;
export const LIMIT_MAX = 10;
export const TASK_MAX = 500;
export const FOCUS_MAX = 3;
/** The share of the task's term weight (IDF) a skill must match to be a candidate, or to be listed as blocked. */
export const MIN_COVERAGE = 0.2;
/** A candidate below this share of the top score is dropped. */
export const KEEP_RATIO = 0.5;
/** The second candidate within this share of the first makes the request ambiguous. */
export const AMBIGUOUS_RATIO = 0.85;
/** High confidence: this much coverage, and the second candidate below RUNNER_UP_RATIO of the first. */
export const HIGH_COVERAGE = 0.5;
export const RUNNER_UP_RATIO = 0.6;
export const FOCUS_BOOST = 0.25;
export const AREA_BOOST = 0.1;
export const OUTPUT_BOOST = 0.1;

const FIELD_WEIGHT = { name: 3, purpose: 2, steps: 1, tags: 1 } as const;
const K1 = 1.2;
const B = 0.75;

export const EVALUATION_UNAVAILABLE: Unavailable = { available: false, reason: 'Release evidence is not read by discovery yet (#4533).' };
export const OPERATIONAL_UNAVAILABLE: Unavailable = { available: false, reason: 'Runs are not measured yet (#4536).' };

const STOP = new Set((
  'a an and are as at be been being but by can could do does did for from get give go had has have help how i if in into is it '
  + 'its let me my need of on or our ours please should so some than that the their them then there these this those to up us '
  + 'want was we what when where which who why will with would you your yours left current new next last per each any all just '
  + 'tell show make look likely like much many'
).split(' '));

/** Acts no skill performs: skills read records and write briefs, drafts or proposed record changes for a person. */
export const ACTS: ReadonlyMap<string, string> = new Map([
  ['send', 'send messages'], ['email', 'send email'], ['mail', 'send email'], ['book', 'make bookings'], ['reserve', 'make bookings'],
  ['pay', 'make payments'], ['wire', 'move money'], ['transfer', 'move money'], ['buy', 'make purchases'], ['purchase', 'make purchases'],
  ['sign', 'sign documents'], ['submit', 'submit filings'], ['tweet', 'post publicly'], ['delete', 'delete records'],
]);

const DRAFT_WORDS = new Set(['draft', 'write', 'writ']);

/** A word's light stem: plural, -ing and -ed off, a doubled final consonant and a final e dropped. Deterministic. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

/** The text's content terms, in order: lower-cased words, stop words dropped, stemmed. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

const tagWords = (slug: string) => terms(slug.replace(/_/g, ' '));

/** Why `agent` may not be offered `s` for this request; null when it may. `attachCheck`'s order, then discovery's. */
export function gateOf(s: DiscoverySkill, agent: DiscoveryAgent, outputKind?: string | null, seams: DiscoverySeams = {}): Refusal | null {
  if (s.scope === 'company' && (s.company == null || String(s.company) !== String(agent.company ?? ''))) return { code: 'not_found' };
  if (!s.readable) return { code: 'not_found' };
  if (!Number.isSafeInteger(s.version) || (s.version ?? 0) < 1) return { code: 'version_not_published' };
  if (s.status === 'retired') return { code: 'skill_retired' };
  if (s.suspended) return { code: 'skill_suspended' };
  if (!s.roles.includes(agent.role)) return { code: 'role_mismatch' };
  const missing = missingTools(s.tools, agent.tools.map((tool) => ({ integration_uid: '', tool })));
  if (missing.length) return { code: 'tool_not_approved', tool: { key: missing[0], label: toolLabel(missing[0]) } };
  if (outputKind && s.output_kind !== outputKind) return { code: 'output_mismatch' };
  if (seams.inputs && !seams.inputs(s)) return { code: 'input_unavailable' };
  if (seams.runnable && !seams.runnable(s)) return { code: 'not_runnable' };
  return null;
}

/** A request's bounds (the contract's), or the reason it is refused. Unknown keys are ignored. */
export function checkDiscoveryRequest(body: unknown): { ok: true; request: Required<DiscoveryRequest> } | { ok: false; code: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const task = typeof b.task === 'string' ? b.task.trim() : '';
  if (!task || task.length > TASK_MAX) return { ok: false, code: 'task_invalid' };
  const output = b.output_kind ?? null;
  if (output !== null && output !== 'brief' && output !== 'draft' && output !== 'record_change') return { ok: false, code: 'output_kind_invalid' };
  const focus = b.taxonomy_focus ?? [];
  if (!Array.isArray(focus) || focus.length > FOCUS_MAX || !focus.every((f) => typeof f === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(f))) {
    return { ok: false, code: 'taxonomy_focus_invalid' };
  }
  const limit = b.limit ?? LIMIT_DEFAULT;
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > LIMIT_MAX) return { ok: false, code: 'limit_invalid' };
  return { ok: true, request: { task, output_kind: output as OutputKind | null, taxonomy_focus: focus as string[], limit: limit as number } };
}

type Doc = { tf: Map<string, number>; length: number };

/** One skill's weighted term counts: name x3, purpose x2, steps x1, tag slug words x1. */
function docOf(s: DiscoverySkill): Doc {
  const tf = new Map<string, number>();
  let length = 0;
  const add = (words: string[], w: number) => { for (const t of words) { tf.set(t, (tf.get(t) ?? 0) + w); length += w; } };
  add(terms(s.name), FIELD_WEIGHT.name);
  add(terms(s.purpose), FIELD_WEIGHT.purpose);
  for (const step of s.steps) add(terms(step), FIELD_WEIGHT.steps);
  for (const tag of s.taxonomy) add(tagWords(tag.slug), FIELD_WEIGHT.tags);
  return { tf, length };
}

type Scored = { s: DiscoverySkill; score: number; coverage: number; matched: string[]; focus: string[]; areas: string[]; draftPreferred: boolean };

const sentence = (text: string) => text.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

/**
 * The recommendation for `request` on `agent` over `skills`. Pure and deterministic: the same facts give the same
 * answer, ties broken by name then uid.
 */
export function discoverSkills(request: DiscoveryRequest, agent: DiscoveryAgent, skills: readonly DiscoverySkill[], seams: DiscoverySeams = {}): Discovery {
  const limit = Math.min(LIMIT_MAX, Math.max(1, Number.isSafeInteger(request.limit) ? request.limit as number : LIMIT_DEFAULT));
  const focusSet = new Set(request.taxonomy_focus ?? []);
  const outputKind = request.output_kind ?? null;
  const words = String(request.task ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const queryTerms = [...new Set(terms(request.task))];
  const act = words.map((w) => ACTS.get(w)).find(Boolean) ?? null;
  const draftAsked = outputKind === null && queryTerms.some((t) => DRAFT_WORDS.has(t));

  // The read gate first: IDF is taken only over skills the caller may read, so a hidden skill shapes no score.
  const visible = skills.map((s) => ({ s, why: gateOf(s, agent, outputKind, seams) })).filter((x) => x.why?.code !== 'not_found');
  const docs = new Map(visible.map((x) => [x.s, docOf(x.s)]));
  const n = visible.length;
  const avgLength = n ? [...docs.values()].reduce((a, d) => a + d.length, 0) / n : 1;
  const df = new Map<string, number>();
  for (const d of docs.values()) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
  const mass = queryTerms.reduce((a, t) => a + idf(t), 0);

  const score = (s: DiscoverySkill): Scored => {
    const d = docs.get(s)!;
    let bm25 = 0; let hit = 0; const matched: string[] = [];
    for (const t of queryTerms) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      matched.push(t);
      hit += idf(t);
      bm25 += idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.length / avgLength));
    }
    const focus = s.taxonomy.map((g) => g.slug).filter((g) => focusSet.has(g));
    const areas = s.taxonomy.map((g) => g.slug).filter((g) => !focusSet.has(g) && tagWords(g).some((w) => queryTerms.includes(w)));
    const draftPreferred = draftAsked && s.output_kind === 'draft';
    const boost = (1 + FOCUS_BOOST * focus.length) * (1 + AREA_BOOST * Math.min(1, areas.length)) * (1 + (draftPreferred ? OUTPUT_BOOST : 0));
    return { s, score: bm25 * boost, coverage: mass > 0 ? hit / mass : 0, matched, focus, areas, draftPreferred };
  };
  const order = (a: Scored, b: Scored) => b.score - a.score || a.s.name.localeCompare(b.s.name) || a.s.uid.localeCompare(b.s.uid);

  const eligible = visible.filter((x) => x.why === null).map((x) => score(x.s)).filter((x) => x.score > 0 && x.coverage >= MIN_COVERAGE).sort(order);
  const top = eligible[0]?.score ?? 0;
  const kept = eligible.filter((x) => x.score >= KEEP_RATIO * top).slice(0, limit);

  const blocked: BlockedSkill[] = visible.filter((x) => x.why !== null)
    .map((x) => ({ x, sc: score(x.s) })).filter(({ sc }) => sc.score > 0 && sc.coverage >= MIN_COVERAGE).sort((a, b) => order(a.sc, b.sc)).slice(0, limit)
    .map(({ x }) => ({
      skill_uid: x.s.uid, name: x.s.name, code: x.why!.code as BlockedSkill['code'], ...(x.why!.tool ? { tool: x.why!.tool } : {}),
    }));

  const vague = queryTerms.length <= 1;
  const ambiguous = !act && kept.length >= 2 && (kept[1].score >= AMBIGUOUS_RATIO * kept[0].score || vague);
  const outcome: Discovery['outcome'] = act || !kept.length ? 'no_suitable_skill' : ambiguous ? 'ambiguous' : 'recommend';

  const candidates: Candidate[] = kept.map((x, i) => {
    const reasons: Reason[] = [
      { signal: 'task', text: `The task's terms ${x.matched.map((t) => `"${t}"`).join(', ')} appear in the skill's name, purpose or steps.` },
      { signal: 'role', text: `Listed for ${agent.role}.` },
    ];
    if (x.focus.length) reasons.push({ signal: 'taxonomy', text: `Tagged ${x.focus.join(', ')}, as the request's taxonomy focus asks.` });
    if (x.areas.length) reasons.push({ signal: 'taxonomy', text: `Tagged ${x.areas.join(', ')}, an area the task names.` });
    if (outputKind) reasons.push({ signal: 'output', text: `Produces a ${outputKind}, as asked.` });
    else if (x.draftPreferred) reasons.push({ signal: 'output', text: 'Produces a draft, which the task asks for.' });
    let confidence: Candidate['confidence'] = 'medium';
    let uncertainty: string | null = null;
    if (outcome === 'no_suitable_skill') {
      confidence = 'low';
      uncertainty = `The task asks to ${act}, which no skill does; this skill only prepares a ${x.s.output_kind} for a person to act on.`;
    } else if (outcome === 'ambiguous') {
      confidence = 'low';
      uncertainty = 'The task fits more than one skill about equally; see the clarifying question.';
    } else if (i === 0 && x.coverage >= HIGH_COVERAGE && (kept.length < 2 || kept[1].score < RUNNER_UP_RATIO * x.score)) {
      confidence = 'high';
    } else {
      uncertainty = i === 0
        ? `The skill matches ${Math.round(x.coverage * 100)}% of the task's term weight${kept.length > 1 ? ', and another skill scores close to it' : ''}.`
        : 'Ranked below the first candidate on task relevance.';
    }
    return {
      skill_uid: x.s.uid, name: x.s.name, version: x.s.version as number, reasons,
      fit: { role: true, taxonomy: [...x.focus, ...x.areas] }, missing: [],
      evaluation: EVALUATION_UNAVAILABLE, operational: OPERATIONAL_UNAVAILABLE,
      confidence, uncertainty, score: Math.round(x.score * 1000) / 1000, coverage: Math.round(x.coverage * 1000) / 1000,
    };
  });

  let abstain: string | null = null;
  if (outcome === 'no_suitable_skill') {
    if (act) abstain = `The task asks to ${act}. Skills read records and prepare briefs, drafts or proposed changes for a person; none can do that.`;
    else if (blocked.length) {
      const b = blocked[0];
      abstain = b.code === 'tool_not_approved'
        ? `No skill this agent can run fits the task. ${b.name} fits, but needs ${b.tool!.label}, which this agent is not granted.`
        : `No skill this agent can run fits the task. ${b.name} fits, but is blocked for it (${b.code}).`;
    } else abstain = 'No skill in the catalogue fits the task well enough to offer.';
  }
  const clarify = outcome === 'ambiguous'
    ? `Which do you mean: ${kept[0].s.name} (${sentence(kept[0].s.purpose)}), or ${kept[1].s.name} (${sentence(kept[1].s.purpose)})?`
    : null;

  const stages: Stage[] = [
    { stage: 1, name: 'role and taxonomy fit', used: `role ${agent.role}; taxonomy_focus ${focusSet.size ? [...focusSet].join(', ') : 'none'}; tag slug words in the task`, available: true, reason: null },
    { stage: 2, name: 'task relevance', used: 'BM25 over the published version\'s name, purpose, steps and tags, in the Worker', available: true, reason: null },
    {
      stage: 3, name: 'input and output compatibility', used: outputKind ? `output_kind ${outputKind} (a gate)` : draftAsked ? 'a draft, which the task asks for' : null,
      available: true, reason: seams.inputs ? null : 'Inputs are not checked: what the scope records is not read by discovery yet (#4667).',
    },
    { stage: 4, name: 'quality evidence', used: null, available: false, reason: EVALUATION_UNAVAILABLE.reason },
    { stage: 5, name: 'operational evidence', used: null, available: false, reason: OPERATIONAL_UNAVAILABLE.reason },
  ];

  return { outcome, candidates, blocked, clarify, abstain_reason: abstain, stages };
}
