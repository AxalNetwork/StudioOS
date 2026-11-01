/**
 * D1605 (#3731, #2409 part 3) — PostHog into Validate: Experiments and
 * evidence, and Demand and urgency signals. Registers the Validate sync and
 * its two acceptors on import (`routes/posthog.ts` imports it).
 *
 * WHAT A SYNC LANDS (#2409 § Module map), each a fact "From PostHog, as of":
 *   - each experiment's result: its variants, exposures and uplift, as small
 *     aggregates (`experiment_result`, Experiments and evidence);
 *   - each survey's counts: shown, dismissed and responses (`survey_stats`);
 *   - the web overview for the last 7 days: visitors, pageviews and sessions
 *     (`web_overview`, Demand and urgency signals), shown BESIDE the waitlist
 *     line and never added to `waitlist_signups`;
 *   - every metric the founder tracked in either module (`metric`), such as
 *     the landing funnel, read from its saved insight.
 *
 * WHAT WAITS FOR ACCEPT:
 *   - "Link this experiment to a hypothesis" (`experiment_evidence`). The
 *     hypothesis and whether it supports or contradicts are the founder's,
 *     sent with Accept and never guessed. Accept adds the experiment to the
 *     claim (method "PostHog experiment") and links it as `experiment`
 *     evidence, strength `measured`, through Validate's own writers.
 *   - An answer to a survey question the founder marked "would pay" or "need
 *     to have" (`survey_signal`). Accept writes a demand signal of that kind,
 *     `who` empty, `source_kind 'posthog'`, `to_confirm`, through
 *     `writeDemandSignal`. A question nobody marked proposes nothing.
 *
 * NO PERSON. A survey answer arrives from `reads.ts` already scrubbed of
 * `distinct_id`, `session_id`, person fields, emails and IPs; it is kept as
 * text in the proposal only (team-only, never logged), and on Accept as the
 * signal's note. Nothing here logs a value, a name or an answer.
 *
 * BUDGET. One session per sync; at most `MAX_ITEMS` experiments and surveys
 * each. A rate limit or a spent budget ends the sync "partly synced".
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import type { PosthogReads } from './reads';
import {
  AcceptRefused, counted, emptyResult, landFact, landTracked, proposeOnce, registerAcceptor, registerSync, stopsSync,
  type ProposalRow, type SyncContext,
} from './metrics';
import { WriterError, addEvidence, addExperiment, writeDemandSignal } from '../validateWriters';

export const MAX_ITEMS = 5;
export const ANSWER_MAX = 1000;
export const MARKS = Object.freeze(['would_pay', 'need_to_have', 'feedback'] as const);
export type Mark = (typeof MARKS)[number];

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const daysBefore = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** An experiment's result as small aggregates: each variant's key, exposure and uplift, and their total exposure. */
export function experimentSummary(result: unknown): { variants: Array<{ key: string; exposure: number | null; uplift: number | null }>; exposures: number | null; significant: boolean | null } {
  const o = obj(result);
  const list = Array.isArray(o?.variants) ? o!.variants : Array.isArray(obj(o?.results)?.variants) ? (obj(o!.results)!.variants as unknown[]) : [];
  const variants = (list as unknown[]).slice(0, 10).map((v) => {
    const x = obj(v);
    const key = typeof x?.key === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.key) ? x.key : null;
    return key ? { key, exposure: num(x!.exposure ?? x!.absolute_exposure), uplift: num(x!.uplift ?? x!.delta) } : null;
  }).filter((v): v is { key: string; exposure: number | null; uplift: number | null } => v !== null);
  const exposures = variants.some((v) => v.exposure != null) ? variants.reduce((n, v) => n + (v.exposure ?? 0), 0) : null;
  const sig = o?.significant ?? obj(o?.results)?.significant;
  return { variants, exposures, significant: typeof sig === 'boolean' ? sig : null };
}

/** The web overview's figures by key: visitors, pageviews, sessions, bounce rate. */
export function overviewOf(result: unknown): Record<string, number> {
  const o = obj(result);
  const rows = Array.isArray(o?.results) ? o!.results as unknown[] : [];
  const out: Record<string, number> = {};
  for (const r of rows) {
    const x = obj(r);
    const key = typeof x?.key === 'string' ? x.key.toLowerCase() : '';
    const v = num(x?.value);
    if (/^(visitors|views|pageviews|sessions|session_duration|bounce_rate)$/.test(key) && v != null) out[key] = v;
  }
  return out;
}

