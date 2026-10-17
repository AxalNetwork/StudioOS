/**
 * D659 — the one writer for each Validate record migration 440 added.
 *
 * ONE FUNCTION PER RECORD, CALLED BY EVERY PATH THAT WRITES IT. The manual
 * routes in `routes/cycle_validate.ts` call these; so does the interview
 * accept path (#1471, D658) for `segment`, `demand_signal` and
 * `competitor_mention`. A proposal accepted from an interview and the same
 * thing typed into a form produce the same row, because there is only one
 * function that writes it — the rule `services/fills/registry.ts` states for
 * every fill.
 *
 * WHAT A WRITER CHECKS AND WHAT IT DOES NOT. Each one validates its own
 * values against a fixed list and binds every one of them. None of them
 * decides who may write: the route checks `canWrite` against the project and
 * the accept path checks the proposal's project before either gets here.
 * Every write records its actor in `activity_logs`, so a write an admin makes
 * on a founder's venture is never silent.
 *
 * NOTHING AN INTERVIEW PRODUCES ENTERS A MODULE WITHOUT THE FOUNDER'S CLICK.
 * These functions are that click's end; nothing in the read path calls them,
 * except `seedSegmentFromIcp`, which copies the founder's own confirmed ICP
 * definition and nothing else.
 */
import type { Env, User } from '../types';
import { logCycleWrite, logCycleWriteStatement } from './cycleActivity';
import { RECORD_ID, ownedRow } from './records/owned';
import { loadPainGroupModel, normPhrase, resolvePhrase, safeParseStrings, isPainSeverityLevel } from './painGroups';
import { ownsVenture, type ProjectRef } from '../routes/_founder_validate_helpers';
import { insertHypothesisLink, insertHypothesisWithLinks, upsertPainAlias, MAX_PAIN_PHRASE } from '../routes/_founder_validate_writes';
import { mintDownloadToken } from './signedDownload';
import { insertManualCandidate } from '../routes/_competitor_writes';
import { ensureCompetitorSchema } from './competitorSchema';
import type { AnalysisInputs } from './competitorAnalysis';

/**
 * A refusal a route can return as-is. `sentence` is always one this file
 * wrote — never a database's or a provider's text — so it is the field a
 * route puts in a body (D278).
 */
export class WriterError extends Error {
  status: number;
  sentence: string;
  constructor(status: number, sentence: string) {
    super(sentence);
    this.status = status;
    this.sentence = sentence;
  }
}

