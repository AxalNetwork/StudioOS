#!/usr/bin/env node
/**
 * D6466 (#6466): a change that appends a section to a decision file already on
 * its base. A `D<n>.md` or `D<n>-p<k>.md` there fails when it gains a
 * `##`/`###` heading or more than 10 lines; it names the `D<n>-p<k>.md` to
 * write instead (D5615). Typo and link fixes pass; a file the change creates
 * passes. On a pull request it reads the merge commit's first parent, which a
 * shallow checkout still names; a base it cannot resolve exits 2, never a pass;
 * a push says it skipped.
 *
 * D6466 (#6466): a change may not append a section to a decision file that is
 * already on its base. D5615 says a later part of a multi-part issue writes its
 * own file, `decisions/D<n>-p<k>.md`, and `check-decision-ids.mjs` accepts that
 * name and its heading, but nothing read the diff, so sessions kept appending
 * "Built, PPnn" sections to `D4838.md` (four open PRs, six conflicting pairs)
 * and `D4811.md` (652 lines, edited by 16 of 396 commits). Appends to decision
 * files and README rows were 20 of 42 conflicting pairs in the 2026-11-14
 * landing plan.
 *
 * THE RULE. A file under `documentation/architecture/decisions/` named
 * `D<n>.md` or `D<n>-p<k>.md` that exists on the base fails when the change
 *   · adds a `##` or `###` heading (more of them than the base has; fenced code
 *     is not read), or
 *   · grows by more than MAX_NET_LINES lines (lines after minus lines before).
 * A typo or link fix changes lines without adding any, so it passes. A file
 * the change creates is not on the base, so it passes whatever its size.
 * Existing part files are held to the same rule: a part file is one landed
 * part's record, and the next part writes the next file, or the appends simply
 * move from `D<n>.md` to `D<n>-p2.md`.
 *
 * THE BASE. What "already on its base" means depends on where this runs:
 *   · a pull request in Actions (GITHUB_EVENT_NAME=pull_request): the checkout
 *     is GitHub's merge commit, whose first parent is the base branch's tip it
 *     merged into. The raw commit names that parent even in a shallow (depth 1)
 *     checkout, so this reads it with `git cat-file`, fetches that one commit
 *     at depth 1 if it is not here, and compares trees, which needs no history.
 *   · a merge queue entry (merge_group): `merge_group.base_sha` from the event
 *     payload, fetched the same way.
 *   · anywhere else (a local `npm run test:guards`, a PR checkout of the head
 *     commit): the merge base of HEAD with DECISION_APPEND_BASE, or with
 *     `origin/<GITHUB_BASE_REF or main>`.
 *   · a push (GITHUB_EVENT_NAME=push): no pull request, so it says it skipped
 *     and exits 0. The change was checked as a pull request before it merged.
 * The working tree is compared with the base, so a local run sees uncommitted
 * edits too; in CI the working tree is HEAD.
 *
 * IT FAILS WHEN IT CANNOT SEE, like `migration-immutability-gate.mjs` and
 * `changelog-gate.mjs`: a base that does not resolve, does not fetch, or shares
 * no history with HEAD exits 2 with its own sentence, never a pass. A base with
 * no decision file on it is the same failure, because the folder path would be
 * wrong and every diff empty.
 *
 * Exit codes: 0 no existing decision file gained a section (or a push, said
 * so); 1 at least one did; 2 the check could not be made.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ISSUE_NUMBERED_FROM, fileDecisionId, filePart } from './check-decision-ids.mjs';

const NAME = 'decision-appends';
export const DIR = 'documentation/architecture/decisions';

/**
 * The most a change may grow an existing decision file without adding a
 * heading. Measured on main from 2026-09-01 (822 edits to an existing decision
 * file): 140 grew 1-3 lines (one added a heading) and 82 grew 4-10 (32 added a
 * heading, which the heading rule fails anyway), while of the 114 that grew
 * 11-20 lines, 91 added a heading and the rest appended an unheaded addendum
 * (for example `33f5c363b7`, eleven lines of later behaviour at the end of
 * D5207.md). Ten keeps every corrected sentence or added bullet and refuses a
 * paragraph of new record.
 */
export const MAX_NET_LINES = 10;

const stripFences = (md) => md.replace(/^```[\s\S]*?^```/gm, '');

