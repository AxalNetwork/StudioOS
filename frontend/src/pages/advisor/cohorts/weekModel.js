/**
 * D4813 (#4813, package 3) — This week (board C7), with no React in it.
 *
 * The week as the Lab recorded it: which week, its dates in a named zone, the
 * deadline and the days left, and each founder's required deliverables in an
 * explicit status. Then what is the ADVISOR's to do, kept apart from what is
 * the founders'.
 *
 * NEVER INFER SUCCESS FROM MISSING DATA. A founder with no week record is Not
 * yet assessed, not Complete; a week the Lab has not decided is not passed
 * because the counts look full. Complete means the Lab recorded the week
 * passed, and nothing else does.
 *
 * The statuses, from `company_week_status` for the current week:
 *   · Complete      — the Lab recorded the week `passed`;
 *   · Failed        — recorded `failed` (or an earlier week failed: the Lab
 *                     holds the founder there);
 *   · Grace         — recorded `grace`, with its until and reason;
 *   · In progress   — `pending` before the deadline, counts readable;
 *   · Missing       — `pending` after the deadline with deliverables
 *                     outstanding and no decision recorded;
 *   · Not yet assessed — no row, unreadable counts, or every deliverable in
 *                     but the Lab has not decided.
 */

import { withCohort } from './cohortModel';
import { LAB_TZ, clockTime, dayKey, dayTitle, isCurrentOrFuture } from './calendarModel';

