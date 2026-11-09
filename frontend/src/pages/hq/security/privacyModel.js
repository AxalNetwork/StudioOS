/**
 * D4803 (#4803, canvas SE06 Privacy, SE11d phone) — what the Privacy workspace
 * says about data-subject requests, from `/overview`'s `dsr`. Pure, for the
 * tests.
 *
 * ONE RULE, SHOWN AS A DATE. The due date is received + 30 days, as the server
 * counts it (`deadline_at`); the page prints that date and the days remaining,
 * so nobody does the arithmetic. An unparseable receipt has no due date: it is
 * Unknown, never "0 days".
 *
 * CLOSING RECORDS A DECISION; IT ERASES NOTHING. HQ may record Fulfilled or
 * Denied. Withdrawn is the subject's own act and reads as theirs.
 */

export const DSR_KIND_WORDS = Object.freeze({ erasure: 'Erasure' });
export const OUTCOMES = Object.freeze([
  { key: 'fulfilled', word: 'Fulfilled', mark: '✓', line: 'You have completed what was asked' },
  { key: 'denied', word: 'Denied', mark: '✕', line: 'You are refusing, with a legal basis' },
]);
export const DUE_SOON_DAYS = 7;

/** "DSR-0041" from the ledger id, or null when the ledger does not hold the request yet. */
export const dsrLabel = (id) => (Number.isInteger(id) && id > 0 ? `DSR-${String(id).padStart(4, '0')}` : null);

