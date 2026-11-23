/**
 * D7817 (#7817) — the frozen copy of a saved analysis version that a Research
 * Project keeps (`research_project_attachments`, migration
 * 202611211307_7817_research_project_attachments.sql), and the one access
 * decision for reading either.
 *
 * WHY A COPY. Only superseded competitor-analysis versions are stored, a
 * refresh changes sources without a new version, and deleting an analysis
 * deletes its versions. So attaching reads the stored rows once and writes a
 * copy into the project. Nothing here writes to a competitor table, and
 * `routes/competitors.ts` is not imported: the rows are read as that route
 * stores them.
 *
 * ONE ACCESS DECISION. `mayReadAnalysis` is what both the stored analysis and
 * an attached copy are read under: the analysis's owner is the caller.
 * Attaching widens no one's access, and anything the caller may not read
 * reads as not found.
 */
import type { Env } from '../types';
import { sourceFetched } from './competitorAnalysis';
import { readCompanyByUid } from './researchCompanyRead';

/** The kinds a project may attach. The table holds no constraint on kind; this list is the check. */
export const ATTACHMENT_KINDS = ['competitor_analysis'] as const;
export type AttachmentKind = typeof ATTACHMENT_KINDS[number];
export const isAttachmentKind = (k: unknown): k is AttachmentKind =>
  typeof k === 'string' && (ATTACHMENT_KINDS as readonly string[]).includes(k);

/** The most attachments one project keeps. */
export const ATTACHMENTS_PER_PROJECT = 20;
/** The largest copy, in bytes of its stored JSON. */
export const COPY_BYTES_LIMIT = 256 * 1024;
/** The copy's format number; a later shape is a new number, and old copies keep theirs. */
export const COPY_FORMAT = 1;

/** The output fields a copy keeps as sections. */
export const COPY_SECTIONS = [
  'market_summary', 'direct_competitors', 'adjacent_competitors', 'feature_comparison',
  'pricing_signals', 'positioning', 'traction_signals', 'activity_signals',
  'gaps', 'wedge', 'next_actions', 'notes', 'conclusion',
] as const;

export interface CopySource {
  key: string;
  url: string;
  title: string | null;
  kind: string | null;
  status: number | null;
  fetched: boolean;
  retrieved_at: string | null;
  competitor_key: string | null;
}
export interface CopyFinding { n: number; text: string; kind: string | null; source_keys: string[] }
export interface AnalysisCopy {
  format: number;
  kind: AttachmentKind;
  analysis_id: string;
  version: number;
  title: string;
  saved_at: string | null;
  subject: { uid: string; name: string | null; read: 'ok' | 'not_found' | 'unreadable' } | null;
  sections: Record<string, unknown>;
  findings: CopyFinding[];
  competitors: Array<{ key: string; name: string; domain: string | null; url: string | null; category: string | null; summary: string | null }>;
  sources: CopySource[];
}

