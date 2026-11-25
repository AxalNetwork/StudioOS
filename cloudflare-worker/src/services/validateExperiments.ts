/** D6017 (#6017): V9's venture-wide experiment read, independent of hypothesis pagination. */
import type { Env } from '../types';

type Experiment = { id: number; hypothesis_id: number; code: string; claim: string; title: string; method: string | null; target: string | null;
  status: string; result: string | null; stopped_at?: string | null; result_direction?: string | null; result_recorded_at?: string | null };
export async function experimentsPart(ctx: { env: Env; projectId: number; canWrite?: boolean }) {
  try {
    const res = await ctx.env.DB.prepare(`SELECT e.*, h.code, h.claim FROM hypothesis_experiments e
      JOIN hypotheses h ON h.id = e.hypothesis_id AND h.project_id = e.project_id
      WHERE e.project_id = ? AND h.retired_at IS NULL ORDER BY e.id DESC`).bind(ctx.projectId).all<Experiment>();
    return { state: 'ok', rows: (res.results || []).map((e) => {
      const observed = e.status === 'done' && !!e.result?.trim() && !e.stopped_at;
      return { id: e.id, hypothesis_id: e.hypothesis_id, code: e.code, title: e.title, method: e.method, target: e.target,
        status: e.stopped_at ? 'stopped' : e.status === 'done' ? observed ? 'completed' : 'result_needed' : e.status,
        observed: observed ? e.result : null, direction: observed ? e.result_direction ?? null : null,
        stopped_at: e.stopped_at ?? null, result_recorded_at: observed ? e.result_recorded_at ?? null : null,
        href: `/validate/experiments/${e.hypothesis_id}?project=${ctx.projectId}`,
        lovable: { cycle: 'validate', project_id: ctx.projectId, record: { kind: 'experiment', id: String(e.id) },
          can_launch: ctx.canWrite === true && e.status === 'planned' && !e.stopped_at } };
    }) };
  } catch { return { state: 'unreadable', rows: null }; }
}
