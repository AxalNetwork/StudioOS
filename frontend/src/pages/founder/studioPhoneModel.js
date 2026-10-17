/**
 * D701 (#1663) — the founder's Studio, read from its URL. Pure: no React, no
 * fetch, so a Node test imports it as it is.
 *
 * THE TAB LIVES IN THE URL, AT EVERY WIDTH (decision 3). `?tab=tasks` opens
 * Tasks and `?tab=tickets` opens My tickets; no `tab`, `?tab=conversations`
 * and any other value open Conversation. The ids are `PANEL_TABS`'s
 * (`components/advisor/EadwynPanels.jsx`).
 *
 * OPEN A TICKET IS A ROUTE, `/studio/tickets/new` (decision 4). `?type=` picks
 * the form's type only when it is one the form offers; anything else opens it
 * with no type, as D544 and D606 require.
 *
 * `project_id` FOLLOWS EVERY STUDIO LINK THIS TASK WRITES (decision 3). It
 * picks the venture the page reads, so a founder with several ventures keeps
 * theirs through the tabs and the ticket card.
 *
 * EVERY STORED TIME IS UTC (decision 10). `datetime('now')` and
 * `CURRENT_TIMESTAMP` write `YYYY-MM-DD HH:MM:SS` with no zone, so each goes
 * through `toUtcInstant` before it is compared or formatted. "Today" and every
 * date are then the viewer's local day. Month names are written out rather
 * than left to `Intl`, whose en-GB September is "Sept" on current ICU.
 */
import { toUtcInstant } from '../../lib/notices.js';

export const STUDIO_PATH = '/studio';
export const STUDIO_TICKET_PATH = '/studio/tickets/new';

const TABS = { tasks: 'tasks', tickets: 'tickets' };
const TICKET_TYPES = ['task', 'bug', 'feature'];

const paramsOf = (search) => new URLSearchParams(typeof search === 'string' ? search : '');

/** `'conversation'`, `'tasks'` or `'tickets'`. */
export function studioTabOf(search) {
  return TABS[paramsOf(search).get('tab')] || 'conversation';
}

/** `'task'`, `'bug'`, `'feature'` or null. */
export function ticketTypeOf(search) {
  const type = paramsOf(search).get('type');
  return TICKET_TYPES.includes(type) ? type : null;
}

/**
 * `to` with `search`'s `project_id` added after `to`'s own query, or `to`
 * unchanged when `search` has none. Nothing else in `search` is carried.
 */
export function withProjectId(to, search) {
  const projectId = paramsOf(search).get('project_id');
  if (!projectId) return to;
  const [path, query = ''] = String(to).split('?');
  const params = new URLSearchParams(query);
  params.set('project_id', projectId);
  return `${path}?${params.toString()}`;
}

/**
 * The search a tab change writes: `search` with `?tab=` set, or removed for
 * Conversation, and every other parameter kept, `project_id` among them.
 */
export function searchWithTab(search, tab) {
  const params = paramsOf(search);
  if (TABS[tab]) params.set('tab', tab);
  else params.delete('tab');
  const next = params.toString();
  return next ? `?${next}` : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored time as a Date, read as UTC; null when there is none or it does not parse. */
export function storedDate(at) {
  const iso = toUtcInstant(at);
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whether two instants fall on the same day where the viewer is. */
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "12 Oct", or "12 Oct 2025" outside `now`'s year: the viewer's local day. */
export function dayText(date, now) {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** "12 Sep 2026": the viewer's local day, with its year. */
export const fullDayText = (date) => `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

/** What a half of the list says when the Worker could not read it (D701 decision 5). */
export const CONVERSATIONS_UNREADABLE = {
  eadwyn: 'Your Eadwyn conversations could not be read.',
  profiling: 'Your profiling conversations could not be read.',
};

/**
 * The Conversations list (S1m) from `GET /api/eadwyn/conversations/mine`, as
 * `PhoneRows` rows:
 *   - a rail row reads "<date> · <n> messages", with "Today" when it was
 *     updated on the viewer's today;
 *   - the profiling row reads "<date> · <answered> of <total> answered" with
 *     "<pct>%"; with no total it reads the date alone, never 0%;
 *   - a half the Worker could not read is one line, and the list is never
 *     called empty while a half is missing.
 */
export function conversationRows(payload, now = new Date()) {
  const list = Array.isArray(payload?.conversations) ? payload.conversations : [];
  const missing = (Array.isArray(payload?.unreadable) ? payload.unreadable : []).filter((k) => CONVERSATIONS_UNREADABLE[k]);
  const rows = list.map((c) => {
    const at = storedDate(c?.updated_at);
    const day = at ? dayText(at, now) : null;
    if (c?.kind === 'profiling') {
      const total = Number(c.total);
      const answered = Number(c.answered);
      const counted = c.total != null && Number.isFinite(total) && total > 0 && c.answered != null && Number.isFinite(answered);
      return {
        key: `profiling:${c.id}`, id: c.id, kind: 'profiling', active: c.active === true, title: c.title,
        description: [day, counted ? `${answered} of ${total} answered` : null].filter(Boolean).join(' · '),
        value: counted ? `${Math.round((answered / total) * 100)}%` : null,
      };
    }
    const n = Number(c?.messages);
    return {
      key: `eadwyn:${c?.id}`, id: c?.id, kind: 'eadwyn', active: false, title: c?.title,
      description: [day, c?.messages != null && Number.isFinite(n) ? `${n} message${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '),
      value: at && sameDay(at, now) ? 'Today' : null,
    };
  });
  return {
    rows,
    unreadable: missing.map((k) => CONVERSATIONS_UNREADABLE[k]),
    empty: rows.length === 0 && missing.length === 0,
  };
}
