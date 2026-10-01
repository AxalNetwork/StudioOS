/**
 * Swimlanes on the founder's execution board, and the WIP limit that refuses a card.
 *
 * WHAT THIS REPLACES. `/build/board` (FB2) draws five chips and TWO OF THEM WERE
 * NOT IN THE REGISTRY AT ALL — `Engineering` and `GTM` existed only as one entry
 * whose reason read "a card carries a stage, not a lane, and no lane is stored".
 * `Configure lanes` was `unbuilt` and its reason named the fix: "the six lanes are
 * written into the code twice and no per-project stage list is stored, so there is
 * nothing for an editor to change". `Bulk move` was `unbuilt` too. Migration 253
 * gives all three something to read and write. Task #176.
 *
 * A LANE IS NOT A STATUS. The status is where a card is in its life; the lane is
 * whose work it is. The canvas's table carries both on every row, and its note
 * depends on the difference: "Engineering is one card over its WIP limit of four,
 * which is why the permissions card sits in backlog rather than starting."
 *
 * THE CARDS ARE `mvp_tasks`, KEYED ON `deal_id`, AND THAT IS A `projects.id`. Same
 * misnaming D86 recorded for `metrics_snapshots`: `routes/pipeline.ts`'s
 * `/projects/:id/detail` binds the project id straight into `WHERE deal_id = ?`,
 * and the founder board has always read it that way. Nothing here renames the
 * column — the whole board would have to move at once — but every statement below
 * says which it means.
 *
 * WHY A FOUNDER ROUTER AND NOT `pipeline.ts`. That file is the studio's own view of
 * its portfolio, gated for admins and partners; this is the founder's view of their
 * own board, gated by `canReadBoard`/`canWrite` — the same two predicates
 * `founder_validate.ts` and `founder_cadence.ts` use, imported rather than
 * re-derived.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, canWrite, type ProjectRef } from './_founder_validate_helpers';

const founderBoard = new Hono<{ Bindings: Env }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const forbidden = () => json({ detail: 'Forbidden' }, 403);
const notFound = (what: string) => json({ detail: `${what} not found` }, 404);

/**
 * Statuses that are NOT counted against a WIP limit.
 *
 * `todo` is backlog — the canvas's own note has a card sitting there precisely
 * BECAUSE the lane is full, so counting backlog would make the limit
 * self-fulfilling. `done` is finished work.
 *
 * ANYTHING ELSE COUNTS, INCLUDING A STATUS NOBODY HERE RECOGNISES. `mvp_tasks.status`
 * is free text from the client, so the list cannot be exhaustive — and the
 * conservative reading of an unknown status is "somebody is doing this", which makes
 * the limit hold a little too tightly rather than not at all. A WIP limit that can
 * be walked past by inventing a status is not a limit.
 */
const NOT_IN_FLIGHT = new Set(['todo', 'backlog', 'done', 'cancelled', 'archived']);

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/**
 * A whole number, or null — emptiness checked BEFORE `Number()`.
 *
 * `Number('')` is 0 and finite, and here 0 is a REAL WIP limit: a lane closed to
 * new work, which is how a founder pauses a workstream without deleting its cards.
 * So a blank coerced first would close a lane the founder meant to leave unlimited.
 */
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

type ProjectRow = ProjectRef & { name: string };

async function loadProject(env: Env, projectId: number): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT id, name, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<ProjectRow>();
}

async function scope(
  c: any, projectId: number, gate: (p: ProjectRef, u: User) => boolean,
): Promise<{ user: User; project: ProjectRow } | Response> {
  if (!Number.isFinite(projectId)) return json({ detail: 'Invalid project id' }, 400);
  const user = (await requireAuth(c)) as User;
  const project = await loadProject(c.env, projectId);
  if (!project) return notFound('Project');
  if (!gate(project, user)) return forbidden();
  return { user, project };
}

/**
 * Migration 253's table and column, bootstrapped at runtime.
 *
 * The ALTER is separate and its failure is IGNORED, because `ADD COLUMN` on a column
 * that exists throws "duplicate column name" — which is the success case on every
 * request after the first. Keyed on `env.DB` for the reason #203 found.
 */
