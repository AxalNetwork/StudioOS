#!/usr/bin/env node
/**
 * D7828 (#7828): compile a committed, reviewed manifest of company facts into a migration that
 * fills research_company_facts (migration 202611232026_7828), the way import-fund-facts.mjs (D7843)
 * fills the fund statement store.
 *
 *   node scripts/import-company-facts.mjs --manifest <file.json> --out <file.sql>
 *   node scripts/import-company-facts.mjs --manifest <file.json> --out <file.sql> --check
 *
 * Options:
 *   --check            exit 1 when <out> is not what the manifest compiles to now.
 *   --ledger <dir>     where earlier compiled files are read from (default: the committed migrations).
 *
 * The output is deterministic. It writes research_company_facts only, creates no table and never
 * touches company_sources. The attribute list and caps come from
 * cloudflare-worker/src/services/researchCompanyFacts.ts, the statement types and states from
 * researchEvidenceVocabulary.ts, a market's country code from mapCompanyCountry
 * (researchTaxonomy.ts) and the served-record relation from researchCompanyRead.ts (D7819).
 * Nothing is inferred from a sector label or a classification code.
 *
 * Refused at compile time, each with its own code, and the manifest is refused whole with nothing
 * written: a fact without a source (source_missing); an attribute, state or statement type outside
 * the lists; a found fact with no value or no passage or field; an absence that carries a value; a
 * contact or application path that is not a page link, or that is a person's name, an email address
 * or a phone number; an amount in a pricing-model value; an email address or phone number anywhere
 * (the manifest is public); a changed value under a key an earlier compile used. A refusal names
 * the fact's key and the field, never a value.
 *
 * At apply time the SQL writes a fact only where its company uid is served (REACHABLE_COMPANIES),
 * and nothing on a replay (UNIQUE company_uid, fact_key). A fact that names `replaces` marks the
 * earlier fact outdated with a link to its replacement, once. Each row records the manifest's name,
 * so facts skipped at apply time are counted after deploy against the header's fact list.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareMigrations } from './lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'cloudflare-worker/sql/migrations');
const SRC = join(ROOT, 'cloudflare-worker/src/services');

/** The first line of every compiled file; a later compile reads earlier keys from files that carry it. */
export const MARKER = '-- import-company-facts v1';

/** A refusal. The message names the fact's key and the field, never a value. */
export class ManifestError extends Error {
  constructor(code, key, field) {
    super(`${code}: fact ${JSON.stringify(key ?? '(no key)')}${field ? ` field ${field}` : ''}`);
    this.name = 'ManifestError';
    this.code = code;
    this.key = key;
    this.field = field;
  }
}

const DATE = /^\d{4}-[01]\d-[0-3]\d(?:[T ][0-2]\d:[0-5]\d(?::[0-5]\d)?Z?)?$/;
const DAY = /^\d{4}-[01]\d-[0-3]\d$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PAGE = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;
export const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\bmailto:/i;
// An international number, a 3-3-4 national number, a bracketed area code, or a tel: link.
export const PHONE = /(?:\+\d[\d\s().-]{7,}\d)|(?:\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b)|(?:\(\d{2,4}\)\s?\d{3,4}[\s.-]?\d{3,4})|\btel:/i;
// A person's page on a social or professional network.
const PROFILE = /\b(?:linkedin\.com\/(?:in|pub)\/|(?:twitter|x)\.com\/(?!(?:home|search|i)\b)[A-Za-z0-9_]{1,15}\b|facebook\.com\/(?!pages\/)[A-Za-z0-9.]+|instagram\.com\/[A-Za-z0-9._]+|angel\.co\/u\/|wellfound\.com\/u\/|crunchbase\.com\/person\/)/i;
// Two to four capitalised words and nothing else: how a person's name reads.
const PERSON_NAME = /^\p{Lu}[\p{L}'’.-]*(?:\s+\p{Lu}[\p{L}'’.-]*){1,3}$/u;
// A price or plan with an amount: a currency sign or code beside a number, or a number per period or seat.
const CURRENCY = '(?:[$€£¥₹₩]|\\b(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|INR|CNY|SEK|NOK|DKK|PLN|BRL)\\b)';
export const AMOUNT = new RegExp(
  `${CURRENCY}\\s*\\d|\\d[\\d.,]*\\s*(?:k|m|bn)?\\s*${CURRENCY}|\\d[\\d.,]*\\s*(?:/|per\\s+)(?:month|mo|year|yr|annum|seat|user|licen[cs]e)\\b`,
  'i',
);

