#!/usr/bin/env node
/**
 * Companies House → migration 405: UK companies for the Research directory,
 * with no personal data (D596, issue #1231).
 *
 * WHAT IT DOES. Reads Companies House's free bulk company data (the
 * "BasicCompanyDataAsOneFile" CSV, unzipped) and WRITES A MIGRATION FILE. It
 * never opens a database: the rows reach D1 through `migrate-d1`, after review.
 * The data is published under the Open Government Licence v3.0, and every row
 * carries its attribution line.
 *
 * WHAT IT READS — AND WHAT IT NEVER READS. Only these columns, by name:
 * CompanyName, CompanyNumber, CompanyCategory, CompanyStatus,
 * CountryOfOrigin, IncorporationDate, Accounts.AccountCategory and the four
 * SICCode.SicText columns. The registered-address columns (RegAddress.*) are
 * never read, so no address, postcode or care-of name can reach a row. The
 * bulk file holds no officers and no persons with significant control, and
 * nothing here asks for them. The country is the company's country of origin,
 * not its address.
 *
 * WHAT IT KEEPS. A company that is
 *   - Active (CompanyStatus);
 *   - a private or public limited company (CompanyCategory);
 *   - of United Kingdom origin (CountryOfOrigin);
 *   - not filing dormant accounts (Accounts.AccountCategory is not DORMANT);
 *   - in a SIC code `SIC_SECTORS` maps: a reviewed table of SIC 2007 codes,
 *     each to a key of the Research crosswalk's `COMPANY_SECTOR_RULES`
 *     (`cloudflare-worker/src/services/researchTaxonomy.ts`, D533), imported
 *     rather than copied, so a mapped code always reaches a taxonomy market.
 *
 * WHAT A ROW CARRIES. `uid` `ch-<company number>` (lower case), the key
 * `INSERT OR IGNORE` uses; the name as the register writes it; `website` empty
 * (Companies House records none, and the directory reads an empty website as
 * none); country `United Kingdom`, as migration 376 names GB; `founded_year`
 * from the incorporation date; `sector` the crosswalk label of the first
 * mapped SIC code; `sic_codes` every SIC code the register lists, so the
 * mapping can be checked; source `Companies House`, the company's public page,
 * the OGL line and `as_of`. Funding, revenue and headcount stay NULL.
 *
 * HOW IT CHOOSES, deterministically: per sector label, the oldest
 * incorporation first, then by company number; across labels, round-robin in
 * label order, so no sector takes the whole file; `--cap` (3,000 by default)
 * is the file's row count.
 *
 * ONE COMPANY, ONE ROW (D596). The register records no website, so the
 * website-host match cannot apply. A row is skipped at apply time when the
 * directory already holds a United Kingdom company whose lower-cased name is
 * the register name's key, with or without a "plc", "limited" or "ltd"
 * suffix (`nameKey`).
 *
 * Run (Node 22, from the repo root; the flag lets it import the crosswalk's
 * TypeScript). Download and unzip the month's file from
 * https://download.companieshouse.gov.uk/en_output.html first:
 *   node --experimental-strip-types --no-warnings scripts/import-companies-house.mjs \
 *     --from BasicCompanyDataAsOneFile-YYYY-MM-01.csv --as-of YYYY-MM-DD [--cap 3000] \
 *     [--out cloudflare-worker/sql/migrations/405_research_company_directory_companies_house.sql]
 *
 * Every function is exported and pure, and tested on fixtures in
 * `cloudflare-worker/test/research_companies_house_d596.test.mjs`; only `main`
 * reads the file.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPANY_SECTOR_RULES } from '../cloudflare-worker/src/services/researchTaxonomy.ts';

export const SOURCE = 'Companies House';
export const OGL = 'Contains public sector information licensed under the Open Government Licence v3.0.';
export const PAGE = (number) => `https://find-and-update.company-information.service.gov.uk/company/${number}`;
export const COUNTRY = 'United Kingdom';
export const MIGRATION = 'cloudflare-worker/sql/migrations/405_research_company_directory_companies_house.sql';
export const KEPT_CATEGORIES = new Set(['Private Limited Company', 'Public Limited Company']);

/** The only columns read. No RegAddress.* column is ever named here. */
export const COLUMNS = Object.freeze({
  name: 'CompanyName',
  number: 'CompanyNumber',
  category: 'CompanyCategory',
  status: 'CompanyStatus',
  origin: 'CountryOfOrigin',
  incorporated: 'IncorporationDate',
  accounts: 'Accounts.AccountCategory',
  sic: ['SICCode.SicText_1', 'SICCode.SicText_2', 'SICCode.SicText_3', 'SICCode.SicText_4'],
});

