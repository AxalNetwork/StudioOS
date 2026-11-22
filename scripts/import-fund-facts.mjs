#!/usr/bin/env node
/**
 * D7843 (#7843): compile a reviewed manifest of fund statements into SQL that fills the fund
 * statement store of D7743 (`research_fund_observations` and `research_fund_observation_terms`).
 *
 *   node scripts/import-fund-facts.mjs --manifest <file.json> --out <file.sql>
 *   node scripts/import-fund-facts.mjs --manifest <file.json> --out <file.sql> --check
 *
 * Options:
 *   --check            exit 1 when <out> is not what the manifest compiles to now.
 *   --reviews <dir>    where the list review rows are read from (default: the committed migrations).
 *   --ledger <dir>     where earlier compiled files are read from (default: the committed migrations).
 *
 * The output is deterministic: the same manifest, parsers and review rows give the same bytes.
 * It writes only the two tables of D7743. It never writes research_fund_vehicle_facts and
 * creates no table. Stage terms, geography terms and money readings come from
 * services/researchFundObservations.ts (normaliseStage, normaliseGeography, readAmount); this
 * file holds no vocabulary and no amount parser of its own.
 *
 * Refused at compile time, each with its own code: a row with no source link, no reported date or
 * no import date; a fact outside D7743's list; a follow-on cheque, a deployment status or a
 * submission route (follow-ups, named in D7843); a list with no review row; a value shaped like an
 * email address, a phone number or a personal profile link; a changed value under a row key an
 * earlier compile already used. Nothing printed names a value: a refusal names the row key and the
 * field.
 *
 * At apply time the SQL writes nothing for a uid the directory does not serve (one uid move is
 * followed), nothing under a list whose verdict is 'not allowed', and nothing on a replay (the
 * UNIQUE key of D7743). A row that names `replaces` closes the earlier statement with period_end.
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
export const MARKER = '-- import-fund-facts v1';

/**
 * How a statement this writer compiles fills `method` and `promoted_at` (D7743: a migration-written
 * row has promoted_by_user_id NULL, so promoted_at is NULL). D7743 does not say which `method` a
 * migration-written row carries; the question is on #7743 and this constant is the one place it lives.
 */
export const COMPILED_METHOD = 'manual';

/** Facts the audit names that D7743 has no fact for: refused, never dropped (follow-ups in D7843). */
export const FOLLOW_UP_FACTS = Object.freeze({
  follow_on_cheque: 'fact_follow_on_cheque_not_written',
  deployment_status: 'fact_deployment_status_not_written',
  submission_route: 'fact_submission_route_not_written',
});

/** A refusal. The message names the row key and the field, never a value. */
export class ManifestError extends Error {
  constructor(code, key, field) {
    super(`${code}: row ${JSON.stringify(key ?? '(no key)')}${field ? ` field ${field}` : ''}`);
    this.name = 'ManifestError'; this.code = code; this.key = key; this.field = field;
  }
}

const DATE = /^\d{4}-[01]\d-[0-3]\d$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// An international number, or a 3-3-4 national number, with its separators.
const PHONE = /(?:\+\d[\d\s().-]{7,}\d)|(?:\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b)|(?:\(\d{2,4}\)\s?\d{3,4}[\s.-]?\d{3,4})/;
// A personal profile page: a person's page on a social or professional network.
const PROFILE = /\b(?:linkedin\.com\/(?:in|pub)\/|(?:twitter|x)\.com\/(?!(?:home|search|i)\b)[A-Za-z0-9_]{1,15}\b|facebook\.com\/(?!pages\/)[A-Za-z0-9.]+|instagram\.com\/[A-Za-z0-9._]+|github\.com\/[A-Za-z0-9-]+\/?$|angel\.co\/u\/|wellfound\.com\/u\/|crunchbase\.com\/person\/)/i;

const sqlText = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);
const sqlInt = (v) => (v == null ? 'NULL' : String(Math.trunc(Number(v))));

