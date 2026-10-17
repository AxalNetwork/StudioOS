/**
 * D685 §5.12 (#1584), D692 (#1701) — what Validate's overview leads with on a
 * phone: one focus, the interviews meter, and the index rows. Read with the
 * overview (`routes/cycle_validate.ts`); nothing here is stored but the
 * target. The shapes and the shared helpers are `services/cycleFocus.ts`.
 *
 * THE FOCUS is the first rule that holds:
 *   1. the venture has no interview: record the first conversation;
 *   2. the newest session needs review (transcribed, or structured with
 *      pending placements) and the caller can write: review it. The why line
 *      counts what its placements would move, in pain themes (phrases resolved
 *      through the pain-group model, so two wordings of one theme count once)
 *      and hypotheses, never in placements;
 *   3. the caller can write: record the next customer conversation, with the
 *      meter's count in the why and the first other card's `next` as Then;
 *   4. anyone else: the first card's own `next`, or no focus. A reader who
 *      cannot write is never sent to a write.
 *
 * THE METER is interviews this month against `metric_targets` key
 * `interviews_month_target`; with no target it carries the count and no bar.
 *
 * THE INDEX is the canvas's seven rows, each a stored value or Not recorded.
 * The Verdict row is added only for a decision reader (`canReadDecision`),
 * and its query runs only then: partners read the board, never the decision.
 */
import type { Env, User } from '../types';
import type { Card, Figure } from './cycleCards';
import { loadPainGroupModel, normPhrase, resolvePhrase } from './painGroups';
import { INTERVIEWS_TARGET_KEY } from './validateWriters';
import { canReadDecision, type ProjectRef } from '../routes/_founder_validate_helpers';
import { currentDecision } from './verdict';
import {
  cardFocus, dayMonth, plural, sentence, usdShort, UNREADABLE,
  type Focus, type IndexRow, type Meter,
} from './cycleFocus';

export type { Focus };

const recordHref = (projectId: number) => `/validate/record?project=${projectId}`;

/** What a session's pending placements would move: distinct themes and hypotheses. */
export async function pendingMoves(env: Env, projectId: number, sessionId: number) {
  const rows = await env.DB.prepare(
    `SELECT kind, COALESCE(edited_payload_json, payload_json) AS payload FROM validate_proposals
      WHERE project_id = ? AND session_id = ? AND status = 'pending' AND run_id IS NOT NULL`,
  ).bind(projectId, sessionId).all<{ kind: string; payload: string }>();
  const list = rows.results || [];
  if (!list.length) return { placements: 0, themes: 0, hypotheses: 0 };
  const model = await loadPainGroupModel(env, projectId);
  const themes = new Set<string>();
  const hypotheses = new Set<number>();
  for (const r of list) {
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(r.payload || '{}'); } catch { continue; }
    if (r.kind === 'pain_severity' && typeof p.phrase === 'string' && normPhrase(p.phrase)) {
      themes.add(resolvePhrase(normPhrase(p.phrase), p.phrase, model).key);
    }
    if (r.kind === 'evidence') {
      if (Number.isSafeInteger(p.hypothesis_id)) hypotheses.add(Number(p.hypothesis_id));
      if (Number.isSafeInteger(p.pain_group_id)) themes.add(`g:${p.pain_group_id}`);
    }
  }
  return { placements: list.length, themes: themes.size, hypotheses: hypotheses.size };
}

