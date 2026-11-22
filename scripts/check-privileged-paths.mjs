#!/usr/bin/env node
/**
 * D8067 (#8067): the privileged-path list as the gates outside code read it.
 *   node scripts/check-privileged-paths.mjs            prints the list and the ruleset's file-path condition (#8060, #8082)
 *   node scripts/check-privileged-paths.mjs --json     prints the ruleset's file-path condition as JSON only
 *   node scripts/check-privileged-paths.mjs --check    fails when `.github/CODEOWNERS` does not hold the generated block
 *   node scripts/check-privileged-paths.mjs --write    rewrites that block in `.github/CODEOWNERS`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVILEGED_PATHS, codeownersBlock, codeownersBlockIn, rulesetPaths, withCodeownersBlock } from './lib/privilegedPaths.mjs';

const CODEOWNERS = fileURLToPath(new URL('../.github/CODEOWNERS', import.meta.url));

export function main(argv, { read = () => readFileSync(CODEOWNERS, 'utf8'), write = (t) => writeFileSync(CODEOWNERS, t), out = console.log, err = console.error } = {}) {
  const [flag, ...rest] = argv;
  if (rest.length || ![undefined, '--json', '--check', '--write'].includes(flag)) {
    err('Usage: node scripts/check-privileged-paths.mjs [--json | --check | --write]');
    return 2;
  }
  if (flag === '--json') { out(JSON.stringify(rulesetPaths(), null, 2)); return 0; }
  if (flag === '--check') {
    const current = codeownersBlockIn(read());
    if (current === codeownersBlock()) { out(`✓ check-privileged-paths: .github/CODEOWNERS holds the generated block (${PRIVILEGED_PATHS.length} paths).`); return 0; }
    err(current === null
      ? '✗ check-privileged-paths: .github/CODEOWNERS has no privileged block. Run node scripts/check-privileged-paths.mjs --write.'
      : '✗ check-privileged-paths: .github/CODEOWNERS\'s privileged block differs from the list. Run node scripts/check-privileged-paths.mjs --write.');
    return 1;
  }
  if (flag === '--write') { write(withCodeownersBlock(read())); out('wrote the privileged block in .github/CODEOWNERS'); return 0; }
  out('Privileged paths (merge-control/src/lib/classify.mjs PRIVILEGED_PATHS):');
  for (const { glob, why } of PRIVILEGED_PATHS) out(`  ${glob.padEnd(40)} ${why}`);
  out('\nRuleset file-path condition (fnmatch):');
  out(JSON.stringify(rulesetPaths(), null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
