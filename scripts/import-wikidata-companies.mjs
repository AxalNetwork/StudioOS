#!/usr/bin/env node
/**
 * Wikidata → migration 403: thousands more companies for the Research
 * directory, by sector and country (D537, issue #1229).
 *
 * WHAT IT DOES. Queries Wikidata's public SPARQL endpoint and WRITES A
 * MIGRATION FILE. It never opens a database: the rows reach D1 the way every
 * other row does, through `migrate-d1`, after review.
 *
 * WHAT IT SELECTS. An item with
 *   - an official website (P856),
 *   - a country (P17), resolving to exactly one country,
 *   - an industry (P452) whose English label the Research crosswalk maps to a
 *     taxonomy market — a key of `COMPANY_SECTOR_RULES` in
 *     `cloudflare-worker/src/services/researchTaxonomy.ts` (D533). The
 *     dictionary is imported, not copied, so the importer and the Worker
 *     cannot disagree about which industries count,
 *   - an English label (the row's name),
 *   - and no dissolution date (P576): the directory lists companies, not
 *     their histories.
 * The inception year (P571) is read where Wikidata records it.
 *
 * WHAT IT DOES NOT TAKE. Funding, revenue, headcount, valuation and every
 * other figure stay NULL: this pull reads identity fields only, and the
 * directory already prints "Not recorded" for a null (D534). Nothing is
 * inferred, rounded or defaulted.
 *
 * HOW IT CHOOSES, deterministically, so a re-run on the same Wikidata gives
 * the same file:
 *   - per industry, items in descending order of sitelinks (how many
 *     Wikipedias describe them), then by Q-id;
 *   - across industries, round-robin in crosswalk-label order, so no single
 *     industry (software, banks) takes the whole cap;
 *   - an item already in migration 228 is skipped, and an item two industries
 *     both offer is taken once, under the first;
 *   - the cap (`--cap`, 3,000 by default) is the whole file's row count.
 * For one row:
 *   - website: https before http, then the shortest, then alphabetical;
 *   - country: the country's ISO 3166-1 code (P297) names it as migration
 *     376's `research_countries` does, so the crosswalk maps it; a country
 *     that list lacks keeps Wikidata's English label. An item whose best-rank
 *     countries are two different countries is skipped rather than guessed;
 *   - founded_year: the earliest P571 year, kept only from 1000 to the pull's
 *     year;
 *   - sector: the industry's English label as Wikidata spells it, the form
 *     migration 228 stores and the crosswalk reads.
 *
 * Run (Node 22, from the repo root; the flag lets it import the crosswalk's
 * TypeScript, and NODE_USE_ENV_PROXY routes fetch through HTTPS_PROXY where
 * one is set):
 *   NODE_USE_ENV_PROXY=1 node --experimental-strip-types --no-warnings \
 *     scripts/import-wikidata-companies.mjs [--cap 3000] [--per-industry 400] \
 *     [--as-of YYYY-MM-DD] [--out cloudflare-worker/sql/migrations/403_research_company_directory_wikidata.sql]
 *
 * Every function the file is built from is exported and pure, and tested on
 * fixtures in `cloudflare-worker/test/research_wikidata_companies_d537.test.mjs`;
 * only `main` touches the network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPANY_SECTOR_RULES, normalizeLabel } from '../cloudflare-worker/src/services/researchTaxonomy.ts';

export const ENDPOINT = 'https://query.wikidata.org/sparql';
export const USER_AGENT = 'StudioOS-research-importer/1.0 (https://github.com/AxalNetwork/StudioOS; D537)';
export const SOURCE_NAME = 'Wikidata';
/** Migration 228's licence line, verbatim, so every directory row reads the same. */
export const LICENCE = 'CC0 (Wikidata data); website links are references';
export const DEFAULT_CAP = 3000;
export const DEFAULT_PER_INDUSTRY = 400;
export const DEFAULT_OUT = 'cloudflare-worker/sql/migrations/403_research_company_directory_wikidata.sql';
const MIGRATION_228 = 'cloudflare-worker/sql/migrations/228_research_company_directory.sql';
const MIGRATION_376 = 'cloudflare-worker/sql/migrations/376_research_taxonomy.sql';

