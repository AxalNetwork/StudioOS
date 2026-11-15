/**
 * D6031 (#6031, BD8) — Prototype / MVP's summary line and its phone rows, from
 * the module read (`facts`, and the rows' Test, Built and Tested cells).
 *
 * The summary reads "N of M must-haves complete · target <date> · N blocked",
 * every figure from stored data. A missing date is "Not recorded" and, for a
 * writer (`facts.can_set_target`), offers Set. Facts the read did not send
 * (an unreadable module) give no line at all, never zeros.
 */
import { cellView } from './cycleModel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-18` → `18 Nov 2026`; anything else → null. */
export function targetDay(raw) {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.slice(0, 10)) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** The summary line, or null when the read sent no counts. */
export function mvpSummary(facts) {
  const done = count(facts?.done), total = count(facts?.total), blocked = count(facts?.blocked);
  if (done == null || total == null || blocked == null) return null;
  const target = targetDay(facts?.target_date);
  return {
    done, total, blocked, target,
    complete: `${done} of ${total} must-have${total === 1 ? '' : 's'} complete`,
    targetText: target ? `target ${target}` : 'target Not recorded',
    blockedText: `${blocked} blocked`,
    canSet: facts?.can_set_target === true,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

const DONE = 'Done', BLOCKED = 'Blocked';

/**
 * A must-have as a phone row: its State as the pill, and Due, Test, Built and
 * Tested in its line, so a card carries the same facts as the desktop row.
 */
export function mvpPhoneRow(cols, row) {
  const keys = new Set((Array.isArray(cols) ? cols : []).map((c) => c.key));
  const text = (key) => { const v = cellView(row?.cells?.[key]); return v.text; };
  const title = cellView(row?.cells?.must_have).text;
  const state = cellView(row?.cells?.state);
  const due = cellView(row?.cells?.due);
  const parts = [
    due.nr ? null : `Due ${due.text}`,
    `Test: ${text('test')}`,
    keys.has('built') ? `Built: ${text('built')}` : null,
    `Tested: ${text('tested')}`,
  ].filter(Boolean);
  return {
    title,
    description: parts.join(' · '),
    pill: state.nr ? undefined : { label: state.text, tone: state.text === DONE ? 'ok' : state.text === BLOCKED ? 'danger' : 'neutral' },
  };
}
