#!/usr/bin/env node
/**
 * A migration already on main is never edited, deleted or renamed (D269).
 *
 * The rule and the reasons for it live in lib/migrationImmutability.mjs, so a
 * test can drive them without a repository. This file does the git: it
 * resolves the base — the pull request's base branch, or on a push to main
 * the commit main pointed at before the push — confirms it resolves, asks git
 * what changed under cloudflare-worker/sql/migrations/, and reports.
 *
 * CI-ONLY, AND NOT A check-*.mjs. `npm run test:guards` runs every
 * `check-*.mjs`, and a drift run starts from a shallow checkout that has no
 * base history to compare against. So this runs in its own workflow,
 * .github/workflows/migration-immutability.yml, with `fetch-depth: 0`,
 * beside the other CI-only gates (`lfs-size-gate.mjs`, `npm-audit-gate.mjs`).
 *
 * IT FAILS WHEN IT CANNOT SEE. A base that does not fetch, does not resolve,
 * shares no history with HEAD, or holds no migration at all is a failure with
 * its own sentence, never a pass: a guard that skips when it cannot look is
 * how an edit to an applied migration reaches main unnoticed, which is the one
 * thing this file exists to stop.
 *
 * There is no bypass flag. A migration that has to change gets a new
 * migration.
 *
 * Usage (from the repository root):
 *   GITHUB_BASE_REF=main node scripts/migration-immutability-gate.mjs
 *   GITHUB_EVENT_NAME=push MIGRATION_GATE_BEFORE=<sha> node scripts/migration-immutability-gate.mjs
 *
 * Exit codes:
 *   0  no migration on the base was changed
 *   1  at least one was edited, deleted, renamed or changed type
 *   2  the check could not be made (no base, no history, no git)
 */
import { execFileSync } from 'node:child_process';

import {
  DIFF_FILTER,
  MIGRATIONS_DIR,
  findViolations,
  formatViolations,
  isMigrationPath,
  parseNameStatusZ,
  resolveBase,
} from './lib/migrationImmutability.mjs';

const NAME = 'migration-immutability-gate';

function git(args) {
  // execFileSync, never a shell: the branch name is data, not script text.
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

function gitError(e) {
  const stderr = e && e.stderr ? String(e.stderr).trim() : '';
  return stderr || (e && e.message) || String(e);
}

function cannotCheck(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}

const base = resolveBase(process.env);
if (!base.ok) {
  cannotCheck([`✖ ${NAME}: ${base.reason}.`]);
}

function resolves(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

if (base.mode === 'branch') {
  try {
    git(['fetch', '--no-tags', 'origin', `+refs/heads/${base.branch}:refs/remotes/${base.remoteRef}`]);
  } catch (e) {
    cannotCheck([
      `✖ ${NAME}: could not fetch the base branch '${base.branch}' from origin, so nothing can be compared against it.`,
      `    ${gitError(e)}`,
    ]);
  }
} else if (!resolves(base.sha)) {
  // A full-history checkout already has main's previous tip; this is for the
  // case it does not. A commit a force-push left behind cannot be fetched,
  // and that is a failure, not a pass.
  try {
    git(['fetch', '--no-tags', 'origin', base.sha]);
  } catch (e) {
    cannotCheck([
      `✖ ${NAME}: the commit main pointed at before this push (${base.sha}) is not in this checkout and could not be fetched.`,
      `    ${gitError(e)}`,
    ]);
  }
}

if (!resolves(base.remoteRef)) {
  cannotCheck([`✖ ${NAME}: ${base.remoteRef} does not resolve to a commit, so there is no base to compare against.`]);
}

// A pass over nothing is not a pass. If the base holds no migration under the
// folder, the path this guard watches is wrong, and every diff would be empty.
let onBase;
try {
  onBase = git(['ls-tree', '-r', '-z', '--name-only', base.remoteRef, '--', MIGRATIONS_DIR])
    .split('\0')
    .filter(isMigrationPath).length;
} catch (e) {
  cannotCheck([`✖ ${NAME}: could not list the migrations on ${base.remoteRef}.`, `    ${gitError(e)}`]);
}
if (!onBase) {
  cannotCheck([
    `✖ ${NAME}: ${base.remoteRef} holds no migration under ${MIGRATIONS_DIR}, so this check would pass over nothing.`,
  ]);
}

let raw;
try {
  raw = git([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    `--diff-filter=${DIFF_FILTER}`,
    `${base.remoteRef}...HEAD`,
    '--',
    MIGRATIONS_DIR,
  ]);
} catch (e) {
  cannotCheck([
    `✖ ${NAME}: git could not diff ${base.remoteRef}...HEAD — a checkout without the base's history (fetch-depth 0) has no merge base to diff from.`,
    `    ${gitError(e)}`,
  ]);
}

let violations;
try {
  violations = findViolations(parseNameStatusZ(raw));
} catch (e) {
  cannotCheck([`✖ ${NAME}: ${e.message}.`]);
}

if (violations.length) {
  console.error(formatViolations(violations, base.remoteRef, { onMain: base.mode === 'push' }));
  process.exit(1);
}

console.log(
  `✓ ${NAME}: none of the ${onBase} migration${onBase === 1 ? '' : 's'} on ${base.remoteRef} was edited, deleted or renamed.`,
);
