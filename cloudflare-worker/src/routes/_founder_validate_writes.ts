/**
 * The writes Validate has, in one place each.
 *
 * WHY THIS FILE EXISTS. Accepting an AI proposal has to produce a row
 * indistinguishable from one a founder typed. Two ways in mean two chances to
 * diverge, and the divergence here would not be cosmetic:
 *
 *   · `code` — "H1", "H2" — is allocated from the HIGHEST EVER USED, not from
 *     the current count, so that retiring H2 cannot hand "H2" to a later
 *     claim. A second insert that used `COUNT(*) + 1` would start handing out
 *     duplicates the first time anything was retired, and the UNIQUE index
 *     would surface it as a 500 on accept rather than as the design error it
 *     is.
 *   · A pain alias is UNIQUE on `(project_id, phrase_norm)`, so assignment is
 *     an upsert and never an insert. A second writer that inserted would fail
 *     on any phrase the founder had already grouped by hand — which is
 *     precisely the phrase an AI tagger is most likely to propose.
 *
 * So both live here, `founder_validate.ts` and `_founder_validate_proposals.ts`
 * call the same function, and `progress.ts`'s pain-group route keeps its own
 * body: it does more than assign (it creates groups by title, un-assigns, and
 * returns the whole view) and folding all of that in would be a refactor of a
 * working route rather than the extraction this needs.
 *
 * D757 (#1897): the pain alias and the pain severity also exist as statements
 * (`upsertPainAliasStatement`, `upsertPainSeverityStatement`), so an accepted
 * pain can write its mention, its severity and its theme in one batch, each
 * guarded on the interview's `pains_json` as the batch's caller read it.
 */
import type { Env } from '../types';
import { normPhrase } from '../services/painGroups';

/** The longest phrase the product stores. Mirrors `progress.ts`'s own cap. */
export const MAX_PAIN_PHRASE = 120;

export type InsertedHypothesis = { id: number; code: string; claim: string };

/**
 * One hypothesis, with its code allocated server-side.
 *
 * The `MAX(CAST(substr(code, 2) AS INTEGER))` is the whole point: it reads the
 * highest number ever used on this project, including retired rows, so codes
 * are never reused. `GLOB 'H*'` keeps a hand-edited code out of the maximum.
 *
 * ONE STATEMENT (D690 decision 12, #1692). The code is allocated in the same
 * `INSERT … SELECT` that writes the row, so two creates at once can never both
 * read "H2" and both write "H3": the second used to fail on the unique index
 * `idx_hypotheses_project_code` as a 500. Every caller gets this, the fill
 * accept included.
 */
export async function insertHypothesis(
  env: Env, projectId: number, claim: string, userId: number | null = null,
): Promise<InsertedHypothesis> {
  const row = await insertHypothesisStatement(env, { projectId, claim, userId })
    .first<{ id: number; code: string }>();
  return { id: Number(row?.id || 0), code: String(row?.code || ''), claim };
}

export type NewHypothesis = {
  projectId: number;
  claim: string;
  userId: number | null;
  successBar?: string | null;
  disproof?: string | null;
  deadline?: string | null;
  ownerUserId?: number | null;
};

/**
 * The one `INSERT … SELECT`, as a statement, so a batch can carry it.
 * `RETURNING id, code`. A claim with none of migration 460's fields writes
 * only the columns every caller has always written, so the fill accept and the
 * proposals keep working on a store 460 has not reached.
 */
export function insertHypothesisStatement(env: Env, h: NewHypothesis) {
  const plain = h.successBar == null && h.disproof == null && h.deadline == null && h.ownerUserId == null;
  if (plain) {
    return env.DB.prepare(
      `INSERT INTO hypotheses (project_id, code, claim, sort_order, created_by)
       SELECT ?, 'H' || (COALESCE(MAX(CAST(substr(code, 2) AS INTEGER)), 0) + 1), ?,
              (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hypotheses WHERE project_id = ?), ?
         FROM hypotheses WHERE project_id = ? AND code GLOB 'H*'
       RETURNING id, code`,
    ).bind(h.projectId, h.claim, h.projectId, h.userId, h.projectId);
  }
  return env.DB.prepare(
    `INSERT INTO hypotheses (project_id, code, claim, sort_order, created_by, success_bar, disproof, deadline, owner_user_id)
     SELECT ?, 'H' || (COALESCE(MAX(CAST(substr(code, 2) AS INTEGER)), 0) + 1), ?,
            (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hypotheses WHERE project_id = ?), ?, ?, ?, ?, ?
       FROM hypotheses WHERE project_id = ? AND code GLOB 'H*'
     RETURNING id, code`,
  ).bind(
    h.projectId, h.claim, h.projectId, h.userId, h.successBar ?? null, h.disproof ?? null, h.deadline ?? null,
    h.ownerUserId ?? null, h.projectId,
  );
}