/** A Wikidata item id. Checked before it reaches a query string. */
const QID = /^Q[1-9]\d*$/;

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------

/** The crosswalk's normalised industry labels, sorted. */
export function crosswalkKeys(rules = COMPANY_SECTOR_RULES) {
  return Object.keys(rules).sort();
}

/**
 * The English labels to look industries up by. A key is normalised (lower
 * case, hyphens as spaces), so "e commerce" is looked up as itself and as
 * "e-commerce"; `parseIndustries` keeps only what normalises back to a key.
 */
export function industryLabelCandidates(keys = crosswalkKeys()) {
  const out = new Set();
  for (const k of keys) {
    out.add(k);
    if (k.includes(' ')) out.add(k.replace(/ /g, '-'));
  }
  return [...out].sort();
}

/** A string as a SPARQL literal: backslash and double quote escaped, no line breaks. */
export function sparqlString(s) {
  return `"${String(s).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Industries whose English label is one of `labels` and which some item uses as P452. */
export function industryQuery(labels) {
  const values = labels.map((l) => `${sparqlString(l)}@en`).join(' ');
  return `SELECT DISTINCT ?ind ?label WHERE {
  VALUES ?label { ${values} }
  ?ind rdfs:label ?label .
  FILTER EXISTS { ?any wdt:P452 ?ind }
}`;
}

/**
 * One industry's companies, most-described first. Rows multiply per website,
 * country and inception value; `collectCompanies` folds them back to items.
 */
export function companyQuery(industryQid, rowLimit) {
  if (!QID.test(String(industryQid))) throw new Error(`not a Wikidata item id: ${industryQid}`);
  const limit = Number(rowLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20000) throw new Error(`row limit out of range: ${rowLimit}`);
  return `SELECT ?item ?name ?website ?country ?countryLabel ?cc ?inception ?links WHERE {
  ?item wdt:P452 wd:${industryQid} ;
        wdt:P856 ?website ;
        wdt:P17 ?country ;
        wikibase:sitelinks ?links ;
        rdfs:label ?name .
  FILTER(LANG(?name) = "en")
  FILTER NOT EXISTS { ?item wdt:P576 ?dissolved }
  ?country rdfs:label ?countryLabel .
  FILTER(LANG(?countryLabel) = "en")
  OPTIONAL { ?country wdt:P297 ?cc }
  OPTIONAL { ?item wdt:P571 ?inception }
}
ORDER BY DESC(?links) ?item
LIMIT ${limit}`;
}

// ---------------------------------------------------------------------------
// Results → rows.
// ---------------------------------------------------------------------------

const val = (b, k) => (b?.[k]?.value ?? null);
/** "http://www.wikidata.org/entity/Q42" → "Q42"; anything else → null. */
export function qidOf(uri) {
  const m = /\/entity\/(Q[1-9]\d*)$/.exec(String(uri ?? ''));
  return m ? m[1] : null;
}

/** The industry bindings, kept only where the label normalises to a crosswalk key. */
export function parseIndustries(bindings, keys = crosswalkKeys()) {
  const wanted = new Set(keys);
  const seen = new Map();
  for (const b of bindings) {
    const qid = qidOf(val(b, 'ind'));
    const label = val(b, 'label');
    if (!qid || !label) continue;
    const key = normalizeLabel(label);
    // Keyed on the Q-id, so an industry is kept once. An item has one English
    // label, so it cannot answer to two keys.
    if (!wanted.has(key)) continue;
    seen.set(qid, { qid, label, key });
  }
  return [...seen.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.qid.localeCompare(b.qid)));
}

/** Rows of one company query, folded into one record per item, in query order. */
export function collectCompanies(bindings) {
  const byQid = new Map();
  for (const b of bindings) {
    const qid = qidOf(val(b, 'item'));
    if (!qid) continue;
    let c = byQid.get(qid);
    if (!c) {
      c = { qid, name: val(b, 'name'), links: Number(val(b, 'links') ?? 0), websites: new Set(), countries: new Map(), inceptions: new Set() };
      byQid.set(qid, c);
    }
    const w = val(b, 'website');
    if (w) c.websites.add(w);
    const country = qidOf(val(b, 'country'));
    if (country) {
      const prev = c.countries.get(country);
      c.countries.set(country, { label: val(b, 'countryLabel') ?? prev?.label ?? null, code: val(b, 'cc') ?? prev?.code ?? null });
    }
    const inc = val(b, 'inception');
    if (inc) c.inceptions.add(inc);
  }
  return [...byQid.values()];
}

/** Printable text: control characters removed, whitespace collapsed. */
export function cleanText(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** One website, or null: http(s) only, https first, then shortest, then alphabetical. */
export function pickWebsite(websites) {
  const ok = [...websites].map(cleanText).filter((w) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(w));
  ok.sort((a, b) => {
    const sa = /^https:/i.test(a) ? 0 : 1;
    const sb = /^https:/i.test(b) ? 0 : 1;
    return sa - sb || a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  });
  return ok[0] ?? null;
}

/** The earliest inception year from 1000 to `maxYear`, or null. */
export function pickYear(inceptions, maxYear) {
  const years = [...inceptions]
    .map((t) => /^\+?(\d{4})-/.exec(String(t)))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((y) => y >= 1000 && y <= maxYear);
  return years.length ? Math.min(...years) : null;
}

/**
 * One country name, or null when there is none or the item's countries are
 * two different countries. `canonical` maps an ISO code to the name
 * migration 376 gives it.
 */
export function pickCountry(countries, canonical) {
  const names = new Set();
  for (const { label, code } of countries.values()) {
    const name = (code && canonical.get(String(code).toUpperCase())) || cleanText(label);
    if (name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : null;
}

/** A directory row for one company under one industry, or null when a required field is missing. */
export function toRow(company, industry, { canonical, asOf }) {
  const name = cleanText(company.name);
  const website = pickWebsite(company.websites);
  const country = pickCountry(company.countries, canonical);
  if (!QID.test(company.qid) || !name || !website || !country) return null;
  return {
    uid: company.qid.toLowerCase(),
    name,
    website,
    country,
    founded_year: pickYear(company.inceptions, Number(asOf.slice(0, 4))),
    sector: cleanText(industry.label),
    source_name: SOURCE_NAME,
    source_url: `https://www.wikidata.org/wiki/${company.qid}`,
    source_license: LICENCE,
    as_of: asOf,
    links: company.links,
  };
}