/**
 * THE REVIEWED SIC TABLE. A UK SIC 2007 code → a key of COMPANY_SECTOR_RULES.
 * A code is here only when its activity is the crosswalk label's, not merely
 * near it; anything broader (IT consultancy, "other business support") is left
 * out rather than stretched. A test holds every value to the crosswalk.
 */
export const SIC_SECTORS = Object.freeze({
  '01110': 'agriculture', // Growing of cereals, leguminous crops and oil seeds
  '01410': 'livestock farming', // Raising of dairy cattle
  '01420': 'livestock farming', // Raising of other cattle and buffaloes
  '10890': 'food processing', // Manufacture of other food products n.e.c.
  '11050': 'beverage industry', // Manufacture of beer
  '11070': 'beverage industry', // Manufacture of soft drinks; mineral waters
  '13100': 'textile industry', // Preparation and spinning of textile fibres
  '14190': 'fashion', // Manufacture of other wearing apparel and accessories
  '20130': 'other basic inorganic chemical manufacturing', // Manufacture of other inorganic basic chemicals
  '20200': 'pesticide and other agricultural chemical manufacturing', // Manufacture of pesticides and other agrochemical products
  '20420': 'cosmetics industry', // Manufacture of perfumes and toilet preparations
  '21100': 'pharmaceutical industry', // Manufacture of basic pharmaceutical products
  '21200': 'pharmaceutical industry', // Manufacture of pharmaceutical preparations
  '25400': 'weapons industry', // Manufacture of weapons and ammunition
  '26110': 'electronics industry', // Manufacture of electronic components
  '26200': 'computer hardware industry', // Manufacture of computers and peripheral equipment
  '26400': 'consumer electronics industry', // Manufacture of consumer electronics
  '29100': 'manufacture of motor vehicles', // Manufacture of motor vehicles
  '30300': 'aerospace industry', // Manufacture of air and spacecraft and related machinery
  '30400': 'defense', // Manufacture of military fighting vehicles
  '30910': 'motorcycle industry', // Manufacture of motorcycles
  '35110': 'electricity generation', // Production of electricity
  '41201': 'construction industry', // Construction of commercial buildings
  '41202': 'construction industry', // Construction of domestic buildings
  '47110': 'retail', // Retail sale in non-specialised stores with food, beverages or tobacco predominating
  '47910': 'e commerce', // Retail sale via mail order houses or via Internet
  '49100': 'rail transport', // Passenger rail transport, interurban
  '50200': 'shipping line', // Sea and coastal freight water transport
  '51101': 'airline', // Scheduled passenger air transport
  '51102': 'air transport', // Non-scheduled passenger air transport
  '55100': 'hotel', // Hotels and similar accommodation
  '58110': 'publishing', // Book publishing
  '58130': 'news media', // Publishing of newspapers
  '58210': 'video game industry', // Publishing of computer games
  '58290': 'software', // Other software publishing
  '59111': 'film production', // Motion picture production activities
  '59113': 'television production', // Television programme production activities
  '59200': 'music industry', // Sound recording and music publishing activities
  '60100': 'radio station', // Radio broadcasting
  '60200': 'broadcaster', // Television programming and broadcasting activities
  '61100': 'telecommunications', // Wired telecommunications activities
  '61200': 'mobile network operator', // Wireless telecommunications activities
  '61900': 'telecommunications', // Other telecommunications activities
  '62011': 'video game development', // Ready-made interactive leisure and entertainment software development
  '62012': 'software development', // Business and domestic software development
  '63110': 'web hosting service', // Data processing, hosting and related activities
  '64191': 'bank', // Banks
  '64192': 'savings bank', // Building societies
  '64999': 'financial services', // Financial intermediation not elsewhere classified
  '66190': 'financial services', // Activities auxiliary to financial intermediation n.e.c.
  '69102': 'law firm', // Solicitors
  '72110': 'biotechnology', // Research and experimental development on biotechnology
  '73110': 'advertising', // Advertising agencies
  '79110': 'tourism', // Travel agency activities
  '85410': 'education industry', // Post-secondary non-tertiary education
  '85421': 'education industry', // First-degree level higher education
  '86101': 'health care', // Hospital activities
  '90010': 'entertainment industry', // Performing arts
});

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const NUMBER = /^[A-Z0-9]{8}$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const AS_OF = /^\d{4}-\d{2}-\d{2}$/;