// ── Survey marks ─────────────────────────────────────────────────────────

export interface SurveyMark { survey_id: string; question_id: string; question_index: number; mark: Mark }

export async function marksOf(env: Env, projectId: number, mark?: Mark): Promise<SurveyMark[]> {
  const r = await env.DB.prepare(
    'SELECT survey_id, question_id, question_index, mark FROM posthog_survey_marks WHERE project_id = ? AND (? IS NULL OR mark = ?) ORDER BY survey_id, question_index',
  ).bind(projectId, mark ?? null, mark ?? null).all<SurveyMark>();
  return r.results || [];
}

/** Mark one question, or clear its mark with `null`. The question must be one the survey has. */
export async function setMark(env: Env, ctx: { integrationId: number; projectId: number; userId: number }, surveyId: string, questionId: string, index: number, mark: unknown): Promise<void> {
  if (mark === null) {
    await env.DB.prepare('DELETE FROM posthog_survey_marks WHERE project_id = ? AND survey_id = ? AND question_id = ?').bind(ctx.projectId, surveyId, questionId).run();
    return;
  }
  if (typeof mark !== 'string' || !(MARKS as readonly string[]).includes(mark)) throw new AcceptRefused(400, 'invalid_mark', 'Choose Would pay, Need to have or Feedback.');
  await env.DB.prepare(
    'INSERT INTO posthog_survey_marks (integration_id, project_id, survey_id, question_id, question_index, mark, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(project_id, survey_id, question_id) DO UPDATE SET mark = excluded.mark, question_index = excluded.question_index, integration_id = excluded.integration_id',
  ).bind(ctx.integrationId, ctx.projectId, surveyId, questionId, index, mark, ctx.userId).run();
}

/** A response's answer to one question: `$survey_response_<id>`, or `$survey_response` for the first. */
export function answerTo(answers: Record<string, string | number | null>, questionId: string, index: number): string | null {
  const v = answers[`$survey_response_${questionId}`] ?? (index === 0 ? answers.$survey_response : undefined) ?? answers[`$survey_response_${index}`];
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, ANSWER_MAX) : null;
}

/** Every answer to a marked question as one proposal each, in `module`, keyed by survey, question and time. */
export async function proposeAnswers(env: Env, reads: PosthogReads, ctx: SyncContext, marks: SurveyMark[], module: string, kind: 'survey_signal' | 'survey_feedback', r: ReturnType<typeof emptyResult>) {
  const bySurvey = new Map<string, SurveyMark[]>();
  for (const m of marks) bySurvey.set(m.survey_id, [...(bySurvey.get(m.survey_id) ?? []), m]);
  for (const [surveyId, qs] of [...bySurvey].slice(0, MAX_ITEMS)) {
    let responses;
    try { responses = await reads.surveyResponses(surveyId); } catch (e) { if (stopsSync(e)) { r.partial = true; return; } r.unread.push(`survey:${surveyId}`); continue; }
    for (const resp of responses.slice(0, 50)) {
      for (const q of qs) {
        const answer = answerTo(resp.answers, q.question_id, q.question_index);
        if (!answer) continue;
        const outcome = await proposeOnce(env, ctx, {
          module, kind, source_key: `survey:${surveyId}:${q.question_id}:${resp.at ?? answer.slice(0, 40)}`.slice(0, 200),
          payload: { title: answer, answer, mark: q.mark, survey_id: surveyId, at: day(resp.at) },
        });
        if (outcome === 'proposed') r.proposals += 1;
      }
    }
  }
}

// ── The sync ─────────────────────────────────────────────────────────────