const LANES_READY = new WeakMap<object, boolean>();
export async function ensureLanesSchema(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (LANES_READY.get(key)) return true;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS project_lanes ('
      + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
      + 'project_id INTEGER NOT NULL, '
      + 'name TEXT NOT NULL, '
      + 'wip_limit INTEGER, '
      + 'sort_order INTEGER NOT NULL DEFAULT 0, '
      + 'created_by INTEGER, '
      + "created_at TEXT NOT NULL DEFAULT (datetime('now')), "
      + 'updated_at TEXT, '
      + 'UNIQUE (project_id, name))',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_project_lanes_project ON project_lanes(project_id, sort_order)',
    );
    // Separate, and swallowed: "duplicate column name" is what success looks like
    // from the second request onward.
    try { await env.DB.exec('ALTER TABLE mvp_tasks ADD COLUMN lane TEXT'); } catch (e) { void e; }
    LANES_READY.set(key, true);
    return true;
  } catch (e) {
    console.error('[founder_board] ensureLanesSchema:', (e as Error).message);
    return false;
  }
}

type LaneRow = {
  id: number; name: string; wip_limit: number | null; sort_order: number; updated_at: string | null;
};
type CardRow = {
  id: number; title: string; status: string; lane: string | null;
  assigned_to: number | null; created_at: string | null; updated_at: string | null;
};

/**
 * GET /api/founder/board/:projectId — the lanes, the cards, and each lane's load.
 *
 * THE CARDS COME BACK TOO, and that is not duplication of
 * `/pipeline/projects/:id/detail`. That endpoint's `SELECT *` predates the `lane`
 * column and returns stages, metrics and decision gates the board does not draw;
 * this returns the five fields the artboard's table has columns for, plus the lane.
 * A page reading lanes from here and cards from there would show a card in a lane it
 * had already been moved out of.
 */
founderBoard.get('/:projectId', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canReadBoard);
  if (got instanceof Response) return got;

  if (!(await ensureLanesSchema(c.env))) {
    return json({ project_id: projectId, store_ready: false, lanes: [], cards: [] });
  }

  const [lanes, cards] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, name, wip_limit, sort_order, updated_at FROM project_lanes'
      + ' WHERE project_id = ? ORDER BY sort_order ASC, name ASC',
    ).bind(projectId).all<LaneRow>().then((r) => r.results || []).catch(() => [] as LaneRow[]),
    // `deal_id` IS the project id — see this file's header.
    c.env.DB.prepare(
      'SELECT id, title, status, lane, assigned_to, created_at, updated_at'
      + ' FROM mvp_tasks WHERE deal_id = ? ORDER BY status, created_at LIMIT 500',
    ).bind(projectId).all<CardRow>().then((r) => r.results || []).catch(() => [] as CardRow[]),
  ]);

  const inFlight = (lane: string | null) => cards.filter(
    (k) => (k.lane || null) === lane && !NOT_IN_FLIGHT.has(String(k.status || '').toLowerCase()),
  ).length;

  return json({
    project_id: projectId,
    store_ready: true,
    lanes: lanes.map((l) => ({
      ...l,
      cards: cards.filter((k) => k.lane === l.name).length,
      in_flight: inFlight(l.name),
      // `over_limit` IS COMPUTED AND NOT STORED, and `wip_limit == null` is not the
      // same as 0: no limit can never be over, a limit of zero is over the moment
      // one card is in flight.
      over_limit: l.wip_limit != null && inFlight(l.name) > l.wip_limit,
    })),
    // Cards with no lane, and cards naming a lane that was deleted, are BOTH
    // reported rather than hidden. A card nobody can see is worse than a lane
    // nobody configured.
    unassigned_cards: cards.filter((k) => !k.lane).length,
    orphan_lanes: [...new Set(cards.map((k) => k.lane).filter(
      (n): n is string => Boolean(n) && !lanes.some((l) => l.name === n),
    ))],
    cards,
  });
});

/**
 * PUT /api/founder/board/:projectId/lanes — add a lane, or edit one.
 *
 * UPSERT ON THE NAME, because `UNIQUE (project_id, name)` says there is one lane per
 * name: setting Engineering's WIP limit twice is editing one row. `id` in the body
 * switches it to a RENAME of that row instead, which is the one operation the name
 * key cannot express.
 */
