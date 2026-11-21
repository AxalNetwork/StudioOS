#!/usr/bin/env node
/** D5607 — classify a pull request's diff for the advisory landing policy. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// D5620: the pure classifier lives in Merge Control, which bundles the same file.
import { classify } from '../merge-control/src/lib/classify.mjs';

export { classify };

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function changedFiles(base, head) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('Base and head must be full Git commit SHAs.');
  }
  const bases = git('merge-base', '--all', base, head).trim().split('\n');
  if (bases.length !== 1) throw new Error('The pull request has no unique merge base.');
  const args = ['--no-ext-diff', '--no-textconv', '--find-renames', bases[0], head];
  const entries = git('diff', '--raw', '--no-abbrev', '-z', ...args, '--').split('\0');
  const files = [];
  for (let i = 0; i < entries.length - 1;) {
    const header = /^:[0-7]{6} ([0-7]{6}) [a-f0-9]{40} [a-f0-9]{40} ([A-Z][0-9]*)$/.exec(entries[i++]);
    if (!header) throw new Error('Invalid raw Git diff entry.');
    const [, mode, status] = header;
    const previousPath = /^[RC]/.test(status) ? entries[i++] : undefined;
    const path = entries[i++];
    const paths = previousPath ? [previousPath, path] : [path];
    // Three context lines keep a changed shard value tied to its declaration.
    const patch = git('--literal-pathspecs', 'diff', '--unified=3', ...args, '--', ...paths);
    files.push({ path, status, previousPath, mode, patch });
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseFlag, base, headFlag, head, ...rest] = process.argv.slice(2);
  try {
    if (baseFlag !== '--base' || headFlag !== '--head' || rest.length) {
      throw new Error('Usage: node scripts/merge-policy.mjs --base <sha> --head <sha>');
    }
    console.log(JSON.stringify(classify(changedFiles(base, head))));
  } catch (error) {
    console.error(`merge-policy: ${error.message}`);
    process.exitCode = 1;
  }
}
