/**
 * D658 (#1471) — a structured interview's placements: stored, and decided one
 * at a time. Mounted beside `founder_validate.ts` at /api/founder/validate.
 *
 *   POST /sessions/:id/structure    one structuring run over the session's
 *                                   final transcript ({ model? }); a second
 *                                   run is Compare's re-structure
 *   GET  /sessions/:id/placements   every run's placements, and the last two
 *                                   runs aligned by module
 *   POST /sessions/:id/ask          a question answered from the transcript,
 *                                   every answer citing its passage
 *   POST /placements/:id/accept     accept, or edit then accept ({ payload })
 *   POST /placements/:id/discard    discard; nothing is written anywhere
 *
 * Every model call reserves and settles the D640 budget inside `aiRouter.run`
 * and leaves one line in `interview_structure_receipts`, which
 * `GET /sessions/:id/receipt` (founder_validate_sessions.ts) reads beside the
 * speech-to-text lines.
 *
 * ONE ROW, ONE WRITER. A placement is a `validate_proposals` row (migration
 * 439) with a `run_id`. Accept claims it with the store's own idiom,
 * `WHERE id = ? AND status = 'pending'`, then writes through the module's own
 * writer in `_founder_validate_writes.ts` — the function the manual route
 * calls — so an accepted placement and a hand-typed value are the same row.
 * Segment, demand signal and competitor accept through #1472's (D659)
 * writers in `services/validateWriters.ts`; a market fact has no store and
 * is refused with `writer_not_available`, staying proposed.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite } from './_founder_validate_helpers';
import { insertHypothesisLink, setInterviewIcpFit, upsertPainSeverity } from './_founder_validate_writes';
import { normPhrase } from '../services/painGroups';
import {
  WriterError,
  assignInterviewSegment,
  setEvidenceStrength,
  writeCompetitorMention,
  writeDemandSignal,
  writeSegment,
} from '../services/validateWriters';
import { budgetRefusalMessage } from '../services/aiRouter';
import { loadSession, type SessionRow } from '../services/interviewSessions';
import {
  PLACEMENT_KINDS,
  alignRuns,
  askTranscript,
  isPlacementKind,
  structureTranscript,
  toSegments,
  type Placement,
  type PlacementKind,
  type ReceiptLine,
  type SegmentRow,
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
  session_id: number | null;
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
    `SELECT id, project_id, kind, payload_json, edited_payload_json, status, run_id, target_ref, session_id
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
async function applyPlacement(
  env: Env, user: User, row: PlacementRow, kind: PlacementKind, payload: Record<string, unknown>,
): Promise<void> {
  const interviewId = interviewOf(row.target_ref);
  // Every kind below but evidence is about the placement's own interview, so
  // the interview must be this project's: a placement cannot write into
  // another venture's rows.
  const ownInterview = async () => {
    const owner = interviewId
      ? await env.DB.prepare('SELECT project_id FROM discovery_interviews WHERE id = ?').bind(interviewId).first<{ project_id: number }>()
      : null;
    if (!owner || Number(owner.project_id) !== Number(row.project_id)) throw new Error('not_this_project');
    return interviewId!;
  };
  const sessionId = row.session_id ?? null;
  switch (kind) {
    case 'pain_severity':
      // The three-level word itself (D659 widened the column's values).
      await upsertPainSeverity(env, await ownInterview(), normPhrase(String(payload.phrase)), String(payload.severity));
      return;
    case 'icp_fit':
      await setInterviewIcpFit(env, await ownInterview(), String(payload.fit));
      return;
    case 'evidence': {
      const direction = payload.direction === 'refutes' ? 'contradicts' : 'supports';
      const ok = await insertHypothesisLink(
        env, row.project_id, Number(payload.hypothesis_id), Number(payload.pain_group_id), direction,
      );
      if (!ok) throw new Error('not_this_project');
      const link = await env.DB.prepare(
        'SELECT id FROM hypothesis_pain_links WHERE hypothesis_id = ? AND pain_group_id = ? AND direction = ?',
      ).bind(Number(payload.hypothesis_id), Number(payload.pain_group_id), direction).first<{ id: number }>();
      if (link) await setEvidenceStrength(env, { projectId: row.project_id, userId: user.id, linkId: Number(link.id), strength: payload.strength });
      return;
    }
    case 'segment': {
      const iv = await ownInterview();
      const seg = await writeSegment(env, {
        projectId: row.project_id, userId: user.id, name: payload.name, source: 'interview',
        sourceRef: sessionId ? `session:${sessionId}` : `interview:${iv}`,
      });
      await assignInterviewSegment(env, { projectId: row.project_id, userId: user.id, interviewId: iv, segmentId: seg.id });
      return;
    }
    case 'demand_signal':
      // Arrives `to_confirm`, as D659's writer sets it for a non-manual
      // source: a proposal is not counted until the founder confirms it.
      await writeDemandSignal(env, {
        projectId: row.project_id, userId: user.id, kind: payload.signal, note: payload.detail ?? null,
        source_kind: sessionId ? 'session' : 'interview', interview_id: await ownInterview(), session_id: sessionId,
      });
      return;
    case 'competitor_mention':
      await writeCompetitorMention(env, {
        projectId: row.project_id, userId: user.id, name: payload.name, detail: payload.context ?? null,
        signal_type: 'mention', source_kind: sessionId ? 'session' : 'interview',
      });
      return;
    default:
      throw new Error('writer_not_available');
  }
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
    await applyPlacement(c.env, user, row, kind, payload);
  } catch (e) {
    await c.env.DB.prepare(
      `UPDATE validate_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL, edited_payload_json = NULL WHERE id = ?`,
    ).bind(row.id).run();
    // A module writer's own refusal (D659), e.g. no competitor list yet,
    // travels with its status and sentence; the placement stays proposed.
    if (e instanceof WriterError) return json({ error: 'writer_refused', detail: e.sentence }, e.status);
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

// ---------------------------------------------------------------------------
// Sessions: structure, compare, ask
// ---------------------------------------------------------------------------

/** The session and the caller, gated on `canWrite` like every session route. */
async function scopeSession(c: any): Promise<{ user: User; session: SessionRow } | Response> {
  const session = await loadSession(c.env, Number(c.req.param('id')));
  const user = (await requireAuth(c)) as User;
  if (!session) return json({ detail: 'Session not found' }, 404);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(session.project_id).first() as { id: number; founder_id: number | null } | null;
  if (!project) return json({ detail: 'Project not found' }, 404);
  if (!canWrite(project, user)) return json({ detail: 'Forbidden' }, 403);
  return { user, session };
}

