/**
 * Competitor Analysis API — `/api/competitors`.
 *
 * In-house, Cloudflare-native competitive intelligence: discovery + controlled
 * public-web crawl (services/webFetch.ts) + Workers AI synthesis
 * (services/competitorAnalysis.ts), persisted in D1. No paid third-party APIs.
 *
 * All rows are scoped to the authenticated user. Analyses can be re-run,
 * edited, exported (JSON / markdown), and extended with manual competitors.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { railFor } from '../util/railContext';
import { canAccessProject } from '../services/projectAccess';
import { ensureCompetitorSchema } from '../services/competitorSchema';
import { insertManualCandidate } from './_competitor_writes';
import {
  COMPANIES_OPTIONS,
  COMPANIES_PAGE,
  analysisRecord,
  runCompetitorAnalysis,
  collectCandidateCrawl,
  sourceKind,
  evidenceOf,
  isSubjectMatch,
  type AnalysisInputs,
  type AnalysisSubject,
  type Evidence,
  type AnalysisResult,
  type Candidate,
  type AnalysisOutput,
} from '../services/competitorAnalysis';
import { fetchPage } from '../services/webFetch';
import { linkCandidatesToDirectory, hostOf } from '../services/competitorDirectoryLink';
import { refuse } from '../util/refusal';
import type { Context } from 'hono';

const competitors = new Hono<{ Bindings: Env }>();

function nowIso(): string {
  return new Date().toISOString();
}

function coerceInputs(body: Record<string, unknown>): AnalysisInputs {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    market: str(body.market),
    target_customer: str(body.target_customer),
    geography: str(body.geography),
    known_competitors: str(body.known_competitors),
    problem: str(body.problem),
    region_focus: str(body.region_focus) || 'Global',
    depth: body.depth === 'deep' ? 'deep' : 'quick',
    nudge: str(body.nudge),
  };
}

/** Map a project row into analysis input defaults (prefill "From my startup"). */
function inputsFromProject(project: Record<string, unknown>): AnalysisInputs {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    market: s(project.sector) || s(project.name),
    target_customer: s(project.target_customer) || '',
    geography: s(project.geography) || '',
    known_competitors: s(project.competitors) || '',
    problem: s(project.problem_statement) || s(project.description) || '',
    region_focus: 'Global',
    depth: 'quick',
    nudge: '',
  };
}

/**
 * D7175: the directory company a run is about. The uid is checked against a
 * fixed character set before it reaches SQL (bound there regardless). Null
 * when none was sent (a custom market); a refusal when it names no company or
 * the directory could not be read, because a run must not start on a subject
 * nobody could look up.
 */
const SUBJECT_UID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
type SubjectRow = { uid: string; name: string; website: string | null; source_name: string | null; as_of: string | null; website_verified_at: string | null };

async function readSubjectRow(env: Env, uid: string): Promise<SubjectRow | null> {
  return await env.DB.prepare(
    'SELECT uid, name, website, source_name, as_of, website_verified_at FROM research_company_directory WHERE uid = ?',
  ).bind(uid).first<SubjectRow>();
}

export async function subjectFor(env: Env, raw: unknown): Promise<
  { subject: AnalysisSubject | null } | { refusal: { status: 400 | 404 | 503; error: string; message: string } }
> {
  if (raw == null || raw === '') return { subject: null };
  const uid = String(raw);
  if (!SUBJECT_UID_RE.test(uid)) return { refusal: { status: 400, error: 'subject_uid_invalid', message: 'That company id is not one the directory uses.' } };
  let row: SubjectRow | null;
  try {
    row = await readSubjectRow(env, uid);
  } catch {
    return { refusal: { status: 503, error: 'subject_unavailable', message: 'The company record could not be read. Try again, or run on a custom market.' } };
  }
  if (!row) return { refusal: { status: 404, error: 'subject_not_found', message: 'That company is not in the directory.' } };
  return { subject: { uid: row.uid, name: String(row.name || ''), domain: hostOf(row.website) } };
}

/**
 * D7175: the evidence status of each listed analysis, from three grouped reads
 * (candidates, sources, outputs). Null for a run that is not complete.
 */
async function listEvidence(env: Env, rows: Array<Record<string, unknown>>): Promise<Map<string, Evidence>> {
  const ids = rows.filter((r) => r.status === 'complete').map((r) => String(r.id));
  const out = new Map<string, Evidence>();
  if (!ids.length) return out;
  const list = JSON.stringify(ids);
  const [cands, srcs, outs] = await Promise.all([
    env.DB.prepare('SELECT analysis_id, COUNT(*) AS n FROM competitor_candidates WHERE analysis_id IN (SELECT value FROM json_each(?)) GROUP BY analysis_id')
      .bind(list).all<{ analysis_id: string; n: number }>(),
    env.DB.prepare('SELECT analysis_id, id, status FROM competitor_sources WHERE analysis_id IN (SELECT value FROM json_each(?))')
      .bind(list).all<{ analysis_id: string; id: string; status: number | null }>(),
    env.DB.prepare('SELECT analysis_id, output_json FROM competitor_analysis_outputs WHERE analysis_id IN (SELECT value FROM json_each(?))')
      .bind(list).all<{ analysis_id: string; output_json: string }>(),
  ]);
  const count = new Map((cands.results || []).map((r) => [String(r.analysis_id), Number(r.n) || 0]));
  const sourcesOf = new Map<string, Array<{ id: string; status: number | null }>>();
  for (const r of srcs.results || []) sourcesOf.set(String(r.analysis_id), [...(sourcesOf.get(String(r.analysis_id)) || []), r]);
  const outputOf = new Map((outs.results || []).map((r) => [String(r.analysis_id), safeParse(r.output_json, {}) as { findings?: Array<{ source_ids?: unknown }> }]));
  for (const id of ids) {
    out.set(id, evidenceOf({ candidates: new Array(count.get(id) || 0), sources: sourcesOf.get(id) || [], output: outputOf.get(id) || {} }));
  }
  return out;
}