founderBoard.put('/:projectId/lanes', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canWrite);
  if (got instanceof Response) return got;
  if (!(await ensureLanesSchema(c.env))) return json({ detail: 'Lane store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const name = trimOrNull(body?.name);
  if (!name) return json({ detail: 'A lane needs a name' }, 400);
  if (name.length > 60) return json({ detail: 'A lane name is at most 60 characters' }, 400);
  const wip = intOrNull(body?.wip_limit);
  const order = intOrNull(body?.sort_order) ?? 0;
  const id = intOrNull(body?.id);

  if (id != null) {
    // A rename. The lane's own project is checked from the ROW, not the URL, so a
    // caller cannot rename another venture's lane by passing its id.
    const existing = await c.env.DB.prepare(
      'SELECT id, name, project_id FROM project_lanes WHERE id = ?',
    ).bind(id).first<{ id: number; name: string; project_id: number }>();
    if (!existing || Number(existing.project_id) !== projectId) return notFound('Lane');
    await c.env.DB.prepare(
      "UPDATE project_lanes SET name = ?, wip_limit = ?, sort_order = ?, updated_at = datetime('now')"
      + ' WHERE id = ?',
    ).bind(name, wip, order, id).run();
    // THE CARDS FOLLOW THE RENAME. The lane is stored on the card as a name
    // (migration 253 says why), so a rename that did not carry the cards would
    // orphan every one of them into a lane that no longer exists.
    if (existing.name !== name) {
      await c.env.DB.prepare('UPDATE mvp_tasks SET lane = ? WHERE deal_id = ? AND lane = ?')
        .bind(name, projectId, existing.name).run();
    }
    return json({ id, name, wip_limit: wip, renamed_from: existing.name === name ? null : existing.name });
  }

  const res = await c.env.DB.prepare(
    'INSERT INTO project_lanes (project_id, name, wip_limit, sort_order, created_by)'
    + ' VALUES (?, ?, ?, ?, ?)'
    + ' ON CONFLICT(project_id, name) DO UPDATE SET'
    + " wip_limit = excluded.wip_limit, sort_order = excluded.sort_order, updated_at = datetime('now')",
  ).bind(projectId, name, wip, order, got.user.id ?? null).run();
  return json({ id: res.meta?.last_row_id ?? null, name, wip_limit: wip, sort_order: order }, 201);
});

/**
 * DELETE /api/founder/board/lanes/:id — retire a lane; its cards survive.
 *
 * The cards are moved to NO LANE rather than deleted. Deleting a lane is a statement
 * about how work is organised, not about the work — a founder collapsing two lanes
 * into one must not lose the cards in either.
 */
founderBoard.delete('/lanes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return json({ detail: 'Invalid id' }, 400);
  const row = await (c.env as Env).DB.prepare('SELECT id, name, project_id FROM project_lanes WHERE id = ?')
    .bind(id).first<{ id: number; name: string; project_id: number }>();
  if (!row) return notFound('Lane');
  const got = await scope(c, Number(row.project_id), canWrite);
  if (got instanceof Response) return got;

  await c.env.DB.prepare('UPDATE mvp_tasks SET lane = NULL WHERE deal_id = ? AND lane = ?')
    .bind(row.project_id, row.name).run();
  await c.env.DB.prepare('DELETE FROM project_lanes WHERE id = ?').bind(id).run();
  return json({ id, deleted: true, cards_unassigned: true });
});

/** The statuses a bulk move may set. Free text is refused here even though the
 * column allows it: a typo'd status makes a column of cards no filter can find. */
const BULK_STATUSES = new Set(['todo', 'in_progress', 'review', 'blocked', 'done']);

/**
 * POST /api/founder/board/:projectId/cards/bulk — `Bulk move`.
 *
 * `{ ids: [...], lane?: string|null, status?: string }`. At least one of `lane` or
 * `status`, or there is nothing to do.
 *
 * THE WIP LIMIT IS ENFORCED HERE, AND REFUSING IS THE POINT. The artboard's
 * instrument is headed "WIP limits enforced" and its note says "The limit is a
 * configuration, not a suggestion — the board refuses the fifth card." A limit that
 * only colours a number red is a suggestion, so a bulk move that would put a lane
 * over its limit writes NOTHING and says which lane and by how much. All-or-nothing
 * rather than partial: a bulk move that moved four of six cards and reported an
 * error leaves the founder to work out which four.
 *
 * `lane: null` CLEARS the lane, which is why the field is checked for presence
 * rather than truthiness — `if (lane)` would make "move these back to no lane"
 * impossible to express.
 */
