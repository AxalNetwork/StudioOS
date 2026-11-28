#!/usr/bin/env node
/**
 * #9184: raw `c.req.json(...)` reads in the Worker's routes may not grow. A
 * bare read 500s on a malformed body and `.catch(() => ({}))` lets `null`, an
 * array or a scalar through; a route reads its body with `readJsonObject`
 * (`cloudflare-worker/src/util/jsonBody.ts`), which answers 400 `invalid_json`
 * or `body_not_object`. `json-body-baseline.json` records the raw reads per
 * file on 2026-11-27: a file may not exceed its entry, a file not in it may
 * not read raw, and a file that converts reads must lower its entry
 * (`--write-baseline` rewrites it). Rules in `lib/jsonBody.mjs`.
 *
 *   node scripts/check-json-body.mjs                   # test:guards: the ratchet
 *   node scripts/check-json-body.mjs --json            # the inventory
 *   node scripts/check-json-body.mjs --write-baseline  # after converting reads
 *   node scripts/check-json-body.mjs --root <dir>      # another tree (the fixture test)
 *
 * `json-body-baseline.json`: the raw `c.req.json` reads on record per routes
 * file, for `check-json-body.mjs`. Only ever lowered.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, ratchet } from './lib/jsonBody.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const ROOT = rootAt >= 0 ? resolve(args[rootAt + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'json-body-baseline.json');
const now = inventory({ root: ROOT });
const total = Object.values(now).reduce((a, b) => a + b, 0);

if (args.includes('--json')) { process.stdout.write(`${JSON.stringify(now, null, 1)}\n`); process.exit(0); }
if (args.includes('--write-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({ note: 'Raw c.req.json reads per routes file, on record (#9184). Only ever lowered: read the body with readJsonObject (util/jsonBody.ts), then run node scripts/check-json-body.mjs --write-baseline.', files: now }, null, 2)}\n`);
  console.log(`✓ check-json-body: wrote ${Object.keys(now).length} files (${total} reads) to the baseline`);
  process.exit(0);
}
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {} : {};
const { grown, shrunk } = ratchet(now, baseline);
if (grown.length) {
  console.error('✖ check-json-body: raw c.req.json reads grew:');
  for (const g of grown) console.error(`  - ${g.file}: ${g.now} (on record: ${g.baseline})`);
  console.error('\nRead the body with readJsonObject (cloudflare-worker/src/util/jsonBody.ts):\n'
    + '  const body = await readJsonObject(c);\n  if (body instanceof Response) return body;\n'
    + 'It answers 400 invalid_json or body_not_object instead of a 500 or a null body.');
  process.exit(1);
}
if (shrunk.length) {
  console.error('✖ check-json-body: these files read raw bodies less than the baseline says; run node scripts/check-json-body.mjs --write-baseline:');
  for (const s of shrunk) console.error(`  - ${s.file}: ${s.now} (on record: ${s.baseline})`);
  process.exit(1);
}
console.log(`✓ check-json-body: ${total} raw c.req.json reads in ${Object.keys(now).length} routes files, on record and not growing.`);