/** D7175: the listed subjects' names, or null for each when the directory could not be read. */
async function subjectNames(env: Env, rows: Array<Record<string, unknown>>): Promise<Map<string, string> | null> {
  const uids = [...new Set(rows.map((r) => r.subject_uid).filter((u): u is string => typeof u === 'string' && !!u))];
  if (!uids.length) return new Map();
  try {
    const res = await env.DB.prepare('SELECT uid, name FROM research_company_directory WHERE uid IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(uids)).all<{ uid: string; name: string }>();
    return new Map((res.results || []).map((r) => [String(r.uid), String(r.name)]));
  } catch {
    return null;
  }
}

/**
 * Write a run's result over the analysis (D690 decision 8, #1692).
 *
 * WHAT A RE-RUN OR REFRESH KEEPS. It used to delete every candidate and
 * signal and write back only what the pipeline found, so a record link broke
 * on every re-run and a signal recorded by hand or from an interview was lost.
 * Now:
 *   - a candidate whose name is already stored keeps its stored id, so the
 *     record and its signals survive;
 *   - a stored candidate the run did not find again stays when the venture
 *     tracks its name (`competitor_tracking`, not stopped) or a kept signal
 *     points at it, with or without `keep_manual`;
 *   - every signal with a `project_id` (written by hand or from an interview
 *     since migration 440) stays as it was;
 *   - a pipeline signal of a type the venture switched off for that
 *     competitor (`watch_json`) is not written.
 * Sources fetched by a run are replaced; a source attached by hand
 * (`origin = 'manual'`, D7176) stays. The analyst's own fields in the output —
 * notes and the conclusion — are carried over, and the per-section edited
 * flags live in their own column, which this never writes. Every value is
 * bound. Since D7176 only a new analysis comes here: refresh re-fetches the
 * stored sources and a rerun is a proposal applied field by field.
 */
export async function persistResult(env: Env, analysisId: string, result: AnalysisResult): Promise<void> {
  const db = env.DB;
  const norm = (n: unknown) => String(n ?? '').trim().toLowerCase().slice(0, 120);
  const analysis = await db.prepare('SELECT project_id FROM competitor_analyses WHERE id = ?')
    .bind(analysisId).first<{ project_id: number | null }>();
  const projectId = analysis?.project_id ?? null;
  const stored = (await db.prepare('SELECT id, name FROM competitor_candidates WHERE analysis_id = ?')
    .bind(analysisId).all<{ id: string; name: string }>()).results || [];
  const storedByName = new Map<string, string>();
  for (const c of stored) if (!storedByName.has(norm(c.name))) storedByName.set(norm(c.name), c.id);

  // The venture's tracking rows and the signals it wrote. A store migration 460
  // (or 440) has not reached has none of either.
  const tracking = new Map<string, { stopped: boolean; watch: Record<string, unknown> }>();
  if (projectId != null) {
    try {
      const rows = (await db.prepare('SELECT name_norm, watch_json, stopped_at FROM competitor_tracking WHERE project_id = ?')
        .bind(projectId).all<{ name_norm: string; watch_json: string | null; stopped_at: string | null }>()).results || [];
      for (const r of rows) {
        let watch: Record<string, unknown> = {};
        try { watch = JSON.parse(String(r.watch_json || '{}')) || {}; } catch { watch = {}; }
        tracking.set(r.name_norm, { stopped: !!r.stopped_at, watch });
      }
    } catch { /* no competitor_tracking table: nothing is tracked */ }
  }
  let keptSignals: Array<{ candidate_id: string | null }> = [];
  let signalsHaveProject = true;
  try {
    keptSignals = (await db.prepare('SELECT candidate_id FROM competitor_signals WHERE analysis_id = ? AND project_id IS NOT NULL')
      .bind(analysisId).all<{ candidate_id: string | null }>()).results || [];
  } catch { signalsHaveProject = false; }

  // The run's candidates, under their stored ids where the name is stored.
  const idOf = new Map<string, string>();
  for (const c of result.candidates) idOf.set(c.id, storedByName.get(norm(c.name)) ?? c.id);
  const found = new Set(result.candidates.map((c) => norm(c.name)));
  const pointed = new Set(keptSignals.map((g) => g.candidate_id).filter(Boolean) as string[]);
  const keep = new Set<string>(result.candidates.map((c) => idOf.get(c.id) as string));
  for (const c of stored) {
    if (found.has(norm(c.name))) continue;
    const t = tracking.get(norm(c.name));
    if ((t && !t.stopped) || pointed.has(c.id)) keep.add(c.id);
  }
  const nameOfId = new Map<string, string>();
  for (const c of stored) nameOfId.set(c.id, norm(c.name));
  for (const c of result.candidates) nameOfId.set(idOf.get(c.id) as string, norm(c.name));
  const switchedOff = (candidateId: string | null, type: string) => {
    if (!candidateId || !['funding', 'launch', 'hiring'].includes(type)) return false;
    const t = tracking.get(nameOfId.get(candidateId) ?? '');
    return !!t && t.watch[type] === false;
  };

  const stmts = [
    db.prepare('DELETE FROM competitor_candidates WHERE analysis_id = ? AND id NOT IN (SELECT value FROM json_each(?))')
      .bind(analysisId, JSON.stringify([...keep])),
    db.prepare("DELETE FROM competitor_sources WHERE analysis_id = ? AND origin <> 'manual'").bind(analysisId),
    signalsHaveProject
      ? db.prepare('DELETE FROM competitor_signals WHERE analysis_id = ? AND project_id IS NULL').bind(analysisId)
      : db.prepare('DELETE FROM competitor_signals WHERE analysis_id = ?').bind(analysisId),
  ];
  for (const c of result.candidates) {
    stmts.push(db.prepare(
      `INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, domain = excluded.domain, url = excluded.url, category = excluded.category,
         relevance_score = excluded.relevance_score, scores_json = excluded.scores_json, summary = excluded.summary,
         details_json = excluded.details_json, origin = excluded.origin, position = excluded.position`,
    ).bind(
      idOf.get(c.id), analysisId, c.name, c.domain ?? null, c.url ?? null, c.category, c.relevance_score,
      JSON.stringify(c.scores), c.summary ?? null, JSON.stringify(c.details), c.origin, c.position,
    ));
  }
  // D7175 records a read that failed as a row too (its status says so); a run
  // fetched or tried it, so it is 'fetched' (D7176) and the next run replaces it.
  for (const src of result.sources) {
    stmts.push(db.prepare(
      "INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fetched')",
    ).bind(src.id, analysisId, src.candidate_id ? (idOf.get(src.candidate_id) ?? src.candidate_id) : null, src.url, src.kind, src.title ?? null, src.status, src.fetched_at ?? null));
  }
  for (const g of result.signals) {
    const cid = g.candidate_id ? (idOf.get(g.candidate_id) ?? g.candidate_id) : null;
    if (switchedOff(cid, g.signal_type)) continue;
    stmts.push(db.prepare(
      'INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(g.id, analysisId, cid, g.signal_type, g.label ?? null, g.detail ?? null));
  }
  stmts.push(db.prepare(
    `INSERT INTO competitor_analysis_outputs (analysis_id, output_json, edited, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(analysis_id) DO UPDATE SET output_json = excluded.output_json, edited = 0, updated_at = excluded.updated_at`,
  ).bind(analysisId, JSON.stringify(await withAnalystFields(db, analysisId, result.output)), nowIso()));
  await db.batch(stmts);
}

async function loadAnalysis(env: Env, userId: number, id: string): Promise<Record<string, unknown> | null> {
  const sql = getSQL(env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${userId}`;
  const a = rows[0];
  if (!a) return null;
  const candidates = await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} ORDER BY position ASC`;
  const sources = await sql`SELECT * FROM competitor_sources WHERE analysis_id = ${id}`;
  const signals = await sql`SELECT * FROM competitor_signals WHERE analysis_id = ${id}`;
  const outRows = await sql`SELECT * FROM competitor_analysis_outputs WHERE analysis_id = ${id}`;
  // D593: each competitor's directory profile, when exactly one matches it
  // (services/competitorDirectoryLink.ts). Read, never stored.
  const directory = await linkCandidatesToDirectory(env.DB, candidates);
  return {
    id: a.id,
    project_id: a.project_id,
    mode: a.mode,
    title: a.title,
    status: a.status,
    edited: !!a.edited,
    inputs: safeParse(a.inputs_json, {}),
    created_at: a.created_at,
    updated_at: a.updated_at,
    candidates: candidates.map((row) => ({ ...mapCandidate(row), directory_uid: directory.byId.get(String(row.id)) ?? null })),
    directory_match: directory.status,
    sources,
    signals,
    output: safeParse((outRows[0] || {}).output_json, {}),
    output_edited: !!(outRows[0] || {}).edited,
    // D7175: the subject company, and the evidence the stored rows support.
    subject_uid: a.subject_uid ?? null,
    evidence: a.status === 'complete'
      ? evidenceOf({ candidates, sources, output: safeParse((outRows[0] || {}).output_json, {}) as { findings?: Array<{ source_ids?: unknown }> } })
      : null,
    // D7176: the saved version and which generated sections the person edited, and when.
    version: Number((outRows[0] || {}).version ?? 1) || 1,
    sections_edited: safeParse((outRows[0] || {}).sections_edited_json, {}),
  };
}

function mapCandidate(c: Record<string, unknown>): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    url: c.url,
    category: c.category,
    relevance_score: c.relevance_score,
    scores: safeParse(c.scores_json, {}),
    summary: c.summary,
    details: safeParse(c.details_json, {}),
    origin: c.origin,
    position: c.position,
  };
}

function safeParse(v: unknown, fallback: unknown): unknown {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// D7176 (#7176, canvas D7042) — saved versions, analyst fields, rerun proposals.
// ---------------------------------------------------------------------------

/** The analyst's own output fields. A run, a refresh or a rerun never writes them. */
const ANALYST_FIELDS = ['notes', 'conclusion'] as const;

/** The generated sections the dossier edits; an edit to one is dated in `sections_edited_json`. */
const EDITABLE_SECTIONS = ['market_summary', 'gaps', 'wedge', 'next_actions'] as const;

/** Every generated output field a rerun may propose to rewrite. Notes and the conclusion are never here. */
const PROPOSABLE_FIELDS = [
  ...EDITABLE_SECTIONS,
  'feature_comparison', 'pricing_signals', 'positioning', 'traction_signals', 'activity_signals',
  'direct_competitors', 'adjacent_competitors',
] as const;

/** A field's value for comparison: a missing string is '', a missing list is []. */
function fieldValue(out: Record<string, unknown>, field: string): unknown {
  const v = out[field];
  if (v === undefined || v === null) return ['market_summary', 'wedge'].includes(field) ? '' : [];
  return v;
}
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The run's output with the stored notes and conclusion laid over it (persistResult). */
async function withAnalystFields(db: Env['DB'], analysisId: string, output: AnalysisOutput): Promise<Record<string, unknown>> {
  const row = await db.prepare('SELECT output_json FROM competitor_analysis_outputs WHERE analysis_id = ?')
    .bind(analysisId).first<{ output_json: string | null }>();
  const stored = (safeParse(row?.output_json, {}) || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...output };
  for (const f of ANALYST_FIELDS) {
    if (typeof stored[f] === 'string' && String(stored[f]).trim()) merged[f] = stored[f];
  }
  return merged;
}

/** The version a save names: `If-Match` (quotes and `W/` allowed), else `base_version` in the body. Null when neither; NaN when malformed. */
function baseVersionOf(header: string | undefined, body: Record<string, unknown>): number | null {
  const raw = header != null && header.trim() !== '' ? header.trim().replace(/^W\//, '').replace(/^"|"$/g, '') : body.base_version;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

/**
 * Claim the next version for a save. The superseded version is kept, as its
 * record, in `competitor_analysis_versions` so an export can still name it.
 * `base` null means the caller named no version (an older client): the save
 * still counts as one, with no conflict check. Returns the new version, or
 * `{ conflict }` with the version on record.
 */
async function claimVersion(
  env: Env, userId: number, analysisId: string, base: number | null,
): Promise<{ version: number } | { conflict: number }> {
  const db = env.DB;
  await db.prepare(
    "INSERT INTO competitor_analysis_outputs (analysis_id, output_json, edited, updated_at) VALUES (?, '{}', 0, ?) ON CONFLICT(analysis_id) DO NOTHING",
  ).bind(analysisId, nowIso()).run();
  const row = await db.prepare('SELECT version FROM competitor_analysis_outputs WHERE analysis_id = ?')
    .bind(analysisId).first<{ version: number }>();
  const current = Number(row?.version ?? 1) || 1;
  if (base != null && base !== current) return { conflict: current };
  const record = await loadAnalysis(env, userId, analysisId);
  await db.prepare(
    'INSERT OR REPLACE INTO competitor_analysis_versions (analysis_id, version, snapshot_json, saved_at) VALUES (?, ?, ?, ?)',
  ).bind(analysisId, current, JSON.stringify({ ...(record || {}), version: current }), String(record?.updated_at || nowIso())).run();
  const bumped = await db.prepare('UPDATE competitor_analysis_outputs SET version = version + 1 WHERE analysis_id = ? AND version = ?')
    .bind(analysisId, current).run();
  if (!Number(bumped?.meta?.changes ?? 0)) {
    const again = await db.prepare('SELECT version FROM competitor_analysis_outputs WHERE analysis_id = ?')
      .bind(analysisId).first<{ version: number }>();
    return { conflict: Number(again?.version ?? current) };
  }
  return { version: current + 1 };
}

/** Undo a claim whose write failed, so the version on record is the text on record. */
async function releaseVersion(env: Env, analysisId: string, claimed: number): Promise<void> {
  try {
    await env.DB.prepare('UPDATE competitor_analysis_outputs SET version = version - 1 WHERE analysis_id = ? AND version = ?')
      .bind(analysisId, claimed).run();
  } catch (e) { console.error('[competitors] version release failed:', (e as Error).message); }
}

function versionConflict(c: Context<{ Bindings: Env }>, current: number): Response {
  return refuse(c, 409, {
    code: 'version_conflict',
    message: `This analysis was saved again since you opened it, and version ${current} is on record now. Nothing was written; your draft is still on screen.`,
    extra: { current_version: current },
  });
}

/**
 * PATCH's write of the title and the output, in one batch. A generated section
 * whose text the save changes is dated in `sections_edited_json`; a section it
 * leaves alone keeps its date.
 */
async function saveText(env: Env, analysisId: string, body: Record<string, unknown>): Promise<void> {
  const db = env.DB;
  const at = nowIso();
  const stmts = [];
  if (typeof body.title === 'string') {
    stmts.push(db.prepare('UPDATE competitor_analyses SET title = ?, edited = 1, updated_at = ? WHERE id = ?')
      .bind(body.title.slice(0, 200), at, analysisId));
  }
  if (body.output && typeof body.output === 'object') {
    const row = await db.prepare('SELECT output_json, sections_edited_json FROM competitor_analysis_outputs WHERE analysis_id = ?')
      .bind(analysisId).first<{ output_json: string | null; sections_edited_json: string | null }>();
    const before = (safeParse(row?.output_json, {}) || {}) as Record<string, unknown>;
    const edited = (safeParse(row?.sections_edited_json, {}) || {}) as Record<string, string>;
    const next = body.output as Record<string, unknown>;
    for (const f of EDITABLE_SECTIONS) {
      if (f in next && !sameValue(fieldValue(before, f), fieldValue(next, f))) edited[f] = at;
    }
    stmts.push(db.prepare(
      `INSERT INTO competitor_analysis_outputs (analysis_id, output_json, edited, updated_at, sections_edited_json) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(analysis_id) DO UPDATE SET output_json = excluded.output_json, edited = 1, updated_at = excluded.updated_at,
         sections_edited_json = excluded.sections_edited_json`,
    ).bind(analysisId, JSON.stringify(next), at, JSON.stringify(edited)));
    stmts.push(db.prepare('UPDATE competitor_analyses SET edited = 1, updated_at = ? WHERE id = ?').bind(at, analysisId));
  }
  if (stmts.length) await db.batch(stmts);
}

/**
 * A stored competitor a rerun may not propose to remove: one added by hand,
 * one carrying a source attached by hand, one the venture tracks, or one a
 * kept signal points at.
 */
async function protectedCandidateIds(db: Env['DB'], analysisId: string, projectId: number | null): Promise<Set<string>> {
  const out = new Set<string>();
  const manual = (await db.prepare(
    "SELECT id FROM competitor_candidates WHERE analysis_id = ? AND origin = 'manual' UNION SELECT candidate_id AS id FROM competitor_sources WHERE analysis_id = ? AND origin = 'manual' AND candidate_id IS NOT NULL",
  ).bind(analysisId, analysisId).all<{ id: string }>()).results || [];
  for (const r of manual) out.add(String(r.id));
  try {
    const pointed = (await db.prepare('SELECT candidate_id FROM competitor_signals WHERE analysis_id = ? AND project_id IS NOT NULL AND candidate_id IS NOT NULL')
      .bind(analysisId).all<{ candidate_id: string }>()).results || [];
    for (const r of pointed) out.add(String(r.candidate_id));
  } catch { /* a store before migration 440 keeps no venture signals */ }
  if (projectId != null) {
    try {
      const tracked = (await db.prepare(
        'SELECT c.id FROM competitor_candidates c JOIN competitor_tracking t ON t.name_norm = lower(trim(c.name)) WHERE c.analysis_id = ? AND t.project_id = ? AND t.stopped_at IS NULL',
      ).bind(analysisId, projectId).all<{ id: string }>()).results || [];
      for (const r of tracked) out.add(String(r.id));
    } catch { /* no competitor_tracking table: nothing is tracked */ }
  }
  return out;
}

/** The review a rerun returns: what it would add, remove and rewrite against `baseVersion`. Writes nothing. */
async function buildProposal(
  env: Env, analysisId: string, projectId: number | null, baseVersion: number, proposalId: string, result: AnalysisResult,
): Promise<Record<string, unknown>> {
  const db = env.DB;
  const norm = (n: unknown) => String(n ?? '').trim().toLowerCase().slice(0, 120);
  const stored = (await db.prepare('SELECT id, name, domain, url, category, relevance_score, summary, origin FROM competitor_candidates WHERE analysis_id = ? ORDER BY position ASC')
    .bind(analysisId).all<Record<string, unknown>>()).results || [];
  const storedNames = new Set(stored.map((c) => norm(c.name)));
  const found = new Set(result.candidates.map((c) => norm(c.name)));
  const keep = await protectedCandidateIds(db, analysisId, projectId);
  const out = await db.prepare('SELECT output_json, sections_edited_json FROM competitor_analysis_outputs WHERE analysis_id = ?')
    .bind(analysisId).first<{ output_json: string | null; sections_edited_json: string | null }>();
  const now = (safeParse(out?.output_json, {}) || {}) as Record<string, unknown>;
  const edited = (safeParse(out?.sections_edited_json, {}) || {}) as Record<string, string>;
  const proposed = result.output as unknown as Record<string, unknown>;
  const sourcesOf = (cid: string) => result.sources.filter((s) => s.candidate_id === cid).length;
  const manualSources = (await db.prepare("SELECT url FROM competitor_sources WHERE analysis_id = ? AND origin = 'manual'")
    .bind(analysisId).all<{ url: string }>()).results || [];
  return {
    proposal_id: proposalId,
    base_version: baseVersion,
    candidates: {
      add: result.candidates.filter((c) => !storedNames.has(norm(c.name))).map((c) => ({
        id: c.id, name: c.name, domain: c.domain ?? null, url: c.url ?? null, category: c.category,
        relevance_score: c.relevance_score ?? null, summary: c.summary ?? '', origin: c.origin, sources: sourcesOf(c.id),
      })),
      remove: stored.filter((c) => c.origin !== 'manual' && !found.has(norm(c.name)) && !keep.has(String(c.id))).map((c) => ({
        id: c.id, name: c.name, domain: c.domain ?? null, category: c.category, origin: c.origin,
      })),
    },
    output: Object.fromEntries(PROPOSABLE_FIELDS.map((f) => [f, {
      now: fieldValue(now, f),
      proposed: fieldValue(proposed, f),
      changed: !sameValue(fieldValue(now, f), fieldValue(proposed, f)),
      edited_at: typeof edited[f] === 'string' ? edited[f] : null,
    }])),
    // Not part of the review: the rerun never proposes a change to these.
    kept: {
      conclusion: typeof now.conclusion === 'string' && !!now.conclusion.trim(),
      notes: typeof now.notes === 'string' && !!now.notes.trim(),
      manual_candidates: stored.filter((c) => c.origin === 'manual').map((c) => ({ id: c.id, name: c.name })),
      manual_sources: manualSources.map((s) => s.url),
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/competitors/analyze — create + run a new analysis.
// body: { project_id?, mode?, ...inputs, title? }
// ---------------------------------------------------------------------------
competitors.post('/analyze', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const sql = getSQL(c.env);

  let inputs = coerceInputs(body);
  let mode = body.mode === 'startup' ? 'startup' : 'custom';
  let projectId: number | null = null;

  if (body.project_id != null && body.project_id !== '') {
    const pid = Number(body.project_id);
    const projRows = await sql`SELECT * FROM projects WHERE id = ${pid}`;
    const project = projRows[0];
    if (project) {
      // Access control: only the owner (via founder linkage), accepted
      // co-founders/advisors, or studio staff may prefill from a project.
      // Without this, any authenticated user could pass an arbitrary
      // project_id and read another founder's private project fields back
      // through inputs_json / the subsequent GET.
      const allowed = await canAccessProject(
        c.env,
        user,
        project as { id: number; founder_id: number | null },
        { write: false },
      );
      if (!allowed) {
        return c.json(
          { error: 'forbidden', message: 'You do not have access to that project.' },
          403,
        );
      }
      projectId = pid;
      mode = 'startup';
      const seeded = inputsFromProject(project);
      // Explicit body fields override project prefill.
      inputs = {
        market: inputs.market || seeded.market,
        target_customer: inputs.target_customer || seeded.target_customer,
        geography: inputs.geography || seeded.geography,
        known_competitors: inputs.known_competitors || seeded.known_competitors,
        problem: inputs.problem || seeded.problem,
        region_focus: inputs.region_focus || seeded.region_focus,
        depth: inputs.depth,
        nudge: inputs.nudge,
      };
    }
  }

  if (!inputs.market) {
    return c.json({ error: 'market_required', message: 'A market / industry is required to run the analysis.' }, 400);
  }

  // D7175: the subject company, read from the directory, rides in the inputs
  // (so a re-run keeps it out of the candidates) and on its own column.
  const found = await subjectFor(c.env, body.subject_uid);
  if ('refusal' in found) {
    return c.json({ error: found.refusal.error, message: found.refusal.message }, found.refusal.status);
  }
  if (found.subject) inputs = { ...inputs, subject: found.subject };

  const id = crypto.randomUUID();
  const title = (typeof body.title === 'string' && body.title.trim()) || inputs.market.slice(0, 80);
  await sql`INSERT INTO competitor_analyses (id, user_id, project_id, mode, title, inputs_json, status, created_at, updated_at)
    VALUES (${id}, ${user.id}, ${projectId}, ${mode}, ${title}, ${JSON.stringify(inputs)}, 'running', ${nowIso()}, ${nowIso()})`;
  if (found.subject) await sql`UPDATE competitor_analyses SET subject_uid = ${found.subject.uid} WHERE id = ${id}`;

  try {
    // D778 part 9: the press's page and option win; the record is the analysis this route made.
    const rail = railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.analyze }, analysisRecord(id));
    const result = await runCompetitorAnalysis(c.env, user.id, id, inputs, rail);
    await persistResult(c.env, id, result);
    await sql`UPDATE competitor_analyses SET status = 'complete', updated_at = ${nowIso()} WHERE id = ${id}`;
    const full = await loadAnalysis(c.env, user.id, id);
    return c.json(full);
  } catch (e) {
    await sql`UPDATE competitor_analyses SET status = 'error', updated_at = ${nowIso()} WHERE id = ${id}`;
    console.error('[competitors] analyze failed:', (e as Error).message);
    return c.json({ error: 'analysis_failed', message: 'The analysis pipeline failed. Try again or reduce depth.' }, 500);
  }
});

// GET /api/competitors — list the caller's analyses (summary rows).
competitors.get('/', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, project_id, mode, title, status, edited, created_at, updated_at, subject_uid
    FROM competitor_analyses WHERE user_id = ${user.id} ORDER BY updated_at DESC LIMIT 100`;
  // D7175: each row's subject and evidence status. A failed directory read
  // leaves the subject's name null and says so; it never hides the list.
  const [evidence, names] = await Promise.all([listEvidence(c.env, rows), subjectNames(c.env, rows)]);
  return c.json({
    analyses: rows.map((r) => ({
      ...r,
      subject_name: r.subject_uid ? (names?.get(String(r.subject_uid)) ?? null) : null,
      evidence: evidence.get(String(r.id)) ?? null,
    })),
    subject_names: names ? 'ok' : 'unreadable',
  });
});

// GET /api/competitors/:id — full analysis.
competitors.get('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const full = await loadAnalysis(c.env, user.id, c.req.param('id'));
  if (!full) return c.json({ error: 'not_found' }, 404);
  return c.json(full);
});

// PATCH /api/competitors/:id — save edits (title, output, candidate set).
competitors.patch('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  // D7176: a save of the title or the output is a new version. With If-Match
  // (or `base_version`) naming an older one it answers 409 and writes nothing.
  const savesText = typeof body.title === 'string' || (!!body.output && typeof body.output === 'object');
  if (savesText) {
    const base = baseVersionOf(c.req.header('If-Match'), body);
    if (Number.isNaN(base)) {
      return refuse(c, 400, { code: 'bad_version', message: 'The version this save is based on is not a version number.' });
    }
    const claim = await claimVersion(c.env, user.id, id, base);
    if ('conflict' in claim) return versionConflict(c, claim.conflict);
    try {
      await saveText(c.env, id, body);
    } catch (e) {
      await releaseVersion(c.env, id, claim.version);
      return refuse(c, 503, { code: 'save_failed', message: 'Save failed. Nothing was saved; the saved version is unchanged.', raw: e });
    }
  }

  if (Array.isArray(body.candidates)) {
    await sql`DELETE FROM competitor_candidates WHERE analysis_id = ${id}`;
    let pos = 0;
    for (const raw of body.candidates as Array<Record<string, unknown>>) {
      const cand = raw || {};
      const cid = typeof cand.id === 'string' && cand.id ? cand.id : crypto.randomUUID();
      await sql`INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
        VALUES (${cid}, ${id}, ${String(cand.name || 'Unnamed')}, ${cand.domain ?? null}, ${cand.url ?? null}, ${cand.category === 'adjacent' ? 'adjacent' : 'direct'}, ${Number(cand.relevance_score) || 0}, ${JSON.stringify(cand.scores || {})}, ${String(cand.summary || '')}, ${JSON.stringify(cand.details || {})}, ${String(cand.origin || 'manual')}, ${pos++})`;
    }
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }

  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates — add a manual competitor.
competitors.post('/:id/candidates', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = rows[0];
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.name || typeof body.name !== 'string') return c.json({ error: 'name_required' }, 400);

  // THE INSERT LIVES IN `_competitor_writes.ts` NOW, and this route is the reason
  // it had to move: `services/fills/registry.ts` requires that an accepted
  // proposal go through the function the manual form calls, and this insert was
  // inline here — so there was nothing for a fill to call. Behaviour is unchanged;
  // see that file's header for what a second copy of it would have got wrong
  // (`position`, and the `edited = 1` that stops a re-run deleting manual rows).
  const inputs = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  // D7175: self-match protection on the hand-typed row too.
  if (isSubjectMatch(inputs.subject, { name: body.name, url: body.url })) {
    return c.json({ error: 'subject_not_candidate', message: 'The subject of this analysis cannot be its own competitor.' }, 400);
  }
  await insertManualCandidate(c.env, user.id, id, inputs, {
    name: body.name,
    url: typeof body.url === 'string' ? body.url : undefined,
    category: typeof body.category === 'string' ? body.category : undefined,
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    crawl: !!body.crawl,
  }, railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.candidate }, analysisRecord(id)));
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// DELETE /api/competitors/:id/candidates/:cid — remove a competitor.
competitors.delete('/:id/candidates/:cid', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  await sql`DELETE FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  await sql`DELETE FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  await sql`DELETE FROM competitor_signals WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// PATCH /api/competitors/:id/candidates/:cid — the company page's own edits.
// Name, category and summary only. Relevance, origin and details are not
// fields this route writes: a blank score is not 0, and a fetched page does
// not become a price.
competitors.patch('/:id/candidates/:cid', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT id FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  if (!rows[0]) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 200);
    if (!name) return c.json({ error: 'A company needs a name.' }, 400);
    await sql`UPDATE competitor_candidates SET name = ${name} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.category === 'string') {
    if (body.category !== 'direct' && body.category !== 'adjacent') {
      return c.json({ error: 'Category is direct or adjacent.' }, 400);
    }
    await sql`UPDATE competitor_candidates SET category = ${body.category} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.summary === 'string') {
    await sql`UPDATE competitor_candidates SET summary = ${body.summary.slice(0, 4000)} WHERE analysis_id = ${id} AND id = ${cid}`;
  }
  if (typeof body.name !== 'string' && typeof body.category !== 'string' && typeof body.summary !== 'string') {
    return c.json({ error: 'Nothing on this company was sent to save.' }, 400);
  }
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates/:cid/sources — one public GET, recorded
// as a source. The URL does not become the company's homepage, and the page
// body is not copied into features, pricing or the summary.
competitors.post('/:id/candidates/:cid/sources', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT id, name FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  const cand = rows[0];
  if (!cand) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.url || typeof body.url !== 'string') return c.json({ error: 'A URL is required.' }, 400);

  const page = await fetchPage(c.env, body.url, { userId: user.id });
  if (!page.ok || !(page.text || page.title)) {
    return c.json({ error: page.error || 'That URL did not return a page.' }, 422);
  }
  const existing = await sql`SELECT id FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid} AND url = ${page.url}`;
  if (!existing[0]) {
    // D7176: attached by hand, so refresh and rerun keep it.
    await sql`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at, origin)
      VALUES (${crypto.randomUUID()}, ${id}, ${cid}, ${page.url}, ${sourceKind(page.url)}, ${page.title || String(cand.name || 'Untitled')}, ${page.status}, ${page.fetched_at}, 'manual')`;
    await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  }
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/candidates/:cid/crawl — the site already on the
// row. Absent when the row has no URL. Records sources and signals only.
competitors.post('/:id/candidates/:cid/crawl', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const cid = c.req.param('cid');
  const sql = getSQL(c.env);
  const analyses = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = analyses[0];
  if (!analysis) return c.json({ error: 'This analysis is not on your list.' }, 404);
  const rows = await sql`SELECT * FROM competitor_candidates WHERE analysis_id = ${id} AND id = ${cid}`;
  const row = rows[0];
  if (!row) return c.json({ error: 'This company is not in that analysis.' }, 404);
  const cand = mapCandidate(row) as unknown as Candidate;
  if (!cand.url) return c.json({ error: 'There is no URL to crawl. Nothing here will invent one.' }, 400);

  const inputs = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  const depth = inputs.depth === 'deep' ? 'deep' : 'quick';
  const { sources, signals } = await collectCandidateCrawl(c.env, user.id, id, cand, depth,
    railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.site }, analysisRecord(id)));
  if (!sources.length) return c.json({ error: 'The site did not return a page to record.' }, 422);

  const haveSources = await sql`SELECT url FROM competitor_sources WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  const seenUrl = new Set(haveSources.map((s) => String(s.url)));
  for (const s of sources) {
    if (seenUrl.has(s.url)) continue;
    seenUrl.add(s.url);
    await sql`INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at)
      VALUES (${s.id}, ${id}, ${cid}, ${s.url}, ${s.kind}, ${s.title}, ${s.status}, ${s.fetched_at})`;
  }
  const haveSignals = await sql`SELECT signal_type, label, detail FROM competitor_signals WHERE analysis_id = ${id} AND candidate_id = ${cid}`;
  const seenSignal = new Set(haveSignals.map((g) => `${g.signal_type}|${g.label}|${g.detail}`));
  for (const g of signals) {
    const key = `${g.signal_type}|${g.label}|${g.detail}`;
    if (seenSignal.has(key)) continue;
    seenSignal.add(key);
    await sql`INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail)
      VALUES (${g.id}, ${id}, ${cid}, ${g.signal_type}, ${g.label}, ${g.detail})`;
  }
  await sql`UPDATE competitor_analyses SET edited = 1, updated_at = ${nowIso()} WHERE id = ${id}`;
  const full = await loadAnalysis(c.env, user.id, id);
  return c.json(full);
});

// POST /api/competitors/:id/rerun — run discovery again and return a PROPOSAL.
// body: { inputs? } — re-runs from stored inputs (optionally overridden).
//
// D7176 (canvas D7042, RS-14 B2): the rerun writes nothing to the analysis.
// It answers what it would add, remove and rewrite against the saved version
// (`base_version`) and keeps that proposal, one per analysis, for the apply
// step below. A failed run leaves the status and the body as they were: the
// old route set `status = 'error'`, and the page then hid the whole body,
// notes included. The person's own work — title, notes, conclusion, a
// competitor or a source added by hand — is never in a proposal.
competitors.post('/:id/rerun', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  const analysis = rows[0];
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const stored = safeParse(analysis.inputs_json, {}) as AnalysisInputs;
  const inputs: AnalysisInputs = body.inputs && typeof body.inputs === 'object' ? { ...stored, ...coerceInputs(body.inputs as Record<string, unknown>) } : stored;
  const version = Number((await c.env.DB.prepare('SELECT version FROM competitor_analysis_outputs WHERE analysis_id = ?')
    .bind(id).first<{ version: number }>())?.version ?? 1) || 1;

  try {
    const rail = railFor(c, { page: COMPANIES_PAGE, option: COMPANIES_OPTIONS.again }, analysisRecord(id));
    const result = await runCompetitorAnalysis(c.env, user.id, id, inputs, rail);
    const proposalId = crypto.randomUUID();
    const projectId = analysis.project_id == null ? null : Number(analysis.project_id);
    const proposal = await buildProposal(c.env, id, projectId, version, proposalId, result);
    await c.env.DB.prepare(
      `INSERT INTO competitor_rerun_proposals (analysis_id, proposal_id, user_id, base_version, inputs_json, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(analysis_id) DO UPDATE SET proposal_id = excluded.proposal_id, user_id = excluded.user_id,
         base_version = excluded.base_version, inputs_json = excluded.inputs_json, result_json = excluded.result_json,
         created_at = excluded.created_at`,
    ).bind(id, proposalId, user.id, version, JSON.stringify(inputs), JSON.stringify(result), nowIso()).run();
    return c.json(proposal);
  } catch (e) {
    return refuse(c, 503, {
      code: 'rerun_failed',
      message: `Rerun failed. Nothing was replaced: the analysis is still version ${version}, with all its text, competitors and sources.`,
      raw: e,
      extra: { version },
    });
  }
});

// POST /api/competitors/:id/rerun/apply — take the ticked changes of the
// latest rerun proposal. Header `If-Match: <base_version>`;
// body { proposal_id, add: [candidate ids], remove: [candidate ids], output: [field names] }.
//
// D7176: only the ticked additions, removals and rewrites are written, and
// they are written as one new saved version. A proposal made against an older
// version, or an analysis saved again since, answers 409 and writes nothing.
// Notes and the conclusion are not fields this route takes; a competitor
// added by hand, or one carrying a source attached by hand, cannot be removed
// here; an accepted rewrite clears that section's edited date.
competitors.post('/:id/rerun/apply', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const db = c.env.DB;
  const analysis = await db.prepare('SELECT id, project_id FROM competitor_analyses WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first<{ id: string; project_id: number | null }>();
  if (!analysis) return refuse(c, 404, { code: 'not_found', message: 'This analysis is not on your list.' });
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const ifMatch = baseVersionOf(c.req.header('If-Match'), {});
  if (ifMatch === null) {
    return refuse(c, 428, { code: 'if_match_required', message: 'Accepting a rerun names the version it was reviewed against, in If-Match.' });
  }
  if (Number.isNaN(ifMatch)) {
    return refuse(c, 400, { code: 'bad_version', message: 'The version this review is based on is not a version number.' });
  }
  const pending = await db.prepare('SELECT proposal_id, base_version, inputs_json, result_json FROM competitor_rerun_proposals WHERE analysis_id = ?')
    .bind(id).first<{ proposal_id: string; base_version: number; inputs_json: string; result_json: string }>();
  if (!pending || pending.proposal_id !== body.proposal_id) {
    return refuse(c, 409, {
      code: 'proposal_gone',
      message: 'This review is no longer the latest rerun of this analysis. Nothing was written; run discovery again to review.',
    });
  }
  if (ifMatch !== Number(pending.base_version)) return versionConflict(c, Number(pending.base_version));

  const ids = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') as string[] : []);
  const addIds = ids(body.add);
  const removeIds = ids(body.remove);
  const fields = [...ids(body.output)].filter((f) => (PROPOSABLE_FIELDS as readonly string[]).includes(f));
  const result = safeParse(pending.result_json, null) as AnalysisResult | null;
  if (!result) return refuse(c, 409, { code: 'proposal_gone', message: 'This review could not be read back. Nothing was written; run discovery again to review.' });

  const claim = await claimVersion(c.env, user.id, id, ifMatch);
  if ('conflict' in claim) return versionConflict(c, claim.conflict);
  try {
    const norm = (n: unknown) => String(n ?? '').trim().toLowerCase().slice(0, 120);
    const stored = (await db.prepare('SELECT id, name, origin FROM competitor_candidates WHERE analysis_id = ?')
      .bind(id).all<{ id: string; name: string; origin: string }>()).results || [];
    const storedNames = new Set(stored.map((r) => norm(r.name)));
    const keep = await protectedCandidateIds(db, id, analysis.project_id ?? null);
    const pos = await db.prepare('SELECT COALESCE(MAX(position), -1) AS maxpos FROM competitor_candidates WHERE analysis_id = ?')
      .bind(id).first<{ maxpos: number }>();
    let next = Number(pos?.maxpos ?? -1) + 1;
    const at = nowIso();
    const stmts = [];
    const added: string[] = [];
    for (const cand of result.candidates) {
      if (!addIds.has(cand.id) || storedNames.has(norm(cand.name))) continue;
      added.push(cand.id);
      stmts.push(db.prepare(
        `INSERT INTO competitor_candidates (id, analysis_id, name, domain, url, category, relevance_score, scores_json, summary, details_json, origin, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(cand.id, id, cand.name, cand.domain ?? null, cand.url ?? null, cand.category, cand.relevance_score,
        JSON.stringify(cand.scores || {}), cand.summary ?? null, JSON.stringify(cand.details || {}), cand.origin, next++));
      for (const src of result.sources.filter((s) => s.candidate_id === cand.id)) {
        stmts.push(db.prepare(
          "INSERT INTO competitor_sources (id, analysis_id, candidate_id, url, kind, title, status, fetched_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fetched')",
        ).bind(src.id, id, cand.id, src.url, src.kind, src.title ?? null, src.status, src.fetched_at ?? null));
      }
      for (const g of result.signals.filter((s) => s.candidate_id === cand.id)) {
        stmts.push(db.prepare('INSERT INTO competitor_signals (id, analysis_id, candidate_id, signal_type, label, detail) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(g.id, id, cand.id, g.signal_type, g.label ?? null, g.detail ?? null));
      }
    }
    const removed: string[] = [];
    for (const row of stored) {
      if (!removeIds.has(row.id) || row.origin === 'manual' || keep.has(row.id)) continue;
      removed.push(row.id);
      stmts.push(db.prepare('DELETE FROM competitor_candidates WHERE analysis_id = ? AND id = ?').bind(id, row.id));
      stmts.push(db.prepare("DELETE FROM competitor_sources WHERE analysis_id = ? AND candidate_id = ? AND origin <> 'manual'").bind(id, row.id));
      stmts.push(db.prepare('DELETE FROM competitor_signals WHERE analysis_id = ? AND candidate_id = ? AND project_id IS NULL').bind(id, row.id));
    }
    const outRow = await db.prepare('SELECT output_json, sections_edited_json FROM competitor_analysis_outputs WHERE analysis_id = ?')
      .bind(id).first<{ output_json: string | null; sections_edited_json: string | null }>();
    const output = (safeParse(outRow?.output_json, {}) || {}) as Record<string, unknown>;
    const edited = (safeParse(outRow?.sections_edited_json, {}) || {}) as Record<string, string>;
    const proposed = (result.output || {}) as unknown as Record<string, unknown>;
    for (const f of fields) {
      output[f] = fieldValue(proposed, f);
      delete edited[f];
    }
    stmts.push(db.prepare('UPDATE competitor_analysis_outputs SET output_json = ?, sections_edited_json = ?, updated_at = ? WHERE analysis_id = ?')
      .bind(JSON.stringify(output), JSON.stringify(edited), at, id));
    stmts.push(db.prepare("UPDATE competitor_analyses SET status = 'complete', inputs_json = ?, updated_at = ? WHERE id = ?")
      .bind(pending.inputs_json || '{}', at, id));
    stmts.push(db.prepare('DELETE FROM competitor_rerun_proposals WHERE analysis_id = ?').bind(id));
    await db.batch(stmts);
    const full = await loadAnalysis(c.env, user.id, id);
    return c.json({ ...full, applied: { added: added.length, removed: removed.length, rewritten: fields.length, version: claim.version } });
  } catch (e) {
    await releaseVersion(c.env, id, claim.version);
    return refuse(c, 503, {
      code: 'apply_failed',
      message: `The selected changes were not applied. The analysis is still version ${ifMatch}.`,
      raw: e,
    });
  }
});

// POST /api/competitors/:id/refresh — fetch the stored sources again.
//
// D7176 (canvas D7042, RS-14 B1; owner answer A): no discovery and no model.
// Every source row on record is fetched once more. A page that answers moves
// that row's status and date (and, for a fetched row, its title); a page that
// does not keeps the row as it was, with its old date, and is listed in
// `refresh.results`. Candidates, the output, notes, the conclusion and the
// edited flags are not read or written, and a source attached by hand is
// re-checked, never deleted. The writes go in one batch at the end, so a
// failure part-way changes nothing.
competitors.post('/:id/refresh', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const db = c.env.DB;
  const analysis = await db.prepare('SELECT id FROM competitor_analyses WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first<{ id: string }>();
  if (!analysis) return c.json({ error: 'not_found' }, 404);
  try {
    const rows = (await db.prepare('SELECT id, url, origin FROM competitor_sources WHERE analysis_id = ? ORDER BY created_at, id')
      .bind(id).all<{ id: string; url: string; origin: string | null }>()).results || [];
    const at = nowIso();
    const stmts = [];
    const results: Array<{ id: string; url: string; ok: boolean; status: number | null }> = [];
    for (const row of rows) {
      const page = await fetchPage(c.env, row.url, { userId: user.id, refresh: true });
      const ok = !!page.ok && !!(page.text || page.title);
      results.push({ id: row.id, url: row.url, ok, status: page.status || null });
      if (!ok) continue;
      stmts.push(row.origin === 'manual'
        ? db.prepare('UPDATE competitor_sources SET status = ?, fetched_at = ? WHERE analysis_id = ? AND id = ?')
          .bind(page.status, page.fetched_at || at, id, row.id)
        : db.prepare("UPDATE competitor_sources SET status = ?, fetched_at = ?, title = COALESCE(NULLIF(?, ''), title) WHERE analysis_id = ? AND id = ?")
          .bind(page.status, page.fetched_at || at, page.title || '', id, row.id));
    }
    if (stmts.length) await db.batch(stmts);
    const full = await loadAnalysis(c.env, user.id, id);
    const fetched = results.filter((r) => r.ok).length;
    return c.json({ ...full, refresh: { at, checked: results.length, fetched, not_fetched: results.length - fetched, results } });
  } catch (e) {
    return refuse(c, 503, {
      code: 'refresh_failed',
      message: 'Refresh failed. Nothing changed: every source keeps the copy and date of its last fetch.',
      raw: e,
    });
  }
});

// DELETE /api/competitors/:id — delete an analysis.
competitors.delete('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const id = c.req.param('id');
  const sql = getSQL(c.env);
  const owned = await sql`SELECT id FROM competitor_analyses WHERE id = ${id} AND user_id = ${user.id}`;
  if (!owned[0]) return c.json({ error: 'not_found' }, 404);
  await sql`DELETE FROM competitor_analyses WHERE id = ${id}`;
  return c.json({ ok: true });
});

