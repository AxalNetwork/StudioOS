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
 *   POST /sessions/:id/placements/accept
 *                                   Accept all ({ slug } or { ids }, at most
 *                                   50): each placement's own claim and writer,
 *                                   every outcome reported (D757 §2.7)
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
 * writers in `services/validateWriters.ts`. Since D757 (#1923) every kind has
 * a writer: a new hypothesis and an experiment idea through Experiments' own,
 * a firmographic role or company into the interview's empty field, and the
 * findings no module table holds through `writeInterviewFinding`.
 *
 * An accepted pain writes its mention (the phrase in the interview's
 * `pains_json`), its severity and, when it names one of the founder's themes,
 * its theme, in one batch guarded on the list it read: all three land or none
 * does, so Problem discovery counts it the moment it is accepted (D757,
 * #1897). The accept response carries `pain`, and the placements read gives
 * each pain its `theme` (and `theme_missing` once that theme is deleted).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canWrite } from './_founder_validate_helpers';
import {
  insertHypothesisLink,
  setInterviewIcpFit,
  upsertPainAliasStatement,
  upsertPainSeverityStatement,
} from './_founder_validate_writes';
import { logCycleWrite } from '../services/cycleActivity';
import {
  WriterError,
  addEvidence,
  addExperiment,
  assignInterviewSegment,
  createHypothesis,
  setEvidenceStrength,
  writeCompetitorMention,
  writeDemandSignal,
  writeInterviewFinding,
  writeSegment,
} from '../services/validateWriters';
import { addInterviewPain, updateInterviewDetails } from '../services/interviewWriters';
import { INTERVIEW_FIELDS, isFindingKind } from '../services/interviewFindings';
import { budgetRefusalMessage } from '../services/aiRouter';
import { MODULES } from '../services/cycleValidate';
import { consentBlocks, loadSession, sessionHasAudio, sessionDigestConsentBlocks, type SessionRow } from '../services/interviewSessions';
import {
  PLACEMENT_KINDS,
  alignRuns,
  askTranscript,
  isPlacementKind,
  placementSlug,
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
  cite_from?: number | null;
  cite_to?: number | null;
  citation_json?: string | null;
}

/** The quote a placement carries in its citation, for the finding it becomes; null when none. */
function quoteOf(row: PlacementRow): string | null {
  try {
    const c = row.citation_json ? JSON.parse(row.citation_json) : null;
    return c && typeof c.quote === 'string' && c.quote ? c.quote : null;
  } catch { return null; }
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
 *
 * D757 — `dedupe` (automatic runs): a placement whose kind and D658 key
 * (`KindSpec.key`) match any earlier proposal on the same interview, in any
 * status and from any proposer, is not stored again, so a re-run never brings
 * back a finding the founder already accepted or discarded. A founder's run
 * keeps every placement, so Compare still works.
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
    dedupe?: boolean;
  },
): Promise<{ stored: number; deduped: number }> {
  let placements = opts.placements;
  if (opts.dedupe && placements.length) {
    const prior = (await env.DB.prepare(
      'SELECT kind, payload_json, edited_payload_json FROM validate_proposals WHERE target_ref = ? AND run_id IS NOT NULL',
    ).bind(`interview:${opts.interviewId}`).all<{ kind: string; payload_json: string | null; edited_payload_json: string | null }>()).results ?? [];
    const seen = new Set<string>();
    for (const row of prior) {
      if (!isPlacementKind(row.kind)) continue;
      for (const raw of [row.payload_json, row.edited_payload_json]) {
        if (!raw) continue;
        try { seen.add(`${row.kind}|${PLACEMENT_KINDS[row.kind].key(JSON.parse(raw))}`); } catch { /* an unreadable payload names nothing */ }
      }
    }
    placements = placements.filter((p) => !seen.has(`${p.kind}|${PLACEMENT_KINDS[p.kind].key(p.payload)}`));
  }
  const deduped = opts.placements.length - placements.length;
  if (!placements.length) return { stored: 0, deduped };
  const written = await env.DB.batch(placements.map((p) => env.DB.prepare(
    `INSERT INTO validate_proposals
       (project_id, kind, payload_json, model, task, created_by, surface, fill_class,
        citation_json, target_ref, session_id, cite_from, cite_to, run_id)
     SELECT ?, ?, ?, ?, 'structure_interview', ?, 'validate/interview', 'restatement', ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM interview_sessions s WHERE s.id = ? AND s.consent_status = 'declined')`,
  ).bind(
    opts.projectId, p.kind, JSON.stringify(p.payload), opts.model, opts.userId,
    JSON.stringify({ kind: 'transcript', session_id: opts.sessionId, from: p.cite.from, to: p.cite.to, quote: p.quote }),
    `interview:${opts.interviewId}`, opts.sessionId, p.cite.from, p.cite.to, opts.runId, opts.sessionId,
  )));
  return { stored: written.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0), deduped };
}

