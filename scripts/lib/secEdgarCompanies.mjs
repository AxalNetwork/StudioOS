/**
 * SEC EDGAR's public company list → migration 404's rows (#1230, D595).
 *
 * The pure half of `../import-sec-edgar.mjs`: it reads the body of
 * `company_tickers_exchange.json` and writes SQL text. It never fetches and
 * never writes to a database; the CLI fetches, and the migration runner is
 * the only thing that ever applies the result.
 *
 * WHAT A ROW CARRIES is what EDGAR records and nothing more: the CIK, the
 * conformed name, the ticker and the exchange. EDGAR lists a company once per
 * ticker, so a CIK with several share classes appears several times; the
 * first listing EDGAR gives is the row's ticker and exchange, and the rest go
 * in `other_listings` in EDGAR's order. A listing with no exchange keeps it
 * null — "Not recorded" on the page, never a guess. Every row names its
 * source, the file's URL, its licence and the date it was read.
 *
 * NO PERSONAL DATA. The file names companies (and a few funds and trusts) by
 * their registrant name; it holds no officers or addresses, and nothing here
 * asks for any.
 */

export const EDGAR_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const EDGAR_SOURCE = 'SEC EDGAR';
export const EDGAR_LICENCE = 'US government work, not subject to copyright in the United States (17 U.S.C. § 105)';
export const EDGAR_FIELDS = ['cik', 'name', 'ticker', 'exchange'];
/** The SEC asks every automated client to name itself and a contact (sec.gov/os/accessing-edgar-data). */
export const EDGAR_USER_AGENT = 'StudioOS research importer (Axal; security@axal.vc)';
export const MIGRATION_FILE = '404_research_public_companies.sql';
export const ROWS_PER_INSERT = 100;

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A CIK as EDGAR writes it in its URLs: ten digits, zero-padded. */
export function padCik(n) {
  if (!Number.isSafeInteger(n) || n <= 0 || n > 9_999_999_999) return null;
  return String(n).padStart(10, '0');
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t.length > max || CONTROL_RE.test(t)) return null;
  return t;
}

/**
 * The file's JSON → one row per CIK, in EDGAR's order of first appearance.
 * A listing that fails a check is counted in `skipped` with its reason, never
 * repaired. A body whose `fields` are not EDGAR's four throws: the format
 * changed, and a column read in the wrong place would put a name in the
 * ticker.
 */
export function parseEdgar(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.fields) || !Array.isArray(body.data)) {
    throw new Error('Not company_tickers_exchange.json: expected { fields, data }.');
  }
  if (JSON.stringify(body.fields) !== JSON.stringify(EDGAR_FIELDS)) {
    throw new Error(`EDGAR's fields changed: expected ${EDGAR_FIELDS.join(', ')}, got ${body.fields.join(', ')}.`);
  }
  const byCik = new Map();
  const skipped = [];
  body.data.forEach((rec, i) => {
    if (!Array.isArray(rec) || rec.length !== 4) { skipped.push({ index: i, reason: 'not four fields' }); return; }
    const [rawCik, rawName, rawTicker, rawExchange] = rec;
    const cik = padCik(rawCik);
    if (!cik) { skipped.push({ index: i, reason: 'no valid CIK' }); return; }
    const name = cleanText(rawName, 200);
    if (!name) { skipped.push({ index: i, reason: 'no name' }); return; }
    const ticker = typeof rawTicker === 'string' ? rawTicker.trim().toUpperCase() : '';
    if (!TICKER_RE.test(ticker)) { skipped.push({ index: i, reason: 'no valid ticker' }); return; }
    let exchange = null;
    if (rawExchange != null) {
      exchange = cleanText(rawExchange, 40);
      if (!exchange) { skipped.push({ index: i, reason: 'unreadable exchange' }); return; }
    }
    const seen = byCik.get(cik);
    if (!seen) {
      byCik.set(cik, { cik, name, ticker, exchange, other_listings: [] });
    } else if (seen.ticker !== ticker && !seen.other_listings.some(([t]) => t === ticker)) {
      seen.other_listings.push([ticker, exchange]);
    }
  });
  return { rows: [...byCik.values()], skipped, listings: body.data.length };
}

/** A SQL string literal: quotes doubled. Control characters never reach here (`cleanText`). */
export function sqlText(v) {
  if (v == null) return 'NULL';
  const s = String(v);
  if (CONTROL_RE.test(s)) throw new Error('A control character reached the SQL writer.');
  return `'${s.replace(/'/g, "''")}'`;
}

export const TABLE_SQL = `CREATE TABLE IF NOT EXISTS research_public_companies (
  cik            TEXT PRIMARY KEY CHECK (length(cik) = 10),
  name           TEXT NOT NULL,
  ticker         TEXT NOT NULL,
  exchange       TEXT,
  other_listings TEXT,
  source_name    TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  licence        TEXT NOT NULL,
  as_of          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_public_companies_name ON research_public_companies (name);
CREATE INDEX IF NOT EXISTS idx_research_public_companies_ticker ON research_public_companies (ticker);`;

/** Migration 404's whole text, from parsed rows and the date the file was read. */
export function renderMigration({ rows, skipped, listings }, asOf) {
  if (!DATE_RE.test(String(asOf))) throw new Error(`as_of must be YYYY-MM-DD, got ${asOf}`);
  const head = [
    '-- Migration 404: US public companies from SEC EDGAR (#1230, D595).',
    '--',
    '-- WRITTEN BY scripts/import-sec-edgar.mjs. Do not edit by hand: rerun the',
    '-- importer before this file is applied, and never after (an applied',
    '-- migration is never edited).',
    '--',
    `-- Source:  ${EDGAR_SOURCE}, ${EDGAR_URL}`,
    `-- Licence: ${EDGAR_LICENCE}`,
    `-- Read:    ${asOf}`,
    `-- ${listings} listings in the file; ${rows.length} companies (one row per CIK);`,
    `-- ${skipped.length} listings skipped by the importer's checks.`,
    '--',
    '-- Each row is what EDGAR records: CIK, name, ticker, exchange, and the',
    "-- company's other tickers. Nothing else is recorded here: no country,",
    '-- sector, size or people. A table of its own, so these rows never mix',
    '-- with signal_companies and its bands (D595). INSERT OR IGNORE keyed on',
    '-- CIK: applying it twice leaves the same rows.',
    '',
    TABLE_SQL,
    '',
  ];
  const body = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT).map((r) => `(${[
      sqlText(r.cik), sqlText(r.name), sqlText(r.ticker), sqlText(r.exchange),
      sqlText(r.other_listings.length ? JSON.stringify(r.other_listings) : null),
      sqlText(EDGAR_SOURCE), sqlText(EDGAR_URL), sqlText(EDGAR_LICENCE), sqlText(asOf),
    ].join(', ')})`);
    body.push(
      'INSERT OR IGNORE INTO research_public_companies',
      '  (cik, name, ticker, exchange, other_listings, source_name, source_url, licence, as_of) VALUES',
      `${chunk.join(',\n')};`,
      '',
    );
  }
  return `${[...head, ...body].join('\n').trimEnd()}\n`;
}
