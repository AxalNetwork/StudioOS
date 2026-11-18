// #6475: merge mode for the model runner: put main's merge into the checkout, conflicts and all, as data.
/**
 * The conflict resolver (#6475) asks the runner to edit a merge that has not
 * happened yet: the PR head with main merged in, its conflicted files still
 * holding their markers. `stageMerge` builds that tree in a checkout of the PR
 * head, the same way in the `edit` job, the `verify` job and the resolver's
 * `apply` job, so all three see byte-identical conflicted files and the
 * patch's before-hashes can be re-checked in each.
 *
 * It runs git over data only, with the branch keeper's settings: hooks, LFS,
 * filters, textconv, fsmonitor and submodules off, and merge rules from main's
 * `.gitattributes` alone (`$GIT_DIR/info/attributes`, keeper-merge.mjs). No
 * code from either side runs. The conflict style is pinned, so the markers do
 * not depend on a runner's git configuration.
 *
 * It refuses, before any model call, when the head is not the expected commit,
 * when main cannot be read, or when a conflict is not a both-sides edit (one
 * side deleted or renamed the file): those need a person.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributesFrom, gitIn } from '../keeper-merge.mjs';
import { parseTask } from './task.mjs';

const SHA = /^[0-9a-f]{40}$/;
/** Pinned so every job writes the same markers: `<<<<<<< HEAD`, `=======`, `>>>>>>> <main sha>`. */
export const MERGE_CONFIG = Object.freeze(['merge.conflictStyle=merge', 'merge.renames=false', 'rerere.enabled=false']);

/**
 * Merge `mainSha` into the checked-out head of `dir`, leaving conflicts in the tree.
 * @param opts { mainSha, headSha?, fetch? (fetch mainSha from origin first), git? }
 * @returns { ok: true, head, main, base, conflicted: [path] } | { ok: false, reason, conflicted? }
 */
export function stageMerge(dir, { mainSha, headSha = null, fetch = false, git = gitIn(dir) } = {}) {
  if (!SHA.test(String(mainSha))) return { ok: false, reason: 'the main commit is not a full SHA' };
  const g = (argv, o) => git([...MERGE_CONFIG.flatMap((c) => ['-c', c]), ...argv], o);
  const head = g(['rev-parse', 'HEAD']).out.trim();
  if (headSha && head !== headSha) return { ok: false, reason: 'the checkout is not the expected head commit' };
  if (fetch) g(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'origin', mainSha], { allowFail: true });
  if (!g(['cat-file', '-e', `${mainSha}^{commit}`], { allowFail: true }).ok) return { ok: false, reason: 'main\'s commit could not be read' };
  const base = g(['merge-base', head, mainSha], { allowFail: true });
  if (!base.ok || !SHA.test(base.out.trim())) return { ok: false, reason: 'the PR and main have no merge base' };

  const gitDir = g(['rev-parse', '--absolute-git-dir']).out.trim();
  const mainAttrs = g(['show', `${mainSha}:.gitattributes`], { allowFail: true });
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  writeFileSync(join(gitDir, 'info', 'attributes'), attributesFrom(mainAttrs.ok ? mainAttrs.out : '', { merge: true }));

  const merged = g(['merge', '--no-commit', '--no-ff', mainSha], { allowFail: true });
  if (merged.ok) return { ok: false, reason: 'main merges without a conflict; the branch keeper merges it, not the resolver' };
  const ls = g(['ls-files', '--unmerged', '-z']).out.split('\0').filter(Boolean);
  const stages = new Map();
  for (const row of ls) {
    const m = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(row);
    if (!m) return { ok: false, reason: 'git reported a conflict it could not describe' };
    if (!stages.has(m[2])) stages.set(m[2], new Set());
    stages.get(m[2]).add(Number(m[1]));
  }
  const conflicted = [...stages.keys()].sort();
  if (!conflicted.length) return { ok: false, reason: 'git could not merge main, and reported no conflicted file' };
  const oneSided = conflicted.filter((p) => !(stages.get(p).has(2) && stages.get(p).has(3)));
  if (oneSided.length) return { ok: false, reason: 'one side deleted or renamed a conflicted file', conflicted: oneSided };
  return { ok: true, head, main: mainSha, base: base.out.trim(), conflicted };
}

/** The three versions git kept for a conflicted path: base (null for an add/add), the PR's and main's. */
export function sidesOf(dir, path, { git = gitIn(dir) } = {}) {
  const show = (n) => { const r = git(['show', `:${n}:${path}`], { allowFail: true }); return r.ok ? r.out : null; };
  return { base: show(1), ours: show(2), theirs: show(3) };
}

export { sameFiles } from './task.mjs';

/**
 * The step a merge-mode round runs before `edit.mjs` or `verify.mjs`, in its own process:
 *   node stage.mjs --task task.json --work <checkout> --out stage.json
 * It writes the report those modules check (`stageProblems` in task.mjs); with no `merge_sha` it writes nothing.
 */
export function stageMain({ task: taskPath, work, out }) {
  const { task, errors } = parseTask(readFileSync(taskPath, 'utf8'));
  if (!task) { writeFileSync(out, JSON.stringify({ ok: false, reason: `the task is invalid: ${errors[0]}` })); return { ok: false }; }
  if (!task.merge_sha) return { ok: true, skipped: true };
  const r = stageMerge(work, { mainSha: task.merge_sha, headSha: task.head_sha, fetch: true });
  writeFileSync(out, JSON.stringify(r.ok ? { ok: true, head: r.head, main: r.main, conflicted: r.conflicted } : { ok: false, reason: r.reason }));
  return r;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
    const r = stageMain({ task: opt('task'), work: opt('work'), out: opt('out') });
    console.log(`landing-bot model: merge ${r.skipped ? 'not asked' : r.ok ? `staged, ${r.conflicted.length} conflicted file(s)` : `refused (${r.reason})`}`);
  } catch (e) {
    console.error(`landing-bot model: staging failed (${String(e?.message || e).slice(0, 200)})`);
    process.exitCode = 1;
  }
}
