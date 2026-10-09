/** D662's chart and record table shape for the Build modules. */
import type { Card, Figure } from './cycleCards';

export type BuildFigure = Omit<Figure, 'value'> & { value: Figure['value'] | [number, number] };
export type ChartSpec = { kind: string; [key: string]: unknown };
export type Cell = string | number | null | { text: string; tone?: string; href?: string };
export type RecordRow = { id: string | number; cells: Record<string, Cell> };
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

/** Search, field:value filters, a named sort, and a stable bounded page. */
export function pageBuildRows(rows: RecordRow[], query: { q?: string; filter?: string; sort?: string; page?: string }, pageSize = 25) {
  let selected = rows;
  const q = (query.q ?? '').trim().toLocaleLowerCase();
  if (q) selected = selected.filter(row => Object.values(row.cells).some(cell => cellText(cell).toLocaleLowerCase().includes(q)));
  for (const part of (query.filter ?? '').split(',').filter(Boolean)) {
    const at = part.indexOf(':');
    if (at <= 0) continue;
    const key = part.slice(0, at); const value = part.slice(at + 1).toLocaleLowerCase();
    selected = selected.filter(row => cellText(row.cells[key] ?? null).toLocaleLowerCase() === value);
  }
  const sort = query.sort ?? '';
  const desc = sort.startsWith('-'); const key = desc ? sort.slice(1) : sort;
  if (key && selected.some(row => Object.hasOwn(row.cells, key))) {
    selected = [...selected].sort((a, b) => {
      const av = a.cells[key], bv = b.cells[key];
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
