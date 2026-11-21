/**
 * #5310 (D5310) — the founder Network overview (NW1, NW1.2, NW5 of the #4799 canvas), as data. Pure.
 *
 * A READ IS ONE OF FOUR THINGS, and each is drawn differently: `loading` (a skeleton in the card's
 * shape), `ready` (the value), `unreadable` (Could not be read, with Retry; never zero), and `stale`
 * (a refresh failed after an earlier read: the earlier value, marked with the time it was read). A
 * value no store records is `Not recorded` with its reason, never a number.
 *
 * Owner answers on #4799: A1, Made is the delivered state; B1, needs attention means overdue
 * follow-ups only.
 */

import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };
export const UNREADABLE = 'Could not be read';

export const READ_LOADING = { status: 'loading', data: null, readAt: null };
/** The next state of one read after it settles: a failure keeps an earlier value as stale. */
export function settle(prev, outcome, at = new Date().toISOString()) {
  if (outcome.ok) return { status: 'ready', data: outcome.data, readAt: at };
  if (prev && (prev.status === 'ready' || prev.status === 'stale') && prev.data != null) return { status: 'stale', data: prev.data, readAt: prev.readAt };
  return { status: 'unreadable', data: null, readAt: null };
}
const has = (r) => r && (r.status === 'ready' || r.status === 'stale') && r.data != null;
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** NW5's banner: the reads that are showing an earlier value, with the oldest read time. */
export function staleNotice(reads, labels) {
  const stale = Object.entries(reads).filter(([, r]) => r?.status === 'stale');
  if (!stale.length) return null;
  const oldest = stale.map(([, r]) => r.readAt).filter(Boolean).sort()[0] || null;
  return { what: stale.map(([k]) => labels[k] || k), readAt: oldest, keys: stale.map(([k]) => k) };
}

export function minutesAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 60000));
}
export function daysBetween(fromIso, now = Date.now()) {
  const t = Date.parse(String(fromIso || '').length === 10 ? `${fromIso}T00:00:00Z` : String(fromIso || ''));
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86400000));
}
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** The four tiles. Each is `{ key, label, state, value, sub, href?, mark? }`; `state` is the read's. */
export function overviewTiles({ book, followUps, summary, pending, accepted }) {
  const tile = (key, label, read, value, sub, href) => {
    if (!read || read.status === 'loading') return { key, label, state: 'loading', value: null, sub: null, href };
    if (!has(read) || value === null) return { key, label, state: 'unreadable', value: null, sub: UNREADABLE, href };
    return { key, label, state: read.status, value, sub, href };
  };
  const total = has(book) ? n(book.data.total) : null;
  const overdue = has(followUps) ? n(followUps.data.total) : null;
  const decide = has(summary) && summary.data?.recording?.['requests.received_pending']?.recorded !== false ? n(summary.data?.requests?.received_pending) : null;
  const waiting = has(pending) ? n(pending.data?.totals?.sent_pending) : null;
  const acc = has(accepted) ? (n(accepted.data?.totals?.sent) ?? 0) + (n(accepted.data?.totals?.received) ?? 0) : null;
  const active = waiting === null || acc === null ? null : waiting + acc;
  const activeRead = !has(pending) ? pending : !has(accepted) ? accepted : (pending.status === 'stale' || accepted.status === 'stale' ? { ...pending, status: 'stale' } : pending);
  // NW1 and NW8 mark a tile that asks for something (canvas `.k.att`): an amber edge and a glyph,
  // never colour alone. Only a read count above zero is marked: an unread or loading tile has no value.
  const mark = (t, glyph) => (t.value > 0 ? { ...t, mark: glyph } : t);
  return [
    tile('connections', 'Connections', book, total, total === null ? null : `${total === 1 ? 'person' : 'people'} in your relationship book`, '/network/relationships'),
    mark(tile('attention', 'Needs attention', followUps, overdue, overdue === null ? null : `follow-up${overdue === 1 ? '' : 's'} past their due date`), '◷'),
    mark(tile('decide', 'Awaiting my action', summary, decide, decide === null ? null : `team request${decide === 1 ? '' : 's'} asking you to decide`), '!'),
    tile('active', 'Active introductions', activeRead, active, active === null ? null : `${waiting} waiting · ${acc} accepted, not yet made`),
  ];
}

