#!/usr/bin/env node
/**
 * Writes a migration from SEC EDGAR's public company list (#1230, D595).
 *
 *   node scripts/import-sec-edgar.mjs --out <path>    fetch the file from sec.gov and write that migration
 *   node scripts/import-sec-edgar.mjs --from <file>   read a copy saved from that URL instead
 *     [--as-of YYYY-MM-DD]                            the date the copy was read (default: today, UTC)
 *     [--out <path>]                                  where to write; the header number is this name's leading digits
 *
 * It never writes to a database: the migration runner applies the file, and
 * an applied migration is never rewritten. The default path is still 404's
 * file, which is applied and empty — pass `--out` with the new migration's
 * name (412 for the rows). The SEC requires a descriptive User-Agent; this
 * one names the project's public security contact from SECURITY.md, never a
 * person.
 * The rules — what a row carries, what is skipped — live in
 * `lib/secEdgarCompanies.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDGAR_URL, EDGAR_USER_AGENT, MIGRATION_FILE, parseEdgar, renderMigration } from './lib/secEdgarCompanies.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const from = arg('--from');
  const asOf = arg('--as-of') || new Date().toISOString().slice(0, 10);
  const out = arg('--out') || resolve(ROOT, 'cloudflare-worker/sql/migrations', MIGRATION_FILE);
  let text;
  if (from) {
    text = readFileSync(from, 'utf8');
  } else {
    const res = await fetch(EDGAR_URL, { headers: { 'User-Agent': EDGAR_USER_AGENT, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${EDGAR_URL} answered ${res.status}`);
    text = await res.text();
  }
  const parsed = parseEdgar(JSON.parse(text));
  writeFileSync(out, renderMigration(parsed, asOf, out));
  process.stdout.write(`${parsed.listings} listings → ${parsed.rows.length} companies, ${parsed.skipped.length} skipped → ${out}\n`);
  const reasons = new Map();
  for (const s of parsed.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  for (const [r, n] of reasons) process.stdout.write(`  skipped ${n}: ${r}\n`);
}

main().catch((e) => { process.stderr.write(`import-sec-edgar: ${e.message}\n`); process.exit(1); });
