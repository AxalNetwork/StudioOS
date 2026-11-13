/**
 * #1077 (D536, gap 2) — the listed companies' totals, read once for both pages
 * that print them.
 *
 * `/research/markets`' Public tab lists two stores, each row labelled with its
 * source (D595): the signal companies (`signal_companies`, migration 136) and
 * SEC EDGAR's (`research_public_companies`, migration 404). The Research
 * overview's "Public" count read `signal_companies` alone, so once EDGAR's rows
 * land (migration 412) the two pages would print different totals for the same
 * thing. Both now read this one statement: the overview prints `total`, and
 * the Public tab prints each store's size and the overlap from it.
 *
 * WHAT `total` COUNTS: one row per source, as the Public tab lists them. A
 * company in both stores (an EDGAR ticker that is also a signal company's
 * symbol) is counted once in each, and `overlap` says how many such tickers
 * there are, so neither page has to pretend the two lists were merged.
 *
 * Throws when either store cannot be read; each caller states that as
 * Unreadable, never as zero.
 */
import type { Env } from '../types';

export type ListedTotals = {
  signal: { n: number; as_of: string | null };
  edgar: { n: number; as_of: string | null; overlap: number };
  total: number;
  as_of: string | null;
};

export async function readListedTotals(env: Env): Promise<ListedTotals> {
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM signal_companies) AS signal_n,
            (SELECT MAX(updated_at) FROM signal_companies) AS signal_as_of,
            (SELECT COUNT(*) FROM research_public_companies) AS edgar_n,
            (SELECT MAX(as_of) FROM research_public_companies) AS edgar_as_of,
            (SELECT COUNT(*) FROM research_public_companies
              WHERE ticker IN (SELECT symbol FROM signal_companies)) AS overlap`,
  ).first<{ signal_n: number; signal_as_of: string | null; edgar_n: number; edgar_as_of: string | null; overlap: number }>();
  const signal = { n: Number(r?.signal_n ?? 0), as_of: r?.signal_as_of ?? null };
  const edgar = { n: Number(r?.edgar_n ?? 0), as_of: r?.edgar_as_of ?? null, overlap: Number(r?.overlap ?? 0) };
  const dates = [signal.as_of, edgar.as_of].filter((d): d is string => !!d).sort();
  return { signal, edgar, total: signal.n + edgar.n, as_of: dates.length ? dates[dates.length - 1] : null };
}