// POST /api/competitors/fetch — controlled in-house proxy fetch of ONE public
// URL. Returns normalized text so the UI can preview a source or seed a manual
// competitor. SSRF-guarded + rate-limited inside webFetch.
competitors.post('/fetch', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!body.url || typeof body.url !== 'string') return c.json({ error: 'url_required' }, 400);
  const page = await fetchPage(c.env, body.url, { userId: user.id, refresh: !!body.refresh });
  return c.json(page);
});

// GET /api/competitors/:id/export?format=json|md[&version=N]
// D7176: an export is of a saved version — the current one, or with
// `version` an older one kept when a save replaced it — and says which in
// `X-Analysis-Version`. Unsaved edits on a page are never in it.
competitors.get('/:id/export', async (c) => {
  const user = await requireAuth(c);
  await ensureCompetitorSchema(c.env);
  const loaded = await loadAnalysis(c.env, user.id, c.req.param('id'));
  if (!loaded) return c.json({ error: 'not_found' }, 404);
  const picked = await recordAtVersion(c.env, loaded, c.req.query('version'));
  if ('refusal' in picked) return refuse(c, picked.status, picked.refusal);
  const full = picked.record;
  const versionHeader = { 'X-Analysis-Version': String(full.version ?? loaded.version) };
  const format = (c.req.query('format') || 'json').toLowerCase();
  // D7175: the export names the subject as the directory records it now.
  const subject = await exportSubject(c.env, full);
  if (format === 'md' || format === 'markdown') {
    const md = renderMarkdown(full, subject);
    return new Response(md, { headers: { 'content-type': 'text/markdown; charset=utf-8', ...versionHeader } });
  }
  return c.json({ ...full, subject }, 200, versionHeader);
});

