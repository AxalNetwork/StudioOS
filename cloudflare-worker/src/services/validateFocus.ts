/**
 * D685 §5.12 (#1584) — what Validate's overview leads with on a phone: one
 * focus, the interviews meter, and the index counts. Read with the overview
 * (`routes/cycle_validate.ts`); nothing here is stored but the target.
 *
 * THE FOCUS is the first rule that holds:
 *   1. the venture has no interview: record the first conversation;
 *   2. the newest session needs review (transcribed, or structured with
 *      pending placements) and the caller can write: review it. The why line
 *      counts what its placements would move, in pain themes (phrases resolved
 *      through the pain-group model, so two wordings of one theme count once)
 *      and hypotheses, never in placements;
 *   3. otherwise the first card's own `next`.
 *
 * THE METER is interviews this month against `metric_targets` key
 * `interviews_month_target`; with no target it carries the count and no bar.
 */
import type { Env } from '../types';
import type { Card, Figure } from './cycleCards';
import { loadPainGroupModel, normPhrase, resolvePhrase } from './painGroups';
import { INTERVIEWS_TARGET_KEY } from './validateWriters';

export interface Focus {
  rule: 'first_interview' | 'review' | 'card';
  eyebrow: string;
  headline: string;
  why: string | null;
  cta: { label: string; href: string } | null;
  then: string | null;
}

const recordHref = (projectId: number) => `/validate/record?project=${projectId}`;
const dayMonth = (v: string | null) => {
  const d = v ? new Date(String(v).replace(' ', 'T') + (String(v).length > 10 && !/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? 'Z' : '')) : null;
  return d && !Number.isNaN(d.valueOf()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null;
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

export async function focusOf(env: Env, projectId: number, canWriteVenture: boolean, cards: Card[]): Promise<Focus> {
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
  const first = cards.find((c) => c.next?.text) ?? null;
  return {
    rule: 'card', eyebrow: 'Validate · Next',
    headline: first ? `${first.next!.text}.`.replace(/\.\.$/, '.') : 'Record a session.',
    why: first?.caption || first?.reason || null,
    cta: first ? { label: first.next!.text, href: first.next!.href } : { label: 'Record a session', href: recordHref(projectId) },
    then: null,
  };
}

/** Interviews this month against the stored target. Null count when the figure is unreadable. */
export async function meterOf(env: Env, projectId: number, figures: Figure[]) {
  const fig = figures.find((f) => f.key === 'interviews_this_month');
  const count = fig?.state === 'ok' ? Number(fig.value) : fig?.state === 'empty' ? 0 : null;
  const t = await env.DB.prepare('SELECT target_value FROM metric_targets WHERE project_id = ? AND metric_key = ?')
    .bind(projectId, INTERVIEWS_TARGET_KEY).first<{ target_value: number }>();
  const target = t?.target_value != null ? Number(t.target_value) : null;
  return { key: 'interviews_this_month', label: 'Interviews this month', count, target, target_reason: target == null ? 'No target set' : null };
}

/** The index's two Worker counts: every interview, and those booked now. */
export async function indexCountsOf(env: Env, projectId: number) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN stage = 'booked' THEN 1 ELSE 0 END) AS booked
       FROM discovery_interviews WHERE project_id = ?`,
  ).bind(projectId).first<{ total: number; booked: number | null }>();
  return { interviews_total: Number(row?.total ?? 0), booked: Number(row?.booked ?? 0) };
}
