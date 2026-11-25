/**
 * D8432 (#8432): what a clean merge can still break. Two pull requests that are each valid can merge without a textual
 * conflict into a tree that is not: on 2026-11-24 one job gained the key `permissions` twice that way and the
 * merge queue lost two rounds. This module reads the tree `git merge-tree` writes for a pull request head and
 * its base, and reports what is wrong in it that is not already wrong on the base. It reads file contents as
 * data: nothing from the pull request is checked out or run.
 *
 * It has no dependency, because the landing list runs from a bare checkout. `duplicateYamlKeys` is therefore a
 * line scanner for block-style mappings, not a YAML parser; its test holds it to the real parser on every
 * workflow file in the repository. It is advisory: the credential guard in the queue is the authority.
 */
import { spawnSync } from 'node:child_process';

const SHA = /^[a-f0-9]{40}$/;
const KEY = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^\s#'"&*!|>%@`[\]{},-][^#]*?|-[^\s#][^#]*?))\s*:(?:\s|$)(.*)$/;
const BLOCK_SCALAR = /^[|>][+-]?[1-9]?[+-]?\s*(?:#.*)?$/;

/**
 * Keys given twice in one block mapping, as `{ line, column, key }` for the second and later uses. Block
 * scalars, comments, flow collections and multi-line quoted scalars are skipped rather than interpreted.
 */
export function duplicateYamlKeys(source) {
  const found = [];
  /** Open mappings, innermost last: the column their keys start at and the keys seen. */
  const open = [];
  let scalarAbove = -1;   // inside a block scalar: skip lines indented deeper than this
  let quote = null;       // inside a multi-line quoted scalar: the quote character
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (quote) { if (closesQuote(raw, quote)) quote = null; continue; }
    if (!raw.trim()) continue;
    let column = raw.length - raw.trimStart().length;
    if (scalarAbove >= 0) { if (column > scalarAbove) continue; scalarAbove = -1; }
    let rest = raw.slice(column);
    if (rest.startsWith('#') || rest.startsWith('---') || rest.startsWith('...')) continue;
    // Each `- ` opens a new sequence entry: every mapping inside the dash's column is finished.
    while (/^-(?:\s|$)/.test(rest)) {
      while (open.length && open.at(-1).column > column) open.pop();
      const step = rest.length - rest.slice(1).trimStart().length;
      column += step; rest = rest.slice(step);
    }
    if (!rest || rest.startsWith('#')) continue;
    const match = KEY.exec(rest);
    if (!match) {
      // A plain or flow value. If it opens a quote it does not close, skip to the closing line.
      quote = opensQuote(rest);
      continue;
    }
    const key = match[1] ?? match[2] ?? match[3].trim();
    while (open.length && open.at(-1).column > column) open.pop();
    if (!open.length || open.at(-1).column < column) open.push({ column, keys: new Set() });
    const mapping = open.at(-1);
    if (mapping.keys.has(key)) found.push({ line: index + 1, column: column + 1, key });
    mapping.keys.add(key);
    const value = match[4].trim();
    if (BLOCK_SCALAR.test(value)) scalarAbove = column;
    else quote = opensQuote(value);
  }
  return found;
}

/** The quote a value leaves open at the end of its line, or null. Only a value that starts with a quote counts. */
function opensQuote(value) {
  const first = value[0];
  if (first !== '"' && first !== "'") return null;
  return closesQuote(value.slice(1), first) ? null : first;
}
function closesQuote(text, quote) {
  for (let i = 0; i < text.length; i++) {
    if (quote === '"' && text[i] === '\\') { i++; continue; }
    if (text[i] === quote) { if (quote === "'" && text[i + 1] === "'") { i++; continue; } return true; }
  }
  return false;
}

const git = (args, { cwd, spawn }) => spawn('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });

/** The duplicate keys of one workflow file in a tree; an empty list when the file is not there. */
function fileProblems(tree, path, options) {
  const file = git(['cat-file', 'blob', `${tree}:${path}`], options);
  if (file.error) return null;
  return file.status === 0 ? duplicateYamlKeys(file.stdout) : [];
}

/**
 * What merging `head` into `base` would break. `status` is:
 *   clean        it merges, and the merged tree has no problem the base does not already have
 *   conflict     it does not merge without a conflict
 *   breaks       it merges, and `problems` lists what the merged tree has that the base does not
 *   not checked  git could not answer (a missing object, a timeout, a malformed SHA)
 * Only workflow files that differ between the base and the merged tree are read: a problem new to the merge can
 * be nowhere else. A key already given twice on the base is the base's to fix and is not reported.
 */
export function mergeSkew(base, head, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  const unknown = { status: 'not checked', problems: [] }, options = { cwd, spawn };
  if (![base, head].every(sha => SHA.test(sha ?? ''))) return unknown;
  const merged = git(['merge-tree', '--write-tree', base, head], options);
  if (merged.error || ![0, 1].includes(merged.status)) return unknown;
  // git also exits 1 for a commit it cannot find. A real result, clean or conflicted, starts with the tree it wrote.
  const tree = String(merged.stdout ?? '').split('\n')[0].trim();
  if (!SHA.test(tree)) return unknown;
  if (merged.status === 1) return { status: 'conflict', problems: [] };
  const changed = git(['diff-tree', '-r', '--name-only', '--no-renames', base, tree, '--', '.github/workflows/'], options);
  if (changed.error || changed.status !== 0) return unknown;
  const problems = [];
  for (const path of changed.stdout.split('\n').filter(name => /\.ya?ml$/i.test(name)).sort()) {
    const after = fileProblems(tree, path, options), before = fileProblems(base, path, options);
    if (!after || !before) return unknown;
    const known = new Set(before.map(hit => hit.key));
    for (const hit of after) if (!known.has(hit.key)) problems.push(`${path}:${hit.line}:${hit.column} key ${hit.key.slice(0, 60)} is given twice`);
  }
  return { status: problems.length ? 'breaks' : 'clean', problems };
}

/** True when a pull request with this result should not be queued as it stands. */
export const blocksQueue = skew => skew?.status === 'conflict' || skew?.status === 'breaks';

/**
 * The check the landing list runs for one pull request: fetch its head without checking it out, confirm the
 * fetched commit is the head GitHub reported, and compare it with the base branch as fetched. Any step that
 * fails answers `not checked`; the list is never held up by this check.
 */
export function skewFor(pr, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  const unknown = { status: 'not checked', problems: [] }, options = { cwd, spawn };
  const number = pr?.number, head = pr?.head?.sha, ref = pr?.base?.ref;
  if (!Number.isSafeInteger(number) || number <= 0 || !SHA.test(head ?? '') || !/^[\w][\w./-]{0,199}$/.test(ref ?? '') || ref.includes('..')) return unknown;
  const base = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}^{commit}`], options);
  if (base.error || base.status !== 0) return unknown;
  const fetched = git(['fetch', '--no-tags', '--quiet', 'origin', `refs/pull/${number}/head`], options);
  if (fetched.error || fetched.status !== 0) return unknown;
  const got = git(['rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}'], options);
  if (got.error || got.status !== 0 || got.stdout.trim() !== head) return unknown;
  return mergeSkew(base.stdout.trim(), head, options);
}