export type HypothesisLinks = { painGroupIds: number[]; direction: 'supports' | 'contradicts' };

/**
 * D690 decision 12 (#1692) — a claim and its pain links, as statements for one
 * batch. The links name the new row as the venture's newest hypothesis, which
 * it is inside the batch (D1 runs a batch as one transaction), and each joins
 * its pain group to this venture, so a foreign group writes no link. D693's
 * Pivot (#1703) puts these in its decision's batch.
 *
 * The caller checks the groups are the venture's first, so a foreign id is a
 * 404 rather than a silently missing link.
 */
export function insertHypothesisWithLinksStatements(env: Env, h: NewHypothesis, links: HypothesisLinks) {
  const out = [insertHypothesisStatement(env, h)];
  for (const gid of [...new Set(links.painGroupIds)]) {
    out.push(env.DB.prepare(
      `INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction)
       SELECT (SELECT MAX(id) FROM hypotheses WHERE project_id = ?), g.id, ?
         FROM pain_groups g WHERE g.id = ? AND g.project_id = ?
       ON CONFLICT(hypothesis_id, pain_group_id, direction) DO NOTHING`,
    ).bind(h.projectId, links.direction, gid, h.projectId));
  }
  return out;
}

/** The claim and its links written in one batch; the new row's id and code. */
export async function insertHypothesisWithLinks(
  env: Env, h: NewHypothesis, links: HypothesisLinks, extra: ReturnType<Env['DB']['prepare']>[] = [],
): Promise<InsertedHypothesis> {
  const results = await env.DB.batch([...insertHypothesisWithLinksStatements(env, h, links), ...extra]);
  const row = (results[0] as { results?: Array<{ id: number; code: string }> })?.results?.[0];
  if (!row) throw new Error('The hypothesis was not written');
  return { id: Number(row.id), code: String(row.code), claim: h.claim };
}

/**
 * Assign one logged phrase to one theme.
 *
 * UPSERT, not insert: `pain_group_aliases` is UNIQUE on
 * `(project_id, phrase_norm)` because a phrase belongs to exactly one group,
 * and re-assigning is the normal case rather than the exception.
 *
 * Returns false when the group is not this project's. That check is not
 * defensive tidiness — without it a proposal could pull another venture's
 * interviews into this venture's evidence count, which is the same tenancy
 * rule `POST /hypotheses/:id/links` enforces one table over.
 */
export async function upsertPainAlias(
  env: Env, projectId: number, groupId: number, phrase: string,
): Promise<boolean> {
  const display = String(phrase || '').trim().slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  if (!display || !norm) return false;

  const group = await env.DB.prepare(
    'SELECT id FROM pain_groups WHERE id = ? AND project_id = ?',
  ).bind(groupId, projectId).first<{ id: number }>();
  if (!group) return false;

  await upsertPainAliasStatement(env, projectId, groupId, display)!.run();
  return true;
}

/**
 * D757 (#1897) — the guard a batch's statements carry: the interview is this
 * project's and its `pains_json` still holds what the caller read (`IS`, so a
 * NULL list matches). When another write changed the list in between, every
 * guarded statement writes nothing.
 */
export type PainsGuard = { interviewId: number; projectId: number; painsJson: string | null };

/**
 * The alias upsert as one statement. The `pain_groups` check keeps the tenancy
 * rule inside the statement: a group that is not `projectId`'s writes nothing.
 * Null for an empty phrase.
 */