/** One CSV record → fields. Quotes may wrap a field; a doubled quote inside is one quote. */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * The header → where each read column sits. The bulk file writes some headers
 * with a leading space (" CompanyNumber"), so names are trimmed. A column this
 * file needs and the header lacks throws: a format change must never move a
 * value into the wrong field.
 */
export function headerIndex(header) {
  const at = new Map(header.map((h, i) => [h.trim(), i]));
  const need = (n) => { if (!at.has(n)) throw new Error(`The Companies House header has no ${n} column.`); return at.get(n); };
  return {
    name: need(COLUMNS.name), number: need(COLUMNS.number), category: need(COLUMNS.category),
    status: need(COLUMNS.status), origin: need(COLUMNS.origin), incorporated: need(COLUMNS.incorporated),
    accounts: need(COLUMNS.accounts), sic: COLUMNS.sic.map(need),
  };
}

const text = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** "62012 - Business and domestic software development" → "62012"; anything else → null. */
export function sicCode(v) {
  const m = /^(\d{5})\s*-/.exec(text(v));
  return m ? m[1] : null;
}

/**
 * One register record → a row, or null when the company is not kept. Only the
 * columns `headerIndex` located are read.
 */
export function toRow(fields, idx, { asOf, maxYear = Number(String(asOf).slice(0, 4)) } = {}) {
  const status = text(fields[idx.status]);
  const category = text(fields[idx.category]);
  const origin = text(fields[idx.origin]);
  const accounts = text(fields[idx.accounts]).toUpperCase();
  if (status !== 'Active' || !KEPT_CATEGORIES.has(category) || origin !== COUNTRY || accounts === 'DORMANT') return null;
  const number = text(fields[idx.number]).toUpperCase();
  const name = text(fields[idx.name]);
  if (!NUMBER.test(number) || !name || name.length > 160 || CONTROL.test(name)) return null;
  const codes = idx.sic.map((i) => sicCode(fields[i])).filter(Boolean);
  // A code counts only when its label is still a crosswalk key, so a label
  // the crosswalk drops can never write a row no market reads.
  const first = codes.find((c) => Object.hasOwn(SIC_SECTORS, c) && Object.hasOwn(COMPANY_SECTOR_RULES, SIC_SECTORS[c]));
  if (!first) return null;
  const d = DATE.exec(text(fields[idx.incorporated]));
  const year = d ? Number(d[3]) : null;
  return {
    uid: `ch-${number.toLowerCase()}`,
    number,
    name,
    founded_year: year != null && year >= 1800 && year <= maxYear ? year : null,
    incorporated: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
    sector: SIC_SECTORS[first],
    sic_codes: [...new Set(codes)].join(','),
  };
}

/**
 * The key a register name is matched on (D596): lower case, one space, and a
 * trailing "plc", "limited", "ltd" or "ltd." taken off. "TESCO PLC" → "tesco".
 */
export function nameKey(name) {
  return text(name).toLowerCase().replace(/\s+(public limited company|plc|limited|ltd\.?)$/, '').trim();
}

const byAge = (a, b) => (a.incorporated ?? '9999').localeCompare(b.incorporated ?? '9999') || a.number.localeCompare(b.number);

/** Rows → the file's rows: oldest first per sector, round-robin across sectors, capped, one per company number. */
export function selectRows(rows, cap) {
  const bySector = new Map();
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.uid)) continue;
    seen.add(r.uid);
    if (!bySector.has(r.sector)) bySector.set(r.sector, []);
    bySector.get(r.sector).push(r);
  }
  const queues = [...bySector.keys()].sort().map((k) => bySector.get(k).sort(byAge));
  const out = [];
  for (let i = 0; out.length < cap && queues.some((q) => i < q.length); i += 1) {
    for (const q of queues) {
      if (out.length >= cap) break;
      if (i < q.length) out.push(q[i]);
    }
  }
  return out;
}

