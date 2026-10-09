/** Shared read contract for the four founder cycles (D656). */
export const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'] as const;
export type CardState = (typeof CARD_STATES)[number];
export type Figure = {
  key: string; label: string; value: number | string | [number, number] | null; unit: string | null;
  delta_30d: number | null; spark: number[]; state: CardState;
  source: string | null; as_of: string | null; reason?: string | null;
};
export type ChartSpec = { kind: string; [key: string]: unknown };
export type Next = { text: string; href: string } | null;
export type Card = {
  slug: string; name: string; state: CardState; range: string;
  caption: string; series: unknown;
  next: Next; reason: string | null;
};
export type CardMeta = { slug: string; name: string; range: string; caption: string; source: string };
export type Cell = string | number | null | { text: string; tone?: string; href?: string };
export type RecordRow = { id: string | number; cells: Record<string, Cell> };
export type Records = {
  cols: Array<{ key: string; label: string }>;
  rows: RecordRow[]; total: number; page: number; page_size: number;
  filters?: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }>;
  sorts?: Array<{ key: string; label: string }>;
  add?: { text: string; href: string };
};

export const MIN_SERIES_POINTS = 3;
export const MIN_POINTS = MIN_SERIES_POINTS;
export const PAGE_SIZE = 25;

/** D659's shared per-card wrapper. */
export async function safeCard(meta: CardMeta, read: () => Promise<Omit<Card, 'slug' | 'name' | 'range' | 'caption'>>): Promise<Card> {
  try { return { slug: meta.slug, name: meta.name, range: meta.range, caption: meta.caption, ...await read() }; }
  catch (error) {
    console.error(`[cycles] ${meta.source} read failed`, error);
    return { slug: meta.slug, name: meta.name, range: meta.range, caption: meta.caption,
      state: 'unreadable', series: null, next: null, reason: `${meta.source} could not be read` };
  }
}

export async function safeFigure(meta: { key: string; label: string; unit: string; source: string },
  read: () => Promise<Omit<Figure, 'key' | 'label' | 'unit' | 'source'> & { unit?: string }>): Promise<Figure> {
  try { return { key: meta.key, label: meta.label, unit: meta.unit, source: meta.source, ...await read() }; }
  catch (error) {
    console.error(`[cycles] ${meta.source} figure read failed`, error);
    return { key: meta.key, label: meta.label, unit: meta.unit, source: meta.source,
      value: null, delta_30d: null, spark: [], state: 'unreadable', as_of: null,
      reason: `${meta.source} could not be read` };
  }
}

export function seriesState(points: number[]): CardState {
  const recorded = points.filter(point => Number.isFinite(point) && point > 0).length;
  return recorded === 0 ? 'empty' : recorded < MIN_SERIES_POINTS ? 'too_little' : 'ok';
}

export function countState(n: number, min = MIN_SERIES_POINTS): CardState {
  return n <= 0 ? 'empty' : n < min ? 'too_little' : 'ok';
}

/** D659's page-number parser. */
export function pageOf(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

export function unreadableCard(slug: string, name: string, source: string, caption: string): Card {
  return { slug, name, state: 'unreadable', range: 'Now', caption, series: [], next: null,
    reason: `${source} is unreadable. Try again later.` };
}

/** A read failure is local to its card, and never exposes a database error. */
export async function settleCard(slug: string, name: string, source: string, caption: string,
  read: () => Promise<Card>): Promise<Card> {
  try { return await read(); } catch (error) {
    console.error(`[cycles] ${source} read failed`, error);
    return unreadableCard(slug, name, source, caption);
  }
}

function cellText(cell: Cell): string {
  return cell == null ? '' : typeof cell === 'object' ? cell.text : String(cell);
}

/** Search, field:value filters, a named sort, and a stable bounded page. */
export function pageRows(rows: RecordRow[], query: { q?: string; filter?: string; sort?: string; page?: string }, pageSize = PAGE_SIZE) {
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