export function upsertPainAliasStatement(
  env: Env, projectId: number, groupId: number, phrase: string, guard?: PainsGuard,
) {
  const display = String(phrase || '').trim().slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  if (!display || !norm) return null;
  const now = new Date().toISOString();
  if (!guard) {
    return env.DB.prepare(
      `INSERT INTO pain_group_aliases
         (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM pain_groups WHERE id = ? AND project_id = ?)
       ON CONFLICT(project_id, phrase_norm)
         DO UPDATE SET group_id = excluded.group_id,
                       display_phrase = excluded.display_phrase,
                       updated_at = excluded.updated_at`,
    ).bind(projectId, groupId, norm, display, now, now, groupId, projectId);
  }
  return env.DB.prepare(
    `INSERT INTO pain_group_aliases
       (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM pain_groups WHERE id = ? AND project_id = ?)
        AND EXISTS (SELECT 1 FROM discovery_interviews WHERE id = ? AND project_id = ? AND pains_json IS ?)
     ON CONFLICT(project_id, phrase_norm)
       DO UPDATE SET group_id = excluded.group_id,
                     display_phrase = excluded.display_phrase,
                     updated_at = excluded.updated_at`,
  ).bind(projectId, groupId, norm, display, now, now, groupId, projectId, guard.interviewId, guard.projectId, guard.painsJson);
}

// ---------------------------------------------------------------------------
// D658 (#1471) — three more writes, extracted from `founder_validate.ts` so a
// structured interview's accepted placement and the founder's own edit reach
// the same row through the same statement. The manual routes call these too.
// ---------------------------------------------------------------------------

/**
 * How severe ONE pain was in ONE interview, upserted on the table's own
 * unique index `(interview_id, phrase_norm)`. `phraseNorm` is already
 * `normPhrase`d; `severity` is already validated (`isPainSeverity`).
 */
export async function upsertPainSeverity(
  env: Env,
  interviewId: number,
  phraseNorm: string,
  severity: string,
): Promise<void> {
  await upsertPainSeverityStatement(env, interviewId, phraseNorm, severity).run();
}

/**
 * The severity upsert as one statement (D757, #1897). With `guard` it is an
 * `INSERT … SELECT … WHERE EXISTS (…)`, so it writes nothing once the
 * interview's `pains_json` is no longer what the caller read.
 */
export function upsertPainSeverityStatement(
  env: Env,
  interviewId: number,
  phraseNorm: string,
  severity: string,
  guard?: PainsGuard,
) {
  if (!guard) {
    return env.DB.prepare(
      `INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity)
       VALUES (?, ?, ?)
       ON CONFLICT(interview_id, phrase_norm)
       DO UPDATE SET severity = excluded.severity, updated_at = datetime('now')`,
    ).bind(interviewId, phraseNorm, severity);
  }
  return env.DB.prepare(
    `INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity)
     SELECT ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM discovery_interviews WHERE id = ? AND project_id = ? AND pains_json IS ?)
     ON CONFLICT(interview_id, phrase_norm)
     DO UPDATE SET severity = excluded.severity, updated_at = datetime('now')`,
  ).bind(interviewId, phraseNorm, severity, guard.interviewId, guard.projectId, guard.painsJson);
}

/** An interview's ICP fit: strong, partial or none, or null for not recorded. */
export async function setInterviewIcpFit(env: Env, interviewId: number, fit: string | null): Promise<void> {
  await env.DB.prepare(
    "UPDATE discovery_interviews SET icp_fit = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(fit, interviewId).run();
}

/**
 * A hypothesis ↔ pain-group link, the unit Validate's evidence is counted
 * from. Both ends must belong to `projectId`: without that a link could pull
 * another venture's interviews into this venture's count. Returns null when
 * either end is not this project's. A link that already exists is kept, and
 * `inserted` says whether this call wrote a row, so a repeated link logs no
 * activity for a write that did not happen.
 */
export async function insertHypothesisLink(
  env: Env,
  projectId: number,
  hypothesisId: number,
  painGroupId: number,
  direction: 'supports' | 'contradicts',
): Promise<{ inserted: boolean } | null> {
  const ok = await env.DB.prepare(
    `SELECT 1 AS ok FROM hypotheses h, pain_groups g
      WHERE h.id = ? AND h.project_id = ? AND g.id = ? AND g.project_id = ?`,
  ).bind(hypothesisId, projectId, painGroupId, projectId).first<{ ok: number }>();
  if (!ok) return null;
  const res = await env.DB.prepare(
    `INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction)
     VALUES (?, ?, ?)
     ON CONFLICT(hypothesis_id, pain_group_id, direction) DO NOTHING`,
  ).bind(hypothesisId, painGroupId, direction).run();
  return { inserted: Number(res.meta?.changes ?? 0) > 0 };
}
