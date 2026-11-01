/**
 * D1589 (#3836) — stage norms (migration 746): the only benchmarks a deck
 * critic or stage plan may cite.
 *
 * A missing-proof warning ("Seed deck with no traction slide") needs no
 * benchmark. A sentence that compares the venture with other companies at its
 * stage does, so it may cite only:
 *   - a `stage_norms` row of the deck's own venture (`citableNorms`), or
 *   - a founder-entered benchmark that carries its source and sample size
 *     (`citableBenchmark`).
 * Otherwise it makes no benchmark claim, and says "No stage benchmark recorded".
 *
 * Owner decision S = A now, C later: rows are founder-entered (`origin =
 * 'founder'`). Axal's anonymised ventures are a follow-up issue.
 *
 * Callable without a route, so the one-click run (#3768) and the critic
 * (#3804) read the same rows the route serves.
 */
import type { Env } from '../../types';
import { AUDIENCES } from './slideModel';

export const STAGES = ['pre_seed', 'seed', 'series_a', 'series_b_plus'] as const;
export type Stage = typeof STAGES[number];
export type InvestorType = typeof AUDIENCES[number];

export const STAGE_LABELS: Record<Stage, string> = {
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b_plus: 'Series B+',
};

export const NO_BENCHMARK = 'No stage benchmark recorded';
export const NOT_RECORDED = 'Not recorded';

export type Block<T> = { available: true; value: T } | { available: false; reason: string };

export interface StageNormRow {
  id: number; uid: string; project_id: number; entered_by: number | null; origin: string;
  stage: Stage; investor_type: string | null; metric: string; value: string; source: string;
  sample_size: number; as_of: string | null; created_at: string; updated_at: string;
}

export interface StageNorm {
  uid: string;
  origin: string;
  stage: Stage;
  investor_type: string | null;
  metric: string;
  value: string;
  source: string;
  sample_size: number;
  as_of: Block<string>;
  /** The line a critic quotes: the figure with its base. */
  citation: string;
}

export interface NormDraft {
  stage: Stage;
  investor_type: string | null;
  metric: string;
  value: string;
  source: string;
  sample_size: number;
  as_of: string | null;
}

export type NormCheck = { ok: true; norm: NormDraft } | { ok: false; code: NormRefusal; message: string };

export type NormRefusal =
  | 'stage_invalid' | 'investor_type_invalid' | 'metric_missing' | 'value_missing'
  | 'source_missing' | 'sample_size_missing' | 'as_of_invalid';

export const NORM_MESSAGES: Record<NormRefusal, string> = {
  stage_invalid: 'Choose a stage: Pre-seed, Seed, Series A or Series B+.',
  investor_type_invalid: 'Choose one of the deck audiences, or leave the investor type empty for all of them.',
  metric_missing: 'Name what the norm measures.',
  value_missing: 'Enter the norm\'s figure, with its unit.',
  source_missing: 'A stage norm needs its source. Without one it cannot be cited.',
  sample_size_missing: 'A stage norm needs the number of companies it was measured over.',
  as_of_invalid: 'Enter the date the norm was measured as YYYY-MM-DD, or leave it empty.',
};

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validate a norm as the route and any other writer must: no source, no norm. */
export function checkNorm(raw: any): NormCheck {
  const refuse = (code: NormRefusal): NormCheck => ({ ok: false, code, message: NORM_MESSAGES[code] });
  const b = raw && typeof raw === 'object' ? raw : {};
  if (!STAGES.includes(b.stage)) return refuse('stage_invalid');
  let investorType: string | null = null;
  if (b.investor_type != null && b.investor_type !== '') {
    if (!(AUDIENCES as readonly string[]).includes(b.investor_type)) return refuse('investor_type_invalid');
    investorType = b.investor_type;
  }
  const metric = text(b.metric, 200);
  if (!metric) return refuse('metric_missing');
  const value = text(b.value, 100);
  if (!value) return refuse('value_missing');
  const source = text(b.source, 300);
  if (!source) return refuse('source_missing');
  const n = typeof b.sample_size === 'string' && b.sample_size.trim() !== '' ? Number(b.sample_size) : b.sample_size;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return refuse('sample_size_missing');
  let asOf: string | null = null;
  if (b.as_of != null && b.as_of !== '') {
    if (typeof b.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.as_of) || Number.isNaN(Date.parse(b.as_of))) return refuse('as_of_invalid');
    asOf = b.as_of;
  }
  return { ok: true, norm: { stage: b.stage, investor_type: investorType, metric, value, source, sample_size: n, as_of: asOf } };
}

export function normDto(r: StageNormRow): StageNorm {
  const asOf: Block<string> = r.as_of ? { available: true, value: r.as_of } : { available: false, reason: NOT_RECORDED };
  return {
    uid: r.uid,
    origin: r.origin,
    stage: r.stage,
    investor_type: r.investor_type,
    metric: r.metric,
    value: r.value,
    source: r.source,
    sample_size: Number(r.sample_size),
    as_of: asOf,
    citation: citationLine(r),
  };
}

function citationLine(r: { metric: string; value: string; source: string; sample_size: number; as_of: string | null }): string {
  const n = Number(r.sample_size);
  const base = `${r.source}, ${n} ${n === 1 ? 'company' : 'companies'}`;
  return `${r.metric}: ${r.value} (${base}${r.as_of ? `, as of ${r.as_of}` : ''})`;
}

/** A venture's norms, newest first; for one stage when `stage` is given. */
export async function listNorms(env: Env, projectId: number, stage?: Stage): Promise<StageNorm[]> {
  const rows = stage
    ? await env.DB.prepare('SELECT * FROM stage_norms WHERE project_id = ? AND stage = ? ORDER BY created_at DESC, id DESC LIMIT 500').bind(projectId, stage).all<StageNormRow>()
    : await env.DB.prepare('SELECT * FROM stage_norms WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 500').bind(projectId).all<StageNormRow>();
  return (rows.results || []).map(normDto);
}

/**
 * What a critic may cite for this stage and investor type: the venture's rows
 * for that stage whose investor type matches or is empty. No row, no claim.
 */
export async function citableNorms(env: Env, projectId: number, stage: Stage, investorType?: string | null): Promise<Block<StageNorm[]>> {
  const norms = (await listNorms(env, projectId, stage))
    .filter((n) => n.investor_type == null || investorType == null || n.investor_type === investorType);
  return norms.length ? { available: true, value: norms } : { available: false, reason: NO_BENCHMARK };
}

/**
 * A founder-entered benchmark from elsewhere (research benchmarks, a brief) as
 * a critic may cite it: only with its source and its sample size.
 */
export function citableBenchmark(b: { metric?: unknown; value?: unknown; source?: unknown; sample_size?: unknown; as_of?: unknown }): Block<string> {
  const metric = text(b.metric, 200);
  const value = text(b.value, 100);
  const source = text(b.source, 300);
  const n = Number(b.sample_size);
  if (!metric || !value || !source || !Number.isSafeInteger(n) || n < 1) return { available: false, reason: NO_BENCHMARK };
  const asOf = typeof b.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.as_of) ? b.as_of : null;
  return { available: true, value: citationLine({ metric, value, source, sample_size: n, as_of: asOf }) };
}
