/**
 * D5885 (#5885, part of #4716) — the Best-Fit consultations board (AP-20 to
 * AP-31, D5884) as pure functions: its address, its tabs and counts, the
 * rows, the summary, the decisions each status allows, each dialog's words,
 * the history, and what a refusal means. No React, so `node --test` loads it
 * alone.
 *
 * THE DECISIONS ARE THE WORKER'S. `BEST_FIT_TRANSITIONS` copies
 * `CONSULTATION_TRANSITIONS` (routes/consultations.ts), and a test reads that
 * file and holds the two to each other. Completed and Cancelled have none.
 *
 * WHO IS TOLD (D5886). Confirming or cancelling sends the member an in-app
 * notice after the decision commits; completing tells nobody. The Worker
 * answers `notified` (true, false, or null when nobody is told), and the
 * result line says which. A failed notice never undoes the decision.
 */

const nf = (n) => Number(n).toLocaleString('en-US');

export const BEST_FIT_BASE = '/admin/approvals/best-fit';

/** The tabs, each a path segment (option A of D5884). */
export const BEST_FIT_TABS = [
  { key: 'requested', label: 'Requested', path: BEST_FIT_BASE },
  { key: 'confirmed', label: 'Confirmed', path: `${BEST_FIT_BASE}/confirmed` },
  { key: 'completed', label: 'Completed', path: `${BEST_FIT_BASE}/completed` },
  { key: 'cancelled', label: 'Cancelled', path: `${BEST_FIT_BASE}/cancelled` },
];

/** The statuses the store keeps, each with its glyph and word (never colour alone). */
export const STATUS_WORDS = {
  requested: { glyph: '▸', word: 'Requested' },
  confirmed: { glyph: '●', word: 'Confirmed' },
  completed: { glyph: '✓', word: 'Completed' },
  cancelled: { glyph: '✕', word: 'Cancelled' },
};

/** The Worker's legal transitions (`CONSULTATION_TRANSITIONS`). */
export const BEST_FIT_TRANSITIONS = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Where the address stands: `{ tab, item }`, or null off the board. */
export function bestFitAt(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === BEST_FIT_BASE) return { tab: 'requested', item: null };
  if (!p.startsWith(`${BEST_FIT_BASE}/`)) return null;
  const rest = p.slice(BEST_FIT_BASE.length + 1);
  if (rest.includes('/')) return null;
  const tab = BEST_FIT_TABS.find((t) => t.key === rest && t.key !== 'requested');
  if (tab) return { tab: tab.key, item: null };
  return /^[1-9]\d*$/.test(rest) ? { tab: null, item: Number(rest) } : null;
}

/** A D1 time ("2026-11-14 12:40:00", or ISO) as epoch ms, or null. */
export function timeOf(s) {
  if (!s) return null;
  const t = String(s);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t) ? `${t.replace(' ', 'T')}Z` : t;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "9 Nov 2026 · 09:40 UTC", or null for a time not recorded. */
export function whenText(s) {
  const ms = timeOf(s);
  if (ms == null) return null;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

/** An age in hours as "5 d 3 h", "6 h". */
export function ageText(hours) {
  const h = Math.max(0, Math.floor(hours));
  const d = Math.floor(h / 24);
  const r = h % 24;
  return d ? `${d} d${r ? ` ${r} h` : ''}` : `${h} h`;
}

/** The Waiting band: over 72 hours is past (Overdue), 24 to 72 is due (Due soon). */
export function bandOf(hours) {
  if (hours == null) return null;
  if (hours > 72) return { key: 'past' };
  if (hours >= 24) return { key: 'due' };
  return { key: 'ok' };
}

/** One booking from the Worker as a board row. */
export function rowOf(b, now = Date.now()) {
  const requested = timeOf(b?.requested_at) ?? timeOf(b?.created_at);
  const ageHours = requested == null ? null : (now - requested) / 3600000;
  const name = typeof b?.user_name === 'string' && b.user_name.trim() ? b.user_name.trim() : null;
  const email = typeof b?.user_email === 'string' && b.user_email ? b.user_email : null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: Number(b?.id),
    key: String(b?.id),
    name,
    email,
    // The member's line: their name, or the email with "No name recorded".
    who: name || email || `Account ${b?.user_id ?? ''}`.trim(),
    whoSub: name ? email : 'No name recorded · email shown',
    topic: text(b?.topic),
    notes: text(b?.notes),
    slot: text(b?.slot_at),
    status: STATUS_WORDS[b?.status] ? b.status : null,
    version: Number(b?.version),
    reportRecorded: b?.report_id != null,
    requestedAt: b?.requested_at || b?.created_at || null,
    ageHours,
    age: ageHours == null ? null : ageText(ageHours),
    band: bandOf(ageHours),
    triagedBy: text(b?.admin_name),
    triagedById: b?.admin_id ?? null,
    decidedAt: b?.decided_at || null,
    decidedBy: text(b?.decided_by_name),
  };
}

