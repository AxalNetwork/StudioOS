// D6861 (#6861) — Help Center v2, built to its canvas (D4957): the plain
// functions behind search, the guide page, the ticket sheet, the directory
// and the admin review, so the pages and the tests run the same rules.
import { HELP_AREAS, HELP_SURFACES, canOpenSurface, guidePlacement, helpAreas } from '../guidePlacement';
import { PUBLIC_HELP_ANCHORS } from '../sections';

// ── Search ──────────────────────────────────────────────────────────────────

/** The search shows at most this many. The owner chose "First 25 results" over an exact total (D4957 question 4, option A). */
export const SEARCH_SHOWN = 25;

/**
 * The first 25 guides for a query, and whether more match. The index is asked
 * for one more than it shows: that is how the page knows to say "First 25"
 * without ever claiming a total it did not count.
 */
export function searchGuides(fuse, query) {
  const q = String(query || '').trim();
  if (!q || !fuse) return { results: [], capped: false };
  const hits = fuse.search(q, { limit: SEARCH_SHOWN + 1 }).map((r) => r.item);
  return { results: hits.slice(0, SEARCH_SHOWN), capped: hits.length > SEARCH_SHOWN };
}

/** The live line above the results: never a total the search does not know. */
export function resultLine({ results, capped }) {
  if (capped) return `First ${SEARCH_SHOWN} results · refine your search to narrow them`;
  const n = results.length;
  return `${n} result${n === 1 ? '' : 's'}`;
}

/** Each result's area: its D626 task area, or the manifest section when it has no placement. */
export function resultArea(r) {
  const p = guidePlacement(r.anchor);
  return p ? { id: p.area, title: p.areaTitle } : { id: r.sectionId, title: r.sectionTitle };
}

/** The area chips: All, then each area with how many of the results shown sit in it, most first. */
export function areaChips(results) {
  const counts = new Map();
  for (const r of results) {
    const a = resultArea(r);
    const cur = counts.get(a.id) || { id: a.id, label: a.title, count: 0 };
    cur.count += 1;
    counts.set(a.id, cur);
  }
  const order = (id) => {
    const i = HELP_AREAS.findIndex((a) => a.id === id);
    return i < 0 ? HELP_AREAS.length : i;
  };
  const areas = [...counts.values()].sort((a, b) => b.count - a.count || order(a.id) - order(b.id));
  return [{ id: 'all', label: 'All', count: results.length }, ...areas];
}

export const inArea = (results, areaId) => (areaId === 'all' ? results : results.filter((r) => resultArea(r).id === areaId));

/** Arrow keys move the selection through the list; it never wraps and never leaves it. */
export function moveSelection(key, index, length) {
  if (length <= 0) return -1;
  if (key === 'ArrowDown') return index < 0 ? 0 : Math.min(index + 1, length - 1);
  if (key === 'ArrowUp') return index <= 0 ? 0 : index - 1;
  return index;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'why', 'where', 'when', 'who', 'does', 'with', 'from', 'into', 'your', 'you', 'our', 'are', 'not', 'any', 'this', 'that', 'there', 'have', 'has', 'get', 'set', 'use', 'out', 'all']);

/**
 * "Try a broader term": the query's own words, each one that on its own finds
 * at least one guide, at most three. A term that finds nothing is never offered.
 */
export function broaderTerms(query, fuse) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !fuse) return [];
  const words = [...new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))];
  if (words.length < 2 && words[0] === q) return [];
  return words.filter((w) => fuse.search(w, { limit: 1 }).length > 0).slice(0, 3);
}

/** "Browse an area": the areas the broader terms' first guides sit in, at most two. */
export function areasForTerms(terms, fuse) {
  const out = [];
  for (const t of terms) {
    const hit = fuse.search(t, { limit: 1 })[0]?.item;
    if (!hit) continue;
    const a = resultArea(hit);
    if (!out.some((x) => x.id === a.id)) out.push(a);
    if (out.length === 2) break;
  }
  return out;
}

const QUESTION = /^(how|what|why|where|when|who|can|does|do|is|are|should|which)\b/i;

/** A ticket from a search that found nothing carries the search, as an editable title. */
export function ticketTitleFromSearch(query) {
  const q = String(query || '').trim().replace(/[?.!\s]+$/, '');
  if (!q) return '';
  const title = QUESTION.test(q) ? q : `How do I ${q}`;
  return `${title[0].toUpperCase()}${title.slice(1)}?`.slice(0, 200);
}

// ── The guide page ──────────────────────────────────────────────────────────

export const ROLE_LABELS = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating partner', admin: 'Admin' };
export const roleLabel = (role) => ROLE_LABELS[role] || (role ? role[0].toUpperCase() + role.slice(1) : '');

/** "Applies to: Founder" or "Every account". Descriptive only: it never hides a guide (D626). */
export function appliesToLine(appliesTo) {
  return Array.isArray(appliesTo) && appliesTo.length > 0 ? `Applies to: ${appliesTo.map(roleLabel).join(', ')}` : 'Every account';
}

