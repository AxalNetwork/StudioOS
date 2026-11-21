/**
 * D5996 (#5996) — the parts Validate's V2 overview draws (#4837, boards V1,
 * V13 and V16), read beside today's overview and never in place of it:
 *
 *   - `evidence`: six counted figures, each saying what it counts
 *     (`population`) and over what period (`window`);
 *   - `attention`: at most four things that need the founder, most useful
 *     first, each with a venture-aware href;
 *   - `hypotheses`: the open claims with their computed status, direction
 *     counts, source breadth and latest experiment;
 *   - `changes`: the latest recorded activity across the six Validate modules.
 *
 * Facts come from where the overview already reads them: the claims from
 * `claimsOf`, the review queue, results and claim facts from
 * `validateFocus.ts`. The figures add no second policy: "mixed evidence" is
 * the next-action policy's own test (open, not decided, both directions).
 *
 * HONEST STATES. Each part fails alone: a part whose read failed is
 * `{ state: 'unavailable', reason }`, never an empty list or a zero (#5129).
 * A figure whose population is empty (no held interview, no open hypothesis,
 * no done experiment) is null, Not recorded, never 0. A count over a
 * population that exists stays a counted zero.
 *
 * DECISIONS. No part carries verdict data: a claim's status is the evidence
 * board's computed state, not the founder's decision, and `changes` reads
 * the six modules only, never `validate.verdict`, so a partner (who reads the
 * board but not decisions, D693) sees nothing a decision reader alone may.
 */
import type { Env } from '../types';
import { claimsOf, isHeld, loadHypotheses, loadInterviews, MODULES, type Claim, type InterviewRow } from './cycleValidate';
import { loadPainGroupModel } from './painGroups';
import { isPlacementKind, placementSlug } from './interviewStructuring';
import { reviewQueue } from './validateFocus';
import { claimHref, reviewHref } from './validateNextAction';

type Unavailable = { state: 'unavailable'; reason: string };
type Ok<T> = { state: 'ok' } & T;

