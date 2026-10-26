/**
 * D968 (#3351, part of #2426) — each accepted, landed plan item's later
 * stages, read from the row it landed in: a feature's or must-have's Built,
 * a roadmap item's Built and Live, a formation step's Built, a test's Tested.
 * Mounted at `GET /api/cycles/build/plan/states` (routes/build_plan.ts),
 * beside D1068's handoffs and links, with the same readers.
 *
 * WHAT EACH STAGE IS READ FROM, and only that. A stage is one of:
 *   - `{ reported: true, done: true, at, source, value }`: the source says it is
 *     done. `at` is the day it changed when the table stores one, else null
 *     with `at_reason`, never a guessed day;
 *   - `{ reported: true, done: false, source, value }`: the source says it is
 *     not done yet;
 *   - `{ reported: false, reason }`: no source reports this stage for this
 *     item, so Progress says "Not recorded", never "Not yet".
 * A stage that does not apply to a kind is left out.
 *
 *   mvp_features (feature, must-have)  Built: delivery_status 'Done', the day from
 *                                      `done_at` (migration 441's triggers write it
 *                                      on each move into Done and clear it on a move out).
 *   roadmap_okrs (roadmap)             Built: kanban 'done' or a shipped release.
 *                                      Live: the GitHub release that shipped it
 *                                      (`shipped_release_id`), dated `published_at`.
 *   formation_steps (formation-step)   Built: state 'done'. No day is stored.
 *   hypothesis_experiments (test)      Tested: status 'done', with its result. No day is stored.
 *
 * No connector feeds a deploy, so a feature's Live is not reported, and no
 * column is added here for a day a table does not keep (the issue's rule).
 */
import type { Env } from '../types';

export const STATES_PAGE = 200;
export const STATES_PAGE_MAX = 500;

type Stage =
  | { reported: true; done: true; at: string | null; at_reason?: string; source: string; value: string | null }
  | { reported: true; done: false; source: string; value: string | null }
  | { reported: false; reason: string };

const SOURCE = {
  mvp: 'Build › MVP scope',
  roadmap: 'Build › Roadmap',
  release: 'Connector · GitHub release',
  formation: 'Build › Formation',
  experiment: 'Validate › Experiments',
};
export const NO_DEPLOY = 'No connector reports a deploy here';
export const NO_TEST = 'No test is linked to this item';
export const NO_RELEASE = 'No release names this item';
export const ROW_GONE = 'The row it landed in is no longer on this venture';
export const NO_DAY = {
  roadmap: 'The roadmap stores no day an item moved to Done',
  formation: 'Formation steps store no day a step was done',
  experiment: 'Experiments store no day they were done',
  mvp: 'No day was recorded when it moved to Done',
};

const day = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const done = (source: string, at: string | null, atReason: string, value: string | null): Stage =>
  (at ? { reported: true, done: true, at, source, value } : { reported: true, done: true, at: null, at_reason: atReason, source, value });
const notDone = (source: string, value: string | null): Stage => ({ reported: true, done: false, source, value });
const unreported = (reason: string): Stage => ({ reported: false, reason });

