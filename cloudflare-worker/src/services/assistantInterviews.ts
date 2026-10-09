/**
 * D667 (#1497) — an interview from the founder's own AI assistant (ChatGPT,
 * Claude, Gemini or Grok), as three tools: `submit_interview`,
 * `propose_placements` and `structure_with_studioos`.
 *
 * PLAIN SERVICE FUNCTIONS. #1496 (D666) builds the MCP server, its OAuth
 * grants and its tool registry. Each function here takes the grant that
 * server resolves, `{ userId, companies, clientId, clientName }`, and the
 * tool's arguments, and either returns the tool's result or throws a
 * `ToolError` carrying the HTTP status the issue names. `TOOLS` holds each
 * tool's name, description and input schema, so registering them is a loop.
 *
 * WHAT NEVER HAPPENS HERE:
 *   · No module row is written. A session and its transcript are stored, and
 *     the assistant's placements are stored as PENDING proposals. They enter a
 *     module only when the founder accepts them on the Interview Session page
 *     (#1473), through D658's accept path and the module's own writer.
 *   · Nothing the assistant claims about the transcript is trusted. A
 *     placement's quote must be verbatim in the STORED transcript (whitespace
 *     normalised, nothing else) or the placement is dropped; its span is
 *     computed from the segments the quote falls in.
 *   · Transcript text is data. It reaches only the transcript tables and the
 *     quotes; no log line carries it, and no instruction in it is acted on.
 *   · Without consent `given`, nothing is written at all (D656): 409.
 */
import type { Env, User } from '../types';
import { canWrite, type ProjectRef } from '../routes/_founder_validate_helpers';
import {
  CHANNELS,
  CONSENT_METHODS,
  loadSession,
  replaceWithFinal,
  type SessionRow,
  type StoredSegment,
} from './interviewSessions';
import {
  MAX_QUOTE,
  PLACEMENT_KINDS,
  isPlacementKind,
  structureTranscript,
  toSegments,
  type Segment,
  type SegmentRow,
} from './interviewStructuring';
import { budgetRefusalMessage } from './aiRouter';
import {
  loadStructureContext,
  recordStructureReceipt,
  storePlacements,
} from '../routes/founder_validate_structure';

/** What #1496's server resolves from an access token. */
export interface AssistantGrant {
  userId: number;
  /** The companies the founder ticked on the consent page. */
  companies: number[];
  /** The OAuth client id, stored as `submitted_via`. */
  clientId: string;
  /** The client's registered name, self-declared, stored for display. */
  clientName: string;
}

/** A refusal with the status the issue names, and our own sentence. */
export class ToolError extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(sentence);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

export const LIMITS = {
  segments: 200,
  bytes: 100 * 1024,
  submissionsPerDay: 20,
  placementsPerCall: 100,
} as const;

/** What the founder's assistant run is labelled as in the stored rows. */
export const SUBMISSION_MODEL = 'assistant_submission';

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

// ---------------------------------------------------------------------------
// Scope: the grant, the company, the venture, and the founder's right to write
// ---------------------------------------------------------------------------

type Scope = { user: User; project: ProjectRef & { company_id: number | null } };

async function loadUser(env: Env, userId: number): Promise<User> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
  if (!user || !(user as any).is_active) throw new ToolError(401, 'grant_user_inactive', 'The account behind this connection is no longer active.');
  return user;
}

/** Is this company in the grant, and does the founder still belong to it? */
async function assertCompany(env: Env, grant: AssistantGrant, companyId: number): Promise<void> {
  if (!grant.companies.map(Number).includes(companyId)) {
    throw new ToolError(403, 'company_not_granted', 'This connection was not given access to that company.');
  }
  const linked = await env.DB.prepare('SELECT 1 AS ok FROM user_company_links WHERE user_id = ? AND company_id = ?')
    .bind(grant.userId, companyId).first();
  if (!linked) throw new ToolError(403, 'company_no_longer_yours', 'The account behind this connection no longer belongs to that company.');
}

