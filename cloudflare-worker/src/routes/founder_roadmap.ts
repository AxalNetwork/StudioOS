/**
 * The roadmap's dependency graph and its saved scenarios. Task #176, FB3.
 *
 * WHAT THIS REPLACES, AND ONE HALF OF IT WAS NOT A GAP. `/build/roadmap` draws
 * four chips and its instrument is a `Item | Quarter | State | Blocks` table
 * headed "Dependency chain · Unresolved links flagged".
 *
 *   · `Scenarios` was honestly refused — "no roadmap scenario is stored".
 *   · `Dependencies` WAS LIVE AND COULD NEVER SHOW A ROW. The page filtered on
 *     `item.dependency || item.dependencies || item.blocks`, and `roadmap_okrs`
 *     has none of those columns while `OKR_SELECT` in `progress.ts` returns none
 *     of them. The chip drew, selected, and emptied the table under the words
 *     "items naming a dependency" — which a founder reads as "you have none".
 *     An `unbuilt` reason at least explains itself; this explained nothing, and
 *     no guard could see it, because the guards count refusals.
 *
 * WHY A ROUTER OF ITS OWN RATHER THAN MORE OF `progress.ts`. That file already
 * owns the OKR rows themselves and is 1400 lines; the graph is a different store
 * with a different write shape, and its one read needs the OKRs anyway. It gates
 * on the same two predicates the sibling founder routers use —
 * `canReadBoard`/`canWrite`, imported rather than re-derived.
 *
 * RISK IS NOT HERE, AND THAT IS DELIBERATE. The artboard's `At risk` stat has no
 * store and no derivation the graph can support — `services/okrGraph.ts` carries
 * the proof that the obvious one is provably empty. The route reports what it
 * can count and the page says what it cannot, rather than filling a card with a
 * number that means nothing.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canReadBoard, canWrite, type ProjectRef } from './_founder_validate_helpers';
import { statesFor, wouldCycle, scenarioDiff, STATE_LABELS, type OkrEdge } from '../services/okrGraph';

const founderRoadmap = new Hono<{ Bindings: Env }>();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const forbidden = () => json({ detail: 'Forbidden' }, 403);
const notFound = (what: string) => json({ detail: `${what} not found` }, 404);

const trimOrNull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

/**
 * A positive integer id, or null.
 *
 * `Number(null)` and `Number('')` are both 0 and both finite — the #203 trap —
 * so emptiness is checked before `Number()`. HERE THAT IS BELT AND BRACES RATHER
 * THAN THE ONLY GUARD, and the distinction is worth stating because a mutation
 * proved it: every caller below rejects a falsy id as well, so coercing first
 * would still answer 400 rather than searching for objective zero. The check
 * stays because the next caller may not be so careful, and because `0` reaching
 * a `WHERE id = ?` is a silent empty result rather than an error.
 */
