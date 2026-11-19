// #6474: the branch keeper's merge of main into a PR branch: git only, hooks and filters off, main's merge rules only.
/**
 * GitHub ignores `README.md merge=union`, so a PR whose only conflicts are
 * README rows shows as conflicted although `git merge` on any machine merges
 * it. This merges main into the PR head on the runner, as data:
 *
 *  - hooks, LFS, filters, textconv, fsmonitor and submodules are off for every
 *    git call, so no code from the PR runs;
 *  - merge attributes come from main only: `$GIT_DIR/info/attributes` (which
 *    outranks every in-tree `.gitattributes`) first sets `merge=text` on every
 *    path, then repeats main's own merge rules, so a PR that adds
 *    `*.ts merge=union` changes nothing;
 *  - the merge is done twice: once with main's rules, once with none. Every
 *    path the plain merge conflicts on must be a `README.md`, the union merge
 *    must leave no conflict, and each such README must pass main's
 *    `readmeUnion.mjs` check (no duplicate row, no doubled line).
 *
 * `mergeMain` returns { outcome: 'merged' | 'conflict' | 'refused' | 'up_to_date', ... } and leaves the merge
 * commit checked out only on 'merged'. It never pushes; the caller does.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unionArtifacts } from '../lib/readmeUnion.mjs';

/** Config for every git call: nothing from the repository may run. */
export const SAFE_CONFIG = Object.freeze([
  'core.hooksPath=/dev/null', 'core.fsmonitor=false', 'core.attributesFile=/dev/null',
  'filter.lfs.process=', 'filter.lfs.smudge=', 'filter.lfs.clean=', 'filter.lfs.required=false',
  'diff.external=', 'submodule.recurse=false', 'merge.renormalize=false', 'commit.gpgSign=false',
  'protocol.ext.allow=never', 'protocol.file.allow=never',
]);
export const SAFE_ENV = Object.freeze({
  GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1',
});

const README = /(?:^|\/)README\.md$/;

export function gitIn(dir, { identity = { name: 'landing-bot', email: 'landing-bot@users.noreply.github.com' } } = {}) {
  const env = {
    ...process.env, ...SAFE_ENV,
    GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email,
  };
  const args = SAFE_CONFIG.flatMap((c) => ['-c', c]);
  const run = (argv, { allowFail = false } = {}) => {
    try {
      return { ok: true, out: execFileSync('git', [...args, ...argv], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) };
    } catch (e) {
      if (!allowFail) throw new Error(`git ${argv[0]} failed`);
      return { ok: false, out: String(e.stdout ?? ''), status: e.status };
    }
  };
  return run;
}

/** `$GIT_DIR/info/attributes` content: `merge=text` everywhere, then main's merge rules, nothing else. */
export function attributesFrom(mainAttributes, { merge = true } = {}) {
  const lines = ['* merge=text'];
  if (merge) {
    for (const raw of String(mainAttributes ?? '').split('\n')) {
      const l = raw.trim();
      if (!l || l.startsWith('#')) continue;
      const [pattern, ...attrs] = l.split(/\s+/);
      const m = attrs.filter((a) => /^-?merge(?:=[\w-]+)?$|^!merge$/.test(a));
      if (m.length) lines.push(`${pattern} ${m.join(' ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function conflicted(git) {
  return git(['diff', '--name-only', '--diff-filter=U', '-z']).out.split('\0').filter(Boolean).sort();
}

/**
 * Merge `mainRef` into the checked-out PR head in `dir`.
 * @param opts { mainRef = 'origin/main', message, identity: { name, email } }
 */
export function mergeMain(dir, { mainRef = 'origin/main', message, identity } = {}) {
  const git = gitIn(dir, { identity });
  const gitDir = git(['rev-parse', '--absolute-git-dir']).out.trim();
  const head = git(['rev-parse', 'HEAD']).out.trim();
  const main = git(['rev-parse', `${mainRef}^{commit}`]).out.trim();
  if (git(['merge-base', '--is-ancestor', main, head], { allowFail: true }).ok) return { outcome: 'up_to_date', head, main };

  const mainAttrs = git(['show', `${main}:.gitattributes`], { allowFail: true });
  const attrFile = join(gitDir, 'info', 'attributes');
  mkdirSync(join(gitDir, 'info'), { recursive: true });
  const mergeOnce = (withRules) => {
    writeFileSync(attrFile, attributesFrom(mainAttrs.ok ? mainAttrs.out : '', { merge: withRules }));
    const r = git(['merge', '--no-ff', '--no-edit', '-m', message || `Merge main into this branch (landing bot)\n\nLanding-Bot-Kind: keeper`, main], { allowFail: true });
    const files = r.ok ? [] : conflicted(git);
    const changed = r.ok ? git(['diff', '--name-only', '-z', head, 'HEAD']).out.split('\0').filter(Boolean) : [];
    return { ok: r.ok, files, changed };
  };
  const reset = () => { git(['merge', '--abort'], { allowFail: true }); git(['reset', '--hard', '--quiet', head]); git(['clean', '-fdq']); };

  try {
    // 1. No merge rules at all: what a plain `git merge` (and GitHub) sees.
    const plain = mergeOnce(false);
    reset();
    // 2. Main's merge rules: README.md files union.
    const union = mergeOnce(true);
    if (!union.ok && !union.files.length) { reset(); return { outcome: 'refused', head, main, reason: 'git could not merge main (no conflicted file to report)', files: [] }; }
    if (!union.ok) { const files = union.files; reset(); return { outcome: 'conflict', head, main, files }; }
    const extra = plain.files.filter((f) => !README.test(f));
    if (extra.length) { reset(); return { outcome: 'refused', head, main, reason: 'a file other than a README.md merged only under a merge rule', files: extra }; }
    const problems = [];
    for (const f of plain.files) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const a of unionArtifacts(text)) problems.push(`${f}:${a.line}: ${a.kind}`);
    }
    if (problems.length) { reset(); return { outcome: 'refused', head, main, reason: 'the union merge left a duplicate in a README', files: plain.files, problems }; }
    return { outcome: 'merged', head, main, commit: git(['rev-parse', 'HEAD']).out.trim(), unioned: plain.files };
  } finally {
    writeFileSync(attrFile, '');
  }
}