/**
 * The list read as the board draws it: `{ state, rows, counts }`. `state` is
 * 'loading', 'unreadable' (any failure — the Worker's 503
 * `consultations_unreadable` or no answer) or 'ready'. An unreadable read has
 * no rows and no counts: never an empty queue, never a 0.
 */
export function listOf(read, now = Date.now()) {
  if (!read || read.status === 'loading' || read.status === 'idle') return { state: 'loading', rows: [], counts: null };
  if (read.status !== 'ready' || !Array.isArray(read.reply)) {
    const code = read.error?.code;
    return {
      state: 'unreadable', rows: [], counts: null,
      reason: code === 'consultations_unreadable' || !read.error?.message
        ? 'Best-Fit consultations could not be read. This is not a claim that nobody is waiting.'
        : read.error.message,
    };
  }
  const rows = read.reply.map((b) => rowOf(b, now)).filter((r) => Number.isSafeInteger(r.id) && r.status);
  const counts = Object.fromEntries(BEST_FIT_TABS.map((t) => [t.key, rows.filter((r) => r.status === t.key).length]));
  return { state: 'ready', rows, counts };
}

/** A tab's count for its header: a number, a dash with why, or a load. */
export function tabCount(list, key) {
  if (list.state === 'loading') return { kind: 'load' };
  if (list.state !== 'ready') return { kind: 'dash', tip: 'The consultations could not be read.' };
  return { kind: 'num', value: nf(list.counts[key]) };
}

/** Search over name, email and topic, ignoring case. */
export function matches(row, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.email, row.topic].some((v) => String(v || '').toLowerCase().includes(needle));
}

/** One tab's rows: Requested oldest first (the wait matters); the rest newest first. */
export function tabRows(list, tab, q) {
  const rows = list.rows.filter((r) => r.status === tab && matches(r, q));
  const t = (r) => timeOf(r.requestedAt) ?? 0;
  return rows.sort((a, b) => (tab === 'requested' ? t(a) - t(b) : t(b) - t(a)) || a.id - b.id);
}

/** The decisions a status allows, in the dialog's words. */
export function decisionsFor(status) {
  const to = BEST_FIT_TRANSITIONS[status] || [];
  return to.map((s) => ({
    to: s,
    label: s === 'confirmed' ? 'Confirm…' : s === 'completed' ? 'Complete…' : 'Cancel…',
    danger: s === 'cancelled',
  }));
}

export const MEMBER_TOLD = 'The member, in app. Nothing is emailed.';
export const NOBODY_TOLD = 'Nobody. Completion is not announced to the member.';
export const NOTHING_LEFT = 'Nothing left to decide.';

/** What a decision's dialog says: what changes, who is told and what is recorded. */
export function decisionCopy(to, row) {
  const who = row?.who || 'this member';
  const from = STATUS_WORDS[row?.status]?.word || 'its status';
  if (to === 'confirmed') {
    return {
      title: 'Confirm consultation', button: 'Confirm consultation',
      changes: `${who}’s consultation moves from ${from} to Confirmed. It leaves Requested.`,
      told: MEMBER_TOLD,
      recorded: 'The decision, you and the time, in this consultation’s history and in Decided. A slot time, if you write one.',
    };
  }
  if (to === 'completed') {
    return {
      title: 'Complete consultation', button: 'Mark completed',
      changes: `${who}’s consultation moves from Confirmed to Completed. Completion is history, not a second approval.`,
      told: NOBODY_TOLD,
      recorded: 'The change, you and the time, in this consultation’s history. It does not appear in Decided.',
    };
  }
  return {
    title: 'Cancel consultation', button: 'Cancel consultation', dismiss: 'Keep consultation',
    changes: `${who}’s consultation moves from ${from} to Cancelled. This cannot be undone.`,
    told: MEMBER_TOLD,
    recorded: 'The decision, you and the time, in this consultation’s history and in Decided.',
  };
}

