/**
 * The one write that adds a competitor by hand, extracted so a fill can call it.
 *
 * WHY THIS FILE EXISTS, and it is the same reason `_founder_validate_writes.ts`
 * exists one surface over: `services/fills/registry.ts` states that an entry's
 * `apply` must call the function the manual form already calls, so accepting a
 * proposal and typing the same thing produce the same row. `POST
 * /competitors/:id/candidates` had its insert INLINE in the route body — four
 * statements, a `position` allocation and an `edited` stamp — so there was no
 * function for a fill to call, and the only alternatives were reimplementing it
 * or leaving the surface unfillable.
 *
 * WHAT WOULD HAVE GONE WRONG WITH A SECOND COPY. `position` is allocated from
 * `MAX(position) + 1` over the analysis, and the canvas orders the board by it;
 * a second writer defaulting to 0 or 999 would put every accepted competitor
 * either on top of the founder's first one or all in a heap at the end. And
 * `competitor_analyses.edited = 1` is what stops a re-run wiping manual rows —
 * a writer that forgot it would let the next discovery run delete a competitor
 * the founder accepted, which is the quietest possible data loss.
 *
 * The route below is unchanged in behaviour: it now calls this instead of
 * carrying the statements itself.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import {
  buildManualCandidate,
  type AnalysisInputs,
  type Candidate,
} from '../services/competitorAnalysis';

export interface ManualCandidateInput {
  name: string;
  url?: string;
  category?: string;
  summary?: string;
  crawl?: boolean;
}

/**
 * Add one competitor to an analysis the caller owns, and return the row written.
 *
 * The ownership check is the CALLER'S, deliberately: the route checks
 * `user_id = ?` before it gets here and a fill checks the project's own analysis,
 * and folding a third check in would make this function's contract depend on
 * which caller it was. What it does guarantee is that the row lands in the right
 * order and that the analysis is marked edited.
 */
export async function insertManualCandidate(
  env: Env,
  userId: number,
  analysisId: string,
  inputs: AnalysisInputs,
  data: ManualCandidateInput,
): Promise<Candidate> {
  const sql = getSQL(env);
  try {
    const posRows = await sql`SELECT COALESCE(MAX(position), -1) AS maxpos FROM competitor_candidates WHERE analysis_id = ${analysisId}`;
    const nextPos = Number(posRows[0]?.maxpos ?? -1) + 1;

    const { candidate, sources, signals } = await buildManualCandidate(env, userId, inputs, data);
    candidate.position = nextPos;

    await sql`INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
      VALUES (${candidate.id}, ${analysisId}, ${candidate.name}, ${candidate.domain}, ${candidate.url}, ${candidate.category}, ${candidate.relevance_score}, ${JSON.stringify(candidate.scores)}, ${candidate.summary}, ${JSON.stringify(candidate.details)}, ${candidate.origin}, ${candidate.position})`;
    for (const s of sources) {
      await sql`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at)
        VALUES (${s.id}, ${analysisId}, ${s.candidate_id}, ${s.url}, ${s.kind}, ${s.title}, ${s.status}, ${s.fetched_at})`;
    }
    for (const g of signals) {
      await sql`INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail)
        VALUES (${g.id}, ${analysisId}, ${g.candidate_id}, ${g.signal_type}, ${g.label}, ${g.detail})`;
    }
    // `edited = 1` is what keeps a re-run from deleting this row. See the header.
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${new Date().toISOString()} WHERE id = ${analysisId}`;
    return candidate;
  } finally {
    await sql.end();
  }
}

/**
 * The analysis a project's competitors belong to, or null.
 *
 * NULL IS AN ANSWER AND NOT A FAILURE, and it is why the competitor fill refuses
 * rather than creating one. Starting an analysis runs discovery and a crawl —
 * the market page's own comment says it "may take a while" — so a fill that
 * bootstrapped one would spend a founder's budget on a job they did not ask for,
 * in a run they asked to be cheap. Eadwyn adds to a list; it does not start one.
 * That is the same shape as the pain tagger, which sorts into themes the founder
 * named and cannot name one.
 */
export async function analysisForProject(
  env: Env, userId: number, projectId: number,
): Promise<{ id: string; inputs: AnalysisInputs; names: string[] } | null> {
  const sql = getSQL(env);
  try {
    const rows = await sql`SELECT id, inputs_json FROM competitor_analyses
      WHERE project_id = ${projectId} AND user_id = ${userId}
      ORDER BY updated_at DESC LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    let inputs: AnalysisInputs;
    try { inputs = JSON.parse(String(row.inputs_json || '{}')) as AnalysisInputs; }
    catch { inputs = {} as AnalysisInputs; }
    const existing = await sql`SELECT name FROM competitor_candidates WHERE analysis_id = ${row.id}`;
    return {
      id: String(row.id),
      inputs,
      names: existing.map((r: any) => String(r.name || '')).filter(Boolean),
    };
  } finally {
    await sql.end();
  }
}