const trimOrNull = (v: unknown, max = 500): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/** `YYYY-MM-DD`, or null. A date the platform cannot order is not a date. */
export function isoDateOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** An `http(s)` URL, or null. Anything else never reaches a link on a page. */
export function httpUrlOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.length > 1000) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function recordActor(env: Env, userId: number | null, projectId: number,
  module: string, entityId: string | number, action: string, summary: string) {
  await logCycleWrite(env, { projectId, userId, cycle: 'validate', module, entityId, action, summary });
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export const SEGMENT_SOURCES = ['manual', 'icp_definition', 'interview'] as const;

export function segmentNameNorm(name: string): string {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
}

export type SegmentInput = {
  projectId: number;
  userId: number | null;
  name: unknown;
  description?: unknown;
  source?: unknown;
  sourceRef?: unknown;
} & SegmentSteps;

/** D690 (#1692) — New segment's five steps and the fields beside them (migration 460). */
export type SegmentSteps = {
  who_they_are?: unknown;
  context?: unknown;
  job_to_be_done?: unknown;
  urgency?: unknown;
  value_promised?: unknown;
  value_source?: unknown;
  score_since?: unknown;
};

export const SEGMENT_URGENCIES = ['low', 'medium', 'high'] as const;
const SEGMENT_STEP_KEYS = ['who_they_are', 'context', 'job_to_be_done', 'urgency', 'value_promised', 'value_source', 'score_since'] as const;

/** The steps a body names, checked; `undefined` for a step it does not name. */
function segmentSteps(input: SegmentSteps): Record<(typeof SEGMENT_STEP_KEYS)[number], string | null | undefined> {
  const text = (v: unknown) => (v === undefined ? undefined : trimOrNull(v, 1000));
  const urgency = input.urgency === undefined ? undefined
    : (input.urgency === null || input.urgency === '' ? null : String(input.urgency));
  if (urgency != null && !(SEGMENT_URGENCIES as readonly string[]).includes(urgency)) {
    throw new WriterError(400, `urgency must be one of ${SEGMENT_URGENCIES.join(', ')}`);
  }
  const since = input.score_since === undefined ? undefined
    : (input.score_since === null || input.score_since === '' ? null : isoDateOrNull(input.score_since));
  if (input.score_since != null && input.score_since !== '' && since == null) throw new WriterError(400, 'score_since must be YYYY-MM-DD');
  return {
    who_they_are: text(input.who_they_are), context: text(input.context), job_to_be_done: text(input.job_to_be_done),
    urgency, value_promised: text(input.value_promised), value_source: text(input.value_source), score_since: since,
  };
}

/**
 * Add a segment, or return the one already named so. Writing the same name
 * twice is one segment: the unique index is on `(project_id, name_norm)`, and
 * an interview proposal naming an existing segment must land on it rather
 * than beside it.
 */
export async function writeSegment(env: Env, input: SegmentInput): Promise<{ id: number; name: string; created: boolean }> {
  const name = trimOrNull(input.name, 120);
  if (!name) throw new WriterError(400, 'A segment needs a name');
  const source = (SEGMENT_SOURCES as readonly string[]).includes(String(input.source)) ? String(input.source) : 'manual';
  const norm = segmentNameNorm(name);
  const existing = await env.DB.prepare(
    'SELECT id, name FROM customer_segments WHERE project_id = ? AND name_norm = ?',
  ).bind(input.projectId, norm).first<{ id: number; name: string }>();
  if (existing) return { id: Number(existing.id), name: existing.name, created: false };
  const steps = segmentSteps(input);
  // A segment with none of the five steps writes the columns every caller has
  // always written, so the interview accept path works on a store 460 has not
  // reached.
  const plain = SEGMENT_STEP_KEYS.every((k) => steps[k] == null);
  const row = plain
    ? await env.DB.prepare(
      `INSERT INTO customer_segments (project_id, name, name_norm, description, source, source_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(input.projectId, name, norm, trimOrNull(input.description, 1000), source, trimOrNull(input.sourceRef, 200), input.userId)
      .first<{ id: number }>()
    : await env.DB.prepare(
      `INSERT INTO customer_segments (project_id, name, name_norm, description, source, source_ref, created_by,
         who_they_are, context, job_to_be_done, urgency, value_promised, value_source, score_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    ).bind(input.projectId, name, norm, trimOrNull(input.description, 1000), source, trimOrNull(input.sourceRef, 200), input.userId,
      steps.who_they_are ?? null, steps.context ?? null, steps.job_to_be_done ?? null, steps.urgency ?? null,
      steps.value_promised ?? null, steps.value_source ?? null, steps.score_since ?? null)
      .first<{ id: number }>();
  if (!row) throw new WriterError(500, 'The segment was not written');
  await recordActor(env, input.userId, input.projectId, 'customer-segments', row.id, 'segment_written', `Segment ${row.id} created`);
  return { id: Number(row.id), name, created: true };
}

/** Which segment an interview was with, or `null` to clear it. */
export async function assignInterviewSegment(
  env: Env,
  input: { projectId: number; userId: number | null; interviewId: number; segmentId: number | null },
): Promise<void> {
  const previous = await env.DB.prepare('SELECT segment_id FROM discovery_interviews WHERE id = ? AND project_id = ?')
    .bind(input.interviewId, input.projectId).first<{ segment_id: number | null }>();
  if (input.segmentId != null) {
    const seg = await env.DB.prepare(
      'SELECT id FROM customer_segments WHERE id = ? AND project_id = ?',
    ).bind(input.segmentId, input.projectId).first();
    if (!seg) throw new WriterError(404, 'Segment not found on this project');
  }
  const res = await env.DB.prepare(
    'UPDATE discovery_interviews SET segment_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  ).bind(input.segmentId, input.interviewId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Interview not found on this project');
  await recordActor(env, input.userId, input.projectId, 'customer-research', input.interviewId, 'interview_segment_set', `Interview segment ${input.segmentId ?? 'cleared'}`);
  if (previous?.segment_id != null && previous.segment_id !== input.segmentId) {
    await recordActor(env, input.userId, input.projectId, 'ideal-customer-profile', previous.segment_id,
      'interview_segment_unlinked', `Interview ${input.interviewId} unlinked`);
  }
  if (input.segmentId != null) {
    await recordActor(env, input.userId, input.projectId, 'ideal-customer-profile', input.segmentId,
      'interview_segment_linked', `Interview ${input.interviewId} linked`);
  }
}

/**
 * The first segment of a project, from its confirmed ICP definition.
 *
 * Runs only when the project has NO segment and its ICP definition is
 * `confirmed` — a draft is the founder still thinking, and a segment named
 * from it would put words in their mouth. The name is the definition's own
 * persona and industry, as typed. Idempotent: the unique index and the
 * existence check both stop a second seed.
 */
export async function seedSegmentFromIcp(env: Env, projectId: number): Promise<number | null> {
  const has = await env.DB.prepare('SELECT 1 AS hit FROM customer_segments WHERE project_id = ? LIMIT 1')
    .bind(projectId).first();
  if (has) return null;
  const p = await env.DB.prepare('SELECT icp_definition_meta FROM projects WHERE id = ?')
    .bind(projectId).first<{ icp_definition_meta: string | null }>();
  let def: any = null;
  try { def = p?.icp_definition_meta ? JSON.parse(p.icp_definition_meta) : null; } catch { def = null; }
  if (!def || def.status !== 'confirmed' || !def.fields || typeof def.fields !== 'object') return null;
  const persona = trimOrNull(def.fields.persona, 60);
  const industry = trimOrNull(def.fields.industry, 60);
  const name = persona && industry ? `${persona} · ${industry}` : persona || industry;
  if (!name) return null;
  const out = await writeSegment(env, {
    projectId, userId: null, name, source: 'icp_definition', sourceRef: 'projects.icp_definition_meta',
    description: trimOrNull(def.fields.pain1, 1000),
  });
  return out.id;
}

// ---------------------------------------------------------------------------
// Interview pipeline
// ---------------------------------------------------------------------------

export const INTERVIEW_STAGES = ['lead', 'invited', 'booked', 'done'] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

/** One literal statement per stage, so no column name is ever spliced. */
const STAGE_SQL: Record<InterviewStage, string> = {
  lead: 'UPDATE discovery_interviews SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  invited: 'UPDATE discovery_interviews SET stage = ?, invited_at = COALESCE(invited_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  booked: 'UPDATE discovery_interviews SET stage = ?, booked_at = COALESCE(booked_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  done: 'UPDATE discovery_interviews SET stage = ?, done_at = COALESCE(done_at, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
};

/**
 * Move an interview to a stage, stamping the time it got there. A stage's
 * stamp is kept when it moves on, so the funnel can say how many reached
 * each stage, not only where each one is now.
 */
export async function setInterviewStage(
  env: Env,
  input: { projectId: number; userId: number | null; interviewId: number; stage: unknown; at?: unknown },
): Promise<void> {
  const stage = String(input.stage ?? '');
  if (!(INTERVIEW_STAGES as readonly string[]).includes(stage)) {
    throw new WriterError(400, `stage must be one of ${INTERVIEW_STAGES.join(', ')}`);
  }
  const at = typeof input.at === 'string' && Number.isFinite(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString();
  const res = await (stage === 'lead'
    ? env.DB.prepare(STAGE_SQL.lead).bind(stage, input.interviewId, input.projectId)
    : env.DB.prepare(STAGE_SQL[stage as Exclude<InterviewStage, 'lead'>]).bind(stage, at, input.interviewId, input.projectId)
  ).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Interview not found on this project');
  await recordActor(env, input.userId, input.projectId, 'customer-research', input.interviewId, 'interview_stage_set', `Interview stage ${stage}`);
}

// ---------------------------------------------------------------------------
// Demand signals
// ---------------------------------------------------------------------------

/**
 * `would_pay` is here because #1471's interview proposals name it beside the
 * four the canvas draws; it reads as a need-to-have that named a price.
 */
export const DEMAND_KINDS = ['loi', 'pre_sale', 'waitlist', 'need_to_have', 'would_pay'] as const;
export const DEMAND_STATUSES = ['confirmed', 'counted', 'to_confirm'] as const;
export const DEMAND_SOURCES = ['manual', 'interview', 'session'] as const;

export type DemandSignalInput = {
  projectId: number;
  userId: number | null;
  kind: unknown;
  who?: unknown;
  amount_cents?: unknown;
  currency?: unknown;
  period?: unknown;
  signal_date?: unknown;
  status?: unknown;
  source_kind?: unknown;
  interview_id?: unknown;
  session_id?: unknown;
  note?: unknown;
};

export async function writeDemandSignal(env: Env, input: DemandSignalInput): Promise<{ id: number }> {
  const kind = String(input.kind ?? '');
  if (!(DEMAND_KINDS as readonly string[]).includes(kind)) {
    throw new WriterError(400, `kind must be one of ${DEMAND_KINDS.join(', ')}`);
  }
  // An amount is a positive whole number of cents, or it is not recorded.
  // Zero is refused rather than stored: "no amount named" is NULL.
  let amount: number | null = null;
  if (input.amount_cents != null && input.amount_cents !== '') {
    const n = Number(input.amount_cents);
    if (!Number.isInteger(n) || n <= 0) throw new WriterError(400, 'amount_cents must be a positive whole number, or omitted');
    amount = n;
  }
  // D690 (#1692) — "pre-sales and letters of intent only" (CO:309): a
  // need-to-have mention or a waitlist sign-up names no amount.
  if (amount != null && (kind === 'need_to_have' || kind === 'waitlist')) {
    throw new WriterError(400, 'An amount is for pre-sales and letters of intent only');
  }
  const currency = amount != null ? (String(input.currency ?? 'usd').trim().toLowerCase() || 'usd') : null;
  if (currency != null && !/^[a-z]{3}$/.test(currency)) throw new WriterError(400, 'currency must be a three-letter code');
  const period = input.period == null || input.period === '' ? null : String(input.period);
  if (period != null && !['once', 'month', 'year'].includes(period)) throw new WriterError(400, 'period must be once, month or year');
  const date = input.signal_date == null || input.signal_date === ''
    ? new Date().toISOString().slice(0, 10)
    : isoDateOrNull(input.signal_date);
  if (!date) throw new WriterError(400, 'signal_date must be YYYY-MM-DD');
  const sourceKind = (DEMAND_SOURCES as readonly string[]).includes(String(input.source_kind)) ? String(input.source_kind) : 'manual';
  // What an interview proposes waits for the founder; what they type is theirs.
  const status = input.status == null || input.status === ''
    ? (sourceKind === 'manual' ? 'confirmed' : 'to_confirm')
    : String(input.status);
  if (!(DEMAND_STATUSES as readonly string[]).includes(status)) {
    throw new WriterError(400, `status must be one of ${DEMAND_STATUSES.join(', ')}`);
  }
  let interviewId: number | null = null;
  if (input.interview_id != null && input.interview_id !== '') {
    interviewId = Number(input.interview_id);
    const iv = Number.isInteger(interviewId)
      ? await env.DB.prepare('SELECT id FROM discovery_interviews WHERE id = ? AND project_id = ?').bind(interviewId, input.projectId).first()
      : null;
    if (!iv) throw new WriterError(404, 'Interview not found on this project');
  }
  const sessionId = input.session_id != null && Number.isInteger(Number(input.session_id)) ? Number(input.session_id) : null;
  const row = await env.DB.prepare(
    `INSERT INTO demand_signals
       (project_id, kind, who, amount_cents, currency, period, signal_date, status, source_kind, interview_id, session_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(
    input.projectId, kind, trimOrNull(input.who, 200), amount, currency, period, date, status, sourceKind,
    interviewId, sessionId, trimOrNull(input.note, 1000), input.userId,
  ).first<{ id: number }>();
  if (!row) throw new WriterError(500, 'The signal was not written');
  await recordActor(env, input.userId, input.projectId, 'demand-signals', `signal-${row.id}`, 'demand_signal_written', `Signal ${kind} ${status}`);
  return { id: Number(row.id) };
}

/** Confirm, count or return a signal to "to confirm". */
export async function setDemandSignalStatus(
  env: Env,
  input: { projectId: number; userId: number | null; signalId: number; status: unknown },
): Promise<void> {
  const status = String(input.status ?? '');
  if (!(DEMAND_STATUSES as readonly string[]).includes(status)) {
    throw new WriterError(400, `status must be one of ${DEMAND_STATUSES.join(', ')}`);
  }
  const res = await env.DB.prepare(
    `UPDATE demand_signals SET status = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(status, input.signalId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Signal not found on this project');
  await recordActor(env, input.userId, input.projectId, 'demand-signals', `signal-${input.signalId}`, 'demand_signal_status', `Signal status ${status}`);
}

// ---------------------------------------------------------------------------
// Waitlist bar
// ---------------------------------------------------------------------------

/** D685 §5.12 — the `metric_targets` key Validate's interviews meter reads. */
export const INTERVIEWS_TARGET_KEY = 'interviews_month_target';

/** Set the monthly interviews target, or clear it with `null`. A target of 0 is refused. */
export async function setInterviewsTarget(
  env: Env,
  input: { projectId: number; userId: number | null; value: unknown },
): Promise<void> {
  if (input.value === null) {
    await env.DB.prepare('DELETE FROM metric_targets WHERE project_id = ? AND metric_key = ?')
      .bind(input.projectId, INTERVIEWS_TARGET_KEY).run();
    await recordActor(env, input.userId, input.projectId, 'customer-research', input.projectId, 'interviews_target_cleared', 'Monthly interviews target cleared');
    return;
  }
  const n = Number(input.value);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000) throw new WriterError(400, 'The target is a whole number of interviews a month, above zero');
  await env.DB.prepare(
    `INSERT INTO metric_targets (project_id, metric_key, target_value, direction, label, created_by)
     VALUES (?, ?, ?, 'up', 'Interviews this month', ?)
     ON CONFLICT(project_id, metric_key)
     DO UPDATE SET target_value = excluded.target_value, updated_at = datetime('now')`,
  ).bind(input.projectId, INTERVIEWS_TARGET_KEY, n, input.userId).run();
  await recordActor(env, input.userId, input.projectId, 'customer-research', input.projectId, 'interviews_target_set', `Monthly interviews target ${n}`);
}

/** The `metric_targets` key the waitlist bar lives under. */
export const WAITLIST_TARGET_KEY = 'waitlist_target';

/** Set the bar (sign-ups), or clear it with `null`. A bar of 0 is refused. */
export async function setWaitlistTarget(
  env: Env,
  input: { projectId: number; userId: number | null; value: unknown },
): Promise<void> {
  if (input.value === null) {
    await env.DB.prepare('DELETE FROM metric_targets WHERE project_id = ? AND metric_key = ?')
      .bind(input.projectId, WAITLIST_TARGET_KEY).run();
    await recordActor(env, input.userId, input.projectId, 'demand-signals', input.projectId, 'waitlist_target_cleared', 'Waitlist target cleared');
    return;
  }
  const n = Number(input.value);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new WriterError(400, 'The bar is a whole number of sign-ups above zero');
  await env.DB.prepare(
    `INSERT INTO metric_targets (project_id, metric_key, target_value, direction, label, created_by)
     VALUES (?, ?, ?, 'up', 'Waitlist sign-ups', ?)
     ON CONFLICT(project_id, metric_key)
     DO UPDATE SET target_value = excluded.target_value, updated_at = datetime('now')`,
  ).bind(input.projectId, WAITLIST_TARGET_KEY, n, input.userId).run();
  await recordActor(env, input.userId, input.projectId, 'demand-signals', input.projectId, 'waitlist_target_set', `Waitlist target ${n}`);
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export const COMPETITOR_KINDS = ['direct', 'adjacent'] as const;
export const COMPETITOR_SIGNAL_TYPES = ['mention', 'funding', 'launch', 'hiring', 'pricing', 'other'] as const;
export const COMPETITOR_SOURCE_KINDS = ['manual', 'interview', 'session', 'web'] as const;

export type CompetitorMentionInput = {
  projectId: number;
  userId: number;
  name: unknown;
  category?: unknown;
  signal_type?: unknown;
  label?: unknown;
  detail?: unknown;
  source_url?: unknown;
  source_kind?: unknown;
  observed_on?: unknown;
  /** D690 (#1692) — a funding round's amount, in cents, with its currency (migration 460). */
  amount_cents?: unknown;
  currency?: unknown;
};

/**
 * A competitor named somewhere — an interview, a session, the web — on the
 * project's tracked list, with the signal that named it and its source.
 *
 * THE LIST IS THE PROJECT'S COMPETITOR ANALYSIS, as `/api/competitors` keeps
 * it. A name already on it is matched case-insensitively and gains a signal;
 * a new name is added through `insertManualCandidate`, the function the
 * manual form calls. With no analysis on the project this refuses, exactly
 * as the competitor fill does: starting one runs discovery and a crawl.
 */
export async function writeCompetitorMention(
  env: Env,
  input: CompetitorMentionInput,
): Promise<{ candidate_id: string; signal_id: string; added: boolean }> {
  const name = trimOrNull(input.name, 120);
  if (!name) throw new WriterError(400, 'A competitor needs a name');
  const category = (COMPETITOR_KINDS as readonly string[]).includes(String(input.category)) ? String(input.category) : 'direct';
  const signalType = (COMPETITOR_SIGNAL_TYPES as readonly string[]).includes(String(input.signal_type)) ? String(input.signal_type) : 'mention';
  const sourceKind = (COMPETITOR_SOURCE_KINDS as readonly string[]).includes(String(input.source_kind)) ? String(input.source_kind) : 'manual';
  const sourceUrl = input.source_url == null || input.source_url === '' ? null : httpUrlOrNull(input.source_url);
  if (input.source_url != null && input.source_url !== '' && !sourceUrl) throw new WriterError(400, 'source_url must be an http(s) URL');
  const observed = input.observed_on == null || input.observed_on === '' ? new Date().toISOString().slice(0, 10) : isoDateOrNull(input.observed_on);
  if (!observed) throw new WriterError(400, 'observed_on must be YYYY-MM-DD');
  let amount: number | null = null;
  if (input.amount_cents != null && input.amount_cents !== '') {
    const n = Number(input.amount_cents);
    if (!Number.isInteger(n) || n <= 0) throw new WriterError(400, 'amount_cents must be a positive whole number, or omitted');
    amount = n;
  }
  const currency = amount != null ? (String(input.currency ?? 'usd').trim().toLowerCase() || 'usd') : null;
  if (currency != null && !/^[a-z]{3}$/.test(currency)) throw new WriterError(400, 'currency must be a three-letter code');

  await ensureCompetitorSchema(env);
  const analysis = await env.DB.prepare(
    `SELECT id, inputs_json FROM competitor_analyses WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1`,
  ).bind(input.projectId).first<{ id: string; inputs_json: string | null }>();
  if (!analysis) throw new WriterError(409, 'This project has no competitor list yet. Start one from Market › Competitors.');

  const found = await env.DB.prepare(
    `SELECT c.id FROM competitor_candidates c
       JOIN competitor_analyses a ON a.id = c.analysis_id
      WHERE a.project_id = ? AND lower(trim(c.name)) = lower(?)
      ORDER BY c.created_at ASC LIMIT 1`,
  ).bind(input.projectId, name).first<{ id: string }>();
  let candidateId = found?.id ?? null;
  let added = false;
  if (!candidateId) {
    let inputs: AnalysisInputs;
    try { inputs = JSON.parse(String(analysis.inputs_json || '{}')) as AnalysisInputs; } catch { inputs = {} as AnalysisInputs; }
    const written = await insertManualCandidate(env, input.userId, String(analysis.id), inputs, {
      name, category, summary: trimOrNull(input.detail, 500) ?? undefined, crawl: false,
    });
    candidateId = String(written.id);
    added = true;
  }
  const signalId = crypto.randomUUID();
  // A signal with no amount names only the columns every caller has always
  // written, so the interview accept path works on a store 460 has not reached.
  await (amount == null
    ? env.DB.prepare(
      `INSERT INTO competitor_signals
         (id, analysis_id, candidate_id, signal_type, label, detail, project_id, source_url, source_kind, observed_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      signalId, String(analysis.id), candidateId, signalType, trimOrNull(input.label, 200) ?? signalType,
      trimOrNull(input.detail, 1000), input.projectId, sourceUrl, sourceKind, observed,
    )
    : env.DB.prepare(
      `INSERT INTO competitor_signals
         (id, analysis_id, candidate_id, signal_type, label, detail, project_id, source_url, source_kind, observed_on, amount_cents, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      signalId, String(analysis.id), candidateId, signalType, trimOrNull(input.label, 200) ?? signalType,
      trimOrNull(input.detail, 1000), input.projectId, sourceUrl, sourceKind, observed, amount, currency,
    )).run();
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', RECORD_ID.test(candidateId) ? candidateId : input.projectId, 'competitor_mention_written', added ? 'Competitor added' : 'Competitor signal added');
  return { candidate_id: candidateId, signal_id: signalId, added };
}

// ---------------------------------------------------------------------------
// Market readiness — the three checks the Lab page held in browser state
// ---------------------------------------------------------------------------

export const MARKET_MARKS = ['positioning_map', 'assumptions_reviewed'] as const;

export async function setMarketMark(
  env: Env,
  input: { projectId: number; userId: number | null; item: unknown; done: boolean },
): Promise<void> {
  const item = String(input.item ?? '');
  if (!(MARKET_MARKS as readonly string[]).includes(item)) throw new WriterError(400, `item must be one of ${MARKET_MARKS.join(', ')}`);
  if (input.done) {
    await env.DB.prepare(
      `INSERT INTO market_readiness_marks (project_id, item, marked_by) VALUES (?, ?, ?)
       ON CONFLICT(project_id, item) DO NOTHING`,
    ).bind(input.projectId, item, input.userId).run();
  } else {
    await env.DB.prepare('DELETE FROM market_readiness_marks WHERE project_id = ? AND item = ?')
      .bind(input.projectId, item).run();
  }
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', input.projectId, 'market_mark_set', `${item} ${input.done ? 'done' : 'not done'}`);
}

export async function addMarketSource(
  env: Env,
  input: { projectId: number; userId: number | null; title: unknown; url?: unknown; kind?: unknown },
): Promise<{ id: number }> {
  const title = trimOrNull(input.title, 200);
  if (!title) throw new WriterError(400, 'A source needs a title');
  const url = input.url == null || input.url === '' ? null : httpUrlOrNull(input.url);
  if (input.url != null && input.url !== '' && !url) throw new WriterError(400, 'url must be an http(s) URL');
  const kind = trimOrNull(input.kind, 40) ?? 'manual';
  const row = await env.DB.prepare(
    'INSERT INTO market_sources (project_id, title, url, kind, added_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
  ).bind(input.projectId, title, url, kind, input.userId).first<{ id: number }>();
  if (!row) throw new WriterError(500, 'The source was not written');
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', input.projectId, 'market_source_added', `Market source ${row.id} added`);
  return { id: Number(row.id) };
}

export async function removeMarketSource(
  env: Env,
  input: { projectId: number; userId: number | null; sourceId: number },
): Promise<void> {
  const res = await env.DB.prepare('DELETE FROM market_sources WHERE id = ? AND project_id = ?')
    .bind(input.sourceId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Source not found on this project');
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', input.projectId, 'market_source_removed', `Market source ${input.sourceId} removed`);
}

// ---------------------------------------------------------------------------
// Experiments and evidence
// ---------------------------------------------------------------------------

export const EVIDENCE_STRENGTHS = ['anecdote', 'pattern', 'measured'] as const;

/** Sprint, owner and the Inconclusive mark on one claim. Omitted keys are kept. */
export async function setHypothesisPlan(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; sprint?: unknown; owner_user_id?: unknown; inconclusive?: unknown },
): Promise<void> {
  const h = await env.DB.prepare('SELECT id, sprint, owner_user_id, inconclusive_at FROM hypotheses WHERE id = ? AND project_id = ?')
    .bind(input.hypothesisId, input.projectId).first<{ sprint: string | null; owner_user_id: number | null; inconclusive_at: string | null }>();
  if (!h) throw new WriterError(404, 'Hypothesis not found on this project');
  const sprint = input.sprint === undefined ? h.sprint : trimOrNull(input.sprint, 80);
  // D690 decision 12 — the owner must own the venture, not merely exist.
  const owner = input.owner_user_id === undefined ? h.owner_user_id : await checkHypothesisOwner(env, input.projectId, input.owner_user_id);
  const inconclusive = input.inconclusive === undefined
    ? h.inconclusive_at
    : (input.inconclusive === true ? (h.inconclusive_at ?? new Date().toISOString()) : null);
  await env.DB.prepare(
    'UPDATE hypotheses SET sprint = ?, owner_user_id = ?, inconclusive_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  ).bind(sprint, owner, inconclusive, input.hypothesisId, input.projectId).run();
  await recordActor(env, input.userId, input.projectId, 'experiments', input.hypothesisId, 'hypothesis_plan_set', `Hypothesis ${input.hypothesisId} plan updated`);
}

/** The strength of one evidence link, or `null` to clear it. */
export async function setEvidenceStrength(
  env: Env,
  input: { projectId: number; userId: number | null; linkId: number; strength: unknown; expectedStrength?: string | null },
): Promise<void> {
  const strength = input.strength === null ? null : String(input.strength ?? '');
  if (strength !== null && !(EVIDENCE_STRENGTHS as readonly string[]).includes(strength)) {
    throw new WriterError(400, `strength must be one of ${EVIDENCE_STRENGTHS.join(', ')}, or null`);
  }
  const linked = await env.DB.prepare(
    `SELECT l.hypothesis_id, l.pain_group_id FROM hypothesis_pain_links l
       JOIN hypotheses h ON h.id = l.hypothesis_id
      WHERE l.id = ? AND h.project_id = ?`,
  ).bind(input.linkId, input.projectId).first<{ hypothesis_id: number; pain_group_id: number }>();
  const res = await env.DB.prepare(
    `UPDATE hypothesis_pain_links SET strength = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND hypothesis_id IN (SELECT id FROM hypotheses WHERE project_id = ?)
        AND (? = 0 OR strength IS ?)`,
  ).bind(strength, input.linkId, input.projectId, input.expectedStrength === undefined ? 0 : 1, input.expectedStrength ?? null).run();
  if (!res.meta?.changes) throw new WriterError(input.expectedStrength === undefined ? 404 : 409, 'Evidence link changed or is no longer on this project. Review its strength in Experiments.');
  if (!linked) throw new WriterError(404, 'Evidence link changed or is no longer on this project. Review its strength in Experiments.');
  await recordActor(env, input.userId, input.projectId, 'experiments', linked.hypothesis_id,
    'evidence_strength_set', `Evidence strength ${strength ?? 'cleared'}`);
  await recordActor(env, input.userId, input.projectId, 'problem-discovery', linked.pain_group_id,
    'evidence_strength_set', `Hypothesis ${linked.hypothesis_id} evidence strength ${strength ?? 'cleared'}`);
}

// ===========================================================================
// D690 (#1692) — the writes behind Validate's six records and their forms.
//
// Each writer checks every id it is given against this venture (a foreign id
// answers 404, decision 3), validates its values against fixed lists, binds
// every value, and logs through `logCycleWrite` (decision 5): a summary names
// a record by code or title, never an interviewee, a quote or transcript text,
// and a link logs one row on each side. None decides who may write: the
// route checks `canWrite` first. The record actions that call them are
// declared by the closing PR.
// ===========================================================================

const ID = /^[1-9][0-9]{0,9}$/;
const intId = (v: unknown): number | null => (ID.test(String(v ?? '')) ? Number(v) : null);

async function projectRef(env: Env, projectId: number): Promise<ProjectRef> {
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<ProjectRef>();
  if (!p) throw new WriterError(404, 'Project not found');
  return p;
}

/**
 * Decision 12 — a claim's owner must own the venture (`ownsVenture`): its
 * founder, or an admitted Lab member on their own venture. Any other user
 * would put their name on the board in front of every reader.
 */
export async function checkHypothesisOwner(env: Env, projectId: number, ownerUserId: unknown): Promise<number | null> {
  if (ownerUserId === null || ownerUserId === '') return null;
  const n = intId(ownerUserId);
  const u = n == null ? null : await env.DB.prepare(
    'SELECT id, role, founder_id, spinout_lab_active FROM users WHERE id = ?',
  ).bind(n).first<User>();
  if (!u || !ownsVenture(await projectRef(env, projectId), u)) {
    throw new WriterError(400, 'The owner must be someone who owns this venture');
  }
  return Number(u.id);
}

// ---------------------------------------------------------------------------
// Segments — Edit
// ---------------------------------------------------------------------------

/** Edit a segment. Omitted keys are kept; a name another segment holds answers 409. */
export async function updateSegment(
  env: Env,
  input: { projectId: number; userId: number | null; segmentId: number; name?: unknown; description?: unknown } & SegmentSteps,
): Promise<{ id: number }> {
  const row = await env.DB.prepare(
    `SELECT id, name, description, who_they_are, context, job_to_be_done, urgency, value_promised, value_source, score_since
       FROM customer_segments WHERE id = ? AND project_id = ?`,
  ).bind(input.segmentId, input.projectId).first<Record<string, string | null>>();
  if (!row) throw new WriterError(404, 'Segment not found on this project');
  const name = input.name === undefined ? String(row.name) : trimOrNull(input.name, 120);
  if (!name) throw new WriterError(400, 'A segment needs a name');
  const norm = segmentNameNorm(name);
  const clash = await env.DB.prepare('SELECT id FROM customer_segments WHERE project_id = ? AND name_norm = ? AND id <> ?')
    .bind(input.projectId, norm, input.segmentId).first();
  if (clash) throw new WriterError(409, 'Another segment already has that name');
  const steps = segmentSteps(input);
  const keep = (k: (typeof SEGMENT_STEP_KEYS)[number]) => (steps[k] === undefined ? row[k] ?? null : steps[k]);
  await env.DB.prepare(
    `UPDATE customer_segments
        SET name = ?, name_norm = ?, description = ?, who_they_are = ?, context = ?, job_to_be_done = ?, urgency = ?,
            value_promised = ?, value_source = ?, score_since = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?`,
  ).bind(
    name, norm, input.description === undefined ? row.description ?? null : trimOrNull(input.description, 1000),
    keep('who_they_are'), keep('context'), keep('job_to_be_done'), keep('urgency'), keep('value_promised'),
    keep('value_source'), keep('score_since'), input.segmentId, input.projectId,
  ).run();
  await recordActor(env, input.userId, input.projectId, 'ideal-customer-profile', input.segmentId, 'segment_edited', `Segment ${input.segmentId} edited`);
  return { id: input.segmentId };
}

// ---------------------------------------------------------------------------
// Problem discovery — themes
// ---------------------------------------------------------------------------

export type ThemeQuote = { interview_id: unknown; phrase: unknown };

/** The interview is this venture's and the phrase is one its `pains_json` holds. */
async function checkQuote(env: Env, projectId: number, q: ThemeQuote): Promise<{ interviewId: number; norm: string; display: string }> {
  const interviewId = intId(q?.interview_id);
  const iv = interviewId == null ? null : await env.DB.prepare(
    'SELECT id, pains_json FROM discovery_interviews WHERE id = ? AND project_id = ?',
  ).bind(interviewId, projectId).first<{ id: number; pains_json: string | null }>();
  if (!iv) throw new WriterError(404, 'Interview not found on this project');
  const display = String(q?.phrase ?? '').trim().slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  const held = safeParseStrings(iv.pains_json).some((p) => normPhrase(p) === norm);
  if (!norm || !held) throw new WriterError(400, 'That phrase is not one this interview recorded');
  return { interviewId: Number(iv.id), norm, display };
}

function themeSeverity(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isPainSeverityLevel(v)) throw new WriterError(400, 'severity must be mild, real or severe');
  return v;
}

/** Decision 6 — a level for a quote with none yet; a quote already judged keeps its own. */
const severityIfUnjudged = (env: Env, interviewId: number, norm: string, severity: string) => env.DB.prepare(
  `INSERT INTO interview_pain_severities (interview_id, phrase_norm, severity) VALUES (?, ?, ?)
   ON CONFLICT(interview_id, phrase_norm) DO NOTHING`,
).bind(interviewId, norm, severity);

/**
 * New theme: the group, its quotes' aliases, the chosen severity on quotes not
 * judged yet (decision 6) and the supporting link, in one batch.
 */
export async function writeTheme(
  env: Env,
  input: { projectId: number; userId: number | null; title: unknown; severity?: unknown; quotes?: unknown; hypothesis_id?: unknown },
): Promise<{ id: number }> {
  const title = trimOrNull(input.title, MAX_PAIN_PHRASE);
  if (!title) throw new WriterError(400, 'A theme needs a title');
  const severity = themeSeverity(input.severity);
  const quotes = [];
  for (const q of Array.isArray(input.quotes) ? input.quotes.slice(0, 200) : []) quotes.push(await checkQuote(env, input.projectId, q as ThemeQuote));
  let hypothesisId: number | null = null;
  if (input.hypothesis_id != null && input.hypothesis_id !== '') {
    hypothesisId = intId(input.hypothesis_id);
    if (hypothesisId == null || !await ownedRow(env, 'hypotheses', hypothesisId, input.projectId)) throw new WriterError(404, 'Hypothesis not found on this project');
  }
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO pain_groups (project_id, title, sort_order, created_by, created_at, updated_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM pain_groups WHERE project_id = ?), ?, ?, ?) RETURNING id`,
    ).bind(input.projectId, title, input.projectId, input.userId, now, now),
  ];
  for (const q of quotes) {
    stmts.push(env.DB.prepare(
      `INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
       VALUES (?, (SELECT MAX(id) FROM pain_groups WHERE project_id = ?), ?, ?, ?, ?)
       ON CONFLICT(project_id, phrase_norm) DO UPDATE SET group_id = excluded.group_id, display_phrase = excluded.display_phrase, updated_at = excluded.updated_at`,
    ).bind(input.projectId, input.projectId, q.norm, q.display, now, now));
    if (severity) stmts.push(severityIfUnjudged(env, q.interviewId, q.norm, severity));
  }
  if (hypothesisId != null) {
    stmts.push(env.DB.prepare(
      `INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction)
       VALUES (?, (SELECT MAX(id) FROM pain_groups WHERE project_id = ?), 'supports')
       ON CONFLICT(hypothesis_id, pain_group_id, direction) DO NOTHING`,
    ).bind(hypothesisId, input.projectId));
  }
  stmts.push(logCycleWriteStatement(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
    readback: { table: 'pain_groups', by: 'max' }, action: 'theme_created', summary: `Theme ${title} created`,
  }));
  if (hypothesisId != null) {
    stmts.push(logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'experiments',
      entityId: hypothesisId, action: 'theme_linked', summary: `Linked to theme ${title}`,
    }));
  }
  const results = await env.DB.batch(stmts);
  const id = Number((results[0] as { results?: Array<{ id: number }> })?.results?.[0]?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new WriterError(500, 'The theme was not written');
  return { id };
}

async function themeRow(env: Env, projectId: number, themeId: number): Promise<{ id: number; title: string }> {
  const g = await env.DB.prepare('SELECT id, title FROM pain_groups WHERE id = ? AND project_id = ?')
    .bind(themeId, projectId).first<{ id: number; title: string }>();
  if (!g) throw new WriterError(404, 'Theme not found on this project');
  return { id: Number(g.id), title: String(g.title) };
}

/** The (interview, phrase) quotes a theme holds today, by the read's own rule (`resolvePhrase`). */
async function themeQuotes(env: Env, projectId: number, themeId: number): Promise<Array<{ interviewId: number; norm: string; display: string }>> {
  const model = await loadPainGroupModel(env, projectId);
  const ivs = await env.DB.prepare('SELECT id, pains_json FROM discovery_interviews WHERE project_id = ?')
    .bind(projectId).all<{ id: number; pains_json: string | null }>();
  const out: Array<{ interviewId: number; norm: string; display: string }> = [];
  for (const iv of ivs.results || []) {
    for (const display of safeParseStrings(iv.pains_json)) {
      const norm = normPhrase(display);
      if (norm && resolvePhrase(norm, display, model).groupId === themeId) out.push({ interviewId: Number(iv.id), norm, display });
    }
  }
  return out;
}

/** Edit a theme: its title, and a severity for its quotes not judged yet (decision 6). */
export async function updateTheme(
  env: Env,
  input: { projectId: number; userId: number | null; themeId: number; title?: unknown; severity?: unknown },
): Promise<{ id: number }> {
  const g = await themeRow(env, input.projectId, input.themeId);
  const title = input.title === undefined ? g.title : trimOrNull(input.title, MAX_PAIN_PHRASE);
  if (!title) throw new WriterError(400, 'A theme needs a title');
  const severity = themeSeverity(input.severity);
  const stmts = [env.DB.prepare("UPDATE pain_groups SET title = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?")
    .bind(title, input.themeId, input.projectId)];
  if (severity) for (const q of await themeQuotes(env, input.projectId, input.themeId)) stmts.push(severityIfUnjudged(env, q.interviewId, q.norm, severity));
  stmts.push(logCycleWriteStatement(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
    entityId: input.themeId, action: 'theme_edited', summary: `Theme ${title} edited`,
  }));
  await env.DB.batch(stmts);
  return { id: input.themeId };
}

/**
 * Delete a theme: the group, its aliases and its links in one batch, and the
 * features that named it cleared, since D1 may run with foreign keys off.
 */
export async function deleteTheme(env: Env, input: { projectId: number; userId: number | null; themeId: number }): Promise<void> {
  const g = await themeRow(env, input.projectId, input.themeId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hypothesis_pain_links WHERE pain_group_id = ?').bind(input.themeId),
    env.DB.prepare('DELETE FROM pain_group_aliases WHERE group_id = ? AND project_id = ?').bind(input.themeId, input.projectId),
    env.DB.prepare('UPDATE mvp_features SET pain_group_id = NULL WHERE pain_group_id = ? AND project_id = ?').bind(input.themeId, input.projectId),
    env.DB.prepare('DELETE FROM pain_groups WHERE id = ? AND project_id = ?').bind(input.themeId, input.projectId),
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      entityId: input.themeId, action: 'theme_deleted', summary: `Theme ${g.title} deleted`,
    }),
  ]);
}

/**
 * Merge into another theme: aliases and links move (a link the target already
 * has is dropped, not doubled), features repoint, and the old title stays as
 * an alias, so the phrases that matched it by title still land on the target.
 */
export async function mergeTheme(env: Env, input: { projectId: number; userId: number | null; themeId: number; into: unknown }): Promise<{ id: number }> {
  const from = await themeRow(env, input.projectId, input.themeId);
  const intoId = intId(input.into);
  if (intoId == null || intoId === input.themeId) throw new WriterError(400, 'Merge into another theme');
  const into = await themeRow(env, input.projectId, intoId);
  const now = new Date().toISOString();
  const oldNorm = normPhrase(from.title);
  const stmts = [
    env.DB.prepare("UPDATE pain_group_aliases SET group_id = ?, updated_at = ? WHERE group_id = ? AND project_id = ?")
      .bind(into.id, now, from.id, input.projectId),
  ];
  if (oldNorm) {
    stmts.push(env.DB.prepare(
      `INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, phrase_norm) DO UPDATE SET group_id = excluded.group_id, updated_at = excluded.updated_at`,
    ).bind(input.projectId, into.id, oldNorm, from.title, now, now));
  }
  stmts.push(
    env.DB.prepare(
      `INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction, strength)
       SELECT hypothesis_id, ?, direction, strength FROM hypothesis_pain_links WHERE pain_group_id = ?
       ON CONFLICT(hypothesis_id, pain_group_id, direction) DO NOTHING`,
    ).bind(into.id, from.id),
    env.DB.prepare('DELETE FROM hypothesis_pain_links WHERE pain_group_id = ?').bind(from.id),
    env.DB.prepare('UPDATE mvp_features SET pain_group_id = ? WHERE pain_group_id = ? AND project_id = ?').bind(into.id, from.id, input.projectId),
    env.DB.prepare('DELETE FROM pain_groups WHERE id = ? AND project_id = ?').bind(from.id, input.projectId),
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      entityId: from.id, action: 'theme_merged', summary: `Theme ${from.title} merged into ${into.title}`,
    }),
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      entityId: into.id, action: 'theme_merged_in', summary: `Theme ${from.title} merged in`,
    }),
  );
  await env.DB.batch(stmts);
  return { id: into.id };
}

/** Split: the named phrases, each one this theme holds today, move to a new theme. */
export async function splitTheme(
  env: Env,
  input: { projectId: number; userId: number | null; themeId: number; phrases: unknown; title: unknown },
): Promise<{ id: number }> {
  const from = await themeRow(env, input.projectId, input.themeId);
  const title = trimOrNull(input.title, MAX_PAIN_PHRASE);
  if (!title) throw new WriterError(400, 'The new theme needs a title');
  const held = new Map((await themeQuotes(env, input.projectId, input.themeId)).map((q) => [q.norm, q.display]));
  const phrases = [...new Set((Array.isArray(input.phrases) ? input.phrases : []).map((p) => normPhrase(String(p ?? ''))).filter(Boolean))];
  if (!phrases.length) throw new WriterError(400, 'Choose the phrases to split off');
  for (const n of phrases) if (!held.has(n)) throw new WriterError(400, 'Every phrase must be one this theme holds');
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare(
    `INSERT INTO pain_groups (project_id, title, sort_order, created_by, created_at, updated_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM pain_groups WHERE project_id = ?), ?, ?, ?) RETURNING id`,
  ).bind(input.projectId, title, input.projectId, input.userId, now, now)];
  for (const n of phrases) {
    stmts.push(env.DB.prepare(
      `INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
       VALUES (?, (SELECT MAX(id) FROM pain_groups WHERE project_id = ?), ?, ?, ?, ?)
       ON CONFLICT(project_id, phrase_norm) DO UPDATE SET group_id = excluded.group_id, updated_at = excluded.updated_at`,
    ).bind(input.projectId, input.projectId, n, held.get(n) as string, now, now));
  }
  stmts.push(
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      readback: { table: 'pain_groups', by: 'max' }, action: 'theme_split_from', summary: `Split from theme ${from.title}`,
    }),
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      entityId: from.id, action: 'theme_split', summary: `Theme ${title} split off`,
    }),
  );
  const results = await env.DB.batch(stmts);
  return { id: Number((results[0] as { results?: Array<{ id: number }> })?.results?.[0]?.id) };
}

/** Attach a quote: one phrase of one of this venture's interviews joins the theme. */
export async function attachQuote(
  env: Env,
  input: { projectId: number; userId: number | null; themeId: number; interview_id: unknown; phrase: unknown },
): Promise<void> {
  const g = await themeRow(env, input.projectId, input.themeId);
  const q = await checkQuote(env, input.projectId, { interview_id: input.interview_id, phrase: input.phrase });
  if (!await upsertPainAlias(env, input.projectId, g.id, q.display)) throw new WriterError(404, 'Theme not found on this project');
  await recordActor(env, input.userId, input.projectId, 'problem-discovery', g.id, 'quote_attached', `Quote attached to theme ${g.title}`);
}

/** Link the theme to a claim, either way; one log row on each side. */
export async function linkTheme(
  env: Env,
  input: { projectId: number; userId: number | null; themeId: number; hypothesis_id: unknown; direction: unknown },
): Promise<void> {
  const g = await themeRow(env, input.projectId, input.themeId);
  const hid = intId(input.hypothesis_id);
  const direction = String(input.direction ?? 'supports');
  if (direction !== 'supports' && direction !== 'contradicts') throw new WriterError(400, 'direction must be supports or contradicts');
  const h = hid == null ? null : await env.DB.prepare('SELECT id, code FROM hypotheses WHERE id = ? AND project_id = ?')
    .bind(hid, input.projectId).first<{ id: number; code: string }>();
  if (!h || !await insertHypothesisLink(env, input.projectId, Number(h.id), g.id, direction)) throw new WriterError(404, 'Hypothesis not found on this project');
  await recordActor(env, input.userId, input.projectId, 'problem-discovery', g.id, 'theme_linked', `Linked to ${h.code}`);
  await recordActor(env, input.userId, input.projectId, 'experiments', Number(h.id), 'theme_linked', `Linked to theme ${g.title}`);
}

// ---------------------------------------------------------------------------
// Market intelligence — competitors (decision 8)
// ---------------------------------------------------------------------------

/** The key `competitor_tracking` and `loadTracked` share: the name trimmed and lower-cased. */
export const competitorNameNorm = (name: string) => String(name || '').trim().toLowerCase().slice(0, 120);

export const WATCH_KEYS = ['funding', 'launch', 'hiring'] as const;
/** The canvas's defaults (CO:308): funding and launches on, hires off. */
export const WATCH_DEFAULTS: Record<(typeof WATCH_KEYS)[number], boolean> = { funding: true, launch: true, hiring: false };

/** Watch toggles from a body, over the stored or default ones; a non-boolean value is refused. */
function watchFrom(v: unknown, base: Record<string, boolean> = WATCH_DEFAULTS): Record<string, boolean> {
  const out: Record<string, boolean> = { ...WATCH_DEFAULTS, ...base };
  if (v === undefined || v === null) return out;
  if (typeof v !== 'object' || Array.isArray(v)) throw new WriterError(400, 'watch must name funding, launch and hiring as true or false');
  for (const k of WATCH_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined) continue;
    if (typeof x !== 'boolean') throw new WriterError(400, 'watch must name funding, launch and hiring as true or false');
    out[k] = x;
  }
  return out;
}

/** A stored `watch_json`, or the defaults when it cannot be read. */
export function parseWatch(raw: string | null | undefined): Record<string, boolean> {
  try { return watchFrom(JSON.parse(String(raw ?? 'null'))); } catch { return { ...WATCH_DEFAULTS }; }
}

const POSITIONS = ['lower', 'similar', 'higher'] as const;
const DEPTHS = ['narrower', 'similar', 'broader'] as const;
function oneOf(v: unknown, list: readonly string[], field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!list.includes(String(v))) throw new WriterError(400, `${field} must be one of ${list.join(', ')}`);
  return String(v);
}

/**
 * The venture's competitor analysis, created when it has none (decision 8),
 * where Add competitor used to answer 409. The new analysis belongs to the
 * venture's owner, the first user whose `founder_id` is the project's (as
 * `projects.ts`' `resolveOwnerUserId` reads it), else the caller, so a first
 * competitor an admin adds still opens under the founder's Market › Competitors.
 */
async function analysisFor(env: Env, projectId: number, callerId: number): Promise<{ id: string; inputs_json: string | null }> {
  await ensureCompetitorSchema(env);
  const found = await env.DB.prepare(
    'SELECT id, inputs_json FROM competitor_analyses WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1',
  ).bind(projectId).first<{ id: string; inputs_json: string | null }>();
  if (found) return found;
  const p = await projectRef(env, projectId);
  const owner = p.founder_id == null ? null : await env.DB.prepare(
    'SELECT id FROM users WHERE founder_id = ? ORDER BY id ASC LIMIT 1',
  ).bind(p.founder_id).first<{ id: number }>();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO competitor_analyses (id, user_id, project_id, mode, title, inputs_json, status)
     VALUES (?, ?, ?, 'custom', 'Competitors', '{}', 'complete')`,
  ).bind(id, owner ? Number(owner.id) : callerId, projectId).run();
  return { id, inputs_json: '{}' };
}

/** Upsert the venture's tracking row for a name; a new Add un-stops it. */
function trackingUpsert(env: Env, input: {
  projectId: number; userId: number | null; nameNorm: string; watch: Record<string, boolean>;
  why?: string | null; price?: string | null; depth?: string | null; restart: boolean;
}) {
  return env.DB.prepare(
    `INSERT INTO competitor_tracking (uid, project_id, name_norm, watch_json, why_it_matters, price_position, depth_position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, name_norm) DO UPDATE SET
       watch_json = excluded.watch_json,
       why_it_matters = COALESCE(excluded.why_it_matters, why_it_matters),
       price_position = COALESCE(excluded.price_position, price_position),
       depth_position = COALESCE(excluded.depth_position, depth_position),
       stopped_at = CASE WHEN ? = 1 THEN NULL ELSE stopped_at END,
       updated_at = datetime('now')`,
  ).bind(crypto.randomUUID(), input.projectId, input.nameNorm, JSON.stringify(input.watch),
    input.why ?? null, input.price ?? null, input.depth ?? null, input.userId, input.restart ? 1 : 0);
}

/**
 * Add competitor (decision 8): a name typed in, one of the caller's own
 * candidates (`company_ref`), or a Research › Companies row (`directory_uid`,
 * read-only shared data, so it is checked to exist rather than owned; an
 * unknown uid answers 404). Kind writes `category`. The venture's tracking
 * row records the watch settings and why it matters.
 */
export async function addCompetitor(
  env: Env,
  input: { projectId: number; userId: number; name?: unknown; company_ref?: unknown; directory_uid?: unknown; kind?: unknown; watch?: unknown; why?: unknown },
): Promise<{ candidate_id: string; added: boolean }> {
  const kind = input.kind === undefined || input.kind === null || input.kind === '' ? 'direct' : String(input.kind);
  if (!(COMPETITOR_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, `kind must be one of ${COMPETITOR_KINDS.join(', ')}`);
  const watch = watchFrom(input.watch);
  const why = trimOrNull(input.why, 1000);
  const given = [input.name, input.company_ref, input.directory_uid].filter((v) => v != null && v !== '').length;
  if (given !== 1) throw new WriterError(400, 'Name the competitor, or pick one of your candidates or a company from Research');
  await ensureCompetitorSchema(env);
  let name: string | null = null;
  let url: string | undefined;
  if (input.company_ref != null && input.company_ref !== '') {
    const ref = String(input.company_ref);
    const own = RECORD_ID.test(ref) || /^[A-Za-z0-9_-]{1,64}$/.test(ref) ? await env.DB.prepare(
      'SELECT c.name, c.url FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id WHERE c.id = ? AND a.user_id = ?',
    ).bind(ref, input.userId).first<{ name: string; url: string | null }>() : null;
    if (!own) throw new WriterError(404, 'Candidate not found in your analyses');
    name = trimOrNull(own.name, 120);
    url = own.url ?? undefined;
  } else if (input.directory_uid != null && input.directory_uid !== '') {
    const uid = String(input.directory_uid);
    const row = /^[A-Za-z0-9_-]{1,64}$/.test(uid)
      ? await env.DB.prepare('SELECT name, website FROM research_company_directory WHERE uid = ?').bind(uid).first<{ name: string; website: string }>()
      : null;
    if (!row) throw new WriterError(404, 'Company not found in Research');
    name = trimOrNull(row.name, 120);
    url = httpUrlOrNull(row.website) ?? undefined;
  } else {
    name = trimOrNull(input.name, 120);
  }
  if (!name) throw new WriterError(400, 'A competitor needs a name');
  const analysis = await analysisFor(env, input.projectId, input.userId);
  const found = await env.DB.prepare(
    `SELECT c.id FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
      WHERE a.project_id = ? AND lower(trim(c.name)) = lower(?) ORDER BY c.created_at ASC LIMIT 1`,
  ).bind(input.projectId, name).first<{ id: string }>();
  let candidateId = found?.id ?? null;
  if (candidateId) {
    await env.DB.prepare('UPDATE competitor_candidates SET category = ? WHERE id = ?').bind(kind, candidateId).run();
  } else {
    let inputs: AnalysisInputs;
    try { inputs = JSON.parse(String(analysis.inputs_json || '{}')) as AnalysisInputs; } catch { inputs = {} as AnalysisInputs; }
    const written = await insertManualCandidate(env, input.userId, String(analysis.id), inputs, { name, category: kind, url, crawl: false });
    candidateId = String(written.id);
  }
  await trackingUpsert(env, { projectId: input.projectId, userId: input.userId, nameNorm: competitorNameNorm(name), watch, why, restart: true }).run();
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', RECORD_ID.test(candidateId) ? candidateId : input.projectId,
    'competitor_added', found ? 'Competitor tracked again' : 'Competitor added');
  return { candidate_id: candidateId, added: !found };
}

async function candidateRow(env: Env, projectId: number, candidateId: string): Promise<{ id: string; name: string }> {
  const c = await env.DB.prepare(
    'SELECT c.id, c.name FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id WHERE c.id = ? AND a.project_id = ?',
  ).bind(candidateId, projectId).first<{ id: string; name: string }>();
  if (!c) throw new WriterError(404, 'Competitor not found on this project');
  return c;
}

/** Edit: kind, the watch toggles, why it matters and the positioning. */
export async function updateCompetitor(
  env: Env,
  input: { projectId: number; userId: number | null; candidateId: string; kind?: unknown; watch?: unknown; why?: unknown; price_position?: unknown; depth_position?: unknown },
): Promise<void> {
  const c = await candidateRow(env, input.projectId, input.candidateId);
  const kind = input.kind === undefined ? undefined : String(input.kind);
  if (kind !== undefined && !(COMPETITOR_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, `kind must be one of ${COMPETITOR_KINDS.join(', ')}`);
  const norm = competitorNameNorm(c.name);
  const stored = await env.DB.prepare('SELECT watch_json FROM competitor_tracking WHERE project_id = ? AND name_norm = ?')
    .bind(input.projectId, norm).first<{ watch_json: string }>();
  const watch = watchFrom(input.watch, stored ? parseWatch(stored.watch_json) : WATCH_DEFAULTS);
  const price = oneOf(input.price_position, POSITIONS, 'price_position');
  const depth = oneOf(input.depth_position, DEPTHS, 'depth_position');
  const why = input.why === undefined ? undefined : trimOrNull(input.why, 1000);
  const stmts = [trackingUpsert(env, { projectId: input.projectId, userId: input.userId, nameNorm: norm, watch, why: why ?? null, price: price ?? null, depth: depth ?? null, restart: false })];
  // A cleared value is written as NULL; COALESCE above keeps an omitted one.
  if (why === null) stmts.push(env.DB.prepare('UPDATE competitor_tracking SET why_it_matters = NULL WHERE project_id = ? AND name_norm = ?').bind(input.projectId, norm));
  if (price === null) stmts.push(env.DB.prepare('UPDATE competitor_tracking SET price_position = NULL WHERE project_id = ? AND name_norm = ?').bind(input.projectId, norm));
  if (depth === null) stmts.push(env.DB.prepare('UPDATE competitor_tracking SET depth_position = NULL WHERE project_id = ? AND name_norm = ?').bind(input.projectId, norm));
  if (kind !== undefined) stmts.push(env.DB.prepare('UPDATE competitor_candidates SET category = ? WHERE id = ?').bind(kind, c.id));
  await env.DB.batch(stmts);
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', RECORD_ID.test(c.id) ? c.id : input.projectId, 'competitor_edited', 'Competitor edited');
}

/** Stop tracking: the venture's row is stopped; the candidate and its signals stay. */
export async function stopCompetitor(env: Env, input: { projectId: number; userId: number | null; candidateId: string }): Promise<void> {
  const c = await candidateRow(env, input.projectId, input.candidateId);
  const norm = competitorNameNorm(c.name);
  const stored = await env.DB.prepare('SELECT watch_json FROM competitor_tracking WHERE project_id = ? AND name_norm = ?')
    .bind(input.projectId, norm).first<{ watch_json: string }>();
  await env.DB.batch([
    trackingUpsert(env, { projectId: input.projectId, userId: input.userId, nameNorm: norm, watch: stored ? parseWatch(stored.watch_json) : WATCH_DEFAULTS, restart: false }),
    env.DB.prepare("UPDATE competitor_tracking SET stopped_at = datetime('now') WHERE project_id = ? AND name_norm = ?").bind(input.projectId, norm),
  ]);
  await recordActor(env, input.userId, input.projectId, 'market-intelligence', RECORD_ID.test(c.id) ? c.id : input.projectId, 'competitor_stopped', 'Competitor no longer tracked');
}

/** Add a signal to a competitor this venture tracks, with an amount for a funding round. */
export async function addCompetitorSignal(
  env: Env,
  input: { projectId: number; userId: number; candidateId: string; signal_type?: unknown; label?: unknown; detail?: unknown; source_url?: unknown; observed_on?: unknown; amount_cents?: unknown; currency?: unknown },
): Promise<{ signal_id: string }> {
  const c = await candidateRow(env, input.projectId, input.candidateId);
  const out = await writeCompetitorMention(env, {
    projectId: input.projectId, userId: input.userId, name: c.name, signal_type: input.signal_type, label: input.label,
    detail: input.detail, source_url: input.source_url, observed_on: input.observed_on, source_kind: 'manual',
    amount_cents: input.amount_cents, currency: input.currency,
  });
  return { signal_id: out.signal_id };
}

// ---------------------------------------------------------------------------
// Demand and urgency signals — Edit, Attach, the evidence file
// ---------------------------------------------------------------------------

/** Edit a `signal-` record. Omitted keys are kept, and the same rules as a new signal apply. */
export async function updateDemandSignal(
  env: Env,
  input: { projectId: number; userId: number | null; signalId: number } & Omit<DemandSignalInput, 'projectId' | 'userId'>,
): Promise<{ id: number }> {
  const row = await env.DB.prepare(
    'SELECT id, kind, who, amount_cents, currency, period, signal_date, status, note FROM demand_signals WHERE id = ? AND project_id = ?',
  ).bind(input.signalId, input.projectId).first<Record<string, string | number | null>>();
  if (!row) throw new WriterError(404, 'Signal not found on this project');
  const kind = input.kind === undefined ? String(row.kind) : String(input.kind);
  if (!(DEMAND_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, `kind must be one of ${DEMAND_KINDS.join(', ')}`);
  const amountIn = input.amount_cents === undefined ? row.amount_cents : input.amount_cents;
  let amount: number | null = null;
  if (amountIn != null && amountIn !== '') {
    const n = Number(amountIn);
    if (!Number.isInteger(n) || n <= 0) throw new WriterError(400, 'amount_cents must be a positive whole number, or omitted');
    amount = n;
  }
  if (amount != null && (kind === 'need_to_have' || kind === 'waitlist')) throw new WriterError(400, 'An amount is for pre-sales and letters of intent only');
  const currency = amount == null ? null
    : (String(input.currency === undefined ? (row.currency ?? 'usd') : (input.currency ?? 'usd')).trim().toLowerCase() || 'usd');
  if (currency != null && !/^[a-z]{3}$/.test(currency)) throw new WriterError(400, 'currency must be a three-letter code');
  const period = input.period === undefined ? row.period : (input.period == null || input.period === '' ? null : String(input.period));
  if (period != null && !['once', 'month', 'year'].includes(String(period))) throw new WriterError(400, 'period must be once, month or year');
  const date = input.signal_date === undefined ? String(row.signal_date) : isoDateOrNull(input.signal_date);
  if (!date) throw new WriterError(400, 'signal_date must be YYYY-MM-DD');
  const status = input.status === undefined ? String(row.status) : String(input.status);
  if (!(DEMAND_STATUSES as readonly string[]).includes(status)) throw new WriterError(400, `status must be one of ${DEMAND_STATUSES.join(', ')}`);
  await env.DB.prepare(
    `UPDATE demand_signals SET kind = ?, who = ?, amount_cents = ?, currency = ?, period = ?, signal_date = ?, status = ?, note = ?,
            updated_at = datetime('now') WHERE id = ? AND project_id = ?`,
  ).bind(
    kind, input.who === undefined ? row.who : trimOrNull(input.who, 200), amount, currency, period, date, status,
    input.note === undefined ? row.note : trimOrNull(input.note, 1000), input.signalId, input.projectId,
  ).run();
  await recordActor(env, input.userId, input.projectId, 'demand-signals', `signal-${input.signalId}`, 'demand_signal_edited', `Signal ${kind} edited`);
  return { id: input.signalId };
}

/** Mark to confirm: said, not yet in writing. */
export async function markDemandToConfirm(env: Env, input: { projectId: number; userId: number | null; signalId: number }): Promise<void> {
  await setDemandSignalStatus(env, { ...input, status: 'to_confirm' });
}

/** The evidence a signal may carry: PDF, PNG, JPEG or WebP, up to 20 MB (CO:366). */
export const EVIDENCE_MIME: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
};
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;
export const EVIDENCE_PREFIX = 'validate-evidence/';

/**
 * Attach: the evidence file, the interview it came from, or both. The file's
 * key is derived here, never taken from the request, under
 * `validate-evidence/`. A replaced file is deleted after the row points at
 * the new one.
 */
export async function attachDemandEvidence(
  env: Env,
  input: { projectId: number; userId: number | null; signalId: number; file?: File | null; interview_id?: unknown },
): Promise<{ id: number; file_name: string | null }> {
  const row = await env.DB.prepare('SELECT id, evidence_file_key FROM demand_signals WHERE id = ? AND project_id = ?')
    .bind(input.signalId, input.projectId).first<{ id: number; evidence_file_key: string | null }>();
  if (!row) throw new WriterError(404, 'Signal not found on this project');
  let interviewId: number | null | undefined;
  if (input.interview_id !== undefined && input.interview_id !== null && input.interview_id !== '') {
    interviewId = intId(input.interview_id);
    if (interviewId == null || !await ownedRow(env, 'discovery_interviews', interviewId, input.projectId)) throw new WriterError(404, 'Interview not found on this project');
  }
  if (!input.file && interviewId === undefined) throw new WriterError(400, 'Attach a file or an interview');
  let key: string | null = null;
  let fileName: string | null = null;
  if (input.file) {
    const mime = String(input.file.type || '').toLowerCase();
    const ext = EVIDENCE_MIME[mime];
    if (!ext) throw new WriterError(415, 'Evidence must be a PDF, PNG, JPEG or WebP file');
    if (input.file.size > MAX_EVIDENCE_BYTES) throw new WriterError(413, 'Evidence files are at most 20 MB');
    if (!input.file.size) throw new WriterError(400, 'The file is empty');
    if (!env.FILES) throw new WriterError(503, 'File storage is not configured');
    key = `${EVIDENCE_PREFIX}${input.projectId}/${crypto.randomUUID()}.${ext}`;
    fileName = String(input.file.name || `evidence.${ext}`).replace(/[\r\n"]/g, '').slice(0, 200) || `evidence.${ext}`;
    await env.FILES.put(key, await input.file.arrayBuffer(), { httpMetadata: { contentType: mime }, customMetadata: { project_id: String(input.projectId) } });
  }
  const stmts = [];
  if (key) stmts.push(env.DB.prepare("UPDATE demand_signals SET evidence_file_key = ?, evidence_file_name = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?")
    .bind(key, fileName, input.signalId, input.projectId));
  if (interviewId !== undefined) stmts.push(env.DB.prepare("UPDATE demand_signals SET interview_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?")
    .bind(interviewId, input.signalId, input.projectId));
  stmts.push(logCycleWriteStatement(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'demand-signals',
    entityId: `signal-${input.signalId}`, action: 'demand_evidence_attached', summary: key ? 'Evidence file attached' : 'Interview attached',
  }));
  await env.DB.batch(stmts);
  if (key && row.evidence_file_key && row.evidence_file_key.startsWith(EVIDENCE_PREFIX)) {
    try { await env.FILES?.delete(row.evidence_file_key); } catch (e) { console.warn('[validateWriters] old evidence not deleted:', (e as Error)?.message); }
  }
  return { id: input.signalId, file_name: fileName };
}

/**
 * Open evidence: one signed download of the signal's file (decision 11), the
 * same single-use, two-minute URL `routes/files.ts` serves as an attachment.
 */
export async function openDemandEvidence(
  env: Env,
  input: { projectId: number; userId: number | null; signalId: number },
): Promise<{ open: { url: string; expires_at: string; name: string | null } }> {
  const row = await env.DB.prepare('SELECT evidence_file_key, evidence_file_name FROM demand_signals WHERE id = ? AND project_id = ?')
    .bind(input.signalId, input.projectId).first<{ evidence_file_key: string | null; evidence_file_name: string | null }>();
  if (!row) throw new WriterError(404, 'Signal not found on this project');
  if (!row.evidence_file_key || !row.evidence_file_key.startsWith(EVIDENCE_PREFIX)) throw new WriterError(404, 'This signal has no evidence file.');
  const { token, expires_at } = await mintDownloadToken(env, {
    key: row.evidence_file_key, audience: `validate-evidence:signal-${input.signalId}`, userId: input.userId ?? undefined, ttlSec: 120,
  });
  return { open: { url: `/api/files/dl/${token}`, expires_at, name: row.evidence_file_name } };
}

// ---------------------------------------------------------------------------
// Experiments and evidence — claims, their evidence and experiments
// ---------------------------------------------------------------------------

const DIRECTIONS = ['supports', 'contradicts'] as const;
const direction = (v: unknown, fallback = 'supports'): 'supports' | 'contradicts' => {
  const d = v === undefined || v === null || v === '' ? fallback : String(v);
  if (!(DIRECTIONS as readonly string[]).includes(d)) throw new WriterError(400, 'direction must be supports or contradicts');
  return d as 'supports' | 'contradicts';
};
const deadlineOf = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = isoDateOrNull(v);
  if (!d) throw new WriterError(400, 'deadline must be YYYY-MM-DD');
  return d;
};

/**
 * New hypothesis: the claim, its bar and its disproof, its owner and deadline,
 * and its pain links, written in one batch through `insertHypothesisWithLinks`
 * (decision 12). Each linked theme logs a row on its own side.
 */
export async function createHypothesis(
  env: Env,
  input: { projectId: number; userId: number | null; claim: unknown; success_bar?: unknown; disproof?: unknown; pain_group_ids?: unknown; direction?: unknown; owner_user_id?: unknown; deadline?: unknown },
): Promise<{ id: number; code: string }> {
  const claim = trimOrNull(input.claim, 500);
  if (!claim) throw new WriterError(400, 'A hypothesis needs a claim');
  const groups = [...new Set((Array.isArray(input.pain_group_ids) ? input.pain_group_ids : []).map((g) => intId(g)))];
  if (groups.some((g) => g == null)) throw new WriterError(400, 'pain_group_ids must be theme ids');
  for (const g of groups) if (!await ownedRow(env, 'pain_groups', g as number, input.projectId)) throw new WriterError(404, 'Theme not found on this project');
  const dir = direction(input.direction);
  const owner = input.owner_user_id === undefined ? null : await checkHypothesisOwner(env, input.projectId, input.owner_user_id);
  const extra = [logCycleWriteStatement(env, {
    projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'experiments',
    readback: { table: 'hypotheses', by: 'max' }, action: 'hypothesis_created', summary: 'Hypothesis created',
  })];
  for (const g of groups) {
    extra.push(logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery',
      entityId: g as number, action: 'hypothesis_linked', summary: 'Linked to a new hypothesis',
    }));
  }
  const out = await insertHypothesisWithLinks(env, {
    projectId: input.projectId, claim, userId: input.userId, successBar: trimOrNull(input.success_bar, 500),
    disproof: trimOrNull(input.disproof, 500), deadline: deadlineOf(input.deadline) ?? null, ownerUserId: owner,
  }, { painGroupIds: groups as number[], direction: dir }, extra);
  return { id: out.id, code: out.code };
}

/** Edit a claim. Omitted keys are kept; `retired` true retires it, false restores it. */
export async function updateHypothesis(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; claim?: unknown; success_bar?: unknown; disproof?: unknown; deadline?: unknown; sprint?: unknown; owner_user_id?: unknown; inconclusive?: unknown; retired?: unknown },
): Promise<{ id: number }> {
  const h = await env.DB.prepare(
    `SELECT id, code, claim, success_bar, disproof, deadline, sprint, owner_user_id, inconclusive_at, retired_at
       FROM hypotheses WHERE id = ? AND project_id = ?`,
  ).bind(input.hypothesisId, input.projectId).first<Record<string, string | number | null>>();
  if (!h) throw new WriterError(404, 'Hypothesis not found on this project');
  const claim = input.claim === undefined ? String(h.claim) : trimOrNull(input.claim, 500);
  if (!claim) throw new WriterError(400, 'A hypothesis needs a claim');
  if (input.retired !== undefined && typeof input.retired !== 'boolean') throw new WriterError(400, 'retired must be true or false');
  if (input.inconclusive !== undefined && typeof input.inconclusive !== 'boolean') throw new WriterError(400, 'inconclusive must be true or false');
  const owner = input.owner_user_id === undefined ? h.owner_user_id : await checkHypothesisOwner(env, input.projectId, input.owner_user_id);
  const deadline = deadlineOf(input.deadline);
  const now = new Date().toISOString();
  const retired = input.retired === undefined ? h.retired_at : (input.retired ? (h.retired_at ?? now) : null);
  const inconclusive = input.inconclusive === undefined ? h.inconclusive_at : (input.inconclusive ? (h.inconclusive_at ?? now) : null);
  await env.DB.prepare(
    `UPDATE hypotheses SET claim = ?, success_bar = ?, disproof = ?, deadline = ?, sprint = ?, owner_user_id = ?,
            inconclusive_at = ?, retired_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ?`,
  ).bind(
    claim, input.success_bar === undefined ? h.success_bar : trimOrNull(input.success_bar, 500),
    input.disproof === undefined ? h.disproof : trimOrNull(input.disproof, 500),
    deadline === undefined ? h.deadline : deadline, input.sprint === undefined ? h.sprint : trimOrNull(input.sprint, 80),
    owner, inconclusive, retired, input.hypothesisId, input.projectId,
  ).run();
  const action = input.retired === true && !h.retired_at ? 'hypothesis_retired'
    : input.retired === false && h.retired_at ? 'hypothesis_restored' : 'hypothesis_edited';
  await recordActor(env, input.userId, input.projectId, 'experiments', input.hypothesisId, action,
    `${h.code} ${action === 'hypothesis_retired' ? 'retired' : action === 'hypothesis_restored' ? 'restored' : 'edited'}`);
  return { id: input.hypothesisId };
}