/**
 * The rows the file holds: round-robin across industries in crosswalk-label
 * order, each industry's list in its own order, until `cap`. A uid in
 * `exclude` (migration 228's) or already taken is passed over.
 */
export function selectRows(perIndustry, cap, exclude = new Set()) {
  const taken = new Set();
  const out = [];
  const queues = perIndustry.map((p) => ({ rows: p.rows, i: 0 }));
  let progressed = true;
  while (out.length < cap && progressed) {
    progressed = false;
    for (const q of queues) {
      while (q.i < q.rows.length) {
        const r = q.rows[q.i++];
        if (exclude.has(r.uid) || taken.has(r.uid)) continue;
        taken.add(r.uid);
        out.push(r);
        progressed = true;
        break;
      }
      if (out.length >= cap) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The migration.
// ---------------------------------------------------------------------------

/** A value as a SQLite literal: NULL, an integer, or a single-quoted string. */
export function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`not an integer: ${v}`);
    return String(v);
  }
  return `'${cleanText(v).replace(/'/g, "''")}'`;
}

export const COLUMNS = ['uid', 'name', 'website', 'country', 'founded_year', 'sector', 'source_name', 'source_url', 'source_license', 'as_of'];

/** One INSERT OR IGNORE per row, keyed on uid as migration 228's are. */
export function insertLine(row) {
  return `INSERT OR IGNORE INTO research_company_directory (${COLUMNS.join(',')}) VALUES (${COLUMNS.map((c) => sqlValue(row[c])).join(',')});`;
}

