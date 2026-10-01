/**
 * The set of hashed assets ONE build's `index.html` actually reaches.
 *
 * WHY THIS EXISTS. `planAssetRetention`'s no-ledger path seeds every asset
 * currently on disk as one synthetic prior build, and `.gitignore` names the
 * consequence in its own words: "with no ledger it seeds the committed
 * `docs/assets` as a synthetic prior build … the effective window on production
 * is one build, not three. That is the safe direction (it prunes less, never
 * more)."
 *
 * **"Prunes less, never more" is the whole defect.** CI and every fresh clone
 * have no ledger, so every build there treats the ENTIRE committed set as one
 * prior build worth keeping — and the committed set is therefore a high-water
 * mark that can only grow. Measured on `main`: 964 committed assets against a
 * clean build's 597.
 *
 * A generation is derivable from `docs/` alone without a ledger: it is the
 * transitive closure of `index.html` over the chunk graph, which is exactly
 * what `check-docs-assets-closure.mjs` already walks. Seeding THAT instead of
 * everything on disk keeps the property the retention window exists for — a
 * client still holding the previous shell can resolve every chunk that shell
 * asks for — and drops generations older than it, which no reachable shell can
 * ask for. The effective no-ledger window becomes two builds rather than
 * unbounded.
 */
import fs from 'node:fs';
import path from 'node:path';

import { referencesOf } from '../check-docs-assets-closure.mjs';

/** How the SPA shell names an asset: `/assets/…`, `assets/…` or `./assets/…`. */
const SHELL_REF = /["'`](?:\.?\/)?assets\/([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g;

/**
 * Every asset filename reachable from `indexHtml`, walking `availableFiles`.
 *
 * @param {object} opts
 * @param {string} opts.indexHtml        the build's index.html source
 * @param {string} opts.assetsDir        directory holding the asset files
 * @param {string[]} opts.availableFiles  asset filenames that exist there
 * @param {(f: string) => string} [opts.readFile] override for tests
 * @returns {{ reachable: string[], danglingFrom: string[] }}
 */
export function generationFrom({
  indexHtml = '',
  assetsDir = '',
  availableFiles = [],
  readFile = (f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'),
} = {}) {
  const have = new Set(availableFiles);
  const seen = new Set();
  const dangling = new Set();
  // THE SHELL'S OWN FORM IS A THIRD ONE, and reading it with `referencesOf`
  // alone returns nothing. `index.html` writes `src="/assets/index-<hash>.js"`
  // with a LEADING SLASH, and `referencesOf`'s bare pattern requires the quote
  // to sit directly before `assets/` — so the walk starts empty, expands
  // nowhere, and reports a generation of zero files. Measured exactly that on
  // the committed tree (601 on disk, 0 reachable) before this line existed,
  // which is the same shape of silent-empty-walk the closure guard's own
  // self-check was written for. The chunk-to-chunk forms still come from
  // `referencesOf`, so there is one extractor for the graph and one for the
  // shell's entry points.
  const queue = [...String(indexHtml).matchAll(SHELL_REF)].map((m) => m[1]);

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    if (!have.has(file)) { dangling.add(file); continue; }
    seen.add(file);
    let source = '';
    try { source = readFile(file); } catch { source = ''; }
    // Only JS carries further references; a CSS leaf ends the walk.
    if (!file.endsWith('.js')) continue;
    for (const ref of referencesOf(source)) if (!seen.has(ref)) queue.push(ref);
  }

  return { reachable: [...seen], danglingFrom: [...dangling] };
}