async function loadPlacement(env: Env, id: number): Promise<PlacementRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await env.DB.prepare(
    `SELECT id, project_id, kind, payload_json, edited_payload_json, status, run_id, target_ref, session_id,
            cite_from, cite_to, citation_json FROM validate_proposals WHERE id = ? AND run_id IS NOT NULL`,
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

/** What an accepted pain did (D757, #1897): whether its mention was new, and the theme it was filed under. */
type PainApplied = { mention: 'added' | 'already_logged'; group_id: number | null };

const PAIN_RACE = 'This interview changed while the pain was saved. Nothing was written. Accept it again.';

/**
 * D757 (#1897) — an accepted pain: its mention, its severity and its theme in
 * one batch, each statement guarded on the `pains_json` that
 * `addInterviewPain` read. When another write changed the list in between,
 * the batch writes nothing; it is read and tried once more, and a second loss
 * is a 409 that leaves the placement pending.
 */
async function applyPain(
  env: Env, user: User, row: PlacementRow, interviewId: number, payload: Record<string, unknown>,
): Promise<PainApplied> {
  const groupId = payload.pain_group_id == null ? null : Number(payload.pain_group_id);
  if (groupId != null) {
    // A theme deleted since the proposal is refused, not dropped: the pain
    // without its theme is not what the founder accepted (decision 5).
    const group = await env.DB.prepare('SELECT id FROM pain_groups WHERE id = ? AND project_id = ?')
      .bind(groupId, row.project_id).first<{ id: number }>();
    if (!group) throw new Error('not_this_project');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const pain = await addInterviewPain(env, { projectId: row.project_id, interviewId, phrase: String(payload.phrase) });
    const guard = { interviewId, projectId: row.project_id, painsJson: pain.painsJson };
    const severity = upsertPainSeverityStatement(env, interviewId, pain.norm, String(payload.severity), guard);
    const alias = groupId != null ? upsertPainAliasStatement(env, row.project_id, groupId, pain.display, guard) : null;
    const results = await env.DB.batch([...pain.statements, severity, ...(alias ? [alias] : [])]);
    if (Number(results[pain.statements.length]?.meta?.changes ?? 0) < 1) continue;
    await logCycleWrite(env, {
      projectId: row.project_id, userId: user.id, cycle: 'validate', module: 'customer-research', entityId: interviewId,
      action: pain.added ? 'interview_pain_added' : 'pain_severity_set',
      summary: pain.added ? `Pain added to interview ${interviewId}` : `Pain severity set on interview ${interviewId}`,
    });
    return { mention: pain.added ? 'added' : 'already_logged', group_id: groupId };
  }
  throw new WriterError(409, PAIN_RACE);
}

/**
 * Write one accepted placement through its module's writer. Throws
 * `not_this_project` when the row it names is not the placement's project's,
 * which puts the placement back to pending. An accepted pain returns what it
 * did; no other kind returns anything.
 */
async function applyPlacement(
  env: Env, user: User, row: PlacementRow, kind: PlacementKind, payload: Record<string, unknown>,
): Promise<{ pain: PainApplied } | void> {
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
      // The three-level word itself (D659 widened the column's values), with
      // the mention and the theme in the same batch (D757).
      return { pain: await applyPain(env, user, row, await ownInterview(), payload) };
    case 'icp_fit':
      await setInterviewIcpFit(env, await ownInterview(), String(payload.fit));
      return;
    case 'evidence': {
      // D757: without a theme, the interview itself is the evidence (§2.6).
      if (payload.pain_group_id == null) {
        await addEvidence(env, {
          projectId: row.project_id, userId: user.id, hypothesisId: Number(payload.hypothesis_id), kind: 'interview',
          ref_id: String(await ownInterview()), direction: payload.direction === 'refutes' ? 'contradicts' : 'supports',
          strength: payload.strength,
        });
        return;
      }
      const prior = await env.DB.prepare(
        'SELECT strength FROM hypothesis_pain_links WHERE hypothesis_id = ? AND pain_group_id = ? AND direction = ?',
      ).bind(Number(payload.hypothesis_id), Number(payload.pain_group_id), payload.direction === 'refutes' ? 'contradicts' : 'supports')
        .first<{ strength: string | null }>();
      if (prior && prior.strength !== payload.strength) {
        throw new WriterError(409, 'This evidence link already has a different strength. Review it in Experiments before changing it.');
      }
      const direction = payload.direction === 'refutes' ? 'contradicts' : 'supports';
      const ok = await insertHypothesisLink(
        env, row.project_id, Number(payload.hypothesis_id), Number(payload.pain_group_id), direction,
      );
      if (!ok) throw new Error('not_this_project');
      const link = await env.DB.prepare(
        'SELECT id FROM hypothesis_pain_links WHERE hypothesis_id = ? AND pain_group_id = ? AND direction = ?',
      ).bind(Number(payload.hypothesis_id), Number(payload.pain_group_id), direction).first<{ id: number }>();
      if (link && !prior) await setEvidenceStrength(env, { projectId: row.project_id, userId: user.id, linkId: Number(link.id), strength: payload.strength, expectedStrength: null });
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
      // D757 §2.6: a need-to-have or a would-pay is `confirmed` by the
      // founder's Accept; a letter of intent or a pre-sale stays `to_confirm`
      // until its document or payment is attached.
      await writeDemandSignal(env, {
        projectId: row.project_id, userId: user.id, kind: payload.signal, note: payload.detail ?? null,
        status: payload.signal === 'need_to_have' || payload.signal === 'would_pay' ? 'confirmed' : 'to_confirm',
        amount_cents: payload.amount_cents ?? null, currency: payload.currency ?? null, period: payload.period ?? null,
        source_kind: sessionId ? 'session' : 'interview', interview_id: await ownInterview(), session_id: sessionId,
      });
      return;
    case 'competitor_mention': {
      // D757: a price makes it a pricing signal; with no list yet, Accept
      // creates the manual one, with no crawl.
      const priced = payload.amount_cents != null;
      const context = payload.context == null ? null : String(payload.context);
      await writeCompetitorMention(env, {
        projectId: row.project_id, userId: user.id, name: payload.name,
        detail: priced && payload.period ? [context, `per ${payload.period}`].filter(Boolean).join(' · ') : context,
        signal_type: priced ? 'pricing' : 'mention', source_kind: sessionId ? 'session' : 'interview',
        amount_cents: payload.amount_cents ?? null, currency: payload.currency ?? null, createList: true,
      });
      return;
    }
    case 'hypothesis_new':
      await createHypothesis(env, { projectId: row.project_id, userId: user.id, claim: payload.claim, disproof: payload.disproof ?? null });
      return;
    case 'experiment_idea':
      await addExperiment(env, {
        projectId: row.project_id, userId: user.id, hypothesisId: Number(payload.hypothesis_id),
        title: payload.title, method: payload.method ?? null,
      });
      return;
    default:
      if (!isFindingKind(kind)) throw new Error('writer_not_available');
      // A firmographic role or company is the interview record's own field,
      // written only where it is empty; every other finding is a row of its own.
      if (kind === 'firmographic' && (INTERVIEW_FIELDS as readonly string[]).includes(String(payload.attribute))) {
        await updateInterviewDetails(env, {
          projectId: row.project_id, userId: user.id, interviewId: await ownInterview(), fillEmpty: true,
          ...(payload.attribute === 'role' ? { interviewee_role: payload.value } : { interviewee_company: payload.value }),
        });
        return;
      }
      await writeInterviewFinding(env, {
        projectId: row.project_id, userId: user.id, interviewId: await ownInterview(), kind, payload,
        sessionId, proposalId: row.id, quote: quoteOf(row), citeFrom: row.cite_from ?? null, citeTo: row.cite_to ?? null,
      });
  }
}

/**
 * Accept one placement: its claim (`WHERE id = ? AND status = 'pending'`),
 * then its module's writer; a failure puts it back to pending. `edit` is the
 * founder's edited payload, validated as strictly as the model's own. The one
 * code path for Accept and for Accept all (D757 §2.7): what it returns is the
 * single route's status and body.
 */
async function acceptPlacement(
  env: Env, user: User, row: PlacementRow, edit: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!isPlacementKind(row.kind)) return { status: 409, body: { error: 'unknown_kind', detail: 'This placement can no longer be applied.' } };
  const kind = row.kind;
  const spec = PLACEMENT_KINDS[kind];
  if (!spec.writer) {
    return {
      status: 409,
      body: { error: 'writer_not_available', detail: 'This module cannot take a placement yet. It stays proposed until its store is built.' },
    };
  }
  if (row.status !== 'pending') return { status: 409, body: { error: 'not_pending', detail: 'This placement was already decided.' } };

  // EDIT THEN ACCEPT. The edit is validated as strictly as the model's own
  // payload was, against this project's rows; the model's payload is kept.
  let edited: Record<string, unknown> | null = null;
  if (edit && typeof edit === 'object') {
    edited = spec.parse(edit as Record<string, unknown>, await loadStructureContext(env, row.project_id));
    if (!edited) return { status: 422, body: { error: 'invalid_edit', detail: 'That edit is not a valid value for this module.' } };
  }
  let payload: Record<string, unknown>;
  try { payload = edited ?? JSON.parse(row.payload_json); } catch {
    return { status: 422, body: { error: 'unreadable', detail: 'This placement could not be read.' } };
  }

  const claim = await env.DB.prepare(
    `UPDATE validate_proposals SET status = 'accepted', decided_by = ?, decided_at = datetime('now'), edited_payload_json = ?
      WHERE id = ? AND status = 'pending'`,
  ).bind(user.id, edited ? JSON.stringify(edited) : null, row.id).run();
  if (!claim.meta?.changes) return { status: 409, body: { error: 'not_pending', detail: 'This placement was already decided.' } };

  let applied: { pain: PainApplied } | void;
  try {
    applied = await applyPlacement(env, user, row, kind, payload);
  } catch (e) {
    await env.DB.prepare(
      `UPDATE validate_proposals SET status = 'pending', decided_by = NULL, decided_at = NULL, edited_payload_json = NULL WHERE id = ?`,
    ).bind(row.id).run();
    // A module writer's own refusal (D659), e.g. no competitor list yet,
    // travels with its status and sentence; the placement stays proposed.
    if (e instanceof WriterError) return { status: e.status, body: { error: 'writer_refused', detail: e.sentence } };
    const msg = (e as Error).message;
    if (msg === 'not_this_project') return { status: 409, body: { error: 'not_this_project', detail: 'The row this names is no longer on this project.' } };
    console.error('[validate/placements] accept failed', msg);
    return { status: 500, body: { error: 'apply_failed', detail: 'The placement could not be written. It is still proposed.' } };
  }
  return { status: 200, body: { ok: true, id: row.id, kind, edited: !!edited, payload, ...(applied ?? {}) } };
}

