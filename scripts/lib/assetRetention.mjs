/**
 * Task #15 — hashed-asset retention across SPA builds.
 *
 * Prod serves the SPA from `docs/` through the Cloudflare Worker's `[assets]`
 * binding on both `axal.vc` and `app.axal.vc` (whole-host Workers Custom
 * Domains since 2026-09-01, 1d320dda9; the Cloudflare Pages mirror of the
 * same `docs/` was retired on 2026-09-03). A fresh `vite build`
 * wipes `docs/` (`emptyOutDir`) and emits new content-hashed `assets/*`
 * filenames. Immediately after a Worker deploy, a client that still holds the
 * PREVIOUS build's `index.html` (an open tab, a cached shell) requests the
 * PREVIOUS hashes; the Worker would 404 them and the page goes blank until a
 * reload — unless the Worker still carries them. (Until 2026-09-01 the same
 * window existed between the Worker and GitHub Pages, which then served the
 * apex root `/`; that is where this module came from.)
 *
 * This module computes which prior hashes to keep so the deployed `docs/assets`
 * keeps the 72-hour window plus a minimum build floor, within a file cap.
 * It is a PURE function over
 * file-name lists (no filesystem access) so it can be unit-tested in isolation,
 * mirroring `scripts/lib/migrationPlan.mjs`.
 */

export const ASSET_RETENTION_HOURS = 72;
export const ASSET_MIN_BUILDS = 3;
// Below even the Free plan's 20,000 total files; leave room for shells/public files.
export const ASSET_MAX_FILES = 18_000;
export const STATIC_FILE_LIMIT = 20_000;

/**
 * Plan complete generations, newest first. `ts` is build time; `deployedAt`
 * is set ONLY after a successful deploy. Legacy ledgers get a one-time grace
 * (`firstSeenAt`), rather than inventing an unknown deployment timestamp.
 * A protected floor that exceeds the cap is returned intact with capExceeded;
 * the build wrapper refuses to deploy it rather than deleting current chunks.
 */
export function planAssetRetention({
  prevFiles = [], seedFiles = null, newFiles = [], ledgerBuilds = [],
  retainBuilds = ASSET_MIN_BUILDS, retentionHours = ASSET_RETENTION_HOURS,
  maxFiles = ASSET_MAX_FILES, now = new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error('Invalid asset file cap');
  if (!Number.isFinite(retentionHours) || retentionHours < 0) throw new Error('Invalid asset retention window');
  const uniq = arr => [...new Set(arr)];
  const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const builds = (Array.isArray(ledgerBuilds) ? ledgerBuilds : [])
    .filter(b => b && Array.isArray(b.files))
    .map(b => {
      const legacy = b.legacy === true || !Object.hasOwn(b, 'deployedAt')
        || (b.deployedAt !== null && !validTime(b.deployedAt));
      return { ts: String(b.ts ?? ''), files: uniq(b.files),
        deployedAt: validTime(b.deployedAt) ? b.deployedAt : null,
        ...(legacy ? { legacy: true, firstSeenAt: validTime(b.firstSeenAt) ? b.firstSeenAt : now } : {}) };
    })
    .filter(b => b.deployedAt !== null || b.legacy);
  const seed = Array.isArray(seedFiles) && seedFiles.length > 0 ? seedFiles : prevFiles;
  if (!builds.length && seed.length) {
    builds.push({ ts: 'pre-retention', files: uniq(seed), deployedAt: null, legacy: true, firstSeenAt: now });
  }
  // Sort recorded deployments by their real time, preserving ledger order on ties.
  const orderTime = b => Date.parse(b.deployedAt ?? b.ts) || 0;
  builds.sort((a, b) => orderTime(b) - orderTime(a));
  const freshFiles = uniq(newFiles);
  const newest = builds[0];
  const sameAsNewest = newest && newest.files.length === freshFiles.length
    && new Set([...newest.files, ...freshFiles]).size === freshFiles.length;
  if (sameAsNewest) builds.shift();
  builds.unshift(sameAsNewest
    ? { ...newest, ts: now, files: freshFiles }
    : { ts: now, deployedAt: null, files: freshFiles });

  const floor = Math.max(1, Math.floor(Number(retainBuilds) || 1));
  const protectedBuilds = new Set([0]);
  // Failed/local-only builds never displace actual deployments from the floor.
  for (let i = 1; i < builds.length && protectedBuilds.size < floor; i++) {
    if (builds[i].deployedAt !== null || builds[i].legacy) protectedBuilds.add(i);
  }
  const cutoff = Date.parse(now) - retentionHours * 3_600_000;
  const withinWindow = b => retentionHours > 0
    && Date.parse(b.deployedAt ?? (b.legacy ? b.firstSeenAt : b.ts)) >= cutoff;
  // A tab can open just before a long-lived build is superseded. Keep the
  // predecessor of every in-window deployment too: that next deploy is when
  // the predecessor stopped serving, even if it first shipped days earlier.
  const selected = new Set(builds.flatMap((b, i) => protectedBuilds.has(i)
    || withinWindow(b) || (i > 0 && withinWindow(builds[i - 1])) ? [i] : []));
  const expiredBuilds = builds.length - selected.size;
  const refs = new Map();
  const add = files => { for (const f of files) refs.set(f, (refs.get(f) ?? 0) + 1); };
  // D252: a known previous shell remains protected even with a stale ledger.
  const explicitSeed = Array.isArray(seedFiles) ? uniq(seedFiles) : [];
  add(explicitSeed);
  for (const i of selected) add(builds[i].files);
  const removable = [...selected].filter(i => !protectedBuilds.has(i))
    .sort((a, b) => orderTime(builds[a]) - orderTime(builds[b]) || b - a);
  let capPrunedBuilds = 0;
  for (const i of removable) {
    if (refs.size <= maxFiles) break;
    selected.delete(i);
    capPrunedBuilds++;
    for (const f of builds[i].files) {
      const count = refs.get(f) - 1;
      if (count) refs.set(f, count); else refs.delete(f);
    }
  }
  const trimmed = builds.filter((_, i) => selected.has(i));
  const keep = uniq([...trimmed.flatMap(b => b.files), ...explicitSeed]);
  const newSet = new Set(newFiles), prevSet = new Set(prevFiles);
  return {
    nextLedger: { version: 2, builds: trimmed }, keep,
    restore: keep.filter(f => !newSet.has(f) && prevSet.has(f)),
    missing: keep.filter(f => !newSet.has(f) && !prevSet.has(f)),
    capExceeded: keep.length > maxFiles, capPrunedBuilds, expiredBuilds,
  };
}

/**
 * The deploy workflow stamps `deployedAt` from this instant on (#3591). The
 * one deploy that shipped before the stamp existed (run 2031, 2026-10-28)
 * saved an unstamped entry; every deploy after it refused to build.
 */
export const DEPLOY_STAMP_SINCE = '2026-10-29T00:00:00.000Z';

/**
 * A restored cache is saved only after a deploy succeeds, so an unstamped
 * entry built before DEPLOY_STAMP_SINCE did ship; its deploy time is unknown.
 * It becomes legacy (the one-time grace, D1364) rather than inventing a time.
 * Entries built after it are left alone, so the build guard still catches a
 * missing stamp.
 */
export function adoptUnstampedDeployments(builds, since = DEPLOY_STAMP_SINCE) {
  const before = Date.parse(since);
  let adopted = 0;
  const out = (Array.isArray(builds) ? builds : []).map((b) => {
    if (b?.deployedAt !== null || b.legacy === true || !(Date.parse(b.ts) < before)) return b;
    adopted++;
    const kept = { ...b, legacy: true };
    delete kept.firstSeenAt;
    return kept;
  });
  return { builds: out, adopted };
}

/** Mark only what actually shipped, after the deploy command succeeded. */
export function recordAssetDeployment(ledger, now = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(now)) || !Array.isArray(ledger?.builds)
      || !ledger.builds.length || !Array.isArray(ledger.builds[0]?.files)) {
    throw new Error('Cannot record asset deployment without a valid build ledger');
  }
  return { ...ledger, version: 2, builds: ledger.builds.map((b, i) => i === 0
    ? { ...b, deployedAt: now } : b) };
}