/**
 * The company's venture: its one live project. A company with several is
 * refused unless `project` names one of them — a write is never sent to a
 * venture the founder did not pick.
 */
export async function resolveCompanyProject(
  env: Env, grant: AssistantGrant, company: unknown, project?: unknown,
): Promise<Scope> {
  if (!isInt(company) || company <= 0) throw new ToolError(400, 'company_required', 'Name the company by its id.');
  await assertCompany(env, grant, company);
  const user = await loadUser(env, grant.userId);
  const rows = await env.DB.prepare(
    'SELECT id, founder_id, company_id FROM projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY id',
  ).bind(company).all<ProjectRef & { company_id: number }>();
  const list = rows.results || [];
  let chosen: (ProjectRef & { company_id: number }) | undefined;
  if (project !== undefined && project !== null) {
    chosen = list.find((p) => Number(p.id) === Number(project));
    if (!chosen) throw new ToolError(404, 'project_not_in_company', 'That venture is not one of this company’s.');
  } else if (list.length === 1) {
    chosen = list[0];
  } else if (list.length === 0) {
    throw new ToolError(409, 'company_has_no_venture', 'This company has no venture to record an interview against yet.');
  } else {
    throw new ToolError(409, 'company_has_several_ventures', 'This company has more than one venture. Name the one this interview is for with `project`.');
  }
  if (!canWrite(chosen, user)) throw new ToolError(403, 'cannot_write', 'The account behind this connection cannot write to that venture.');
  return { user, project: chosen };
}

/** A session this grant may act on: its venture's company is granted and still writable. */
async function scopeSession(env: Env, grant: AssistantGrant, sessionId: unknown): Promise<Scope & { session: SessionRow }> {
  if (!isInt(sessionId) || sessionId <= 0) throw new ToolError(400, 'session_required', 'Name the session by its id.');
  const session = await loadSession(env, sessionId);
  if (!session) throw new ToolError(404, 'session_not_found', 'There is no such session.');
  const project = await env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(session.project_id).first<ProjectRef & { company_id: number | null }>();
  // The same answer for "not yours" as for "not there": a grant learns
  // nothing about another company's sessions.
  if (!project || project.company_id == null || !grant.companies.map(Number).includes(Number(project.company_id))) {
    throw new ToolError(404, 'session_not_found', 'There is no such session.');
  }
  await assertCompany(env, grant, Number(project.company_id));
  const user = await loadUser(env, grant.userId);
  if (!canWrite(project, user)) throw new ToolError(403, 'cannot_write', 'The account behind this connection cannot write to that venture.');
  return { user, project, session };
}

async function audit(env: Env, grant: AssistantGrant, projectId: number, action: string, details: Record<string, unknown>) {
  // Ids, counts and the client — never transcript text, quotes or names.
  await env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
  ).bind(action, JSON.stringify({ ...details, client_id: grant.clientId }), `user:${grant.userId}`, grant.userId, projectId).run();
}

// ---------------------------------------------------------------------------
// submit_interview
// ---------------------------------------------------------------------------

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
/** Seven or more digits in a phone-like run: a number someone could call. */
export function looksLikePhone(s: string): boolean {
  const runs = s.match(/\+?\d[\d\s().\-/]{5,}\d/g) || [];
  return runs.some((r) => (r.match(/\d/g) || []).length >= 7);
}

/**
 * The interviewee as a label, a role and a company — nothing that reaches
 * them. An email address or a phone number anywhere is refused, and so is any
 * other field.
 */