export async function focusOf(
  env: Env, projectId: number, canWriteVenture: boolean, cards: Card[], figures: Figure[] = [], meter?: Meter | null,
): Promise<Focus | null> {
  const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?')
    .bind(projectId).first<{ n: number }>();
  if (Number(any?.n ?? 0) === 0) {
    return {
      rule: 'first_interview', eyebrow: 'Validate · Next', headline: 'Record your first conversation.',
      why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
      cta: { label: 'Record a session', href: recordHref(projectId) },
      then: 'Write the claim you most need to be true.',
    };
  }
  if (canWriteVenture) {
    const s = await env.DB.prepare(
      `SELECT s.id, s.interview_id, s.status, COALESCE(s.stopped_at, s.updated_at, s.created_at) AS at, i.interviewee_name
         FROM interview_sessions s JOIN discovery_interviews i ON i.id = s.interview_id
        WHERE s.project_id = ? ORDER BY s.id DESC LIMIT 1`,
    ).bind(projectId).first<{ id: number; interview_id: number; status: string; at: string | null; interviewee_name: string | null }>();
    if (s && (s.status === 'transcribed' || s.status === 'structured')) {
      const moves = s.status === 'structured' ? await pendingMoves(env, projectId, s.id) : null;
      if (s.status === 'transcribed' || (moves && moves.placements > 0)) {
        const who = s.interviewee_name?.trim() || 'your interviewee';
        const when = dayMonth(s.at);
        const parts = moves ? [moves.themes && plural(moves.themes, 'pain theme', 'pain themes'), moves.hypotheses && plural(moves.hypotheses, 'hypothesis', 'hypotheses')].filter(Boolean) : [];
        return {
          rule: 'review', eyebrow: 'Validate · Next',
          headline: `Review the interview with ${who}${when ? ` from ${when}` : ''}.`,
          why: s.status === 'transcribed' ? 'It is transcribed but not yet placed.'
            : parts.length ? `Its findings would move ${parts.join(' and ')}.` : 'Its findings are waiting for you to accept or discard them.',
          // D704 decision 9: the interview's record, opened on this session.
          cta: { label: 'Review the interview', href: `/validate/customer-research/${s.interview_id}?session=${s.id}` },
          then: null,
        };
      }
    }
  }
  if (!canWriteVenture) return cardFocus('validate', cards);

  // Rule 3: a writer records the next conversation. The why's count and
  // target are the meter's, read once, so the two never disagree.
  const m = meter === undefined ? await meterOf(env, projectId, figures) : meter;
  const count = m?.count;
  const tail = count == null ? ''
    : m!.target != null ? ` You are at ${count} of ${m!.target} this month.`
      : ` Interviews this month: ${count}.`;
  // Then: the first other card's next. Customer research's ("Log <n> more
  // interviews") would only repeat the CTA.
  const other = cards.find((c) => c.slug !== 'customer-research' && c.next?.text);
  return {
    rule: 'next_interview', eyebrow: 'Validate · Next', headline: 'Record your next customer conversation.',
    why: `Every interview feeds the pain themes, the hypotheses and the verdict.${tail}`,
    cta: { label: 'Record a session', href: recordHref(projectId) },
    then: other ? sentence(other.next!.text) || null : null,
  };
}

/** Interviews this month against the stored target. Null count when the figure is unreadable. */
export async function meterOf(env: Env, projectId: number, figures: Figure[]): Promise<Meter> {
  const fig = figures.find((f) => f.key === 'interviews_this_month');
  const count = fig?.state === 'ok' ? Number(fig.value) : fig?.state === 'empty' ? 0 : null;
  const t = await env.DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
    .bind(projectId, INTERVIEWS_TARGET_KEY).first<{ target_value: number }>();
  const target = t?.target_value != null ? Number(t.target_value) : null;
  return {
    key: 'interviews_this_month', label: 'Interviews this month', count, target,
    target_reason: target == null ? 'No target set' : null,
    display: count == null ? null : target != null ? `${count} of ${target}` : String(count),
  };
}