async function finalSegments(env: Env, sessionId: number) {
  const rows = await env.DB.prepare(
    `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(sessionId).all<SegmentRow>();
  return toSegments(rows.results ?? []);
}

function newRunId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const micro = (usd: number) => Math.max(0, Math.round((usd || 0) * 1_000_000));

/** One receipt row per model call, refused or not. */
export async function recordStructureReceipt(
  env: Env, sessionId: number, runId: string | null, line: ReceiptLine, outcome: 'ok' | 'refused', refusal: string | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO interview_structure_receipts
       (session_id, run_id, step, model, requested_model, fallback_used, prompt_tokens, completion_tokens, cost_microusd, outcome, refusal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, runId, line.step, line.model, line.requested_model, line.fallback_used ? 1 : 0,
    line.prompt_tokens, line.completion_tokens, micro(line.est_cost_usd), outcome, refusal).run();
}

function refusedBody(refusal: string | null) {
  return {
    ok: false,
    refusal,
    message: refusal === 'budget_user_day' || refusal === 'budget_user_month' || refusal === 'budget_review'
      ? budgetRefusalMessage(refusal)
      : refusal === 'model_not_offered'
        ? 'That model is not offered for structuring. Nothing was run.'
        : 'The model could not be reached. Nothing was stored.',
  };
}

const MODEL_RE = /^@cf\/[a-z0-9._/-]{3,100}$/i;
const modelFrom = (v: unknown) => (typeof v === 'string' && MODEL_RE.test(v.trim()) ? v.trim() : undefined);

structure.post('/sessions/:id/structure', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
  const segments = await finalSegments(c.env, s.session.id);
  if (!segments.length) {
    return json({ error: 'no_final_transcript', detail: 'This session has no final transcript to structure yet.' }, 409);
  }
  const prior = await c.env.DB.prepare('SELECT COUNT(DISTINCT run_id) AS n FROM validate_proposals WHERE session_id = ?')
    .bind(s.session.id).first<{ n: number }>();
  const step = Number(prior?.n || 0) > 0 ? 're_structured' : 'structured';
  const runId = newRunId();
  const context = await loadStructureContext(c.env, s.session.project_id);
  const out = await structureTranscript(c.env, {
    userId: s.user.id, model: modelFrom(body?.model), segments, context, step,
  });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && i === out.receipt.length - 1;
    await recordStructureReceipt(c.env, s.session.id, runId, out.receipt[i], refusedHere ? 'refused' : 'ok', refusedHere ? (out as any).refusal ?? null : null);
  }
  if (!out.ok) return json(refusedBody(out.refusal), 503);

  await storePlacements(c.env, {
    projectId: s.session.project_id, sessionId: s.session.id, interviewId: s.session.interview_id,
    runId, userId: s.user.id, model: out.receipt[out.receipt.length - 1]?.model || '', placements: out.placements,
  });
  await c.env.DB.prepare(
    "UPDATE interview_sessions SET status = 'structured', updated_at = datetime('now') WHERE id = ? AND status = 'transcribed'",
  ).bind(s.session.id).run();
  return json({
    ok: true,
    run_id: runId,
    step,
    stored: out.placements.length,
    dropped: out.dropped,
    parts: out.parts,
    receipt: out.receipt,
  }, 201);
});

structure.get('/sessions/:id/placements', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, payload_json, edited_payload_json, status, model, run_id, cite_from, cite_to, citation_json, created_at
       FROM validate_proposals WHERE session_id = ? AND run_id IS NOT NULL ORDER BY id`,
  ).bind(s.session.id).all<any>();
  const parse = (t: string | null) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
  const placements = (rows.results ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    module: isPlacementKind(r.kind) ? PLACEMENT_KINDS[r.kind as PlacementKind].module : 'other',
    payload: parse(r.payload_json),
    edited_payload: parse(r.edited_payload_json),
    status: r.status,
    // Proposed-only kinds say so here, so the page can say so too.
    can_accept: isPlacementKind(r.kind) && PLACEMENT_KINDS[r.kind as PlacementKind].writer,
    model: r.model,
    run_id: r.run_id,
    cite: { from: r.cite_from, to: r.cite_to, quote: parse(r.citation_json)?.quote ?? null },
    created_at: r.created_at,
  }));
  const runs: { run_id: string; model: string; placements: typeof placements }[] = [];
  for (const p of placements) {
    let run = runs.find((x) => x.run_id === p.run_id);
    if (!run) runs.push(run = { run_id: p.run_id, model: p.model, placements: [] });
    run.placements.push(p);
  }
  const lastTwo = runs.slice(-2);
  return json({
    runs,
    compare: lastTwo.length === 2
      ? { first: lastTwo[0].run_id, second: lastTwo[1].run_id, modules: alignRuns(lastTwo[0].placements, lastTwo[1].placements) }
      : null,
  });
});

structure.post('/sessions/:id/ask', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<{ question?: string; model?: string }>().catch(() => ({} as { question?: string; model?: string }));
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  if (!question) return json({ error: 'question_required', detail: 'Ask a question.' }, 400);
  const segments = await finalSegments(c.env, s.session.id);
  if (!segments.length) {
    return json({ error: 'no_final_transcript', detail: 'This session has no final transcript to ask about yet.' }, 409);
  }
  const out = await askTranscript(c.env, { userId: s.user.id, model: modelFrom(body?.model), segments, question });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && out.reason === 'refused' && i === out.receipt.length - 1;
    await recordStructureReceipt(c.env, s.session.id, null, out.receipt[i], refusedHere ? 'refused' : 'ok', refusedHere ? out.refusal : null);
  }
  if (!out.ok && out.reason === 'refused') return json(refusedBody(out.refusal), 503);
  // AN ANSWER WITH NO CITATION IS REFUSED, NOT SHOWN.
  if (!out.ok) {
    return json({ error: 'no_citation', detail: 'The transcript did not give an answer that could be tied to a passage, so none is shown.' }, 422);
  }
  return json({ ok: true, answer: out.answer, cites: out.cites, receipt: out.receipt });
});

export default structure;