/** D7001 (#7001): the account recovery guide's button, in the member's own words. */
export const RECOVERY_ACTION = 'Recover my account';

/**
 * The guide's one primary action, or null when it has no page or this viewer
 * cannot open the page it names (then no button is drawn, as on HC5's
 * variant). Account recovery starts recovery: that is what its page is for.
 */
export function goToTarget(placement, user, session = null) {
  if (!placement?.surface || !canOpenSurface(placement.surfaceInfo, user, session)) return null;
  const label = placement.surface === '/auth/recover' ? RECOVERY_ACTION : `Go to ${placement.surfaceInfo.label}`;
  return { label, path: placement.surface };
}

/**
 * D7001 (#7001): the public-tracker warning, beside Contact support's ticket button so it is read before a word is
 * typed. It repeats the guide's own overview; the link goes to the private disclosure options.
 */
export const TRACKER_WARNING_ANCHOR = 'troubleshooting/contact-support';
export const TRACKER_WARNING = 'Ordinary tickets and their replies may be mirrored to a public issue tracker. Do not include passwords, recovery codes or confidential records.';
export const TRACKER_WARNING_LINK = Object.freeze({ label: 'Read private disclosure options', path: '/trust/disclosure' });

/** The guide page's "On this page", in the canvas's order, only for the parts this guide has. */
export function guideOutline(sub, { related = 0, support = false, feedback = false, stuck = false } = {}) {
  return [
    sub?.overview && { id: 'overview', label: 'Overview' },
    Array.isArray(sub?.beforeYouStart) && sub.beforeYouStart.length > 0 && { id: 'before-you-start', label: 'Before you start' },
    Array.isArray(sub?.howto) && sub.howto.length > 0 && { id: 'steps', label: 'Steps' },
    Array.isArray(sub?.recoveryRows) && sub.recoveryRows.length > 0 && { id: 'recovery', label: 'Connector recovery' },
    Array.isArray(sub?.tips) && sub.tips.length > 0 && { id: 'tips', label: 'Tips' },
    Array.isArray(sub?.pitfalls) && sub.pitfalls.length > 0 && { id: 'pitfalls', label: 'Pitfalls' },
    related > 0 && { id: 'related', label: 'Related guides' },
    support && { id: 'get-help', label: 'Get help' },
    feedback && { id: 'feedback', label: 'Did this answer it?' },
    stuck && { id: 'still-stuck', label: 'Still can’t get in?' },
  ].filter(Boolean);
}

/**
 * A ticket opened from a guide carries the guide's link, the search that led
 * there (D4640) and the member's own words, and nothing else: all shown, all
 * editable before Submit. No record, note or account detail is copied in.
 */
export function guideTicketDraft({ anchor, title, missing, query }) {
  const words = String(missing || '').trim();
  const firstLine = words.split(/\n/)[0].slice(0, 120).trim();
  const q = cleanQuery(query);
  return {
    title: (firstLine || `Question about “${title}”`).slice(0, 200),
    description: `From the guide: /help/${anchor}${q ? `\nSearched for: “${q}”` : ''}${words ? `\n\n${words}` : ''}`,
  };
}

// ── D4640: the journey from a question to a guide and back ─────────────────

/** A search carried in an address is at most this long: a question, not a document. */
export const QUERY_MAX = 200;