/**
 * The KPIs a metric's `ref_id` may name: the venture's own `project_metrics`
 * columns. A fixed list, read with a literal SELECT, never a column a request
 * names.
 */
export const KPI_KEYS = [
  'mrr', 'arr', 'cac', 'ltv', 'monthly_churn_pct', 'active_users', 'new_users',
  'net_burn', 'cash_balance', 'headcount', 'nrr_pct', 'paying_accounts',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

/** Each KPI's latest recorded value and its date, for the venture; a KPI never recorded is absent. */
export async function latestKpis(env: Env, projectId: number): Promise<Map<KpiKey, { value: number; date: string }>> {
  const res = await env.DB.prepare(
    `SELECT snapshot_date, mrr, arr, cac, ltv, monthly_churn_pct, active_users, new_users,
            net_burn, cash_balance, headcount, nrr_pct, paying_accounts
       FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 400`,
  ).bind(projectId).all<Record<string, number | string | null>>();
  const out = new Map<KpiKey, { value: number; date: string }>();
  for (const r of res.results || []) {
    for (const k of KPI_KEYS) {
      if (out.has(k) || r[k] == null) continue;
      const n = Number(r[k]);
      if (Number.isFinite(n)) out.set(k, { value: n, date: String(r.snapshot_date || '') });
    }
  }
  return out;
}

export const EVIDENCE_KINDS = ['interview', 'signal', 'metric', 'experiment'] as const;

/**
 * Add evidence to a claim: an interview, a demand record (`signal-`,
 * `revenue-` or `waitlist-`, decision 4), a KPI with a recorded value, or an
 * experiment, each checked to be this venture's. Adding it again updates its
 * direction and strength. A link logs a row on each side that has a record.
 */
export async function addEvidence(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; kind: unknown; ref_id: unknown; direction?: unknown; strength?: unknown },
): Promise<{ link: string }> {
  const h = await env.DB.prepare('SELECT id, code FROM hypotheses WHERE id = ? AND project_id = ?')
    .bind(input.hypothesisId, input.projectId).first<{ id: number; code: string }>();
  if (!h) throw new WriterError(404, 'Hypothesis not found on this project');
  const kind = String(input.kind ?? '');
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) throw new WriterError(400, `kind must be one of ${EVIDENCE_KINDS.join(', ')}`);
  const ref = String(input.ref_id ?? '').trim();
  const dir = direction(input.direction);
  const strength = input.strength === undefined || input.strength === null || input.strength === '' ? null : String(input.strength);
  if (strength != null && !(EVIDENCE_STRENGTHS as readonly string[]).includes(strength)) throw new WriterError(400, `strength must be one of ${EVIDENCE_STRENGTHS.join(', ')}`);
  let ok = false;
  let other: { module: string; id: string } | null = null;
  if (kind === 'interview') {
    ok = ID.test(ref) && await ownedRow(env, 'discovery_interviews', ref, input.projectId);
    other = { module: 'customer-research', id: ref };
  } else if (kind === 'signal') {
    const store = ref.startsWith('signal-') ? 'demand_signals' : ref.startsWith('revenue-') ? 'revenue_entries' : ref.startsWith('waitlist-') ? 'waitlist_signups' : null;
    ok = store != null && await ownedRow(env, store, ref, input.projectId);
    other = { module: 'demand-signals', id: ref };
  } else if (kind === 'metric') {
    ok = (KPI_KEYS as readonly string[]).includes(ref) && (await latestKpis(env, input.projectId)).has(ref as KpiKey);
  } else {
    ok = ID.test(ref) && !!await env.DB.prepare('SELECT 1 FROM hypothesis_experiments WHERE id = ? AND project_id = ?')
      .bind(Number(ref), input.projectId).first();
  }
  if (!ok) throw new WriterError(404, kind === 'metric' ? 'No value is recorded for that KPI on this project' : 'That evidence is not on this project');
  const stmts = [
    env.DB.prepare(
      `INSERT INTO hypothesis_evidence_links (uid, project_id, hypothesis_id, kind, ref_id, direction, strength, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hypothesis_id, kind, ref_id) DO UPDATE SET direction = excluded.direction, strength = excluded.strength, updated_at = datetime('now')
       RETURNING id`,
    ).bind(crypto.randomUUID(), input.projectId, input.hypothesisId, kind, ref, dir, strength, input.userId),
    logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'experiments',
      entityId: input.hypothesisId, action: 'evidence_added', summary: `${kind === 'metric' ? 'KPI' : kind[0].toUpperCase() + kind.slice(1)} evidence ${dir === 'supports' ? 'supports' : 'contradicts'} ${h.code}`,
    }),
  ];
  if (other) {
    stmts.push(logCycleWriteStatement(env, {
      projectId: input.projectId, userId: input.userId, cycle: 'validate', module: other.module,
      entityId: other.id, action: 'evidence_linked', summary: `Linked to ${h.code}`,
    }));
  }
  const results = await env.DB.batch(stmts);
  const id = Number((results[0] as { results?: Array<{ id: number }> })?.results?.[0]?.id);
  return { link: `evidence-${id}` };
}

