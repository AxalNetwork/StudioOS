#!/usr/bin/env node
/**
 * D7316 (#7316): compile a reviewed Wikidata company snapshot into additive SQL.
 * The compiler is offline: source bytes, existing identities, dates, exclusions
 * and pinned primary-source company reviews are explicit inputs. It never opens
 * D1 or fetches a company website.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPANY_SECTOR_RULES, COUNTRY_ALIASES, normalizeLabel } from '../cloudflare-worker/src/services/researchTaxonomy.ts';

export const SOURCE_NAME = 'Wikidata';
export const LICENCE = 'CC0-1.0';
export const MIN_TOTAL = 25000;
export const MIN_COUNTRIES = 50;
export const MAX_STATEMENT_BYTES = 90000; // D1's statement limit is 100,000 bytes.
export const REGION_MIN = Object.freeze({
  'North America': 1000, Europe: 1000, Asia: 1000,
  'Latin America': 250, Africa: 250, 'Middle East': 250, Oceania: 250,
});
const QID = /^Q[1-9]\d*$/;
const BLOCKED_HOSTS = new Set(['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'youtu.be', 'tiktok.com', 'wikipedia.org', 'wikidata.org', 'wikimedia.org',
  'crunchbase.com', 'bloomberg.com', 'google.com', 'goo.gl', 'linktr.ee', 'archive.org',
  'fandom.com', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'notion.site']);
const COUNTRY_BASIS = 'Wikidata P17 country association; not a verified headquarters location.';
const VERIFICATION_SCOPE = 'Admission requires a pinned primary-source company-identity review. Imported Wikidata fields remain source-reported; current operation is not asserted.';
const STATUS_NOTE = 'No active-status claim. Missing Wikidata P576 does not establish that a company is operating.';
// ISO 3166-1 alpha-2 assignments; Intl.DisplayNames also accepts non-ISO regions.
const ISO_CODES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const text = (v) => typeof v === 'string' ? v.replace(/\s+/gu, ' ').trim() : '';
const sortedObject = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => cmp(a, b)));
const hash = (v) => createHash('sha256').update(v).digest('hex');
const stable = (v) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? sortedObject(x) : x);
const canonicalQid = (v) => QID.test(String(v ?? '').toUpperCase()) ? String(v).toUpperCase() : null;
const unique = (a) => [...new Set(a)].sort(cmp);
// SQL emitters accept only these exact, unchanged objects from prepareSnapshot.
// Copying audit JSON or adding a company_review property cannot mint admission.
const admittedRows = new WeakMap();

/** Pin the complete parsed candidate, sorting object keys but preserving array order. */
export function candidateSha256(row) { return hash(stable(row)); }

export function normalizeName(name) {
  return text(name).normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}