/** The query as an address or a ticket carries it: trimmed, one line, at most `QUERY_MAX`. */
export function cleanQuery(query) {
  return String(query || '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX).trim();
}

/** The Help home showing a search's results, `/help?q=<query>`; `/help` with no query. */
export function searchHref(query) {
  const q = cleanQuery(query);
  return q ? `/help?q=${encodeURIComponent(q)}` : '/help';
}

/**
 * A guide's address carrying the search that found it, `/help/<area>/<guide>?q=<query>`,
 * so the guide can offer the results again and a ticket from it can say what was searched.
 */
export function guideHrefFor(anchor, query) {
  const q = cleanQuery(query);
  return q ? `/help/${anchor}?q=${encodeURIComponent(q)}` : `/help/${anchor}`;
}

/**
 * A plain left click on a result: the page opens it itself, so the results'
 * address can be kept first. Any other click (a new tab, a modifier) is the
 * browser's.
 */
export const isPlainClick = (e) => !!e && e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;

/** What's new: its body is a separate Markdown file the guide fetches, so the search index never holds it. */
export const RELEASE_NOTES_ANCHOR = 'changelog/release-notes';

/**
 * What the search reads, said where the results are (D4640). The index holds
 * each guide's title and written text; release notes load on their own page
 * and are not searched, so the line links them when this viewer can read them.
 */
export function searchScope(sections) {
  const s = (sections || []).find((x) => x.id === RELEASE_NOTES_ANCHOR.split('/')[0]);
  const g = s?.subsections.find((x) => x.id === RELEASE_NOTES_ANCHOR.split('/')[1]);
  return {
    line: g ? 'Searches guide titles and text. Release notes are not searched.' : 'Searches guide titles and text.',
    notes: g ? { anchor: RELEASE_NOTES_ANCHOR, label: `Read ${s.title}` } : null,
  };
}

// ── Signed out ──────────────────────────────────────────────────────────────

/**
 * D7001 (#7001): the search's suggested queries. Each is drawn from the public guide index, so it finds a guide
 * anyone can read, signed in or not (the test runs each one against the signed-out search).
 */
export const SEARCH_SUGGESTIONS = Object.freeze([
  Object.freeze({ query: 'account recovery', anchor: 'account/auth-recovery' }),
  Object.freeze({ query: 'account roles', anchor: 'getting-started/roles' }),
  Object.freeze({ query: 'onboarding walkthrough', anchor: 'getting-started/onboarding' }),
  Object.freeze({ query: 'contact support', anchor: 'troubleshooting/contact-support' }),
]);

/** The suggestions whose guide is still public; one whose guide left the public index is not offered. */
export const searchSuggestions = () => SEARCH_SUGGESTIONS.filter((s) => PUBLIC_HELP_ANCHORS.has(s.anchor));

/** The public guides, Account recovery first: the visitor who cannot sign in is the one most likely here. */
export function publicGuides(sections) {
  const all = sections.flatMap((s) => s.subsections
    .filter((g) => PUBLIC_HELP_ANCHORS.has(`${s.id}/${g.id}`))
    .map((g) => ({ ...g, anchor: `${s.id}/${g.id}`, areaTitle: guidePlacement(`${s.id}/${g.id}`)?.areaTitle || s.title })));
  return [...all.filter((g) => g.anchor === 'account/auth-recovery'), ...all.filter((g) => g.anchor !== 'account/auth-recovery')];
}

// ── The directory ───────────────────────────────────────────────────────────

export const DIRECTORY_ROLES = [
  { id: 'all', label: 'All' }, { id: 'founder', label: 'Founder' }, { id: 'investor', label: 'Investor' },
  { id: 'advisor', label: 'Advisor' }, { id: 'partner', label: 'Operating partner' },
];

/** The filter starts at the viewer's own role when it is one of the choices. */
export const defaultDirectoryRole = (role) => (DIRECTORY_ROLES.some((r) => r.id === role) ? role : 'all');

/**
 * Every area the viewer can read, every guide in it. The role filter dims a
 * guide written for other roles and never hides one; a guide for every
 * account is never dimmed. A guide with no page is marked.
 */
export function directoryAreas(sections, filterRole = 'all') {
  return helpAreas(sections).map((area) => ({
    id: area.id,
    title: area.title,
    guides: area.guides.map((g) => {
      const roles = Array.isArray(g.appliesTo) ? g.appliesTo : [];
      return {
        anchor: g.anchor,
        title: g.title,
        appliesTo: roles,
        dim: filterRole !== 'all' && roles.length > 0 && !roles.includes(filterRole),
        noPage: !g.surface,
      };
    }),
  }));
}

// ── Admin content review ────────────────────────────────────────────────────

/**
 * A guide's broken links, checked against the manifest it is built from: a
 * Related link that opens no guide, or a page its placement names that the
 * surface table does not know. No store is needed: the guides are code. A
 * stale flag is `guideVerification` in `guideGovernance.js` (D7515), not here.
 */
export function guideLinkFlags(anchor, sections) {
  const ids = new Set(sections.flatMap((s) => s.subsections.map((g) => `${s.id}/${g.id}`)));
  const [area, guide] = String(anchor || '').split('/');
  const sub = sections.find((s) => s.id === area)?.subsections.find((g) => g.id === guide);
  if (!sub) return null;
  const broken = (Array.isArray(sub.related) ? sub.related : [])
    .map((r) => String(r?.href || '').replace(/^#/, ''))
    .filter((href) => !ids.has(href))
    .map((href) => `Related: ${href || '(empty)'}`);
  const p = guidePlacement(anchor);
  if (p?.surface && !HELP_SURFACES[p.surface]) broken.push(`Page: ${p.surface}`);
  return { broken };
}

export function linkFlagLine(flags) {
  if (!flags) return 'Not in the Help Center';
  return flags.broken.length === 0 ? 'No broken link' : `${flags.broken.length} broken link${flags.broken.length === 1 ? '' : 's'}`;
}

/** The searches that found nothing, from `GET /api/admin/help/search-misses`; null when the reply is not that shape. */
export function searchMissesView(reply) {
  if (!Array.isArray(reply?.searches)) return null;
  return {
    days: Number(reply.window_days) || null,
    searches: reply.searches
      .filter((m) => typeof m?.query === 'string' && Number(m?.searches) > 0)
      .map((m) => ({ query: m.query, searches: Number(m.searches) })),
  };
}

/** A search that found nothing is recorded when the member stops typing for this long. */
export const SEARCH_MISS_IDLE_MS = 1500;
