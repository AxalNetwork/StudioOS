/**
 * D4813 (#4813, package 4) — pure decisions for one founder's detail (board
 * C4): the `?detail=` parameter, the read and its refusal, the four-week
 * timeline with the live status kept apart from the Lab's recorded decision,
 * the deliverable counts, guidance, sessions and recorded activity.
 *
 * The Worker decides who is visible (`GET /me/cohort/:id/founders/:userId`).
 * A founder who is not in the cohort, or who stopped sharing with this
 * advisor, is the same 404 there and the same sentence here, so the page
 * never says which.
 */
import { dayTime, shortDate } from './cohortModel.js';

export const DETAIL_PARAM = 'detail';

/** The six sections, in the canvas's order. Each is a labelled region with its own heading. */
export const DETAIL_SECTIONS = Object.freeze([
  ['overview', 'Overview'],
  ['milestones', 'Milestones'],
  ['evidence', 'Evidence'],
  ['guidance', 'Guidance'],
  ['sessions', 'Sessions'],
  ['activity', 'Activity'],
]);

/** `?detail=` is a positive whole number or nothing. */
export function parseDetailParam(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,11}$/.test(raw)) return null;
  return Number(raw);
}

export const NOT_VISIBLE = 'This founder is not visible to you. They are not in this cohort, or they stopped sharing their progress with you. Nothing about them is shown.';

/**
 * The read, with the refusal turned into a state rather than an error: a 404
 * is a boundary (the founder is not visible), not a failed read to retry.
 */
export async function fetchFounderDetail(fetcher, cycleId, userId) {
  try {
    return await fetcher(cycleId, userId);
  } catch (e) {
    if (e?.status === 404) return { not_visible: true };
    throw e;
  }
}

const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : NaN; };
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** The live status in words and a shape (never colour alone). */
export const LIVE_STATES = Object.freeze({
  passed: { label: 'Passed', glyph: '✓', tone: 'ok' },
  failed: { label: 'Failed', glyph: '✕', tone: 'danger' },
  grace: { label: 'Grace', glyph: '◐', tone: 'warn' },
  in_progress: { label: 'In progress', glyph: '◷', tone: 'info' },
  not_assessed: { label: 'Not assessed', glyph: '○', tone: 'neutral' },
  not_open: { label: 'Not open', glyph: '·', tone: 'neutral' },
});

function liveState(week, now) {
  const s = week.live?.status;
  if (s === 'passed' || s === 'failed' || s === 'grace') return s;
  const opens = ms(week.unlock_at);
  if (Number.isFinite(opens) && opens > now) return 'not_open';
  if (s === 'pending') return 'in_progress';
  return 'not_assessed';
}

function deliverablesText(live) {
  if (!live) return 'No week record from the Lab';
  const done = count(live.deliverables_done);
  const req = count(live.deliverables_required);
  if (req == null || done == null) return 'Deliverables not recorded';
  if (req === 0) return 'No deliverable is required';
  return `${done} of ${req} deliverables`;
}

function recordedText(rec) {
  if (!rec) return null;
  const parts = [];
  if (rec.decided_at) parts.push(`Decided ${dayTime(rec.decided_at)} by the Lab`);
  if (rec.decision_reason) parts.push(rec.decision_reason);
  if (rec.grace_until) parts.push(`Grace until ${dayTime(rec.grace_until)}`);
  if (rec.grace_reason) parts.push(`Grace reason: ${rec.grace_reason}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * One row per week: the live status (what the Lab's row says now) and the
 * recorded decision (when and why the Lab decided, any grace) as two separate
 * fields. A week the Lab has not decided says so; a deadline snapshot is not
 * stored and reads Not recorded on every week.
 */
export function milestoneRows(milestones, now = Date.now()) {
  if (!milestones || milestones.available === false) return null;
  return (milestones.weeks || []).map((w) => {
    const state = liveState(w, now);
    return {
      week: w.week_number,
      title: `Week ${w.week_number}`,
      window: w.unlock_at || w.deadline_at
        ? `${shortDate(w.unlock_at) || 'Not recorded'} – ${dayTime(w.deadline_at) || 'Not recorded'}`
        : 'Week window not recorded',
      current: Number(milestones.current_week) === Number(w.week_number),
      live: { state, ...LIVE_STATES[state], deliverables: deliverablesText(w.live) },
      recorded: recordedText(w.recorded) || 'No decision recorded yet',
      decided: Boolean(w.recorded),
      snapshot: 'Not recorded',
    };
  });
}

/** Deliverables as the Lab records them: a count per week, never the items. */
export function evidenceRows(milestones) {
  if (!milestones || milestones.available === false) return null;
  return (milestones.weeks || []).filter((w) => w.live).map((w) => ({
    week: w.week_number,
    text: deliverablesText(w.live),
  }));
}

const SESSION_STATUS = {
  pending: 'Requested',
  confirmed: 'Booked',
  completed: 'Held',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export function sessionRows(sessions, now = Date.now()) {
  if (!sessions || sessions.available === false) return null;
  return (sessions.items || []).map((s) => ({
    uid: s.uid,
    when: dayTime(s.starts_at) || 'Time not recorded',
    topic: s.topic || 'No topic recorded',
    status: SESSION_STATUS[s.status] || 'Status not recorded',
    upcoming: ms(s.starts_at) > now,
  }));
}

export function guidanceRows(guidance) {
  if (!guidance || guidance.available === false) return null;
  return (guidance.items || []).map((g) => ({
    uid: g.uid,
    kind: g.kind,
    title: g.kind === 'question' ? 'Their question to you' : (g.title || (g.body || '').split('\n')[0].slice(0, 80) || 'Untitled guidance'),
    body: g.body,
    week: g.week_number == null ? 'General' : `Week ${g.week_number}`,
    when: dayTime(g.posted_at),
    retired: Boolean(g.retired_at),
    answer: g.answer || null,
    unanswered: g.kind === 'question' && !g.answer,
    acted: g.acted_at ? `Acted on ${dayTime(g.acted_at)}` : null,
  }));
}

const ACTIVITY_LABEL = {
  question_asked: 'Asked you a question',
  guidance_acted_on: 'Acted on your guidance',
  session_booked: 'Booked a session with you',
};

export function activityRows(activity) {
  if (!activity) return [];
  return (activity.items || []).map((a, i) => ({
    key: `${a.ref}-${i}`,
    label: ACTIVITY_LABEL[a.kind] || 'Recorded action',
    when: dayTime(a.at) || 'Date not recorded',
  }));
}

/** The header line: the week now, and its live state. */
export function overviewOf(data, now = Date.now()) {
  const rows = milestoneRows(data?.milestones, now) || [];
  const current = rows.find((r) => r.current) || null;
  const failed = rows.find((r) => r.live.state === 'failed') || null;
  return {
    current,
    held: failed ? `Held at week ${failed.week}` : null,
    unanswered: (guidanceRows(data?.guidance) || []).filter((g) => g.unanswered).length,
    upcoming: (sessionRows(data?.sessions, now) || []).filter((s) => s.upcoming).length,
  };
}
