/**
 * D4155 K5 (#4192) — HQ's stage norms (`hq_stage_norms`, migration
 * 202611022230): the platform defaults a deck critic cites after a venture's
 * own (D1589's `stage_norms`).
 *
 * WHAT A CRITIC MAY CITE, IN ORDER (`citableStageNorms`):
 *   1. the venture's own rows for the stage and investor type (`citableNorms`);
 *   2. HQ's ACTIVE rows for the stage. A retired row is never cited, from the
 *      moment it is retired: the read is per run, nothing is cached.
 * Each is one citation line: the norm, its range and its source. A citation
 * never rates the company; it is the figure other companies show, with its
 * base.
 *
 * No source, no norm: `checkHqNorm` refuses one, and so does the table.
 * People are `{ uid, name }`, never an email.
 */
import type { Env } from '../../types';
import { STAGES, NO_BENCHMARK, citableNorms, type Block, type Stage } from './stageNorms';

export const HQ_NORM_STATUSES = ['active', 'retired'] as const;
export type HqNormStatus = typeof HQ_NORM_STATUSES[number];
export type Person = { uid: string; name: string | null } | null;

export interface HqNormRow {
  id: number; uid: string; stage: Stage; metric: string; range_low: number | null; range_high: number | null; range_unit: string;
  source: string; last_reviewed: string; status: HqNormStatus; retired_by: number | null; retired_reason: string | null; retired_at: string | null;
  created_by: number | null; updated_by: number | null; created_at: string; updated_at: string;
}

export interface HqNorm {
  uid: string;
  stage: Stage;
  metric: string;
  range: { low: number | null; high: number | null; unit: string };
  source: string;
  last_reviewed: string;
  status: HqNormStatus;
  updated_by: Person;
  retired_by: Person;
  retired_reason: string | null;
  retired_at: string | null;
  /** The line a critic quotes: the norm, its range and its source. */
  citation: string;
}

export interface HqNormDraft {
  stage: Stage; metric: string; range_low: number | null; range_high: number | null; range_unit: string; source: string; last_reviewed: string;
}

export type HqNormRefusal = 'stage_invalid' | 'metric_missing' | 'range_invalid' | 'source_missing' | 'last_reviewed_invalid';
export const HQ_NORM_MESSAGES: Record<HqNormRefusal, string> = {
  stage_invalid: 'Choose a stage: Pre-seed, Seed, Series A or Series B+.',
  metric_missing: 'Name what the norm measures.',
  range_invalid: 'Give the typical range: a low, a high or both, as numbers, with the low not above the high.',
  source_missing: 'A stage norm needs its source. Without one it cannot be cited.',
  last_reviewed_invalid: 'Enter the day the norm was last reviewed as YYYY-MM-DD, or leave it for today.',
};

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const bound = (v: unknown): number | null | undefined => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Validate an HQ norm as every writer must: no source, no norm. `range` is `{ low, high, unit }`. */
export function checkHqNorm(raw: any, today: string): { ok: true; norm: HqNormDraft } | { ok: false; code: HqNormRefusal; message: string } {
  const no = (code: HqNormRefusal) => ({ ok: false as const, code, message: HQ_NORM_MESSAGES[code] });
  const b = raw && typeof raw === 'object' ? raw : {};
  if (!(STAGES as readonly string[]).includes(b.stage)) return no('stage_invalid');
  const metric = text(b.metric, 200);
  if (!metric) return no('metric_missing');
  const r = b.range && typeof b.range === 'object' ? b.range : {};
  const low = bound(r.low), high = bound(r.high);
  if (low === undefined || high === undefined || (low === null && high === null) || (low !== null && high !== null && low > high)) return no('range_invalid');
  const unit = text(r.unit, 40);
  const source = text(b.source, 300);
  if (!source) return no('source_missing');
  let reviewed = today;
  if (b.last_reviewed != null && b.last_reviewed !== '') {
    if (typeof b.last_reviewed !== 'string' || !isDay(b.last_reviewed)) return no('last_reviewed_invalid');
    reviewed = b.last_reviewed;
  }
  return { ok: true, norm: { stage: b.stage, metric, range_low: low, range_high: high, range_unit: unit, source, last_reviewed: reviewed } };
}

const num = (n: number) => String(Number(n));
/** "100–120%", "5+ logos", "up to 18 months". */
export function rangeText(low: number | null, high: number | null, unit: string): string {
  const u = !unit ? '' : /^[%x×]/.test(unit) ? unit : ` ${unit}`;
  if (low !== null && high !== null) return low === high ? `${num(low)}${u}` : `${num(low)}–${num(high)}${u}`;
  if (low !== null) return `${num(low)}+${u}`;
  return `up to ${num(high as number)}${u}`;
}