structure.post('/placements/:id/accept', async (c) => {
  const row = await loadPlacement(c.env, Number(c.req.param('id')));
  if (!row) return json({ detail: 'Placement not found' }, 404);
  const user = await authorise(c, row);
  if (user instanceof Response) return user;
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const out = await acceptPlacement(c.env, user, row, body?.payload);
  return json(out.body, out.status);
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

/** At most this many placements are accepted by one Accept all. */
export const MAX_ACCEPT_ALL = 50;

/**
 * D757 §2.7 (#1925) — Accept all, for one module (`{ slug }`) or for chosen
 * placements (`{ ids }`, at most 50). Each placement runs `acceptPlacement`,
 * its own claim and writer, one after another: there is no batch write, so a
 * placement a writer refuses goes back to pending while the rest land, and a
 * replay finds nothing pending to accept twice. Every outcome is reported.
 * Re-scoped to the session's project; a session the caller cannot write is
 * not found.
 */
structure.post('/sessions/:id/placements/accept', async (c) => {
  const session = await loadSession(c.env, Number(c.req.param('id')));
  const user = (await requireAuth(c)) as User;
  if (!session) return json({ detail: 'Session not found' }, 404);
  const project = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?')
    .bind(session.project_id).first() as { id: number; founder_id: number | null } | null;
  if (!project || !canWrite(project, user)) return json({ detail: 'Session not found' }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const slug = typeof body?.slug === 'string' ? body.slug : null;
  const rawIds = Array.isArray(body?.ids) ? body.ids : null;
  if ((slug == null) === (rawIds == null)) return json({ error: 'invalid_body', detail: 'Send a module slug or a list of placement ids.' }, 400);
  let rows: PlacementRow[];
  let remaining = 0;
  let missing: number[] = [];
  if (rawIds) {
    if (!rawIds.length || !rawIds.every((v) => Number.isInteger(v) && (v as number) > 0)) {
      return json({ error: 'invalid_ids', detail: 'Placement ids are positive whole numbers.' }, 400);
    }
    const ids = [...new Set(rawIds as number[])];
    if (ids.length > MAX_ACCEPT_ALL) return json({ error: 'too_many', detail: `Accept at most ${MAX_ACCEPT_ALL} placements at a time.` }, 400);
    rows = (await c.env.DB.prepare(
      `SELECT id, project_id, kind, payload_json, edited_payload_json, status, run_id, target_ref, session_id,
            cite_from, cite_to, citation_json FROM validate_proposals
        WHERE session_id = ? AND project_id = ? AND run_id IS NOT NULL AND id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`,
    ).bind(session.id, session.project_id, ...ids).all<PlacementRow>()).results ?? [];
    const found = new Set(rows.map((r) => Number(r.id)));
    missing = ids.filter((id) => !found.has(id));
  } else {
    if (!MODULES.some((m) => m.slug === slug)) return json({ error: 'unknown_module', detail: 'No such module.' }, 400);
    const pending = ((await c.env.DB.prepare(
      `SELECT id, project_id, kind, payload_json, edited_payload_json, status, run_id, target_ref, session_id,
            cite_from, cite_to, citation_json FROM validate_proposals
        WHERE session_id = ? AND project_id = ? AND run_id IS NOT NULL AND status = 'pending' ORDER BY id`,
    ).bind(session.id, session.project_id).all<PlacementRow>()).results ?? []).filter((r) => {
      if (!isPlacementKind(r.kind)) return false;
      try { return placementSlug(r.kind, JSON.parse(r.edited_payload_json ?? r.payload_json)) === slug; } catch { return false; }
    });
    rows = pending.slice(0, MAX_ACCEPT_ALL);
    remaining = pending.length - rows.length;
  }

  const results: Array<{ id: number; ok: boolean; error?: string; detail?: string }> = [];
  for (const row of rows) {
    const out = await acceptPlacement(c.env, user, row, null);
    results.push(out.status === 200 ? { id: row.id, ok: true }
      : { id: row.id, ok: false, error: String(out.body.error ?? 'refused'), detail: String(out.body.detail ?? '') });
  }
  for (const id of missing) results.push({ id, ok: false, error: 'not_found', detail: 'This placement is not in this session.' });
  return json({ results, accepted: results.filter((r) => r.ok).length, remaining });
});

// D685: shared with the summary route and the processing job.
export async function finalSegments(env: Env, sessionId: number) {
  const rows = await env.DB.prepare(
    `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(sessionId).all<SegmentRow>();
  return toSegments(rows.results ?? []);
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

// D685: shared with the summary route and the processing job.
export function refusedBody(refusal: string | null) {
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

/**
 * #1470's codes for a refused run: 402 for a spent budget, 400 for a model this
 * task does not offer, 503 only when no model could be reached. The page tells
 * them apart by `refusal`, not by the status (`InterviewReview.jsx`).
 */
// D685: shared with the summary route and the processing job.
export function refusedStatus(refusal: string | null): 400 | 402 | 503 {
  if (refusal === 'budget_user_day' || refusal === 'budget_user_month' || refusal === 'budget_review') return 402;
  if (refusal === 'model_not_offered') return 400;
  return 503;
}

const MODEL_RE = /^@cf\/[a-z0-9._/-]{3,100}$/i;
/**
 * The model the founder picked. Absent means the task's default. Given but not
 * a Workers AI model id is refused here, before anything runs: it used to fall
 * through as `undefined` and silently run the default.
 */
// D685: shared with the summary route and the processing job.
export function modelFrom(v: unknown): { model: string | undefined } | { refused: true } {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return { model: undefined };
  if (typeof v === 'string' && MODEL_RE.test(v.trim())) return { model: v.trim() };
  return { refused: true };
}

/** #1470's rule, the same 409 its start, resume and live routes give: no consent, no AI over the recording. */
// D685: shared with the summary route and the processing job.
// D754 (#1893): it also refuses a session holding audio, and a chat waiting for the interviewee's consent.
export async function consentRefusal(env: Env, session: SessionRow) {
  const blocked = consentBlocks(session.channel, session.consent_status, {
    hasAudio: await sessionHasAudio(env, session.id), submittedVia: session.submitted_via ?? null,
  });
  return blocked ? json(blocked, 409) : null;
}

/** D757 #1930: explicit engine buttons have the same final-text gate as queued runs. */
export async function digestConsentRefusal(env: Env, session: SessionRow) {
  const blocked = await sessionDigestConsentBlocks(env, session);
  return blocked ? json(blocked, 409) : null;
}

structure.post('/sessions/:id/structure', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const blocked = await digestConsentRefusal(c.env, s.session);
  if (blocked) return blocked;
  // D685 §5.9 — never two writers: the pipeline places findings itself.
  const busy = processingBusy(s.session);
  if (busy) return busy;
  const body = await c.req.json<{ model?: string }>().catch(() => ({} as { model?: string }));
  const picked = modelFrom(body?.model);
  if ('refused' in picked) return json(refusedBody('model_not_offered'), 400);
  // D757: the run is the engine's, forced (a button always runs) and never deduped (Compare).
  const { digestSession } = await import('../services/validateEngine');
  const out = await digestSession(c.env, {
    sessionId: s.session.id, userId: s.user.id, trigger: 'manual', stages: ['structure'], force: true, model: picked.model,
  });
  if (out.status === 'not_writable') return json({ detail: 'Forbidden' }, 403);
  if (out.status === 'skipped') {
    return json({ error: 'no_final_transcript', detail: 'This session has no final transcript to structure yet.' }, 409);
  }
  if (out.status === 'refused') {
    if (out.reason === 'busy') return json({ error: 'digest_running', detail: out.note }, 409);
    if (out.reason === 'consent_not_recorded') return (await digestConsentRefusal(c.env, (await loadSession(c.env, s.session.id))!)) ?? json({ error: 'consent_not_recorded' }, 409);
    return json(refusedBody(out.refusal), refusedStatus(out.refusal));
  }
  const placed = out.status === 'done' && out.structure?.ok ? out.structure : null;
  if (!placed) return json(refusedBody(null), refusedStatus(null));
  return json({
    ok: true,
    run_id: placed.runId,
    step: placed.step,
    stored: placed.stored,
    dropped: placed.dropped,
    parts: placed.parts,
    receipt: placed.receipt,
  }, 201);
});

/**
 * One session's placements, every run's, in id order. `*` rather than a column
 * list: `source` arrives with migration 447 (D667), and a row written before
 * it reads as StudioOS's own. The placements route and the Customer research
 * record (D690, #1692) both read it.
 */
export async function sessionPlacementRows(env: Env, sessionId: number): Promise<any[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM validate_proposals WHERE session_id = ? AND run_id IS NOT NULL ORDER BY id`,
  ).bind(sessionId).all<any>();
  return rows.results ?? [];
}

/** A pain placement's theme for the review read: the group it names, or null; and whether that group has gone. */
function painTheme(context: StructureContext, id: unknown): { theme: { id: number; title: string } | null; theme_missing?: true } {
  if (id == null) return { theme: null };
  const g = context.painGroups.find((x) => x.id === Number(id));
  return g ? { theme: { id: g.id, title: g.title } } : { theme: null, theme_missing: true };
}

structure.get('/sessions/:id/placements', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const rows = { results: await sessionPlacementRows(c.env, s.session.id) };
  // D667 — who proposed each run. An assistant's name is the one its OAuth
  // client registered, self-declared, so the page shows it as the client's
  // own label; StudioOS's runs say StudioOS.
  const submittedVia = (s.session as any).submitted_via_name ?? null;
  const parse = (t: string | null) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
  const context = await loadStructureContext(c.env, s.session.project_id);
  const placements = (rows.results ?? []).map((r: any) => ({
    id: r.id,
    kind: r.kind,
    module: isPlacementKind(r.kind) ? PLACEMENT_KINDS[r.kind as PlacementKind].module : 'other',
    payload: parse(r.payload_json),
    evidence_context: r.kind === 'evidence' ? {
      hypothesis: context.hypotheses.find((h) => h.id === Number((parse(r.edited_payload_json) ?? parse(r.payload_json))?.hypothesis_id)) ?? null,
      pain_group: context.painGroups.find((g) => g.id === Number((parse(r.edited_payload_json) ?? parse(r.payload_json))?.pain_group_id)) ?? null,
    } : null,
    // D757 (#1897): the founder's theme a pain names, from the edit first.
    // `theme_missing` says the theme was deleted, so Accept would refuse it.
    ...(r.kind === 'pain_severity' ? painTheme(context, (parse(r.edited_payload_json) ?? parse(r.payload_json))?.pain_group_id) : {}),
    edited_payload: parse(r.edited_payload_json),
    status: r.status,
    // Proposed-only kinds say so here, so the page can say so too.
    can_accept: isPlacementKind(r.kind) && PLACEMENT_KINDS[r.kind as PlacementKind].writer,
    model: r.model,
    run_id: r.run_id,
    source: r.source === 'assistant' ? 'assistant' : 'studioos',
    submitted_via_name: r.source === 'assistant' ? submittedVia : null,
    cite: { from: r.cite_from, to: r.cite_to, quote: parse(r.citation_json)?.quote ?? null },
    created_at: r.created_at,
  }));
  const runs: { run_id: string; model: string; source: string; submitted_via_name: string | null; placements: typeof placements }[] = [];
  for (const p of placements) {
    let run = runs.find((x) => x.run_id === p.run_id);
    if (!run) runs.push(run = { run_id: p.run_id, model: p.model, source: p.source, submitted_via_name: p.submitted_via_name, placements: [] });
    run.placements.push(p);
  }
  const lastTwo = runs.slice(-2);
  return json({
    runs,
    submitted_via_name: submittedVia,
    compare: lastTwo.length === 2
      ? { first: lastTwo[0].run_id, second: lastTwo[1].run_id, modules: alignRuns(lastTwo[0].placements, lastTwo[1].placements) }
      : null,
  });
});

structure.post('/sessions/:id/ask', async (c) => {
  const s = await scopeSession(c);
  if (s instanceof Response) return s;
  const blocked = await consentRefusal(c.env, s.session);
  if (blocked) return blocked;
  const body = await c.req.json<{ question?: string; model?: string }>().catch(() => ({} as { question?: string; model?: string }));
  const picked = modelFrom(body?.model);
  if ('refused' in picked) return json(refusedBody('model_not_offered'), 400);
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1000) : '';
  if (!question) return json({ error: 'question_required', detail: 'Ask a question.' }, 400);
  const segments = await finalSegments(c.env, s.session.id);
  if (!segments.length) {
    return json({ error: 'no_final_transcript', detail: 'This session has no final transcript to ask about yet.' }, 409);
  }
  const out = await askTranscript(c.env, { userId: s.user.id, model: picked.model, segments, question });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && out.reason === 'refused' && i === out.receipt.length - 1;
    await recordStructureReceipt(c.env, s.session.id, null, out.receipt[i], refusedHere ? 'refused' : 'ok', refusedHere ? out.refusal : null);
  }
  if (!out.ok && out.reason === 'refused') return json(refusedBody(out.refusal), refusedStatus(out.refusal));
  // AN ANSWER WITH NO CITATION IS REFUSED, NOT SHOWN.
  if (!out.ok) {
    return json({ error: 'no_citation', detail: 'The transcript did not give an answer that could be tied to a passage, so none is shown.' }, 422);
  }
  return json({ ok: true, answer: out.answer, cites: out.cites, receipt: out.receipt });
});

/** D685 §5.9 — the 409 a manual run gets while the processing job owns the session. */
export function processingBusy(session: { processing_stage?: string | null; processing_updated_at?: string | null }) {
  const stage = session.processing_stage ?? null;
  if (stage === null || stage === 'done' || stage === 'failed') return null;
  return json({ error: 'processing', stage, message: 'This session is still being processed. Its findings appear when it finishes.' }, 409);
}

export default structure;