/** The review rows the given migrations write: every source_name an INSERT INTO research_fund_sources names. */
export function reviewedSources(dir = MIGRATIONS) {
  const names = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(compareMigrations)) {
    const text = readFileSync(join(dir, file), 'utf8').replace(/^\s*--.*$/gm, '');
    for (const m of text.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+research_fund_sources\s*\([^)]*\)\s*VALUES\s*/gi)) {
      for (const name of firstStringOfEachTuple(text, m.index + m[0].length)) names.add(name);
    }
  }
  return names;
}

/** From a VALUES list starting at `at`, the first string literal of each parenthesised tuple. */
function firstStringOfEachTuple(text, at) {
  const out = [];
  let depth = 0, i = at, first = null, sawString = false;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1, s = '';
      for (; j < text.length; j++) {
        if (text[j] === "'") { if (text[j + 1] === "'") { s += "'"; j++; continue; } break; }
        s += text[j];
      }
      if (depth === 1 && !sawString) { first = s; sawString = true; }
      i = j + 1; continue;
    }
    if (c === '(') { depth++; if (depth === 1) { first = null; sawString = false; } }
    else if (c === ')') { depth--; if (depth === 0 && first != null) out.push(first); }
    else if (c === ';' && depth === 0) break;
    i++;
  }
  return out;
}

/** Row keys and value hashes that earlier compiled files record, keyed by row key. */
export function ledgerOf(dir = MIGRATIONS, skip = null) {
  const keys = new Map();
  if (!existsSync(dir)) return keys;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort(compareMigrations)) {
    const path = join(dir, file);
    if (skip && resolve(path) === resolve(skip)) continue;
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith(MARKER)) continue;
    for (const m of text.matchAll(/^-- row (\S+) (\S+) ([0-9a-f]{64})$/gm)) {
      keys.set(m[1], { fact: m[2], hash: m[3], file });
    }
  }
  return keys;
}

const FIELDS = ['fund_uid', 'fact', 'wording', 'source_name', 'source_url', 'reported_on', 'heading'];
/** What a row key stands for: a changed hash under an unchanged key is refused. */
export const valueHash = (row) =>
  createHash('sha256').update(JSON.stringify(FIELDS.map((f) => row[f] ?? null))).digest('hex');

let parsers;
async function loadParsers() {
  if (!parsers) {
    const obs = await import(pathToFileURL(join(SRC, 'researchFundObservations.ts')).href);
    const dir = await import(pathToFileURL(join(SRC, 'researchFundDirectory.ts')).href);
    parsers = { ...obs, SERVED_FUNDS: dir.SERVED_FUNDS };
  }
  return parsers;
}

/**
 * Check a manifest and compile it. Returns the SQL text and counts; throws ManifestError on the
 * first row it refuses.
 */