/** Unlink a pain link (`pain-<id>`) or an evidence link (`evidence-<id>`) from this claim. */
export async function unlinkEvidence(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; link: unknown },
): Promise<void> {
  const link = String(input.link ?? '');
  const m = /^(pain|evidence)-([1-9][0-9]{0,9})$/.exec(link);
  if (!m) throw new WriterError(400, 'link must be pain-<id> or evidence-<id>');
  const h = await env.DB.prepare('SELECT id, code FROM hypotheses WHERE id = ? AND project_id = ?')
    .bind(input.hypothesisId, input.projectId).first<{ id: number; code: string }>();
  if (!h) throw new WriterError(404, 'Hypothesis not found on this project');
  const id = Number(m[2]);
  if (m[1] === 'pain') {
    const row = await env.DB.prepare('SELECT pain_group_id FROM hypothesis_pain_links WHERE id = ? AND hypothesis_id = ?')
      .bind(id, input.hypothesisId).first<{ pain_group_id: number }>();
    if (!row) throw new WriterError(404, 'Link not found on this hypothesis');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM hypothesis_pain_links WHERE id = ? AND hypothesis_id = ?').bind(id, input.hypothesisId),
      logCycleWriteStatement(env, { projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'experiments', entityId: input.hypothesisId, action: 'evidence_unlinked', summary: `Theme unlinked from ${h.code}` }),
      logCycleWriteStatement(env, { projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'problem-discovery', entityId: Number(row.pain_group_id), action: 'evidence_unlinked', summary: `Unlinked from ${h.code}` }),
    ]);
    return;
  }
  const row = await env.DB.prepare('SELECT kind, ref_id FROM hypothesis_evidence_links WHERE id = ? AND hypothesis_id = ? AND project_id = ?')
    .bind(id, input.hypothesisId, input.projectId).first<{ kind: string; ref_id: string }>();
  if (!row) throw new WriterError(404, 'Link not found on this hypothesis');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hypothesis_evidence_links WHERE id = ? AND hypothesis_id = ? AND project_id = ?').bind(id, input.hypothesisId, input.projectId),
    logCycleWriteStatement(env, { projectId: input.projectId, userId: input.userId, cycle: 'validate', module: 'experiments', entityId: input.hypothesisId, action: 'evidence_unlinked', summary: `Evidence unlinked from ${h.code}` }),
  ]);
}