/** One item's stages from its joined row. Pure, so each rule is tested alone. */
export function stagesOf(r: any): { built?: Stage; live?: Stage; tested?: Stage } {
  switch (r.landed_table) {
    case 'mvp_features': {
      if (r.f_id == null) return { built: unreported(ROW_GONE), live: unreported(ROW_GONE), tested: unreported(ROW_GONE) };
      const status = r.f_status ?? null;
      return {
        built: status === 'Done' ? done(SOURCE.mvp, day(r.f_done_at), NO_DAY.mvp, status) : notDone(SOURCE.mvp, status),
        live: unreported(NO_DEPLOY),
        tested: unreported(NO_TEST),
      };
    }
    case 'roadmap_okrs': {
      if (r.o_id == null) return { built: unreported(ROW_GONE), live: unreported(ROW_GONE), tested: unreported(ROW_GONE) };
      const released = r.r_id != null;
      const release = released ? (r.r_name || r.r_tag || 'A release') : null;
      const isDone = String(r.o_status ?? '').toLowerCase() === 'done';
      return {
        built: released ? done(SOURCE.release, day(r.r_published_at), NO_DAY.roadmap, release)
          : isDone ? done(SOURCE.roadmap, null, NO_DAY.roadmap, 'Done') : notDone(SOURCE.roadmap, r.o_status ?? null),
        live: released ? done(SOURCE.release, day(r.r_published_at), 'The release carries no publish day', release) : unreported(NO_RELEASE),
        tested: unreported(NO_TEST),
      };
    }
    case 'formation_steps':
      if (r.s_id == null) return { built: unreported(ROW_GONE) };
      return { built: r.s_state === 'done' ? done(SOURCE.formation, null, NO_DAY.formation, 'Done') : notDone(SOURCE.formation, r.s_state ?? null) };
    case 'hypothesis_experiments': {
      if (r.e_id == null) return { tested: unreported(ROW_GONE) };
      const result = typeof r.e_result === 'string' && r.e_result.trim() ? r.e_result.trim().slice(0, 300) : null;
      return { tested: r.e_status === 'done' ? done(SOURCE.experiment, null, NO_DAY.experiment, result) : notDone(SOURCE.experiment, r.e_status ?? null) };
    }
    default:
      return {};
  }
}

/**
 * The venture's accepted, landed items with their later stages, paged. Every
 * statement is bound; each landed table is joined on its own literal predicate
 * and the venture, so no item reads another venture's row.
 */
export async function listStates(env: Env, projectId: number, limit = STATES_PAGE, offset = 0) {
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    WHERE i.project_id = ? AND q.status IN ('accepted', 'edited') AND i.landed_table IS NOT NULL AND i.landed_id IS NOT NULL`)
    .bind(projectId).first<{ n: number }>();
  const rows = (await env.DB.prepare(`SELECT i.uid, i.kind, i.landed_table, i.landed_id,
      f.id AS f_id, f.delivery_status AS f_status, f.done_at AS f_done_at,
      o.id AS o_id, o.kanban_status AS o_status, r.id AS r_id, r.tag AS r_tag, r.name AS r_name, r.published_at AS r_published_at,
      s.id AS s_id, s.state AS s_state,
      e.id AS e_id, e.status AS e_status, e.result AS e_result
    FROM build_plan_items i
    JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    LEFT JOIN mvp_features f ON i.landed_table = 'mvp_features' AND f.id = CAST(i.landed_id AS INTEGER) AND f.project_id = i.project_id
    LEFT JOIN roadmap_okrs o ON i.landed_table = 'roadmap_okrs' AND o.id = CAST(i.landed_id AS INTEGER) AND o.project_id = i.project_id
    LEFT JOIN roadmap_releases r ON r.id = o.shipped_release_id AND r.project_id = o.project_id
    LEFT JOIN formation_steps s ON i.landed_table = 'formation_steps' AND s.id = CAST(i.landed_id AS INTEGER) AND s.project_id = i.project_id
    LEFT JOIN hypothesis_experiments e ON i.landed_table = 'hypothesis_experiments' AND e.id = CAST(i.landed_id AS INTEGER) AND e.project_id = i.project_id
    WHERE i.project_id = ? AND q.status IN ('accepted', 'edited') AND i.landed_table IS NOT NULL AND i.landed_id IS NOT NULL
    ORDER BY i.created_at, i.uid LIMIT ? OFFSET ?`).bind(projectId, limit, offset).all<any>()).results || [];
  return {
    states: rows.map((r) => ({ plan_item_uid: r.uid, kind: r.kind, landed_table: r.landed_table, landed_id: String(r.landed_id), ...stagesOf(r) })),
    total: Number(total?.n) || 0, limit, offset,
  };
}
