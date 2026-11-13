/**
 * D5612 (#5612) — what "sound" means for a generated module that is NOT
 * committed: the route registry, the API index and the skill library.
 *
 * Until D5612 each generator's `--check` compared the committed file with a
 * fresh render ("stale"). The three files are now gitignored and built before
 * every build, typecheck and test (`scripts/build-generated.mjs`), so there is
 * nothing committed to be stale. What can still go wrong is:
 *
 *   - the generator is not deterministic: the same sources render to two
 *     different texts (a listing that is no longer sorted), so two machines
 *     build two different Workers from one commit;
 *   - the output is tracked again (`git add -f`), which brings back the merge
 *     conflicts D5612 removed.
 *
 * `generatedOutputProblems` checks both: it renders twice, once from the
 * sources as listed and once from the listing reversed, compares the bytes,
 * and asks `git ls-files` whether the output is tracked. Node built-ins only:
 * it runs before `npm ci`.
 */
import { execFileSync } from 'node:child_process';

/**
 * Whether `git ls-files` lists `rel` under `root`. Outside a git work tree (a
 * fixture directory, an unpacked tarball) nothing is tracked.
 */
export function trackedByGit(root, rel) {
  try {
    const out = execFileSync('git', ['ls-files', '--', rel], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Everything wrong with one generated output. `build({ reversed })` renders it
 * from the sources under `root`; `reversed: true` reverses every listing the
 * render reads before the generator orders it. Empty when sound.
 */
export function generatedOutputProblems(root, rel, build) {
  const problems = [];
  const once = build({ reversed: false });
  const twice = build({ reversed: true });
  if (once !== twice) {
    problems.push(`${rel} is not deterministic: two renders of the same sources differ (a listing the generator reads is no longer sorted) — fix the generator`);
  }
  if (trackedByGit(root, rel)) {
    problems.push(`${rel} is tracked by git; it is generated and never committed (D5612) — run: git rm --cached ${rel}`);
  }
  return problems;
}