export function normalizeDomain(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value.trim())) return null;
  try {
    const url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!host.includes('.') || isIP(host) || /\.(?:example|invalid|test|localhost)$/u.test(host)) return null;
    return host;
  } catch { return null; }
}
function blockedHost(host) {
  return [...BLOCKED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
}
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function validRetrieved(value, asOf) {
  return typeof value === 'string' && /^(?:\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00))?$/u.test(value)
    && validDay(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && value.slice(0, 10) <= asOf
    && (value.length === 10 || new Date(value).toISOString().slice(0, 19) === value.slice(0, 19));
}
function canonicalRegion(region) {
  return Object.keys(REGION_MIN).find((r) => normalizeLabel(r) === normalizeLabel(text(region))) ?? null;
}
function validCode(code) {
  return ISO_CODES.has(code);
}

function readCompanyReviews(ledger, asOf) {
  if (!Array.isArray(ledger)) throw new Error('--company-reviews is required and must be an array of explicit company-identity decisions');
  const reviews = new Map();
  for (const review of ledger) {
    const qid = canonicalQid(review?.qid), identity = review?.reviewed_identity;
    if (!qid || !['include', 'hold', 'exclude'].includes(review.decision)
      || !/^[a-f0-9]{64}$/u.test(review.candidate_sha256 ?? '')
      || !identity || !['name', 'website', 'country'].every((key) => typeof identity[key] === 'string' && text(identity[key]))
      || !validCode(identity.country_code) || !text(review.entity_kind) || !text(review.notes)
      || !validRetrieved(review.reviewed_at, asOf)
      || !/^https?:\/\//u.test(review.primary_url ?? '') || !normalizeDomain(review.primary_url)
      || blockedHost(normalizeDomain(review.primary_url))) {
      throw new Error(`Invalid company review ${qid ?? '(missing Q-id)'}: decision, candidate SHA-256, pinned identity, entity kind, primary URL, review date and evidence notes are required`);
    }
    if (reviews.has(qid)) throw new Error(`Repeated company review ${qid}; consolidate the ledger before compiling`);
    reviews.set(qid, review);
  }
  return reviews;
}

function companyReviewHold(row, reviews) {
  const review = reviews.get(row.source_qid);
  if (!review) return 'company_review_missing';
  if (review.decision !== 'include') return `company_review_${review.decision}`;
  if (review.entity_kind !== 'company') return 'company_review_noncompany';
  if (!['name', 'website', 'country', 'country_code'].every((key) => review.reviewed_identity[key] === row.source_identity[key])) {
    return 'company_review_identity_mismatch';
  }
  if (review.candidate_sha256 !== row.candidate_sha256) return 'company_review_candidate_mismatch';
  return null;
}

/** A bare Wikidata time string can have decade/century precision: do not parse its year. */
export function foundedYear(statements, asOf) {
  if (!Array.isArray(statements) || !statements.length) return null;
  const current = statements.filter((s) => s?.rank !== 'deprecated');
  if (!current.length) return null;
  const preferred = current.filter((s) => s.rank === 'preferred');
  const years = [];
  for (const s of preferred.length ? preferred : current) {
    const match = /^\+?(\d{4})-\d{2}-\d{2}T/u.exec(s.time ?? s.value ?? '');
    if (!match || !Number.isInteger(s.precision) || s.precision < 9 || s.precision > 14
      || (s.before ?? 0) !== 0 || (s.after ?? 0) !== 0) return null;
    const year = Number(match[1]);
    if (year < 1 || year > Number(asOf.slice(0, 4))) return null;
    years.push(year);
  }
  return new Set(years).size === 1 ? years[0] : null;
}

export function readExisting(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.existing) || !Array.isArray(snapshot.countries) || !Array.isArray(snapshot.overrides)) {
    throw new Error('--existing must contain {existing, countries, overrides}; migration text is not an identity snapshot');
  }
  const countries = new Map();
  const aliases = new Map(Object.entries(COUNTRY_ALIASES));
  for (const c of snapshot.countries) {
    if (!validCode(c.code) || !text(c.name) || !Object.hasOwn(REGION_MIN, c.region) || countries.has(c.code)) {
      throw new Error(`Invalid or repeated existing country ${c.code}`);
    }
    countries.set(c.code, { code: c.code, name: text(c.name), region: c.region });
    aliases.set(normalizeLabel(c.name), c.code);
  }
  const overrides = new Map();
  for (const o of snapshot.overrides) {
    const key = `${o.kind}|${o.raw_value}`;
    const targets = overrides.get(key) ?? [];
    targets.push(o.target ?? '');
    overrides.set(key, unique(targets));
  }
  for (const [key, targets] of overrides) {
    if (key.startsWith('company_country|')) {
      const identityAlias = normalizeLabel(key.slice('company_country|'.length));
      if (targets.length === 1 && validCode(targets[0])) aliases.set(identityAlias, targets[0]);
      else aliases.delete(identityAlias);
    }
  }
  return { rows: snapshot.existing, countries, aliases, overrides };
}
function countryCode(row, aliases) {
  return validCode(row.country_code) ? row.country_code : aliases.get(normalizeLabel(text(row.country))) ?? null;
}
function nameKeys(row, aliases) {
  const name = normalizeName(row.name);
  if (!name) return [];
  const code = countryCode(row, aliases);
  const raw = normalizeLabel(text(row.country));
  return [code ? `${name}|iso:${code}` : null, raw ? `${name}|raw:${raw}` : null].filter(Boolean);
}

