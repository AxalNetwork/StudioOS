/**
 * D6865 part 2 (#6891) — the words and rules of Grow › Customers › Feedback's
 * tab, its Add feedback and Save as feedback sheets, and Eadwyn's theme
 * placements (the #6099 canvas, GR-21, GR-21B, GR-21C, GR-24, GR-25, GR-27,
 * GR-29). Pure, so the pages and their tests read the same rules: a typed name
 * that names no record reads Not linked, nothing is invented for a person, and
 * zero, Not recorded and Unreadable never look alike.
 */
import { rankThemes } from './feedbackLoopModel.js';

export const ORIGIN_LABEL = Object.freeze({
  inbox_reply: 'Inbox reply', interview: 'Interview', notion: 'Notion', posthog_survey: 'PostHog survey', typed: 'Typed',
});
export const SOURCES = Object.freeze([['customer', 'Customer'], ['investor', 'Investor'], ['team', 'Team']]);
export const STATUSES = Object.freeze([['open', 'Open'], ['planned', 'Planned'], ['shipped', 'Shipped']]);
export const SORTS = Object.freeze([['newest', 'Newest'], ['oldest', 'Oldest'], ['theme', 'Theme']]);
/** The theme column's "No theme yet" entry; never a theme name a founder could type (themes are trimmed). */
export const NO_THEME = ' no-theme ';
const word = (list, v) => list.find(([k]) => k === v)?.[1] ?? null;
const capital = (v) => { const t = String(v ?? '').replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** Where an item came from; a row older than the column says so. */
export const originWord = (o) => ORIGIN_LABEL[o] ?? 'Origin not recorded';

/**
 * The linked-customer chip on an item row. `undefined` (an advisor's read sends
 * no `contact` key) draws no chip at all; `null` is a writer's Not linked.
 */
export function recordChip(contact) {
  if (contact === undefined) return null;
  if (!contact || typeof contact !== 'object') return { linked: false, text: 'Not linked to a customer record' };
  const where = [capital(contact.audience), capital(contact.status)].filter(Boolean).join(' · ');
  return { linked: true, text: [contact.name || 'Linked record', where].filter(Boolean).join(' · ') };
}

/** The tab's rows: each adapted record's own feedback, with its record link unchanged. */
export function feedbackRows(records, rowHref) {
  return (Array.isArray(records?.rows) ? records.rows : []).filter((r) => r && r.feedback)
    .map((r) => ({ ...r.feedback, id: r.id, href: typeof rowHref === 'function' ? rowHref(r) : null }));
}

/** Themes ranked by item count: a writer's `parts.themes`, else (an advisor) counted from the rows. */
export function themesOf(partsThemes, rows) {
  if (Array.isArray(partsThemes)) return rankThemes(partsThemes);
  const n = new Map();
  for (const r of rows || []) if (clean(r.theme)) n.set(r.theme, (n.get(r.theme) || 0) + 1);
  return rankThemes([...n].map(([theme, feedback]) => ({ theme, feedback })));
}

/** Open, planned and shipped among some rows, as GR-21 splits a theme. */
export function splitOf(rows) {
  const s = { open: 0, planned: 0, shipped: 0 };
  for (const r of rows || []) if (Object.hasOwn(s, r.status)) s[r.status] += 1;
  return s;
}
export const splitLine = (s) => `${s.open} open · ${s.planned} planned · ${s.shipped} shipped`;

/** The selected theme's items (or the unthemed ones), filtered by source and status, in the chosen order. */
export function itemsFor(rows, { theme = null, source = '', status = '', sort = 'newest' } = {}) {
  const at = (r) => Date.parse(r.created_at || '') || 0;
  const out = (rows || []).filter((r) => (theme == null ? true : theme === NO_THEME ? !clean(r.theme) : r.theme === theme)
    && (!source || r.source === source) && (!status || r.status === status));
  if (sort === 'oldest') return out.sort((a, b) => at(a) - at(b));
  if (sort === 'theme') return out.sort((a, b) => String(a.theme || '￿').localeCompare(String(b.theme || '￿')) || at(b) - at(a));
  return out.sort((a, b) => at(b) - at(a));
}

/**
 * Which body the tab draws (GR-21, GR-27, GR-28): the read loading or failed,
 * nothing recorded yet, items but no theme named yet (Themes a measured 0), or
 * the loaded tab. The counts decide "nothing recorded" only when they were read.
 */
export function tabState({ status, recordsStatus, counts, rows }) {
  if (status === 'loading' || recordsStatus === 'loading') return 'loading';
  if (status === 'unreadable' || recordsStatus === 'unreadable') return 'unreadable';
  const items = Number.isFinite(Number(counts?.items)) && counts != null ? Number(counts.items) : (rows || []).length;
  if (items === 0 && !(rows || []).length) return 'empty';
  const themes = counts && Number.isFinite(Number(counts.themes)) ? Number(counts.themes) : themesOf(undefined, rows).length;
  return themes === 0 ? 'unthemed' : 'loaded';
}

/** The Feedback tab's count beside its name, from the read; a failed count draws none, never 0. */
export function tabCount(counts) {
  const n = counts && typeof counts === 'object' ? Number(counts.items) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A contact the sheet can link without asking: one exact email match, else one exact name match; else none. */
export function matchContact(contacts, { email, name } = {}) {
  const list = Array.isArray(contacts) ? contacts : [];
  const e = clean(email).toLowerCase(); const n = clean(name).toLowerCase();
  const byEmail = e ? list.filter((c) => clean(c.email).toLowerCase() === e) : [];
  if (byEmail.length === 1) return byEmail[0];
  const byName = n ? list.filter((c) => clean(c.name).toLowerCase() === n) : [];
  return byName.length === 1 ? byName[0] : null;
}

const BLANK = Object.freeze({ body: '', source: 'customer', from_name: '', from_email: '', from_company: '', contact_uid: '', theme: '', new_theme: '', roadmap_item_ref: '', status: 'open', notify: false });

/** Add feedback's empty sheet (GR-21B): typed by hand. */
export const blankValues = () => ({ ...BLANK });

/**
 * Save as feedback from an Inbox reply (GR-24, GR-29C): the selected words (or
 * the whole reply), the person's name, email and company, and their Pipeline
 * record linked. "Tell them when it ships" starts unticked: it records that
 * they asked, which the reply does not say.
 */
export function replyValues({ thread, message, selection, recipient } = {}) {
  const contact = thread?.contact || {};
  return { ...BLANK, body: clean(selection) || clean(message?.body), from_name: clean(contact.name), from_email: clean(recipient),
    from_company: clean(contact.organization), contact_uid: clean(contact.uid) };
}

/** Save as feedback from an interview passage (GR-25): the interviewee, linked only when one record matches. */
export function interviewValues({ interview, passage, contacts } = {}) {
  const name = clean(interview?.interviewee_name);
  const match = matchContact(contacts, { name });
  return { ...BLANK, body: clean(passage), from_name: name, from_company: clean(interview?.interviewee_company), contact_uid: match ? String(match.value) : '' };
}

/** Quote consent as the interview records it. */
export const consentWord = (q) => (q === 1 || q === true ? 'Yes' : q === 0 || q === false ? 'No' : 'Not recorded');

/** What a sheet cannot save, as one sentence; null when it can. */
export function sheetProblem(v) {
  if (!clean(v?.body)) return 'Say what they said before you save.';
  if (v.notify && v.from_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v.from_email))) return 'That email does not look like an address.';
  return null;
}

