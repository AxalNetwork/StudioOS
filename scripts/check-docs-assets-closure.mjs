#!/usr/bin/env node
/**
 * Fails the build when a chunk under `docs/assets/` references a chunk that is
 * not there — a dangling edge in the built module graph.
 *
 * WHY THIS EXISTS, and the gap is measured rather than imagined.
 * `scripts/check-spa-live.mjs` is the only thing that looks at built assets at
 * all, and it CANNOT see this class, for two independent reasons:
 *
 *   1. Its route list is HARDCODED — about seven shells, and not one of them
 *      is a Zone route. Every `*Zone` chunk is reached by dynamic import at
 *      click time and is named in no shell HTML, so the smoke never asks for
 *      one.
 *   2. `fetchAssetMeta` CANCELS the response body, deliberately, to avoid
 *      pulling 500KB bundles. So even for the assets it does check, it cannot
 *      follow a single chunk -> chunk edge.
 *
 * It therefore verifies `index.html`'s own references one level deep and
 * stops, and would report all-PASS on a deploy where every advisor Zone chunk
 * 404s. `frontend/src/main.jsx` already names that failure: "a route chunk
 * that 404s when the user clicks — the ordinary case after a deploy."
 *
 * WHAT IT PROTECTS. `docs/assets/` is not a flat build output. The build wipes
 * it (`frontend/vite.config.js` sets `emptyOutDir: true`) and then
 * `scripts/build-frontend.mjs` RESTORES a bounded window of prior builds'
 * hashed files, because a client still holding the previous `index.html` — an
 * open tab, a cached shell — asks for the previous hashes right after a deploy
 * and would otherwise get a 404 and a blank page. Those retained files are
 * whole generations, each chunk linked to its own generation's siblings. So a
 * "dedupe by basename, keep the newest" tidy-up does not remove duplicates; it
 * severs generations and MANUFACTURES exactly the dangling edge this checks
 * for. This check is what makes any future change to that window safe.
 *
 * IT NEVER BUILDS AND NEVER WRITES. It reads `docs/assets/` and nothing else.
 * `check-frontend-builds.mjs` already records the reason: "a check that
 * rewrote 602 tracked files as a side effect of checking would be worse than
 * the bug it catches." Here it is sharper still — the build wipes `docs/` and
 * restores the window, so a check that built would rewrite every tracked file
 * under it in order to look at them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'docs', 'assets');
const INDEX = path.join(ROOT, 'docs', 'index.html');

// THIS BUNDLER EMITS TWO REFERENCE FORMS AND BOTH ARE LOAD-BEARING.
// Measured on the current tree: 55 chunks use the bare `assets/…` form and
// 1239 use the `./…` form, and the ENTRY chunk is overwhelmingly the first
// (497 against 17). So an extractor that handles only `./` starts at an entry
// it cannot read, the walk never expands, and it reports a clean result after
// scanning a handful of files. That is not a hypothetical: it is the mistake
// that produced "18 chunks reachable, 0 dangling" on a 1276-chunk tree and
// read as a pass. `assertBothFormsSeen` below exists for exactly that, and the
// guard's own mutation test narrows this pair to prove it fires.
//
// BACKTICKS COUNT. Rollup emits a lazy chunk import as
// ``import(`./purify.es-<hash>.js`)`` — a template literal, not a quoted
// string — and a class of `["']` alone reads straight past it. Measured on the
// committed tree: `purify.es-JEAr64Sr.js` was the one file of 601 that no walk
// could reach, for exactly that reason, and a chunk this guard cannot see is a
// chunk it cannot report as dangling.
const BARE_REF = /["'`](?:\.\.\/)?assets\/([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g;
const DOT_REF = /["'`]\.\/([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g;

/** Every reference a chunk makes, with a tally per form for the self-check. */
export function referencesOf(source, tally = { bare: 0, dot: 0 }) {
  const out = new Set();
  for (const m of source.matchAll(BARE_REF)) { out.add(m[1]); tally.bare += 1; }
  for (const m of source.matchAll(DOT_REF)) { out.add(m[1]); tally.dot += 1; }
  return out;
}

/**
 * The self-check. Both forms must appear somewhere in a non-trivial corpus,
 * because both are in the output. A zero on either side means the extractor
 * stopped seeing a whole shape of edge, and a scanner that reads a fraction of
 * the graph and says PASS is worse than no scanner at all.
 */
