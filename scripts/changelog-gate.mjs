#!/usr/bin/env node
/**
 * CHANGELOG.md is Session 1's (AGENTS.md, "CHANGELOG.md is Session 1's"; the
 * owner, 2026-10-19). A task PR that adds an entry at the top of the file
 * conflicts with every other open PR on the same lines, so a pull request may
 * touch CHANGELOG.md only when it carries the `changelog` label, which Session
 * 1 puts on its own changelog PR.
 *
 * CI-ONLY, AND NOT A check-*.mjs, for the same reason as
 * migration-immutability-gate.mjs: it compares against the pull request's base
 * branch, which a shallow `npm run test:guards` checkout does not have. It runs
 * in .github/workflows/changelog-gate.yml with `fetch-depth: 0`.
 *
 * IT FAILS WHEN IT CANNOT SEE. A base that does not fetch or shares no history
 * with HEAD is a failure with its own sentence, never a pass.
 *
 * Usage (from the repository root):
 *   GITHUB_BASE_REF=main node scripts/changelog-gate.mjs
 *   GITHUB_BASE_REF=main CHANGELOG_LABEL=true node scripts/changelog-gate.mjs
 *
 * Exit codes:
 *   0  CHANGELOG.md is untouched, or the PR carries the `changelog` label
 *   1  the PR changes CHANGELOG.md without the label
 *   2  the check could not be made (no base, no history, no git)
 */
import { execFileSync } from 'node:child_process';

const NAME = 'changelog-gate';
const FILE = 'CHANGELOG.md';

function git(args) {
  // execFileSync, never a shell: the branch name is data, not script text.
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function cannotCheck(line) {
  console.error(`✖ ${NAME}: ${line}`);
  process.exit(2);
}

const base = process.env.GITHUB_BASE_REF || '';
if (!/^[\w./-]+$/.test(base)) cannotCheck('GITHUB_BASE_REF is not set to a branch name, so there is no base to compare against.');

const remoteRef = `refs/remotes/origin/${base}`;
try {
  git(['fetch', '--no-tags', 'origin', `+refs/heads/${base}:${remoteRef}`]);
} catch (e) {
  cannotCheck(`the base branch ${base} did not fetch (${String(e.stderr || e.message).trim()}).`);
}

let mergeBase;
try {
  mergeBase = git(['merge-base', remoteRef, 'HEAD']).trim();
} catch {
  cannotCheck(`HEAD shares no history with ${base}, so the PR's own changes cannot be told apart.`);
}

const changed = git(['diff', '--name-only', '-z', mergeBase, 'HEAD']).split('\0').filter(Boolean);
if (!changed.includes(FILE)) {
  console.log(`✓ ${NAME}: this PR does not touch ${FILE}.`);
  process.exit(0);
}
if (process.env.CHANGELOG_LABEL === 'true') {
  console.log(`✓ ${NAME}: this PR edits ${FILE} and carries the \`changelog\` label (Session 1's changelog PR).`);
  process.exit(0);
}
console.error(`✖ ${NAME}: this PR edits ${FILE}. Task PRs never do: Session 1 writes it from merged PRs (AGENTS.md, "CHANGELOG.md is Session 1's").`);
console.error(`  Put the file back as it is on the base, and keep the record in the PR's title and body:`);
console.error(`    git checkout $(git merge-base origin/${base} HEAD) -- ${FILE} && git commit -m "Take the entry out of ${FILE}" -- ${FILE}`);
process.exit(1);
