/**
 * D894 (#2434) — the Pitch deck studio's words and derivations, kept pure so
 * the tests read them without a browser.
 *
 * WHAT IS READ, AND FROM WHERE. Every figure here comes from a read that is
 * already on `main`:
 *   - `GET /api/decks/by-project/:pid`  → the versions (no slides);
 *   - `GET /api/decks/:id`              → the current version's slides (its cover);
 *   - `GET /api/decks/:id/engagement`   → that version's views and NDA count;
 *   - `GET /api/cycles/raise/modules/pitch-deck` → views per week, seconds per
 *     slide and the investor links, for every version of the venture.
 * Nothing is a sample. A read that fails says so where its figure would be, and
 * a value nobody recorded reads "Not recorded", never 0.
 *
 * The coverage meter on the current deck reads `GET /api/decks/sources`
 * through `SourcesBoards.jsx` (D896, #2675); its words are `sourcesModel.js`.
 *
 * WHAT IS NOT DRAWN YET, AND WHO DRAWS IT. The canvas's checks,
 * audience and round columns, the fast-path build, "New in your
 * data", per-version seconds, present mode and the share dialog need stores the
 * Worker does not have. Each is a slot task on #2434; this file grows the
 * derivation when its read lands.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';

export const STUDIO_PATH = '/raise/pitch';
export const EDIT_PATH = '/raise/pitch/edit';
export const REVIEW_PATH = '/raise/pitch/review';
export const ANALYTICS_PATH = '/raise/pitch/analytics';
export const NOTES_PATH = '/raise/pitch/notes';

/** The old `?mode=workspace` address now redirects to the editor with this key. */
export const MOVED_KEY = 'pitch-workspace';
export const MOVED_NOTICE = 'Pitch deck has a new address. Update your bookmark.';

export const TITLE = 'Pitch deck studio';
// D896 (#2675): the second sentence is back now that every source read carries its chip.
export const LINE = 'Build your deck from what StudioOS already knows. Every figure shows its source.';
// PD21: an admin reads the studio and leaves notes (D905).
export const READ_ONLY = 'Read only. Notes are visible to the founder.';

export const TABS = [
  { id: 'decks', label: 'Decks', path: STUDIO_PATH },
  { id: 'review', label: 'Review', path: REVIEW_PATH },
  { id: 'analytics', label: 'Share & analytics', path: ANALYTICS_PATH },
  { id: 'notes', label: 'Notes', path: NOTES_PATH },
];

export const EMPTY_DECK = 'No deck yet. Start from your records.';
export const NO_VIEWS = 'No one has opened a link yet.';
export const NO_VENTURE = 'No venture to build a deck for yet.';
export { NOT_RECORDED };

/** The query every studio address carries: the venture, and nothing else. */
export const ventureQuery = (projectId) => (projectId ? `?project_id=${encodeURIComponent(projectId)}` : '');

/** Where the old `/raise/pitch?mode=workspace` sends you: the editor, query and hash kept. */
export function movedTarget(search = '', hash = '') {
  const next = new URLSearchParams(search);
  next.delete('mode');
  next.set('moved', MOVED_KEY);
  return { pathname: EDIT_PATH, search: `?${next.toString()}`, hash };
}

/** Admins, and anyone who is not the venture's founder, read the studio; they change nothing. */
export const isReadOnly = (user) => String(user?.role || '') !== 'founder';

export const asList = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};

export const currentVersion = (versions) => versions.find((v) => v.is_current || v.current) || versions[0] || null;

const parse = (value) => {
  if (!value) return null;
  // D1 stores "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(value)) ? `${String(value).replace(' ', 'T')}Z` : String(value);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function dayLabel(value) {
  const d = parse(value);
  return d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d) : 'Date not recorded';
}