/** The record at `version`: the current one when it names no other, else the kept copy (D7176). */
async function recordAtVersion(
  env: Env, current: Record<string, unknown>, raw: string | undefined,
): Promise<{ record: Record<string, unknown> } | { status: number; refusal: { code: string; message: string } }> {
  if (raw === undefined || raw === '') return { record: current };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    return { status: 400, refusal: { code: 'bad_version', message: 'The version to export is not a version number.' } };
  }
  if (n === Number(current.version)) return { record: current };
  const row = await env.DB.prepare('SELECT snapshot_json FROM competitor_analysis_versions WHERE analysis_id = ? AND version = ?')
    .bind(String(current.id), n).first<{ snapshot_json: string }>();
  const snap = row ? safeParse(row.snapshot_json, null) as Record<string, unknown> | null : null;
  if (!snap) {
    return { status: 404, refusal: { code: 'version_not_found', message: `Version ${n} of this analysis is not on record.` } };
  }
  // D7175: the subject is fixed for an analysis, so a copy kept before the
  // subject was recorded on it names the current one; its evidence is that
  // copy's own, worked out from its rows when the copy does not carry it.
  const record: Record<string, unknown> = { ...snap, id: current.id, version: n };
  if (!('subject_uid' in snap)) record.subject_uid = current.subject_uid ?? null;
  if (!('evidence' in snap)) {
    record.evidence = snap.status === 'complete'
      ? evidenceOf({
        candidates: Array.isArray(snap.candidates) ? snap.candidates : [],
        sources: (Array.isArray(snap.sources) ? snap.sources : []) as Array<{ id: string; status: number | null }>,
        output: (snap.output || {}) as { findings?: Array<{ source_ids?: unknown }> },
      })
      : null;
  }
  return { record };
}

