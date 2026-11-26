/**
 * D8546 (#8546, part of #6006) — Problem discovery's grouping proposals: a pending set of existing phrases,
 * from one venture and possibly from several interviews, offered for ONE target (an existing theme of that
 * venture, or a proposed new title). It is the Worker side of the V17 / V29 "Proposed grouping" card of
 * the Validate v2 canvas (D5995): store and read the set, edit it, discard it, or accept it as one unit.
 *
 * NOTHING MOVES UNTIL A WRITER ACCEPTS. A pending or edited proposal writes no alias and no theme. Accepting
 * lands every member in the target through the same alias upsert as POST /api/progress/pain-groups/:id/assign-many
 * (`upsertPainAliasStatement`'s statement, with the claim guard below), with one activity row of the same
 * action and wording, in ONE `DB.batch`.
 *
 * ONE DECISION. The claim statement is the batch's first: `status = 'pending'` becomes `'accepted'` and
 * stores a fresh `decision_token`. Every other statement writes only `WHERE` that token is the proposal's own,
 * so a second or concurrent accept (its claim changes no row) writes nothing, and a batch that throws leaves
 * the proposal pending with no alias and no theme. The claim also holds the premises read just before it:
 * the target theme still exists in this venture, and each source interview's `pains_json` is still what was
 * read (the `PainsGuard` idiom), so a stale target or source writes nothing and the proposal stays pending.
 *
 * ORIGINAL AND EDIT. `members_json` and the target are written once. A writer's edit lands in `edited_*`
 * beside them, so a reader of the row can tell what was proposed from what was accepted.
 *
 * WHO. Every export here takes the venture's id and trusts the caller's gate: the route
 * (`routes/pain_grouping_proposals.ts`) lets venture writers (`canWrite`) in and nobody else. A read for
 * a non-writer returns nothing (`writer: false`), never a withheld copy: a suggestion's payload is a writer's.
 * A member's wording is the venture's own pain phrase, as the writer's panel shows it; each source carries
 * whether that interview agreed to be quoted, so the card can mark the ones that did not.
 *
 * NO PRODUCER. Nothing here calls a model, bills, or defaults a selection. `proposeGrouping` is the typed
 * ingress a later producer calls with members it already chose.
 */
import type { Env } from '../types';
import { MAX_PAIN_PHRASE } from '../routes/_founder_validate_writes';
import { normPhrase, ensurePainGroupsSchema } from './painGroups';

/** The same 1–100 limit as the manual route (`MAX_BULK_ASSIGN` in routes/progress.ts; a test holds the two equal). */
export const MAX_GROUPING_MEMBERS = 100;
/** The most sources one member names. */
export const MAX_MEMBER_SOURCES = 50;
/** The most distinct interviews one set draws on: the claim binds three values for each, and D1 takes 100 in a statement. */
export const MAX_GROUPING_SOURCES = 30;
/** The manual route's title cap (`MAX_PAIN_TITLE`). */
export const MAX_GROUPING_TITLE = 120;
/** The longest ingress key. */
export const MAX_SOURCE_KEY = 120;

export type GroupingStatus = 'pending' | 'accepted' | 'discarded';

/** A member as the caller names it: one phrase said in one interview. */
export interface MemberInput { phrase: unknown; interview_id: unknown }
/** A stored member: one phrase (once, by its normalized form) and every interview that said it in this set. */
export interface StoredMember { phrase: string; norm: string; interview_ids: number[] }
export type TargetInput = { group_id: unknown } | { new_title: unknown };

export interface Refusal { ok: false; status: 400 | 404 | 409 | 503; code: string; message: string }
const refusal = (status: Refusal['status'], code: string, message: string): Refusal => ({ ok: false, status, code, message });

export interface MemberView {
  phrase: string;
  sources: Array<{ interview_id: number; interviewee: string | null; quote_consent: boolean }>;
}
export interface ProposalView {
  id: number;
  status: GroupingStatus;
  /** The theme the set goes to, or null for a proposed new one. */
  target_group_id: number | null;
  /** That theme's title now, or the proposed new title (the edited one once edited). */
  target_title: string | null;
  members: MemberView[];
  /** True once a writer changed the members or the title; `original` is what was proposed. */
  edited: boolean;
  original: { target_title: string | null; members: MemberView[] };
  created_at: string;
  decided_at: string | null;
  /** The theme the accepted set landed in. */
  accepted_group_id: number | null;
}

