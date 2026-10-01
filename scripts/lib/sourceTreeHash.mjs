/**
 * A content hash of a source tree, as it exists on disk right now.
 *
 * WHY IT IS NOT A GIT CALL. The build runs against the WORKING TREE, usually
 * before the commit that will carry it, so `git rev-parse HEAD:frontend/src`
 * describes the wrong thing — the tree as it was one commit ago — and
 * `git ls-files -s` misses unstaged edits. The build has to record what it
 * actually consumed, which is the bytes on disk. This also means it works in a
 * tarball with no git history at all.
 *
 * DETERMINISM IS THE WHOLE POINT, so two things are pinned that would otherwise
 * vary by machine: `readdirSync` order is not specified, so the full file list
 * is sorted; and path separators are normalised to `/` so a Windows checkout
 * and a Linux one agree.
 *
 * Used by `scripts/build-frontend.mjs` to stamp `docs/.build-source` with the
 * source it built from, and by `scripts/check-docs-fresh.mjs` to ask whether
 * the committed `docs/` is that build. See D103.
 *
 * NOT `docs/.asset-retention.json`, which this comment claimed until D113
 * corrected it. That file is gitignored on purpose — 45 KB that churns
 * wholesale on every rebuild — so CI never sees it and a stamp inside it would
 * answer nobody. D103 says so at length; the comment here had simply never
 * caught up with the code it describes.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Every file under `dir`, recursively, as absolute paths.
 *
 * Symlinks are followed only for regular files (`isFile()` is false for a
 * symlink entry unless `withFileTypes` resolved it), which is the conservative
 * reading: a link the build does not follow should not change the hash.
 *
 * `readdir` IS INJECTABLE BECAUSE THE SORT IS OTHERWISE UNTESTABLE. ext4
 * enumerates a directory by filename hash, not creation order, so on the
 * machines this repo builds on an unsorted walk comes back sorted anyway and
 * deleting `.sort()` breaks nothing observable — it survived a mutation run
 * against the real filesystem. An assertion that cannot fail is not a guard, so
 * the test supplies a reader that returns entries reversed. Production callers
 * pass nothing and get `readdirSync`.
 */
export function sourceFiles(dir, readdir = readdirSync) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * SHA-256 over the sorted (relative path, file content) pairs of `dir`.
 *
 * The path is hashed alongside the content, so a rename with no edit still
 * changes the result — renaming a module is a real change to what the build
 * consumes even when every byte survives.
 *
 * Throws if `dir` does not exist. A hash that silently means "nothing here"
 * would let a missing source tree read as a matching one.
 */
export function sourceTreeHash(dir, readdir = readdirSync) {
  const files = sourceFiles(dir, readdir);
  const h = createHash('sha256');
  for (const file of files) {
    h.update(relative(dir, file).split(sep).join('/'));
    h.update('\0');
    h.update(createHash('sha256').update(readFileSync(file)).digest());
    h.update('\n');
  }
  return h.digest('hex');
}
