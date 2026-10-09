/**
 * D658 (#1471) — a structured interview's placements: stored, and decided one
 * at a time. Mounted beside `founder_validate.ts` at /api/founder/validate.
 *
 *   POST /placements/:id/accept    accept, or edit then accept ({ payload })
 *   POST /placements/:id/discard   discard; nothing is written anywhere
 *
 * The session routes that CREATE placements (`/sessions/:id/structure`,
 * `/sessions/:id/ask` and the review read) read #1470's transcript segments,
 * and follow once that table is on main. `storePlacements` below is what they
 * will call.
 *
 * ONE ROW, ONE WRITER. A placement is a `validate_proposals` row (migration
 * 439) with a `run_id`. Accept claims it with the store's own idiom,
 * `WHERE id = ? AND status = 'pending'`, then writes through the module's own
 * writer in `_founder_validate_writes.ts` — the function the manual route
 * calls — so an accepted placement and a hand-typed value are the same row.
 * A kind whose writer has not merged (#1472's segment, demand signal and
 * competitor; market facts) is refused with `writer_not_available` and stays
 * proposed.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite } from './_founder_validate_helpers';
import { insertHypothesisLink, setInterviewIcpFit, upsertPainSeverity } from './_founder_validate_writes';
import { normPhrase } from '../services/painGroups';
import {
  PLACEMENT_KINDS,
  isPlacementKind,
  storedSeverity,
  type Placement,
  type PlacementKind,
  type StructureContext,
} from '../services/interviewStructuring';

const structure = new Hono<{ Bindings: Env }>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface PlacementRow {
  id: number;
  project_id: number;
  kind: string;
  payload_json: string;
  edited_payload_json: string | null;
  status: string;
  run_id: string | null;
  target_ref: string | null;
}

/** The interview a placement is about, from its `target_ref` ("interview:<id>"). */
export function interviewOf(targetRef: string | null): number | null {
  const m = /^interview:(\d+)$/.exec(String(targetRef || ''));
  return m ? Number(m[1]) : null;
}

/** The project's hypotheses and pain groups: what a placement may name. */
export async function loadStructureContext(env: Env, projectId: number): Promise<StructureContext> {
  const [h, g] = await Promise.all([
    env.DB.prepare('SELECT id, code, claim FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id')
      .bind(projectId).all<{ id: number; code: string; claim: string }>(),
    env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ? ORDER BY id')
      .bind(projectId).all<{ id: number; title: string }>(),
  ]);
  return { hypotheses: h.results ?? [], painGroups: g.results ?? [] };
}

/**
 * Store one run's placements, all pending, under one `run_id`. Every one has
 * a cited span by construction (`parsePlacements` drops the rest), and the
 * passage rides in `citation_json` so the review can show it without
 * re-reading the transcript.
 */