export function parseInterviewee(raw: unknown): { label: string; role: string | null; company: string | null } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError(400, 'interviewee_required', 'Describe the interviewee with a label, and optionally a role and a company.');
  }
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !['label', 'role', 'company'].includes(k));
  if (extra.length) {
    throw new ToolError(400, 'contact_not_accepted', 'Only a label, a role and a company are accepted for the interviewee. No contact details.');
  }
  const label = str(o.label, 80);
  if (!label) throw new ToolError(400, 'interviewee_required', 'Give the interviewee a label, such as "Finance lead, logistics firm".');
  const role = o.role == null ? null : str(o.role, 80);
  const company = o.company == null ? null : str(o.company, 120);
  if ((o.role != null && !role) || (o.company != null && !company)) {
    throw new ToolError(400, 'interviewee_invalid', 'The interviewee’s role or company is empty or too long.');
  }
  for (const v of [label, role, company]) {
    if (v && (EMAIL_RE.test(v) || looksLikePhone(v))) {
      throw new ToolError(400, 'contact_not_accepted', 'An email address or phone number cannot be stored for an interviewee.');
    }
  }
  return { label, role, company };
}

/** Consent `given`, with how and when — or 409 before anything is written. */
export function parseConsent(raw: unknown): { method: string; recordedAt: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const refused = () => new ToolError(409, 'consent_not_given',
    'This interview cannot be stored: the interviewee’s consent to its being processed by your assistant and by StudioOS is not recorded as given.');
  if (!o || o.status !== 'given') throw refused();
  const method = typeof o.method === 'string' ? o.method : '';
  if (!(CONSENT_METHODS as readonly string[]).includes(method)) throw refused();
  const t = typeof o.recorded_at === 'string' ? Date.parse(o.recorded_at) : NaN;
  if (!Number.isFinite(t) || t > Date.now() + 5 * 60_000) throw refused();
  return { method, recordedAt: new Date(t).toISOString() };
}

/** The transcript as stored segments: a list of `{ speaker, text, start_ms? }`, or notes as one. */
export function parseTranscript(transcript: unknown, notes: unknown): StoredSegment[] {
  const hasT = transcript !== undefined && transcript !== null;
  const hasN = notes !== undefined && notes !== null;
  if (hasT === hasN) {
    throw new ToolError(400, 'transcript_or_notes', 'Send either the transcript, as segments, or notes — one of the two.');
  }
  let out: StoredSegment[];
  if (hasN) {
    const text = typeof notes === 'string' ? notes.trim() : '';
    if (!text) throw new ToolError(400, 'notes_empty', 'The notes are empty.');
    out = [{ start_ms: null, end_ms: null, speaker_label: 'Notes', speaker_raw: null, text }];
  } else {
    if (!Array.isArray(transcript) || transcript.length === 0) {
      throw new ToolError(400, 'transcript_empty', 'The transcript has no segments.');
    }
    if (transcript.length > LIMITS.segments) {
      throw new ToolError(413, 'too_many_segments', `A transcript may have at most ${LIMITS.segments} segments.`);
    }
    out = transcript.map((seg, i) => {
      const o = seg && typeof seg === 'object' ? (seg as Record<string, unknown>) : {};
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!text) throw new ToolError(400, 'segment_empty', `Segment ${i} has no text.`);
      const speaker = o.speaker == null ? null : str(o.speaker, 80);
      if (o.speaker != null && !speaker) throw new ToolError(400, 'segment_invalid', `Segment ${i}'s speaker is empty or too long.`);
      let start: number | null = null;
      if (o.start_ms !== undefined && o.start_ms !== null) {
        if (!isInt(o.start_ms) || o.start_ms < 0) throw new ToolError(400, 'segment_invalid', `Segment ${i}'s start_ms must be a whole number of milliseconds.`);
        start = o.start_ms;
      }
      return { start_ms: start, end_ms: null, speaker_label: speaker || 'Speaker ?', speaker_raw: null, text };
    });
  }
  const size = out.reduce((a, s) => a + bytes(s.text) + bytes(s.speaker_label), 0);
  if (size > LIMITS.bytes) throw new ToolError(413, 'transcript_too_large', 'The transcript is larger than 100 KB.');
  return out;
}

