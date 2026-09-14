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
 *   - reviewers reading the committed diff, and — if the repository still has
 *     GitHub Pages enabled — the auto-generated `pages-build-deployment`
 *     workflow, which publishes the committed docs/ to a host nothing routes
 *     to (both production hosts have been Worker-served since 2026-09-01;
 *     the Cloudflare Pages mirror, which rebuilt docs/ from source like the
 *     Worker deploy does, was retired on 2026-09-03 — DECISIONS.md D36).
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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceTreeHash } from './lib/sourceTreeHash.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const strict = process.argv.includes('--strict');

/**
 * A check that cannot answer the question must not answer yes.
 *
 * Under `--strict` every skip becomes a FAILURE. Skipping is right for a
 * developer running the suite in a tarball or a fresh clone with no history —
 * it is wrong for the gate whose entire job is to assert freshness, because
 * there a silent exit 0 is indistinguishable from a pass.
 */
const skip = (why) => {
  if (strict) {
    console.error(`\u2716 check-docs-fresh: cannot verify freshness — ${why}.`);
    console.error('  Refusing to pass: this check exists to assert the committed');
    console.error('  docs/ build is current, and it cannot see enough to say so.');
    process.exit(1);
  }
  console.log(`\u2022 check-docs-fresh: skipped — ${why}`);
  process.exit(0);
};

if (!existsSync(join(ROOT, 'docs'))) skip('no docs/ directory');

// ---------------------------------------------------------------------------
// THE DIRECT ANSWER, WHEN THE BUILD LEFT ONE.
//
// Everything below this block is the commit-timestamp proxy, and a proxy is all
// it was: "docs/ was committed after frontend/src" is evidence that someone
// probably rebuilt, not that they did. It is wrong in both directions.
//
//   FALSE PASS — commit docs/ without rebuilding and the timestamps say fresh
//   forever. Nothing caught that.
//   FALSE FAIL — a comment-only or type-only edit to frontend/src emits a
//   BYTE-IDENTICAL bundle (the minifier strips comments, tsc erases types), so
//   `npm run build` leaves docs/ untouched, there is nothing to `git add`, and
//   the gate fails with no way to satisfy it. Its own printed fix — rebuild and
//   commit — cannot pass, because `git commit` on an empty change refuses.
//   #207's PR hit exactly this and is why this block exists (D103).
//
// So `scripts/build-frontend.mjs` now stamps the retention ledger with a hash
// of the source tree it consumed, and the question becomes the real one: is the
// committed docs/ the build of THIS source? That needs no git history, so it
// also answers in a tarball, where the proxy could only refuse.
// ---------------------------------------------------------------------------
// NOT `docs/.asset-retention.json`, which is the other file every build writes:
// that one is gitignored on purpose (45 KB of churn), so CI never sees it.
const STAMP = join(ROOT, 'docs', '.build-source');
const SRC = join(ROOT, 'frontend', 'src');

const stampedSource = (() => {
  try {
    const v = readFileSync(STAMP, 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;  // docs/ built before builds recorded their source
  }
})();

if (stampedSource && existsSync(SRC)) {
  const actual = sourceTreeHash(SRC);
  if (actual === stampedSource) {
    console.log('✓ check-docs-fresh: committed docs/ is the build of the current frontend/src.');
    process.exit(0);
  }
  const mark = strict ? '✖' : '⚠';
  const write = strict ? console.error : console.warn;
  write(`
${mark} check-docs-fresh: the committed docs/ build is not the build of this source.

  docs/ was built from:  ${stampedSource.slice(0, 12)}…
  frontend/src is now:   ${actual.slice(0, 12)}…

  The live SPA is fine — \`npm run deploy\` rebuilds docs/ before deploying.
  What IS stale is everything served from the committed bytes: prerendered OG
  metadata and social link previews, and the og-tags CI job that validates them.

  Fix (the npm ci matters — building from drifted dependency versions emits a
  bundle that differs from the deploy's, which is worse than a stale one):
    cd frontend && npm ci && cd .. && npm run build && git add docs && git commit -m "Rebuild docs/"
`);
  process.exit(strict ? 1 : 0);
}

// ---------------------------------------------------------------------------
// FALLBACK: the commit-timestamp proxy, for a docs/ built before the stamp
// existed. Kept rather than deleted so an older checkout still gets an answer.
// ---------------------------------------------------------------------------
if (!existsSync(join(ROOT, '.git'))) skip('not a git checkout');

// A SHALLOW CHECKOUT CANNOT ANSWER THIS, AND USED TO PASS ANYWAY.
//
// `actions/checkout` defaults to `fetch-depth: 1`. In a depth-1 clone there is
// exactly ONE commit, so both `git log -1` calls below resolve to that same
// commit and `docsTs >= srcTs` is trivially true. The gate exited 0 on every
// run regardless of the real state — which is how docs/ came to sit four
// frontend commits behind with a green check on each one. Measured, on this
// repository, with identical content in both checkouts:
//
//   depth-1 clone:                  src ts == docs ts   ->  passed, exit 0
//   full clone, same content:       src != docs         ->  failed, exit 1
//
// Depth-N is unsafe in a subtler way: a path whose newest commit falls outside
// the window returns nothing, and the `skip` above exited 0 for that too. With
// a truncated history you cannot know whether the newest commit you can see is
// the real newest, so the honest answer is to refuse rather than guess.
//
// The `og-tags` job passes `fetch-depth: 0` for exactly this reason. The two
// changes must land together: without the workflow change this fails on every
// PR, and without this the workflow change buys nothing.
if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
  skip('the checkout is shallow, so the newest commit touching each path is not knowable (set fetch-depth: 0)');
}

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