export async function storePlacements(
  env: Env,
  opts: {
    projectId: number;
    sessionId: number | null;
    interviewId: number;
    runId: string;
    userId: number;
    model: string;
    placements: readonly Placement[];
  },
): Promise<number> {
  if (!opts.placements.length) return 0;
  await env.DB.batch(opts.placements.map((p) => env.DB.prepare(
    `INSERT INTO validate_proposals
       (project_id, kind, payload_json, model, task, created_by, surface, fill_class,
        citation_json, target_ref, session_id, cite_from, cite_to, run_id)
     VALUES (?, ?, ?, ?, 'structure_interview', ?, 'validate/interview', 'restatement', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    opts.projectId, p.kind, JSON.stringify(p.payload), opts.model, opts.userId,
    JSON.stringify({ kind: 'transcript', session_id: opts.sessionId, from: p.cite.from, to: p.cite.to, quote: p.quote }),
    `interview:${opts.interviewId}`, opts.sessionId, p.cite.from, p.cite.to, opts.runId,
  )));
  return opts.placements.length;
}

async function loadPlacement(env: Env, id: number): Promise<PlacementRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await env.DB.prepare(
    `SELECT id, project_id, kind, payload_json, edited_payload_json, status, run_id, target_ref
       FROM validate_proposals WHERE id = ? AND run_id IS NOT NULL`,
  ).bind(id).first<PlacementRow>()) || null;
}

async function authorise(c: any, row: PlacementRow): Promise<User | Response> {
  const user = (await requireAuth(c)) as User;
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(row.project_id).first() as { id: number; founder_id: number | null } | null;
  if (!project) return json({ detail: 'Project not found' }, 404);
  if (!canWrite(project, user)) return json({ detail: 'Forbidden' }, 403);
  return user;
}

/**
 * Write one accepted placement through its module's writer. Throws
 * `not_this_project` when the row it names is not the placement's project's,
 * which puts the placement back to pending.
 */
async function applyPlacement(env: Env, row: PlacementRow, kind: PlacementKind, payload: Record<string, unknown>): Promise<void> {
  if (kind === 'pain_severity' || kind === 'icp_fit') {
    const interviewId = interviewOf(row.target_ref);
    const owner = interviewId
      ? await env.DB.prepare('SELECT project_id FROM discovery_interviews WHERE id = ?').bind(interviewId).first<{ project_id: number }>()
      : null;
    if (!owner || Number(owner.project_id) !== Number(row.project_id)) throw new Error('not_this_project');
    if (kind === 'pain_severity') {
      await upsertPainSeverity(env, interviewId!, normPhrase(String(payload.phrase)), storedSeverity(payload.severity as 'severe' | 'real' | 'mild'));
    } else {
      await setInterviewIcpFit(env, interviewId!, String(payload.fit));
    }
    return;
  }
  if (kind === 'evidence') {
    const ok = await insertHypothesisLink(
      env, row.project_id, Number(payload.hypothesis_id), Number(payload.pain_group_id),
      payload.direction === 'refutes' ? 'contradicts' : 'supports',
    );
    if (!ok) throw new Error('not_this_project');
    return;
  }
  throw new Error('writer_not_available');
}

structure.post('/placements/:id/accept', async (c) => {
  const row = await loadPlacement(c.env, Number(c.req.param('id')));
  if (!row) return json({ detail: 'Placement not found' }, 404);
  const user = await authorise(c, row);
  if (user instanceof Response) return user;
  if (!isPlacementKind(row.kind)) return json({ error: 'unknown_kind', detail: 'This placement can no longer be applied.' }, 409);
  const kind = row.kind;
  const spec = PLACEMENT_KINDS[kind];
  if (!spec.writer) {
    return json({
      error: 'writer_not_available',
      detail: 'This module cannot take a placement yet. It stays proposed until its store is built.',
    }, 409);
  }
  if (row.status !== 'pending') return json({ error: 'not_pending', detail: 'This placement was already decided.' }, 409);

  // EDIT THEN ACCEPT. The edit is validated as strictly as the model's own
  // payload was, against this project's rows; the model's payload is kept.
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  let edited: Record<string, unknown> | null = null;
  if (body && body.payload && typeof body.payload === 'object') {
    edited = spec.parse(body.payload as Record<string, unknown>, await loadStructureContext(c.env, row.project_id));
    if (!edited) return json({ error: 'invalid_edit', detail: 'That edit is not a valid value for this module.' }, 422);
  }
  let payload: Record<string, unknown>;
  try { payload = edited ?? JSON.parse(row.payload_json); } catch {
    return json({ error: 'unreadable', detail: 'This placement could not be read.' }, 422);
  }

  const claim = await c.env.DB.prepare(
    `UPDATE validate_proposals SET status = 'accepted', decided_by = ?, decided_at = datetime('now'), edited_payload_json = ?
      WHERE id = ? AND status = 'pending'`,
  ).bind(user.id, edited ? JSON.stringify(edited) : null, row.id).run();
  if (!claim.meta?.changes) return json({ error: 'not_pending', detail: 'This placement was already decided.' }, 409);

  try {
    await applyPlacement(c.env, row, kind, payload);
  } catch (e) {
    await c.env.DB.prepare(
      `UPDATE validate_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL, edited_payload_json = NULL WHERE id = ?`,
    ).bind(row.id).run();
    const msg = (e as Error).message;
    if (msg === 'not_this_project') return json({ error: 'not_this_project', detail: 'The row this names is no longer on this project.' }, 409);
    console.error('[validate/placements] accept failed', msg);
    return json({ error: 'apply_failed', detail: 'The placement could not be written. It is still proposed.' }, 500);
  }
  return json({ ok: true, id: row.id, kind, edited: !!edited, payload });
});

structure.post('/placements/:id/discard', async (c) => {
  const row = await loadPlacement(c.env, Number(c.req.param('id')));
  if (!row) return json({ detail: 'Placement not found' }, 404);
  const user = await authorise(c, row);
  if (user instanceof Response) return user;
  const res = await c.env.DB.prepare(
    `UPDATE validate_proposals SET status = 'discarded', decided_by = ?, decided_at = datetime('now')
      WHERE id = ? AND status = 'pending'`,
  ).bind(user.id, row.id).run();
  if (!res.meta?.changes) return json({ error: 'not_pending', detail: 'This placement was already decided.' }, 409);
  return json({ ok: true, id: row.id });
});

export default structure;
