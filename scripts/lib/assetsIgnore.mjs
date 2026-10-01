/**
 * The files in `docs/` the Worker's asset upload must not publish (D271).
 *
 * WHY THIS EXISTS. `docs/` is the Worker's `[assets]` directory, and wrangler
 * uploads every file under it — dotfiles included — unless it is named in
 * `docs/.assetsignore`. It hides three files of its own and nothing else:
 * `/.assetsignore`, `/_redirects` and `/_headers` (wrangler 4.131.0,
 * `createAssetsIgnoreFunction`). So until D271 every deploy served the two
 * files `scripts/build-frontend.mjs` writes into `docs/` for its own
 * bookkeeping, at public URLs on both hosts:
 *
 *   · `/.asset-retention.json` — the retention ledger, ~45 KB naming every
 *     retained asset hash and which build kept it;
 *   · `/.build-source` — the SHA-256 of `frontend/src` the bundle was built
 *     from.
 *
 * Neither holds a secret. Both are build state that says nothing to a visitor,
 * and a deploy should publish what it means to publish.
 *
 * THE RULE FOR THE NEXT FILE. Anything `scripts/build-frontend.mjs` writes into
 * `docs/` other than Vite's output and the prerendered shells is published the
 * moment it lands there. So the build names every such file through this
 * module, and `assetsIgnore.test.mjs` refuses a `path.join(docsDir, '<file>')`
 * it cannot trace back here: a new bookkeeping file gets a line below, with the
 * reason it must stay private.
 *
 * THE LINES ARE LITERAL AND ANCHORED. Each is `/` followed by one file name
 * with no glob character. `.assetsignore` is gitignore syntax, so `/name`
 * matches that name at the root of `docs/` and nowhere below it, and a broader
 * pattern (`.*`, `*.json`) would also hide files that must stay public —
 * `/.well-known/security.txt` among them.
 *
 * WHY `_worker.js` IS LISTED. Wrangler refuses to upload a Pages Advanced Mode
 * `_worker.js` only while `docs/` has NO `.assetsignore` — the presence of the
 * file switches that refusal off (`errorOnLegacyPagesWorkerJSAsset`). Writing
 * this file therefore removes a safety net, and listing `/_worker.js` puts the
 * outcome back: a stray entry script stays private rather than being served as
 * source. `apex_truth_doc.test.mjs` still fails the build if one appears at all.
 *
 * WHY `_headers` IS NOT. Wrangler already excludes it by default and reads it
 * by its own path to set the static security headers, so a line here would be
 * redundant today — and if a later wrangler ever consulted this list before
 * parsing it, listing it would switch those headers off on every shell route.
 */

/** The file wrangler reads from the root of the assets directory. */
export const ASSETS_IGNORE_FILENAME = '.assetsignore';

/** The retention ledger `build-frontend.mjs` keeps in `docs/` (gitignored). */
export const RETENTION_LEDGER_FILENAME = '.asset-retention.json';

/** The source-hash stamp `build-frontend.mjs` writes last (D103). */
export const BUILD_STAMP_FILENAME = '.build-source';

/** What a line may name: one file at the root of `docs/`, no glob syntax. */
const LITERAL_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Every file the upload must skip beyond wrangler's own three, each with the
 * reason it stays private. The reason is written into the file as a comment,
 * so whoever reads `docs/.assetsignore` reads why.
 */
export const ASSETS_IGNORE_ENTRIES = Object.freeze([
  Object.freeze({
    file: RETENTION_LEDGER_FILENAME,
    reason: 'The asset-retention ledger: local build state, gitignored, never a page.',
  }),
  Object.freeze({
    file: BUILD_STAMP_FILENAME,
    reason: 'The frontend/src hash check-docs-fresh reads: build bookkeeping, never a page.',
  }),
  Object.freeze({
    file: '_worker.js',
    reason: "A Pages entry script; this file's presence turns wrangler's refusal of one off.",
  }),
]);

/**
 * The text of `docs/.assetsignore`. Refuses an entry that is not one literal
 * file name, because a pattern that is not anchored to one file can hide a
 * page along with the file it was meant for.
 */
export function assetsIgnoreText(entries = ASSETS_IGNORE_ENTRIES) {
  const lines = [
    '# Written by scripts/build-frontend.mjs from scripts/lib/assetsIgnore.mjs (D271).',
    '# Do not edit: rebuild. Files in docs/ the Worker asset upload must not publish;',
    '# each line names one file at the root of docs/. Wrangler already skips',
    '# /.assetsignore, /_redirects and /_headers.',
  ];
  for (const { file, reason } of entries) {
    if (typeof file !== 'string' || !LITERAL_NAME.test(file) || file === '.' || file === '..') {
      throw new Error(`assetsIgnore: '${file}' is not one literal file name at the root of docs/`);
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new Error(`assetsIgnore: '${file}' has no reason to stay private`);
    }
    lines.push('', `# ${reason.trim()}`, `/${file}`);
  }
  return `${lines.join('\n')}\n`;
}