type ExportSubject = { uid: string; name: string | null; website: string | null; website_verified_at: string | null; read: 'ok' | 'not_found' | 'unreadable' } | null;

async function exportSubject(env: Env, full: Record<string, unknown>): Promise<ExportSubject> {
  const uid = typeof full.subject_uid === 'string' && full.subject_uid ? full.subject_uid : null;
  if (!uid) return null;
  try {
    const row = await readSubjectRow(env, uid);
    if (!row) return { uid, name: null, website: null, website_verified_at: null, read: 'not_found' };
    return { uid, name: row.name, website: row.website, website_verified_at: row.website_verified_at ?? null, read: 'ok' };
  } catch {
    return { uid, name: null, website: null, website_verified_at: null, read: 'unreadable' };
  }
}

/** D7175: the Evidence line's words, one vocabulary with the page and the list. */
const EVIDENCE_WORDS: Record<string, string> = {
  supported: 'Supported', partial: 'Partial', insufficient: 'Insufficient evidence',
  no_candidates: 'No candidates', unavailable: 'Sources unavailable',
};

/** D7175: the Subject and Evidence lines at the head of the Markdown export. */
export function subjectAndEvidenceLines(subject: ExportSubject, evidence: Evidence | null, status: unknown): string[] {
  const lines: string[] = [];
  if (!subject) lines.push('Subject: None · custom market');
  else if (subject.read !== 'ok') lines.push(`Subject: ${subject.uid} · the company record ${subject.read === 'not_found' ? 'is not in the directory' : 'could not be read'}`);
  else {
    const site = subject.website
      ? `${hostOf(subject.website) || subject.website} · website ${subject.website_verified_at ? `verified ${String(subject.website_verified_at).slice(0, 10)}` : 'not verified'}`
      : 'website not recorded';
    lines.push(`Subject: ${subject.name} (${subject.uid}) · ${site}`);
  }
  if (!evidence) lines.push(`Evidence: Not recorded · the run is ${String(status || 'not complete')}`);
  else {
    const counts = evidence.status === 'insufficient' || evidence.status === 'no_candidates'
      ? `${evidence.sources_fetched} sources · ${evidence.candidates} candidates`
      : `${evidence.sources_fetched} of ${evidence.sources_tried} sources fetched`;
    lines.push(`Evidence: ${EVIDENCE_WORDS[evidence.status] || evidence.status} · ${counts}`);
  }
  return lines;
}

