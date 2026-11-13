/**
 * D538 — which market-intelligence rows are real, in one place.
 *
 * Every connector ships a synthetic `fetchStub` so development has data, and
 * until D538 the aggregator stored those rows in production too: on
 * 4 October 2026 every one of the 237,372 rows in `market_intel_rows` was a
 * stub, and the 504 rows of `market_intel_indexes` were computed from them.
 * The house rule is that no figure the platform does not record reaches a
 * screen, so every read of either table goes through this module.
 *
 * WHAT MAKES A ROW REAL. A stub cites `https://axal.vc/market-intel/sources/<key>`
 * — a page on this site, not a provider. A live connector cites the provider
 * resource it counted (`buildLiveRows` drops a sector it cannot cite). So a
 * row is live when it carries a citation and that citation is not the stub
 * page. A row with no citation is not live either: nothing could show where
 * its number came from.
 *
 * WHAT MAKES AN INDEX REAL. An index row is a composite of rows, so it carries
 * no citation of its own. From D538 the aggregator computes indexes from live
 * rows only and stamps each one `basis = 'live'` (migration 379). Index rows
 * written before that have no basis and are never read.
 */

/** The citation every stub row carries, followed by the source key. */
export const STUB_CITATION_PREFIX = 'https://axal.vc/market-intel/sources/';

/** The `basis` an index row carries when it was computed from live rows only. */
export const LIVE_INDEX_BASIS = 'live';

/** True for a row a live connector wrote: cited, and not to the stub page. */
export function isLiveRow(row: { citation_url?: string | null }): boolean {
  const url = typeof row?.citation_url === 'string' ? row.citation_url.trim() : '';
  if (!url) return false;
  return !url.startsWith(STUB_CITATION_PREFIX);
}

/**
 * The same predicate as SQL, for `market_intel_rows`. A literal, never built
 * from a request. `instr(...) <> 1` rather than `NOT LIKE`, because `_` in a
 * LIKE pattern is a wildcard and a source key may one day contain one.
 *
 * `alias` qualifies the column when the query joins (`r.citation_url`); it
 * must be a bare identifier.
 */
export function liveRowSql(alias = ''): string {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('liveRowSql: alias must be a bare identifier');
  }
  const col = alias ? `${alias}.citation_url` : 'citation_url';
  return `(${col} IS NOT NULL AND TRIM(${col}) <> '' AND instr(TRIM(${col}), '${STUB_CITATION_PREFIX}') <> 1)`;
}

/** The predicate for `market_intel_indexes`: computed from live rows only. */
export function liveIndexSql(alias = ''): string {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('liveIndexSql: alias must be a bare identifier');
  }
  const col = alias ? `${alias}.basis` : 'basis';
  return `(${col} = '${LIVE_INDEX_BASIS}')`;
}

/** Why a sector or dimension has no figure, in words a screen can show. */
export const NO_LIVE_SOURCE_REASON = 'No live source yet for this sector';