/** Every `##` and `###` heading line outside fenced code, in order. */
export function sectionHeadings(md) {
  return [...stripFences(md).matchAll(/^#{2,3}[ \t]+\S.*$/gm)].map((m) => m[0].trim());
}

const lineCount = (text) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

/** `D4838.md` → { id: 4838, part: null }; `D4811-p21.md` → { id: 4811, part: 21 }; else null. */
export function decisionName(name) {
  const id = fileDecisionId(name);
  if (id != null) return { id, part: null };
  const p = filePart(name);
  return p ? { id: p.id, part: p.part } : null;
}

/**
 * The appends in a set of edited files, each `{ name, before, after }` (the
 * text on the base and now). Returns one finding per offending file.
 */
export function findAppends(files, { maxNetLines = MAX_NET_LINES } = {}) {
  const found = [];
  for (const { name, before, after } of files) {
    const decision = decisionName(name);
    if (!decision) continue;
    const was = sectionHeadings(before);
    const left = [...was];
    const added = [];
    for (const h of sectionHeadings(after)) {
      const i = left.indexOf(h);
      if (i >= 0) left.splice(i, 1);
      else added.push(h);
    }
    // A renamed heading is one out and one in; only a higher count is a new section.
    const newSections = sectionHeadings(after).length - was.length;
    const growth = lineCount(after) - lineCount(before);
    if (newSections > 0 || growth > maxNetLines) {
      found.push({ name, ...decision, newSections: Math.max(newSections, 0), headings: added, growth });
    }
  }
  return found;
}

/** The failure text for one finding. `parts` lists the part numbers already in the folder for its decision. */
export function formatAppend(f, { base, parts = [] } = {}) {
  const path = `${DIR}/${f.name}`;
  const what = [];
  if (f.newSections > 0) {
    what.push(`${f.newSections} new section heading${f.newSections === 1 ? '' : 's'}`
      + (f.headings.length ? ` (${f.headings.slice(0, 3).map((h) => `"${h}"`).join(', ')}${f.headings.length > 3 ? ', …' : ''})` : ''));
  }
  if (f.growth > MAX_NET_LINES) what.push(`${f.growth} more lines (at most ${MAX_NET_LINES} without a new decision file)`);
  const lines = [
    `✖ ${NAME}: ${path} is already on the base (${base}), and this change appends to it: ${what.join(', ')}.`,
  ];
  if (f.id >= ISSUE_NUMBERED_FROM) {
    const taken = [...new Set(parts)].sort((a, b) => a - b);
    const next = Math.max(1, ...taken) + 1;
    lines.push(
      `    A later part writes its own file (D5615). Put the new text in ${DIR}/D${f.id}-p<k>.md, headed`,
      `      ## D${f.id} part <k> — <title> (#${f.id})`,
      `    where <k> is the part of #${f.id} you are building`
        + (taken.length ? ` (taken: ${taken.join(', ')}; the next free number is ${next}),` : ` (no part file exists yet; part 1 is D${f.id}.md itself),`),
    );
  } else {
    lines.push(
      `    D${f.id} predates issue-numbered decisions, so it takes no part files (D5615). Put the new text in your`,
      `    own issue's decision file, ${DIR}/D<issue>.md, citing D${f.id},`,
    );
  }
  lines.push(
    `    and take it out of ${f.name}: \`git diff ${base} -- ${path}\` shows what this change adds there.`,
    `    A typo or link fix passes: it adds no heading and at most ${MAX_NET_LINES} lines.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The git side.

class CannotCheck extends Error {}

function makeGit(cwd) {
  // execFileSync, never a shell: refs and paths are data, not script text.
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

const gitError = (e) => (e && e.stderr ? String(e.stderr).trim() : '') || (e && e.message) || String(e);
const REF_NAME = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const SHA = /^[0-9a-f]{40}$/;

function hasCommit(git, ref) {
  try {
    git(['cat-file', '-e', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function ensureCommit(git, sha, what) {
  if (hasCommit(git, sha)) return;
  try {
    git(['fetch', '--no-tags', '--depth=1', 'origin', sha]);
  } catch (e) {
    throw new CannotCheck(`${what} (${sha}) is not in this checkout and could not be fetched: ${gitError(e)}`);
  }
  if (!hasCommit(git, sha)) throw new CannotCheck(`${what} (${sha}) did not resolve after fetching it.`);
}

function readEvent(env) {
  if (!env.GITHUB_EVENT_PATH) return {};
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** HEAD's parents, read from the raw commit, which names them even in a shallow checkout. */
function rawParents(git) {
  return git(['cat-file', '-p', 'HEAD']).split('\n').filter((l) => l.startsWith('parent ')).map((l) => l.slice(7).trim());
}

/**
 * `{ skip }` for a push, else `{ base, how }`, where `base` is a commit the
 * working tree is compared with. Throws CannotCheck when there is none.
 */
export function resolveBase(git, env) {
  const event = env.GITHUB_EVENT_NAME || '';
  if (event === 'push') {
    return { skip: `a push to ${String(env.GITHUB_REF || 'a branch').replace(/^refs\/heads\//, '')} is not a pull request, so there is no base to hold it to; it was checked as a pull request before it merged` };
  }
  if (event === 'merge_group') {
    const sha = String(readEvent(env).merge_group?.base_sha || '').toLowerCase();
    if (!SHA.test(sha)) throw new CannotCheck('a merge queue entry needs merge_group.base_sha in the event payload, and there is none.');
    ensureCommit(git, sha, 'the main commit this queue entry was built on');
    return { base: sha, how: `the queue's base ${sha.slice(0, 10)}` };
  }
  if (event === 'pull_request' && !env.DECISION_APPEND_BASE) {
    const parents = rawParents(git);
    if (parents.length === 2) {
      ensureCommit(git, parents[0], "the base tip GitHub merged this pull request into");
      return { base: parents[0], how: `the base tip ${parents[0].slice(0, 10)} (first parent of the PR merge commit)` };
    }
  }
  const ref = env.DECISION_APPEND_BASE || `origin/${env.GITHUB_BASE_REF || 'main'}`;
  if (!REF_NAME.test(ref)) throw new CannotCheck(`'${ref}' is not a plain ref name, so no base can be resolved from it.`);
  if (!hasCommit(git, ref) && !env.DECISION_APPEND_BASE && env.GITHUB_ACTIONS) {
    const branch = ref.slice('origin/'.length);
    try {
      git(['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    } catch (e) {
      throw new CannotCheck(`the base branch ${branch} did not fetch: ${gitError(e)}`);
    }
  }
  if (!hasCommit(git, ref)) throw new CannotCheck(`${ref} does not resolve to a commit, so there is no base to compare against.`);
  let mergeBase;
  try {
    mergeBase = git(['merge-base', ref, 'HEAD']).trim();
  } catch {
    throw new CannotCheck(`HEAD shares no history with ${ref} here (a shallow checkout has none), so this change's own edits cannot be told apart.`);
  }
  return { base: mergeBase, how: `the merge base ${mergeBase.slice(0, 10)} with ${ref}` };
}

export function main({ cwd = process.cwd(), env = process.env, log = console.log, error = console.error } = {}) {
  const git = makeGit(cwd);
  let root;
  try {
    root = git(['rev-parse', '--show-toplevel']).trim();
  } catch (e) {
    error(`✖ ${NAME}: not a git checkout, so there is nothing to compare: ${gitError(e)}`);
    return 2;
  }
  const rgit = makeGit(root);
  let resolved;
  try {
    resolved = resolveBase(rgit, env);
  } catch (e) {
    if (!(e instanceof CannotCheck)) throw e;
    error(`✖ ${NAME}: could not check: ${e.message}`);
    return 2;
  }
  if (resolved.skip) {
    log(`- ${NAME}: skipped, not checked: ${resolved.skip}.`);
    return 0;
  }
  const { base, how } = resolved;
  let onBase = [];
  try {
    onBase = rgit(['ls-tree', '--name-only', '-z', `${base}:${DIR}`]).split('\0').filter((n) => decisionName(n));
  } catch {
    // No such folder on the base: reported just below as a pass over nothing.
  }
  if (!onBase.length) {
    error(`✖ ${NAME}: could not check: ${base} holds no decision file under ${DIR}/, so this check would pass over nothing.`);
    return 2;
  }
  // The working tree against the base: modified files only. A file the change
  // adds is not on the base, so it is not "existing".
  const changed = rgit(['diff', '--no-renames', '--name-only', '-z', '--diff-filter=M', base, '--', DIR])
    .split('\0').filter(Boolean)
    .map((p) => p.slice(DIR.length + 1))
    .filter((n) => !n.includes('/') && decisionName(n));
  const files = changed.map((name) => ({
    name,
    before: rgit(['show', `${base}:${DIR}/${name}`]),
    after: readFileSync(join(root, DIR, name), 'utf8'),
  }));
  const found = findAppends(files);
  if (found.length) {
    const here = existsSync(join(root, DIR)) ? readdirSync(join(root, DIR)) : [];
    for (const f of found) {
      const parts = [...onBase, ...here].map(decisionName).filter((d) => d && d.id === f.id && d.part != null).map((d) => d.part);
      error(formatAppend(f, { base: base.slice(0, 10), parts }));
    }
    return 1;
  }
  log(`✓ ${NAME}: against ${how}, ${changed.length} of the ${onBase.length} decision files already there changed, and none gained a section or more than ${MAX_NET_LINES} lines.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main();
}