/** Deduplicate against raw live identity rows, and within the incoming snapshot. */
export function dedupe(rows, existing = [], aliases = new Map(Object.entries(COUNTRY_ALIASES))) {
  const uids = new Set(), domains = new Set(), names = new Set();
  for (const row of existing) {
    if (row.uid) uids.add(String(row.uid).toLowerCase());
    if (row.source_qid) uids.add(String(row.source_qid).toLowerCase());
    const qid = /\/wiki\/(Q[1-9]\d*)$/u.exec(row.source_url ?? '')?.[1];
    if (qid) uids.add(qid.toLowerCase());
    const domain = normalizeDomain(row.website ?? row.domain);
    if (domain) domains.add(domain);
    for (const key of nameKeys(row, aliases)) names.add(key);
    for (const alias of row.aliases ?? []) for (const key of nameKeys({ ...row, name: alias }, aliases)) names.add(key);
  }
  const accepted = [], rejected = [];
  const report = { duplicate_by_id: 0, duplicate_by_domain: 0, duplicate_by_name_country: 0 };
  for (const row of [...rows].sort((a, b) => cmp(a.uid, b.uid) || cmp(stable(a), stable(b)))) {
    const uid = String(row.uid).toLowerCase();
    const domain = normalizeDomain(row.website ?? row.domain);
    const keys = nameKeys(row, aliases);
    const reason = uids.has(uid) ? 'duplicate_by_id' : domains.has(domain) ? 'duplicate_by_domain'
      : keys.some((k) => names.has(k)) ? 'duplicate_by_name_country' : null;
    if (reason) { report[reason]++; rejected.push({ uid, name: row.name, candidate_sha256: row.candidate_sha256 ?? candidateSha256(row), reason }); continue; }
    uids.add(uid); if (domain) domains.add(domain); for (const key of keys) names.add(key);
    accepted.push({ ...row, uid, domain });
  }
  return { accepted, rejected, report };
}

