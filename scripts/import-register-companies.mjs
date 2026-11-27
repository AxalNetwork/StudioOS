#!/usr/bin/env node
/**
 * D7316 (#7316): offline, primary-register company admission and additive SQL plans.
 * Source-native BRREG, PRH and RIK identity records are independently checked.
 * This does not change Wikidata review admission or its worldwide coverage gates.
 * No network access, database connection, inferred financials or generated reviews.
 * D8963 (#8963): SEC EDGAR operating-company registrants are the first source outside
 * Europe. SQL for a registry is emitted only once its terms review is recorded.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, createReadStream, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { acceptance, coverage, dedupe, normalizeDomain, normalizeName, readExisting, MAX_STATEMENT_BYTES } from './import-wikidata-worldwide.mjs';
import { COMPANY_SECTOR_RULES, normalizeLabel } from '../cloudflare-worker/src/services/researchTaxonomy.ts';

const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => cmp(a, b))) : item);
const hash = (value) => createHash('sha256').update(value).digest('hex');
function freezePlain(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezePlain(child);
    Object.freeze(value);
  }
  return value;
}
const DIGEST = /^[a-f0-9]{64}$/u;
// The returned handle exposes no mutable admission state. Freezing a Map alone
// would still allow set/delete, so verified maps remain private in this WeakMap.
const certifiedEvidence = new WeakMap();
const admittedRows = new WeakMap();
const BLOCKED = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be',
  'tiktok.com', 'wikidata.org', 'wikipedia.org', 'crunchbase.com', 'google.com', 'goo.gl', 'bit.ly', 'linktr.ee',
  'archive.org', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'notion.site', 'proff.no', 'gulesider.no', '1881.no'];
// Each register names its country, region and the uid prefix of its rows; the
// notes say what an admitted row does and does not establish.
const EUROPE_NOTES = Object.freeze({
  country_basis: 'Official incorporation registry jurisdiction; not a verified headquarters location.',
  website_scope: 'Homepage reported to the official company registry. Reachability and current domain ownership are not independently verified.',
  status_note: 'Accepted corporate legal form and current registry status; not an investment or ongoing-trading assessment.',
});
export const REGISTRIES = Object.freeze({
  BRREG: Object.freeze({ code: 'NO', country: 'Norway', region: 'Europe', notes: EUROPE_NOTES, prefix: 'no-brreg:', name: 'Brønnøysund Register Centre (BRREG)',
    license: 'NLOD-2.0', licenseUrl: 'https://data.norge.no/nlod/en/2.0', host: 'data.brreg.no',
    url: (id) => `https://data.brreg.no/enhetsregisteret/api/enheter/${id}` }),
  PRH: Object.freeze({ code: 'FI', country: 'Finland', region: 'Europe', notes: EUROPE_NOTES, prefix: 'fi-prh:', name: 'Finnish Patent and Registration Office (PRH)',
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', host: 'avoindata.prh.fi',
    url: (id) => `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=${id}` }),
  RIK: Object.freeze({ code: 'EE', country: 'Estonia', region: 'Europe', notes: EUROPE_NOTES, prefix: 'ee-rik:', name: 'Estonian Centre of Registers and Information Systems (RIK)',
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', host: 'avaandmed.ariregister.rik.ee',
    url: (id) => `https://ariregister.rik.ee/eng/company/${id}` }),
  // D8963: EDGAR's registrant record (data.sec.gov/submissions/CIK##########.json).
  // CIK is the SEC's registrant identifier; EDGAR also registers people and funds,
  // so only operating companies incorporated in a U.S. state or DC are admitted.
  SEC: Object.freeze({ code: 'US', country: 'United States', region: 'North America', prefix: 'us-sec:',
    name: 'U.S. Securities and Exchange Commission (SEC EDGAR)', license: 'US-SEC-public-information',
    licenseUrl: 'https://www.sec.gov/privacy', host: 'data.sec.gov', hosts: Object.freeze(['data.sec.gov', 'www.sec.gov']),
    passive: /^(?:60|61|62|65|67)/u,
    notes: Object.freeze({
      country_basis: 'SEC-recorded U.S. state of incorporation; not a verified headquarters location.',
      website_scope: 'Website recorded in the SEC EDGAR registrant record. Reachability and current domain ownership are not independently verified.',
      status_note: 'SEC operating-company registrant with a recent periodic report and no later registration termination; not a solvency, investment or ongoing-trading assessment.',
    }),
    url: (id) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${id}` }),
});

/**
 * D8963 (#8963): the terms-review record of each register. SQL for a register's rows
 * is refused until its record is 'reviewed' with the licence the register's
 * manifests carry. A pending record names why the terms were not read; it is never
 * marked reviewed from a licence identifier alone (D7810).
 */