export interface SubmitArgs {
  company: unknown;
  project?: unknown;
  channel: unknown;
  occurred_at: unknown;
  interviewee: unknown;
  consent: unknown;
  transcript?: unknown;
  notes?: unknown;
  summary?: unknown;
}

/**
 * `submit_interview`: a session, its interview and its transcript, in the
 * granted company's venture. Every argument is checked before anything is
 * written, consent first.
 */
export async function submitInterview(env: Env, grant: AssistantGrant, args: SubmitArgs) {
  const consent = parseConsent(args?.consent);
  const channel = String(args?.channel ?? '');
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    throw new ToolError(400, 'invalid_channel', `channel must be one of ${CHANNELS.join(', ')}.`);
  }
  const occurred = typeof args?.occurred_at === 'string' ? Date.parse(args.occurred_at) : NaN;
  if (!Number.isFinite(occurred) || occurred > Date.now() + 5 * 60_000) {
    throw new ToolError(400, 'invalid_occurred_at', 'occurred_at must be the date and time the interview took place.');
  }
  const occurredIso = new Date(occurred).toISOString();
  const interviewee = parseInterviewee(args?.interviewee);
  const segments = parseTranscript(args?.transcript, args?.notes);
  let summary: string | null = null;
  if (args?.summary !== undefined && args?.summary !== null) {
    summary = str(args.summary, 4000);
    if (!summary) throw new ToolError(400, 'summary_invalid', 'The summary is empty or longer than 4,000 characters.');
  }
  const { project } = await resolveCompanyProject(env, grant, args?.company, args?.project);

  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM interview_sessions
      WHERE submitted_via = ? AND created_by_user_id = ? AND created_at >= datetime('now', '-1 day')`,
  ).bind(grant.clientId, grant.userId).first<{ n: number }>();
  if (Number(today?.n ?? 0) >= LIMITS.submissionsPerDay) {
    throw new ToolError(429, 'daily_limit', `This connection has submitted ${LIMITS.submissionsPerDay} interviews in the last day. Try again tomorrow.`);
  }

  const iv = await env.DB.prepare(
    `INSERT INTO discovery_interviews
       (project_id, interviewee_name, interviewee_role, interviewee_company, interview_date, stage, done_at, channel)
     VALUES (?, ?, ?, ?, ?, 'done', ?, ?) RETURNING id`,
  ).bind(project.id, interviewee.label, interviewee.role, interviewee.company, occurredIso.slice(0, 10), occurredIso, channel)
    .first<{ id: number }>();
  if (!iv) throw new ToolError(500, 'not_stored', 'The interview could not be stored.');
  const uid = crypto.randomUUID();
  let sessionId: number | null = null;
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO interview_sessions
         (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
          started_at, stopped_at, submitted_via, submitted_via_name, submitted_summary)
       VALUES (?, ?, ?, ?, ?, 'draft', 'given', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(uid, iv.id, project.id, grant.userId, channel, consent.method, consent.recordedAt,
      occurredIso, occurredIso, grant.clientId, str(grant.clientName, 120) ?? 'An AI assistant', summary)
      .first<{ id: number }>();
    sessionId = ins ? Number(ins.id) : null;
    const session = sessionId ? await loadSession(env, sessionId) : null;
    if (!session) throw new Error('session_not_created');
    await replaceWithFinal(env, session, segments, SUBMISSION_MODEL, null, 'transcribed');
  } catch (e) {
    // Leave nothing half-written: no interview without its session.
    if (sessionId) await env.DB.prepare('DELETE FROM interview_transcript_segments WHERE session_id = ?').bind(sessionId).run().catch(() => {});
    if (sessionId) await env.DB.prepare('DELETE FROM interview_sessions WHERE id = ?').bind(sessionId).run().catch(() => {});
    await env.DB.prepare('DELETE FROM discovery_interviews WHERE id = ?').bind(iv.id).run().catch(() => {});
    console.error('[assistant] submit failed:', (e as Error)?.message);
    throw new ToolError(500, 'not_stored', 'The interview could not be stored. Nothing was kept.');
  }
  await audit(env, grant, project.id, 'interview_session_submitted', {
    session_uid: uid, interview_id: iv.id, channel, segments: segments.length, summary: summary != null,
  });
  const stored = await finalSegments(env, sessionId!);
  return {
    session_id: sessionId!,
    segments: stored.map((s) => ({ start_ms: s.start, end_ms: s.end, speaker: s.speaker, text: s.text })),
  };
}

// ---------------------------------------------------------------------------
// propose_placements
// ---------------------------------------------------------------------------

async function finalSegments(env: Env, sessionId: number): Promise<Segment[]> {
  const rows = await env.DB.prepare(
    `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(sessionId).all<SegmentRow>();
  return toSegments(rows.results ?? []);
}

