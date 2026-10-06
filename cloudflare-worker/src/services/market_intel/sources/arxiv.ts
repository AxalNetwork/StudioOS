/**
 * arXiv preprints connector (P1 free source).
 *
 * Counts recent preprints per sector via the keyless arXiv Atom API: the
 * query is limited to preprints submitted in the last 30 days (arXiv's
 * `submittedDate:[YYYYMMDDHHMM TO YYYYMMDDHHMM]` syntax), the same window
 * OpenAlex and Crossref use, so `totalResults` is a recent count, not the
 * all-time number of matching papers. One
 * real count + abstract URL per sector, parsed from the Atom feed by regex
 * (no XML dependency). Set MI_FLAG_ARXIV=live to engage fetchLive; otherwise
 * the deterministic stub keeps the pipeline exercisable in dev.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildLiveRows, fetchText, saturate, UA } from './_live';

const KEY = 'arxiv';
/** The recent window, in days — the one OpenAlex and Crossref query too. */
const WINDOW_DAYS = 30;

/** arXiv's submittedDate stamp, `YYYYMMDDHHMM` in UTC. */
export function arxivStamp(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-T:]/g, '');
}

/** `submittedDate:[from TO to]` for the last `days` days, ending `now`. */
export function arxivSubmittedWindow(now: Date, days = WINDOW_DAYS): string {
  const from = new Date(now.getTime() - days * 86_400_000);
  return `submittedDate:[${arxivStamp(from)}+TO+${arxivStamp(now)}]`;
}

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'research',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/arxiv',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'arXiv preprints',
  category: 'research',
  cadence: 'daily',
  dimensions: ['research'],
  weight: 0.55,
  daily_cap: 5000,
  status: 'live',
  fetchLive: async (_env, { sectors }) =>
    buildLiveRows({
      sectors,
      key: KEY,
      metric_key: 'research',
      perSector: async (_sector, query) => {
        const url =
          'https://export.arxiv.org/api/query?search_query=' +
          `all:%22${encodeURIComponent(query)}%22+AND+${arxivSubmittedWindow(new Date())}` +
          '&start=0&max_results=1&sortBy=submittedDate&sortOrder=descending';
        const xml = await fetchText(url, { headers: { 'User-Agent': UA } });
        const countMatch = xml.match(
          /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/,
        );
        const count = countMatch ? parseInt(countMatch[1], 10) : 0;
        const entryMatch = xml.match(/<entry>[\s\S]*?<id>([^<]+)<\/id>/);
        const id = entryMatch?.[1]?.trim();
        if (!count || !id) return null;
        return { value: saturate(count, 150), raw: count, citation_url: id };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