type Row = {
  id: number; project_id: number; status: GroupingStatus; target_group_id: number | null; target_title: string | null;
  members_json: string; edited_members_json: string | null; edited_title: string | null; created_at: string;
  decided_at: string | null; accepted_group_id: number | null;
};

const ids = (n: number) => Array.from({ length: n }, () => '?').join(', ');
const parseStrings = (raw: string | null | undefined): string[] => {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))) : []; }
  catch { return []; }
};
const parseMembers = (raw: string | null | undefined): StoredMember[] => {
  try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v as StoredMember[] : []; } catch { return []; }
};

/** The manual route's wording of a phrase: trimmed, then cut as `assign-many` and its alias upsert cut it. */
export function memberWording(raw: unknown): { display: string; norm: string } | null {
  const first = (typeof raw === 'string' ? raw : '').trim().slice(0, 200);
  const display = first.trim().slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  return display && norm ? { display, norm } : null;
}

const cleanTitle = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t.slice(0, MAX_GROUPING_TITLE) : null;
};

/** What the sources said, by interview: the phrases (by normalized form), the raw list the caller read, consent and name. */
type Interviews = Map<number, { norms: Set<string>; painsJson: string | null; consent: boolean; name: string | null }>;

async function loadInterviews(env: Env, projectId: number, interviewIds: number[]): Promise<Interviews> {
  const out: Interviews = new Map();
  if (!interviewIds.length) return out;
  const res = await env.DB.prepare(
    `SELECT id, interviewee_name, quote_consent, pains_json FROM discovery_interviews
      WHERE project_id = ? AND id IN (${ids(interviewIds.length)})`,
  ).bind(projectId, ...interviewIds).all<{ id: number; interviewee_name: string | null; quote_consent: number | null; pains_json: string | null }>();
  for (const r of res.results ?? []) {
    out.set(Number(r.id), {
      norms: new Set(parseStrings(r.pains_json).map((p) => memberWording(p)?.norm).filter((n): n is string => !!n)),
      painsJson: r.pains_json ?? null,
      consent: Number(r.quote_consent) === 1,
      name: r.interviewee_name ?? null,
    });
  }
  return out;
}

/**
 * Check a set of members against the venture. Each source interview must be this venture's and must still hold
 * the phrase; a phrase named by several interviews is one member with every source. The most it keeps is
 * `MAX_GROUPING_MEMBERS` distinct phrases, the manual route's limit.
 */
async function validateMembers(
  env: Env, projectId: number, raw: unknown, stale: boolean,
): Promise<{ ok: true; members: StoredMember[]; interviews: Interviews } | Refusal> {
  if (!Array.isArray(raw) || raw.length === 0) return refusal(400, 'members_required', 'A grouping needs at least one quote.');
  if (raw.length > MAX_GROUPING_MEMBERS * MAX_MEMBER_SOURCES) return refusal(400, 'too_many_members', `A grouping holds at most ${MAX_GROUPING_MEMBERS} quotes.`);
  const byNorm = new Map<string, StoredMember>();
  for (const m of raw as MemberInput[]) {
    const w = memberWording(m && typeof m === 'object' ? m.phrase : null);
    const interviewId = m && typeof m === 'object' ? m.interview_id : null;
    if (!w) return refusal(400, 'invalid_phrase', 'Every quote in a grouping needs its wording.');
    if (typeof interviewId !== 'number' || !Number.isSafeInteger(interviewId) || interviewId < 1) {
      return refusal(400, 'invalid_source', 'Every quote in a grouping names the interview it came from.');
    }
    const have = byNorm.get(w.norm) ?? { phrase: w.display, norm: w.norm, interview_ids: [] };
    if (!have.interview_ids.includes(interviewId)) have.interview_ids.push(interviewId);
    if (have.interview_ids.length > MAX_MEMBER_SOURCES) return refusal(400, 'too_many_members', 'One quote names too many interviews.');
    byNorm.set(w.norm, have);
  }
  if (byNorm.size > MAX_GROUPING_MEMBERS) return refusal(400, 'too_many_members', `A grouping holds at most ${MAX_GROUPING_MEMBERS} quotes.`);
  const members = [...byNorm.values()];
  const sourceIds = [...new Set(members.flatMap((m) => m.interview_ids))];
  if (sourceIds.length > MAX_GROUPING_SOURCES) {
    return refusal(400, 'too_many_sources', `A grouping draws on at most ${MAX_GROUPING_SOURCES} interviews.`);
  }
  const interviews = await loadInterviews(env, projectId, sourceIds);
  for (const m of members) {
    for (const interviewId of m.interview_ids) {
      const iv = interviews.get(interviewId);
      if (!iv) return stale
        ? refusal(409, 'stale_source', 'An interview in this grouping is no longer on this venture. Discard it, or edit the quotes.')
        : refusal(404, 'source_not_found', 'An interview in this grouping is not on this venture.');
      if (!iv.norms.has(m.norm)) return stale
        ? refusal(409, 'stale_source', 'A quote in this grouping is no longer in the interview it came from. Edit the quotes first.')
        : refusal(404, 'member_not_found', 'A quote in this grouping is not in the interview it names.');
    }
  }
  return { ok: true, members, interviews };
}

