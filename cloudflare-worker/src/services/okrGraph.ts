/**
 * The roadmap dependency graph: what blocks what, and what that makes at risk.
 *
 * Task #176, FB3. Migration 254 stores the edges; this file is the only place
 * that turns them into the four states the artboard's `State` column draws —
 * Blocked, At risk, In flight, Provisional — and it is pure so the rules can be
 * exercised by calling them rather than through a route.
 *
 * ONE DERIVED STATE, NOT TWO — AND THE MISSING ONE IS THE POINT OF THIS NOTE.
 *
 *   · BLOCKED — at least one item that blocks this one is not `done`. Direct,
 *     one hop, no judgement.
 *
 * The artboard's `State` column draws a fourth value, **At risk**, and it is
 * deliberately absent here. The obvious derivation — "downstream of something
 * blocked, but not itself blocked" — is PROVABLY EMPTY: if `B` is blocked then
 * `B` is not done, and any `X` that `B` blocks therefore has an unresolved direct
 * upstream, which makes `X` blocked by the rule above. There is no item the
 * transitive rule can reach that the direct rule has not already claimed. Shipping
 * it would have produced a state that can never appear — the same live-but-empty
 * failure this whole change exists to fix, re-introduced one file away from its
 * own fix.
 *
 * Nor can the artboard's own rows be reverse-engineered into a rule: `Handoff
 * schema` is Blocked and blocks two items, of which one is drawn **In flight** and
 * the other **At risk**. Two items with the identical relationship to the identical
 * blocker carry different states, so the copy is illustrative and there is no rule
 * in it to recover. Inventing one is what #176 says not to do.
 *
 * So risk is what the store cannot say, and `/build/roadmap` says that instead of
 * showing a number. If a founder ever records WHY an item is stuck, or when it
 * became stuck, that is the column risk would be derived from — and it is a
 * different change, with a store behind it.
 *
 * WHAT THE RULE DOES NOT READ. Not a date, not an age, not a quarter. The
 * artboard's copy mentions a dependency "open eleven days"; `okr_dependencies`
 * records `created_at`, so the age of the LINK is available, but the age of the
 * BLOCKAGE is not — nothing records when an item became stuck. Calling a link's
 * age the blockage's age would be a specific, confident, wrong number, so the
 * route reports the link's age as the link's age and the page labels it that way.
 */
import type { Env } from '../types';

export type OkrNode = {
  id: number;
  kanban_status?: string | null;
  quarter?: string | null;
};

export type OkrEdge = {
  /** The blocker. */
  okr_id: number;
  /** The blocked. */
  blocks_okr_id: number;
};

export type OkrState = 'blocked' | 'in_flight' | 'provisional' | 'done';

/** `done` is the only status that resolves a dependency. */
export const isResolved = (node: OkrNode | undefined): boolean =>
  String(node?.kanban_status ?? '').trim().toLowerCase() === 'done';

/**
 * Edges grouped both ways, dropping any that names an id the node set does not
 * have.
 *
 * A DANGLING EDGE IS DROPPED RATHER THAN TREATED AS UNRESOLVED, and the direction
 * matters: an edge pointing at a deleted OKR would otherwise mark its neighbour
 * blocked forever with nothing on screen to explain it. The route deletes edges
 * with the OKR, so this is the belt to that braces — but a fixture, a partial
 * read or a race can still produce one, and "blocked by something that does not
 * exist" is the worst answer of the three available.
 */
export function indexEdges(nodes: OkrNode[], edges: OkrEdge[]) {
  const known = new Set(nodes.map((n) => Number(n.id)));
  const blockedBy = new Map<number, number[]>();
  const blocks = new Map<number, number[]>();
  for (const e of edges) {
    const from = Number(e.okr_id);
    const to = Number(e.blocks_okr_id);
    if (!known.has(from) || !known.has(to) || from === to) continue;
    if (!blocks.has(from)) blocks.set(from, []);
    if (!blockedBy.has(to)) blockedBy.set(to, []);
    blocks.get(from)!.push(to);
    blockedBy.get(to)!.push(from);
  }
  return { blockedBy, blocks };
}

/**
 * Would adding `okr_id → blocks_okr_id` close a cycle?
 *
 * A CYCLE IS NOT A DATA-INTEGRITY NICETY HERE — it is an infinite walk in
 * `statesFor` below and a pair of items that block each other forever, which no
 * founder can ever clear. The route refuses the edge rather than storing it and
 * defending against it at every read.
 *
 * Answered by asking whether the proposed blocked item can already reach the
 * proposed blocker: if `B` already blocks `A` (directly or through a chain),
 * then `A` blocking `B` closes the loop.
 */
