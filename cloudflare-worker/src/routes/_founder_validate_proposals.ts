/**
 * "AI fills the blanks", for Validate — as pure functions plus two thin D1
 * calls, so the part that decides what becomes a row can be tested without
 * standing up Hono, auth or a model.
 *
 * THE RULE THIS FILE IS BUILT AROUND. A model's output is a suggestion about
 * ids and phrases; it is never itself an id or a phrase. Every proposed item
 * is matched back against something that actually exists in this project
 * before it can be written, and anything that does not match is dropped
 * silently rather than surfaced. A hallucinated `pain_group_id` that reached
 * the table would put another venture's theme — or no theme at all — behind
 * an "Accept" button, and the founder clicking it would have no way to know.
 *
 * So `parseTagProposals` and `parseDraftProposals` take the model's text AND
 * the real world, and return only the intersection. Their tests are mostly
 * about what they refuse.
 *
 * WHAT IS NOT PROPOSED, AND WHY NOT.
 *
 *   · A NEW pain theme. The tagger may only sort phrases into groups the
 *     founder has already created. Creating a theme is naming the thing the
 *     venture is about, and `FounderValidateWorkspace` has said "founder-
 *     curated" on screen for as long as the page has existed. Sorting into
 *     names a person chose is a different act from choosing the names.
 *   · A verdict. `hypotheses` has no verdict column on purpose (migration 211)
 *     — verdict, lane and the distance to the bar are computed from the
 *     interviews. A model cannot propose one without proposing a fact about
 *     evidence, and the evidence already answers it.
 *   · A transcript. There is nowhere to put one; see migration 214.
 */
import type { Env } from '../types';

/** Cap on how much a single run may propose. A wall of cards is not a draft. */
export const MAX_PROPOSALS_PER_RUN = 5;
/** Cap on how much evidence is sent. Bounds cost and keeps the prompt honest. */
export const MAX_PROMPT_ITEMS = 40;

export type ProposalKind = 'pain_tag' | 'hypothesis';
export const PROPOSAL_KINDS = new Set<ProposalKind>(['pain_tag', 'hypothesis']);

export const TASK_FOR_KIND: Record<ProposalKind, string> = {
  pain_tag: 'validate_tag_pains',
  hypothesis: 'validate_draft_hypotheses',
};

export type TagPayload = { phrase: string; pain_group_id: number; group_title: string };
export type HypothesisPayload = { claim: string };

/**
 * Pull the first JSON array out of a model's reply.
 *
 * Models wrap JSON in prose and in fences however they are asked not to, so
 * this looks for the array rather than trusting the whole body to parse. A
 * reply with no array at all yields `[]` — no proposals — which is the right
 * outcome and not an error: nothing was suggested, so nothing is offered.
 */
