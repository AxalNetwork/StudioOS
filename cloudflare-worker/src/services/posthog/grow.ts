/**
 * D1608 (#3731, #2409 part 6) — PostHog into Grow: Revenue and traction, and
 * Product improvement. Registers the Grow sync and its acceptor on import.
 *
 * WHAT A SYNC LANDS, each a fact "From PostHog, as of":
 *   - every metric tracked in either module; each is a KPI row
 *     `posthog-<uid>` on Revenue and traction (D1604), read only from PostHog;
 *   - for a tracked metric whose role is retention, its cohorts by first-seen
 *     week (`retention:<uid>`): shown BESIDE revenue cohort retention,
 *     labelled apart, never written to `monthly_churn_pct` or merged;
 *   - each survey's counts, with its NPS or average score when PostHog gives
 *     one (`survey_stats`, Product improvement).
 *
 * WHAT WAITS FOR ACCEPT: an answer to a question the founder marked
 * "feedback" (D1605's marks) as "Add as customer feedback"
 * (`survey_feedback`). Accept writes a `product_feedback` row through
 * `addFeedback`, `source 'customer'`, with no name, email or company.
 *
 * TEAM ONLY (#2409 decision C, a): the module read route answers the
 * venture's team alone. No respondent's identity reaches this file.
 *
 * All SQL is bound; none is interpolated. Nothing here logs a value or an answer.
 */
import type { Env } from '../../types';
import type { PosthogReads } from './reads';
import {
  AcceptRefused, counted, emptyResult, landFact, landTracked, registerAcceptor, registerSync, stopsSync, trackedOf, type SyncContext,
} from './metrics';
import { MAX_ITEMS, marksOf, proposeAnswers } from './validate';
import { addFeedback } from '../growWriters';

export const GROW_MODULES = Object.freeze(['revenue_and_traction', 'product_improvement'] as const);
export const MAX_COHORTS = 12;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export interface Cohort { week: string; size: number; pct: Array<number | null> }

/**
 * A retention insight's cohorts by first-seen week: each cohort's size and the
 * share of it seen again each week after, as percentages. A week PostHog gives
 * no count for is null, never 0.
 */
export function cohortsOf(result: unknown): Cohort[] {
  const rows = Array.isArray(obj(result)?.results) ? obj(result)!.results as unknown[] : Array.isArray(result) ? result as unknown[] : [];
  const out: Cohort[] = [];
  for (const r of rows.slice(0, MAX_COHORTS)) {
    const o = obj(r);
    const week = day(o?.date ?? o?.label);
    const values = Array.isArray(o?.values) ? o!.values as unknown[] : [];
    const counts = values.map((v) => num(obj(v)?.count ?? v));
    const size = counts[0];
    if (!week || size == null || size <= 0) continue;
    out.push({ week, size, pct: counts.slice(1, 13).map((c) => (c == null ? null : Math.round((c / size) * 1000) / 10)) });
  }
  return out;
}

/** A survey's counts, and its NPS or average score when PostHog states one. */
export function surveyFigures(stats: unknown): { responses: number | null; shown: number | null; nps: number | null; average: number | null } {
  const o = obj(stats);
  return {
    responses: num(o?.responses ?? o?.response_count),
    shown: num(o?.shown ?? o?.survey_shown),
    nps: num(o?.nps ?? obj(o?.scores)?.nps),
    average: num(o?.average ?? o?.mean ?? obj(o?.scores)?.average),
  };
}

export async function syncGrow(env: Env, reads: PosthogReads, ctx: SyncContext) {
  const r = emptyResult();
  await landTracked(env, reads, ctx, [...GROW_MODULES], r);
  if (r.partial) return r;
  for (const m of (await trackedOf(env, ctx.projectId, 'revenue_and_traction')).filter((t) => t.role === 'retention')) {
    try {
      const cohorts = cohortsOf(await reads.runInsight(m.insight_short_id));
      if (!cohorts.length) { r.unread.push(`retention:${m.uid}`); continue; }
      counted(r, await landFact(env, ctx, { module: 'revenue_and_traction', kind: 'metric', fact_key: `retention:${m.uid}`, period: ctx.today, value: null, value_json: { cohorts }, label: m.insight_name, source_ref: m.insight_short_id, as_of: ctx.today }));
    } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push(`retention:${m.uid}`); }
  }
  let surveys: Awaited<ReturnType<PosthogReads['surveys']>> = [];
  try { surveys = await reads.surveys(); } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push('surveys'); }
  for (const s of surveys.slice(0, MAX_ITEMS)) {
    try {
      const f = surveyFigures(await reads.surveyStats(s.id));
      counted(r, await landFact(env, ctx, { module: 'product_improvement', kind: 'survey_stats', fact_key: `survey:${s.id}`, period: ctx.today.slice(0, 7), value: f.nps ?? f.average, value_json: f, label: s.name, source_ref: s.id, as_of: ctx.today }));
    } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push(`survey:${s.id}`); }
  }
  await proposeAnswers(env, reads, ctx, await marksOf(env, ctx.projectId, 'feedback'), 'product_improvement', 'survey_feedback', r);
  return r;
}

registerSync('grow', syncGrow);

registerAcceptor({
  kind: 'survey_feedback',
  async accept(env, ctx, row) {
    let p: Record<string, unknown> = {};
    try { p = obj(JSON.parse(row.payload_json)) ?? {}; } catch { /* kept empty */ }
    const answer = typeof p.answer === 'string' ? p.answer : '';
    if (!answer.trim()) throw new AcceptRefused(409, 'answer_missing', 'This answer has no words to add as feedback.');
    try {
      // `source 'customer'`; no name, email or company is ever sent.
      const out = await addFeedback(env, ctx.projectId, { id: ctx.userId } as any, { body: answer, source: 'customer' });
      return { target_ref: `product_feedback:${out.uid}` };
    } catch (e) {
      const sentence = (e as { sentence?: string; message?: string })?.sentence ?? (e as Error)?.message;
      throw new AcceptRefused(Number((e as { status?: number })?.status) || 400, 'refused', String(sentence || 'The feedback could not be added.'));
    }
  },
});
