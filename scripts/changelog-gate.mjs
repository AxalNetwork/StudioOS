#!/usr/bin/env node
/**
 * A task PR that edits `CHANGELOG.md`. It compares the PR event's head with its
 * merge base with the event's base commit and rejects an edit unless
 * `CHANGELOG_LABEL=true`. With complete local history it makes no fetch.
 * Incomplete history gets one bounded fetch for the exact event commits, and an
 * inconclusive comparison exits 2. CI-only, in `changelog-gate.yml` with
 * `fetch-depth: 0`.
 *
 * Only Session 1's labelled PRs may edit CHANGELOG.md (AGENTS.md).
 * Compare the event's PR head with its merge base with the event's base.
 * Exit 0 if allowed, 1 for an unlabelled edit, or 2 if the check is inconclusive.
 */
import { execFileSync } from 'node:child_process';

const NAME = 'changelog-gate';
const FILE = 'CHANGELOG.md';
const commitSha = /^[0-9a-f]{40}$/i;

function git(args, timeout) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout,
  });
}

function cannotCheck(line) {
  console.error(`✖ ${NAME}: ${line}`);
  process.exit(2);
}

const base = process.env.CHANGELOG_BASE_SHA || '';
const head = process.env.CHANGELOG_HEAD_SHA || '';
if (!commitSha.test(base) || !commitSha.test(head)) {
  cannotCheck('CHANGELOG_BASE_SHA and CHANGELOG_HEAD_SHA must be the full PR event commit SHAs.');
}

function hasCommit(sha) {
  try {
    return git(['cat-file', '-t', sha]).trim() === 'commit';
  } catch {
    return false;
  }
}

let mergeBase;
let changed;
try {
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  if (shallow || !hasCommit(base) || !hasCommit(head)) {
    try {
      git([
        'fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head',
        ...(shallow ? ['--unshallow'] : []),
        'origin', base, head,
      ], 60_000);
    } catch {
      cannotCheck('could not recover the exact PR event commits from origin in one bounded fetch.');
    }
    if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true' || !hasCommit(base) || !hasCommit(head)) {
      cannotCheck('the exact PR event commits or their complete history are unavailable after recovery.');
    }
  }
  mergeBase = git(['merge-base', base, head]).trim();
  changed = git(['diff', '--name-only', '-z', mergeBase, head, '--', FILE]).split('\0');
} catch {
  cannotCheck('could not compare the PR event commits. Check that both commits share complete history and their trees are available.');
}

if (!changed.includes(FILE)) {
  console.log(`✓ ${NAME}: this PR does not touch ${FILE}.`);
  process.exit(0);
}
if (process.env.CHANGELOG_LABEL === 'true') {
  console.log(`✓ ${NAME}: this PR edits ${FILE} and carries the \`changelog\` label (Session 1's changelog PR).`);
  process.exit(0);
}
console.error(`✖ ${NAME}: this PR edits ${FILE}. Task PRs never do: Session 1 writes it from merged PRs (AGENTS.md, "CHANGELOG.md is Session 1's").`);
console.error('  Restore the file from the tested merge base and keep the record in the PR title and body:');
console.error(`    git restore --source=${mergeBase} -- ${FILE} && git commit -m "Restore ${FILE}" -- ${FILE}`);
process.exit(1);