const ms = (iso) => {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Each status in words and a shape, never colour alone. */
export const DELIVERABLE_STATES = {
  complete: { label: 'Complete', glyph: '✓', tone: 'ok', attention: false },
  in_progress: { label: 'In progress', glyph: '◷', tone: 'info', attention: false },
  missing: { label: 'Missing', glyph: '!', tone: 'danger', attention: true },
  grace: { label: 'Grace', glyph: '◐', tone: 'warn', attention: true },
  failed: { label: 'Failed', glyph: '✕', tone: 'danger', attention: true },
  not_assessed: { label: 'Not yet assessed', glyph: '○', tone: 'neutral', attention: false },
};

/**
 * One founder's deliverable status for week `n`. `rows` is the founder's
 * `weeks` map from `/weeks` (or undefined), `window` that week's window.
 */
export function deliverableStatus(rows, n, window, now = Date.now()) {
  const rec = rows || {};
  const earlier = Object.keys(rec).map(Number).filter((w) => w < n && rec[w]?.status === 'failed').sort((a, b) => a - b)[0];
  if (earlier != null) {
    return { status: 'failed', done: null, required: null, held: earlier, reason: `Held at week ${earlier}: the Lab recorded it failed` };
  }
  const r = rec[n];
  if (!r) return { status: 'not_assessed', done: null, required: null, reason: `The Lab has no week ${n} record for this founder` };
  const done = num(r.deliverables_done);
  const required = num(r.deliverables_required);
  const counts = required != null && required > 0 && done != null ? `${done} of ${required} deliverables` : null;
  if (r.status === 'passed') return { status: 'complete', done, required, reason: `The Lab recorded week ${n} passed` };
  if (r.status === 'failed') {
    return { status: 'failed', done, required, reason: `Week ${n} failed${counts ? `: ${counts}` : ''}${r.decision_reason ? ` — ${r.decision_reason}` : ''}` };
  }
  if (r.status === 'grace') {
    return {
      status: 'grace', done, required, until: r.grace_until || null,
      reason: `In grace${r.grace_until ? ` until ${dayTitle(dayKey(r.grace_until))} ${clockTime(r.grace_until)}` : ''}${counts ? ` — ${counts}` : ''}${r.grace_reason ? ` (${r.grace_reason})` : ''}`,
    };
  }
  if (counts == null) return { status: 'not_assessed', done, required, reason: `Week ${n} progress could not be read` };
  const deadline = ms(window?.deadline_at);
  const past = Number.isFinite(deadline) && deadline <= now;
  if (done >= required) {
    return { status: 'not_assessed', done, required, reason: `All ${required} deliverables in; the Lab has not decided week ${n}` };
  }
  if (past) return { status: 'missing', done, required, reason: `${counts} at the deadline, and no decision recorded` };
  return { status: 'in_progress', done, required, reason: counts };
}

/**
 * The whole C7 header and the deliverables table.
 *
 * `weeks` is the `/weeks` payload; `roster` the founders read (`null` when it
 * failed — the week record's own founders are used and the page says so).
 * Returns `{ ready: false, reason }` when there is no week to describe.
 */
export function thisWeek({ weeks, roster, cycleId, now = Date.now() }) {
  if (!weeks || weeks.available === false) return { ready: false, reason: 'The Lab’s week record could not be read.' };
  if (!weeks.windows_recorded) {
    return { ready: false, reason: 'This cycle has no week windows recorded, so which week it is in cannot be derived. It is not week one by default.' };
  }
  const n = weeks.current_week;
  const total = Array.isArray(weeks.weeks) ? weeks.weeks.length : 0;
  if (n == null) return { ready: false, reason: 'No week of this cohort has opened yet.', total };
  const window = (weeks.weeks || []).find((w) => Number(w.week_number) === Number(n)) || null;
  const byUser = new Map((weeks.founders || []).map((f) => [Number(f.user_id), f]));
  const people = Array.isArray(roster)
    ? roster.map((f) => ({ user_id: f.user_id, name: f.name || null }))
    : (weeks.founders || []).map((f) => ({ user_id: f.user_id, name: f.name || null }));
  const rows = people.map((p) => {
    const s = deliverableStatus(byUser.get(Number(p.user_id))?.weeks, Number(n), window, now);
    return { ...p, ...s, meta: DELIVERABLE_STATES[s.status], href: withCohort('/cohorts/founders', cycleId, { founder: p.user_id }) };
  });
  const tally = {};
  for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1;
  const readable = rows.filter((r) => r.required != null && r.required > 0 && r.done != null);
  const deadline = ms(window?.deadline_at);
  const left = Number.isFinite(deadline) ? deadline - now : null;
  return {
    ready: true,
    week: Number(n),
    total,
    timezone: LAB_TZ,
    range: window ? `${dayTitle(dayKey(window.unlock_at))} – ${dayTitle(dayKey(window.deadline_at))}` : null,
    deadline: window?.deadline_at || null,
    deadlineLabel: window ? `${dayTitle(dayKey(window.deadline_at))} ${clockTime(window.deadline_at)}` : null,
    daysRemaining: left == null ? null : left <= 0 ? 0 : Math.ceil(left / 86_400_000),
    deadlinePassed: left != null && left <= 0,
    rows: rows.sort((a, b) => Number(!a.meta.attention) - Number(!b.meta.attention) || String(a.name || '').localeCompare(String(b.name || ''))),
    tally,
    complete: tally.complete || 0,
    // Deliverables counted only where the Lab's counts are readable; the rest
    // are named as not counted rather than added as zero.
    deliverables: readable.length
      ? { done: readable.reduce((t, r) => t + Math.min(r.done, r.required), 0), required: readable.reduce((t, r) => t + r.required, 0), uncounted: rows.length - readable.length }
      : null,
    attention: rows.filter((r) => r.meta.attention),
    rosterFromWeeks: !Array.isArray(roster),
  };
}

/** "1 failed · 1 grace · 1 missing", in the order the advisor looks. */
export function attentionLine(tally) {
  return ['failed', 'grace', 'missing']
    .filter((k) => tally?.[k])
    .map((k) => `${tally[k]} ${DELIVERABLE_STATES[k].label.toLowerCase()}`)
    .join(' · ');
}

/** Booked and group sessions in [from, to), ongoing included. */
export function sessionsBetween(events, from, to, now = Date.now()) {
  const a = ms(from);
  const b = ms(to);
  return (events || []).filter((e) => {
    if (e.kind !== 'client') return false;
    const s = ms(e.starts_at);
    return Number.isFinite(s) && (!Number.isFinite(a) || s >= a || isCurrentOrFuture(e, now)) && (!Number.isFinite(b) || s < b);
  });
}

/**
 * What is the advisor's to do this week, from what the product records:
 * unanswered founder questions and the sessions they hold. No session brief is
 * stored, so a session is listed as held, never as "no notes prepared".
 */
export function advisorActions({ guidance, sessions, cycleId, now = Date.now() }) {
  const out = [];
  for (const g of (guidance?.items || []).filter((x) => x.kind === 'question' && !x.answer && !x.retired_at)
    .sort((a, b) => ms(a.posted_at) - ms(b.posted_at))) {
    const text = String(g.body || '').trim();
    out.push({
      key: `q:${g.uid}`, kind: 'question', label: 'Answer a founder’s question',
      detail: text.length > 100 ? `“${text.slice(0, 99)}…”` : `“${text}”`,
      when: g.posted_at ? `Asked ${dayTitle(dayKey(g.posted_at))}` : null,
      to: withCohort('/cohorts/guidance', cycleId),
    });
  }
  for (const s of sessions || []) {
    const ended = s.ends_at && ms(s.ends_at) <= now;
    if (ended) continue;
    out.push({
      key: `s:${s.ref}`, kind: 'session', label: s.ongoing ? `In progress: ${s.title}` : `Hold ${s.title}`,
      detail: `${dayTitle(dayKey(s.starts_at))} ${clockTime(s.starts_at)}${s.ends_at ? `–${clockTime(s.ends_at)}` : ''}`,
      when: null,
      to: withCohort('/cohorts/calendar', cycleId),
    });
  }
  return out;
}

/** The newest guidance you posted, for the Guidance & communication block. Read only. */
export function recentGuidance(guidance, limit = 3) {
  if (!guidance) return null;
  return (guidance.items || [])
    // A draft is not posted (package 2): it is not recent guidance.
    .filter((g) => g.kind !== 'question' && !g.retired_at && !g.is_draft)
    .sort((a, b) => ms(b.posted_at) - ms(a.posted_at))
    .slice(0, limit);
}