export async function syncValidate(env: Env, reads: PosthogReads, ctx: SyncContext) {
  const r = emptyResult();
  await landTracked(env, reads, ctx, ['experiments', 'demand_signals'], r);
  if (r.partial) return r;
  try {
    const ov = overviewOf(await reads.webOverview({ date_from: daysBefore(ctx.today, 7), date_to: ctx.today }));
    if (Object.keys(ov).length) {
      counted(r, await landFact(env, ctx, { module: 'demand_signals', kind: 'web_overview', fact_key: 'web:7d', period: ctx.today, value: ov.visitors ?? null, value_json: ov, label: 'Visitors, last 7 days', as_of: ctx.today }));
    } else r.unread.push('web_overview');
  } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push('web_overview'); }

  let experiments: Awaited<ReturnType<PosthogReads['experiments']>> = [];
  try { experiments = await reads.experiments(); } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push('experiments'); }
  for (const ex of experiments.slice(0, MAX_ITEMS)) {
    try {
      const sum = experimentSummary(await reads.experimentResults(ex.id));
      counted(r, await landFact(env, ctx, { module: 'experiments', kind: 'experiment_result', fact_key: `experiment:${ex.id}`, period: 'current', value: sum.exposures, value_json: sum, label: ex.name, source_ref: ex.id, as_of: ctx.today }));
      if ((await proposeOnce(env, ctx, { module: 'experiments', kind: 'experiment_evidence', source_key: `experiment:${ex.id}`, payload: { title: ex.name ?? 'PostHog experiment', experiment_id: ex.id, flag: ex.feature_flag_key, ...sum } })) === 'proposed') r.proposals += 1;
    } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push(`experiment:${ex.id}`); }
  }

  let surveys: Awaited<ReturnType<PosthogReads['surveys']>> = [];
  try { surveys = await reads.surveys(); } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push('surveys'); }
  for (const s of surveys.slice(0, MAX_ITEMS)) {
    try {
      const st = obj(await reads.surveyStats(s.id));
      const counts = { responses: num(st?.responses ?? st?.response_count), shown: num(st?.shown ?? st?.survey_shown), dismissed: num(st?.dismissed ?? st?.survey_dismissed) };
      counted(r, await landFact(env, ctx, { module: 'experiments', kind: 'survey_stats', fact_key: `survey:${s.id}`, period: 'current', value: counts.responses, value_json: counts, label: s.name, source_ref: s.id, as_of: ctx.today }));
    } catch (e) { if (stopsSync(e)) { r.partial = true; return r; } r.unread.push(`survey:${s.id}`); }
  }

  const demand = (await marksOf(env, ctx.projectId)).filter((m) => m.mark === 'would_pay' || m.mark === 'need_to_have');
  await proposeAnswers(env, reads, ctx, demand, 'demand_signals', 'survey_signal', r);
  return r;
}

registerSync('validate', syncValidate);

// ── Accept ───────────────────────────────────────────────────────────────

const payloadOf = (row: ProposalRow) => { try { return obj(JSON.parse(row.payload_json)) ?? {}; } catch { return {}; } };
const refuse = (e: unknown): never => {
  if (e instanceof WriterError) throw new AcceptRefused(e.status, 'refused', e.message);
  throw e;
};

registerAcceptor({
  kind: 'experiment_evidence',
  async accept(env, ctx, row, body) {
    const p = payloadOf(row);
    const hypothesisId = Number(body.hypothesis_id);
    if (!Number.isSafeInteger(hypothesisId) || hypothesisId <= 0) throw new AcceptRefused(400, 'hypothesis_required', 'Choose the hypothesis this experiment tests.');
    const direction = body.direction;
    if (direction !== 'supports' && direction !== 'contradicts') throw new AcceptRefused(400, 'direction_required', 'Say whether it supports or contradicts the hypothesis.');
    try {
      const ex = await addExperiment(env, { projectId: ctx.projectId, userId: ctx.userId, hypothesisId, title: String(p.title || 'PostHog experiment'), method: 'PostHog experiment', target: typeof p.flag === 'string' ? `Flag ${p.flag}` : null });
      await addEvidence(env, { projectId: ctx.projectId, userId: ctx.userId, hypothesisId, kind: 'experiment', ref_id: String(ex.id), direction, strength: 'measured' });
      return { target_ref: `hypothesis_experiments:${ex.id}` };
    } catch (e) { return refuse(e); }
  },
});

registerAcceptor({
  kind: 'survey_signal',
  async accept(env, ctx, row) {
    const p = payloadOf(row);
    const kind = p.mark === 'would_pay' ? 'would_pay' : p.mark === 'need_to_have' ? 'need_to_have' : null;
    if (!kind) throw new AcceptRefused(409, 'mark_changed', 'This question is no longer marked. Mark it again to accept its answers.');
    try {
      const s = await writeDemandSignal(env, {
        projectId: ctx.projectId, userId: ctx.userId, kind, who: null, signal_date: day(p.at) ?? undefined,
        source_kind: 'posthog', status: 'to_confirm', note: typeof p.answer === 'string' ? p.answer : null,
      });
      return { target_ref: `demand_signals:${s.id}` };
    } catch (e) { return refuse(e); }
  },
});