/** Whitespace normalised, nothing else: case and punctuation are the quote's. */
export const normaliseWs = (s: string) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Where a quote sits in the stored transcript, or null when it is not there
 * verbatim. The span is the segments the quote falls in — computed here, never
 * taken from the assistant.
 */
export function quoteSpan(segments: readonly Segment[], quote: string): { from: number; to: number } | null {
  const q = normaliseWs(quote);
  if (!q) return null;
  let full = '';
  const at: { s: Segment; from: number; to: number }[] = [];
  for (const s of segments) {
    const t = normaliseWs(s.text);
    if (!t) continue;
    if (full) full += ' ';
    at.push({ s, from: full.length, to: full.length + t.length });
    full += t;
  }
  const idx = full.indexOf(q);
  if (idx < 0) return null;
  const end = idx + q.length;
  const hit = at.filter((x) => x.from < end && x.to > idx);
  if (!hit.length) return null;
  return { from: hit[0].s.start, to: hit[hit.length - 1].s.end };
}

export interface ProposeArgs {
  session_id: unknown;
  run_label?: unknown;
  placements: unknown;
}

function newRunId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `propose_placements`: the assistant's own reading of a session, stored as
 * pending proposals with `source: 'assistant'`. Each placement passes D658's
 * kind validation and the verbatim-quote rule, or is dropped and reported.
 */
export async function proposePlacements(env: Env, grant: AssistantGrant, args: ProposeArgs) {
  const { session, project } = await scopeSession(env, grant, args?.session_id);
  const list = args?.placements;
  if (!Array.isArray(list) || list.length === 0) throw new ToolError(400, 'placements_required', 'Send at least one placement.');
  if (list.length > LIMITS.placementsPerCall) {
    throw new ToolError(413, 'too_many_placements', `At most ${LIMITS.placementsPerCall} placements per call.`);
  }
  const runLabel = args?.run_label == null ? null : str(args.run_label, 80);
  const segments = await finalSegments(env, session.id);
  if (!segments.length) throw new ToolError(409, 'no_transcript', 'This session has no transcript to place anything from.');
  const ctx = await loadStructureContext(env, project.id);

  const dropped: { index: number; reason: string }[] = [];
  const keep: { kind: string; payload: Record<string, unknown>; from: number; to: number; quote: string }[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const kind = o.kind;
    if (!isPlacementKind(kind)) { dropped.push({ index, reason: 'unknown_kind' }); return; }
    const spec = PLACEMENT_KINDS[kind];
    if (o.module !== spec.module) { dropped.push({ index, reason: 'module_mismatch' }); return; }
    const payload = o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload)
      ? spec.parse(o.payload as Record<string, unknown>, ctx)
      : null;
    if (!payload) { dropped.push({ index, reason: 'invalid_payload' }); return; }
    const quote = typeof o.quote === 'string' ? normaliseWs(o.quote) : '';
    if (!quote) { dropped.push({ index, reason: 'no_quote' }); return; }
    if (quote.length > MAX_QUOTE) { dropped.push({ index, reason: 'quote_too_long' }); return; }
    const span = quoteSpan(segments, quote);
    if (!span) { dropped.push({ index, reason: 'quote_not_in_transcript' }); return; }
    const key = `${kind}|${spec.key(payload)}`;
    if (seen.has(key)) { dropped.push({ index, reason: 'duplicate' }); return; }
    seen.add(key);
    keep.push({ kind, payload, from: span.from, to: span.to, quote });
  });

  const runId = newRunId();
  if (keep.length) {
    await env.DB.batch(keep.map((p) => env.DB.prepare(
      `INSERT INTO validate_proposals
         (project_id, kind, payload_json, model, task, created_by, surface, fill_class,
          citation_json, target_ref, session_id, cite_from, cite_to, run_id, source)
       VALUES (?, ?, ?, NULL, 'assistant_placements', ?, 'validate/interview', 'restatement', ?, ?, ?, ?, ?, ?, 'assistant')`,
    ).bind(
      project.id, p.kind, JSON.stringify(p.payload), grant.userId,
      JSON.stringify({ kind: 'transcript', session_id: session.id, from: p.from, to: p.to, quote: p.quote, run_label: runLabel }),
      `interview:${session.interview_id}`, session.id, p.from, p.to, runId,
    )));
  }
  await audit(env, grant, project.id, 'assistant_placements_proposed', {
    session_uid: session.uid, run_id: runId, stored: keep.length, dropped: dropped.length,
  });
  return { run_id: runId, stored: keep.length, dropped };
}