async function targetOf(env: Env, projectId: number, target: TargetInput, stale: boolean):
Promise<{ ok: true; groupId: number | null; title: string | null; groupTitle: string | null } | Refusal> {
  const t = (target && typeof target === 'object' ? target : {}) as Record<string, unknown>;
  const hasGroup = t.group_id != null;
  const title = cleanTitle(t.new_title);
  if (hasGroup === (title != null)) return refusal(400, 'target_required', 'Choose one theme, or name a new one.');
  if (title != null) return { ok: true, groupId: null, title, groupTitle: null };
  const groupId = t.group_id;
  if (typeof groupId !== 'number' || !Number.isSafeInteger(groupId) || groupId < 1) return refusal(400, 'invalid_group_id', 'That theme id is not valid.');
  await ensurePainGroupsSchema(env);
  const g = await env.DB.prepare('SELECT title FROM pain_groups WHERE id = ? AND project_id = ?').bind(groupId, projectId).first<{ title: string }>();
  if (!g) return stale
    ? refusal(409, 'stale_target', 'The theme this grouping goes to is gone. Discard it.')
    : refusal(404, 'theme_not_found', 'Theme not found on this venture.');
  return { ok: true, groupId, title: null, groupTitle: g.title };
}

async function viewOf(env: Env, projectId: number, rows: Row[]): Promise<ProposalView[]> {
  if (!rows.length) return [];
  const members = (r: Row, edited: boolean) => parseMembers(edited ? r.edited_members_json : r.members_json);
  const interviews = new Map<number, { name: string | null; consent: boolean }>();
  const people = await env.DB.prepare('SELECT id, interviewee_name, quote_consent FROM discovery_interviews WHERE project_id = ?')
    .bind(projectId).all<{ id: number; interviewee_name: string | null; quote_consent: number | null }>();
  for (const r of people.results ?? []) interviews.set(Number(r.id), { name: r.interviewee_name ?? null, consent: Number(r.quote_consent) === 1 });
  const view = (list: StoredMember[]): MemberView[] => list.map((m) => ({
    phrase: m.phrase,
    sources: (m.interview_ids ?? []).map((id) => ({
      interview_id: id, interviewee: interviews.get(id)?.name ?? null, quote_consent: interviews.get(id)?.consent === true,
    })),
  }));
  const titles = new Map<number, string>();
  if (rows.some((r) => r.target_group_id != null)) {
    const res = await env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ?').bind(projectId).all<{ id: number; title: string }>();
    for (const g of res.results ?? []) titles.set(Number(g.id), g.title);
  }
  return rows.map((r) => {
    const edited = r.edited_members_json != null || r.edited_title != null;
    const original = view(members(r, false));
    return {
      id: Number(r.id), status: r.status,
      target_group_id: r.target_group_id == null ? null : Number(r.target_group_id),
      target_title: r.target_group_id != null ? titles.get(Number(r.target_group_id)) ?? null : r.edited_title ?? r.target_title,
      members: r.edited_members_json != null ? view(members(r, true)) : original,
      edited, original: { target_title: r.target_title, members: original },
      created_at: r.created_at, decided_at: r.decided_at, accepted_group_id: r.accepted_group_id == null ? null : Number(r.accepted_group_id),
    };
  });
}

