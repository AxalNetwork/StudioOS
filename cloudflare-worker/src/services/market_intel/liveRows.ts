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

function qualified(alias: string, fn: string): string {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`${fn}: alias must be a bare identifier`);
  }
  return alias ? `${alias}.` : '';
}

/**
 * D7707 — when a row was fetched. A row written before D7707 has no
 * `retrieved_at`, and its `ts` was its fetch time, so that is its retrieval
 * time. A literal, never built from a request.
 */
export function retrievedAtSql(alias = ''): string {
  const p = qualified(alias, 'retrievedAtSql');
  return `COALESCE(${p}retrieved_at, ${p}ts)`;
}

/** The same rule in code, for a row already read. */
export function retrievedAt(row: { retrieved_at?: string | null; ts: string }): string {
  return row.retrieved_at || row.ts;
}

/**
 * D7707 — the identity of one observation: source, sector, geo, metric, and
 * the period measured, or the UTC day of `ts` where no period is recorded.
 * The same figure fetched by several runs (a World Bank year read every six
 * hours) is one observation; for #7708 to count with.
 * A literal, never built from a request.
 */
export function observationKeySql(alias = ''): string {
  const p = qualified(alias, 'observationKeySql');
  return `(${p}source_key || '|' || ${p}sector || '|' || COALESCE(${p}geo, 'global') || '|' || ${p}metric_key || '|' || `
    + `CASE WHEN ${p}observed_period IS NOT NULL THEN 'p:' || ${p}observed_period ELSE 'd:' || substr(${p}ts, 1, 10) END)`;
}

/** `COUNT(DISTINCT …)` over `observationKeySql`. */
export function distinctObservationsSql(alias = ''): string {
  return `COUNT(DISTINCT ${observationKeySql(alias)})`;
}

/** The same identity in code. `ts` is an ISO UTC stamp, so its first ten characters are its UTC day. */
export function observationKey(row: {
  source_key: string; sector: string; geo?: string | null; metric_key: string;
  observed_period?: string | null; ts: string;
}): string {
  const when = row.observed_period != null ? `p:${row.observed_period}` : `d:${String(row.ts).slice(0, 10)}`;
  return [row.source_key, row.sector, row.geo ?? 'global', row.metric_key, when].join('|');
}

/** How many distinct observations `rows` hold. */
export function countDistinctObservations(rows: Parameters<typeof observationKey>[0][]): number {
  return new Set(rows.map(observationKey)).size;
}
