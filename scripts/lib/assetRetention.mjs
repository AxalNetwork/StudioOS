/**
 * Task #15 — hashed-asset retention across SPA builds.
 *
 * Prod serves the SPA from `docs/` through TWO authorities: the Cloudflare
 * Worker (app routes + now `/assets/*` on the apex) and GitHub Pages (the apex
 * root `/`). A fresh `vite build` wipes `docs/` (`emptyOutDir`) and emits new
 * content-hashed `assets/*` filenames. Immediately after `npm run deploy` the
 * Worker carries the NEW build while GitHub Pages still serves the PREVIOUS
 * build's `index.html`, which references the PREVIOUS hashes. With `/assets/*`
 * now routed to the Worker, the apex root would 404 those old hashes and go
 * blank until Pages catches up — unless the Worker still carries them.
 *
 * This module computes which prior hashes to keep so the deployed `docs/assets`
 * is the UNION of the last `retainBuilds` builds. It is a PURE function over
 * file-name lists (no filesystem access) so it can be unit-tested in isolation,
 * mirroring `scripts/lib/migrationPlan.mjs`.
 */

/**
 * @param {object} opts
 * @param {string[]} opts.prevFiles   asset filenames present BEFORE the build (backed up)
 * @param {string[]} opts.newFiles    asset filenames the fresh build produced
 * @param {Array<{ts:string,files:string[]}>} [opts.ledgerBuilds] prior ledger, newest-first
 * @param {number} [opts.retainBuilds] how many builds' assets to keep (default 3)
 * @param {string} [opts.now]         ISO timestamp for the new build entry
 * @returns {{
 *   nextLedger: { builds: Array<{ts:string,files:string[]}> },
 *   keep: string[],
 *   restore: string[],
 *   missing: string[],
 * }}
 */
export function planAssetRetention({
  prevFiles = [],
  newFiles = [],
  ledgerBuilds = [],
  retainBuilds = 3,
  now = new Date().toISOString(),
} = {}) {
  const uniq = (arr) => [...new Set(arr)];
  const builds = Array.isArray(ledgerBuilds)
    ? ledgerBuilds
        .filter((b) => b && Array.isArray(b.files))
        .map((b) => ({ ts: String(b.ts ?? ''), files: uniq(b.files) }))
    : [];

  // First run with this system (no ledger yet): seed the currently-deployed
  // assets as a synthetic prior build so they are not dropped on the first
  // retention build — otherwise the live apex root would break immediately.
  if (builds.length === 0 && prevFiles.length > 0) {
    builds.push({ ts: 'pre-retention', files: uniq(prevFiles) });
  }

  builds.unshift({ ts: now, files: uniq(newFiles) });

  const window = Math.max(1, Number(retainBuilds) || 1);
  const trimmed = builds.slice(0, window);

  const keep = new Set();
  for (const b of trimmed) for (const f of b.files) keep.add(f);

  const newSet = new Set(newFiles);
  const prevSet = new Set(prevFiles);

  // Files to copy back from the backup: kept, not freshly built, and available.
  const restore = [...keep].filter((f) => !newSet.has(f) && prevSet.has(f));
  // Kept but neither freshly built nor on disk to restore (aged past history).
  const missing = [...keep].filter((f) => !newSet.has(f) && !prevSet.has(f));

  return { nextLedger: { builds: trimmed }, keep: [...keep], restore, missing };
}
