#!/usr/bin/env node
/**
 * #9170: no compound SELECT in Worker source has more than five terms.
 *
 * D1 refuses a sixth term with "too many terms in compound SELECT". node:sqlite
 * allows 500, so a test over plain sqlite passes while production returns 500
 * on every call (the Partner Pipeline activity feed and the account projects'
 * cycles both did). Split a longer union into CTEs or subqueries of at most
 * five terms each; D1 counts each nested compound on its own.
 *
 *   node scripts/check-compound-select.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1_MAX_COMPOUND_TERMS, overLimit } from './lib/compoundSelect.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(root, 'cloudflare-worker', 'src');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|mjs)$/.test(name) && !/\.generated\./.test(name) ? [p] : [];
  });
}

const failures = [];
for (const file of walk(SRC)) {
  for (const { line, terms } of overLimit(readFileSync(file, 'utf8'))) {
    failures.push(`${relative(root, file)}:${line}: a compound SELECT of ${terms} terms`);
  }
}
if (failures.length) {
  console.error(`✖ check-compound-select: D1 allows at most ${D1_MAX_COMPOUND_TERMS} terms in a compound SELECT; split these into CTEs or subqueries of ${D1_MAX_COMPOUND_TERMS} or fewer:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ check-compound-select: every compound SELECT in cloudflare-worker/src has at most ${D1_MAX_COMPOUND_TERMS} terms`);