/** NW1's "Relationships needing attention" rows (owner answer B1: overdue follow-ups only). */
export function attentionRows(followUps, now = Date.now()) {
  if (!has(followUps)) return [];
  return (followUps.data.items || []).map((i) => {
    const who = [i.contact?.name || NOT_RECORDED, [i.contact?.title, i.contact?.company].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const last = i.last_note_at ? `Last recorded: note ${daysBetween(i.last_note_at, now)} days ago` : (i.contact?.sources || []).includes('linkedin_csv') ? 'Imported from LinkedIn' : 'Last recorded: no note';
    return {
      key: i.task_uid, who, initials: initials(i.contact?.name),
      line: `${last} · Follow-up “${i.task_title || NOT_RECORDED}” due ${i.due_on}`,
      overdue: `Overdue ${daysBetween(i.due_on, now)} d`,
    };
  });
}

const nameOr = (p, fallback) => (p?.name ? String(p.name) : fallback);
const introHref = (uid) => `/network/introductions?intro=${encodeURIComponent(uid)}&kind=request`;

/**
 * NW1's "Introductions in progress": four groups. Counts are the log's own totals over every row
 * (D4611), never the page. Made counts the last 90 days, the window the platform counts (`made_90d`).
 */
export function introGroups({ pending, accepted, made, summary }, now = Date.now()) {
  const group = (key, title, read, count, rows) => ({
    key, title,
    state: !read || read.status === 'loading' ? 'loading' : has(read) ? read.status : 'unreadable',
    count: has(read) ? count : null,
    rows: has(read) ? rows : [],
  });
  const p = has(pending) ? pending.data : {};
  const a = has(accepted) ? accepted.data : {};
  const m = has(made) ? made.data : {};
  const decide = (p.received || []).filter((r) => r.status === 'pending').map((r) => ({
    key: r.uid, initials: initials(r.requester?.name), title: `${nameOr(r.requester, 'A teammate')} → ${r.person?.name || NOT_RECORDED}`,
    line: `${nameOr(r.requester, 'A teammate')} asks you to introduce them · requested ${day(r.created_at)}`,
    chip: 'Your decision', action: 'Decide', href: introHref(r.uid),
  }));
  const waiting = (p.sent || []).filter((r) => r.status === 'pending').map((r) => ({
    key: r.uid, initials: 'YO', title: `You → ${r.person?.name || NOT_RECORDED}, via ${nameOr(r.teammate, 'a teammate')}`,
    line: `Waiting on ${nameOr(r.teammate, 'your teammate')} · requested ${day(r.created_at)}`,
    chip: 'Waiting', action: 'Open', href: introHref(r.uid),
  }));
  const acc = [...(a.sent || []), ...(a.received || [])].filter((r) => r.status === 'accepted').map((r) => {
    const mine = (a.sent || []).includes(r);
    return {
      key: r.uid, initials: mine ? 'YO' : initials(r.requester?.name),
      title: mine ? `You → ${r.person?.name || NOT_RECORDED}, via ${nameOr(r.teammate, 'a teammate')}` : `${nameOr(r.requester, 'A teammate')} → ${r.person?.name || NOT_RECORDED}, via you`,
      line: mine
        ? `${nameOr(r.teammate, 'Your teammate')} accepted ${day(r.accepted_at || r.decided_at) || NOT_RECORDED} · the introduction itself has not been made yet`
        : `You accepted ${day(r.accepted_at || r.decided_at) || NOT_RECORDED} · you have not made the introduction yet`,
      chip: 'Accepted · not made', action: 'Open', href: introHref(r.uid),
    };
  });
  const since = now - 90 * 86400000;
  const done = [...(m.sent || []), ...(m.received || [])].filter((r) => r.status === 'made' && Date.parse(r.made_at || '') >= since).map((r) => {
    const mine = (m.sent || []).includes(r);
    return {
      key: r.uid, initials: mine ? 'YO' : initials(r.requester?.name),
      title: mine ? `You → ${r.person?.name || NOT_RECORDED}, via ${nameOr(r.teammate, 'a teammate')}` : `${nameOr(r.requester, 'A teammate')} → ${r.person?.name || NOT_RECORDED}, via you`,
      line: `Made ${day(r.made_at)} · outcome: ${r.outcome?.label || NOT_RECORDED}`,
      chip: 'Made', action: 'Open', href: introHref(r.uid),
    };
  });
  const madeCount = has(summary) && summary.data?.recording?.['requests.made_90d']?.recorded !== false ? n(summary.data?.requests?.made_90d) : null;
  return [
    group('decide', 'Awaiting my decision', pending, n(p.totals?.received_pending), decide),
    group('waiting', 'Awaiting someone else', pending, n(p.totals?.sent_pending), waiting),
    group('accepted', 'Accepted — not yet made', accepted, (n(a.totals?.sent) ?? 0) + (n(a.totals?.received) ?? 0), acc),
    // The count is the summary's whole-log `made_90d`; when that was not read, no count is drawn (never the page's length).
    group('made', 'Made · last 90 days', made, madeCount, done),
  ];
}

/** "People you may know": curated matches and the spendable balance they spend from. */
export function matchesView(propositions) {
  if (!has(propositions)) return { state: propositions?.status === 'loading' ? 'loading' : 'unreadable', rows: [], credits: { state: 'unreadable', balance: null } };
  const balance = n(propositions.data?.credits?.balance);
  const rows = (propositions.data?.propositions || []).filter((p) => p.status === 'pending').map((p) => ({
    uid: p.uid, name: p.target?.name || NOT_RECORDED, initials: initials(p.target?.name), headline: p.target?.headline || null,
    expires: day(p.expires_at),
    why: (Array.isArray(p.breakdown?.reasons) ? p.breakdown.reasons : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3).join(' · ') || null,
  }));
  return {
    state: propositions.status, rows,
    credits: balance === null ? { state: 'unreadable', balance: null } : { state: balance > 0 ? 'ok' : 'zero', balance },
  };
}
/** Accept is on only against a balance that was read and is above zero. */
export function acceptGate(credits) {
  if (credits.state === 'unreadable') return { enabled: false, note: 'Accept is turned off until the balance loads, so a match is never accepted against an unknown balance.' };
  if (credits.state === 'zero') return { enabled: false, note: 'Accepting needs 1 credit. You have 0 spendable credits.' };
  return { enabled: true, note: `Accepting spends 1 credit · ${credits.balance - 1} left after` };
}

/**
 * NW1.2: first run. Only when every read that would show something has been read and is empty:
 * an unread book is not an empty one.
 */
export function isFirstRun({ book, pending, accepted, made, propositions }) {
  if (![book, pending, accepted, made, propositions].every((r) => r && r.status === 'ready')) return false;
  const empty = (r) => !(r.data?.sent || []).length && !(r.data?.received || []).length;
  return n(book.data?.total) === 0 && empty(pending) && empty(accepted) && empty(made)
    && !(propositions.data?.propositions || []).some((p) => p.status === 'pending');
}

/** NW1.2's team-sharing line, from the summary's sharing block. */
export function sharingLine(summary) {
  if (!has(summary) || summary.data?.sharing?.opted_in == null) return { state: 'unreadable', text: 'Your sharing setting could not be read.' };
  const { opted_in: on, teams_shared: shared, teams_total: total } = summary.data.sharing;
  if (!on || !shared) return { state: 'off', text: 'You are not sharing your book with your teams. Warm-path search uses only books that teammates share.' };
  return { state: 'on', text: `You share your book with ${shared} of ${total} team${total === 1 ? '' : 's'}.` };
}

/** The relationship strength note (NW1, NW5): the platform records no strength score. */
export const STRENGTH_NOT_RECORDED = 'Relationship strength: Not recorded. The platform stores follow-ups, notes and introductions, not a strength score, so none is shown.';
/**
 * NW1's Recent network activity (D5310-p5), from `GET /api/relationships/activity` (D6557):
 * `{ events, sources, complete }`. Each event is a recorded action and its time, newest first;
 * an import adds the count it created. The read names no person, so no row does.
 *
 * A source the read could not reach is named, never left out: a list with one source unreadable
 * says which, and a list that is empty because a source failed is not "nothing recorded".
 */
export const ACTIVITY_LIMIT = 5;
const ACTIVITY_SOURCES = { follow_ups: 'Follow-ups', introductions: 'Introductions', imports: 'Imports', duplicate_reviews: 'Duplicate reviews' };
const ACTIVITY_GLYPH = {
  follow_up_completed: '✓', intro_accepted: '✓', intro_made: '✓✓', intro_requested: '→', intro_declined: '×',
  contacts_imported: '⇩', duplicate_merged: '⇄', duplicate_kept_both: '⇄', duplicate_dismissed: '⇄',
};
export function activityView(read) {
  if (!read || read.status === 'loading') return { state: 'loading', rows: [], unread: [] };
  if (!has(read)) return { state: 'unreadable', rows: [], unread: [] };
  const d = read.data || {};
  const unread = Object.entries(d.sources || {}).filter(([, v]) => v?.state !== 'readable').map(([k]) => ACTIVITY_SOURCES[k] || k);
  const rows = (Array.isArray(d.events) ? d.events : []).slice(0, ACTIVITY_LIMIT).map((e, i) => {
    const count = Number.isFinite(Number(e.label_parts?.count)) && e.kind === 'contacts_imported' ? Number(e.label_parts.count) : null;
    return {
      key: `${e.kind}-${e.at}-${i}`,
      glyph: ACTIVITY_GLYPH[e.kind] || '•',
      tone: e.kind === 'intro_declined' ? 'off' : /completed|accepted|made/.test(e.kind) ? 'ok' : 'plain',
      action: e.label_parts?.action || NOT_RECORDED,
      detail: count == null ? null : `${count} added`,
      at: String(e.at || '').replace('T', ' ').slice(0, 16),
    };
  });
  if (d.complete === false && !unread.length) unread.push('One source');
  const state = rows.length ? (read.status === 'stale' ? 'stale' : 'ready') : unread.length ? 'partial-empty' : 'empty';
  return { state, rows, unread };
}
export const ACTIVITY_EMPTY = 'No recorded activity yet. Completed follow-ups, introductions, imports and duplicate reviews appear here as they are recorded.';
/** NW1.2 step 2: the book has no hand-added writer yet (D5310, Backend required: #6558). */
export const ADD_PERSON_UNBUILT = 'Adding a person by hand is not built yet: your book is filled by importing today.';

export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return w.length ? w.slice(0, 2).map((x) => x[0]).join('').toUpperCase() : '?';
}