/** The one `POST /api/cycles/grow/feedback` body a sheet sends. */
export function feedbackBody(v, { origin = 'typed', replyKey = null } = {}) {
  const theme = clean(v.new_theme) || clean(v.theme);
  return {
    body: clean(v.body), source: v.source || 'customer', from_name: clean(v.from_name) || null, from_email: clean(v.from_email) || null,
    from_company: clean(v.from_company) || null, contact_uid: clean(v.contact_uid) || null, theme: theme || null,
    status: v.status || 'open', notify_on_ship: v.notify === true, origin, ...(clean(v.roadmap_item_ref) ? { roadmap_item_ref: clean(v.roadmap_item_ref) } : {}),
    ...(replyKey ? { reply_key: replyKey } : {}),
  };
}

/** The Customer record block of a sheet: the linked record's words, or Not linked. */
export function linkedWords(contacts, uid) {
  const c = uid ? (Array.isArray(contacts) ? contacts : []).find((x) => String(x.value) === String(uid)) : null;
  if (!uid) return { linked: false, text: 'Not linked to a customer record' };
  if (!c) return { linked: true, text: 'Linked record' };
  return { linked: true, text: [c.name || c.email || 'Linked record', c.organization, [capital(c.audience), capital(c.status)].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') };
}

/** The saved sentence (GR-24B): where it went and its status. */
export const savedLine = (status) => `Saved to Feedback · ${word(STATUSES, status) || 'Open'}`;

/**
 * Eadwyn's theme placements (GR-21C): the pending `feedback_theme` proposals
 * whose theme is one the founder already named. Any other is held back and
 * counted, never offered: Eadwyn never names a theme.
 */
export function placementsFrom(proposals, namedThemes) {
  const named = new Set((namedThemes || []).map((t) => (typeof t === 'string' ? t : t?.theme)).filter(Boolean));
  const mine = (Array.isArray(proposals) ? proposals : []).filter((p) => p && p.kind === 'feedback_theme' && p.payload && typeof p.payload === 'object');
  const shown = mine.filter((p) => named.has(String(p.payload.theme)));
  return { shown, held: mine.length - shown.length };
}

/** The review's three lines (GR-21C). */
export function placementReview(p, themes) {
  const t = (themes || []).find((x) => x.theme === p?.payload?.theme);
  return {
    feedback: `“${clean(p?.payload?.body) || 'Feedback'}”`,
    placed: `${p?.payload?.theme} · a theme you named${t ? ` · ${plural(Number(t.feedback) || 0, 'item', 'items')}` : ''}`,
    writes: 'This item’s theme only. Nothing else changes.',
  };
}

/** The words selected inside one element, or '' when the selection is elsewhere (GR-24: "Saves the selected words"). */
export function selectedWithin(node, win = typeof window === 'undefined' ? null : window) {
  if (!win || !node || typeof win.getSelection !== 'function') return '';
  const sel = win.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !node.contains(sel.anchorNode) || !node.contains(sel.focusNode)) return '';
  return String(sel.toString() || '').trim();
}
