// D1585 (#3832, deck v2 F6) — the words of "Prep" on an investor meeting.
// The brief is read from what the venture recorded; no model runs, so nothing
// here is quoted or charged. A part that could not be read says so, and is
// never shown as "none".

export const STAGE_WORDS = Object.freeze({
  to_contact: 'To contact', contacted: 'Contacted', meeting: 'Meeting', diligence: 'Diligence', committed: 'Committed', passed: 'Passed',
});

export const PREP_WORDS = Object.freeze({
  button: 'Prep',
  reading: 'Reading the brief…',
  unreadablePart: 'Could not be read.',
  noLinks: 'No deck link was made for them yet.',
  noTheirs: 'They have raised no objection you logged.',
  noTimeline: 'Nothing logged yet.',
  noLastMet: 'No earlier meeting or call is logged.',
});

const day = (s) => (s ? String(s).slice(0, 10) : null);

/** Who they are, in one line: firm and name as recorded, then the stage. */
export function whoLine(p) {
  const who = [p?.name, p?.firm].filter(Boolean).join(' · ') || 'Not recorded';
  return `${who} · ${STAGE_WORDS[p?.stage] || p?.stage || 'Not recorded'}`;
}

/** The next step as recorded, with its due day; null when none is. */
export function nextStepLine(p) {
  if (!p?.next_step) return null;
  return p.next_step_due ? `${p.next_step} · due ${day(p.next_step_due)}` : p.next_step;
}

/** Read time in plain minutes; under a minute says so. A recorded zero is "Not read yet". */
export function readWords(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 'Not read yet';
  if (s < 60) return 'Under a minute read';
  return `${Math.round(s / 60)} min read`;
}

/** One deck link: its deck, the day it was made, its views and read time, or that it was withdrawn. */
export function linkLine(l) {
  const title = l?.deck_title || 'Deck';
  const sent = day(l?.sent_at);
  const head = sent ? `${title} · sent ${sent}` : title;
  if (l?.revoked) return `${head} · Withdrawn`;
  const views = Number(l?.views);
  const seen = views === 1 ? '1 view' : `${Number.isFinite(views) ? views : 0} views`;
  return `${head} · ${seen} · ${readWords(l?.read_seconds)}`;
}

/** One objection: its words, how often they said it, and whether you have an answer. */
export function objectionLine(o, theirs) {
  const n = Number(theirs ? o?.of_prospect : o?.prospects);
  const how = theirs
    ? (n > 1 ? ` · they said it ${n} times` : '')
    : (n > 1 ? ` · ${n} investors` : ' · 1 investor');
  const answered = o?.answer ? ' · You have an answer' : ' · No answer yet';
  return `${o?.text || 'Not recorded'}${how}${answered}`;
}

/** The meeting being prepared, or the last one met, as a day line. */
export function meetingLine(m, label) {
  if (!m) return null;
  const at = m.starts_at || m.at;
  return `${label} · ${m.kind === 'call' ? 'Call' : 'Meeting'} · ${day(at) || 'Not recorded'}`;
}