/** Customer research's two counts: every interview, and those booked now. */
export async function indexCountsOf(env: Env, projectId: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN stage = 'booked' THEN 1 ELSE 0 END) AS booked
       FROM discovery_interviews WHERE project_id = ?`,
  ).bind(projectId).first<{ total: number; booked: number | null }>();
  return { interviews_total: Number(row?.total ?? 0), booked: Number(row?.booked ?? 0) };
}

const DECISION_WORD: Record<string, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };

/**
 * The index: the canvas's rows in its order, each with a stored value or Not
 * recorded (value null) and a neutral detail. No Interviews row.
 */
export async function indexOf(env: Env, project: ProjectRef, user: User, figures: Figure[], cards: Card[]): Promise<IndexRow[]> {
  const pid = Number(project.id);
  const href = (slug: string) => `/validate/${slug}?project=${pid}`;
  const fig = (key: string) => figures.find((f) => f.key === key);
  const card = (slug: string) => cards.find((c) => c.slug === slug);
  const rows: IndexRow[] = [];

  const themes = fig('pain_themes');
  if (themes?.state === 'ok' && themes.value != null) {
    const k = Number(themes.delta_30d ?? 0);
    rows.push({ key: 'problem-discovery', title: 'Problem discovery', detail: `${plural(Number(themes.value), 'pain theme', 'pain themes')}${k > 0 ? ` · ${k} new` : ''}`, value: '', href: href('problem-discovery') });
  } else {
    rows.push({ key: 'problem-discovery', title: 'Problem discovery', detail: 'Pain themes', value: themes?.state === 'unreadable' ? UNREADABLE : null, href: href('problem-discovery') });
  }

  let counts: { interviews_total: number; booked: number } | null = null;
  let countsFailed = false;
  try { counts = await indexCountsOf(env, pid); } catch { countsFailed = true; }
  rows.push(counts && counts.interviews_total > 0
    ? { key: 'customer-research', title: 'Customer research', detail: `Recruiting · ${counts.booked} booked`, value: '', href: href('customer-research') }
    : { key: 'customer-research', title: 'Customer research', detail: 'Recruiting', value: countsFailed ? UNREADABLE : null, href: href('customer-research') });

  const icp = card('ideal-customer-profile');
  const segs = (icp?.state === 'ok' || icp?.state === 'too_little') && Array.isArray((icp.series as any)?.segments) ? (icp.series as any).segments.length : null;
  rows.push(segs != null && segs > 0
    ? { key: 'ideal-customer-profile', title: 'Ideal customer profile', detail: plural(segs, 'segment', 'segments'), value: '', href: href('ideal-customer-profile') }
    : { key: 'ideal-customer-profile', title: 'Ideal customer profile', detail: 'Segments', value: icp?.state === 'unreadable' ? UNREADABLE : null, href: href('ideal-customer-profile') });

  const market = card('market-intelligence');
  const sam = market?.state === 'ok' ? usdShort((market.series as any)?.sam?.value) : null;
  rows.push({ key: 'market-intelligence', title: 'Market intelligence', detail: 'Total, serviceable, obtainable', value: market?.state === 'unreadable' ? UNREADABLE : sam, href: href('market-intelligence') });

  const demand = card('demand-signals');
  const bar = (demand?.state === 'ok' || demand?.state === 'too_little') ? (demand.series as any)?.bar : null;
  rows.push(typeof bar === 'number' && Number.isFinite(bar)
    ? { key: 'demand-signals', title: 'Demand and urgency signals', detail: `Waitlist against the bar of ${bar}`, value: '', href: href('demand-signals') }
    : { key: 'demand-signals', title: 'Demand and urgency signals', detail: 'Waitlist against the bar', value: demand?.state === 'unreadable' ? UNREADABLE : null, href: href('demand-signals') });

  const hyp = fig('hypotheses_supported');
  rows.push({
    key: 'experiments', title: 'Experiments and evidence', detail: 'Hypotheses supported',
    value: hyp?.state === 'unreadable' ? UNREADABLE
      : hyp?.state === 'ok' && hyp.value != null && /^of \d+$/.test(String(hyp.unit)) ? `${hyp.value} ${hyp.unit}` : null,
    href: href('experiments'),
  });

  // Partners read the board, never the decision: the row, and its query, exist
  // only for a decision reader.
  if (canReadDecision(project, user)) {
    let value: string | null = null;
    let detail = 'Proceed, pivot or stop';
    try {
      // The venture's current given decision, through D693's one reader.
      const d = await currentDecision(env, pid, 'venture');
      if (d && DECISION_WORD[d.decision]) {
        const when = dayMonth(d.decided_at);
        detail = when ? `${DECISION_WORD[d.decision]} · ${when}` : DECISION_WORD[d.decision];
        value = '';
      }
    } catch (e) {
      console.warn('[validateFocus] decision unreadable:', (e as Error)?.message);
      value = UNREADABLE;
    }
    rows.push({ key: 'verdict', title: 'Verdict', detail, value, href: `/validate/verdict?project=${pid}` });
  }
  return rows;
}

