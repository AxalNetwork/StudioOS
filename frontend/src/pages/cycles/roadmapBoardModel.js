/**
 * D6036 (#6036, BD25, BD26, BD28, BD30) — Build › Product roadmap's board, as pure rules.
 *
 * Everything here reads the module read the page already holds: the strip reads `facts` (each figure is
 * the Worker's count over every item, so a paged list never makes a figure small), the board and the
 * timeline read the listed rows (`records.rows`, this page of the list) and their `keys`. Nothing is
 * filtered in the browser: Late and Unlinked are the list's own filters, set through `onQuery`.
 *
 * Words, never colour alone: Late, Blocked, Unlinked, Done, In flight and Provisional each carry a glyph.
 */

export const COLUMNS = Object.freeze([['now', 'Now'], ['next', 'Next'], ['later', 'Later'], ['done', 'Done']]);

/** The Worker's state key → the board's word and glyph (BD25's tags). */
export const STATE_TAGS = Object.freeze({
  blocked: { word: 'Blocked', glyph: '✕' },
  in_flight: { word: 'In flight', glyph: '◐' },
  provisional: { word: 'Provisional', glyph: '≈' },
  done: { word: 'Done', glyph: '✓' },
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** "2026-11-18" → "18 Nov"; anything that is not a day reads as written (never a made-up day). */
export function shortDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return value == null || value === '' ? null : String(value);
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** "2026-11-18" → { key: '2026-11', label: 'Nov 2026' }; no readable month → null (the No date tray). */
export function monthOf(value) {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(value ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { key: `${m[1]}-${m[2]}`, label: `${MONTHS[Number(m[2]) - 1]} ${m[1]}` };
}

/**
 * BD25's figure strip: Now, Next, Later, Done, Shipped this month, Late and Unlinked. A figure the read does
 * not carry reads Not recorded (never 0). Late and Unlinked toggle the list's own filter (`filter`).
 */
export function roadmapStrip(facts) {
  if (!facts || typeof facts !== 'object') return null;
  const cell = (key, label, value, sub, filter) => {
    const n = count(value);
    return { key, label, value: n, text: n == null ? 'Not recorded' : n.toLocaleString('en-US'), sub, ...(filter ? { filter } : {}) };
  };
  return [
    cell('now', 'Now', facts.now, 'items · all time'),
    cell('next', 'Next', facts.next, 'items · all time'),
    cell('later', 'Later', facts.later, 'items · all time'),
    cell('done', 'Done', facts.done, 'items · all time'),
    cell('shipped', 'Shipped this month', facts.shipped_this_month, 'items moved to Done'),
    cell('late', 'Late', facts.late, 'past target date, not Done', { key: 'late', value: 'yes' }),
    cell('unlinked', 'Unlinked', facts.unlinked, 'no theme, no KPI', { key: 'link', value: 'unlinked' }),
  ];
}

/** Whether the strip cell's filter is the list's current one. */
export const stripPressed = (query, cell) => !!cell?.filter && query?.filter?.[cell.filter.key] === cell.filter.value;

/** The query with the cell's filter on, or off when it was already on; back to the first page either way. */
export function toggleStrip(query, cell) {
  const filter = { ...(query?.filter || {}) };
  if (stripPressed(query, cell)) delete filter[cell.filter.key];
  else filter[cell.filter.key] = cell.filter.value;
  return { ...(query || {}), filter, page: 1 };
}

const text = (cell) => (cell == null ? '' : typeof cell === 'object' ? String(cell.text ?? '') : String(cell));

/** One row → one card: its title, owner, date (or Late), what it moves (or Unlinked), state, waits-on and blocks. */
export function roadmapCard(row) {
  const keys = row?.keys || {};
  const state = Object.hasOwn(STATE_TAGS, keys.state) ? keys.state : 'provisional';
  const waitsOn = typeof keys.waits_on === 'string' && keys.waits_on.trim() ? keys.waits_on : null;
  return {
    id: row?.id,
    title: text(row?.cells?.item) || 'Untitled item',
    column: String(keys.column ?? '').toLowerCase(),
    owner: text(row?.cells?.owner) || null,
    date: row?.cells?.date == null || row?.cells?.date === '' ? null : text(row.cells.date),
    late: keys.late === 'yes',
    unlinked: keys.link === 'unlinked',
    moves: text(row?.cells?.moves) || null,
    state,
    waitsOn: state === 'blocked' ? waitsOn : null,
    blocks: Number.isInteger(keys.blocks) && keys.blocks > 0 ? keys.blocks : 0,
  };
}

/**
 * The board's four columns over the listed rows, in read order. A row whose column is none of the four
 * (an old or unknown value) goes in `other`, said once under the board, never dropped silently.
 */
export function roadmapColumns(records) {
  const cards = (Array.isArray(records?.rows) ? records.rows : []).map(roadmapCard);
  return {
    columns: COLUMNS.map(([key, label]) => ({ key, label, cards: cards.filter((c) => c.column === key) })),
    other: cards.filter((c) => !COLUMNS.some(([key]) => key === c.column)),
    listed: cards.length,
    total: Number.isInteger(records?.total) ? records.total : cards.length,
  };
}

/**
 * BD26 (and BD30's phone timeline): the listed items grouped by their target month, earliest first, then
 * the No date recorded tray. Placement reads the stored date only.
 */
export function roadmapTimeline(records) {
  const cards = (Array.isArray(records?.rows) ? records.rows : []).map(roadmapCard);
  const months = new Map();
  const noDate = [];
  for (const c of cards) {
    const m = monthOf(c.date);
    if (!m) { noDate.push(c); continue; }
    if (!months.has(m.key)) months.set(m.key, { ...m, cards: [] });
    months.get(m.key).cards.push(c);
  }
  return { months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)), noDate };
}

/** The card's date line: "Late · due 12 Oct", the day, or "No date". */
export function dateLine(card) {
  if (!card.date) return 'No date';
  return card.late ? `Late · due ${shortDay(card.date)}` : shortDay(card.date);
}