founderBoard.post('/:projectId/cards/bulk', async (c) => {
  const projectId = Number(c.req.param('projectId'));
  const got = await scope(c, projectId, canWrite);
  if (got instanceof Response) return got;
  if (!(await ensureLanesSchema(c.env))) return json({ detail: 'Lane store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({} as any));
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n)))]
    : [];
  if (!ids.length) return json({ detail: 'No cards selected' }, 400);
  if (ids.length > 200) return json({ detail: 'At most 200 cards in one move' }, 400);

  const setsLane = Object.prototype.hasOwnProperty.call(body, 'lane');
  const lane = setsLane ? trimOrNull(body.lane) : undefined;
  const status = body?.status != null && BULK_STATUSES.has(String(body.status))
    ? String(body.status) : null;
  // THE UNKNOWN-STATUS CHECK GOES FIRST, and a test found out why. With it second, a
  // request carrying only a typo'd status fell through to "Nothing to change" —
  // because an unrecognised status resolves to null and there was then nothing to
  // change. The caller is told they sent an empty instruction when they sent a wrong
  // one, which is the message that sends them looking in the wrong place.
  if (body?.status != null && !status) {
    return json({ detail: 'Unknown status', statuses: [...BULK_STATUSES] }, 400);
  }
  if (!setsLane && !status) return json({ detail: 'Nothing to change' }, 400);

  // Every selected card must be THIS project's. Checked by counting rather than by
  // trusting the ids: a bulk endpoint is the easiest place to move another venture's
  // cards by passing their ids alongside your own.
  /**
   * `?,?,?` — one per id, and the ONLY interpolation in this file.
   *
   * `check-sql-prepare` flags it and it is on record as safe, with the argument
   * written here rather than only in a baseline file. `ids` was built two lines up
   * from `Number()` + `Number.isFinite` + `new Set`, so it is a deduplicated array
   * of finite numbers and nothing else; this string is derived from its LENGTH and
   * contains only `?` and `,`. Every id itself is bound. `board_lanes.test.ts`
   * asserts the shape, so the claim is held by a test and not by this paragraph.
   *
   * SQLite has no array binding, so `IN (?)` cannot take a list — `pipeline.ts:200`
   * does the same thing for the same reason.
   */
  const placeholders = ids.map(() => '?').join(',');
  const owned = await c.env.DB.prepare(
    `SELECT id, status, lane FROM mvp_tasks WHERE deal_id = ? AND id IN (${placeholders})`,
  ).bind(projectId, ...ids).all<{ id: number; status: string; lane: string | null }>();
  const mine = owned.results || [];
  if (mine.length !== ids.length) {
    return json({
      detail: 'Some selected cards are not on this board',
      found: mine.length, asked: ids.length,
    }, 404);
  }

  // The lane must exist, when one is being set. A bulk move into a lane nobody
  // configured would create the orphan state the read endpoint reports as a problem.
  if (lane) {
    const laneRow = await c.env.DB.prepare(
      'SELECT id, wip_limit FROM project_lanes WHERE project_id = ? AND name = ?',
    ).bind(projectId, lane).first<{ id: number; wip_limit: number | null }>();
    if (!laneRow) return json({ detail: `No lane called ${lane}` }, 404);

    if (laneRow.wip_limit != null) {
      // WHAT THE LANE WILL HOLD ONCE THIS MOVE LANDS, counted in two parts so a card
      // already in the lane is not counted twice: the in-flight cards that are NOT
      // part of this move, plus the selected cards that will be in flight after it.
      //
      // The status list is repeated in SQL rather than interpolated from
      // `NOT_IN_FLIGHT`, because `check-sql-prepare` exists to stop a set being
      // built into a statement — and `board_lanes.test.ts` asserts the two agree, so
      // the copy cannot drift without failing the build.
      const others = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM mvp_tasks WHERE deal_id = ? AND lane = ?`
        + ` AND id NOT IN (${placeholders})`
        + ` AND lower(status) NOT IN ('todo','backlog','done','cancelled','archived')`,
      ).bind(projectId, lane, ...ids).first<{ n: number }>();
      const incoming = mine.filter(
        (k) => !NOT_IN_FLIGHT.has(String(status || k.status || '').toLowerCase()),
      ).length;
      const total = Number(others?.n ?? 0) + incoming;
      if (total > laneRow.wip_limit) {
        return json({
          detail: `${lane} would be over its WIP limit`,
          lane, wip_limit: laneRow.wip_limit, would_be: total, moved: 0,
        }, 409);
      }
    }
  }

  // ONE UPDATE, so a refused move writes nothing and an accepted one writes
  // everything. A loop would leave a partial board on the first failure.
  if (setsLane && status) {
    await c.env.DB.prepare(
      `UPDATE mvp_tasks SET lane = ?, status = ?, updated_at = CURRENT_TIMESTAMP`
      + ` WHERE deal_id = ? AND id IN (${placeholders})`,
    ).bind(lane, status, projectId, ...ids).run();
  } else if (setsLane) {
    await c.env.DB.prepare(
      `UPDATE mvp_tasks SET lane = ?, updated_at = CURRENT_TIMESTAMP`
      + ` WHERE deal_id = ? AND id IN (${placeholders})`,
    ).bind(lane, projectId, ...ids).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE mvp_tasks SET status = ?, updated_at = CURRENT_TIMESTAMP`
      + ` WHERE deal_id = ? AND id IN (${placeholders})`,
    ).bind(status, projectId, ...ids).run();
  }

  return json({ moved: ids.length, lane: setsLane ? lane : undefined, status: status || undefined });
});

export default founderBoard;
