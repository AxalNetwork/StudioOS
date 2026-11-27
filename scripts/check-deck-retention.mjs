#!/usr/bin/env node
/**
 * D1508 (#3759): every deck store has a row in
 * documentation/operations/DATA_RETENTION.md, no row names a table that is
 * gone, and every deck table created from migration 722 on cascades from its
 * parent. The rules are in `scripts/lib/deckRetention.mjs`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { BASELINE_CUTOFF, migrationNumber } from './lib/migrationPlan.mjs';
import { KNOWN_WITHOUT_CASCADE, deckRetentionProblems, deckTables } from './lib/deckRetention.mjs';

const root = new URL('../', import.meta.url);
const sqlDir = new URL('cloudflare-worker/sql/', root);
const files = [{ name: 'schema_baseline.sql', number: 0, sql: readFileSync(new URL('schema_baseline.sql', sqlDir), 'utf8') }];
for (const name of readdirSync(new URL('migrations/', sqlDir)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
  .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b))) {
  files.push({ name, number: migrationNumber(name), sql: readFileSync(new URL(`migrations/${name}`, sqlDir), 'utf8') });
}
const inventory = readFileSync(new URL('documentation/operations/DATA_RETENTION.md', root), 'utf8');
const problems = deckRetentionProblems(files, inventory);
if (problems.length) {
  console.error(`✖ check-deck-retention: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ check-deck-retention: ${deckTables(files).size} deck stores, each in DATA_RETENTION.md; every deck table from migration 722 on cascades (${KNOWN_WITHOUT_CASCADE.length} made before this check on record).`);