/**
 * The body a decision sends: the status, the version that was read, and the
 * slot time only when the field has text — an empty field keeps the slot
 * already recorded (D5884), so it is never sent.
 */
export function decisionBody(to, row, slotText) {
  const body = { status: to, expected_version: row.version };
  const slot = typeof slotText === 'string' ? slotText.trim() : '';
  if (to === 'confirmed' && slot) body.slot_at = slot;
  return body;
}

/** The Confirm field's start: the slot already recorded, or empty. */
export const slotStart = (row) => row?.slot || '';

/**
 * What a failed decision means (AP-24). `version_conflict`: the item changed
 * after it was read; `illegal_transition`: the version matched but the move is
 * not allowed from its status; both carry the item as it stands now
 * (`current`). No answer, or a 5xx: we cannot tell whether it was saved.
 * Anything else is the Worker's own sentence. None says someone else decided.
 */
export function refusalOf(e) {
  const status = Number(e?.status);
  const current = e?.data?.current && typeof e.data.current === 'object' ? e.data.current : null;
  if (status === 409 && e?.code === 'version_conflict') {
    return { kind: 'changed', lead: 'This consultation changed after you read it.', rest: 'It is shown as it stands now. Nothing was recorded by you.', current };
  }
  if (status === 409 && e?.code === 'illegal_transition') {
    return { kind: 'illegal', lead: e.message || 'This decision is not allowed from the consultation’s status.', rest: 'Nothing was recorded by you.', current };
  }
  if (!status || status >= 500) return { kind: 'unknown', lead: 'We could not tell whether this was saved.', rest: 'Read the consultation again before deciding.', current: null };
  return { kind: 'refused', lead: e?.message || 'This was refused. Nothing changed.', rest: null, current: null };
}

/**
 * The drawer's History (AP-21, AP-25). The request is always first, from the
 * booking; each recorded change follows with its actor and time. A status past
 * Requested with no recorded change was decided before history began, so it
 * reads Not recorded; an unread history says so and invents nothing.
 */
export function historyOf(item) {
  const b = item?.booking;
  const h = item?.history;
  const first = { key: 'requested', when: whenText(b?.requested_at || b?.created_at), line: 'Requested by the member' };
  if (!h || h.available === false) return { state: 'unread', rows: [first], text: h?.reason || 'The history of this consultation could not be read.' };
  const items = Array.isArray(h.items) ? h.items : [];
  const rows = [first, ...items.map((e) => ({
    key: `v${e.version}`,
    when: whenText(e.created_at),
    line: `${STATUS_WORDS[e.from_status]?.word || e.from_status} → ${STATUS_WORDS[e.to_status]?.word || e.to_status} · ${e.actor_name || (e.actor_user_id != null ? `Admin #${e.actor_user_id}` : 'actor not recorded')}`,
  }))];
  if (!items.length && b?.status && b.status !== 'requested') {
    return { state: 'not_recorded', rows, text: 'Not recorded. This consultation was decided before history was kept (10 November 2026).' };
  }
  if (!items.length) return { state: 'none', rows, text: 'No decision yet.' };
  return { state: 'recorded', rows };
}

/**
 * The summary over the requests waiting now (AP-20): rows shaped for
 * `boardStrip`, which counts Overdue, Unassigned and Oldest from them.
 */
export function stripRows(list) {
  return list.rows.filter((r) => r.status === 'requested').map((r) => ({ ...r, title: r.who, name: r.who }));
}

/** The result line after a decision (AP-22c). */
export function doneText(to, row, notified) {
  const who = row?.who || 'The member';
  if (to === 'completed') return `${who}’s consultation is marked completed. It is kept in history.`;
  // D5886: the Worker's `notified`. Anything but true or false says the notice is not known, never that it went.
  const told = notified === true ? 'The member was told in app.'
    : notified === false ? 'The in-app notice could not be sent. The decision stands.'
      : 'Whether the member was told is not known.';
  if (to === 'confirmed') return `${who}’s consultation is confirmed. Moved to Confirmed. ${told}`;
  return `${who}’s consultation is cancelled. Moved to Cancelled. ${told}`;
}

/** The empty tab (AP-26), drawn only on a read that succeeded. */
export function emptyLine(tab) {
  if (tab === 'requested') return { lead: 'No Best-Fit consultations are waiting.', sub: 'Members book from their Best-Fit report; new requests appear here.' };
  return { lead: `No consultation is ${STATUS_WORDS[tab]?.word.toLowerCase() || 'here'}.`, sub: null };
}