export function extractJsonArray(text: string): unknown[] {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export type PainGroupRef = { id: number; title: string };

/**
 * Tag proposals the project can actually accept.
 *
 * Four ways an item is refused, and each is a bug that would otherwise reach
 * a founder as a button:
 *   · the phrase is not one this project has logged — a model asked to sort
 *     phrases will happily invent a better-sounding one;
 *   · the group id is not one of this project's groups;
 *   · the phrase is already in that group, so the proposal is a no-op;
 *   · the same phrase is proposed twice in one reply.
 */
export function parseTagProposals(
  text: string,
  ungrouped: readonly string[],
  groups: readonly PainGroupRef[],
): TagPayload[] {
  const byPhrase = new Map(ungrouped.map((p) => [norm(p), p]));
  const byId = new Map(groups.map((g) => [Number(g.id), g]));
  const seen = new Set<string>();
  const out: TagPayload[] = [];

  for (const item of extractJsonArray(text)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const phraseKey = norm(rec.phrase);
    const real = byPhrase.get(phraseKey);
    if (!real || seen.has(phraseKey)) continue;
    const group = byId.get(Number(rec.pain_group_id));
    if (!group) continue;
    seen.add(phraseKey);
    // `phrase` is the project's own string, not the model's echo of it: a
    // model that "helpfully" corrects a typo would otherwise write a phrase
    // the interview never contained.
    out.push({ phrase: real, pain_group_id: Number(group.id), group_title: group.title });
    if (out.length >= MAX_PROPOSALS_PER_RUN) break;
  }
  return out;
}

/** Claims worth offering: new, non-empty, not a restatement of an existing one. */
export function parseDraftProposals(
  text: string,
  existingClaims: readonly string[],
): HypothesisPayload[] {
  const taken = new Set(existingClaims.map(norm));
  const out: HypothesisPayload[] = [];

  for (const item of extractJsonArray(text)) {
    const claim = typeof item === 'string'
      ? item
      : String((item as Record<string, unknown>)?.claim ?? '');
    const trimmed = claim.trim().slice(0, 500);
    // Two words is not a hypothesis, and a model that has run out of ideas
    // emits fragments rather than stopping.
    if (trimmed.split(/\s+/).length < 4) continue;
    const key = norm(trimmed);
    if (taken.has(key)) continue;
    taken.add(key);
    out.push({ claim: trimmed });
    if (out.length >= MAX_PROPOSALS_PER_RUN) break;
  }
  return out;
}

export const TAG_PROMPT = [
  'You sort customer-interview pain phrases into themes a founder has already named.',
  '',
  'Reply with a JSON array and nothing else. Each element:',
  '  {"phrase": "<one of the ungrouped phrases, copied exactly>", "pain_group_id": <one of the theme ids>}',
  '',
  'Rules you must not break:',
  '- Only use phrases from the ungrouped list, copied exactly. Never invent or reword one.',
  '- Only use theme ids from the theme list. Never invent an id and never propose a new theme.',
  '- Leave a phrase out if it does not clearly belong to one of the themes. A short, correct answer is better than a complete one.',
  '- Reply with [] if none of them fit.',
].join('\n');

export const DRAFT_PROMPT = [
  'You draft falsifiable hypotheses from what customer interviews have already said.',
  '',
  'Reply with a JSON array and nothing else. Each element:',
  '  {"claim": "<one sentence>"}',
  '',
  'Rules you must not break:',
  '- Every claim must be testable by talking to more customers, and must be able to turn out false.',
  '- Ground every claim in a theme listed below. Never state a fact that is not in the list you were given.',
  '- Do not estimate market sizes, revenue, timing, or anything the list does not contain.',
  '- No advice about raising money, investing, taxes, or legal structure.',
  '- Reply with [] if the themes do not support a claim yet.',
].join('\n');

export type StoredProposal = {
  id: number;
  kind: string;
  payload_json: string;
  model: string | null;
  task: string | null;
  status: string;
  created_at: string;
};

/** One project's pending proposals, newest first. */
export async function listPending(env: Env, projectId: number): Promise<StoredProposal[]> {
  const r = await env.DB.prepare(
    `SELECT id, kind, payload_json, model, task, status, created_at
       FROM validate_proposals
      WHERE project_id = ? AND status = 'pending'
      ORDER BY id DESC
      LIMIT 50`,
  ).bind(projectId).all<StoredProposal>();
  return (r.results || []) as StoredProposal[];
}

/**
 * Everything this project has ever been offered of one kind, pending or
 * decided. Used to avoid re-proposing something already thrown away, which is
 * the fastest way to make an assistant feel broken.
 */
export async function priorPayloads(env: Env, projectId: number, kind: ProposalKind): Promise<string[]> {
  const r = await env.DB.prepare(
    'SELECT payload_json FROM validate_proposals WHERE project_id = ? AND kind = ? LIMIT 500',
  ).bind(projectId, kind).all<{ payload_json: string }>();
  return (r.results || []).map((row) => String(row.payload_json || ''));
}