export function hqCitation(r: Pick<HqNormRow, 'metric' | 'range_low' | 'range_high' | 'range_unit' | 'source' | 'last_reviewed'>): string {
  return `${r.metric}: typically ${rangeText(r.range_low, r.range_high, r.range_unit)} (${r.source}; Axal HQ norm, reviewed ${r.last_reviewed})`;
}

type Joined = HqNormRow & { upd_uid: string | null; upd_name: string | null; ret_uid: string | null; ret_name: string | null };
const person = (uid: string | null, name: string | null): Person => (uid ? { uid, name } : null);

export function hqNormDto(r: Joined): HqNorm {
  return {
    uid: r.uid, stage: r.stage, metric: r.metric,
    range: { low: r.range_low === null ? null : Number(r.range_low), high: r.range_high === null ? null : Number(r.range_high), unit: r.range_unit },
    source: r.source, last_reviewed: r.last_reviewed, status: r.status,
    updated_by: person(r.upd_uid, r.upd_name),
    retired_by: r.status === 'retired' ? person(r.ret_uid, r.ret_name) : null,
    retired_reason: r.status === 'retired' ? r.retired_reason : null,
    retired_at: r.status === 'retired' ? r.retired_at : null,
    citation: hqCitation(r),
  };
}

const SELECT = `SELECT n.*, uu.uid AS upd_uid, uu.name AS upd_name, ru.uid AS ret_uid, ru.name AS ret_name
  FROM hq_stage_norms n LEFT JOIN users uu ON uu.id = COALESCE(n.updated_by, n.created_by) LEFT JOIN users ru ON ru.id = n.retired_by`;

/** HQ's norms, active first then retired, each by metric; for one stage when given. */
export async function listHqNorms(env: Env, stage?: Stage, status?: HqNormStatus): Promise<HqNorm[]> {
  const where: string[] = [], binds: unknown[] = [];
  if (stage) { where.push('n.stage = ?'); binds.push(stage); }
  if (status) { where.push('n.status = ?'); binds.push(status); }
  const rows = await env.DB.prepare(`${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY CASE n.status WHEN 'active' THEN 0 ELSE 1 END, n.metric COLLATE NOCASE, n.id LIMIT 500`).bind(...binds).all<Joined>();
  return (rows.results || []).map(hqNormDto);
}

export async function hqNormByUid(env: Env, uid: string): Promise<{ row: HqNormRow; dto: HqNorm } | null> {
  const r = await env.DB.prepare(`${SELECT} WHERE n.uid = ?`).bind(uid).first<Joined>();
  return r ? { row: r, dto: hqNormDto(r) } : null;
}

export type Citation = { origin: 'project' | 'hq'; uid: string; citation: string };

/**
 * What a deck critic may cite for this venture, stage and investor type: the
 * venture's own norms first, then HQ's active norms for the stage. No row,
 * no claim: "No stage benchmark recorded".
 */
export async function citableStageNorms(env: Env, projectId: number, stage: Stage, investorType?: string | null): Promise<Block<Citation[]>> {
  const own = await citableNorms(env, projectId, stage, investorType);
  const hq = await listHqNorms(env, stage, 'active');
  const out: Citation[] = [
    ...(own.available ? own.value.map((n) => ({ origin: 'project' as const, uid: n.uid, citation: n.citation })) : []),
    ...hq.map((n) => ({ origin: 'hq' as const, uid: n.uid, citation: n.citation })),
  ];
  return out.length ? { available: true, value: out } : { available: false, reason: NO_BENCHMARK };
}

export type ProjectNorm = {
  uid: string; stage: Stage; metric: string; value: string; source: string; sample_size: number; as_of: string | null;
  investor_type: string | null; set_by: Person; updated_at: string;
};

/** A venture's own norms for HQ's side panel, read-only, the setter by name. */
export async function projectNormsForHq(env: Env, projectId: number): Promise<ProjectNorm[]> {
  const rows = await env.DB.prepare(
    `SELECT s.uid, s.stage, s.metric, s.value, s.source, s.sample_size, s.as_of, s.investor_type, s.updated_at, u.uid AS by_uid, u.name AS by_name
       FROM stage_norms s LEFT JOIN users u ON u.id = s.entered_by
      WHERE s.project_id = ? ORDER BY s.stage, s.metric COLLATE NOCASE, s.id LIMIT 500`,
  ).bind(projectId).all<any>();
  return (rows.results || []).map((r: any) => ({
    uid: r.uid, stage: r.stage, metric: r.metric, value: r.value, source: r.source, sample_size: Number(r.sample_size), as_of: r.as_of ?? null,
    investor_type: r.investor_type ?? null, set_by: person(r.by_uid, r.by_name), updated_at: r.updated_at,
  }));
}
