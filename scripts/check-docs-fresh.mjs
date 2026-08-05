#!/usr/bin/env node
/**
 * docs/ freshness guard.
 *
 * `docs/` is the committed output of the frontend build (see CLAUDE.md's file
 * map and `scripts/build-frontend.mjs`, whose Vite `outDir` is `../docs`).
 *
 * WHY THIS MATTERS EVEN THOUGH `npm run deploy` REBUILDS IT. The deploy script
 * runs `npm run build` before `wrangler deploy`, so the Worker-served SPA is
 * always built from current source — a stale `docs/` does NOT ship stale JS to
 * users. What it does ship stale is everything that reads the COMMITTED bytes:
 *   - the `og-tags` CI job, which validates "the bytes a crawler actually
 *     receives" (.github/workflows/ci.yml);
 *   - prerendered OG/social metadata (scripts/prerender-og.mjs writes into
 *     docs/), so link previews describe an older build;
 *   - any GitHub Pages serving of docs/ (the historical publish path).
 *
 * So the failure mode is quiet and outward-facing: social cards and crawler
 * views drift behind the app while every local test stays green. This guard
 * makes that drift loud.
 *
 * The check is deliberately COMMIT-BASED, not mtime-based: a fresh clone
 * rewrites every mtime, so timestamps say nothing. We compare the last commit
 * that touched `frontend/src` against the last commit that touched `docs/`.
 *
 * Outside a git checkout (or with no history) the check SKIPS rather than
 * fails — it must never block a tarball build.
 *
 * SEVERITY: warns (exit 0) by default, fails (exit 1) under `--strict`.
 * Rebuilding docs/ requires a LOCKFILE-FAITHFUL `npm ci` in frontend/ — a build
 * from drifted dependency versions produces a bundle that differs from what the
 * deploy would emit, which is worse than a stale one because the diff is noise
 * nobody can attribute. So the local gate reports the drift, and `--strict` is
 * used in CI, where `npm ci` has actually run.
 *
 * Fix when it fires:
 *   cd frontend && npm ci && cd .. && npm run build && git add docs && git commit -m "Rebuild docs/"
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const skip = (why) => {
  console.log(`• check-docs-fresh: skipped — ${why}`);
  process.exit(0);
};

if (!existsSync(join(ROOT, '.git'))) skip('not a git checkout');
if (!existsSync(join(ROOT, 'docs'))) skip('no docs/ directory');

// Commit timestamps (epoch seconds) of the newest commit touching each path.
const srcTs = Number(git(['log', '-1', '--format=%ct', '--', 'frontend/src']));
const docsTs = Number(git(['log', '-1', '--format=%ct', '--', 'docs']));

if (!Number.isFinite(srcTs) || !srcTs) skip('no commit history for frontend/src');
if (!Number.isFinite(docsTs) || !docsTs) skip('no commit history for docs/');

if (docsTs >= srcTs) {
  console.log('✓ check-docs-fresh: committed docs/ build is at or ahead of frontend/src.');
  process.exit(0);
}

const srcInfo = git(['log', '-1', '--format=%h %ad %s', '--date=short', '--', 'frontend/src']);
const docsInfo = git(['log', '-1', '--format=%h %ad %s', '--date=short', '--', 'docs']);
// Source commits since the last docs rebuild — the size of the drift.
const behind = git(['rev-list', '--count', `${git(['log', '-1', '--format=%H', '--', 'docs'])}..HEAD`, '--', 'frontend/src']);

const strict = process.argv.includes('--strict');
const mark = strict ? '✖' : '⚠';
const write = strict ? console.error : console.warn;

write(`
${mark} check-docs-fresh: the committed docs/ build is behind frontend/src.

  frontend/src last changed:  ${srcInfo}
  docs/ last rebuilt:         ${docsInfo}
  frontend/src commits since: ${behind || 'unknown'}

  The live SPA is fine — \`npm run deploy\` rebuilds docs/ before deploying.
  What IS stale is everything served from the committed bytes: prerendered OG
  metadata and social link previews, and the og-tags CI job that validates them.

  Fix (the npm ci matters — building from drifted dependency versions emits a
  bundle that differs from the deploy's, which is worse than a stale one):
    cd frontend && npm ci && cd .. && npm run build && git add docs && git commit -m "Rebuild docs/"
${strict ? '' : '\n  Warning only. Run with --strict (CI does) to make this fail.\n'}`);
process.exit(strict ? 1 : 0);