/** The one access decision: an analysis, and a copy of it, is read by its owner only. */
export function mayReadAnalysis(ownerUserId: unknown, userId: number): boolean {
  return Number.isInteger(userId) && Number(ownerUserId) === userId;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
function parse(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
}
const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const asRows = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

/**
 * A copy from one version's record, shaped as the analysis stores it (its
 * candidates, sources and output). Pure, so a test reads the same copy.
 */
export function buildCopy(record: {
  analysis_id: string; version: number; title: unknown; saved_at: unknown;
  subject: AnalysisCopy['subject']; output: unknown; candidates: unknown; sources: unknown;
}): AnalysisCopy {
  const output = asObject(parse(record.output));
  const sections: Record<string, unknown> = {};
  for (const field of COPY_SECTIONS) if (output[field] !== undefined) sections[field] = output[field];
  const sources: CopySource[] = asRows(record.sources).filter((s) => str(s.url)).map((s) => ({
    key: String(s.id ?? s.url),
    url: String(s.url),
    title: str(s.title),
    kind: str(s.kind),
    status: num(s.status),
    fetched: sourceFetched(s),
    retrieved_at: str(s.fetched_at),
    competitor_key: str(s.candidate_id),
  }));
  const findings: CopyFinding[] = asRows(output.findings).map((f, i) => ({
    n: i + 1,
    text: typeof f.text === 'string' ? f.text : '',
    kind: str(f.kind),
    source_keys: Array.isArray(f.source_ids) ? f.source_ids.map(String) : [],
  }));
  return {
    format: COPY_FORMAT,
    kind: 'competitor_analysis',
    analysis_id: record.analysis_id,
    version: record.version,
    title: str(record.title) || 'Untitled analysis',
    saved_at: str(record.saved_at),
    subject: record.subject,
    sections,
    findings,
    competitors: asRows(record.candidates).map((c) => ({
      key: String(c.id ?? ''),
      name: str(c.name) || 'Unnamed',
      domain: str(c.domain),
      url: str(c.url),
      category: str(c.category),
      summary: str(c.summary),
    })),
    sources,
  };
}

async function subjectOf(env: Env, uid: unknown): Promise<AnalysisCopy['subject']> {
  const id = str(uid);
  if (!id) return null;
  try {
    // D7819: the reviewed read service, so a withdrawn or excluded company is never named in a copy.
    const row = (await readCompanyByUid(env, id)) as { name?: unknown } | null | undefined;
    const name = typeof row?.name === 'string' ? row.name : null;
    return name ? { uid: id, name, read: 'ok' } : { uid: id, name: null, read: 'not_found' };
  } catch {
    return { uid: id, name: null, read: 'unreadable' };
  }
}

/**
 * The copy of `analysisId` at `version`, read from the stored rows: the
 * current version, or an earlier one kept in `competitor_analysis_versions`.
 * Null when the caller may not read the analysis, it is not complete, or the
 * version is not on record: each reads as not found. A failed read throws.
 */
export async function readAnalysisVersion(env: Env, userId: number, analysisId: string, version: number): Promise<AnalysisCopy | null> {
  const analysis = await env.DB.prepare(
    'SELECT id, user_id, title, status, subject_uid, updated_at FROM competitor_analyses WHERE id = ?',
  ).bind(analysisId).first<{ id: string; user_id: number; title: string | null; status: string; subject_uid: string | null; updated_at: string }>();
  if (!analysis || !mayReadAnalysis(analysis.user_id, userId) || analysis.status !== 'complete') return null;
  const out = await env.DB.prepare('SELECT output_json, version, updated_at FROM competitor_analysis_outputs WHERE analysis_id = ?')
    .bind(analysisId).first<{ output_json: string | null; version: number | null; updated_at: string | null }>();
  const current = Number(out?.version ?? 1) || 1;
  const subject = await subjectOf(env, analysis.subject_uid);
  if (version === current) {
    const candidates = await env.DB.prepare(
      'SELECT id, name, domain, url, category, summary FROM competitor_candidates WHERE analysis_id = ? ORDER BY position ASC',
    ).bind(analysisId).all();
    const sources = await env.DB.prepare(
      'SELECT id, candidate_id, url, kind, title, status, fetched_at FROM competitor_sources WHERE analysis_id = ? ORDER BY rowid',
    ).bind(analysisId).all();
    return buildCopy({
      analysis_id: analysisId, version, title: analysis.title, saved_at: out?.updated_at || analysis.updated_at,
      subject, output: out?.output_json, candidates: candidates.results, sources: sources.results,
    });
  }
  const kept = await env.DB.prepare('SELECT snapshot_json, saved_at FROM competitor_analysis_versions WHERE analysis_id = ? AND version = ?')
    .bind(analysisId, version).first<{ snapshot_json: string; saved_at: string }>();
  const snap = kept ? asObject(parse(kept.snapshot_json)) : null;
  if (!snap || snap.status !== 'complete') return null;
  return buildCopy({
    analysis_id: analysisId, version, title: snap.title ?? analysis.title, saved_at: kept!.saved_at,
    subject, output: snap.output, candidates: snap.candidates, sources: snap.sources,
  });
}

export interface AttachmentRow {
  id: number; uid: string; owner_user_id: number; kind: string; object_id: string; object_version: number;
  title: string; copy_format: number; attached_at: string;
}
export interface AttachedCopy { id: number; uid: string; copy: AnalysisCopy | null }

/** A stored copy, read under the same decision as the analysis; an unreadable body is null. */
export function readCopy(row: { owner_user_id: number; copy_json: string }, userId: number): AnalysisCopy | null {
  if (!mayReadAnalysis(row.owner_user_id, userId)) return null;
  const copy = parse(row.copy_json);
  return copy && typeof copy === 'object' && !Array.isArray(copy) ? copy as AnalysisCopy : null;
}

/** The project's attachments with their copies, by uid, for citing a source of one. */
export async function projectAttachmentCopies(env: Env, projectId: number, userId: number): Promise<Map<string, AttachedCopy>> {
  const rows = await env.DB.prepare(
    'SELECT id, uid, owner_user_id, copy_json FROM research_project_attachments WHERE project_id = ? AND owner_user_id = ?',
  ).bind(projectId, userId).all<{ id: number; uid: string; owner_user_id: number; copy_json: string }>();
  return new Map((rows.results || []).map((r) => [r.uid, { id: r.id, uid: r.uid, copy: readCopy(r, userId) }]));
}

/** A source of the copy a finding may cite: one the copy records as fetched. */
export function citableSource(copy: AnalysisCopy | null, key: unknown): CopySource | null {
  if (!copy || typeof key !== 'string' || !key) return null;
  const source = (copy.sources || []).find((s) => s.key === key);
  return source && source.fetched ? source : null;
}
