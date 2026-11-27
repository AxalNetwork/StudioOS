/**
 * D8728 (#8728) — what Admin Studio's "Needs a decision" card says about the
 * approval queue, from the Approvals Inbox's own read with `age=past`
 * (`GET /api/admin/approvals?age=past`, ⚑1 option A). Studio counts what the
 * Inbox would list at `/admin/approvals?age=past`, so the number on Studio and
 * the rows on the landing come from one read and one criterion: the Worker's
 * `sla = past`, 72 hours (`SLA_PAST_HOURS`).
 *
 * Pure: no React, no fetch. `overdueView(read)` takes the read as the Inbox's
 * `useRead` shapes it (`{ status: 'loading' | 'ready' | 'error', reply }`).
 *
 * Honesty (D5129): a failed read is `unreadable` and never 0 or all clear; a
 * read with a lane that did not answer is `partial` and never all clear; a
 * total the Worker withheld is a floor ("25+"), never short.
 */
import { inboxRows } from './approvals/inboxQueueModel.js';
import { nf } from './approvals/approvalsFormat.js';

/** The landing the overdue count opens: the Inbox filter main already reads (`inboxQueryOf`). */
export const OVERDUE_PATH = '/admin/approvals';
export const OVERDUE_SEARCH = '?age=past';
export const OVERDUE_TO = `${OVERDUE_PATH}${OVERDUE_SEARCH}`;
/** Router state Studio sends, so Approvals draws "Studio › Approvals" only when Studio opened it. */
export const FROM_STUDIO = Object.freeze({ from: '/studio' });
export const fromStudio = (state) => state?.from === FROM_STUDIO.from;

/** A lane line's landing: the same filter plus the lane (canvas SAD12 S5, SAD13 L5). */
export const laneTo = (key) => `${OVERDUE_TO}&lane=${encodeURIComponent(key)}`;

/** The Inbox's words for the same 72 hours (SAD21). */
export const OVERDUE_WORDS = 'overdue · over 72 hours';
export const AGE_CHIP = 'Age: Over 72 hours';

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * `{ state: 'loading' }`, `{ state: 'unreadable' }`, or a ready view:
 *   overdue      exact count, or null when the Worker withheld it
 *   floor        what was read when the count is withheld (shown "n+")
 *   figure       the count as drawn: "1", "25+"
 *   onTime       waiting but under 72 hours, null when not known
 *   oldest       the oldest overdue row (`inboxRows`), or null
 *   lanes        lanes holding overdue items, most first: { key, label, count, oldest }
 *   unreadable   labels of lanes that did not answer
 *   lanesAll     how many lanes the read covered
 *   kind         'overdue' | 'quiet' (0 overdue, some on time) | 'clear' | 'zero' | 'partial-zero'
 */
export function overdueView(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status !== 'ready' || !read.reply || typeof read.reply !== 'object') return { state: 'unreadable' };
  const r = read.reply;
  const rows = inboxRows(r).filter((row) => row.sla === 'past');
  const unreadable = Array.isArray(r.unreadable) ? r.unreadable.filter(Boolean) : [];
  const laneList = Array.isArray(r.lanes) ? r.lanes : [];
  const exact = num(r.total);
  const floor = exact === null ? Math.max(rows.length, num(r.tiles?.at_least?.over_72h) ?? 0) : exact;
  const partial = unreadable.length > 0;
  const figure = exact === null || (partial && exact > 0) ? `${nf(floor)}+` : nf(exact);
  const whole = num(r.unfiltered_total);
  const onTime = exact !== null && whole !== null ? Math.max(0, whole - exact) : null;
  const oldestOf = (key) => rows.find((row) => row.lane === key) || null;
  const lanes = laneList
    .map((l) => ({ key: l.key, label: l.label || l.key, count: num(l.bands?.past) }))
    .filter((l) => l.count && l.count > 0)
    .sort((a, b) => (b.count - a.count) || ((oldestOf(b.key)?.ageHours ?? 0) - (oldestOf(a.key)?.ageHours ?? 0)))
    .map((l) => ({ ...l, oldest: oldestOf(l.key)?.age || null }));
  const any = floor > 0;
  // `zero`: nothing overdue, but how many wait on time was not sent, so the
  // card claims neither "2 waiting" nor "every lane answered".
  const kind = any ? 'overdue'
    : partial ? 'partial-zero'
      : onTime ? 'quiet'
        : onTime === 0 ? 'clear' : 'zero';
  return {
    state: 'ready',
    overdue: exact,
    floor,
    figure,
    onTime,
    oldest: rows[0] || null,
    lanes,
    unreadable,
    lanesAll: laneList.length,
    kind,
  };
}

/** "Partial · 19 of 20 lanes" (SAD12 S3). */
export function partialLabel(view) {
  const n = view.unreadable.length;
  if (!view.lanesAll) return 'Partial';
  return `Partial · ${nf(Math.max(0, view.lanesAll - n))} of ${nf(view.lanesAll)} lanes`;
}

/** "Events could not be read" / "Events and KYC could not be read". */
export function unreadLine(labels) {
  if (!labels.length) return '';
  const names = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `${names} could not be read`;
}

/** "2 more waiting" — the on-time line under the overdue item (SAD01). */
export function onTimeLine(n) {
  if (!n) return null;
  return `${nf(n)} more waiting`;
}

/** The primary action's words: one item or several (SAD01, SAD12 S5). */
export function reviewLabel(view) {
  if (view.lanes.length > 1 && view.overdue) return `Review ${nf(view.overdue)} overdue in Approvals`;
  return 'Review overdue in Approvals';
}

/** Who holds the oldest item, in the Inbox's words ("Unassigned" is never a guess). */
export function ownerText(row) {
  if (!row) return null;
  if (row.assignee.kind === 'none') return { text: 'Unassigned', sub: 'No one holds it yet' };
  if (row.assignee.kind === 'person') return { text: row.assignee.text, sub: null };
  return { text: 'Owner not read', sub: null };
}

/* ------------------------------------------------------------------ return */

/**
 * SAD04: Back, the crumb or "‹ Studio" restores Studio's scroll and puts focus
 * on the control that left it. Studio notes both on the way out; the card
 * takes the note once it has drawn. Per tab (sessionStorage), and every access
 * is guarded: a blocked store only loses the restore, never the page.
 */
export const RETURN_KEY = 'axal:studio-return';
const RETURN_TTL_MS = 30 * 60 * 1000;

export function rememberStudioExit(target, { scrollY = 0, now = Date.now(), store = globalThis.sessionStorage } = {}) {
  try {
    store?.setItem(RETURN_KEY, JSON.stringify({ target, y: Math.max(0, Math.round(Number(scrollY) || 0)), at: now }));
  } catch { /* storage blocked: Studio simply opens at the top */ }
}

/** The note, once; null when there is none, it is stale, or the store is blocked. */
export function takeStudioExit({ now = Date.now(), store = globalThis.sessionStorage } = {}) {
  try {
    const raw = store?.getItem(RETURN_KEY);
    if (!raw) return null;
    store.removeItem(RETURN_KEY);
    const v = JSON.parse(raw);
    if (!v || typeof v.target !== 'string' || !(now - Number(v.at) < RETURN_TTL_MS)) return null;
    return { target: v.target, y: Math.max(0, Number(v.y) || 0) };
  } catch {
    return null;
  }
}