export const REGISTER_TERMS_REVIEWS = Object.freeze({
  BRREG: Object.freeze({ state: 'reviewed', licence_id: 'NLOD-2.0', licence_url: 'https://data.norge.no/nlod/en/2.0',
    terms_url: 'https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html', reviewed_on: '2026-11-19', record: 'D7316 part 2' }),
  PRH: Object.freeze({ state: 'reviewed', licence_id: 'CC-BY-4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/',
    terms_url: 'https://avoindata.prh.fi/en/info/swagger-ui', reviewed_on: '2026-11-19', record: 'D7316 part 2' }),
  RIK: Object.freeze({ state: 'reviewed', licence_id: 'CC-BY-4.0', licence_url: 'https://creativecommons.org/licenses/by/4.0/',
    terms_url: 'https://avaandmed.ariregister.rik.ee/en', reviewed_on: '2026-11-19', record: 'D7316 part 2' }),
  SEC: Object.freeze({ state: 'pending', licence_id: 'US-SEC-public-information', licence_url: 'https://www.sec.gov/privacy',
    terms_url: 'https://www.sec.gov/privacy', reviewed_on: null, record: 'D8963',
    pending_reason: 'The session network policy refused www.sec.gov and data.sec.gov (CONNECT 403) on 2026-11-27, so the SEC website policy and EDGAR access terms were not read or quoted.' }),
});
const httpsUrl = (value) => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
/** Why a register's terms review does not allow SQL, or null when it does. */
export function termsReviewProblem(registry, review = REGISTER_TERMS_REVIEWS[registry]) {
  const policy = REGISTRIES[registry];
  if (!policy || !review) return 'no terms-review record';
  if (review.state !== 'reviewed') return `terms review ${review.state ?? 'missing'}${review.pending_reason ? `: ${review.pending_reason}` : ''}`;
  if (review.licence_id !== policy.license) return 'reviewed licence differs from the licence the source manifests carry';
  if (!httpsUrl(review.licence_url) || !httpsUrl(review.terms_url)) return 'reviewed licence and terms links must be HTTPS';
  if (!day(review.reviewed_on) || !clean(review.record)) return 'review date and decision record are required';
  return null;
}
const COLUMNS = ['uid', 'name', 'website', 'country', 'founded_year', 'sector', 'source_name', 'source_url', 'source_license', 'as_of'];

/** Canonical source projection: object keys sorted recursively, array order retained. */
export function primaryRecordSha256(record) { return hash(stable(record)); }
function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function retrieved(value, asOf) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(value)
    && day(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) && value.slice(0, 10) <= asOf
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function sourceDay(value) {
  if (value == null || value === '') return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}