/** Seconds as m:ss, the canvas's time format. A missing value is not 0:00. */
export function mmss(seconds) {
  const s = Number(seconds);
  if (seconds == null || !Number.isFinite(s) || s < 0) return null;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export const versionLabel = (v) => (v?.version == null ? 'Version not recorded' : `v${v.version}`);

/** The versions table, newest first, as the canvas sorts it by default. */
export function versionRows(versions) {
  return [...versions]
    .sort((a, b) => Number(b.version ?? -1) - Number(a.version ?? -1))
    .map((v) => ({
      id: v.id,
      label: versionLabel(v),
      title: String(v.title || '').trim() || 'Untitled deck',
      saved: dayLabel(v.created_at),
      current: Boolean(v.is_current || v.current),
    }));
}

/** The cover line of a deck: its first slide's title, else its own title. */
export function coverOf(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const first = slides[0] || {};
  const field = (key) => (Array.isArray(first.fields) ? first.fields.find((f) => f?.key === key || f?.kind === key) : null);
  const headline = String(first.title || field('title')?.value || deck?.title || '').trim();
  const sub = String(first.subtitle || field('subtitle')?.value || '').trim();
  return { headline: headline || 'Untitled deck', sub, slides: slides.length || null };
}

const seriesOf = (card, kind) => (Array.isArray(card?.series) ? card.series.find((s) => s?.kind === kind) : null);

/**
 * Views per week, oldest first, from the module card (eight weeks, every
 * version). `null` when the card holds no series: no deck, no views, or a read
 * that failed — the card's own state says which.
 */
export function weeklyViews(card) {
  const bars = seriesOf(card, 'vbars');
  if (!bars || !Array.isArray(bars.values)) return null;
  const values = bars.values.map((n) => Number(n) || 0);
  return { values, total: values.reduce((a, b) => a + b, 0), weeks: values.length };
}

/** Seconds per slide, every version together, as the module card counts them. */
export function slideSeconds(card) {
  const bar = seriesOf(card, 'hbar');
  if (!bar || !Array.isArray(bar.items)) return [];
  return bar.items
    .map((item) => {
      const index = Number(/(\d+)/.exec(String(item.label || ''))?.[1]);
      return { index: Number.isFinite(index) ? index : null, label: String(item.label || ''), seconds: Number(item.value) || 0 };
    })
    .filter((r) => r.index != null);
}

/** The slide read longest, and the one read fastest, for the chart's caption. */
export function slideExtremes(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => b.seconds - a.seconds || a.index - b.index);
  return { longest: sorted[0], fastest: sorted[sorted.length - 1] };
}

export function slideCaption(rows) {
  const ex = slideExtremes(rows);
  if (!ex) return null;
  if (ex.longest.index === ex.fastest.index) return `Viewers spend longest on slide ${ex.longest.index}.`;
  return `Viewers spend longest on slide ${ex.longest.index}; slide ${ex.fastest.index} is read fastest.`;
}

const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * One version's readers, from its engagement read. A viewer is one browser
 * (`ip_hash` with `ua_fingerprint`); a view with neither counts alone.
 */
export function readerStats(engagement) {
  if (!engagement || typeof engagement !== 'object') return null;
  const views = asList(engagement, 'views');
  const viewers = new Set(views.map((v) => (v.ip_hash || v.ua_fingerprint ? `${v.ip_hash || ''}|${v.ua_fingerprint || ''}` : `view:${v.id}`)));
  const seconds = views.map((v) => Number(v.read_seconds)).filter((n) => Number.isFinite(n) && n > 0);
  const nda = engagement.conversions?.nda_signed;
  return {
    views: Number.isFinite(Number(engagement.total_views)) ? Number(engagement.total_views) : views.length,
    viewers: viewers.size,
    medianSeconds: median(seconds),
    ndaSigned: Number.isFinite(Number(nda)) ? Number(nda) : null,
  };
}

/** The investor links, as the module's records give them. */
export function linkRows(records) {
  return asList(records, 'rows').map((row) => {
    const c = row.cells || {};
    const exp = c.expires && typeof c.expires === 'object' ? c.expires : { text: String(c.expires ?? ''), tone: '' };
    return {
      id: row.id,
      investor: String(c.link || '').trim() || 'Investor not recorded',
      expires: exp.text || NOT_RECORDED,
      live: exp.tone === 'ok',
      views: Number.isFinite(Number(c.views)) ? Number(c.views) : null,
      time: c.time == null || c.time === '' ? null : String(c.time),
      mostRead: c.most_read == null ? null : String(c.most_read),
    };
  });
}