async function loadRow(env: Env, projectId: number, id: number): Promise<Row | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await env.DB.prepare(`SELECT id, project_id, status, target_group_id, target_title, members_json, edited_members_json, edited_title,
         created_at, decided_at, accepted_group_id FROM pain_grouping_proposals WHERE id = ? AND project_id = ?`)
    .bind(id, projectId).first<Row>()) ?? null;
}

/**
 * Store a pending proposal. The typed ingress for the later producer: members already chosen, one target, and
 * an optional `source_key` that makes a replay answer the proposal it already stored. A pending proposal
 * changes no theme.
 */
export async function proposeGrouping(env: Env, input: {
  projectId: number; userId: number | null; members: unknown; target: TargetInput; sourceKey?: string | null;
}): Promise<{ ok: true; proposal: ProposalView; replayed: boolean } | Refusal> {
  const key = input.sourceKey == null ? null : String(input.sourceKey).trim().slice(0, MAX_SOURCE_KEY) || null;
  const target = await targetOf(env, input.projectId, input.target, false);
  if (!target.ok) return target;
  const v = await validateMembers(env, input.projectId, input.members, false);
  if (!v.ok) return v;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO pain_grouping_proposals (project_id, status, target_group_id, target_title, members_json, source_key, created_by, created_at)
       VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, source_key) WHERE source_key IS NOT NULL DO NOTHING`,
    ).bind(input.projectId, target.groupId, target.title, JSON.stringify(v.members), key, input.userId, new Date().toISOString()).run();
    const replayed = Number(res.meta?.changes ?? 0) === 0;
    const row = replayed && key
      ? await env.DB.prepare(`SELECT id, project_id, status, target_group_id, target_title, members_json, edited_members_json, edited_title,
         created_at, decided_at, accepted_group_id FROM pain_grouping_proposals WHERE project_id = ? AND source_key = ?`).bind(input.projectId, key).first<Row>()
      : await env.DB.prepare(`SELECT id, project_id, status, target_group_id, target_title, members_json, edited_members_json, edited_title,
         created_at, decided_at, accepted_group_id FROM pain_grouping_proposals WHERE id = ?`).bind(Number(res.meta?.last_row_id)).first<Row>();
    if (!row) return refusal(503, 'proposal_not_saved', 'The grouping could not be saved. Nothing was changed; try again.');
    return { ok: true, proposal: (await viewOf(env, input.projectId, [row]))[0], replayed };
  } catch {
    return refusal(503, 'proposal_not_saved', 'The grouping could not be saved. Nothing was changed; try again.');
  }
}

/** The venture's proposals, newest last. A non-writer reads none. */
export async function listGroupingProposals(
  env: Env, projectId: number, opts: { writer: boolean; status?: GroupingStatus | 'all'; id?: number },
): Promise<ProposalView[]> {
  if (!opts.writer) return [];
  const status = opts.status ?? 'pending';
  const rows = (await env.DB.prepare(
    `SELECT id, project_id, status, target_group_id, target_title, members_json, edited_members_json, edited_title,
         created_at, decided_at, accepted_group_id FROM pain_grouping_proposals
      WHERE project_id = ? AND (? = 'all' OR status = ?) AND (? = 0 OR id = ?) ORDER BY id LIMIT 200`,
  ).bind(projectId, status, status, opts.id != null ? 1 : 0, opts.id ?? 0).all<Row>()).results ?? [];
  return viewOf(env, projectId, rows);
}

/**
 * Edit a pending proposal: its members, and its title when the target is a proposed new theme. The same checks
 * as the original. The original stays as proposed; the edit is stored beside it.
 */
export async function editGroupingProposal(env: Env, input: {
  projectId: number; id: number; userId: number | null; members?: unknown; title?: unknown;
}): Promise<{ ok: true; proposal: ProposalView } | Refusal> {
  const row = await loadRow(env, input.projectId, input.id);
  if (!row) return refusal(404, 'proposal_not_found', 'Grouping not found on this venture.');
  if (row.status !== 'pending') return refusal(409, 'already_decided', 'This grouping was already decided.');
  const hasMembers = input.members !== undefined;
  const hasTitle = input.title !== undefined;
  if (!hasMembers && !hasTitle) return refusal(400, 'nothing_to_edit', 'Change the quotes or the title.');
  let membersJson = row.edited_members_json;
  if (hasMembers) {
    const v = await validateMembers(env, input.projectId, input.members, false);
    if (!v.ok) return v;
    membersJson = JSON.stringify(v.members);
  }
  let title = row.edited_title;
  if (hasTitle) {
    if (row.target_group_id != null) return refusal(400, 'title_not_editable', 'This grouping goes to an existing theme; its title is the theme\'s own.');
    title = cleanTitle(input.title);
    if (!title) return refusal(400, 'title_required', 'A new theme needs a title.');
  }
  const res = await env.DB.prepare(
    `UPDATE pain_grouping_proposals SET edited_members_json = ?, edited_title = ?, edited_by = ?, edited_at = ?
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(membersJson, title, input.userId, new Date().toISOString(), input.id, input.projectId).run();
  if (!Number(res.meta?.changes ?? 0)) return refusal(409, 'already_decided', 'This grouping was already decided.');
  return { ok: true, proposal: (await viewOf(env, input.projectId, [(await loadRow(env, input.projectId, input.id))!]))[0] };
}

