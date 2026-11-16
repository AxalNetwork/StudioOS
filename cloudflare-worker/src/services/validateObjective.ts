/**
 * D5997 (#5997) — the venture's validation objective, "Trying to learn:" on
 * the Validate overview (board V1), read with the overview as `objective`.
 *
 *   { state: 'ok', text, updated_at, updated_by_name, restate }
 *   { state: 'unavailable', reason }        the read failed (#5129's honest state)
 *
 * `text` null is Not recorded: no row, or a row a writer cleared. The store is
 * migration 202611151331's `validation_objectives`; its one writer is
 * `setValidationObjective` in `services/validateWriters.ts`.
 *
 * `restate` is board V11's "After Pivot: restate the objective": true only for
 * a viewer who may write and read decisions, when the venture's current given
 * decision (D693's one reader, `currentDecision`) is Pivot and the objective
 * was not written at or after that decision. A partner never reads decisions,
 * so the flag is never computed for one and says nothing about the verdict. A
 * decision that cannot be read leaves `restate` false: the prompt is an
 * invitation, and its absence claims nothing.
 */
import type { Env } from '../types';
import { currentDecision } from './verdict';

export type ObjectivePart =
  | { state: 'ok'; text: string | null; updated_at: string | null; updated_by_name: string | null; restate: boolean }
  | { state: 'unavailable'; reason: string };

/** SQLite's `datetime('now')` and an ISO stamp, as milliseconds; NaN for anything else. */
export function stampMs(v: string | null | undefined): number {
  const s = String(v ?? '').trim();
  if (!s) return Number.NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

export async function objectiveOf(env: Env, projectId: number, viewer: { writer: boolean; decisions: boolean }): Promise<ObjectivePart> {
  type Row = { objective: string | null; updated_at: string | null; updated_by_name: string | null };
  let row: Row | null;
  try {
    row = await env.DB.prepare(
      `SELECT o.objective, o.updated_at, u.name AS updated_by_name
         FROM validation_objectives o LEFT JOIN users u ON u.id = o.updated_by
        WHERE o.project_id = ?`,
    ).bind(projectId).first<Row>();
  } catch (e) {
    console.warn('[validateObjective] objective unreadable:', (e as Error)?.message);
    return { state: 'unavailable', reason: 'What you are trying to learn could not be read.' };
  }
  const text = typeof row?.objective === 'string' && row.objective.trim() ? row.objective : null;
  let restate = false;
  if (viewer.writer && viewer.decisions) {
    try {
      const d = await currentDecision(env, projectId, 'venture');
      if (d?.decision === 'pivot') {
        const written = text ? stampMs(row?.updated_at) : Number.NaN;
        const decided = stampMs(d.decided_at);
        restate = !(written >= decided);
      }
    } catch (e) {
      console.warn('[validateObjective] decision unreadable:', (e as Error)?.message);
    }
  }
  return {
    state: 'ok', text,
    updated_at: row?.updated_at ?? null,
    updated_by_name: row?.updated_by_name ?? null,
    restate,
  };
}