/** The module's own "New link" address, when it offers one. */
export const newLinkHref = (records) => (records?.add?.href && /^\/raise\/pitch-deck\/new/.test(records.add.href) ? records.add.href : null);

/** Whether the module says nobody has opened a link yet (an empty card with a deck). */
export const noViewsYet = (card) => card?.state === 'empty' && /No one has opened/i.test(String(card?.reason || ''));

// ---------------------------------------------------------------------------
// D905 (#2684) — notes (PD21) and the studio's boundary (PD22)
// ---------------------------------------------------------------------------

/** The Worker's limit on one note (`routes/deck_notes.ts` NOTE_MAX). */
export const NOTE_MAX = 2000;
export const NOTES_EYEBROW = 'Notes · visible to the founder';
export const NOTES_EMPTY = 'No notes yet.';
export const NOTE_PLACEHOLDER_ADMIN = 'Write a note for the founder…';
export const NOTE_PLACEHOLDER_FOUNDER = 'Answer your admins…';

const KIND_LABEL = { admin: 'Admin', super_admin: 'Axal VC HQ', founder: 'founder' };

/** A card pill's words: "Card 8", or the whole deck. */
export const cardLabel = (index) => (Number.isInteger(index) && index >= 0 ? `Card ${index + 1}` : 'Whole deck');

/**
 * The thread, oldest first, as the Notes tab draws it. A name nobody recorded
 * reads "Not recorded"; the kind is what the author was when they wrote it.
 */
export function noteRows(notes) {
  return asList(notes, 'notes').map((n) => {
    const name = String(n?.author?.name || '').trim() || NOT_RECORDED;
    return {
      id: n.id,
      who: `${name} · ${KIND_LABEL[n?.author?.kind] || NOT_RECORDED}`,
      when: dayLabel(n.created_at),
      text: String(n.body || ''),
      card: cardLabel(n.card_index),
      version: Number.isInteger(n.deck_version) ? `v${n.deck_version}` : NOT_RECORDED,
    };
  });
}

/** What posting does, in the confirm dialog's words. */
export function postNoteSentence(viewer, cardIndex) {
  const where = cardLabel(cardIndex) === 'Whole deck' ? 'the whole deck' : cardLabel(cardIndex).toLowerCase();
  return viewer === 'founder'
    ? `Your answer is added to the thread on ${where}. Your admins and your cofounders read it.`
    : `Your note is added to the thread on ${where}. The founder reads it in the studio. Investors never see it, and it is in no export or share.`;
}

/**
 * PD22: the roles the studio is not for. An Advisor, an Operating Partner and
 * an Explorer see a boundary inside their own shell, never a bounce; a member
 * of an active Spin-Out Lab cohort uses the studio as a founder does.
 */
export const BOUNDARY_ROLES = ['advisor', 'partner', 'exploring'];
export const BOUNDARY_TITLE = 'The Pitch deck studio is for the venture\u2019s founders.';
export function boundaryFor(role, labActive = false) {
  if (labActive || !BOUNDARY_ROLES.includes(String(role || ''))) return null;
  return role === 'advisor'
    ? { title: BOUNDARY_TITLE, line: 'Ask them to share a link. A shared deck opens in the viewer, with the NDA if they ask for one.' }
    : { title: BOUNDARY_TITLE, line: 'Ask them to share a link.' };
}

/** The Super Admin's defaults, one row per sector and stage, with the template's name when the list was read. */
export function overrideRows(overrides, methods) {
  const names = new Map(asList(methods, 'methods', 'items').map((m) => [m.id, m.label]));
  return asList(overrides, 'overrides').map((o) => ({
    key: `${o.sector}|${o.stage}`, sector: o.sector, stage: o.stage, methodId: o.method_id,
    template: names.get(o.method_id) || o.method_id,
  }));
}
