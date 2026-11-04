/**
 * D1357 (#3572, LinkedIn part 8) — relationship intelligence's words and
 * rules, pure: the sharing setting (RI1, RI7), "Who knows them" on a record
 * (RI2), the ask (RI3), the introducer's inbox (RI4), the log (RI5) and
 * follow-ups (RI6). No React and no fetch: `SharingCard.jsx`,
 * `WhoKnowsStrip.jsx` and `IntroductionsDesk.jsx` draw it, over
 * `relationshipsApi` (D1356, D4329).
 *
 * THE RULES (D1357 §2):
 *   · nothing is shared until the member turns it on, one switch per team;
 *   · a teammate who did not share is absent: no count, no gap, no locked row;
 *   · no contact detail ever: a person is a name, a company and a title;
 *   · Axal never contacts the person: an introduction is asked of the teammate;
 *   · Accept and Made are two steps; Made is recorded when the intro is sent;
 *   · an outcome is what someone recorded; until then "Not recorded".
 */
import { NOT_RECORDED } from '../../lib/absence';

export { NOT_RECORDED };

// ─────────────────────────────────────────────────────────── RI1, RI7 sharing

export const SHARE_TITLE = 'Let my team see who I know';
export const SHARE_LINE = 'One switch per team. Nothing is shared until you turn it on.';
export const TEAM_SEES = Object.freeze([
  'That you know someone',
  'Their name, company and title',
  'Where you know them from, and since when',
]);
export const NEVER_SHARED = Object.freeze([
  'Their email and phone',
  'Your notes and your messages',
  'Their LinkedIn link',
]);
export const NEVER_CONTACTS = 'Axal never contacts anyone on your behalf. A teammate who wants an introduction asks you, and you decide.';
export const SHARING_UNREAD = 'Your sharing setting could not be read.';
export const NO_TEAMS = 'You are not on a team yet, so there is no one to share with.';
export const stopTitle = (team) => `Stop sharing with ${team}?`;
export const STOP_LINE = 'They stop seeing who you know on their next read. Requests already sent stay in your inbox.';
export const STOP_AGAIN = 'You can turn it back on at any time.';
export const KEEP_SHARING = 'Keep sharing';
export const STOP_SHARING = 'Stop sharing';
/** "Off · the default", "On", or "Turned off just now". */
export function shareState(team, justOff = false) {
  if (justOff) return 'Turned off just now';
  return team?.shared ? 'On' : 'Off';
}

/** "3 members · your venture" style: the team's label and kind, never who is on it. */
export const teamLine = (t) => [t?.label || 'Your team', t?.kind ? kindWord(t.kind) : null].filter(Boolean).join(' · ');
const KIND_WORDS = { venture: 'your venture', studio: 'studio staff', firm: 'your firm', fund: 'your fund' };
const kindWord = (k) => KIND_WORDS[k] || String(k).replace(/_/g, ' ');

// ─────────────────────────────────────────────────────────── RI2 who knows them

export const STRIP_TITLE = 'Who knows them';
export const STRIP_MAX = 3;
export const STRIP_EMPTY = 'Nobody on your teams has shared knowing them.';
export const STRIP_UNREAD = 'Axal could not read who knows them.';
/** "Teammates who chose to share that they know Alex Example." */
export const stripLine = (subject) => `Teammates who chose to share that they know ${subject}.`;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'them';

/** "LinkedIn, since 2021", or the source alone. A date nobody recorded is left out, never guessed. */
export function howLine(how) {
  const source = how?.source_label || how?.source || null;
  const year = /^(\d{4})/.exec(String(how?.connected_since || ''))?.[1] ?? null;
  return [source, year ? `since ${year}` : null].filter(Boolean).join(', ') || null;
}

/** One teammate's row: "Lena Hart knows Alex Example", "Northwind (co-founders) · LinkedIn, since 2021", and the ask. */
export function whoKnowsRow(p) {
  const teammate = p?.teammate?.name || 'A teammate';
  const person = p?.person?.name || 'them';
  return {
    key: `${p?.teammate?.id}-${p?.ref}`,
    ref: p?.ref, teammateId: p?.teammate?.id, teammate,
    knows: `${teammate} knows ${person}`,
    detail: [p?.person?.company && p?.person?.title ? `${p.person.title}, ${p.person.company}` : p?.person?.company || p?.person?.title || null,
      p?.team?.label || null, howLine(p?.how)].filter(Boolean).join(' · '),
    ask: `Ask ${firstName(teammate)} for an introduction`,
    person: p?.person?.name || null,
  };
}

/** The strip's rows: at most three, in the read's (or the ranking's) order. Nothing about anyone else. */
export function stripRows(people, max = STRIP_MAX) {
  return (Array.isArray(people) ? people : []).slice(0, max).map(whoKnowsRow);
}

// ─────────────────────────────────────────────────────────── RI3 the ask

export const REASON_LABEL = 'Why you’d like the introduction';
export const REASON_HELP = (teammate) => `${firstName(teammate)} sees this.`;
export const CONTEXT_LABEL = (person) => `Context for ${firstName(person)} (optional)`;
export const CONTEXT_HELP = (teammate) => `A short note ${firstName(teammate)} can forward. Only the two of you read it.`;
export const ASK_SENDS = (teammate, person) => `Axal sends your request to ${firstName(teammate)} only. Nobody contacts ${firstName(person)} unless ${firstName(teammate)} does.`;
export const DRAFT_LATER = 'Draft from this record · coming with Eadwyn’s drafts';
export const SENT_TITLE = 'Request sent';
export const SENT_LINE = (teammate) => `${firstName(teammate)} decides. You will see their answer in Network › Introductions.`;
export const NOTE_MAX = 1000;
/** Whether the ask can be sent: a reason in words, both notes within their size. */
export function askReady({ reason, context }) {
  const r = String(reason ?? '').trim();
  return r.length > 0 && r.length <= NOTE_MAX && String(context ?? '').trim().length <= NOTE_MAX;
}