// ---------------------------------------------------------------------------
// structure_with_studioos
// ---------------------------------------------------------------------------

const MODEL_RE = /^@cf\/[a-z0-9._/-]{3,100}$/i;
const BUDGET_REFUSALS = new Set(['budget_user_day', 'budget_user_month', 'budget_org_month', 'budget_review', 'kill_switch']);

/**
 * `structure_with_studioos`: D658's own structuring on the same transcript,
 * through `aiRouter` and the D640 budget. Its run id lines up with the
 * assistant's in D658's compare read.
 */
export async function structureWithStudioos(env: Env, grant: AssistantGrant, args: { session_id: unknown; model?: unknown }) {
  const { session, project } = await scopeSession(env, grant, args?.session_id);
  let model: string | undefined;
  if (args?.model !== undefined && args?.model !== null) {
    if (typeof args.model !== 'string' || !MODEL_RE.test(args.model.trim())) {
      throw new ToolError(400, 'model_not_offered', 'That model is not offered for structuring. Nothing was run.');
    }
    model = args.model.trim();
  }
  const segments = await finalSegments(env, session.id);
  if (!segments.length) throw new ToolError(409, 'no_transcript', 'This session has no transcript to structure.');
  const prior = await env.DB.prepare('SELECT COUNT(DISTINCT run_id) AS n FROM validate_proposals WHERE session_id = ?')
    .bind(session.id).first<{ n: number }>();
  const step = Number(prior?.n || 0) > 0 ? 're_structured' : 'structured';
  const runId = newRunId();
  const out = await structureTranscript(env, {
    userId: grant.userId, model, segments, context: await loadStructureContext(env, project.id), step,
  });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && i === out.receipt.length - 1;
    await recordStructureReceipt(env, session.id, runId, out.receipt[i], refusedHere ? 'refused' : 'ok',
      refusedHere ? (out as { refusal: string | null }).refusal ?? null : null);
  }
  if (!out.ok) {
    const refusal = out.refusal ?? 'unavailable';
    await audit(env, grant, project.id, 'assistant_structure_refused', { session_uid: session.uid, run_id: runId, refusal });
    if (BUDGET_REFUSALS.has(refusal)) throw new ToolError(402, refusal, budgetRefusalMessage(refusal));
    if (refusal === 'model_not_offered') throw new ToolError(400, refusal, 'That model is not offered for structuring. Nothing was run.');
    throw new ToolError(503, refusal, 'The model could not be reached. Nothing was stored.');
  }
  await storePlacements(env, {
    projectId: project.id, sessionId: session.id, interviewId: session.interview_id, runId,
    userId: grant.userId, model: out.receipt[out.receipt.length - 1]?.model || '', placements: out.placements,
  });
  await env.DB.prepare(
    "UPDATE interview_sessions SET status = 'structured', updated_at = datetime('now') WHERE id = ? AND status = 'transcribed'",
  ).bind(session.id).run();
  await audit(env, grant, project.id, 'assistant_structure_run', {
    session_uid: session.uid, run_id: runId, stored: out.placements.length, dropped: out.dropped,
  });
  return { run_id: runId, step, stored: out.placements.length, dropped: out.dropped, parts: out.parts };
}