/** A SQL string literal, quotes doubled. Control characters never reach here. */
export function sqlText(v) {
  if (v == null) return 'NULL';
  const s = String(v);
  if (CONTROL.test(s)) throw new Error('A control character reached the SQL writer.');
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * One row → one statement. INSERT OR IGNORE keyed on `uid` (the company
 * number), and skipped when the directory already holds the same United
 * Kingdom company by name key — one company, one row (D596).
 */
export function insertLine(r, asOf) {
  const key = sqlText(nameKey(r.name));
  return 'INSERT OR IGNORE INTO research_company_directory '
    + '(uid, name, website, country, founded_year, sector, sic_codes, source_name, source_url, source_license, as_of) '
    + `SELECT ${[sqlText(r.uid), sqlText(r.name), "''", sqlText(COUNTRY), r.founded_year ?? 'NULL', sqlText(r.sector),
      sqlText(r.sic_codes), sqlText(SOURCE), sqlText(PAGE(r.number)), sqlText(OGL), sqlText(asOf)].join(', ')} `
    + 'WHERE NOT EXISTS (SELECT 1 FROM research_company_directory d '
    + `WHERE d.country = ${sqlText(COUNTRY)} AND LOWER(TRIM(d.name)) IN `
    + `(${key}, ${key} || ' plc', ${key} || ' limited', ${key} || ' ltd', ${key} || ' ltd.', ${key} || ' public limited company'));`;
}

/** Migration 405's whole text. */
export function toMigration(rows, { asOf, cap, read = 0, kept = rows.length }) {
  if (!AS_OF.test(String(asOf))) throw new Error(`as_of must be YYYY-MM-DD, got ${asOf}`);
  return [
    `-- 405 — ${rows.length} UK companies for the Research directory from Companies House (#1231, D596).`,
    '--',
    '-- GENERATED by scripts/import-companies-house.mjs. Do not edit by hand: rerun',
    '-- the importer before this file is applied, and never after.',
    '--',
    `-- Source:  ${SOURCE} free bulk company data, read ${asOf}.`,
    `-- Licence: ${OGL}`,
    `-- ${read} register records read; ${kept} kept by the filters; cap ${cap}.`,
    '--',
    '-- Kept: Active private or public limited companies of United Kingdom origin,',
    '-- not filing dormant accounts, whose SIC code the reviewed table maps to the',
    '-- Research crosswalk. NO PERSONAL DATA: no officer, no person with significant',
    '-- control and no registered address; the country is the country of origin.',
    '-- Funding, revenue and headcount stay NULL ("Not recorded").',
    '--',
    '-- One company, one row: a row is skipped when the directory already holds a',
    '-- United Kingdom company of the same name key (D596).',
    '',
    '-- The register\'s SIC codes, so each row\'s sector can be checked against them.',
    'ALTER TABLE research_company_directory ADD COLUMN sic_codes TEXT;',
    '',
    ...rows.map((r) => insertLine(r, asOf)),
    '',
  ].join('\n');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  const from = arg('from');
  if (!from) throw new Error('--from <unzipped BasicCompanyDataAsOneFile CSV> is required.');
  const asOf = arg('as-of', new Date().toISOString().slice(0, 10));
  const cap = Number(arg('cap', '3000'));
  const out = resolve(process.cwd(), arg('out', MIGRATION));
  // Per sector, keep at most `cap` candidates while reading: the oldest are
  // the ones selectRows can take, so trimming early changes nothing it picks.
  const bySector = new Map();
  let idx = null;
  let read = 0;
  let kept = 0;
  let buf = '';
  const take = (line) => {
    if (!line) return;
    const fields = parseCsvLine(line.replace(/\r$/, ''));
    if (!idx) { idx = headerIndex(fields); return; }
    read += 1;
    const row = toRow(fields, idx, { asOf });
    if (!row) return;
    kept += 1;
    const list = bySector.get(row.sector) ?? [];
    list.push(row);
    if (list.length > cap * 2) { list.sort(byAge); list.length = cap; }
    bySector.set(row.sector, list);
  };
  for await (const chunk of createReadStream(from, { encoding: 'utf8' })) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { take(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  take(buf);
  const rows = selectRows([...bySector.values()].flat(), cap);
  writeFileSync(out, toMigration(rows, { asOf, cap, read, kept }));
  process.stdout.write(`${read} records read, ${kept} kept, ${rows.length} written → ${out}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { process.stderr.write(`import-companies-house: ${e.message}\n`); process.exit(1); });
}