export function assertBothFormsSeen(tally, fileCount) {
  if (fileCount < 2) return null;
  if (tally.bare === 0) {
    return 'no `assets/…` references were found — the extractor is not seeing the form the entry chunk uses';
  }
  if (tally.dot === 0) {
    return 'no `./…` references were found — the extractor is not seeing the form most chunks use';
  }
  return null;
}

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(ASSETS)) {
    fail([
      '✖ check-docs-assets-closure: docs/assets/ does not exist.',
      '  docs/ is a committed build artifact — run `npm run build` from the repo root.',
    ]);
  }

  const names = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
  const present = new Set(names);
  const scannable = names.filter((f) => f.endsWith('.js'));

  const tally = { bare: 0, dot: 0 };
  const dangling = [];
  let edges = 0;

  // The shell is a seed: a broken entry reference is the same defect one level up.
  if (fs.existsSync(INDEX)) {
    for (const ref of referencesOf(fs.readFileSync(INDEX, 'utf8'), tally)) {
      edges += 1;
      if (!present.has(ref)) dangling.push({ from: 'docs/index.html', to: ref });
    }
  }

  for (const file of scannable) {
    const refs = referencesOf(fs.readFileSync(path.join(ASSETS, file), 'utf8'), tally);
    for (const ref of refs) {
      edges += 1;
      if (!present.has(ref)) dangling.push({ from: file, to: ref });
    }
  }

  // THE CEILING. A clean bundler run emits ~600 assets; the retention window
  // keeps at most `ASSET_RETAIN_BUILDS` (3) generations, so a healthy committed
  // tree sits well under three times that. Past it, something is accumulating
  // rather than rotating — which is exactly what the no-ledger seed used to do
  // (D183): CI has no ledger, so every deploy re-seeded the whole committed
  // tree as one prior build and the set could only grow. Measured on `main`
  // before that fix: 964 against a clean build's 597.
  //
  // This is a CEILING, not a target. It is set high enough that three full
  // generations pass and low enough that unbounded growth is caught long before
  // anyone notices it in a diff.
  const ASSET_CEILING = Number(process.env.DOCS_ASSET_CEILING || 1800);
  if (names.length > ASSET_CEILING) {
    fail([
      `✖ check-docs-assets-closure: docs/assets holds ${names.length} files, past the `
        + `${ASSET_CEILING} ceiling.`,
      '  A clean build emits ~600 and retention keeps at most three generations, so this is',
      '  accumulation rather than rotation. Check that scripts/build-frontend.mjs is seeding',
      '  the PREVIOUS GENERATION (the closure of the committed shells) and not every file on',
      '  disk — see scripts/lib/assetGeneration.mjs and D183. Rebuild from the repo root with',
      '  `npm run build`; running the bundler directly skips retention entirely.',
    ]);
  }

  const selfCheck = assertBothFormsSeen(tally, scannable.length);
  if (selfCheck) {
    fail([
      `✖ check-docs-assets-closure: ${selfCheck}.`,
      `  Scanned ${scannable.length} chunks and found ${tally.bare} bare and ${tally.dot} dot references.`,
      '  This check refuses to report a pass it cannot stand behind.',
    ]);
  }

  if (dangling.length) {
    const shown = dangling.slice(0, 25);
    fail([
      `✖ check-docs-assets-closure: ${dangling.length} reference(s) point at a file that is not in docs/assets/.`,
      '',
      ...shown.map(({ from, to }) => `    ${from}  ->  ${to}   (missing)`),
      ...(dangling.length > shown.length ? [`    … and ${dangling.length - shown.length} more`] : []),
      '',
      '  A chunk that references a missing chunk is a route that breaks the moment',
      '  a user clicks it. If this followed a prune of docs/assets/, the prune cut',
      '  across generations — retention keeps whole builds, so remove whole builds.',
      '  Rebuild from the repo root with `npm run build`.',
    ]);
  }

  console.log(
    `✓ check-docs-assets-closure: ${edges} references across ${scannable.length} chunks all resolve `
    + `(${present.size} files on disk).`,
  );
}

// Only scan when RUN, never when imported. The scan calls `process.exit(1)`
// on a finding, so a bare module body would kill any test process that
// imported the helpers above the moment the built graph went bad — which is
// the one time the tests most need to run. Same shape as
// `check-unused-imports.mjs`, and its own suite pins this line.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