const sqlText = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);

/** fact keys and value hashes that earlier compiled files record, keyed by "<uid> <key>". */
export function ledgerOf(dir = MIGRATIONS, skip = null) {
  const keys = new Map();
  if (!existsSync(dir)) return keys;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(compareMigrations)) {
    const path = join(dir, file);
    if (skip && resolve(path) === resolve(skip)) continue;
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith(MARKER)) continue;
    for (const m of text.matchAll(/^-- fact (\S+) (\S+) (\S+) ([0-9a-f]{64})$/gm)) {
      keys.set(`${m[1]} ${m[2]}`, { attribute: m[3], hash: m[4], file });
    }
  }
  return keys;
}

const FIELDS = [
  'company_uid', 'key', 'attribute', 'state', 'value', 'statement_type', 'source_url', 'publisher',
  'passage', 'source_field', 'published_at', 'retrieved_at', 'conflicts_with', 'replaces',
];
/** What a fact key stands for: a changed hash under an unchanged key is refused. */
export const valueHash = (fact) =>
  createHash('sha256').update(JSON.stringify(FIELDS.map((f) => fact[f] ?? null))).digest('hex');

let lists;
async function loadLists() {
  if (!lists) {
    const facts = await import(pathToFileURL(join(SRC, 'researchCompanyFacts.ts')).href);
    const vocab = await import(pathToFileURL(join(SRC, 'researchEvidenceVocabulary.ts')).href);
    const taxonomy = await import(pathToFileURL(join(SRC, 'researchTaxonomy.ts')).href);
    const read = await import(pathToFileURL(join(SRC, 'researchCompanyRead.ts')).href);
    lists = {
      attributes: new Set(facts.COMPANY_FACT_ATTRIBUTES),
      valueMax: facts.FACT_VALUE_MAX,
      passageMax: facts.FACT_PASSAGE_MAX,
      statementTypes: new Set(vocab.STATEMENT_TYPES),
      states: new Set(vocab.EVIDENCE_STATES),
      absences: new Set(vocab.ABSENCE_STATES),
      mapCompanyCountry: taxonomy.mapCompanyCountry,
      REACHABLE_COMPANIES: read.REACHABLE_COMPANIES,
    };
  }
  return lists;
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/** The contact-path refusal for a value, or null when it is the link of an organisation's page. */
export function contactPathRefusal(value) {
  const v = String(value ?? '').trim();
  if (EMAIL.test(v)) return 'contact_path_email';
  if (PHONE.test(v)) return 'contact_path_phone';
  if (PROFILE.test(v) || PERSON_NAME.test(v)) return 'contact_path_person_name';
  if (!PAGE.test(v)) return 'contact_path_not_page_link';
  return null;
}

/**
 * Check a manifest and compile it. Returns the SQL text and counts; throws ManifestError on the
 * first fact it refuses, so a refused manifest writes nothing.
 */
export async function compileManifest(manifest, { ledger = new Map() } = {}) {
  const l = await loadLists();
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.facts)) throw new ManifestError('manifest_shape', null);
  const name = String(manifest.name ?? '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new ManifestError('manifest_name', null, 'name');
  const reviewer = manifest.reviewed_by;
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 120) throw new ManifestError('reviewer_missing', null, 'reviewed_by');
  if (EMAIL.test(reviewer)) throw new ManifestError('value_email', null, 'reviewed_by');
  if (PHONE.test(reviewer)) throw new ManifestError('value_phone', null, 'reviewed_by');
  const reviewedOn = manifest.reviewed_on;
  if (!DAY.test(String(reviewedOn ?? ''))) throw new ManifestError('reviewed_on_missing', null, 'reviewed_on');

  const seen = new Map();
  const facts = [];
  for (const raw of manifest.facts) {
    const key = raw?.key;
    if (typeof key !== 'string' || !KEY.test(key)) throw new ManifestError('key_missing', key, 'key');
    if (typeof raw.company_uid !== 'string' || !ID.test(raw.company_uid)) throw new ManifestError('company_uid_missing', key, 'company_uid');
    if (typeof raw.source_url !== 'string' || !PAGE.test(raw.source_url) || blank(raw.publisher))
      throw new ManifestError('source_missing', key, blank(raw.publisher) ? 'publisher' : 'source_url');
    if (String(raw.publisher).length > 200) throw new ManifestError('publisher_too_long', key, 'publisher');
    if (!l.attributes.has(raw.attribute)) throw new ManifestError('attribute_unknown', key, 'attribute');
    if (!l.states.has(raw.state)) throw new ManifestError('state_unknown', key, 'state');
    if (!l.statementTypes.has(raw.statement_type)) throw new ManifestError('statement_type_unknown', key, 'statement_type');
    if (!DATE.test(String(raw.retrieved_at ?? ''))) throw new ManifestError('retrieved_at_missing', key, 'retrieved_at');
    if (raw.published_at != null && !DATE.test(String(raw.published_at))) throw new ManifestError('published_at_invalid', key, 'published_at');
    for (const field of ['value', 'passage', 'source_field']) {
      if (raw[field] != null && (typeof raw[field] !== 'string' || !raw[field].trim())) throw new ManifestError(`${field}_blank`, key, field);
    }
    const hasEvidence = !blank(raw.passage) || !blank(raw.source_field);
    if (l.absences.has(raw.state)) {
      if (!blank(raw.value) || hasEvidence) throw new ManifestError('absence_with_value', key, 'value');
    } else {
      if (blank(raw.value)) throw new ManifestError('found_without_value', key, 'value');
      if (!hasEvidence) throw new ManifestError('found_without_passage', key, 'passage');
    }
    if (raw.value != null && [...raw.value].length > l.valueMax) throw new ManifestError('value_too_long', key, 'value');
    if (raw.passage != null && [...raw.passage].length > l.passageMax) throw new ManifestError('passage_too_long', key, 'passage');
    if (raw.source_field != null && raw.source_field.length > 120) throw new ManifestError('source_field_too_long', key, 'source_field');
    if (raw.attribute === 'contact_path' && raw.value != null) {
      const code = contactPathRefusal(raw.value);
      if (code) throw new ManifestError(code, key, 'value');
    }
    if (raw.attribute === 'pricing_model' && raw.value != null && AMOUNT.test(raw.value)) throw new ManifestError('pricing_model_amount', key, 'value');
    // The manifest is public: no email address or phone number anywhere in a fact.
    for (const field of ['value', 'passage', 'source_url', 'publisher', 'source_field']) {
      const v = raw[field];
      if (typeof v !== 'string') continue;
      if (EMAIL.test(v)) throw new ManifestError('value_email', key, field);
      if (PHONE.test(v)) throw new ManifestError('value_phone', key, field);
    }
    const fact = { ...raw, published_at: raw.published_at ?? null, passage: raw.passage ?? null, source_field: raw.source_field ?? null,
      value: raw.value ?? null, conflicts_with: raw.conflicts_with ?? null, replaces: raw.replaces ?? null };
    const id = `${fact.company_uid} ${key}`;
    const hash = valueHash(fact);
    const before = seen.get(id) ?? ledger.get(id);
    if (before && before.hash !== hash) throw new ManifestError('changed_value_same_key', key);
    if (seen.has(id)) throw new ManifestError('duplicate_key', key);
    for (const [field, code] of [['replaces', 'replaces_unknown'], ['conflicts_with', 'conflict_unknown']]) {
      const ref = fact[field];
      if (ref == null) continue;
      if (typeof ref !== 'string' || ref === key) throw new ManifestError(code, key, field);
      const other = seen.get(`${fact.company_uid} ${ref}`) ?? ledger.get(`${fact.company_uid} ${ref}`);
      if (!other) throw new ManifestError(code, key, field);
      if (field === 'replaces' && other.attribute !== fact.attribute) throw new ManifestError('replaces_other_attribute', key, field);
    }
    seen.set(id, { hash, attribute: fact.attribute });
    // 'Markets served' keeps the source's words; one named country also gets its crosswalk code.
    const mapped = fact.attribute === 'markets_served' && fact.value ? l.mapCompanyCountry(fact.value) : null;
    fact.market_country = mapped && mapped.targets.length === 1 ? mapped.targets[0] : null;
    facts.push({ ...fact, hash });
  }

  const served = (uid) => `EXISTS (SELECT 1 FROM ${l.REACHABLE_COMPANIES} AS c WHERE c.uid = ${sqlText(uid)})`;
  const out = [
    MARKER,
    `-- D7828 (#7828): compiled by scripts/import-company-facts.mjs from the reviewed manifest ${JSON.stringify(name)}.`,
    `-- Regenerate and verify with --check; never edit by hand. Writes research_company_facts only.`,
    `-- Reviewed ${reviewedOn}. A fact is written only where its company is served when this file is applied;`,
    `-- facts skipped then are this header's ${facts.length} facts less the rows with manifest_name ${sqlText(name)}.`,
    `-- manifest sha256 ${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`,
    ...facts.map((f) => `-- fact ${f.company_uid} ${f.key} ${f.attribute} ${f.hash}`),
    '',
  ];
  const counts = { facts: facts.length, replaces: 0, countries: 0 };
  for (const f of facts) {
    if (f.market_country) counts.countries++;
    out.push(`-- ${f.company_uid} ${f.key}`);
    out.push(
      `INSERT INTO research_company_facts\n  (company_uid, fact_key, attribute, value, statement_type, source_url, publisher, passage, source_field,\n   market_country, published_at, retrieved_at, reviewed_at, reviewed_by, state, conflicts_with_key, replaces_key, manifest_name)\n` +
        `SELECT ${sqlText(f.company_uid)}, ${sqlText(f.key)}, ${sqlText(f.attribute)}, ${sqlText(f.value)}, ${sqlText(f.statement_type)}, ${sqlText(f.source_url)}, ${sqlText(f.publisher)}, ${sqlText(f.passage)}, ${sqlText(f.source_field)},\n` +
        `  ${sqlText(f.market_country)}, ${sqlText(f.published_at)}, ${sqlText(f.retrieved_at)}, ${sqlText(reviewedOn)}, ${sqlText(reviewer)}, ${sqlText(f.state)}, ${sqlText(f.conflicts_with)}, ${sqlText(f.replaces)}, ${sqlText(name)}\n` +
        ` WHERE ${served(f.company_uid)}\n` +
        `ON CONFLICT (company_uid, fact_key) DO NOTHING;`,
    );
    if (f.replaces != null) {
      counts.replaces++;
      // The earlier fact becomes outdated, linked to its replacement, once the replacement is stored.
      out.push(
        `UPDATE research_company_facts SET state = 'outdated', replaced_by_key = ${sqlText(f.key)}\n` +
          ` WHERE company_uid = ${sqlText(f.company_uid)} AND fact_key = ${sqlText(f.replaces)} AND replaced_by_key IS NULL\n` +
          `   AND EXISTS (SELECT 1 FROM research_company_facts n WHERE n.company_uid = ${sqlText(f.company_uid)} AND n.fact_key = ${sqlText(f.key)});`,
      );
    }
    out.push('');
  }
  return { sql: out.join('\n'), counts };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const manifestPath = arg('--manifest');
  const outPath = arg('--out');
  if (!manifestPath || !outPath) {
    console.error('usage: node scripts/import-company-facts.mjs --manifest <file.json> --out <file.sql> [--check] [--ledger <dir>]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ledger = ledgerOf(arg('--ledger') ? resolve(arg('--ledger')) : MIGRATIONS, outPath);
  let compiled;
  try {
    compiled = await compileManifest(manifest, { ledger });
  } catch (error) {
    if (error instanceof ManifestError) {
      console.error(`✗ import-company-facts: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  if (process.argv.includes('--check')) {
    if (!existsSync(outPath) || readFileSync(outPath, 'utf8') !== compiled.sql) {
      console.error(`✗ import-company-facts: ${outPath} is not what ${manifestPath} compiles to`);
      process.exit(1);
    }
    console.log(`✓ import-company-facts: ${outPath} is what the manifest compiles to (${compiled.counts.facts} facts).`);
    return;
  }
  writeFileSync(outPath, compiled.sql);
  console.log(`wrote ${outPath}: ${compiled.counts.facts} facts, ${compiled.counts.replaces} replaced, ${compiled.counts.countries} with a country code.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.IMPORT_COMPANY_FACTS_LOADED) {
    // The lists are Worker TypeScript: run again under the Worker tests' loader.
    const loader = join(ROOT, 'cloudflare-worker/test/_ts-loader.mjs');
    const r = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '--import', pathToFileURL(loader).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, IMPORT_COMPANY_FACTS_LOADED: '1' } },
    );
    process.exit(r.status ?? 1);
  }
  await main();
}