function current(row, asOf, end = 'endDate', start = 'registrationDate') {
  const startDay = sourceDay(row?.[start]);
  const endDay = sourceDay(row?.[end]);
  return row && (endDay === null || (day(endDay) && endDay >= asOf))
    && (startDay === null || (day(startDay) && startDay <= asOf));
}
// Unknown or future dates never hide an insolvency/special-situation note.
const unresolvedAdverse = (row, asOf, end = 'endDate') => {
  const endDay = sourceDay(row?.[end]);
  return !endDay || !day(endDay) || endDay >= asOf;
};
function validName(name) {
  return name && name.length <= 500 && normalizeName(name) && !/[\u0000-\u001f\u007f]/u.test(name);
}
export function sourceWebsite(value) {
  const raw = clean(value);
  if (!raw || /[\u0000-\u0020\u007f<>@,;\\]/u.test(raw)) return null;
  const website = /^https?:\/\//iu.test(raw) ? raw : `https://${raw}`;
  let decoded = website;
  for (let pass = 0; pass < 3; pass++) {
    if (decoded.includes('|') || (decoded.match(/https?:\/\//giu) ?? []).length > 1) return null;
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { return null; }
  }
  if (!/^https?:\/\/[^/]/iu.test(website)) return null;
  const domain = normalizeDomain(website);
  if (!domain || website.length > 2000 || BLOCKED.some((host) => domain === host || domain.endsWith(`.${host}`))) return null;
  if (/\.(?:local|internal|lan)$/u.test(domain)) return null;
  if (domain.length > 253 || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/u.test(domain.split('.').at(-1))) return null;
  if (domain.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return null;
  return { website, domain };
}
// D8963: EDGAR periodic reports show a current registrant; a Form 15 ends or suspends reporting.
const SEC_PERIODIC = new Set(['10-K', '10-K/A', '10-KT', '10-KT/A', '10-Q', '10-Q/A', '10-QT', '10-QT/A']);
const SEC_TERMINATION = new Set(['15-12B', '15-12G', '15-15D', '15-12B/A', '15-12G/A', '15-15D/A']);
const US_JURISDICTIONS = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH '
  + 'NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '));
function nativeId(registry, record) {
  if (registry === 'BRREG') return String(record?.organisasjonsnummer ?? '');
  if (registry === 'PRH') return clean(record?.businessId?.value);
  if (registry === 'SEC') { const cik = String(record?.cik ?? ''); return /^\d{1,10}$/u.test(cik) ? cik.padStart(10, '0') : cik; }
  return String(record?.ariregistri_kood ?? '');
}
function nativeWebsites(registry, record, asOf) {
  if (registry === 'BRREG') return [record?.hjemmeside];
  if (registry === 'PRH') return [record?.website?.url];
  if (registry === 'SEC') return [record?.website];
  return (record?.yldandmed?.sidevahendid ?? []).filter((r) => r.liik === 'WWW' && current(r, asOf, 'lopp_kpv', 'algus_kpv')).map((r) => r.sisu);
}

/** Derive identity solely from captured native registry fields, never candidate flags. */
export function projectPrimaryRecord(registry, record, asOf) {
  if (!REGISTRIES[registry] || !record || typeof record !== 'object' || Array.isArray(record)) return { reason: 'invalid_primary_record' };
  let id, name, form, sector = null, industryCode = null, foundedYear = null, incorporationState;
  if (registry === 'BRREG') {
    id = String(record.organisasjonsnummer ?? ''); name = clean(record.navn); form = record.organisasjonsform?.kode;
    if (!/^\d{9}$/u.test(id)) return { reason: 'invalid_registry_id' };
    if (!['AS', 'ASA'].includes(form)) return { reason: 'noncompany_legal_form' };
    if (record.registrertIForetaksregisteret !== true || record.forretningsadresse?.landkode !== 'NO') return { reason: 'missing_incorporation_evidence' };
    if (['konkurs', 'underAvvikling', 'underTvangsavviklingEllerTvangsopplosning'].some((key) => record[key] !== false)
      || record.slettedato || record.underKonkursbehandling || record.underRekonstruksjonsforhandlingDato
      || record.underUtenlandskInsolvensbehandlingDato) return { reason: 'inactive_or_insolvent_or_unknown_status' };
    const founded = record.stiftelsesdato;
    if (founded != null) {
      if (!day(founded) || founded > asOf) return { reason: 'invalid_source_formation_date' };
      foundedYear = Number(founded.slice(0, 4));
    }
    const accountsYear = String(record.sisteInnsendteAarsregnskap ?? '');
    const currentYear = Number(asOf.slice(0, 4));
    if (!( /^\d{4}$/u.test(accountsYear) && Number(accountsYear) >= currentYear - 2 && Number(accountsYear) <= currentYear)
      && !(foundedYear !== null && foundedYear >= currentYear - 1)) return { reason: 'missing_recent_corporate_activity_evidence' };
    industryCode = clean(record.naeringskode1?.kode) || null;
    sector = industryCode && industryCode !== '00.000' ? clean(record.naeringskode1?.beskrivelse) || null : null;
  } else if (registry === 'PRH') {
    id = clean(record.businessId?.value);
    if (!/^\d{7}-\d$/u.test(id)) return { reason: 'invalid_registry_id' };
    if (record.endDate || String(record.status) !== '2' || String(record.tradeRegisterStatus) !== '1'
      || !Array.isArray(record.companySituations) || record.companySituations.some((r) => unresolvedAdverse(r, asOf))) return { reason: 'inactive_or_insolvent_or_unknown_status' };
    const forms = (record.companyForms ?? []).filter((r) => r.version === 1 && current(r, asOf));
    if (forms.length !== 1 || !['16', '17', '80', '23', '24'].includes(String(forms[0].type))) return { reason: 'noncompany_or_ambiguous_legal_form' };
    form = String(forms[0].type);
    const names = (record.names ?? []).filter((r) => String(r.type) === '1' && r.version === 1 && current(r, asOf));
    if (names.length !== 1) return { reason: 'ambiguous_current_legal_name' };
    name = clean(names[0].name);
    const entries = (record.registeredEntries ?? []).filter((r) => current(r, asOf));
    if (!entries.some((r) => String(r.register) === '1' && String(r.type) === '1')) return { reason: 'missing_current_trade_registration' };
    if (!entries.some((r) => ['5_55', '6_80', '6_82', '6_86', '6_87', '7_41', '7_42'].includes(`${r.register}_${r.type}`))) return { reason: 'missing_current_operating_registration' };
    if (!current(record.website, asOf)) return { reason: 'invalid_website_registration_date' };
    const labels = [...new Set((record.mainBusinessLine?.descriptions ?? []).filter((r) => String(r.languageCode) === '3').map((r) => clean(r.description)).filter(Boolean))];
    if (labels.length > 1) return { reason: 'ambiguous_native_sector' };
    sector = labels[0] ?? null; industryCode = clean(record.mainBusinessLine?.type) || null;
    // PRH registrationDate is not a founding date.
  } else if (registry === 'RIK') {
    const data = record.yldandmed ?? {};
    id = String(record.ariregistri_kood ?? ''); name = clean(record.nimi); form = data.oiguslik_vorm;
    if (!/^\d{8}$/u.test(id)) return { reason: 'invalid_registry_id' };
    if (!((form === 'OÜ' && Number(data.oiguslik_vorm_nr) === 5) || (form === 'AS' && Number(data.oiguslik_vorm_nr) === 1))
      || data.oigusliku_vormi_alaliik || data.oigusliku_vormi_alaliik_tekstina) return { reason: 'noncompany_legal_form' };
    if (data.staatus !== 'R' || data.kustutamise_kpv) return { reason: 'inactive_or_insolvent_or_unknown_status' };
    // An R status alone can coexist with an interim bankruptcy administrator.
    // Retain native card notes explicitly, including an observed empty array.
    if (!Array.isArray(data.markused_kaardil)) return { reason: 'missing_registry_card_notes' };
    const routineNote = 'Kanne on tehtud äriregistri seaduse § 70 lõike 1 alusel.';
    if (data.markused_kaardil.some((r) => unresolvedAdverse(r, asOf, 'lopp_kpv')
      && clean(r?.sisu).replace(/\s+/gu, ' ') !== routineNote)) return { reason: 'current_registry_card_note_requires_review' };
    if (!Array.isArray(data.info_majandusaasta_aruannetest)) return { reason: 'missing_native_annual_report_evidence' };
    const currentYear = Number(asOf.slice(0, 4));
    const periodEnds = data.info_majandusaasta_aruannetest.map((r) => sourceDay(r.majandusaasta_perioodi_lopp_kpv))
      .filter((date) => day(date) && date <= asOf);
    const registered = sourceDay(data.esmaregistreerimise_kpv);
    if (!periodEnds.some((date) => Number(date.slice(0, 4)) >= currentYear - 2)
      && !(day(registered) && registered <= asOf && Number(registered.slice(0, 4)) >= currentYear - 1)) return { reason: 'missing_recent_corporate_activity_evidence' };
    const names = (data.arinimed ?? []).filter((r) => current(r, asOf, 'lopp_kpv', 'algus_kpv'));
    const forms = (data.oiguslikud_vormid ?? []).filter((r) => current(r, asOf, 'lopp_kpv', 'algus_kpv'));
    if (names.length !== 1 || clean(names[0].sisu) !== name) return { reason: 'ambiguous_current_legal_name' };
    if (forms.length !== 1 || forms[0].sisu !== form
      || (forms[0].sisu_nr != null && Number(forms[0].sisu_nr) !== Number(data.oiguslik_vorm_nr))) return { reason: 'ambiguous_current_legal_form' };
    const primary = (data.teatatud_tegevusalad ?? []).filter((r) => r.on_pohitegevusala === true && current(r, asOf, 'lopp_kpv', 'algus_kpv'));
    if (primary.length > 1) return { reason: 'ambiguous_native_sector' };
    sector = clean(primary[0]?.emtak_tekstina) || null; industryCode = clean(primary[0]?.emtak_kood) || null;
    // RIK esmaregistreerimise_kpv is not a founding date.
  } else {
    id = nativeId(registry, record); name = clean(record.name);
    if (!/^\d{10}$/u.test(id) || /^0+$/u.test(id)) return { reason: 'invalid_registry_id' };
    // EDGAR registers people, funds and other filers too; only operating companies qualify.
    if (record.entityType !== 'operating') return { reason: 'noncompany_legal_form' };
    // EDGAR records the state of incorporation, not a legal form.
    form = null; incorporationState = clean(record.stateOfIncorporation);
    if (!US_JURISDICTIONS.has(incorporationState)) return { reason: 'missing_incorporation_evidence' };
    const recent = record.filings?.recent, forms = recent?.form, dates = recent?.filingDate;
    if (!Array.isArray(forms) || !Array.isArray(dates) || forms.length !== dates.length) return { reason: 'missing_native_filing_history' };
    const filed = forms.map((type, i) => [clean(type).toUpperCase(), dates[i]]);
    // An undated or future Form 15 never hides a termination.
    if (filed.some(([type, date]) => SEC_TERMINATION.has(type) && !(day(date) && date <= asOf))) return { reason: 'inactive_or_insolvent_or_unknown_status' };
    const latest = (types) => filed.filter(([type, date]) => types.has(type) && day(date) && date <= asOf).map(([, date]) => date).sort().at(-1) ?? null;
    const periodic = latest(SEC_PERIODIC), terminated = latest(SEC_TERMINATION);
    if (terminated && (!periodic || terminated >= periodic)) return { reason: 'inactive_or_insolvent_or_unknown_status' };
    if (!periodic || Number(periodic.slice(0, 4)) < Number(asOf.slice(0, 4)) - 2) return { reason: 'missing_recent_corporate_activity_evidence' };
    industryCode = clean(String(record.sic ?? '')) || null; sector = clean(record.sicDescription) || null;
    // EDGAR records no formation date.
  }
  const digits = String(industryCode ?? '').replace(/\D/gu, '');
  if (!digits || /^0+$/u.test(digits) || !sector) return { reason: 'unknown_native_activity' };
  if ((REGISTRIES[registry].passive ?? /^(?:64|66|68|701)/u).test(digits)) return { reason: 'passive_property_financial_or_head_office_activity' };
  if (!validName(name)) return { reason: 'invalid_name' };
  const supplied = nativeWebsites(registry, record, asOf);
  const websites = supplied.map(sourceWebsite);
  if (!websites.length || websites.some((r) => !r)) return { reason: 'unusable_registered_website' };
  if (new Set(websites.map((r) => r.domain)).size !== 1) return { reason: 'ambiguous_registered_website' };
  websites.sort((a, b) => Number(!b.website.startsWith('http://')) - Number(!a.website.startsWith('http://'))
    || a.website.length - b.website.length || cmp(a.website, b.website));
  return { row: { registration_id: id, name, legal_form: form, ...websites[0], sector, industry_code: industryCode,
    founded_year: foundedYear, source_website_values: supplied, country_code: REGISTRIES[registry].code,
    ...(incorporationState ? { incorporation_state: incorporationState } : {}) } };
}

function validateManifest(manifest, asOf) {
  const policy = REGISTRIES[manifest?.registry];
  if (!policy || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/u.test(manifest.id ?? '') || !retrieved(manifest.retrieved_at, asOf)
    || manifest.source_name !== policy.name || manifest.source_license !== policy.license
    || manifest.source_license_url !== policy.licenseUrl || !DIGEST.test(manifest.records_sha256 ?? '')
    || !clean(manifest.records_file) || !Array.isArray(manifest.upstream_snapshots) || !manifest.upstream_snapshots.length) throw new Error(`Invalid primary source manifest ${manifest?.id ?? '(missing id)'}`);
  const authorizedUrl = (value) => {
    try { const url = new URL(value); return url.protocol === 'https:' && (policy.hosts ?? [policy.host]).includes(url.hostname) && !url.username && !url.password && !url.port; } catch { return false; }
  };
  if (!authorizedUrl(manifest.source_url) || manifest.upstream_snapshots.some((row) => !authorizedUrl(row.source_url) || !DIGEST.test(row.sha256 ?? ''))) throw new Error(`Unrecognized official source provenance ${manifest.id}`);
}

/** Read full source ledgers before selecting candidates; all shared-domain identities hold. */
export async function loadPrimaryEvidence(manifestFiles, { asOf } = {}) {
  if (!day(asOf) || !Array.isArray(manifestFiles) || !manifestFiles.length) throw new Error('Fixed asOf and source manifest files are required');
  const evidence = { manifests: new Map(), records: new Map(), domains: new Map(), names: new Map(), identityHashes: new Map(),
    conflicts: new Set(), raw_records: 0, manifest_files: [], source_files: [], as_of: asOf };
  for (const filename of manifestFiles) {
    const bytes = readFileSync(filename), manifests = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(manifests)) throw new Error('Source manifest file must contain an array');
    evidence.manifest_files.push({ path: resolve(filename), sha256: hash(bytes) });
    for (const manifest of manifests) {
      validateManifest(manifest, asOf);
      freezePlain(manifest);
      if (evidence.manifests.has(manifest.id)) throw new Error(`Repeated source manifest ${manifest.id}`);
      evidence.manifests.set(manifest.id, manifest);
      const file = resolve(dirname(filename), manifest.records_file), digest = createHash('sha256');
      evidence.source_files.push(file);
      const input = createReadStream(file);
      input.on('data', (chunk) => digest.update(chunk));
      const lines = createInterface({ input, crlfDelay: Infinity });
      let count = 0;
      for await (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { throw new Error(`Invalid JSON in ${manifest.id} record ${count + 1}`); }
        const result = projectPrimaryRecord(manifest.registry, record, asOf);
        const id = nativeId(manifest.registry, record);
        const identity = `${manifest.registry}:${id}`, key = `${manifest.id}|${id}`, recordHash = primaryRecordSha256(record);
        const priorHash = evidence.identityHashes.get(identity);
        if (priorHash && priorHash !== recordHash) evidence.conflicts.add(identity);
        evidence.identityHashes.set(identity, recordHash);
        evidence.records.set(key, freezePlain({ ...result, primary_record_sha256: recordHash, source_manifest_id: manifest.id }));
        const nativeName = manifest.registry === 'BRREG' ? record.navn : manifest.registry === 'PRH'
          ? (record.names ?? []).find((r) => String(r.type) === '1' && r.version === 1 && current(r, asOf))?.name
          : manifest.registry === 'SEC' ? record.name : record.nimi;
        const name = normalizeName(nativeName ?? '');
        if (name && id) {
          const nameKey = `${REGISTRIES[manifest.registry].code}|${name}`;
          const ids = evidence.names.get(nameKey) ?? new Set(); ids.add(identity); evidence.names.set(nameKey, ids);
        }
        for (const website of nativeWebsites(manifest.registry, record, asOf)) {
          const domain = sourceWebsite(website)?.domain;
          if (!domain || !id) continue;
          const ids = evidence.domains.get(domain) ?? new Set(); ids.add(identity); evidence.domains.set(domain, ids);
        }
        count++;
      }
      if (digest.digest('hex') !== manifest.records_sha256) throw new Error(`Primary source file hash mismatch: ${manifest.id}`);
      if (manifest.records_count != null && manifest.records_count !== count) throw new Error(`Primary source record count mismatch: ${manifest.id}`);
      evidence.raw_records += count;
    }
  }
  freezePlain(evidence.manifest_files);
  const handle = Object.freeze({ source_count: evidence.manifests.size, raw_records: evidence.raw_records,
    manifest_ids: Object.freeze([...evidence.manifests.keys()]) });
  certifiedEvidence.set(handle, evidence);
  return handle;
}

function readQualityHolds(rows) {
  if (!Array.isArray(rows)) throw new Error('An explicit qualityHolds array is required; prior identity/website holds do not disappear with a registry UID');
  const index = { domains: new Map(), names: new Map(), ids: new Map() };
  for (const row of rows) {
    const identity = row?.identity, domain = identity?.domain ? normalizeDomain(identity.domain) : null;
    const name = normalizeName(identity?.name ?? '');
    const byName = name && /^[A-Z]{2}$/u.test(identity?.country_code ?? '');
    const byId = REGISTRIES[identity?.registry] && clean(identity?.registration_id);
    if (!['hold', 'exclude'].includes(row?.decision) || !clean(row?.reason) || !/^https?:\/\//u.test(row?.evidence_url ?? '')
      || !normalizeDomain(row.evidence_url) || !identity || (!domain && !byName && !byId)
      || (identity.domain && !domain)) throw new Error('Invalid prior quality hold: decision, reason, evidence URL and matching identity are required');
    if (domain && !index.domains.has(domain)) index.domains.set(domain, row);
    const nameKey = `${identity.country_code}|${name}`, idKey = `${identity.registry}|${identity.registration_id}`;
    if (byName && !index.names.has(nameKey)) index.names.set(nameKey, row);
    if (byId && !index.ids.has(idKey)) index.ids.set(idKey, row);
  }
  return index;
}
export function prepareRegisterSnapshot(candidates, existing, { asOf, baselineObservedAt, evidence: handle, qualityHolds } = {}) {
  if (!day(asOf) || !retrieved(baselineObservedAt, asOf) || baselineObservedAt.slice(0, 10) !== asOf) throw new Error('A fixed as-of date and same-day baselineObservedAt are required');
  const evidence = certifiedEvidence.get(handle);
  if (!evidence) throw new Error('Verified primary source files are required; a copied evidence object is not admission');
  if (evidence.as_of !== asOf) throw new Error('Primary evidence must be validated for this exact as-of date');
  if (!Array.isArray(candidates)) throw new Error('Candidates must be an array');
  const holds = readQualityHolds(qualityHolds), holdHash = primaryRecordSha256(qualityHolds);
  const observed = readExisting(existing), rejected = [], normalized = [];
  const reject = (raw, reason) => rejected.push({ registry: raw?.registry, registration_id: raw?.registration_id,
    name: raw?.name, candidate_sha256: primaryRecordSha256(raw), reason });
  for (const raw of candidates) {
    const policy = REGISTRIES[raw?.registry], manifest = evidence.manifests.get(raw?.source_manifest_id);
    if (!policy || manifest?.registry !== raw.registry) { reject(raw, 'missing_or_conflicting_source_manifest'); continue; }
    const source = evidence.records.get(`${raw.source_manifest_id}|${raw.registration_id}`);
    if (!source || !DIGEST.test(raw.primary_record_sha256 ?? '') || source.primary_record_sha256 !== raw.primary_record_sha256) { reject(raw, 'primary_record_hash_mismatch_or_missing'); continue; }
    if (source.reason) { reject(raw, source.reason); continue; }
    const proof = source.row;
    const priorHold = holds.domains.get(proof.domain) ?? holds.names.get(`${proof.country_code}|${normalizeName(proof.name)}`)
      ?? holds.ids.get(`${raw.registry}|${proof.registration_id}`);
    if (priorHold) { reject(raw, `retained_quality_${priorHold.decision}: ${priorHold.reason}`); continue; }
    if (evidence.conflicts.has(`${raw.registry}:${raw.registration_id}`)) { reject(raw, 'conflicting_primary_identity'); continue; }
    if (evidence.domains.get(proof.domain)?.size !== 1) { reject(raw, 'shared_registered_domain_all_held'); continue; }
    if (evidence.names.get(`${policy.code}|${normalizeName(proof.name)}`)?.size !== 1) { reject(raw, 'shared_registered_name_country_all_held'); continue; }
    if (!['name', 'website', 'country_code', 'sector', 'founded_year'].every((key) => Object.hasOwn(raw, key) && raw[key] === proof[key])
      || String(raw.registration_id) !== proof.registration_id) { reject(raw, 'candidate_primary_identity_mismatch'); continue; }
    const uid = `${policy.prefix}${proof.registration_id}`, sourceUrl = policy.url(proof.registration_id);
    if ((raw.uid != null && raw.uid !== uid) || (raw.source_name != null && raw.source_name !== policy.name)
      || (raw.source_url != null && raw.source_url !== sourceUrl) || (raw.source_license != null && raw.source_license !== policy.license)) { reject(raw, 'candidate_provenance_mismatch'); continue; }
    const country = observed.countries.get(policy.code) ?? { code: policy.code, name: policy.country, region: policy.region };
    const overrides = observed.overrides.get(`company_country|${country.name}`);
    if (overrides && (overrides.length !== 1 || overrides[0] !== policy.code)) { reject(raw, 'existing_country_override_conflict'); continue; }
    const sectorOverride = observed.overrides.get(`company_sector|${proof.sector ?? ''}`);
    normalized.push({ uid, ...proof, country: country.name, region: country.region, registry: raw.registry,
      source_name: policy.name, source_url: sourceUrl, source_license: policy.license, source_license_url: policy.licenseUrl,
      source_manifest_id: manifest.id, primary_record_sha256: source.primary_record_sha256,
      source_records_sha256: manifest.records_sha256, upstream_snapshots: manifest.upstream_snapshots,
      quality_holds_sha256: holdHash,
      retrieved_at: manifest.retrieved_at, as_of: manifest.retrieved_at.slice(0, 10),
      candidate_sha256: primaryRecordSha256(raw), market_slug: sectorOverride ? sectorOverride.find(Boolean) ?? null : COMPANY_SECTOR_RULES[normalizeLabel(proof.sector ?? '')] ?? null,
      ...policy.notes,
      founded_year_note: raw.registry === 'BRREG' && proof.founded_year !== null ? 'Source-reported formation date (stiftelsesdato).' : 'Not recorded: registration date is not inferred to be a founding date.',
      unsupported_metrics: { revenue: null, valuation: null, funding_total: null, employee_count: null },
      evidence_fields: ['name', 'website', 'country', ...(proof.sector ? ['sector'] : []), ...(proof.founded_year !== null ? ['founded_year'] : [])],
    });
  }
  const result = dedupe(normalized, observed.rows, observed.aliases);
  rejected.push(...result.rejected);
  const accepted = result.accepted.sort((a, b) => cmp(a.country_code, b.country_code) || cmp(a.uid, b.uid));
  for (const row of accepted) admittedRows.set(row, primaryRecordSha256(row));
  const cov = coverage(accepted);
  const reasons = Object.fromEntries([...new Set(rejected.map((r) => r.reason))].sort(cmp).map((reason) => [reason, rejected.filter((r) => r.reason === reason).length]));
  return { accepted, rejected, report: { as_of: asOf, baseline_observed_at: baselineObservedAt, existing_rows: observed.rows.length,
    candidates_read: candidates.length, primary_records_read: evidence.raw_records, accepted: accepted.length, rejected: rejected.length,
    rejection_reasons: reasons, duplicate_counts: result.report, coverage: cov, original_worldwide_acceptance: acceptance(cov),
    user_goal: { target_usable_companies: 25000, source_admitted_this_run: accepted.length,
      source_admitted_target_reached: accepted.length >= 25000, projected_directory_total: observed.rows.length + accepted.length,
      projected_directory_count_reached: observed.rows.length + accepted.length >= 25000,
      previous_rows_not_reverified: observed.rows.length },
    existing_semantic_sha256: primaryRecordSha256(existing), candidates_semantic_sha256: primaryRecordSha256(candidates),
    accepted_sha256: primaryRecordSha256(accepted), primary_manifest_files: evidence.manifest_files,
    quality_holds_count: qualityHolds.length, quality_holds_sha256: holdHash,
    primary_source_manifests: [...evidence.manifests.values()],
    source_terms_reviews: Object.fromEntries([...new Set(accepted.map((row) => row.registry))].sort(cmp)
      .map((registry) => [registry, { ...REGISTER_TERMS_REVIEWS[registry], sql_allowed: termsReviewProblem(registry) === null }])),
    scope: 'Primary registry corporate identity and source-listed homepage; no generated review decisions, financial enrichment or live site verification.' } };
}

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
SELECT d.id,s.value,d.source_name,'official_registry',d.source_url,json_extract(c.value,'$.retrieved_at'),NULL,'medium'
FROM json_each(${sqlValue(json)}) AS c
JOIN research_company_directory AS d ON d.uid=json_extract(c.value,'$.uid')
JOIN json_each(json_extract(c.value,'$.evidence_fields')) AS s
WHERE ${COLUMNS.filter((key) => key !== 'uid').map((key) => `d.${key} IS json_extract(c.value,'$.${key}')`).join('\n AND ')}
ON CONFLICT(company_id,field_name,source_url) DO NOTHING;`;
}

/** Only exact objects admitted by this compiler can produce SQL; audit copies cannot. */
export function registerMigrationStatements(rows) {
  for (const row of rows) if (!admittedRows.has(row) || admittedRows.get(row) !== primaryRecordSha256(row)) throw new Error(`SQL requires an unchanged primary-register admitted row: ${row?.uid ?? '(missing UID)'}`);
  for (const registry of new Set(rows.map((row) => row.registry))) {
    const problem = termsReviewProblem(registry);
    if (problem) throw new Error(`SQL withheld for ${registry} until its source terms are reviewed (${problem})`);
  }
  const statements = [], countries = new Map();
  for (const row of rows) countries.set(row.country_code, { code: row.country_code, name: row.country, region: row.region });
  for (const country of [...countries.values()].sort((a, b) => cmp(a.code, b.code))) statements.push(`INSERT INTO research_countries(code,name,region) VALUES (${[country.code, country.name, country.region].map(sqlValue).join(',')}) ON CONFLICT(code) DO NOTHING;`);
  let chunk = [], bytes = 0;
  const flush = () => {
    if (!chunk.length) return;
    const json = JSON.stringify(chunk);
    for (const statement of [companyStatement(json), evidenceStatement(json)]) {
      if (Buffer.byteLength(statement) > MAX_STATEMENT_BYTES) throw new Error('D1 statement byte limit exceeded');
      statements.push(statement);
    }
    chunk = []; bytes = 0;
  };
  for (const row of rows) {
    const payload = Object.fromEntries([...COLUMNS, 'domain', 'retrieved_at', 'evidence_fields'].map((key) => [key, row[key]]));
    const size = Buffer.byteLength(sqlValue(JSON.stringify(payload))) + 1;
    if (size > MAX_STATEMENT_BYTES - 8000) throw new Error(`Oversize primary-register company ${row.uid}`);
    if (chunk.length >= 75 || bytes + size > MAX_STATEMENT_BYTES - 8000) flush();
    chunk.push(payload); bytes += size;
  }
  flush();
  return statements;
}
export function registerMigration(rows, asOf) {
  if (!day(asOf)) throw new Error('Invalid as-of date');
  const sec = rows.some((row) => row.registry === 'SEC') ? `-- D8963: SEC EDGAR ${REGISTRIES.SEC.license}, terms reviewed ${REGISTER_TERMS_REVIEWS.SEC.reviewed_on}.\n` : '';
  return `-- D7316 (#7316): proposed additive company import from official registers, ${asOf}.\n-- Sources: BRREG NLOD-2.0; PRH and RIK CC-BY-4.0. Source records are normalized.\n${sec}-- Registry-listed websites are not independently checked for reachability or ownership.\n-- No financial data, generated review decisions, updates or deletions.\n-- Worldwide acceptance is reported separately and is not implied by this plan.\n${registerMigrationStatements(rows).join('\n\n')}\n`;
}
function writeJson(filename, value) { mkdirSync(dirname(resolve(filename)), { recursive: true }); writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`); }

/** D8198 (#8198): create a SQL proposal exclusively, or accept identical existing bytes without rewriting them. */
export function writeSqlPlan(filename, sql) {
  if (constants.O_NOFOLLOW === undefined || constants.O_NONBLOCK === undefined) throw new Error('Safe SQL output requires no-follow and nonblocking file opens');
  const bytes = Buffer.from(sql, 'utf8');
  mkdirSync(dirname(resolve(filename)), { recursive: true });
  let fd;
  try {
    fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(existing).isFile()) throw new Error('Existing SQL plan must be a regular file');
      if (!readFileSync(existing).equals(bytes)) throw new Error('Refusing to overwrite a different existing SQL plan');
    } finally { closeSync(existing); }
    return;
  }
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}

export async function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['candidates', 'source-manifests', 'quality-holds', 'existing', 'as-of', 'baseline-observed-at', 'out', 'statements', 'report', 'audit']);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || Object.hasOwn(args, key)) throw new Error(`Invalid argument ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  for (const key of allowed) if (!args[key]) throw new Error(`--${key} is required; no live network or database fallback exists`);
  const manifests = args['source-manifests'].split(',').map((name) => resolve(name));
  const paths = [args.candidates, args.existing, args['quality-holds'], args.out, args.statements, args.report, args.audit, ...manifests].map((name) => resolve(name));
  if (new Set(paths).size !== paths.length) throw new Error('Input and output paths must be distinct');
  const candidatesBytes = readFileSync(args.candidates), existingBytes = readFileSync(args.existing), holdsBytes = readFileSync(args['quality-holds']);
  const evidence = await loadPrimaryEvidence(manifests, { asOf: args['as-of'] });
  const proofFiles = certifiedEvidence.get(evidence).source_files;
  if ([args.out, args.statements, args.report, args.audit].some((name) => proofFiles.includes(resolve(name)))) throw new Error('Outputs must not overwrite a primary source ledger');
  const prepared = prepareRegisterSnapshot(JSON.parse(candidatesBytes), JSON.parse(existingBytes), {
    asOf: args['as-of'], baselineObservedAt: args['baseline-observed-at'], evidence, qualityHolds: JSON.parse(holdsBytes),
  });
  // D8963: a register whose terms are not reviewed yields a dry run: report and audit, no SQL or statements.
  const withheld = Object.entries(prepared.report.source_terms_reviews).filter(([, review]) => !review.sql_allowed).map(([registry]) => registry);
  if (withheld.length) {
    const report = { ...prepared.report, candidates_file_sha256: hash(candidatesBytes), existing_file_sha256: hash(existingBytes),
      quality_holds_file_sha256: hash(holdsBytes), sql_withheld_for_terms_review: withheld, statement_count: 0,
      database_writes_performed: false, original_worldwide_gate_preserved: true };
    writeJson(args.report, report);
    writeJson(args.audit, { ...report, rejected_rows: prepared.rejected, admitted_rows: prepared.accepted });
    console.error(JSON.stringify({ accepted: report.accepted, rejected: report.rejected, sql_withheld_for_terms_review: withheld }, null, 2));
    return 2;
  }
  const statements = registerMigrationStatements(prepared.accepted), sql = registerMigration(prepared.accepted, args['as-of']);
  writeSqlPlan(args.out, sql);
  const report = { ...prepared.report, candidates_file_sha256: hash(candidatesBytes), existing_file_sha256: hash(existingBytes),
    quality_holds_file_sha256: hash(holdsBytes),
    proposed_sql_sha256: hash(sql), proposed_sql_bytes: Buffer.byteLength(sql), statement_count: statements.length,
    database_writes_performed: false, original_worldwide_gate_preserved: true };
  writeJson(args.report, report);
  writeJson(args.audit, { ...report, rejected_rows: prepared.rejected, admitted_rows: prepared.accepted });
  writeJson(args.statements, statements);
  console.error(JSON.stringify({ accepted: report.accepted, rejected: report.rejected, user_goal: report.user_goal,
    original_worldwide_acceptance: report.original_worldwide_acceptance, proposed_statement_count: statements.length }, null, 2));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`import-register-companies: ${error.message}`); process.exitCode = 1; });
}