function idOrNull(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const GRAPH_DDL = [
  `CREATE TABLE IF NOT EXISTS okr_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    okr_id INTEGER NOT NULL,
    blocks_okr_id INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_okr_dependencies_pair ON okr_dependencies(okr_id, blocks_okr_id)',
  'CREATE INDEX IF NOT EXISTS idx_okr_dependencies_project ON okr_dependencies(project_id)',
  'CREATE INDEX IF NOT EXISTS idx_okr_dependencies_blocked ON okr_dependencies(blocks_okr_id)',
  `CREATE TABLE IF NOT EXISTS roadmap_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE (project_id, name)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_roadmap_scenarios_project ON roadmap_scenarios(project_id, created_at)',
  `CREATE TABLE IF NOT EXISTS roadmap_scenario_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    okr_id INTEGER NOT NULL,
    quarter TEXT,
    UNIQUE (scenario_id, okr_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_roadmap_scenario_items_scenario ON roadmap_scenario_items(scenario_id)',
];

/**
 * The runtime bootstrap, cached PER DATABASE on a `WeakMap` keyed on `env.DB`.
 *
 * A module-level `let` is the #203 bug: the isolate is reused across requests
 * that may carry different bindings, so one success would mark the schema ready
 * for a database that has never seen it. Never a boolean.
 */
const GRAPH_READY = new WeakMap<object, boolean>();

async function ensureGraphSchema(env: Env): Promise<boolean> {
  const key = env.DB as unknown as object;
  if (!key) return false;
  if (GRAPH_READY.get(key)) return true;
  try {
    for (const sql of GRAPH_DDL) await env.DB.prepare(sql).run();
    GRAPH_READY.set(key, true);
    return true;
  } catch (e) {
    console.error('[founder_roadmap] schema bootstrap:', (e as Error).message);
    return false;
  }
}

type ProjectRow = ProjectRef & { name: string };

async function loadProject(env: Env, projectId: number): Promise<ProjectRow | null> {
  return env.DB.prepare('SELECT id, name, founder_id FROM projects WHERE id = ?')
    .bind(projectId).first<ProjectRow>();
}

type OkrRow = { id: number; objective: string; kanban_status: string | null; quarter: string | null; sort_order: number };
type DepRow = { id: number; okr_id: number; blocks_okr_id: number; note: string | null; created_at: string };

async function loadOkrs(env: Env, projectId: number): Promise<OkrRow[]> {
  const r = await env.DB.prepare(
    'SELECT id, objective, kanban_status, quarter, sort_order FROM roadmap_okrs'
    + ' WHERE project_id = ? ORDER BY sort_order ASC, id ASC',
  ).bind(projectId).all<OkrRow>();
  return r.results || [];
}

async function loadDeps(env: Env, projectId: number): Promise<DepRow[]> {
  const r = await env.DB.prepare(
    'SELECT id, okr_id, blocks_okr_id, note, created_at FROM okr_dependencies'
    + ' WHERE project_id = ? ORDER BY id ASC',
  ).bind(projectId).all<DepRow>();
  return r.results || [];
}

/**
 * GET /api/founder/roadmap/:projectId — the graph, the scenarios, and the counts.
 *
 * One read for the whole zone. The page needs every item to resolve a `Blocks`
 * cell into names anyway, so splitting this into three endpoints would make the
 * page issue three requests to render one table.
 */
founderRoadmap.get('/:projectId', async (c) => {
  const user = await requireAuth(c) as User;
  const projectId = idOrNull(c.req.param('projectId'));
  if (!projectId) return json({ detail: 'Invalid project id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return notFound('Project');
  if (!canReadBoard(project, user)) return forbidden();

  const okrs = await loadOkrs(c.env, projectId);
  // A venture whose schema has not been bootstrapped reads as a roadmap with no
  // links, not as an error: the items are the point of the page and they load.
  const ready = await ensureGraphSchema(c.env);
  const deps = ready ? await loadDeps(c.env, projectId) : [];

  const states = statesFor(okrs, deps as OkrEdge[]);
  const nameOf = new Map(okrs.map((o) => [Number(o.id), o.objective]));
  const blocksOf = new Map<number, { id: number; okr_id: number; objective: string }[]>();
  const blockedByOf = new Map<number, { id: number; okr_id: number; objective: string }[]>();
  for (const d of deps) {
    const from = Number(d.okr_id);
    const to = Number(d.blocks_okr_id);
    if (!nameOf.has(from) || !nameOf.has(to)) continue;
    if (!blocksOf.has(from)) blocksOf.set(from, []);
    if (!blockedByOf.has(to)) blockedByOf.set(to, []);
    blocksOf.get(from)!.push({ id: d.id, okr_id: to, objective: nameOf.get(to)! });
    blockedByOf.get(to)!.push({ id: d.id, okr_id: from, objective: nameOf.get(from)! });
  }

  const items = okrs.map((o) => {
    const state = states.get(Number(o.id)) ?? 'provisional';
    return {
      id: o.id,
      objective: o.objective,
      quarter: o.quarter,
      kanban_status: o.kanban_status,
      sort_order: o.sort_order,
      state,
      state_label: STATE_LABELS[state],
      blocks: blocksOf.get(Number(o.id)) ?? [],
      blocked_by: blockedByOf.get(Number(o.id)) ?? [],
    };
  });

  let scenarios: unknown[] = [];
  if (ready) {
    const rows = await c.env.DB.prepare(
      'SELECT id, name, note, created_at, updated_at FROM roadmap_scenarios'
      + ' WHERE project_id = ? ORDER BY created_at DESC, id DESC',
    ).bind(projectId).all<{ id: number; name: string; note: string | null; created_at: string; updated_at: string | null }>();
    const list = rows.results || [];
    scenarios = await Promise.all(list.map(async (s) => {
      const si = await c.env.DB.prepare(
        'SELECT okr_id, quarter FROM roadmap_scenario_items WHERE scenario_id = ?',
      ).bind(s.id).all<{ okr_id: number; quarter: string | null }>();
      const moves = scenarioDiff(okrs, si.results || []).map((m) => ({
        ...m, objective: nameOf.get(m.okr_id) ?? null,
      }));
      return { ...s, moves, moves_count: moves.length };
    }));
  }

  // `unresolved` is the count of LINKS whose blocker is not done — the artboard's
  // "1 unresolved" beside the dependency count. It is a property of the edge, not
  // of either item, which is why it is counted here rather than summed off the
  // item states: two unresolved links into one item are two links.
  const doneIds = new Set(okrs.filter((o) => String(o.kanban_status ?? '').trim().toLowerCase() === 'done').map((o) => Number(o.id)));
  const live = deps.filter((d) => nameOf.has(Number(d.okr_id)) && nameOf.has(Number(d.blocks_okr_id)));
  const unresolved = live.filter((d) => !doneIds.has(Number(d.okr_id))).length;

  return json({
    project: { id: project.id, name: project.name },
    items,
    dependencies: live.map((d) => ({
      id: d.id,
      okr_id: d.okr_id,
      blocks_okr_id: d.blocks_okr_id,
      note: d.note,
      created_at: d.created_at,
      resolved: doneIds.has(Number(d.okr_id)),
      from_objective: nameOf.get(Number(d.okr_id)) ?? null,
      to_objective: nameOf.get(Number(d.blocks_okr_id)) ?? null,
    })),
    scenarios,
    stats: {
      items: okrs.length,
      quarters: new Set(okrs.map((o) => o.quarter).filter(Boolean)).size,
      dependencies: live.length,
      unresolved,
      blocked: items.filter((i) => i.state === 'blocked').length,
      scenarios: scenarios.length,
    },
    // The page must not have to infer this from an empty list: a roadmap with no
    // links and a roadmap whose store is not there look identical otherwise.
    store_ready: ready,
  });
});

/**
 * POST /api/founder/roadmap/:projectId/dependencies — record that one item blocks
 * another.
 *
 * FOUR REFUSALS, and each is a state the graph cannot hold rather than a policy:
 * an item cannot block itself; both ends must be on THIS roadmap; the same edge
 * cannot be stored twice; and a cycle is refused because two items blocking each
 * other can never be cleared by anybody.
 */
founderRoadmap.post('/:projectId/dependencies', async (c) => {
  const user = await requireAuth(c) as User;
  const projectId = idOrNull(c.req.param('projectId'));
  if (!projectId) return json({ detail: 'Invalid project id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return forbidden();
  if (!await ensureGraphSchema(c.env)) return json({ detail: 'Dependency store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const okrId = idOrNull(body.okr_id);
  const blocksId = idOrNull(body.blocks_okr_id);
  if (!okrId || !blocksId) return json({ detail: 'Both okr_id and blocks_okr_id are required' }, 400);
  if (okrId === blocksId) return json({ detail: 'An objective cannot block itself' }, 400);

  const okrs = await loadOkrs(c.env, projectId);
  const here = new Set(okrs.map((o) => Number(o.id)));
  if (!here.has(okrId) || !here.has(blocksId)) {
    return json({ detail: 'Both objectives must be on this roadmap' }, 400);
  }

  const deps = await loadDeps(c.env, projectId);
  if (deps.some((d) => Number(d.okr_id) === okrId && Number(d.blocks_okr_id) === blocksId)) {
    return json({ detail: 'That link is already recorded' }, 409);
  }
  if (wouldCycle(deps as OkrEdge[], okrId, blocksId)) {
    return json({
      detail: 'That link would make two objectives block each other',
      cycle: true,
    }, 409);
  }

  const res = await c.env.DB.prepare(
    'INSERT INTO okr_dependencies (project_id, okr_id, blocks_okr_id, note, created_by)'
    + ' VALUES (?,?,?,?,?)',
  ).bind(projectId, okrId, blocksId, trimOrNull(body.note), user.id ?? null).run();

  return json({ id: res.meta?.last_row_id ?? null, okr_id: okrId, blocks_okr_id: blocksId }, 201);
});

/** DELETE /api/founder/roadmap/dependencies/:id — remove one link. */
founderRoadmap.delete('/dependencies/:id', async (c) => {
  const user = await requireAuth(c) as User;
  const id = idOrNull(c.req.param('id'));
  if (!id) return json({ detail: 'Invalid id' }, 400);
  if (!await ensureGraphSchema(c.env)) return json({ detail: 'Dependency store unavailable' }, 503);

  const row = await (c.env as Env).DB.prepare(
    'SELECT project_id FROM okr_dependencies WHERE id = ?',
  ).bind(id).first<{ project_id: number }>();
  if (!row) return notFound('Dependency');
  const project = await loadProject(c.env, Number(row.project_id));
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return forbidden();

  await c.env.DB.prepare('DELETE FROM okr_dependencies WHERE id = ?').bind(id).run();
  return json({ deleted: true });
});

/**
 * PUT /api/founder/roadmap/:projectId/scenarios — save a named what-if.
 *
 * The whole item list is replaced on every save rather than merged, because a
 * scenario is one coherent story about where the work lands. Merging would let a
 * founder who removed an item from the story find it still in it.
 */
founderRoadmap.put('/:projectId/scenarios', async (c) => {
  const user = await requireAuth(c) as User;
  const projectId = idOrNull(c.req.param('projectId'));
  if (!projectId) return json({ detail: 'Invalid project id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return forbidden();
  if (!await ensureGraphSchema(c.env)) return json({ detail: 'Scenario store unavailable' }, 503);

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const name = trimOrNull(body.name);
  if (!name) return json({ detail: 'A scenario needs a name' }, 400);
  const id = idOrNull(body.id);

  const okrs = await loadOkrs(c.env, projectId);
  const here = new Set(okrs.map((o) => Number(o.id)));
  const raw = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const items: { okr_id: number; quarter: string | null }[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    const okrId = idOrNull(entry?.okr_id);
    if (!okrId || !here.has(okrId)) {
      return json({ detail: 'A scenario may only move objectives on this roadmap' }, 400);
    }
    // Last write wins on a duplicate rather than 409: a form that sent the same
    // objective twice has one intent, and the UNIQUE index would reject the whole
    // save over a detail the founder cannot see.
    if (seen.has(okrId)) items.splice(items.findIndex((i) => i.okr_id === okrId), 1);
    seen.add(okrId);
    items.push({ okr_id: okrId, quarter: trimOrNull(entry?.quarter) });
  }

  let scenarioId = id;
  if (scenarioId) {
    const owned = await (c.env as Env).DB.prepare(
      'SELECT project_id FROM roadmap_scenarios WHERE id = ?',
    ).bind(scenarioId).first<{ project_id: number }>();
    if (!owned) return notFound('Scenario');
    if (Number(owned.project_id) !== projectId) return forbidden();
    await c.env.DB.prepare(
      "UPDATE roadmap_scenarios SET name = ?, note = ?, updated_at = datetime('now') WHERE id = ?",
    ).bind(name, trimOrNull(body.note), scenarioId).run();
  } else {
    const clash = await (c.env as Env).DB.prepare(
      'SELECT id FROM roadmap_scenarios WHERE project_id = ? AND name = ?',
    ).bind(projectId, name).first<{ id: number }>();
    if (clash) return json({ detail: 'A scenario with that name is already saved' }, 409);
    const res = await c.env.DB.prepare(
      'INSERT INTO roadmap_scenarios (project_id, name, note, created_by) VALUES (?,?,?,?)',
    ).bind(projectId, name, trimOrNull(body.note), user.id ?? null).run();
    scenarioId = Number(res.meta?.last_row_id ?? 0) || null;
    if (!scenarioId) return json({ detail: 'The scenario could not be saved' }, 500);
  }

  await c.env.DB.prepare('DELETE FROM roadmap_scenario_items WHERE scenario_id = ?').bind(scenarioId).run();
  for (const item of items) {
    await c.env.DB.prepare(
      'INSERT INTO roadmap_scenario_items (scenario_id, okr_id, quarter) VALUES (?,?,?)',
    ).bind(scenarioId, item.okr_id, item.quarter).run();
  }

  const moves = scenarioDiff(okrs, items);
  return json({ id: scenarioId, name, items: items.length, moves: moves.length }, id ? 200 : 201);
});

/** DELETE /api/founder/roadmap/scenarios/:id — the scenario and its item rows. */
founderRoadmap.delete('/scenarios/:id', async (c) => {
  const user = await requireAuth(c) as User;
  const id = idOrNull(c.req.param('id'));
  if (!id) return json({ detail: 'Invalid id' }, 400);
  if (!await ensureGraphSchema(c.env)) return json({ detail: 'Scenario store unavailable' }, 503);

  const row = await (c.env as Env).DB.prepare(
    'SELECT project_id FROM roadmap_scenarios WHERE id = ?',
  ).bind(id).first<{ project_id: number }>();
  if (!row) return notFound('Scenario');
  const project = await loadProject(c.env, Number(row.project_id));
  if (!project) return notFound('Project');
  if (!canWrite(project, user)) return forbidden();

  await c.env.DB.prepare('DELETE FROM roadmap_scenario_items WHERE scenario_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM roadmap_scenarios WHERE id = ?').bind(id).run();
  return json({ deleted: true });
});

export default founderRoadmap;
