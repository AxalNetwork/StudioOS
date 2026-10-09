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
import type { Env } from '../types';
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

async function recordActor(env: Env, userId: number | null, projectId: number, action: string, details: string) {
  await env.DB.prepare(
    `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
  ).bind(action, details.slice(0, 500), userId != null ? `user:${userId}` : 'system', userId, projectId).run();
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
};

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
  const row = await env.DB.prepare(
    `INSERT INTO customer_segments (project_id, name, name_norm, description, source, source_ref, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(input.projectId, name, norm, trimOrNull(input.description, 1000), source, trimOrNull(input.sourceRef, 200), input.userId)
    .first<{ id: number }>();
  if (!row) throw new WriterError(500, 'The segment was not written');
  await recordActor(env, input.userId, input.projectId, 'segment_written', `segment ${row.id} (${source})`);
  return { id: Number(row.id), name, created: true };
}

/** Which segment an interview was with, or `null` to clear it. */
export async function assignInterviewSegment(
  env: Env,
  input: { projectId: number; userId: number | null; interviewId: number; segmentId: number | null },
): Promise<void> {
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
  await recordActor(env, input.userId, input.projectId, 'interview_segment_set', `interview ${input.interviewId} → ${input.segmentId ?? 'none'}`);
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
  await recordActor(env, input.userId, input.projectId, 'interview_stage_set', `interview ${input.interviewId} → ${stage}`);
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
  await recordActor(env, input.userId, input.projectId, 'demand_signal_written', `signal ${row.id} (${kind}, ${status})`);
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
  await recordActor(env, input.userId, input.projectId, 'demand_signal_status', `signal ${input.signalId} → ${status}`);
}

// ---------------------------------------------------------------------------
// Waitlist bar
// ---------------------------------------------------------------------------

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
    await recordActor(env, input.userId, input.projectId, 'waitlist_target_cleared', 'waitlist bar cleared');
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
  await recordActor(env, input.userId, input.projectId, 'waitlist_target_set', `waitlist bar ${n}`);
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
  await env.DB.prepare(
    `INSERT INTO competitor_signals
       (id, analysis_id, candidate_id, signal_type, label, detail, project_id, source_url, source_kind, observed_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    signalId, String(analysis.id), candidateId, signalType, trimOrNull(input.label, 200) ?? signalType,
    trimOrNull(input.detail, 1000), input.projectId, sourceUrl, sourceKind, observed,
  ).run();
  await recordActor(env, input.userId, input.projectId, 'competitor_mention_written', `${added ? 'added' : 'signal on'} ${candidateId} (${sourceKind})`);
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
  await recordActor(env, input.userId, input.projectId, 'market_mark_set', `${item} → ${input.done ? 'done' : 'not done'}`);
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
  await recordActor(env, input.userId, input.projectId, 'market_source_added', `source ${row.id}`);
  return { id: Number(row.id) };
}

export async function removeMarketSource(
  env: Env,
  input: { projectId: number; userId: number | null; sourceId: number },
): Promise<void> {
  const res = await env.DB.prepare('DELETE FROM market_sources WHERE id = ? AND project_id = ?')
    .bind(input.sourceId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Source not found on this project');
  await recordActor(env, input.userId, input.projectId, 'market_source_removed', `source ${input.sourceId}`);
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
  let owner = h.owner_user_id;
  if (input.owner_user_id !== undefined) {
    if (input.owner_user_id === null || input.owner_user_id === '') owner = null;
    else {
      const n = Number(input.owner_user_id);
      const u = Number.isInteger(n) ? await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(n).first() : null;
      if (!u) throw new WriterError(400, 'owner_user_id is not a user');
      owner = n;
    }
  }
  const inconclusive = input.inconclusive === undefined
    ? h.inconclusive_at
    : (input.inconclusive === true ? (h.inconclusive_at ?? new Date().toISOString()) : null);
  await env.DB.prepare(
    'UPDATE hypotheses SET sprint = ?, owner_user_id = ?, inconclusive_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?',
  ).bind(sprint, owner, inconclusive, input.hypothesisId, input.projectId).run();
  await recordActor(env, input.userId, input.projectId, 'hypothesis_plan_set', `hypothesis ${input.hypothesisId}`);
}

/** The strength of one evidence link, or `null` to clear it. */
export async function setEvidenceStrength(
  env: Env,
  input: { projectId: number; userId: number | null; linkId: number; strength: unknown },
): Promise<void> {
  const strength = input.strength === null ? null : String(input.strength ?? '');
  if (strength !== null && !(EVIDENCE_STRENGTHS as readonly string[]).includes(strength)) {
    throw new WriterError(400, `strength must be one of ${EVIDENCE_STRENGTHS.join(', ')}, or null`);
  }
  const res = await env.DB.prepare(
    `UPDATE hypothesis_pain_links SET strength = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND hypothesis_id IN (SELECT id FROM hypotheses WHERE project_id = ?)`,
  ).bind(strength, input.linkId, input.projectId).run();
  if (!res.meta?.changes) throw new WriterError(404, 'Evidence link not found on this project');
  await recordActor(env, input.userId, input.projectId, 'evidence_strength_set', `link ${input.linkId} → ${strength ?? 'none'}`);
}