export function wouldCycle(edges: OkrEdge[], okrId: number, blocksOkrId: number): boolean {
  if (okrId === blocksOkrId) return true;
  const out = new Map<number, number[]>();
  for (const e of edges) {
    const from = Number(e.okr_id);
    if (!out.has(from)) out.set(from, []);
    out.get(from)!.push(Number(e.blocks_okr_id));
  }
  const seen = new Set<number>([blocksOkrId]);
  const queue = [blocksOkrId];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of out.get(at) ?? []) {
      if (next === okrId) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * Each item's state, by id.
 *
 * ORDER OF PRECEDENCE, and it is a decision rather than an accident: `done`
 * first, then `blocked`, then the stored column. A finished item is not blocked
 * however tangled its upstream is — saying otherwise would put a warning on work
 * nobody has to do again.
 */
export function statesFor(nodes: OkrNode[], edges: OkrEdge[]): Map<number, OkrState> {
  const { blockedBy } = indexEdges(nodes, edges);
  const byId = new Map(nodes.map((n) => [Number(n.id), n]));
  const out = new Map<number, OkrState>();

  for (const node of nodes) {
    const id = Number(node.id);
    if (isResolved(node)) { out.set(id, 'done'); continue; }
    const upstream = blockedBy.get(id) ?? [];
    if (upstream.some((from) => !isResolved(byId.get(from)))) { out.set(id, 'blocked'); continue; }
    // The stored column decides the rest. `now` is work in hand; everything else
    // — `next`, `later`, an unrecognised value, or none — is not yet committed,
    // which is what the artboard calls Provisional.
    out.set(id, String(node.kanban_status ?? '').trim().toLowerCase() === 'now' ? 'in_flight' : 'provisional');
  }
  return out;
}

/**
 * The label the `State` column draws.
 *
 * No `At risk` entry, and its absence is load-bearing rather than an omission —
 * the header docblock has the proof that the state can never be occupied.
 */
export const STATE_LABELS: Record<OkrState, string> = {
  blocked: 'Blocked',
  in_flight: 'In flight',
  provisional: 'Provisional',
  done: 'Done',
};

/**
 * A scenario's effect on the live roadmap: which items it moves, and where to.
 *
 * AN ITEM WITH NO SCENARIO ROW IS NOT MOVED — it is absent, not blank. And a row
 * whose quarter equals the live one is a row that changes nothing, reported as
 * such rather than counted as a move: a founder reading "moves 6 items" wants the
 * six that actually differ.
 */
export function scenarioDiff(
  nodes: OkrNode[],
  items: { okr_id: number; quarter?: string | null }[],
): { okr_id: number; from: string | null; to: string | null }[] {
  const byId = new Map(nodes.map((n) => [Number(n.id), n]));
  const out: { okr_id: number; from: string | null; to: string | null }[] = [];
  for (const item of items) {
    const id = Number(item.okr_id);
    const node = byId.get(id);
    if (!node) continue;
    const from = (node.quarter ?? null) || null;
    const to = (item.quarter ?? null) || null;
    if (from === to) continue;
    out.push({ okr_id: id, from, to });
  }
  return out;
}

export type EdgeWrite =
  | { ok: true; id: number | null; okr_id: number; blocks_okr_id: number }
  | { ok: false; status: 400 | 409; detail: string; cycle?: true };

/**
 * Record that `okrId` blocks `blocksOkrId` on one roadmap (D690, #1693
 * decision 4: "Waits on X" is an edge from X). The one edge write, so the
 * founder roadmap and Build refuse the same four states the graph cannot hold:
 * an item blocking itself, an end on another roadmap, the same edge twice, and
 * a cycle through `wouldCycle`. The only function here that reads the store;
 * the caller has checked access and that the store exists.
 */
export async function addOkrDependency(env: Env, input: {
  projectId: number; okrId: number; blocksOkrId: number; note: string | null; userId: number | null;
  /** D690 (#1695 decision 15): statements that land with the edge, in its batch (Build's activity row). */
  also?: ReturnType<Env['DB']['prepare']>[];
}): Promise<EdgeWrite> {
  const { projectId, okrId, blocksOkrId } = input;
  if (okrId === blocksOkrId) return { ok: false, status: 400, detail: 'An objective cannot block itself' };
  const okrs = await env.DB.prepare('SELECT id FROM roadmap_okrs WHERE project_id = ?').bind(projectId).all<{ id: number }>();
  const here = new Set((okrs.results || []).map((o) => Number(o.id)));
  if (!here.has(okrId) || !here.has(blocksOkrId)) return { ok: false, status: 400, detail: 'Both objectives must be on this roadmap' };
  const deps = await env.DB.prepare('SELECT okr_id, blocks_okr_id FROM okr_dependencies WHERE project_id = ? ORDER BY id ASC')
    .bind(projectId).all<OkrEdge>();
  const edges = deps.results || [];
  if (edges.some((d) => Number(d.okr_id) === okrId && Number(d.blocks_okr_id) === blocksOkrId)) {
    return { ok: false, status: 409, detail: 'That link is already recorded' };
  }
  if (wouldCycle(edges, okrId, blocksOkrId)) {
    return { ok: false, status: 409, detail: 'That link would make two objectives block each other', cycle: true };
  }
  const insert = env.DB.prepare(
    'INSERT INTO okr_dependencies (project_id, okr_id, blocks_okr_id, note, created_by)'
    + ' VALUES (?,?,?,?,?)',
  ).bind(projectId, okrId, blocksOkrId, input.note, input.userId);
  const [res] = input.also?.length ? await env.DB.batch([insert, ...input.also]) : [await insert.run()];
  return { ok: true, id: res.meta?.last_row_id ?? null, okr_id: okrId, blocks_okr_id: blocksOkrId };
}
