/**
 * The two writes Validate has, in one place each.
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
 */
export async function insertHypothesis(
  env: Env, projectId: number, claim: string,
): Promise<InsertedHypothesis> {
  const max = await env.DB.prepare(
    "SELECT COALESCE(MAX(CAST(substr(code, 2) AS INTEGER)), 0) AS n FROM hypotheses WHERE project_id = ? AND code GLOB 'H*'",
  ).bind(projectId).first<{ n: number }>();
  const code = `H${Number(max?.n || 0) + 1}`;

  const r = await env.DB.prepare(
    `INSERT INTO hypotheses (project_id, code, claim, sort_order)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM hypotheses WHERE project_id = ?))`,
  ).bind(projectId, code, claim, projectId).run();

  return { id: Number(r.meta?.last_row_id || 0), code, claim };
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

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO pain_group_aliases
       (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phrase_norm)
       DO UPDATE SET group_id = excluded.group_id,
                     display_phrase = excluded.display_phrase,
                     updated_at = excluded.updated_at`,
  ).bind(projectId, groupId, norm, display, now, now).run();
  return true;
}
