/**
 * D1259 (#3282, part 6 of #2428) — the country indices model v1.1 reads, and
 * their import (migration 627).
 *
 * #2428 owner question 4 took (a): the World Bank's Worldwide Governance
 * Indicators, and the FATF and EU high-risk lists, "after a licence check".
 * THE LICENCE CHECK IS THIS REGISTRY. Each source names the licence D1259 §3
 * recorded for it, or null when none is recorded yet. A source with no
 * recorded licence is refused at import, before anything is fetched or
 * written, and the reader (`collectors.ts` `indexFacts`) counts a stored value
 * only while its edition's licence is still the one recorded here. Changing a
 * licence is a decision, not a setting: it is edited here and in D1259.
 *
 * AN EDITION IS IMPORTED ONCE AND NEVER EDITED. A second import of the same
 * edition is refused; a correction is the source's next edition.
 *
 * Every country is a `research_countries.code`, the code a market's
 * `geography_ref` holds. A code outside that directory is not stored.
 * Nothing here is logged but counts and outcomes; a refusal names its code.
 */
import type { Env } from '../../types';

export type IndexSourceKey = 'wgi' | 'fatf' | 'eu_high_risk';

export interface IndexSource {
  key: IndexSourceKey;
  name: string;
  publisher: string;
  /** `values`: fetched figures, 0–100. `list`: the countries a published list names. */
  kind: 'values' | 'list';
  /** The licence D1259 §3 recorded, or null: then the source is neither imported nor read. */
  licence: string | null;
  /** Why, in D1259's words. */
  licence_note: string;
  citation_url: string;
  /** The indicators an edition holds, with what each says. */
  indicators: Readonly<Record<string, string>>;
}

export const LICENCE_DECISION = 'D1259';

export const INDEX_SOURCES: Readonly<Record<IndexSourceKey, IndexSource>> = Object.freeze({
  wgi: {
    key: 'wgi',
    name: 'Worldwide Governance Indicators',
    publisher: 'World Bank',
    kind: 'values',
    licence: 'CC BY 4.0',
    licence_note: 'The World Bank Data Catalog lists the WGI under Creative Commons Attribution 4.0. Attribution: World Bank, Worldwide Governance Indicators.',
    citation_url: 'https://www.worldbank.org/en/publication/worldwide-governance-indicators',
    // Percentile ranks, 0 (lowest) to 100 (highest), as the World Bank API serves them.
    indicators: {
      'GE.PER.RNK': 'Government effectiveness, percentile rank',
      'RL.PER.RNK': 'Rule of law, percentile rank',
      'PV.PER.RNK': 'Political stability and absence of violence, percentile rank',
      'RQ.PER.RNK': 'Regulatory quality, percentile rank',
    },
  },
  fatf: {
    key: 'fatf',
    name: 'High-risk and other monitored jurisdictions',
    publisher: 'FATF',
    kind: 'list',
    licence: null,
    licence_note: 'Not recorded. The FATF’s terms allow reuse of its data with attribution, but they do not say whether its public statements on jurisdictions are data. The owner decides (D1259 §3).',
    citation_url: 'https://www.fatf-gafi.org/en/topics/high-risk-and-other-monitored-jurisdictions.html',
    indicators: {
      call_for_action: 'High-risk jurisdictions subject to a call for action',
      increased_monitoring: 'Jurisdictions under increased monitoring',
    },
  },
  eu_high_risk: {
    key: 'eu_high_risk',
    name: 'High-risk third countries',
    publisher: 'European Commission',
    kind: 'list',
    licence: 'EU reuse of Commission documents, with acknowledgement (Decision 2011/833/EU)',
    licence_note: 'Delegated Regulation (EU) 2016/1675 and its amendments are Commission documents, reusable with acknowledgement of the source.',
    citation_url: 'https://finance.ec.europa.eu/financial-crime/anti-money-laundering-and-countering-financing-terrorism-international-level_en',
    indicators: { listed: 'Named on the EU list of high-risk third countries' },
  },
});

export const SOURCE_KEYS = Object.keys(INDEX_SOURCES) as IndexSourceKey[];
export const isSourceKey = (s: string): s is IndexSourceKey => (SOURCE_KEYS as string[]).includes(s);
/** The sources whose licence is recorded: the only ones imported or read. */
export const recordedSources = () => SOURCE_KEYS.filter((k) => INDEX_SOURCES[k].licence !== null);