/** The whole migration file: a header that says how it was made, then the rows. */
export function toMigration(rows, { asOf, cap, perIndustry, industries }) {
  const bySector = new Map();
  const byCountry = new Map();
  for (const r of rows) {
    bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + 1);
    byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(', ');
  const header = [
    `-- 403 — ${rows.length} more Research directory companies from Wikidata, by sector and country (D537, issue #1229).`,
    '--',
    '-- GENERATED by scripts/import-wikidata-companies.mjs. Do not edit by hand: change',
    '-- the importer and run it again. It queried https://query.wikidata.org/sparql',
    `-- on ${asOf} and wrote this file; it never opened a database.`,
    '--',
    '-- Selection: an official website (P856), exactly one country (P17), an industry',
    "-- (P452) the Research crosswalk maps (COMPANY_SECTOR_RULES, D533), an English",
    '-- label, and no dissolution date (P576). Founded year is the earliest P571 year.',
    `-- Order: most sitelinks first within an industry, round-robin across ${industries} industries,`,
    `-- at most ${perIndustry} candidates per industry, ${cap} rows in all. Rows already in`,
    '-- migration 228 are skipped.',
    '--',
    '-- Every row cites its Wikidata entity (source_url) under the CC0 licence line',
    '-- migration 228 uses. Funding, revenue, headcount and every other figure are',
    '-- left NULL: this pull reads identity fields only, and the directory prints',
    '-- "Not recorded" for a null (D534).',
    '--',
    '-- INSERT OR IGNORE keyed on uid (the Q-id in lower case), as 228 does, so',
    '-- applying this file twice adds nothing the second time.',
    '--',
    `-- Largest sectors: ${top(bySector, 12)}.`,
    `-- Largest countries: ${top(byCountry, 12)}.`,
    '',
  ];
  return `${header.join('\n')}${rows.map(insertLine).join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Inputs from the repo.
// ---------------------------------------------------------------------------

/** Migration 228's uids, so a company already in the directory is not offered again. */
export function existingUids(root = process.cwd()) {
  const sql = readFileSync(resolve(root, MIGRATION_228), 'utf8');
  return new Set([...sql.matchAll(/VALUES \('(q[1-9]\d*)'/g)].map((m) => m[1]));
}

/** Migration 376's research_countries: ISO code → name. */
export function canonicalCountries(root = process.cwd()) {
  const sql = readFileSync(resolve(root, MIGRATION_376), 'utf8');
  return new Map([...sql.matchAll(/\('([A-Z]{2})','([^']+)','[^']+'\)/g)].map((m) => [m[1], m[2]]));
}

// ---------------------------------------------------------------------------
// The network, and the run.
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, { attempts = 4 } = {}) {
  for (let i = 1; ; i++) {
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ query })}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
    });
    if (res.ok) return (await res.json()).results.bindings;
    if (i >= attempts || ![429, 500, 502, 503, 504].includes(res.status)) {
      throw new Error(`Wikidata answered ${res.status} ${res.statusText}`);
    }
    await sleep(2000 * 2 ** (i - 1));
  }
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  const asOf = arg('as-of', new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD: ${asOf}`);
  const cap = Number(arg('cap', DEFAULT_CAP));
  const perIndustry = Number(arg('per-industry', DEFAULT_PER_INDUSTRY));
  const out = arg('out', DEFAULT_OUT);
  const canonical = canonicalCountries();
  const exclude = existingUids();

  const industries = parseIndustries(await sparql(industryQuery(industryLabelCandidates())));
  console.error(`[wikidata] ${industries.length} industries match the crosswalk`);
  const lists = [];
  for (const ind of industries) {
    await sleep(1000); // one request a second: Wikidata's query service is shared
    const rows = collectCompanies(await sparql(companyQuery(ind.qid, perIndustry * 4)))
      .map((c) => toRow(c, ind, { canonical, asOf }))
      .filter(Boolean)
      .slice(0, perIndustry);
    console.error(`[wikidata] ${ind.label} (${ind.qid}): ${rows.length}`);
    lists.push({ industry: ind, rows });
  }
  const rows = selectRows(lists, cap, exclude);
  writeFileSync(out, toMigration(rows, { asOf, cap, perIndustry, industries: industries.length }));
  console.error(`[wikidata] wrote ${rows.length} rows to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`✖ import-wikidata-companies: ${err?.message || err}`);
    process.exit(1);
  });
}