/** Discard a pending proposal. Only its status changes; no theme or alias is read or written. */
export async function discardGroupingProposal(env: Env, input: {
  projectId: number; id: number; userId: number | null;
}): Promise<{ ok: true; proposal: ProposalView } | Refusal> {
  const row = await loadRow(env, input.projectId, input.id);
  if (!row) return refusal(404, 'proposal_not_found', 'Grouping not found on this venture.');
  const res = await env.DB.prepare(
    `UPDATE pain_grouping_proposals SET status = 'discarded', decided_by = ?, decided_at = ?
      WHERE id = ? AND project_id = ? AND status = 'pending'`,
  ).bind(input.userId, new Date().toISOString(), input.id, input.projectId).run();
  if (!Number(res.meta?.changes ?? 0)) return refusal(409, 'already_decided', 'This grouping was already decided.');
  return { ok: true, proposal: (await viewOf(env, input.projectId, [(await loadRow(env, input.projectId, input.id))!]))[0] };
}

/**
 * Accept a pending proposal as one set. Re-reads the target and every source against the venture as it is now;
 * then ONE batch claims the proposal, makes the theme when the target is a new title, upserts every alias and
 * logs one activity row. A claim that changes no row (decided meanwhile, or the premises moved) writes nothing.
 */
export async function acceptGroupingProposal(env: Env, input: {
  projectId: number; id: number; userId: number | null;
}): Promise<{ ok: true; proposal: ProposalView; group_id: number; assigned: number } | Refusal> {
  const row = await loadRow(env, input.projectId, input.id);
  if (!row) return refusal(404, 'proposal_not_found', 'Grouping not found on this venture.');
  if (row.status !== 'pending') return refusal(409, 'already_decided', 'This grouping was already decided.');

  const edited = row.edited_members_json != null;
  const stored = parseMembers(edited ? row.edited_members_json : row.members_json);
  const titleNow = row.target_group_id == null ? cleanTitle(row.edited_title ?? row.target_title) : null;
  const target = await targetOf(env, input.projectId, row.target_group_id != null ? { group_id: row.target_group_id } : { new_title: titleNow }, true);
  if (!target.ok) return target;
  const v = await validateMembers(env, input.projectId, stored.flatMap((m) => m.interview_ids.map((interview_id) => ({ phrase: m.phrase, interview_id }))), true);
  if (!v.ok) return v;

  const n = v.members.length;
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const actor = input.userId == null ? 'system' : `user:${input.userId}`;
  const sources = [...v.interviews.entries()];
  const claim = env.DB.prepare(
    `UPDATE pain_grouping_proposals SET status = 'accepted', decided_by = ?, decided_at = ?, decision_token = ?
      WHERE id = ? AND project_id = ? AND status = 'pending'
        AND (target_group_id IS NULL OR EXISTS (SELECT 1 FROM pain_groups WHERE id = target_group_id AND project_id = ?))
        ${sources.map(() => 'AND EXISTS (SELECT 1 FROM discovery_interviews WHERE id = ? AND project_id = ? AND pains_json IS ?)').join('\n        ')}`,
  ).bind(input.userId, now, token, input.id, input.projectId, input.projectId, ...sources.flatMap(([id, iv]) => [id, input.projectId, iv.painsJson]));
  const guard = [input.id, input.projectId, token];
  const statements = [claim];
  if (target.groupId == null) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO pain_groups (project_id, title, sort_order, created_at, updated_at, created_by)
         SELECT ?, ?, COALESCE((SELECT MAX(sort_order) FROM pain_groups WHERE project_id = ?), -1) + 1, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM pain_grouping_proposals WHERE id = ? AND project_id = ? AND decision_token = ?)`,
      ).bind(input.projectId, target.title, input.projectId, now, now, input.userId, ...guard),
      env.DB.prepare(`UPDATE pain_grouping_proposals SET accepted_group_id = last_insert_rowid() WHERE id = ? AND project_id = ? AND decision_token = ? AND accepted_group_id IS NULL`).bind(...guard),
    );
  } else {
    statements.push(env.DB.prepare(`UPDATE pain_grouping_proposals SET accepted_group_id = ? WHERE id = ? AND project_id = ? AND decision_token = ?`).bind(target.groupId, ...guard));
  }
  for (const m of v.members) {
    statements.push(env.DB.prepare(
      `INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
       SELECT ?, (SELECT accepted_group_id FROM pain_grouping_proposals WHERE id = ? AND project_id = ? AND decision_token = ?), ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM pain_grouping_proposals WHERE id = ? AND project_id = ? AND decision_token = ? AND accepted_group_id IS NOT NULL)
       ON CONFLICT (project_id, phrase_norm)
         DO UPDATE SET group_id = excluded.group_id, display_phrase = excluded.display_phrase, updated_at = excluded.updated_at`,
    ).bind(input.projectId, ...guard, m.norm, m.phrase, now, now, ...guard));
  }
  const quotes = `${n} ${n === 1 ? 'quote' : 'quotes'}`;
  const summary = (target.groupId == null ? `${target.title} created with ${quotes}` : `${quotes} assigned to ${target.groupTitle}`)
    .replace(/\s+/g, ' ').trim().slice(0, 500);
  statements.push(env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, entity_type, entity_id, action, details, actor)
     SELECT ?, ?, 'validate.problem-discovery', CAST(p.accepted_group_id AS TEXT), ?, ?, ? FROM pain_grouping_proposals p
      WHERE p.id = ? AND p.project_id = ? AND p.decision_token = ? AND p.accepted_group_id IS NOT NULL`,
  ).bind(input.projectId, input.userId, target.groupId == null ? 'pain_group_created' : 'pain_group_assigned', summary, actor, ...guard));

  let results: Array<{ meta?: { changes?: number } }>;
  try { results = await env.DB.batch(statements); }
  catch { return refusal(503, 'accept_failed', 'The grouping could not be accepted. Nothing was saved; try again.'); }
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    // The claim changed no row: decided meanwhile, or a premise moved between the read and the claim.
    const now2 = await loadRow(env, input.projectId, input.id);
    if (!now2 || now2.status !== 'pending') return refusal(409, 'already_decided', 'This grouping was already decided.');
    return refusal(409, 'stale_grouping', 'The theme or an interview changed while this was accepted. Nothing was saved; check the grouping and try again.');
  }
  const done = await loadRow(env, input.projectId, input.id);
  return { ok: true, proposal: (await viewOf(env, input.projectId, [done!]))[0], group_id: Number(done!.accepted_group_id), assigned: n };
}