/** A refusal with its code and our own sentence (`sentence`), never a provider's text. */
export class IndexRefused extends Error {
  status: number;
  code: string;
  sentence: string;
  constructor(status: number, code: string, sentence: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EDITION = /^[0-9A-Za-z][0-9A-Za-z .\-]{0,31}$/;
const CODE = /^[A-Z]{2}$/;
const WB_BASE = 'https://api.worldbank.org/v2/country/all/indicator/';
/** The World Bank API serves at most this many rows a page; one page covers every economy. */
const WB_PER_PAGE = 20000;

async function countryCodes(env: Env): Promise<Set<string>> {
  const rows = (await env.DB.prepare('SELECT code FROM research_countries').all<{ code: string }>()).results || [];
  if (!rows.length) throw new IndexRefused(503, 'country_directory_empty', 'Research › Geographies holds no countries yet, so no index value can be matched to a market.');
  return new Set(rows.map((r) => String(r.code)));
}

function checkEdition(source: IndexSource, body: { edition?: unknown; published_on?: unknown }) {
  if (source.licence === null) {
    throw new IndexRefused(409, 'licence_not_recorded', `${source.publisher}’s ${source.name} has no recorded licence, so it is not imported or read. ${source.licence_note}`);
  }
  const edition = String(body.edition ?? '').trim();
  const publishedOn = String(body.published_on ?? '').trim();
  if (!EDITION.test(edition)) throw new IndexRefused(400, 'invalid_edition', 'Name the edition as its publisher does, for example 2024.');
  if (!DAY.test(publishedOn) || Number.isNaN(Date.parse(`${publishedOn}T00:00:00Z`))) {
    throw new IndexRefused(400, 'invalid_published_on', 'Give the day the publisher released this edition, as YYYY-MM-DD.');
  }
  return { edition, publishedOn };
}

type Value = { country: string; indicator: string; value: number };

async function store(env: Env, source: IndexSource, edition: string, publishedOn: string, values: Value[], actorId: number) {
  const exists = await env.DB.prepare('SELECT 1 AS present FROM country_index_editions WHERE source = ? AND edition = ?').bind(source.key, edition).first();
  if (exists) throw new IndexRefused(409, 'edition_imported', 'This edition is already imported. Editions are never edited; import the next one.');
  const at = new Date().toISOString();
  const licence = source.licence as string;
  // One batch is one transaction: an edition lands whole or not at all. The
  // values travel as one bound JSON array, so the statement count stays two.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO country_index_editions
        (source, edition, licence, licence_decision, published_on, citation_url, value_count, imported_by, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(source.key, edition, licence, LICENCE_DECISION, publishedOn, source.citation_url, values.length, actorId, at),
    env.DB.prepare(`INSERT INTO country_index_values (source, edition, licence, country, indicator, value, as_of)
      SELECT ?, ?, ?, json_extract(j.value, '$.country'), json_extract(j.value, '$.indicator'), json_extract(j.value, '$.value'), ?
        FROM json_each(?) j`).bind(source.key, edition, licence, publishedOn, JSON.stringify(values)),
  ]);
  return { source: source.key, edition, published_on: publishedOn, value_count: values.length, countries: new Set(values.map((v) => v.country)).size };
}

/**
 * Imports one WGI edition from the World Bank API (keyless, as
 * `market_intel/sources/world_bank.ts` already calls it). `edition` is the
 * data year the API files the figures under. Any indicator that cannot be
 * read refuses the whole edition: nothing is written.
 */
export async function importWgi(env: Env, body: { edition?: unknown; published_on?: unknown }, actorId: number, fetcher: typeof fetch = fetch) {
  const source = INDEX_SOURCES.wgi;
  const { edition, publishedOn } = checkEdition(source, body);
  if (!/^\d{4}$/.test(edition)) throw new IndexRefused(400, 'invalid_edition', 'A WGI edition is the data year, for example 2024.');
  const codes = await countryCodes(env);
  const values: Value[] = [];
  for (const indicator of Object.keys(source.indicators)) {
    let rows: unknown;
    try {
      const res = await fetcher(`${WB_BASE}${encodeURIComponent(indicator)}?format=json&per_page=${WB_PER_PAGE}&date=${edition}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      rows = ((await res.json()) as unknown[])?.[1];
    } catch {
      console.warn(`[countryIndex] wgi unreadable indicator=${indicator}`);
      throw new IndexRefused(502, 'index_unreadable', 'The World Bank could not be read. Nothing was imported. Try again in a moment.');
    }
    if (!Array.isArray(rows)) throw new IndexRefused(502, 'index_unreadable', 'The World Bank sent no figures for this edition. Nothing was imported.');
    for (const r of rows as Array<{ country?: { id?: unknown }; value?: unknown }>) {
      const country = String(r?.country?.id ?? '').toUpperCase();
      // An economy outside the directory (and every regional aggregate) is not stored; a missing figure is not a 0.
      if (!CODE.test(country) || !codes.has(country) || r?.value === null || r?.value === undefined || r?.value === '') continue;
      const value = Number(r.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) continue;
      values.push({ country, indicator, value });
    }
  }
  if (!values.length) throw new IndexRefused(422, 'edition_empty', 'This edition holds no figure for any country in Research › Geographies. Nothing was imported.');
  return store(env, source, edition, publishedOn, values, actorId);
}

/**
 * Imports one edition of a published list: the countries it names under each
 * of its indicators, as the publisher printed them. A country the list does
 * not name is stored as nothing, never as a 0.
 */
export async function importList(env: Env, key: IndexSourceKey, body: { edition?: unknown; published_on?: unknown; countries?: unknown }, actorId: number) {
  const source = INDEX_SOURCES[key];
  if (source.kind !== 'list') throw new IndexRefused(400, 'not_a_list', 'This source is fetched, not entered.');
  const { edition, publishedOn } = checkEdition(source, body);
  const given = body.countries;
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new IndexRefused(400, 'invalid_countries', 'List the countries under each of this source’s lists.');
  const codes = await countryCodes(env);
  const values: Value[] = [];
  for (const [indicator, list] of Object.entries(given as Record<string, unknown>)) {
    if (!(indicator in source.indicators)) throw new IndexRefused(400, 'invalid_countries', `${indicator} is not one of this source’s lists.`);
    if (!Array.isArray(list) || list.length > 300) throw new IndexRefused(400, 'invalid_countries', 'Each list is an array of two-letter country codes.');
    for (const raw of new Set(list.map((x) => String(x ?? '').trim().toUpperCase()))) {
      if (!CODE.test(raw) || !codes.has(raw)) throw new IndexRefused(400, 'unknown_country', `${raw.slice(0, 8)} is not a country in Research › Geographies.`);
      values.push({ country: raw, indicator, value: 100 });
    }
  }
  return store(env, source, edition, publishedOn, values, actorId);
}

/** HQ › Scoring's index card: every source, its licence and the editions stored. */
export async function indexSources(env: Env) {
  const rows = (await env.DB.prepare(`SELECT e.source, e.edition, e.licence, e.published_on, e.value_count, e.imported_at,
        (SELECT COUNT(DISTINCT v.country) FROM country_index_values v WHERE v.source = e.source AND v.edition = e.edition) AS countries
      FROM country_index_editions e ORDER BY e.published_on DESC, e.id DESC`).all<{
    source: string; edition: string; licence: string; published_on: string; value_count: number; imported_at: string; countries: number;
  }>()).results || [];
  return SOURCE_KEYS.map((key) => {
    const s = INDEX_SOURCES[key];
    const editions = rows.filter((r) => r.source === key).map((r) => ({
      edition: r.edition, published_on: r.published_on, value_count: Number(r.value_count), countries: Number(r.countries), imported_at: r.imported_at,
      // A value counts only while its edition's licence is the one recorded now.
      read: s.licence !== null && r.licence === s.licence,
    }));
    return {
      key, name: s.name, publisher: s.publisher, kind: s.kind, licence: s.licence, licence_note: s.licence_note, licence_decision: LICENCE_DECISION,
      citation_url: s.citation_url, indicators: s.indicators, editions,
    };
  });
}