export const EXPERIMENT_STATUSES = ['planned', 'running', 'done'] as const;

/** Add an experiment to a claim. */
export async function addExperiment(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; title: unknown; method?: unknown; target?: unknown },
): Promise<{ id: number }> {
  const h = await env.DB.prepare('SELECT id, code FROM hypotheses WHERE id = ? AND project_id = ?')
    .bind(input.hypothesisId, input.projectId).first<{ id: number; code: string }>();
  if (!h) throw new WriterError(404, 'Hypothesis not found on this project');
  const title = trimOrNull(input.title, 200);
  if (!title) throw new WriterError(400, 'An experiment needs a title');
  const row = await env.DB.prepare(
    `INSERT INTO hypothesis_experiments (uid, project_id, hypothesis_id, title, method, target, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(crypto.randomUUID(), input.projectId, input.hypothesisId, title, trimOrNull(input.method, 500), trimOrNull(input.target, 500), input.userId)
    .first<{ id: number }>();
  await recordActor(env, input.userId, input.projectId, 'experiments', input.hypothesisId, 'experiment_added', `Experiment added to ${h.code}`);
  return { id: Number(row?.id) };
}

/** Move an experiment of this claim to planned, running or done, with its result. */
export async function setExperimentStatus(
  env: Env,
  input: { projectId: number; userId: number | null; hypothesisId: number; experiment_id: unknown; status: unknown; result?: unknown },
): Promise<void> {
  const status = String(input.status ?? '');
  if (!(EXPERIMENT_STATUSES as readonly string[]).includes(status)) throw new WriterError(400, `status must be one of ${EXPERIMENT_STATUSES.join(', ')}`);
  const eid = intId(input.experiment_id);
  const ex = eid == null ? null : await env.DB.prepare(
    'SELECT e.id, e.result, h.code FROM hypothesis_experiments e JOIN hypotheses h ON h.id = e.hypothesis_id WHERE e.id = ? AND e.hypothesis_id = ? AND e.project_id = ? AND h.project_id = ?',
  ).bind(eid, input.hypothesisId, input.projectId, input.projectId).first<{ id: number; result: string | null; code: string }>();
  if (!ex) throw new WriterError(404, 'Experiment not found on this hypothesis');
  await env.DB.prepare("UPDATE hypothesis_experiments SET status = ?, result = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?")
    .bind(status, input.result === undefined ? ex.result : trimOrNull(input.result, 1000), ex.id, input.projectId).run();
  await recordActor(env, input.userId, input.projectId, 'experiments', input.hypothesisId, 'experiment_status_set', `${ex.code} experiment ${status}`);
}
