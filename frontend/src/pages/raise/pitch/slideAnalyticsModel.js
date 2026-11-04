/**
 * D1573 (#3820, PD-8 · pd37 and pd35's Analytics cell) — per-slide investor
 * analytics, pure: the words the Share ▾ table and the "Viewer analytics"
 * sheet print from the Worker's reads (`GET /api/decks/:id/investor-links`
 * and `…/investor-links/:shareId/analytics`).
 *
 * Nothing here prints 0 for what was not counted: a card no heartbeat timed
 * reads "Not read", a link nobody timed has no Time, and a link with Time per
 * slide off says "visit counts only". A view count is a count, so "Views 0"
 * is a real zero.
 */
import { recordHref } from '../../cycles/recordModel.js';
import { SLUG as CAPREL_SLUG } from '../caprel/capRelModel.js';

export const VIEWS_UNREAD = 'Views could not be read.';
export const CONSENT_OFF = 'Visit counts only. Time per slide is off for this link.';
export const OFF_KEEPS = 'Off keeps visit counts only';
export const TIME_PER_SLIDE = 'Time per slide';
export const NOT_READ = 'Not read';
export const NO_MOST_READ = 'Not recorded yet';
export const NO_VISITS = 'No visits yet.';
export const SWITCH_FAILED = 'Time per slide could not be changed. Try again.';

/** The visit timeline's words, one per event kind (#3815's signals read the same kinds). */
export const TIMELINE_WORDS = Object.freeze({
  opened: 'Opened',
  nda_accepted: 'Accepted the NDA',
  reached_ask: 'Reached the ask',
  revisited: 'Revisited',
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A stored time ('2026-10-12 09:14:00', UTC) as a Date, or null. */
export function parseAt(v) {
  if (typeof v !== 'string' || !v) return null;
  const s = v.includes('T') ? v : v.replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Seconds as the canvas writes them: "45 s", "1 m 48 s", "6 m", "1 h 2 m". Null for none, never "0 s". */
export function durationWords(seconds) {
  const s = Math.round(Number(seconds));
  if (seconds == null || !Number.isFinite(s) || s <= 0) return null;
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s / 60} m`;
  const m = Math.floor((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)} h ${m} m` : `${Math.floor(s / 3600)} h`;
}

/** When a link was last seen: today, yesterday, 3 days ago, or the day ("12 Oct"). Null when never. */
export function lastSeenWords(at, now = new Date()) {
  const d = parseAt(at);
  if (!d) return null;
  const day = (x) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** A timeline time: "12 Oct · 09:14" (UTC, as stored). */
export function stampWords(at) {
  const d = parseAt(at);
  if (!d) return 'Time not recorded';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * pd35's Analytics cell for a row of the investor links read:
 * "Views 4 · Time 6 m 12 s · Last seen yesterday", or "Views 1 · visit counts only".
 */
export function analyticsCellWords(row, now = new Date()) {
  const a = row?.analytics || {};
  const views = Number.isFinite(Number(a.views)) ? Number(a.views) : null;
  if (views == null) return 'Views not recorded';
  if (row?.time_per_slide === false) return `Views ${views} · visit counts only`;
  const parts = [`Views ${views}`];
  const time = durationWords(a.read_seconds);
  if (time) parts.push(`Time ${time}`);
  const seen = lastSeenWords(a.last_viewed_at, now);
  if (seen) parts.push(`Last seen ${seen}`);
  return parts.join(' · ');
}

/** The sheet's NDA pill: "Accepted the NDA 12 Oct", "NDA not accepted yet", or "No NDA required". */
export function ndaPill(nda) {
  if (nda?.state === 'accepted') {
    const d = parseAt(nda.accepted_at);
    return { tone: 'pos', words: d ? `Accepted the NDA ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : 'Accepted the NDA' };
  }
  if (nda?.state === 'not_accepted') return { tone: 'amb', words: 'NDA not accepted yet' };
  return { tone: 'mut', words: 'No NDA required' };
}

/** pd37's MOST READ SLIDE: "Traction · 1 m 48 s", or null when no card was timed. */
export function mostReadWords(answer) {
  const m = answer?.most_read;
  const time = durationWords(m?.seconds);
  if (!m || !time) return null;
  return `${m.title || `Card ${Number(m.index) + 1}`} · ${time}`;
}

/** pd37's TIME PER SLIDE bars: each card with its height (0–1 of the most read) and its label. */
export function barsOf(answer) {
  const cards = Array.isArray(answer?.cards) ? answer.cards : [];
  const top = Math.max(0, ...cards.map((c) => Number(c.seconds) || 0));
  return cards.map((c) => ({
    uid: c.card_uid,
    title: c.title || `Card ${Number(c.index) + 1}`,
    label: durationWords(c.seconds) ?? NOT_READ,
    height: top > 0 && Number(c.seconds) > 0 ? Number(c.seconds) / top : 0,
    most: Boolean(answer?.most_read && answer.most_read.card_uid === c.card_uid),
  }));
}

/** The visit timeline as rows: "12 Oct · 09:14" and "Opened". */
export const timelineRows = (answer) => (Array.isArray(answer?.timeline) ? answer.timeline : [])
  .map((e, i) => ({ key: `${e.kind}-${e.view_id ?? 'x'}-${i}`, at: stampWords(e.at), words: TIMELINE_WORDS[e.kind] || e.kind }));

// ── #4272 ps7s: the per-investor sheet's next steps ───────────────────────────

/** Why the two actions are off for a link whose investor was typed in, not picked from Capital relationships. */
export const NOT_IN_CAPREL = 'This link names an investor typed in by hand, so it has no Capital relationships record to draft from or open.';

/**
 * What "Draft follow-up" and "Open in Capital relationships" act on: the link's
 * prospect in Capital relationships, its name, and the record's address. A link
 * whose investor was typed (no `prospect_id`) gets `{ ok: false, reason }`, so
 * both are drawn off with that reason, never pointed at nobody.
 */
export function nextStepsOf(row) {
  const id = Number(row?.investor?.prospect_id);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: NOT_IN_CAPREL };
  const name = [row?.investor?.label, row?.investor?.fund].filter(Boolean).join(' · ') || 'investor';
  // The same address the pipeline's "Open the full record" uses (CapRelPipeline, `recordHref`).
  return { ok: true, prospectId: id, name, href: recordHref('raise', CAPREL_SLUG, id) };
}
