#!/usr/bin/env node
/**
 * D7714 (#7714) — builds a country catalogue import body from a reviewed source
 * file and saved reads, for HQ to send to
 * `POST /api/admin/licence-pricing/countries/import`. The logic and its rules
 * are in `scripts/lib/countryImport.mjs`; the steps around it are in
 * `documentation/operations/COUNTRY_CATALOGUE_RECONCILE.md`.
 *
 *   node scripts/build-country-import.mjs \
 *     --source <reviewed.csv|.json> --catalogue <countries-read.json> \
 *     [--consistency <consistency-read.json>] [--again CODE:field,...] \
 *     --reason "<why>" --out <import-body.json>
 *
 * It calls no API and holds no credential. The source file, the saved reads and
 * the body are kept outside the repository and never committed: the body is
 * refused a path inside it. With nothing to import it writes no file and says so.
 *
 * Exit: 0 a body written, or nothing to import; 1 rows to fix; 2 usage.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CountryImportError, buildCountryImport, parseAgain, parseCatalogue, parseConsistency, parseSource,
} from './lib/countryImport.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new CountryImportError(`Unexpected argument "${k}".`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new CountryImportError(`${k} needs a value.`);
    out[k.slice(2)] = v; i++;
  }
  return out;
}

const insideRepo = (p) => { const rel = relative(REPO, resolve(p)); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
const readJson = (p, what) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { throw new CountryImportError(`Cannot read ${what} as JSON: ${p}`); }
};

function main() {
  let a;
  try {
    a = args(process.argv.slice(2));
    for (const k of ['source', 'catalogue', 'reason', 'out']) if (!a[k]) throw new CountryImportError(`--${k} is required.`);
    if (insideRepo(a.out)) throw new CountryImportError('--out must be outside the repository: the import body is never committed.');
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  try {
    const rows = parseSource(readFileSync(a.source, 'utf8'), a.source);
    const catalogue = parseCatalogue(readJson(a.catalogue, 'the catalogue read'));
    const reported = a.consistency ? parseConsistency(readJson(a.consistency, 'the consistency read')) : new Set();
    const again = parseAgain(a.again);
    const out = buildCountryImport({ rows, catalogue, reported, again, reason: a.reason });
    if (!out.body) {
      process.stdout.write(`Nothing to import: all ${rows.length} source rows already equal the profiles. No file was written.\n`);
      return 0;
    }
    writeFileSync(a.out, `${JSON.stringify(out.body, null, 2)}\n`);
    const countries = Object.keys(out.body.expected_revisions).length;
    process.stdout.write(`Wrote ${out.body.observations.length} observations for ${countries} countries to ${a.out}; ${out.left_out.length} unchanged rows left out.\n`);
    if (out.kept_reported.length) process.stdout.write(`Sent whether or not they changed (reported by the consistency read or named again):${out.kept_reported.join(', ')}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof CountryImportError)) throw e;
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
}

process.exitCode = main();