export async function compileManifest(manifest, { reviews = reviewedSources(), ledger = new Map() } = {}) {
  const p = await loadParsers();
  const facts = new Set(p.OBSERVATION_FACTS);
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.rows)) throw new ManifestError('manifest_shape', null);
  const name = String(manifest.name ?? '');
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new ManifestError('manifest_name', null, 'name');
  const importedOn = manifest.imported_on;
  if (!DATE.test(String(importedOn ?? ''))) throw new ManifestError('imported_on_missing', null, 'imported_on');

  const seen = new Map();
  const rows = [];
  for (const raw of manifest.rows) {
    const key = raw?.key;
    // A key is safe to write in a comment and an SQL literal as it stands.
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) throw new ManifestError('key_missing', key, 'key');
    if (typeof raw.fund_uid !== 'string' || !raw.fund_uid.trim()) throw new ManifestError('fund_uid_missing', key, 'fund_uid');
    if (raw.fact in FOLLOW_UP_FACTS) throw new ManifestError(FOLLOW_UP_FACTS[raw.fact], key, 'fact');
    if (!facts.has(raw.fact)) throw new ManifestError('fact_unknown', key, 'fact');
    if (typeof raw.wording !== 'string' || !raw.wording.trim()) throw new ManifestError('wording_blank', key, 'wording');
    if ([...raw.wording].length > p.WORDING_MAX) throw new ManifestError('wording_too_long', key, 'wording');
    if (typeof raw.source_url !== 'string' || !/^https:\/\/\S+$/.test(raw.source_url)) throw new ManifestError('source_link_missing', key, 'source_url');
    if (!DATE.test(String(raw.reported_on ?? ''))) throw new ManifestError('dates_missing', key, 'reported_on');
    if (typeof raw.source_name !== 'string' || !reviews.has(raw.source_name)) throw new ManifestError('source_unreviewed', key, 'source_name');
    for (const field of ['wording', 'source_url', 'heading', 'fund_uid']) {
      const v = raw[field];
      if (typeof v !== 'string') continue;
      if (EMAIL.test(v)) throw new ManifestError('value_email', key, field);
      if (PHONE.test(v)) throw new ManifestError('value_phone', key, field);
      if (PROFILE.test(v)) throw new ManifestError('value_profile_link', key, field);
    }
    const row = { ...raw, heading: raw.heading ?? null };
    const hash = valueHash(row);
    const before = seen.get(key) ?? ledger.get(key);
    if (before && before.hash !== hash) throw new ManifestError('changed_value_same_key', key);
    if (seen.has(key)) throw new ManifestError('duplicate_key', key);
    if (raw.replaces != null) {
      const old = seen.get(raw.replaces) ?? ledger.get(raw.replaces);
      if (!old) throw new ManifestError('replaces_unknown', key, 'replaces');
      if (old.fact !== raw.fact) throw new ManifestError('replaces_other_fact', key, 'replaces');
      if (raw.replaces === key) throw new ManifestError('replaces_itself', key, 'replaces');
    }
    seen.set(key, { hash, fact: raw.fact });
    rows.push({ ...row, hash });
  }

  // The uid the statement is written under: one move followed, then only if the directory serves it.
  const target = (uid) => `COALESCE((SELECT m.new_uid FROM research_fund_directory_uid_moves m WHERE m.old_uid = ${sqlText(uid)}), ${sqlText(uid)})`;
  const served = (uid, source) =>
    `EXISTS (SELECT 1 FROM ${p.SERVED_FUNDS} AS f WHERE f.uid = ${target(uid)})` +
    `\n   AND NOT EXISTS (SELECT 1 FROM research_fund_sources s WHERE s.source_name = ${sqlText(source)} AND s.verdict = 'not allowed')`;
  const own = (r) => `fund_uid = ${target(r.fund_uid)} AND fact = ${sqlText(r.fact)} AND source_name = ${sqlText(r.source_name)} AND source_record_ref = ${sqlText(r.key)}`;

  const out = [
    MARKER,
    `-- D7843 (#7843): compiled by scripts/import-fund-facts.mjs from the reviewed manifest ${JSON.stringify(name)}.`,
    `-- Regenerate and verify with --check; never edit by hand. Writes research_fund_observations and`,
    `-- research_fund_observation_terms only (D7743). Every statement: promoted_by_user_id NULL, promoted_at NULL,`,
    `-- method ${sqlText(COMPILED_METHOD)}, imported_on ${importedOn}.`,
    `-- manifest sha256 ${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`,
    ...rows.map((r) => `-- row ${r.key} ${r.fact} ${r.hash}`),
    '',
  ];
  const counts = { rows: rows.length, terms: 0, unmapped: { stage: 0, geography: 0 }, closes: 0 };
  for (const r of rows) {
    const money = p.isMoneyFact(r.fact) ? p.readAmount(r.fact, r.wording, r.heading) : null;
    out.push(`-- ${r.key}`);
    out.push(
      `INSERT INTO research_fund_observations\n  (fund_uid, fact, wording, source_name, source_url, source_record_ref, reported_on, period_start, period_end,\n   imported_on, promoted_by_user_id, promoted_at, method, qualifier, min_cents, max_cents, point_cents,\n   currency, currency_basis, review_flags)\n` +
      `SELECT ${target(r.fund_uid)}, ${sqlText(r.fact)}, ${sqlText(r.wording)}, ${sqlText(r.source_name)}, ${sqlText(r.source_url)}, ${sqlText(r.key)}, ${sqlText(r.reported_on)}, NULL, NULL,\n` +
      `  ${sqlText(importedOn)}, NULL, NULL, ${sqlText(COMPILED_METHOD)}, ${sqlText(money?.qualifier)}, ${sqlInt(money?.min_cents)}, ${sqlInt(money?.max_cents)}, ${sqlInt(money?.point_cents)},\n` +
      `  ${sqlText(money?.currency)}, ${sqlText(money?.currency_basis)}, ${money?.review_flags ? sqlText(JSON.stringify(money.review_flags)) : 'NULL'}\n` +
      ` WHERE ${served(r.fund_uid, r.source_name)}\n` +
      `ON CONFLICT (fund_uid, fact, source_name, source_record_ref) DO NOTHING;`,
    );
    const terms = [];
    if (r.fact === 'investment_stage') {
      const s = p.normaliseStage(r.wording);
      s.terms.forEach((t) => terms.push(['stage', t]));
      if (s.unmatched.length) counts.unmapped.stage++;
    } else if (r.fact === 'investment_geography') {
      const g = p.normaliseGeography(r.wording);
      g.countries.forEach((t) => terms.push(['country', t]));
      g.regions.forEach((t) => terms.push(['region', t]));
      if (g.unmatched.length) counts.unmapped.geography++;
    }
    for (const [vocabulary, term] of terms) {
      counts.terms++;
      out.push(
        `INSERT INTO research_fund_observation_terms (observation_id, vocabulary, term)\n` +
        `SELECT id, ${sqlText(vocabulary)}, ${sqlText(term)} FROM research_fund_observations WHERE ${own(r)}\n` +
        `ON CONFLICT (observation_id, vocabulary, term) DO NOTHING;`,
      );
    }
    if (r.replaces != null) {
      counts.closes++;
      // The earlier statement becomes history once its replacement is in the store.
      out.push(
        `UPDATE research_fund_observations SET period_end = ${sqlText(r.reported_on)}\n` +
        ` WHERE source_name = ${sqlText(r.source_name)} AND source_record_ref = ${sqlText(r.replaces)} AND fact = ${sqlText(r.fact)}\n` +
        `   AND period_end IS NULL\n` +
        `   AND EXISTS (SELECT 1 FROM research_fund_observations n WHERE n.source_name = ${sqlText(r.source_name)} AND n.source_record_ref = ${sqlText(r.key)} AND n.fact = ${sqlText(r.fact)});`,
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
    console.error('usage: node scripts/import-fund-facts.mjs --manifest <file.json> --out <file.sql> [--check] [--reviews <dir>] [--ledger <dir>]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const reviews = reviewedSources(arg('--reviews') ? resolve(arg('--reviews')) : MIGRATIONS);
  const ledger = ledgerOf(arg('--ledger') ? resolve(arg('--ledger')) : MIGRATIONS, outPath);
  let compiled;
  try {
    compiled = await compileManifest(manifest, { reviews, ledger });
  } catch (error) {
    if (error instanceof ManifestError) { console.error(`✗ import-fund-facts: ${error.message}`); process.exit(1); }
    throw error;
  }
  if (process.argv.includes('--check')) {
    if (!existsSync(outPath) || readFileSync(outPath, 'utf8') !== compiled.sql) {
      console.error(`✗ import-fund-facts: ${outPath} is not what ${manifestPath} compiles to`);
      process.exit(1);
    }
    console.log(`✓ import-fund-facts: ${outPath} is what the manifest compiles to (${compiled.counts.rows} statements).`);
    return;
  }
  writeFileSync(outPath, compiled.sql);
  const u = compiled.counts.unmapped;
  console.log(`wrote ${outPath}: ${compiled.counts.rows} statements, ${compiled.counts.terms} terms, ${compiled.counts.closes} replaced; unmapped wording: ${u.stage} stage, ${u.geography} geography.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.IMPORT_FUND_FACTS_LOADED) {
    // The parsers are Worker TypeScript: run again under the Worker tests' loader.
    const loader = join(ROOT, 'cloudflare-worker/test/_ts-loader.mjs');
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', pathToFileURL(loader).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, IMPORT_FUND_FACTS_LOADED: '1' } });
    process.exit(r.status ?? 1);
  }
  await main();
}
