/**
 * D1143 (#3029, part 2 of #2433) — the Product-market fit collector.
 *
 * It reads Validate's stores for one venture and turns them into the ten
 * `PmfInputFacts` the engine (`pmf.ts`) scores. Every statement is bound.
 *
 * IT READS NO INTERVIEWEE NAME OR QUOTE. The interview read selects the fit,
 * the segment, the stage, the dates and the pain phrases (which the pain map
 * groups into themes) and nothing else; the claim rule (`claimsOf`) is handed
 * rows whose name, role, company, notes and claims are null. No demand
 * signal's `who`, no revenue entry's customer, no experiment's title or result
 * is selected.
 *
 * GRADES (#2433 § Grades, owner question 3 A):
 *   · an interview with a recorded session's transcript (status transcribed,
 *     structured or reviewed) is Measured; one logged by hand is Sourced;
 *   · a paid deposit or pilot: verified Measured, supported Sourced, typed
 *     Stated; a letter of intent or pre-sale with a file Sourced, else Stated;
 *   · a would-pay signal from a session Measured, from an interview Sourced,
 *     typed Stated;
 *   · a waitlist sign-up on the platform's own waitlist Measured, one typed in
 *     as a signal Stated;
 *   · an experiment outcome is typed: Stated.
 * An input's grade is the mean grade of the records behind it.
 *
 * THE PIVOT WINDOW (owner question 5 A): when the venture has a Pivot given,
 * only records dated after the latest one's day count. Each input says how
 * many it left out (`before_pivot`), so the page can show them as "Before the
 * pivot".
 */
import type { Env } from '../../types';
import { isHeld, heldDate, claimsOf, themesOf, type InterviewRow, type HypRow, type LinkRow } from '../cycleValidate';
import { loadPainGroupModel, safeParseStrings, severityLevel } from '../painGroups';
import { WAITLIST_TARGET_KEY } from '../validateWriters';
import { latestVenturePivotDay, ventureVerdictHeader } from '../verdict';
import { GRADES, type GradeLabel, type PmfInputFacts } from './pmf';

/** The interview fields the collector reads: no name, role, company, notes or quote. */
type IvRow = {
  id: number; icp_fit: string | null; segment_id: number | null; stage: string | null;
  done_at: string | null; interview_date: string | null; created_at: string | null; pains_json: string | null;
  transcribed: number | null;
};

export type PmfVerdict = Awaited<ReturnType<typeof ventureVerdictHeader>>;

export interface PmfCollected {
  inputs: PmfInputFacts[];
  /** The venture's current decision, shown and never scored. */
  verdict: PmfVerdict;
  /** The day of the latest Pivot given for the venture, or null. */
  pivot_at: string | null;
}