// ─────────────────────────────────────────────────────────── RI4–RI6 introductions

export const STATUS_LABEL = Object.freeze({ pending: 'Asked', accepted: 'Accepted', declined: 'Declined', made: 'Made', withdrawn: 'Withdrawn' });
export const STATUS_FILTERS = Object.freeze(['pending', 'accepted', 'declined', 'made', 'withdrawn']);
export const OUTCOMES = Object.freeze([
  { id: 'meeting_held', label: 'Meeting held' },
  { id: 'replied', label: 'Replied' },
  { id: 'no_reply', label: 'No reply' },
  { id: 'not_a_fit', label: 'Not a fit' },
]);
export const LOG_EMPTY = 'No introductions yet. Ask one from “Who knows them” on an investor, a company or a fund.';
export const LOG_UNREAD = 'Your introductions could not be read.';
export const INBOX_EMPTY = 'Nobody has asked you for an introduction.';
export const NOT_NOW = 'Not now';
export const WRITE_INTRO = 'Write the intro';
export const SENDS_NOTHING = 'Axal sends nothing itself. The intro goes from your own mailbox, to the address you choose.';
export const DRAFT_INTRO_LATER = 'Draft with Eadwyn · coming with Eadwyn’s drafts';
export const DRAFT_FOLLOW_LATER = 'Draft a follow-up · coming with Eadwyn’s drafts';

/** "Omar Reyes → Lena Hart": who asked, and who was asked. */
export const whoLine = (r) => `${r?.requester?.name || 'A teammate'} → ${r?.teammate?.name || 'A teammate'}`;
/** "Alex Example · Bluefern Capital". */
export const personOf = (r) => [r?.person?.name, r?.person?.company].filter(Boolean).join(' · ') || 'Someone';
/** The log's Outcome cell: what was recorded, else Not recorded. */
export const outcomeOf = (r) => r?.outcome?.value ? (r.outcome.label || r.outcome.value) : NOT_RECORDED;
/** "Asked of you": a request to the caller, still to answer or accepted and not yet made. */
export const isOpenForMe = (r) => r?.status === 'pending' || r?.status === 'accepted';
/** The intro email's subject: "Intro: Alex (Bluefern) ↔ Omar (Northwind Labs)". */
export function introSubject(r, askerCompany = null) {
  const person = `${firstName(r?.person?.name)}${r?.person?.company ? ` (${r.person.company})` : ''}`;
  const asker = `${firstName(r?.requester?.name)}${askerCompany ? ` (${askerCompany})` : ''}`;
  return `Intro: ${person} ↔ ${asker}`;
}

/** The team a row was asked on, by the caller's own team labels (never another team's). */
export const teamLabelOf = (r, teams = []) => (teams.find((t) => t.key === r?.team_key)?.label) || 'Your team';

/**
 * The log's rows, newest first: sent and received together, each with who for,
 * the team, the status, the outcome and the caller's own follow-up.
 */
export function logRows(read, teams = []) {
  const rows = [...(read?.sent || []).map((r) => ({ ...r, side: 'sent' })), ...(read?.received || []).map((r) => ({ ...r, side: 'received' }))];
  return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map((r) => ({
    uid: r.uid, side: r.side, when: String(r.created_at || '').slice(0, 10) || NOT_RECORDED,
    who: whoLine(r), person: personOf(r), team: teamLabelOf(r, teams),
    status: STATUS_LABEL[r.status] || r.status, statusKey: r.status, outcome: outcomeOf(r),
    followUp: followUpLine(r.follow_up), row: r,
  }));
}

/** The follow-up cell: "Due 4 Nov", "Snoozed to 10 Nov", "Done", or none. */
export function followUpLine(f) {
  if (!f) return '—';
  if (f.state === 'done') return 'Done';
  if (f.state === 'snoozed') return `Snoozed to ${f.snoozed_until}`;
  if (f.state === 'due') return `Due ${f.due_on}`;
  return `On ${f.due_on}`;
}

/** RI6: the follow-ups worth a card, due ones first. "Follow up with Ravi Mehta · Lena introduced you on 14 Oct · no reply recorded". */
export function followUps(read) {
  const rows = [...(read?.sent || []), ...(read?.received || [])].filter((r) => r.follow_up && r.follow_up.state !== 'done');
  const rank = { due: 0, snoozed: 1, scheduled: 2 };
  return rows.sort((a, b) => (rank[a.follow_up.state] ?? 9) - (rank[b.follow_up.state] ?? 9)).map((r) => ({
    uid: r.uid, state: r.follow_up.state,
    title: `Follow up with ${r?.person?.name || 'them'}`,
    line: [r.made_at ? `${r?.teammate?.name || 'Your teammate'} introduced you on ${String(r.made_at).slice(0, 10)}` : `${STATUS_LABEL[r.status] || r.status}`,
      r?.outcome?.value ? `outcome: ${r.outcome.label}` : 'no outcome recorded'].join(' · '),
    when: followUpLine(r.follow_up),
  }));
}

/** A date `n` days from `from` (YYYY-MM-DD), for Snooze and a new follow-up. */
export function dayAfter(from, n) {
  const d = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