export function normalizeSnapshotRow(raw, observed, asOf, exclusions = new Map()) {
  const qid = canonicalQid(raw?.source_qid ?? raw?.uid);
  const candidateHash = candidateSha256(raw);
  const reject = (reason) => ({ rejection: { uid: qid?.toLowerCase() ?? text(raw?.uid), name: text(raw?.name), candidate_sha256: candidateHash, reason } });
  if (!qid || (raw.uid && canonicalQid(raw.uid) !== qid)) return reject('invalid_or_conflicting_source_id');
  if (exclusions.has(qid)) return reject(`quality_exclusion: ${exclusions.get(qid).reason}`);
  if (raw.source_name !== SOURCE_NAME || raw.source_license !== LICENCE || raw.source_url !== `https://www.wikidata.org/wiki/${qid}`) return reject('invalid_source_provenance');
  const types = unique((raw.source_instance_of_qids ?? []).map(canonicalQid).filter(Boolean));
  if ((raw.source_dissolution_values ?? []).length || raw.dissolution_date) return reject('explicit_dissolution');
  const name = text(raw.name), code = raw.country_code;
  if (!name || name.length > 500 || /^Q\d+$/iu.test(name) || !normalizeName(name) || /[\u0000-\u001f\u007f]/u.test(raw.name)) return reject('invalid_name');
  if (!validCode(code) || !text(raw.country) || !canonicalQid(raw.source_country_qid)) return reject('missing_country_evidence');
  const country = observed.countries.get(code) ?? { code, name: text(raw.country), region: canonicalRegion(raw.region) };
  if (!country.region) return reject('unknown_region');
  const mapping = observed.overrides.get(`company_country|${country.name}`);
  if (mapping && (mapping.length !== 1 || mapping[0] !== code)) return reject('existing_country_override_conflict');
  const domain = normalizeDomain(raw.website);
  if (!domain || !/^https?:\/\//iu.test(raw.website) || raw.website.length > 2000 || blockedHost(domain)) return reject('unusable_website');
  if (raw.domain && raw.domain !== domain) return reject('website_domain_mismatch');
  const websiteValues = unique(raw.source_official_website_values ?? []);
  if (!websiteValues.length || !websiteValues.includes(raw.website) || websiteValues.some((w) => normalizeDomain(w) !== domain)) return reject('ambiguous_or_missing_website_evidence');
  if (!validRetrieved(raw.retrieved_at, asOf)) return reject('invalid_retrieval_date');
  const industries = (raw.native_industries ?? []).map((i) => {
    const industryQid = canonicalQid(i.qid);
    if (industryQid) return { qid: industryQid, label: text(i.label) || null };
    if (typeof i.source_value === 'string' && i.source_value) return {
      qid: null, label: null, source_value: i.source_value, value_kind: 'unresolved_source_value',
    };
    return null;
  }).filter(Boolean).sort((a, b) => cmp(a.qid ?? a.source_value, b.qid ?? b.source_value) || cmp(a.label ?? '', b.label ?? ''));
  const labels = unique(industries.map((i) => i.label).filter(Boolean));
  if (raw.sector && !labels.includes(text(raw.sector))) return reject('sector_without_native_source_label');
  const sector = raw.sector ? text(raw.sector) : null;
  const sectorOverride = observed.overrides.get(`company_sector|${sector ?? ''}`);
  const market = sectorOverride ? sectorOverride.find(Boolean) ?? null : COMPANY_SECTOR_RULES[normalizeLabel(sector ?? '')] ?? null;
  const year = foundedYear(raw.source_inception_statements, raw.retrieved_at.slice(0, 10));
  return { row: {
    uid: qid.toLowerCase(), name, website: raw.website, domain, country: country.name, country_code: code, region: country.region,
    founded_year: year, sector, source_name: SOURCE_NAME, source_qid: qid, source_url: raw.source_url,
    source_identity: { name: raw.name, website: raw.website, country: raw.country, country_code: raw.country_code }, candidate_sha256: candidateHash,
    source_license: LICENCE, source_license_url: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
    as_of: raw.retrieved_at.slice(0, 10), retrieved_at: raw.retrieved_at,
    source_country_qid: raw.source_country_qid, source_country_label: text(raw.source_country_label ?? raw.country),
    source_region_policy: text(raw.source_region_policy ?? raw.region), country_basis: COUNTRY_BASIS,
    source_instance_of_qids: types, source_official_website_values: websiteValues,
    source_inception_values: unique(raw.source_inception_values ?? []),
    source_inception_statements: raw.source_inception_statements ?? [],
    founded_year_note: year === null ? 'Not recorded: absent, ambiguous or insufficient-precision inception evidence.' : 'Source-reported inception with year-or-finer precision.',
    native_industries: industries, market_slug: market,
    status_note: STATUS_NOTE, source_status_note: text(raw.status_note) || null, verification_scope: VERIFICATION_SCOPE,
    website_scope: 'Source-listed Wikidata P856 URL; may be a former or unreachable official website.',
    evidence_fields: ['name', 'website', 'country', ...(sector ? ['sector'] : []), ...(year !== null ? ['founded_year'] : [])],
  } };
}

export function coverage(rows) {
  const countries = {}, regions = {}, sectors = {}, sources = {}, licenses = {};
  let withWebsite = 0, withFounded = 0, withSector = 0;
  for (const r of rows) {
    for (const [object, key] of [[countries, r.country_code], [regions, r.region], [sectors, r.sector ?? 'Not recorded'], [sources, r.source_name], [licenses, r.source_license]]) object[key] = (object[key] ?? 0) + 1;
    if (r.website) withWebsite++; if (r.founded_year != null) withFounded++; if (r.sector) withSector++;
  }
  return { total: rows.length, country_count: Object.keys(countries).length, countries: sortedObject(countries), regions: sortedObject(regions),
    sectors: sortedObject(sectors), sources: sortedObject(sources), licenses: sortedObject(licenses),
    completeness: { website: withWebsite, founded_year: withFounded, sector: withSector },
    largest_country_share: rows.length ? Math.max(...Object.values(countries)) / rows.length : 0 };
}
export function acceptance(c) {
  const failures = [];
  if (c.total < MIN_TOTAL) failures.push(`total ${c.total} < ${MIN_TOTAL}`);
  if (c.country_count < MIN_COUNTRIES) failures.push(`countries ${c.country_count} < ${MIN_COUNTRIES}`);
  if (c.largest_country_share > .35) failures.push('single-country share > 35%');
  for (const [region, minimum] of Object.entries(REGION_MIN)) if ((c.regions[region] ?? 0) < minimum) failures.push(`${region} ${c.regions[region] ?? 0} < ${minimum}`);
  return { pass: failures.length === 0, failures };
}

export function prepareSnapshot(snapshot, existing, { asOf, exclusions = [], companyReviews } = {}) {
  if (!validDay(asOf)) throw new Error('A valid, fixed --as-of date is required');
  const input = Array.isArray(snapshot) ? snapshot : snapshot?.rows;
  if (!Array.isArray(input)) throw new Error('--snapshot must be a row array or {rows: [...]}');
  const observed = readExisting(existing);
  const reviews = readCompanyReviews(companyReviews, asOf);
  if (!Array.isArray(exclusions) || exclusions.some((x) => !canonicalQid(x?.qid) || !text(x.reason)
    || !/^https?:\/\//u.test(x.evidence_url ?? ''))) throw new Error('Exclusion ledger requires Q-id, reason and evidence URL');
  const excluded = new Map(exclusions.map((x) => [canonicalQid(x.qid), x]));
  const rows = [], rejected = [];
  for (const raw of input) {
    const result = normalizeSnapshotRow(raw, observed, asOf, excluded);
    if (result.row) rows.push(result.row); else rejected.push(result.rejection);
  }
  const signatures = new Map();
  for (const r of rows) {
    const set = signatures.get(r.uid) ?? new Set(); set.add(stable(r.source_identity)); signatures.set(r.uid, set);
  }
  const unambiguous = rows.filter((r) => {
    if (signatures.get(r.uid).size === 1) return true;
    rejected.push({ uid: r.uid, name: r.name, candidate_sha256: r.candidate_sha256, reason: 'conflicting_source_identity' }); return false;
  });
  const admitted = unambiguous.filter((r) => {
    const reason = companyReviewHold(r, reviews);
    if (!reason) return true;
    rejected.push({ uid: r.uid, name: r.name, candidate_sha256: r.candidate_sha256, reason }); return false;
  }).map((r) => ({ ...r, company_review: reviews.get(r.source_qid) }));
  const result = dedupe(admitted, observed.rows, observed.aliases);
  rejected.push(...result.rejected);
  const accepted = result.accepted.sort((a, b) => cmp(a.country_code, b.country_code) || cmp(a.uid, b.uid));
  const additions = new Map(), overrides = new Map();
  for (const r of accepted) {
    if (!observed.countries.has(r.country_code)) {
      const c = { code: r.country_code, name: r.country, region: r.region };
      if (additions.has(c.code) && stable(additions.get(c.code)) !== stable(c)) throw new Error(`Conflicting source country catalog entry ${c.code}`);
      additions.set(c.code, c);
    }
    const key = `company_country|${r.country}`;
    if (!observed.overrides.has(key) && COUNTRY_ALIASES[normalizeLabel(r.country)] !== r.country_code) {
      overrides.set(r.country, { kind: 'company_country', raw_value: r.country, target: r.country_code,
        note: 'D7316: explicit ISO mapping from Wikidata P17/P297; not a headquarters assertion.' });
    }
  }
  const cov = coverage(accepted);
  for (const row of accepted) admittedRows.set(row, hash(stable(row)));
  return { accepted, rejected: rejected.sort((a, b) => cmp(stable(a), stable(b))),
    countries: [...additions.values()].sort((a, b) => cmp(a.code, b.code)),
    overrides: [...overrides.values()].sort((a, b) => cmp(a.raw_value, b.raw_value)),
    report: { as_of: asOf, rows_read: input.length, existing_rows: observed.rows.length, accepted: accepted.length,
      rejected: rejected.length, duplicate_counts: result.report, coverage: cov, acceptance: acceptance(cov),
      company_review_count: companyReviews.length, company_reviews_semantic_sha256: hash(stable(companyReviews)),
      source_snapshot_semantic_sha256: hash(stable(input)), accepted_sha256: hash(stable(accepted)),
      country_basis: COUNTRY_BASIS, verification_scope: VERIFICATION_SCOPE, status_note: STATUS_NOTE } };
}

const COLUMNS = ['uid', 'name', 'website', 'country', 'founded_year', 'sector', 'source_name', 'source_url', 'source_license', 'as_of'];
const sqlValue = (value) => value == null ? 'NULL' : `'${String(value).replace(/'/gu, "''")}'`;
const HOST_CTE = `WITH raw AS (
 SELECT uid,lower(trim(name)) AS name,country,lower(trim(website)) AS url FROM research_company_directory
), stripped AS (
 SELECT *,CASE WHEN instr(url,'://')>0 THEN substr(url,instr(url,'://')+3) ELSE url END AS hostpath FROM raw
), pathless AS (
 SELECT *,substr(hostpath,1,instr(hostpath||'/','/')-1) AS hostq FROM stripped
), queryless AS (
 SELECT *,substr(hostq,1,instr(hostq||'?','?')-1) AS hostf FROM pathless
), fragmentless AS (
 SELECT *,substr(hostf,1,instr(hostf||'#','#')-1) AS hostp FROM queryless
), portless AS (
 SELECT *,rtrim(substr(hostp,1,instr(hostp||':',':')-1),'.') AS host FROM fragmentless
), existing AS MATERIALIZED (
 SELECT uid,name,country,CASE WHEN substr(host,1,4)='www.' THEN substr(host,5) ELSE host END AS domain FROM portless
)`;
function companyStatement(json) {
  return `${HOST_CTE}, candidates AS MATERIALIZED (
 SELECT ${[...COLUMNS, 'domain'].map((key) => `json_extract(value,'$.${key}') AS ${key}`).join(',')} FROM json_each(${sqlValue(json)})
)
INSERT INTO research_company_directory (${COLUMNS.join(',')})
SELECT ${COLUMNS.map((key) => `c.${key}`).join(',')} FROM candidates AS c
WHERE NOT EXISTS (SELECT 1 FROM research_company_directory AS e WHERE e.uid IN (c.uid,upper(c.uid)))
 AND NOT EXISTS (SELECT 1 FROM existing AS e WHERE e.domain=c.domain)
 AND NOT EXISTS (SELECT 1 FROM existing AS e WHERE e.name=lower(trim(c.name)) AND e.country=c.country)
ON CONFLICT(uid) DO NOTHING;`;
}
function evidenceStatement(json) {
  return `INSERT INTO company_sources (company_id,field_name,source_name,source_type,source_url,retrieved_at,verified_at,confidence)
SELECT d.id,s.value,'Wikidata','open_dataset',d.source_url,json_extract(c.value,'$.retrieved_at'),NULL,'low'
FROM json_each(${sqlValue(json)}) AS c
JOIN research_company_directory AS d ON d.uid=json_extract(c.value,'$.uid')
JOIN json_each(json_extract(c.value,'$.evidence_fields')) AS s
WHERE d.name=json_extract(c.value,'$.name') AND d.website=json_extract(c.value,'$.website')
 AND d.country=json_extract(c.value,'$.country') AND d.source_name='Wikidata'
 AND d.source_url=json_extract(c.value,'$.source_url') AND d.source_license='CC0-1.0'
 AND d.as_of=json_extract(c.value,'$.as_of')
ON CONFLICT(company_id,field_name,source_url) DO NOTHING;`;
}
/** Small statements respect D1's SQL ceiling; separate equality probes permit indexes. */
export function migrationStatements(rows, { countries = [], overrides = [] } = {}) {
  for (const row of rows) {
    const admitted = admittedRows.get(row);
    if (!admitted || admitted !== hash(stable(row))) {
      throw new Error(`SQL emission requires an unchanged company row admitted by prepareSnapshot: ${row?.uid ?? '(missing UID)'}`);
    }
  }
  const out = [];
  for (const c of countries) out.push(`INSERT INTO research_countries(code,name,region) VALUES (${[c.code, c.name, c.region].map(sqlValue).join(',')}) ON CONFLICT(code) DO NOTHING;`);
  for (const o of overrides) out.push(`INSERT INTO research_taxonomy_overrides(kind,raw_value,target,note) SELECT ${[o.kind, o.raw_value, o.target, o.note].map(sqlValue).join(',')} WHERE NOT EXISTS (SELECT 1 FROM research_taxonomy_overrides WHERE kind=${sqlValue(o.kind)} AND raw_value=${sqlValue(o.raw_value)}) ON CONFLICT(kind,raw_value,target) DO NOTHING;`);
  let chunk = [], bytes = 0;
  const flush = () => {
    if (!chunk.length) return;
    const json = JSON.stringify(chunk);
    for (const statement of [companyStatement(json), evidenceStatement(json)]) {
      if (Buffer.byteLength(statement) > MAX_STATEMENT_BYTES) throw new Error('D1 SQL statement byte budget exceeded');
      out.push(statement);
    }
    chunk = []; bytes = 0;
  };
  for (const row of rows) {
    const payload = Object.fromEntries([...COLUMNS, 'domain', 'retrieved_at', 'evidence_fields'].map((key) => [key, row[key]]));
    const size = Buffer.byteLength(sqlValue(JSON.stringify(payload))) + 1;
    if (size > MAX_STATEMENT_BYTES - 8000) throw new Error(`Oversize company record ${row.uid}`);
    if (chunk.length >= 100 || bytes + size > MAX_STATEMENT_BYTES - 8000) flush();
    chunk.push(payload); bytes += size;
  }
  flush(); return out;
}
export function migration(rows, asOf, options = {}) {
  if (!validDay(asOf)) throw new Error('Invalid migration as-of date');
  return `-- D7316 (#7316): worldwide company discovery identities, snapshot reviewed ${asOf}.
-- Wikidata structured metadata: CC0-1.0. Linked websites retain their own terms.
-- ISO codes, source-native industries and status notes stay in the audit artifact.
-- No financial, diligence or current-operation assertions. Existing rows are preserved.
${migrationStatements(rows, options).join('\n\n')}\n`;
}
export function defaultOutput(stamp) {
  if (!/^\d{12}$/u.test(stamp ?? '') || !validDay(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`)
    || Number(stamp.slice(8, 10)) > 23 || Number(stamp.slice(10, 12)) > 59) throw new Error('A valid UTC --migration-stamp YYYYMMDDHHMM is required');
  return `cloudflare-worker/sql/migrations/${stamp}_7316_research_company_directory_worldwide.sql`;
}
function readJson(path) {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes) };
}
function writeJson(path, value) { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
export function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['snapshot', 'existing', 'as-of', 'migration-stamp', 'out', 'report', 'audit', 'exclusions', 'company-reviews']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || Object.hasOwn(args, key)) throw new Error(`Invalid or repeated argument ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  if (!args.snapshot || !args.existing || !args.exclusions || !args['company-reviews']) throw new Error('--snapshot, --existing, --exclusions and --company-reviews are required; no live network fallback exists');
  const defaultPath = defaultOutput(args['migration-stamp']);
  const out = args.out ?? defaultPath;
  if (!/^\d{12}_7316_[a-z0-9_]+\.sql$/u.test(basename(out)) || !basename(out).startsWith(`${args['migration-stamp']}_7316_`)) throw new Error('--out must use the supplied timestamp/issue migration naming convention');
  const reportPath = args.report ?? 'documentation/audits/research-companies-worldwide-coverage.json';
  const auditPath = args.audit ?? 'documentation/audits/research-companies-worldwide-source-audit.json';
  if (new Set([args.snapshot, args.existing, args.exclusions, args['company-reviews'], out, reportPath, auditPath].filter(Boolean).map((p) => resolve(p))).size !== [args.snapshot, args.existing, args.exclusions, args['company-reviews'], out, reportPath, auditPath].filter(Boolean).length) throw new Error('Input and output paths must be distinct');
  const snapshot = readJson(args.snapshot), existing = readJson(args.existing);
  const exclusions = readJson(args.exclusions);
  const companyReviews = readJson(args['company-reviews']);
  if (!Array.isArray(exclusions.value)) throw new Error('--exclusions must be an array');
  const prepared = prepareSnapshot(snapshot.value, existing.value, { asOf: args['as-of'], exclusions: exclusions.value, companyReviews: companyReviews.value });
  const sql = prepared.report.acceptance.pass ? migration(prepared.accepted, args['as-of'], prepared) : null;
  const report = { ...prepared.report, snapshot_sha256: snapshot.sha256, existing_snapshot_sha256: existing.sha256,
    exclusions_sha256: exclusions.sha256, company_reviews_sha256: companyReviews.sha256,
    migration_written: sql !== null, migration_sha256: sql === null ? null : hash(sql),
    migration_bytes: sql === null ? 0 : Buffer.byteLength(sql), countries_added: prepared.countries, overrides_added: prepared.overrides,
    rejected_rows: prepared.rejected, accepted_uids: prepared.accepted.map((r) => r.uid) };
  if (sql !== null && existsSync(out) && readFileSync(out, 'utf8') !== sql) throw new Error('Refusing to overwrite an existing migration with different bytes');
  writeJson(reportPath, report);
  writeJson(auditPath, { snapshot_sha256: snapshot.sha256, existing_snapshot_sha256: existing.sha256,
    source_license: LICENCE, verification_scope: VERIFICATION_SCOPE, exclusions: exclusions.value,
    company_reviews_sha256: companyReviews.sha256, company_reviews_semantic_sha256: prepared.report.company_reviews_semantic_sha256,
    company_reviews: companyReviews.value, rejected_rows: prepared.rejected, rows: prepared.accepted });
  if (sql !== null) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, sql); }
  console.error(JSON.stringify({ accepted: report.accepted, rejected: report.rejected, coverage: report.coverage, acceptance: report.acceptance, migration_written: report.migration_written }, null, 2));
  return report.acceptance.pass ? 0 : 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (error) { console.error(`import-wikidata-worldwide: ${error.message}`); process.exitCode = 1; }
}