/** One part: its read, or Unavailable with what could not be read. */
async function part<T extends object>(name: string, what: string, read: () => Promise<T>): Promise<Ok<T> | Unavailable> {
  try {
    return { state: 'ok', ...(await read()) };
  } catch (e) {
    console.warn('[validateOverviewParts] part unreadable:', name, (e as Error)?.message);
    return { state: 'unavailable', reason: `${what} could not be read.` };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const moduleHref = (pid: number, slug: string) => `/validate/${slug}?project=${pid}`;
const TO_DATE = 'everything recorded to date';
const hasFit = (iv: InterviewRow) => typeof iv.icp_fit === 'string' && iv.icp_fit.trim() !== '';

export type Figure = {
  key: string; label: string;
  /** Null: Not recorded (the population is empty), never 0. */
  value: number | null;
  /** The denominator, for a figure read as "N of M". */
  of?: number | null;
  population: string; window: string;
  detail: string | null;
  reason: string | null;
};

/** What every part reads, loaded once; a load that fails fails each part that needs it. */
export type Shared = {
  interviews: Promise<InterviewRow[]>;
  claims: Promise<Claim[]>;
  experiments: Promise<Array<{ id: number; hypothesis_id: number; title: string; status: string; result: string | null; updated_at: string | null }>>;
  demand: Promise<{ signals: Array<{ status: string }>; paid: number }>;
};

export function sharedReads(env: Env, projectId: number): Shared {
  const ctx = { env, projectId, today: new Date().toISOString().slice(0, 10) };
  const interviews = loadInterviews(ctx);
  const claims = (async () => {
    const [{ hyps, links }, ivs, model] = await Promise.all([loadHypotheses(ctx), interviews, loadPainGroupModel(env, projectId, { strict: true })]);
    return claimsOf(hyps, links, ivs, model);
  })();
  const experiments = (async () => (await env.DB.prepare(
    `SELECT e.id, e.hypothesis_id, e.title, e.status, e.result, e.updated_at
       FROM hypothesis_experiments e JOIN hypotheses h ON h.id = e.hypothesis_id
      WHERE e.project_id = ? AND h.project_id = ? AND h.retired_at IS NULL
      ORDER BY e.updated_at DESC, e.id DESC`,
  ).bind(projectId, projectId).all<any>()).results ?? [])();
  const demand = (async () => {
    const signals = (await env.DB.prepare('SELECT status FROM demand_signals WHERE project_id = ?').bind(projectId).all<{ status: string }>()).results ?? [];
    // A paid deposit or pilot is a pre-sale the revenue ledger holds (as the Demand card counts it).
    const paid = await env.DB.prepare("SELECT COUNT(*) AS n FROM revenue_entries WHERE project_id = ? AND revenue_type IN ('deposit', 'pilot')")
      .bind(projectId).first<{ n: number }>();
    return { signals, paid: Number(paid?.n ?? 0) };
  })();
  // Each is awaited by the parts that need it; none may surface as an unhandled rejection.
  for (const p of [interviews, claims, experiments, demand]) p.catch(() => {});
  return { interviews, claims, experiments, demand };
}

const hasResult = (e: { result: string | null }) => typeof e.result === 'string' && e.result.trim() !== '';

/** The six figures of V1's Evidence row. */
export async function evidencePart(shared: Shared) {
  return part('evidence', 'The evidence figures', async () => {
    const [ivs, claims, exps, demand] = await Promise.all([shared.interviews, shared.claims, shared.experiments, shared.demand]);
    const held = ivs.filter(isHeld);
    const done = exps.filter((e) => e.status === 'done');
    const results = done.filter(hasResult).length;
    const toConfirm = demand.signals.filter((s) => s.status === 'to_confirm').length;
    const confirmed = demand.signals.length - toConfirm + demand.paid;
    const supporting = claims.reduce((t, c) => t + c.supporting, 0);
    const contradicting = claims.reduce((t, c) => t + c.contradicting, 0);
    const sources = held.length + confirmed + results;
    const nr = (reason: string) => ({ value: null, reason });
    const figures: Figure[] = [
      {
        key: 'distinct_sources', label: 'Distinct sources', population: 'held interviews, confirmed demand signals and recorded experiment results', window: TO_DATE,
        ...(sources ? { value: sources, reason: null } : nr('Nothing has been recorded as evidence yet.')),
        detail: sources ? [plural(held.length, 'interview', 'interviews'), plural(confirmed, 'demand signal', 'demand signals'), plural(results, 'experiment result', 'experiment results')].join(', ') : null,
      },
      {
        key: 'supporting', label: 'Supporting', population: 'evidence relationships supporting an open hypothesis (not distinct sources)', window: TO_DATE,
        ...(claims.length ? { value: supporting, reason: null } : nr('No open hypothesis to support.')),
        detail: claims.length ? `across ${plural(claims.length, 'open hypothesis', 'open hypotheses')}` : null,
      },
      {
        key: 'contradicting', label: 'Contradictory', population: 'evidence relationships contradicting an open hypothesis (not distinct sources)', window: TO_DATE,
        ...(claims.length ? { value: contradicting, reason: null } : nr('No open hypothesis to contradict.')),
        detail: claims.length ? `across ${plural(claims.length, 'open hypothesis', 'open hypotheses')}` : null,
      },
      {
        key: 'unknown_fit', label: 'Unknown fit', population: 'held interviews with no customer fit recorded', window: TO_DATE,
        ...(held.length ? { value: held.filter((iv) => !hasFit(iv)).length, of: held.length, reason: null } : nr('No interview has been held yet.')),
        detail: held.length ? `of ${plural(held.length, 'held interview', 'held interviews')}` : null,
      },
      {
        key: 'experiment_results', label: 'Experiment results', population: 'done experiments with an observed result, on open hypotheses', window: TO_DATE,
        ...(done.length ? { value: results, of: done.length, reason: null } : nr('No experiment is done yet.')),
        detail: done.length ? `of ${plural(done.length, 'done experiment', 'done experiments')}` : null,
      },
      {
        key: 'demand_signals', label: 'Demand signals', population: 'demand signals recorded, and paid deposits or pilots in the revenue ledger', window: TO_DATE,
        ...(confirmed + toConfirm ? { value: confirmed + toConfirm, reason: null } : nr('No demand signal has been recorded yet.')),
        detail: confirmed + toConfirm ? `${confirmed} confirmed · ${toConfirm} to confirm` : null,
      },
    ];
    return { figures };
  });
}

export type AttentionItem = { kind: string; state: string; label: string; detail: string; action: string; href: string };
/** V1: Needs attention holds at most four items. */
export const ATTENTION_SHOWN = 4;
/** How far the review queue is walked for its count; past it the label says "or more". */
export const REVIEW_SCAN = 10;

/**
 * Needs attention, most useful first: interviews waiting for review and suggestions waiting (a writer's,
 * since only a writer can act on them), experiments done without a result, hypotheses with mixed
 * evidence, and held interviews with no customer fit. A reader is sent to look, never to a write.
 */
export async function attentionPart(env: Env, projectId: number, writer: boolean, shared: Shared) {
  return part('attention', 'What needs attention', async () => {
    const items: AttentionItem[] = [];
    if (writer) {
      const queue = await reviewQueue(env, projectId, REVIEW_SCAN);
      const first = queue.items[0];
      if (first) {
        const n = queue.items.length;
        items.push({
          kind: 'reviews', state: 'needs_review',
          label: `${queue.more ? `${n} or more interviews` : plural(n, 'interview', 'interviews')} awaiting review`,
          detail: first.headline, action: n === 1 ? 'Review interview' : 'Review interviews',
          href: reviewHref(projectId, first.interviewId, first.sessionId),
        });
      }
      const pending = (await env.DB.prepare(
        `SELECT kind, COALESCE(edited_payload_json, payload_json) AS payload FROM validate_proposals
          WHERE project_id = ? AND run_id IS NOT NULL AND status = 'pending' ORDER BY id`,
      ).bind(projectId).all<{ kind: string; payload: string }>()).results ?? [];
      const placed = pending.flatMap((r) => {
        if (!isPlacementKind(r.kind)) return [];
        try { return [placementSlug(r.kind, JSON.parse(r.payload || '{}'))]; } catch { return []; }
        // A verdict contribution is decision data: no new part carries it (D693).
      }).filter((slug) => slug !== 'verdict');
      if (placed.length) {
        const slug = placed[0];
        const name = MODULES.find((m) => m.slug === slug)?.name ?? slug;
        items.push({
          kind: 'suggestions', state: 'needs_review', label: `${plural(placed.length, 'suggestion', 'suggestions')} waiting`,
          detail: `Eadwyn's suggestions from your interviews, starting in ${name}. Until you accept or discard them, they don't count as evidence.`,
          action: 'Review suggestions', href: moduleHref(projectId, slug),
        });
      }
    }
    const [claims, exps, ivs] = await Promise.all([shared.claims, shared.experiments, shared.interviews]);
    const open = new Map(claims.map((c) => [c.id, c]));
    const noResult = exps.filter((e) => e.status === 'done' && !hasResult(e) && open.has(Number(e.hypothesis_id)))
      .sort((a, b) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')) || a.id - b.id);
    if (noResult.length) {
      const e = noResult[0];
      items.push({
        kind: 'results', state: 'result_needed',
        label: noResult.length === 1 ? `“${e.title}” has no result` : `${noResult.length} done experiments have no result`,
        detail: `Marked done with nothing observed recorded, so ${noResult.length === 1 ? 'it adds' : 'they add'} no evidence.`,
        action: writer ? 'Record the result' : 'Open experiment', href: claimHref(projectId, Number(e.hypothesis_id)),
      });
    }
    // The next-action policy's own test (validateNextAction.ts): open, not decided, both directions.
    const decided = (c: Claim) => c.status === 'supported' || c.status === 'refuted';
    const mixed = claims.filter((c) => !decided(c) && c.supporting > 0 && c.contradicting > 0);
    if (mixed.length) {
      const c = mixed[0];
      items.push({
        kind: 'mixed', state: 'needs_review',
        label: mixed.length === 1 ? `${c.code} has mixed evidence` : `${mixed.length} hypotheses have mixed evidence`,
        detail: `${c.code}: ${plural(c.supporting, 'relationship supports', 'relationships support')} it and ${plural(c.contradicting, 'contradicts', 'contradict')} it.`,
        action: 'Review evidence', href: claimHref(projectId, c.id),
      });
    }
    const unfit = ivs.filter((iv) => isHeld(iv) && !hasFit(iv)).length;
    if (unfit) {
      items.push({
        kind: 'fit', state: 'not_recorded', label: `${plural(unfit, 'held interview has', 'held interviews have')} unknown customer fit`,
        detail: 'Not placed in a segment yet, so it cannot count toward a fit-dependent bar.',
        action: writer ? 'Set fit' : 'Open interviews', href: `${moduleHref(projectId, 'customer-research')}&filter=fit:not_recorded`,
      });
    }
    return { items: items.slice(0, ATTENTION_SHOWN), total: items.length };
  });
}

/** The open hypotheses V1 lists, at most this many; `total` counts them all. */
export const HYPOTHESES_SHOWN = 20;

export async function hypothesesPart(projectId: number, shared: Shared) {
  return part('hypotheses', 'The hypotheses', async () => {
    const [claims, exps] = await Promise.all([shared.claims, shared.experiments]);
    // Newest experiment per hypothesis: the read is newest first.
    const latest = new Map<number, (typeof exps)[number]>();
    for (const e of exps) if (!latest.has(Number(e.hypothesis_id))) latest.set(Number(e.hypothesis_id), e);
    const items = claims.slice(0, HYPOTHESES_SHOWN).map((c) => {
      const e = latest.get(c.id);
      return {
        id: c.id, code: c.code, claim: c.claim, status: c.status,
        supporting: c.supporting, contradicting: c.contradicting,
        // D4586 coverage: distinct interviews behind the claim; null where not recorded on every one.
        sources: c.interviews, interviewees: c.interviewees, organizations: c.organizations,
        sources_label: `${plural(c.interviews, 'interview', 'interviews')} behind ${plural(c.supporting + c.contradicting, 'relationship', 'relationships')}`,
        experiment: e ? { title: e.title, status: e.status, result_recorded: hasResult(e), result_needed: e.status === 'done' && !hasResult(e) } : null,
        href: claimHref(projectId, c.id),
      };
    });
    return { items, total: claims.length, population: 'open hypotheses, in board order', window: TO_DATE };
  });
}

/** The six modules whose activity the feed reads; Verdict's decisions are never in it. */
export const CHANGE_MODULES = MODULES.filter((m) => m.slug !== 'verdict').map((m) => m.slug);
export const CHANGES_SHOWN = 8;

export async function changesPart(env: Env, projectId: number) {
  return part('changes', 'The recent changes', async () => {
    const types = CHANGE_MODULES.map((slug) => `validate.${slug}`);
    const rows = (await env.DB.prepare(
      `SELECT id, entity_type, action, details, created_at FROM activity_logs
        WHERE project_id = ? AND entity_type IN (?, ?, ?, ?, ?, ?)
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(projectId, ...types, CHANGES_SHOWN).all<{ id: number; entity_type: string; action: string; details: string | null; created_at: string }>()).results ?? [];
    const items = rows.map((r) => {
      const slug = r.entity_type.slice('validate.'.length);
      return { at: r.created_at, module: slug, module_name: MODULES.find((m) => m.slug === slug)?.name ?? slug, action: r.action, summary: r.details ?? null };
    });
    return { items, population: 'recorded changes in the six Validate modules (decisions are not listed)', window: `the latest ${CHANGES_SHOWN}` };
  });
}

/** Every part, for the overview read; `writer` gates the items only a writer can act on. */
export async function overviewParts(env: Env, projectId: number, writer: boolean) {
  const shared = sharedReads(env, projectId);
  const [evidence, attention, hypotheses, changes] = await Promise.all([
    evidencePart(shared), attentionPart(env, projectId, writer, shared), hypothesesPart(projectId, shared), changesPart(env, projectId),
  ]);
  return { evidence, attention, hypotheses, changes };
}