/**
 * The flag the production deploy passes to seed EVERYTHING it restored into
 * `docs/assets` rather than the previous generation (task 351, D252; renamed
 * from `--seed-committed-tree` by D529).
 *
 * `docs/` is no longer committed (D529). The deploy starts from an empty
 * `docs/`, restores the last deploy's `docs/assets` and retention ledger from
 * its `actions/cache` entry, and builds over them. What it restored is what
 * production is serving now, so with no ledger to say which build each file
 * came from, all of it is seeded as one prior build. With a ledger (the normal
 * case) the timestamped ledger decides the window and the minimum build floor.
 *
 * It is a flag the workflow passes, never `CI`: every CI job and the PR
 * preview set `CI`, and none of them uploads to production.
 */
export const SEED_RESTORED_TREE_FLAG = '--seed-restored-tree';

/**
 * @param {object} opts
 * @param {string[]} opts.argv            the build script's arguments
 * @param {string[]} opts.prevGeneration  the previous generation's assets
 * @returns {string[] | null} the seed; null means "fall back to prevFiles"
 */
export function seedFilesFor({ argv = [], prevGeneration = [] } = {}) {
  return argv.includes(SEED_RESTORED_TREE_FLAG) ? null : prevGeneration;
}

/**
 * Whether this build has anything to carry the old-bundle window forward from
 * (D529), and the line the build log prints either way.
 *
 * `docs/` is not committed, so a build starts from whatever the job put there:
 * the production deploy restores the last deploy's assets and ledger from its
 * cache; every other job starts empty. An empty start is not an error — a
 * first deploy, or a cache entry GitHub evicted, must still ship — but on the
 * deploy it means a tab opened before this deploy can 404 its chunks until a
 * reload, so the log says so in words a reader can find: "retention
 * restarted".
 *
 * @param {object} opts
 * @param {string[]} opts.prevFiles     asset files on disk before the build
 * @param {Array<{files:string[]}>} opts.ledgerBuilds  the ledger found on disk
 * @returns {{ restarted: boolean, line: string }}
 */
export function retentionStart({ prevFiles = [], ledgerBuilds = [] } = {}) {
  const files = Array.isArray(prevFiles) ? prevFiles.length : 0;
  const builds = Array.isArray(ledgerBuilds)
    ? ledgerBuilds.filter((b) => b && Array.isArray(b.files)).length
    : 0;
  if (files === 0) {
    return {
      restarted: true,
      line: '[build] retention restarted: no previous build in docs/ to carry forward '
        + '(first build, or the saved one was not restored), so the window holds this build only.',
    };
  }
  return {
    restarted: false,
    line: builds > 0
      ? `[build] retention continues: ${files} asset(s) on disk from ${builds} previous build(s) in the ledger.`
      : `[build] retention continues: ${files} asset(s) on disk, no ledger; they are seeded as one previous build.`,
  };
}
