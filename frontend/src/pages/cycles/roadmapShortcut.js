/**
 * D8776 (#8776, BLR00 to BLR07) — the route between Build › Product roadmap (the Now / Next / Later board) and
 * `/build/roadmap` (Quarters, dependencies and scenarios), as pure rules both pages share.
 *
 * Owner question 1, option A: the shortcut is named after the page it opens. Product roadmap IS the Now, Next
 * and Later view, so the link never claims it; the landing's h1 is the link's own words.
 *
 * Every address keeps the venture (`?project_id=`). The landing's view and item, and the board's view and phone
 * column, are in the URL, so the Back link and the browser's Back both land where the founder left.
 */

export const DOOR = 'Quarters, dependencies and scenarios';
export const DOOR_ITEM = 'See its quarter, links and scenarios';
export const LANDING_SUB = 'The items on your Product roadmap, placed by quarter, with what waits on what and the what-ifs you saved.';

/** The landing's three views, By quarter first (owner question 3, option A: the Board view is Product roadmap's). */
export const LANDING_VIEWS = Object.freeze([['quarters', 'By quarter'], ['dependencies', 'Dependencies'], ['scenarios', 'Scenarios']]);
/** The board's two views and its phone columns, as Product roadmap's `?view=` and `?column=` take them. */
export const BOARD_VIEWS = Object.freeze(['board', 'timeline']);
export const BOARD_COLUMNS = Object.freeze(['now', 'next', 'later', 'done']);

const HORIZON = Object.freeze({ now: 'Now', next: 'Next', later: 'Later', done: 'Done' });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const venture = (projectId) => {
  const n = Number(projectId);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const withVenture = (path, projectId, rest = []) => {
  const params = new URLSearchParams();
  const id = venture(projectId);
  if (id) params.set('project_id', String(id));
  for (const [k, v] of rest) if (v != null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

/** A view the landing draws; anything else (the retired `timeline` and `board` among them) is By quarter. */
export function landingView(raw) {
  return LANDING_VIEWS.some(([key]) => key === raw) ? raw : 'quarters';
}

/** Product roadmap's view, `board` unless the address says `timeline`. */
export function boardView(raw) {
  return BOARD_VIEWS.includes(raw) ? raw : 'board';
}

/** Product roadmap's phone column: the address's, else the linked item's own, else Now. */
export function boardColumn(raw, itemColumn = null) {
  if (BOARD_COLUMNS.includes(raw)) return raw;
  return BOARD_COLUMNS.includes(itemColumn) ? itemColumn : 'now';
}

/** `?item=` as a positive whole id, or null. */
export function itemParam(raw) {
  if (raw == null || !/^\d{1,12}$/.test(String(raw))) return null;
  const n = Number(raw);
  return n > 0 ? n : null;
}

/** The horizon word for a stored column, or null for one outside the four (never guessed). */
export function horizonOf(column) {
  return HORIZON[String(column ?? '').trim().toLowerCase()] ?? null;
}

/**
 * The venture the landing reads. The address's when it is one of the reader's; else the first, and `refused`
 * names the one the link asked for, so the page says so instead of swapping silently (BLR06).
 */
export function pickProject(available, requestedRaw) {
  const list = Array.isArray(available) ? available : [];
  const requested = requestedRaw == null || requestedRaw === '' ? null : Number(requestedRaw);
  const match = requested == null ? null : list.find((p) => Number(p?.id) === requested) ?? null;
  const chosen = match ?? list[0] ?? null;
  return { chosen, refused: requested != null && !match ? String(requestedRaw) : null };
}

/** "Q1 2027" → { year: 2027, q: 1 }; any other spelling is not a quarter the page can order. */
export function parseQuarter(raw) {
  const m = /^Q([1-4])\s+(\d{4})$/.exec(String(raw ?? '').trim());
  return m ? { year: Number(m[2]), q: Number(m[1]) } : null;
}

/** "Q1 2027" → "Jan – Mar 2027"; null when the quarter is not written that way. */
export function quarterRange(raw) {
  const p = parseQuarter(raw);
  if (!p) return null;
  const first = (p.q - 1) * 3;
  return `${MONTHS[first]} – ${MONTHS[first + 2]} ${p.year}`;
}

/**
 * By quarter (BLR02): the items grouped by their stored quarter, in calendar order, then any quarter written
 * another way (alphabetical, as stored), then No quarter recorded. Source order within a group. Only quarters
 * an item names are drawn: no empty quarter is invented between them.
 */
export function quarterGroups(items) {
  const groups = new Map();
  const none = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(item?.quarter ?? '').trim();
    if (!key) { none.push(item); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const rank = (key) => {
    const p = parseQuarter(key);
    return p ? p.year * 10 + p.q : Number.POSITIVE_INFINITY;
  };
  const quarters = [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, list]) => ({ key, label: key, range: quarterRange(key), items: list }));
  return { quarters, none };
}

/** Step 1 → 2: the landing, By quarter, keeping the venture; with an item, that item highlighted (route 1B). */
export function doorHref(projectId, itemId = null) {
  return withVenture('/build/roadmap', projectId, [['view', 'quarters'], ['item', itemParam(itemId)]]);
}

/** An item's sheet on Product roadmap, keeping the venture. */
export function itemSheetHref(projectId, itemId) {
  const id = itemParam(itemId);
  return id ? withVenture(`/build/product-roadmap/${id}`, projectId) : null;
}

/** BLR05B: the one first action at zero items, Product roadmap's own Add (`?add=1` opens it). */
export function addFirstHref(projectId) {
  return withVenture('/build/product-roadmap', projectId, [['add', '1']]);
}

/** The board's own address as it stands: the venture, its view and its phone column. */
export function boardHref(projectId, view, column) {
  return withVenture('/build/product-roadmap', projectId, [['view', boardView(view)], ['column', boardColumn(column)]]);
}

/**
 * Step 4 (BLR04): where the landing's Back goes. From one item, that item's sheet, named. From the board, the
 * address the board handed over in history state, if it is Product roadmap's own path; else Product roadmap
 * for the venture. A path from anywhere else is never followed.
 */
export function landingBack({ projectId, item = null, from = null } = {}) {
  if (item?.id != null) {
    const href = itemSheetHref(projectId, item.id);
    if (href) return { href, label: `Back to ${item.objective || 'the item'}`, focus: null };
  }
  const own = typeof from === 'string' && /^\/build\/product-roadmap(?:\?[A-Za-z0-9_=&%.-]*)?$/.test(from) ? from : null;
  return { href: own ?? withVenture('/build/product-roadmap', projectId), label: 'Back to Product roadmap', focus: 'door' };
}

/** "2027-02-26" → "due 26 Feb 2027"; no date → "No date"; anything else reads as written (never a made-up day). */
export function dueText(value) {
  if (value == null || String(value).trim() === '') return 'No date';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return `due ${value}`;
  return `due ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