const parse = (s) => {
  if (!s) return NaN;
  const t = String(s);
  return Date.parse(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`);
};

/** "20 Oct 2026", in UTC, or null. */
export function dayOf(s) {
  const t = parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "Tue 20 Oct 2026, 10:14 UTC", or null. */
export function whenOf(s) {
  const t = parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
  return `${day}, ${d.toISOString().slice(11, 16)} UTC`;
}

/** "Thu 19 Nov 2026" (the due date has no time worth reading), or null. */
export function dueDayOf(s) {
  const t = parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
}

/** The days remaining as words. `null` is Unknown, never zero. */
export function remainingOf(daysLeft) {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(Number(daysLeft))) return 'Unknown';
  const n = Number(daysLeft);
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Due today';
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** An open request's state in the shared vocabulary. */
export function openState(row) {
  const n = row?.days_left;
  if (n === null || n === undefined) return { state: 'unknown', word: 'Open · due date unknown' };
  if (n < 0) return { state: 'action_required', word: 'Overdue' };
  if (n <= DUE_SOON_DAYS) return { state: 'action_required', word: 'Due soon' };
  return { state: 'pending', word: 'Open' };
}

const CLOSED_STATE = Object.freeze({
  fulfilled: { state: 'verified', word: 'Fulfilled' },
  denied: { state: 'not_applicable', word: 'Denied' },
  withdrawn: { state: 'not_applicable', word: 'Withdrawn' },
});
export const closedState = (outcome) => CLOSED_STATE[outcome] || { state: 'unknown', word: 'Closed · outcome not recorded' };

/** One subject in words: name and email, the email alone, or the account id. */
export const subjectOf = (r) => (r?.email ? (r.name ? `${r.name} · ${r.email}` : r.email) : `Account ${r?.user_id ?? r?.id ?? 'not recorded'}`);

/**
 * The table's rows: open requests first (soonest due first, unknown due dates
 * last), then the ones closed in the window (newest first, as the server sent
 * them). Each row is the same shape, so the phone cards draw from it too.
 */
export function dsrRows(dsr) {
  if (!dsr || dsr.available === false) return [];
  const open = (dsr.rows || []).map((r) => ({
    key: `open:${r.id}:${r.requested_at}`,
    open: true,
    label: dsrLabel(r.request_id),
    kind: DSR_KIND_WORDS[r.kind] || r.kind || 'Not recorded',
    subject: subjectOf(r),
    userId: r.id,
    received: dayOf(r.requested_at),
    receivedFull: whenOf(r.requested_at),
    due: dueDayOf(r.deadline_at),
    remaining: remainingOf(r.days_left),
    ...openState(r),
    prior: r.prior_requests,
    lastOutcome: r.last_outcome,
    lastOutcomeAt: r.last_outcome_at,
    raw: r,
  }));
  open.sort((a, b) => {
    const x = a.raw.days_left; const y = b.raw.days_left;
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return x - y;
  });
  const recent = dsr.recent?.available ? dsr.recent.rows || [] : [];
  const closed = recent.map((r) => ({
    key: `closed:${r.id}`,
    open: false,
    label: dsrLabel(r.id),
    kind: 'Erasure',
    subject: subjectOf(r),
    userId: r.user_id,
    received: dayOf(r.requested_at),
    receivedFull: whenOf(r.requested_at),
    due: null,
    remaining: '—',
    closed: dayOf(r.closed_at),
    closedFull: whenOf(r.closed_at),
    closedBy: r.outcome === 'withdrawn' ? 'The requester' : (r.closed_by || 'Not recorded'),
    reason: r.close_reason,
    ...closedState(r.outcome),
    raw: r,
  }));
  return [...open, ...closed];
}

/**
 * The summary strip: Open (with the next due date), Due within 7 days,
 * Overdue, Closed in the last 90 days (by HQ · withdrawn). Each figure is
 * `null` when its read did not answer, so it draws as Unavailable, not 0.
 */
export function dsrSummary(dsr) {
  const readable = Boolean(dsr) && dsr.available !== false;
  const rows = readable ? dsr.rows || [] : [];
  const known = rows.filter((r) => typeof r.days_left === 'number');
  const next = known.slice().sort((a, b) => a.days_left - b.days_left)[0];
  const recent = dsr?.recent;
  const recentOk = Boolean(recent) && recent.available === true;
  const closedRows = recentOk ? recent.rows || [] : [];
  const withdrawn = closedRows.filter((r) => r.outcome === 'withdrawn').length;
  return {
    open: readable ? rows.length : null,
    nextDue: next ? dueDayOf(next.deadline_at) : null,
    unknownDue: rows.length - known.length,
    dueSoon: readable ? known.filter((r) => r.days_left >= 0 && r.days_left <= DUE_SOON_DAYS).length : null,
    overdue: readable ? known.filter((r) => r.days_left < 0).length : null,
    closed: recentOk ? closedRows.length : null,
    closedByHq: recentOk ? closedRows.length - withdrawn : null,
    withdrawn: recentOk ? withdrawn : null,
    closedTruncated: recentOk && recent.truncated === true,
    windowDays: recentOk ? recent.window_days : 90,
    recentReason: recent && recent.available === false ? recent.reason : null,
  };
}

/** The one next action for an open request, in words. */
export function nextAction(row) {
  if (!row?.open) return null;
  const base = 'Confirm the member’s records are removed, then record the outcome';
  if (row.state === 'action_required' && row.raw?.days_left < 0) return `${base}. The legal due date has passed.`;
  return base;
}

/**
 * The detail's history, from what the stores hold: received; any earlier
 * closed requests from the same subject; the close, for a closed one. Views
 * are not recorded, so "Seen by" is not drawn.
 */
export function historyOf(row) {
  if (!row) return [];
  const out = [{ at: row.receivedFull || 'Not recorded', text: 'Request received from the member’s privacy settings' }];
  if (row.open) {
    if (row.prior === null || row.prior === undefined) {
      out.push({ at: '—', text: 'Earlier requests from this subject: unknown (the request ledger could not be read)' });
    } else if (row.prior > 0) {
      const last = row.lastOutcome ? `, the last closed as ${closedState(row.lastOutcome).word}${row.lastOutcomeAt ? ` on ${dayOf(row.lastOutcomeAt)}` : ''}` : '';
      out.push({ at: '—', text: `${row.prior} earlier request${row.prior === 1 ? '' : 's'} from this subject${last}` });
    }
  } else {
    const who = row.raw?.outcome === 'withdrawn' ? 'Withdrawn by the requester' : `Closed as ${row.word} by ${row.closedBy}`;
    out.push({ at: row.closedFull || 'Not recorded', text: row.reason ? `${who}: ${row.reason}` : who });
  }
  return out;
}

/**
 * What a close answered, as one of four results:
 *   done         the server recorded it (or had already, from the same key);
 *   unconfirmed  sent, and whether it was recorded is not known (202, no
 *                answer, or a server error): Try again resends the same key;
 *   changed      nothing was recorded because the request changed first (the
 *                subject withdrew, asked again, or it was closed): the reason
 *                is kept and only a reload shows what is open;
 *   refused      nothing was recorded, for a reason the operator can act on.
 */
export function closeResultOf(res, err) {
  if (!err) {
    if (res?.code === 'outcome_unconfirmed') return { result: 'unconfirmed', message: res.error || 'The close was sent, but whether it was recorded could not be read back.' };
    return { result: 'done', replayed: Boolean(res?.replayed), res };
  }
  const code = err?.code;
  if (code === 'stale_request') {
    return {
      result: 'changed',
      message: err.message,
      now: { state: 'pending', word: 'A newer request', line: err.data?.current_requested_at ? `The subject withdrew and asked again on ${dayOf(err.data.current_requested_at) || 'a later date'}` : 'The subject withdrew and asked again' },
    };
  }
  if (code === 'no_open_request') {
    const last = err.data?.last_outcome;
    const at = err.data?.last_outcome_at;
    const st = last ? closedState(last) : { state: 'unknown', word: 'Closed' };
    const by = last === 'withdrawn' ? 'by the requester' : last ? 'by another admin' : '';
    return {
      result: 'changed',
      message: err.message,
      now: { ...st, line: [by && `${st.word} ${by}`, at && `at ${whenOf(at)}`].filter(Boolean).join(' ') || 'No request is open for this account now' },
    };
  }
  if (code === 'ledger_unavailable' || (!err?.status || err.status >= 500)) {
    return { result: 'unconfirmed', message: `${err?.message || 'No answer from the server.'} Whether it was recorded is not confirmed. Try again: the same close is recorded at most once.` };
  }
  const msg = String(err?.message || 'Request failed');
  return {
    result: 'refused',
    message: msg === 'TOTP required'
      ? 'This needs a session signed in with your authenticator app. Sign out and back in with a code, then try again.'
      : msg,
  };
}