function renderMarkdown(a: Record<string, unknown>, subject: ExportSubject = null): string {
  const out = (a.output || {}) as Partial<AnalysisOutput>;
  const cands = (a.candidates || []) as Array<Record<string, unknown>>;
  const inputs = (a.inputs || {}) as AnalysisInputs;
  const evidence = (a.evidence || null) as Evidence | null;
  // D7175: fetched sources numbered as the page and the findings cite them.
  const fetched = ((a.sources || []) as Array<Record<string, unknown>>).filter((s) => {
    const n = Number(s.status);
    return n >= 200 && n < 400;
  });
  const numberOf = new Map(fetched.map((s, i) => [String(s.id), i + 1]));
  const cites = (ids: unknown) => (Array.isArray(ids) ? ids : []).map((id) => numberOf.get(String(id))).filter(Boolean).map((n) => `[${n}]`).join('');
  const lines: string[] = [];
  lines.push(`# Competitor Analysis — ${a.title || inputs.market || ''}`);
  lines.push('');
  lines.push(`_Generated ${a.updated_at || ''} · mode: ${a.mode} · depth: ${inputs.depth || 'quick'}_`);
  lines.push('');
  lines.push(...subjectAndEvidenceLines(subject, evidence, a.status));
  lines.push('');
  if (evidence?.status === 'insufficient') {
    lines.push('This run found no companies and read no sources.');
    lines.push('No market gaps, classifications or wedge are stated.');
    lines.push('');
  }
  const findings = Array.isArray(out.findings) ? out.findings : [];
  const facts = findings.filter((f) => f.kind !== 'interpretation');
  const interpretation = findings.filter((f) => f.kind === 'interpretation');
  if (facts.length) {
    lines.push('## Findings (each cites a source)');
    for (const f of facts) lines.push(`- ${f.text} ${cites(f.source_ids) || '(no source in this run)'}`);
    lines.push('');
  }
  if (interpretation.length) {
    lines.push('## Interpretation');
    for (const f of interpretation) lines.push(`- ${f.text} ${cites(f.source_ids) || '(no source in this run)'}`);
    lines.push('');
  }
  for (const x of Array.isArray(out.excluded) ? out.excluded : []) {
    lines.push(`Excluded from candidates: ${x.name}${x.domain ? ` · ${x.domain}` : ''} — the subject.`);
    lines.push('');
  }
  if (out.market_summary) {
    lines.push('## Market summary');
    lines.push(out.market_summary);
    lines.push('');
  }
  lines.push('## Competitors');
  for (const c of cands) {
    const details = (c.details || {}) as Record<string, unknown>;
    lines.push(`### ${c.name} (${c.category}, relevance ${c.relevance_score})`);
    if (c.url) lines.push(`- URL: ${c.url}`);
    if (c.summary) lines.push(`- ${c.summary}`);
    if (Array.isArray(details.features) && details.features.length) lines.push(`- Features: ${(details.features as string[]).join(', ')}`);
    if (Array.isArray(details.pricing) && details.pricing.length) lines.push(`- Pricing: ${(details.pricing as string[]).join(', ')}`);
    if (details.positioning) lines.push(`- Positioning: ${details.positioning}`);
    lines.push('');
  }
  if (out.feature_comparison?.features?.length) {
    lines.push('## Feature comparison');
    lines.push(`| Competitor | ${out.feature_comparison.features.join(' | ')} |`);
    lines.push(`| --- | ${out.feature_comparison.features.map(() => '---').join(' | ')} |`);
    for (const r of out.feature_comparison.rows || []) {
      lines.push(`| ${r.competitor} | ${(r.values || []).join(' | ')} |`);
    }
    lines.push('');
  }
  if (out.gaps?.length) {
    lines.push('## Gaps & opportunities');
    for (const g of out.gaps) lines.push(`- ${g}`);
    lines.push('');
  }
  if (out.wedge) {
    lines.push('## Suggested wedge');
    lines.push(out.wedge);
    lines.push('');
  }
  if (out.next_actions?.length) {
    // D7175: the run's next steps are questions, not findings.
    lines.push('## Suggested research questions (not findings)');
    for (const n of out.next_actions) lines.push(`- ${n}`);
    lines.push('');
  }
  // D7176: the analyst's conclusion, written by the person, never by a run.
  const conclusion = (out as Record<string, unknown>).conclusion;
  if (typeof conclusion === 'string' && conclusion.trim()) {
    lines.push('## Conclusion');
    lines.push(conclusion);
    lines.push('');
  }
  if (out.notes) {
    lines.push('## Notes');
    lines.push(out.notes);
    lines.push('');
  }
  lines.push('## Sources');
  if (!fetched.length) lines.push('None.');
  for (const s of fetched) lines.push(`[${numberOf.get(String(s.id))}] ${s.url} · ${s.kind || 'page'} · fetched ${String(s.fetched_at || '').slice(0, 10)}`);
  return lines.join('\n');
}

export default competitors;
