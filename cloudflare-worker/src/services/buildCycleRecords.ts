/** D662's chart and record table shape for the Build modules. */
import type { Card, Figure } from './cycleCards';

export type BuildFigure = Omit<Figure, 'value'> & { value: Figure['value'] | [number, number] };
export type ChartSpec = { kind: string; [key: string]: unknown };
export type Cell = string | number | null | { text: string; tone?: string; href?: string };
/**
 * D690 (#1693): a row's `keys` are what its filters and sorts read, beside the
 * cells, never as a hidden cell. Its `edit` holds its stored values, which the
 * Edit forms prefill from.
 */
export type RowKey = string | number | null;
export type RecordRow = { id: string | number; cells: Record<string, Cell>; keys?: Record<string, RowKey>; edit?: Record<string, unknown> };
export type BuildRecords = {
  cols: Array<{ key: string; label: string }>;
  rows: RecordRow[]; total: number; page: number; page_size: number;
  filters?: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
  sorts?: Array<{ key: string; label: string }>;
  add?: { text: string; href: string };
};

export function unreadableBuildCard(slug: string, name: string, source: string, caption: string): Card {
  return { slug, name, state: 'unreadable', range: 'Now', caption, series: [], next: null,
    reason: `${source} is unreadable. Try again later.` };
}

function cellText(cell: Cell): string {
  return cell == null ? '' : typeof cell === 'object' ? cell.text : String(cell);
}

/**
 * Search, field:value filters, a named sort, and a stable bounded page.
 *
 * A filter or sort reads the row's `keys` when it has that key, else its cell.
 * A key in `orders` is ordinal: its sort follows that list (a value not in it
 * goes last) and breaks ties by the read's own order, so the alphabet never
 * decides it. `defaultSort` applies when the query sends none (D690, #1693).
 */
export function pageBuildRows(rows: RecordRow[], query: { q?: string; filter?: string; sort?: string; page?: string }, pageSize = 25,
  opts: { orders?: Record<string, readonly string[]>; defaultSort?: string } = {}) {
  const value = (row: RecordRow, key: string): Cell => row.keys && Object.hasOwn(row.keys, key) ? row.keys[key] : row.cells[key] ?? null;
  const has = (row: RecordRow, key: string) => (row.keys != null && Object.hasOwn(row.keys, key)) || Object.hasOwn(row.cells, key);
  let selected = rows;
  const q = (query.q ?? '').trim().toLocaleLowerCase();
  if (q) selected = selected.filter(row => Object.values(row.cells).some(cell => cellText(cell).toLocaleLowerCase().includes(q)));
  for (const part of (query.filter ?? '').split(',').filter(Boolean)) {
    const at = part.indexOf(':');
    if (at <= 0) continue;
    const key = part.slice(0, at); const wanted = part.slice(at + 1).toLocaleLowerCase();
    selected = selected.filter(row => cellText(value(row, key)).toLocaleLowerCase() === wanted);
  }
  const sort = query.sort || opts.defaultSort || '';
  const desc = sort.startsWith('-'); const key = desc ? sort.slice(1) : sort;
  const order = key && opts.orders && Object.hasOwn(opts.orders, key) ? opts.orders[key] : null;
  if (key && selected.some(row => has(row, key))) {
    const readOrder = new Map(rows.map((row, at) => [row, at]));
    const rank = (row: RecordRow) => { const at = order!.indexOf(cellText(value(row, key))); return at < 0 ? null : at; };
    selected = [...selected].sort((a, b) => {
      if (order) {
        const x = rank(a), y = rank(b);
        const tie = readOrder.get(a)! - readOrder.get(b)!;
        if (x == null) return y == null ? tie : 1;
        if (y == null) return -1;
        return (desc ? y - x : x - y) || tie;
      }
      const av = value(a, key), bv = value(b, key);
      if (av == null) return bv == null ? String(a.id).localeCompare(String(b.id)) : 1;
      if (bv == null) return -1;
      const x = typeof av === 'number' ? av : cellText(av).toLocaleLowerCase();
      const y = typeof bv === 'number' ? bv : cellText(bv).toLocaleLowerCase();
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return (desc ? -cmp : cmp) || String(a.id).localeCompare(String(b.id));
    });
  }
  const rawPage = Number(query.page ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  return { rows: selected.slice((page - 1) * pageSize, page * pageSize), total: selected.length, page, page_size: pageSize };
}
