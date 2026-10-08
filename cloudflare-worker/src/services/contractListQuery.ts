/** D647 — validated list controls shared by the Contracts page and its pickers. */
export const CONTRACT_SORTS = ['created_at', 'signed_at', 'title', 'recipient', 'days_to_sign'] as const;
export class ContractQueryError extends Error {}

export function contractPage(query: Record<string, string>) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw)) throw new ContractQueryError(`${key} must be an integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new ContractQueryError(`${key} must be between ${min} and ${max}`);
    }
    return value;
  };
  const q = (query.q || '').trim();
  if (q.length > 200) throw new ContractQueryError('Search is at most 200 characters');
  return { limit: integer('limit', 50, 1, 500), offset: integer('offset', 0, 0, 1_000_000), q };
}

export function contractOrder(query: Record<string, string>) {
  const sort = query.sort || 'created_at';
  const direction = query.direction || 'desc';
  if (!CONTRACT_SORTS.includes(sort as typeof CONTRACT_SORTS[number])) throw new ContractQueryError('Unknown contract sort');
  if (direction !== 'asc' && direction !== 'desc') throw new ContractQueryError('Direction must be asc or desc');
  return { sort: sort as typeof CONTRACT_SORTS[number], direction };
}

type SortableContract = { id: number; uid: string; source: string; title: string; recipient_email: string | null; created_at: string | null; signed_at: string | null; days_to_sign: number | null };
export function orderContracts<T extends SortableContract>(rows: T[], sort: typeof CONTRACT_SORTS[number], direction: string): T[] {
  const value = (r: T): string | number | null => {
    if (sort === 'days_to_sign') return r.days_to_sign;
    if (sort === 'created_at' || sort === 'signed_at') {
      const raw = r[sort];
      const time = raw ? Date.parse(raw) : NaN;
      return Number.isFinite(time) ? time : null;
    }
    return (sort === 'recipient' ? r.recipient_email : r.title)?.toLowerCase() ?? null;
  };
  return rows.sort((a, b) => {
    const av = value(a), bv = value(b);
    // Missing measurements stay last in either direction.
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const cmp = av === bv ? 0 : av! < bv! ? -1 : 1;
    if (cmp) return direction === 'asc' ? cmp : -cmp;
    return a.source.localeCompare(b.source) || a.id - b.id || a.uid.localeCompare(b.uid);
  });
}

/** SQL LIKE metacharacters in a person's query are literal search characters. */
export function contractLike(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}