const day = (x: unknown): string | null => {
  const d = String(x ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};
const newest = (ds: Array<string | null>): string | null => ds.reduce<string | null>((a, d) => (d && (!a || d > a) ? d : a), null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ICP = (iv: { icp_fit: string | null }) => iv.icp_fit === 'strong' || iv.icp_fit === 'partial';

/** The grade word nearest a grade on 0–1. */
export function labelFor(g: number): GradeLabel {
  let label: GradeLabel = 'not_recorded'; let gap = Infinity;
  for (const [l, v] of Object.entries(GRADES) as Array<[GradeLabel, number]>) {
    if (Math.abs(v - g) < gap) { gap = Math.abs(v - g); label = l; }
  }
  return label;
}

/** The mean grade of some records, with the word nearest it. */
export function meanGrade(labels: GradeLabel[]): { grade: number; grade_label: GradeLabel } {
  if (!labels.length) return { grade: 0, grade_label: 'not_recorded' };
  const g = Math.round((labels.reduce((a, l) => a + GRADES[l], 0) / labels.length) * 1000) / 1000;
  return { grade: g, grade_label: labelFor(g) };
}

const ivGrade = (iv: IvRow): GradeLabel => (Number(iv.transcribed) > 0 ? 'measured' : 'sourced');

function facts(key: PmfInputFacts['key'], o: Partial<PmfInputFacts>): PmfInputFacts {
  return {
    key, applies: true, recorded: false, raw: {}, grade: 0, grade_label: 'not_recorded', as_of: null,
    source: { table: '', rows: 0 }, words: 'Not recorded', reason: null, before_pivot: 0, ...o,
  };
}

/** Kept after the pivot: dated after its day. A record with no date is kept (it cannot be placed before it). */
const afterPivot = (pivot: string | null, d: string | null) => !pivot || !d || d > pivot;

export async function collectPmfInputs(env: Env, projectId: number, today: string): Promise<PmfCollected> {
  const DB = env.DB;
  // Verdict's tables are read through verdict.ts only (D693 test 10).
  const pivot = await latestVenturePivotDay(env, projectId);
  const verdict = await ventureVerdictHeader(env, projectId);

  const ivRes = await DB.prepare(
    `SELECT i.id, i.icp_fit, i.segment_id, i.stage, i.done_at, i.interview_date, i.created_at, i.pains_json,
            (SELECT COUNT(*) FROM interview_sessions s
              WHERE s.interview_id = i.id AND s.status IN ('transcribed', 'structured', 'reviewed')) AS transcribed
       FROM discovery_interviews i WHERE i.project_id = ? ORDER BY i.id`,
  ).bind(projectId).all<IvRow>();
  const heldAll = (ivRes.results || []).filter(isHeld);
  const held = heldAll.filter((iv) => afterPivot(pivot, heldDate(iv)));
  const ivBefore = heldAll.length - held.length;
  const icp = held.filter(ICP);
  const keptIds = new Set(held.map((iv) => Number(iv.id)));

  const inputs: PmfInputFacts[] = [];
  const ivSource = (rows: number) => ({ table: 'discovery_interviews', rows });
  const sessions = (ivs: IvRow[]) => ivs.filter((iv) => Number(iv.transcribed) > 0).length;
  const noInterview = 'No interview held yet';

  // 1 · ICP interviews held
  inputs.push(held.length === 0
    ? facts('icp_interviews', { reason: noInterview, source: ivSource(0), before_pivot: ivBefore })
    : facts('icp_interviews', {
      recorded: true, raw: { n: icp.length }, ...meanGrade((icp.length ? icp : held).map(ivGrade)),
      as_of: newest(icp.map(heldDate)) ?? newest(held.map(heldDate)), source: ivSource(held.length), before_pivot: ivBefore,
      words: `${icp.length} of ${plural(held.length, 'held interview', 'held interviews')} with people who fit, ${sessions(icp)} from recorded sessions`,
    }));

  // 2 · ICP coverage
  const covered = held.filter((iv) => iv.icp_fit != null && iv.segment_id != null);
  inputs.push(held.length === 0
    ? facts('icp_coverage', { reason: noInterview, source: ivSource(0), before_pivot: ivBefore })
    : facts('icp_coverage', {
      recorded: true, raw: { n: covered.length, of: held.length }, ...meanGrade(held.map(ivGrade)),
      as_of: newest(held.map(heldDate)), source: ivSource(held.length), before_pivot: ivBefore,
      words: `${covered.length} of ${plural(held.length, 'held interview', 'held interviews')} with a fit and a segment`,
    }));

  // 3 · Pain frequency — the pain map's own themes, over ICP interviews
  const model = await loadPainGroupModel(env, projectId, { strict: true });
  const asRows = (ivs: IvRow[]): InterviewRow[] => ivs.map((iv) => ({
    id: Number(iv.id), icp_fit: iv.icp_fit, pains_json: iv.pains_json, stage: iv.stage, segment_id: iv.segment_id,
    done_at: iv.done_at, interview_date: iv.interview_date, created_at: iv.created_at,
    interviewee_name: null, interviewee_role: null, interviewee_company: null, quote_consent: null,
    hypotheses_json: null, notes: null, invited_at: null, booked_at: null, channel: null,
  }));
  const icpWithPains = icp.filter((iv) => safeParseStrings(iv.pains_json).some((p) => p.trim()));
  const themes = themesOf(asRows(icp), model, [], today);
  const top = themes[0];
  inputs.push(icp.length === 0 || !top
    ? facts('pain_frequency', {
      reason: icp.length === 0 ? 'No interview with someone who fits your ICP yet' : 'No pain logged on an ICP interview yet',
      source: ivSource(icp.length), before_pivot: ivBefore,
    })
    : facts('pain_frequency', {
      recorded: true, raw: { n: top.mentions, of: icp.length }, ...meanGrade(icpWithPains.map(ivGrade)),
      as_of: newest(icpWithPains.map(heldDate)), source: ivSource(icp.length), before_pivot: ivBefore,
      words: `${top.mentions} of ${plural(icp.length, 'ICP interview', 'ICP interviews')} name the top pain`,
      meta: { top_theme: top.title },
    }));

  // 4 · Pain severity — judged interviews with a pain judged Severe or Real
  const sevRes = await DB.prepare(
    `SELECT s.interview_id, s.severity
       FROM interview_pain_severities s JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE i.project_id = ?`,
  ).bind(projectId).all<{ interview_id: number; severity: string }>();
  const judged = new Set<number>(); const need = new Set<number>(); const judgedBefore = new Set<number>();
  const heldAllIds = new Set(heldAll.map((iv) => Number(iv.id)));
  for (const s of sevRes.results || []) {
    const id = Number(s.interview_id);
    const lv = severityLevel(s.severity);
    if (!lv || !heldAllIds.has(id)) continue;
    if (!keptIds.has(id)) { judgedBefore.add(id); continue; }
    judged.add(id);
    if (lv === 'severe' || lv === 'real') need.add(id);
  }
  const withPains = held.filter((iv) => safeParseStrings(iv.pains_json).some((p) => p.trim()));
  const unjudged = withPains.filter((iv) => !judged.has(Number(iv.id))).length;
  const judgedIvs = held.filter((iv) => judged.has(Number(iv.id)));
  inputs.push(judged.size === 0
    ? facts('pain_severity', {
      reason: withPains.length ? 'No pain judged yet' : 'No pain logged yet',
      source: { table: 'interview_pain_severities', rows: 0 }, before_pivot: judgedBefore.size, meta: { unjudged },
    })
    : facts('pain_severity', {
      recorded: true, raw: { n: need.size, of: judged.size }, ...meanGrade(judgedIvs.map(ivGrade)),
      as_of: newest(judgedIvs.map(heldDate)), source: { table: 'interview_pain_severities', rows: judged.size }, before_pivot: judgedBefore.size,
      words: `${need.size} of ${plural(judged.size, 'judged interview', 'judged interviews')} with a pain judged Severe or Real`,
      meta: { unjudged },
    }));

  // 5 · Claims supported — the founder board's verdict over the interviews after the pivot
  const hyps = (await DB.prepare(
    `SELECT id, code, sort_order, retired_at, inconclusive_at, updated_at
       FROM hypotheses WHERE project_id = ? AND retired_at IS NULL ORDER BY sort_order, id`,
  ).bind(projectId).all<{ id: number; code: string; sort_order: number; retired_at: string | null; inconclusive_at: string | null; updated_at: string | null }>()).results || [];
  const links = (await DB.prepare(
    `SELECT l.id, l.hypothesis_id, l.pain_group_id, l.direction, l.strength, l.created_at
       FROM hypothesis_pain_links l JOIN hypotheses h ON h.id = l.hypothesis_id
      WHERE h.project_id = ? AND h.retired_at IS NULL`,
  ).bind(projectId).all<LinkRow>()).results || [];
  const hypRows: HypRow[] = hyps.map((h) => ({
    id: h.id, code: h.code, claim: '', sort_order: h.sort_order, retired_at: h.retired_at, sprint: null,
    owner_user_id: null, owner_name: null, inconclusive_at: h.inconclusive_at, updated_at: h.updated_at,
  }));
  const claims = claimsOf(hypRows, links, asRows(held), model);
  const STRENGTH_WEIGHT: Record<string, number> = { measured: 1, pattern: 0.75 };
  const supported = claims.filter((c) => c.status === 'supported');
  const decided = claims.filter((c) => c.status === 'supported' || c.status === 'refuted');
  const sum = supported.reduce((a, c) => a + (STRENGTH_WEIGHT[c.strength ?? ''] ?? 0.5), 0);
  // The grade is the interviews' behind the claims, scaled by the share of claims with a verdict:
  // a claim with no verdict lowers confidence (#2433 input 5).
  const ivMean = meanGrade(held.map(ivGrade));
  const decidedShare = claims.length ? decided.length / claims.length : 0;
  const weakest = supported.filter((c) => c.strength !== 'measured')
    .sort((a, b) => (STRENGTH_WEIGHT[a.strength ?? ''] ?? 0.5) - (STRENGTH_WEIGHT[b.strength ?? ''] ?? 0.5))[0];
  const claimMeta = {
    open: claims.length,
    fit_unrecorded: claims.filter((c) => c.status === 'not_recorded' && c.fit_unrecorded > 0).map((c) => ({ code: c.code, interviews: c.fit_unrecorded })),
    untested: claims.filter((c) => c.status === 'untested').map((c) => c.code),
    weakest: weakest?.code ?? null,
    decided_grade: ivMean.grade,
  };
  inputs.push(claims.length === 0
    ? facts('claims_supported', { reason: 'No claim written yet', source: { table: 'hypotheses', rows: 0 }, before_pivot: ivBefore, meta: claimMeta })
    : facts('claims_supported', {
      // Σ (each Supported claim × its strongest evidence) ÷ open claims, so 2 at pattern of 5 reads 30.
      recorded: true, raw: { n: Math.round(sum * 1000) / 1000, of: claims.length },
      grade: Math.round(ivMean.grade * decidedShare * 1000) / 1000,
      grade_label: labelFor(ivMean.grade * decidedShare),
      as_of: newest(held.map(heldDate)), source: { table: 'hypotheses', rows: claims.length }, before_pivot: ivBefore,
      words: `${supported.length} of ${plural(claims.length, 'open claim', 'open claims')} Supported`,
      meta: claimMeta,
    }));

  // 6 · Paying demand, 7 · Would pay — demand signals and the revenue ledger's deposits and pilots
  const sigAll = (await DB.prepare(
    `SELECT kind, status, source_kind, amount_cents, signal_date,
            CASE WHEN evidence_file_key IS NULL OR evidence_file_key = '' THEN 0 ELSE 1 END AS has_file
       FROM demand_signals WHERE project_id = ?`,
  ).bind(projectId).all<{ kind: string; status: string; source_kind: string | null; amount_cents: number | null; signal_date: string | null; has_file: number }>()).results || [];
  const paidAll = (await DB.prepare(
    `SELECT verification, received_on FROM revenue_entries
      WHERE project_id = ? AND revenue_type IN ('deposit', 'pilot')`,
  ).bind(projectId).all<{ verification: string | null; received_on: string | null }>()).results || [];
  const sigs = sigAll.filter((s) => afterPivot(pivot, day(s.signal_date)));
  const paid = paidAll.filter((p) => afterPivot(pivot, day(p.received_on)));
  const demandBefore = sigAll.length - sigs.length + paidAll.length - paid.length;
  const counted = (s: { status: string }) => s.status === 'confirmed' || s.status === 'counted';
  const promises = sigs.filter((s) => (s.kind === 'loi' || s.kind === 'pre_sale') && counted(s) && Number(s.amount_cents) > 0);
  const promisesWaiting = sigs.filter((s) => (s.kind === 'loi' || s.kind === 'pre_sale') && s.status === 'to_confirm').length;
  const paidGrade = (v: string | null): GradeLabel => (v === 'verified' ? 'measured' : v === 'supported' ? 'sourced' : 'stated');
  const payingN = paid.length + promises.length;
  const demandRows = sigs.length + paid.length;
  inputs.push(demandRows === 0
    ? facts('paying_demand', { reason: 'No demand signal recorded', source: { table: 'demand_signals', rows: 0 }, before_pivot: demandBefore, meta: { to_confirm: 0, unsourced: 0, attach_grade: 0 } })
    : facts('paying_demand', {
      recorded: true, raw: { n: payingN },
      ...meanGrade([...paid.map((p) => paidGrade(p.verification)), ...promises.map((s): GradeLabel => (Number(s.has_file) ? 'sourced' : 'stated'))]),
      as_of: newest([...paid.map((p) => day(p.received_on)), ...promises.map((s) => day(s.signal_date))]),
      source: { table: paid.length ? 'demand_signals, revenue_entries' : 'demand_signals', rows: demandRows }, before_pivot: demandBefore,
      words: payingN === 0
        ? `0 of ${plural(demandRows, 'demand signal', 'demand signals')} paid or promised with an amount`
        : `${plural(paid.length, 'paid deposit or pilot', 'paid deposits and pilots')}, ${plural(promises.length, 'pre-sale or letter of intent', 'pre-sales and letters of intent')} with an amount`,
      meta: {
        to_confirm: promisesWaiting, unsourced: promises.filter((s) => !Number(s.has_file)).length,
        // The grade once every unsourced letter and pre-sale carries its file.
        attach_grade: meanGrade([...paid.map((p) => paidGrade(p.verification)), ...promises.map((): GradeLabel => 'sourced')]).grade,
      },
    }));

  const wouldPay = sigs.filter((s) => s.kind === 'would_pay' && counted(s));
  const wouldPayWaiting = sigs.filter((s) => s.kind === 'would_pay' && s.status === 'to_confirm').length;
  const wpGrade = (k: string | null): GradeLabel => (k === 'session' ? 'measured' : k === 'interview' ? 'sourced' : 'stated');
  inputs.push(icp.length === 0 || sigs.length === 0
    ? facts('would_pay', {
      reason: icp.length === 0 ? 'No interview with someone who fits your ICP yet' : 'No demand signal recorded',
      source: { table: 'demand_signals', rows: 0 }, before_pivot: demandBefore, meta: { to_confirm: wouldPayWaiting },
    })
    : facts('would_pay', {
      recorded: true, raw: { n: wouldPay.length, of: icp.length },
      ...(wouldPay.length ? meanGrade(wouldPay.map((s) => wpGrade(s.source_kind))) : meanGrade(icp.map(ivGrade))),
      as_of: newest(wouldPay.map((s) => day(s.signal_date))) ?? newest(icp.map(heldDate)),
      source: { table: 'demand_signals', rows: wouldPay.length }, before_pivot: demandBefore,
      words: `${wouldPay.length} of ${plural(icp.length, 'ICP interview', 'ICP interviews')} would pay`,
      meta: { to_confirm: wouldPayWaiting },
    }));

  // 8 · Waitlist against the bar — both stores, as the demand card counts them
  const bar = await DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
    .bind(projectId, WAITLIST_TARGET_KEY).first<{ target_value: number | null }>();
  const platformAll = (await DB.prepare(
    `SELECT created_at FROM waitlist_signups WHERE project_id = ? AND (audience IS NULL OR audience = 'customer')`,
  ).bind(projectId).all<{ created_at: string | null }>()).results || [];
  const platform = platformAll.filter((r) => afterPivot(pivot, day(r.created_at)));
  const typedAll = sigAll.filter((s) => s.kind === 'waitlist' && counted(s));
  const typed = typedAll.filter((s) => afterPivot(pivot, day(s.signal_date)));
  const signups = platform.length + typed.length;
  const waitBefore = platformAll.length - platform.length + typedAll.length - typed.length;
  const barValue = Number(bar?.target_value);
  const hasBar = Number.isFinite(barValue) && barValue > 0;
  inputs.push(!hasBar
    ? facts('waitlist', {
      reason: 'No bar set', words: `Not recorded: no bar set (${plural(signups, 'sign-up', 'sign-ups')})`,
      source: { table: 'waitlist_signups', rows: signups }, before_pivot: waitBefore, meta: { bar: null, signups },
    })
    : facts('waitlist', {
      recorded: true, raw: { n: signups, of: barValue },
      ...(signups ? meanGrade([...platform.map((): GradeLabel => 'measured'), ...typed.map((): GradeLabel => 'stated')]) : meanGrade(['measured'])),
      as_of: newest([...platform.map((r) => day(r.created_at)), ...typed.map((s) => day(s.signal_date))]) ?? today,
      source: { table: 'waitlist_signups', rows: signups }, before_pivot: waitBefore,
      words: `${plural(signups, 'sign-up', 'sign-ups')} against your bar of ${barValue}`,
      meta: { bar: barValue, signups },
    }));

  // 9 · Experiment outcomes — done experiments linked as evidence; supporting when every link supports
  const expAll = (await DB.prepare(
    `SELECT x.id, x.updated_at, MIN(CASE WHEN e.direction = 'supports' THEN 1 ELSE 0 END) AS supports
       FROM hypothesis_experiments x
       JOIN hypothesis_evidence_links e ON e.project_id = x.project_id AND e.kind = 'experiment' AND e.ref_id = CAST(x.id AS TEXT)
      WHERE x.project_id = ? AND x.status = 'done'
      GROUP BY x.id, x.updated_at`,
  ).bind(projectId).all<{ id: number; updated_at: string | null; supports: number }>()).results || [];
  const exps = expAll.filter((x) => afterPivot(pivot, day(x.updated_at)));
  const expSupport = exps.filter((x) => Number(x.supports) === 1).length;
  inputs.push(exps.length === 0
    ? facts('experiment_outcomes', { reason: 'No done experiment linked as evidence yet', source: { table: 'hypothesis_experiments', rows: 0 }, before_pivot: expAll.length })
    : facts('experiment_outcomes', {
      recorded: true, raw: { n: expSupport, of: exps.length }, ...meanGrade(exps.map((): GradeLabel => 'stated')),
      as_of: newest(exps.map((x) => day(x.updated_at))), source: { table: 'hypothesis_experiments', rows: exps.length },
      before_pivot: expAll.length - exps.length,
      words: `${expSupport} of ${plural(exps.length, 'done experiment', 'done experiments')} support`,
    }));

  // 10 · Product pull — applies once a product is live (owner question 4 A): a published release.
  const release = await DB.prepare(
    `SELECT COUNT(*) AS n FROM roadmap_releases WHERE project_id = ? AND prerelease = 0 AND published_at IS NOT NULL`,
  ).bind(projectId).first<{ n: number }>();
  const live = Number(release?.n) > 0;
  inputs.push(live
    ? facts('product_pull', { reason: 'PostHog metrics are not read yet (#2409)', source: { table: 'roadmap_releases', rows: Number(release?.n) } })
    : facts('product_pull', {
      applies: false, words: 'Not expected yet', reason: 'It counts once a release is out or PostHog tracks a metric',
      source: { table: 'roadmap_releases', rows: 0 },
    }));

  return {
    inputs,
    verdict,
    pivot_at: pivot,
  };
}