// ---------------------------------------------------------------------------
// The tool definitions #1496's registry takes
// ---------------------------------------------------------------------------

const MODULES = [...new Set(Object.values(PLACEMENT_KINDS).map((k) => k.module))];

export const TOOLS = {
  submit_interview: {
    name: 'submit_interview',
    description: [
      'Store a customer-discovery interview in StudioOS as an interview session with its transcript.',
      'Only for an interview whose interviewee consented to it being recorded and processed — by you, the',
      'assistant, and by StudioOS. Without consent "given" nothing is stored. Describe the interviewee by a',
      'label, role and company only: never an email address or phone number. Send the transcript as segments,',
      'or notes as text. Nothing is added to the founder’s Validate modules by this call.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['company', 'channel', 'occurred_at', 'interviewee', 'consent'],
      properties: {
        company: { type: 'integer', description: 'The granted company’s id (from list_companies).' },
        project: { type: 'integer', description: 'Only when the company has several ventures: which one.' },
        channel: { type: 'string', enum: [...CHANNELS] },
        occurred_at: { type: 'string', format: 'date-time' },
        interviewee: {
          type: 'object', required: ['label'], additionalProperties: false,
          properties: { label: { type: 'string', maxLength: 80 }, role: { type: 'string', maxLength: 80 }, company: { type: 'string', maxLength: 120 } },
        },
        consent: {
          type: 'object', required: ['status', 'method', 'recorded_at'],
          properties: {
            status: { type: 'string', enum: ['given'] },
            method: { type: 'string', enum: [...CONSENT_METHODS] },
            recorded_at: { type: 'string', format: 'date-time' },
          },
        },
        transcript: {
          type: 'array', maxItems: LIMITS.segments,
          items: {
            type: 'object', required: ['text'],
            properties: { speaker: { type: 'string', maxLength: 80 }, text: { type: 'string' }, start_ms: { type: 'integer', minimum: 0 } },
          },
        },
        notes: { type: 'string' },
        summary: { type: 'string', maxLength: 4000 },
      },
    },
  },
  propose_placements: {
    name: 'propose_placements',
    description: [
      'Propose what a submitted interview says for each Validate module. Each placement must quote, word for word,',
      'the passage of the stored transcript it comes from; a placement whose quote is not in the transcript is',
      'dropped and reported. Every placement waits for the founder to accept, edit or discard it in StudioOS.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['session_id', 'placements'],
      properties: {
        session_id: { type: 'integer' },
        run_label: { type: 'string', maxLength: 80 },
        placements: {
          type: 'array', minItems: 1, maxItems: LIMITS.placementsPerCall,
          items: {
            type: 'object', required: ['module', 'kind', 'payload', 'quote'],
            properties: {
              module: { type: 'string', enum: MODULES },
              kind: { type: 'string', enum: Object.keys(PLACEMENT_KINDS) },
              payload: { type: 'object' },
              quote: { type: 'string', maxLength: MAX_QUOTE },
            },
          },
        },
      },
    },
  },
  structure_with_studioos: {
    name: 'structure_with_studioos',
    description: [
      'Ask StudioOS to structure a submitted interview with its own model, against the founder’s AI allowance,',
      'so the founder can compare its proposals with yours. Returns the run id.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['session_id'],
      properties: { session_id: { type: 'integer' }, model: { type: 'string' } },
    },
  },
} as const;
