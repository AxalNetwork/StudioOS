/**
 * D4254 P1 (#4274) — the Pitch Overview's figures (ps1), from reads the page
 * already makes: the current version's deck (its cards' `notes` are the
 * script), its rehearsals, its comments, its HQ notes and its engagement.
 *
 * NOTHING IS INVENTED. Every function returns `null` for a value it cannot
 * read, and the page draws that as "Not recorded", never 0. A count of 0 is
 * only ever a real count of an answered read.
 */

/** The tiles, in order. The Overview is not a tile: it lights none. */
export { STUDIO_PATH as OVERVIEW_PATH, DECKS_PATH, SCRIPT_PATH, SHARE_PATH } from './pitchStudioModel.js';

/** The header's primary, by tile (D4254 §1.4). Review and Notes have Ask only. */
export const PRIMARY_OF = Object.freeze({
  overview: 'New deck',
  decks: 'New deck',
  script: 'Rehearse',
  analytics: 'New link',
});
export const BUILD_YOUR_DECK = 'Build your deck';

export const NO_DECK_TITLE = 'Build the deck you’ll pitch from';
export const NO_DECK_ITEMS = Object.freeze([
  { id: 'records', title: 'Start from your records', line: 'A first deck from what StudioOS already knows. Every figure shows its source.' },
  { id: 'template', title: 'Pick a template', line: 'Start from a layout, then fill it from your records.' },
]);
// ps2's third way in, "Import a deck (PDF, PPTX)", is left out: main has no
// import flow to open, and a door to nothing is not drawn (gap filed on #4274).

/** What Pitch does, under the no-deck panel: no numbers, only what each part is for. */
export const WHAT_PITCH_DOES = Object.freeze([
  ['What to say', 'A script for every card, and the questions investors are likely to ask.'],
  ['Rehearse', 'Run the pitch against the clock and see where it runs long.'],
  ['Review', 'Comments from your team, approvals, and a check of every figure.'],
  ['Share & analytics', 'One link per investor, with or without an NDA, and who read what.'],
]);

const slidesOf = (deck) => (Array.isArray(deck?.slides) ? deck.slides : null);
const written = (s) => typeof s === 'string' && s.trim().length > 0;

/** The script's coverage: cards whose notes are written, of all cards. */
export function scriptCoverage(deck) {
  const slides = slidesOf(deck);
  if (!slides) return null;
  return { scripted: slides.filter((s) => written(s?.notes)).length, cards: slides.length };
}

/** `m:ss` from seconds; `null` for a value that is not a finite, non-negative number. */
export function clock(seconds) {
  const n = Number(seconds);
  if (seconds == null || !Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The latest rehearsal (the list is newest first), or `null` when the read sent no list. */
export function lastRehearsal(list) {
  const rows = Array.isArray(list?.rehearsals) ? list.rehearsals : Array.isArray(list) ? list : null;
  if (!rows) return null;
  const r = rows[0];
  if (!r) return { none: true };
  return {
    none: false,
    at: r.created_at || null,
    duration: clock(Number(r.duration_ms) / 1000),
    target: clock(r.pitch_seconds),
    over: Number.isFinite(Number(r.duration_ms)) && Number.isFinite(Number(r.pitch_seconds))
      ? Number(r.duration_ms) / 1000 > Number(r.pitch_seconds) : null,
  };
}

/** Open threads, from the comments read's own count when it sends one. */
export function openComments(read) {
  if (!read || typeof read !== 'object') return null;
  if (Number.isFinite(Number(read.open))) return Number(read.open);
  const list = Array.isArray(read.comments) ? read.comments : null;
  return list ? list.filter((c) => c?.parent_uid == null && c?.resolved_at == null).length : null;
}

/** The latest note from Axal HQ (an admin's or the Super Admin's), or `null`. */
export function latestHqNote(read) {
  const notes = Array.isArray(read?.notes) ? read.notes : null;
  if (!notes) return null;
  const hq = notes.filter((n) => n?.author?.kind === 'admin' || n?.author?.kind === 'super_admin');
  const last = hq[hq.length - 1];
  return last ? { body: String(last.body || ''), name: last.author?.name || 'Axal HQ', at: last.created_at || null, card: last.card_index ?? null } : null;
}

/** How many investors "Recent investor activity" lists (ps1 draws five). */
export const ACTIVITY_ROWS = 5;

const stamp = (at) => {
  const t = Date.parse(String(at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(at || '')) ? '' : 'Z'));
  return Number.isFinite(t) ? t : null;
};

const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';

/**
 * #4274 (ps1, D1568): "Recent investor activity", from the current version's
 * investor links (`GET /decks/:id/investor-links`). Each link's latest event is
 * its newest recorded signal (D1568's words: "Opened", "Revisited after 48 h",
 * "Reached the ask"), else an accepted NDA, else its last view. A link nobody
 * has opened is not activity and is left out; a withdrawn link keeps what it
 * recorded. Newest first, at most `ACTIVITY_ROWS`. `null` when the read gave
 * no list, so the page says it could not read it rather than "no activity".
 */
export function investorActivity(read, limit = ACTIVITY_ROWS) {
  const links = Array.isArray(read?.links) ? read.links : null;
  if (!links) return null;
  const rows = [];
  for (const l of links) {
    const signals = (Array.isArray(l?.signals) ? l.signals : []).filter((s) => s && stamp(s.at) != null);
    const last = signals.reduce((a, s) => (a && stamp(a.at) >= stamp(s.at) ? a : s), null);
    const nda = l?.nda?.state === 'accepted' && stamp(l.nda.accepted_at) != null ? l.nda.accepted_at : null;
    const viewed = Number(l?.analytics?.views) > 0 && stamp(l.analytics.last_viewed_at) != null ? l.analytics.last_viewed_at : null;
    const event = last ? { at: last.at, line: String(last.words || 'Opened') }
      : nda ? { at: nda, line: 'Accepted the NDA' }
        : viewed ? { at: viewed, line: 'Opened the deck' } : null;
    if (!event) continue;
    const name = l?.investor?.label || null;
    rows.push({
      id: Number(l.id), name, fund: l?.investor?.fund || null, initials: initialsOf(name || l?.investor?.fund),
      prospectId: l?.investor?.prospect_id == null ? null : Number(l.investor.prospect_id),
      line: event.line, at: event.at,
    });
  }
  return rows.sort((a, b) => stamp(b.at) - stamp(a.at) || b.id - a.id).slice(0, limit);
}
