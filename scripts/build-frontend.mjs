#!/usr/bin/env node
/**
 * Task #15 — SPA build wrapper with hashed-asset retention.
 *
 * Runs the Vite build and then restores a bounded window of PRIOR builds'
 * hashed `docs/assets/*` files. This keeps the deployed Worker able to serve
 * the previous builds' asset hashes during the window between a Worker deploy
 * and a client that still holds the previous `index.html` (an open tab, a
 * cached shell): without retention its old hashes 404 on the new Worker and
 * the page goes blank until a reload. The original motive — GitHub Pages
 * serving the apex root `/` while `/assets/*` routed to the Worker (Task #15
 * carve) — ended on 2026-09-01 (1d320dda9), when both hosts became Workers
 * Custom Domains served from the Worker's `[assets]` copy of `docs/`. The
 * Cloudflare Pages mirror this script also built until 2026-09-03 is retired
 * (documentation/architecture/DECISIONS.md D36): `docs/` has one consumer,
 * the Worker deploy.
 *
 * The pure planning logic lives in `scripts/lib/assetRetention.mjs` and is
 * unit-tested (`scripts/lib/assetRetention.test.mjs`). This file is only the
 * filesystem orchestration around it.
 *
 * Policy: 72 hours, a three-build floor including this candidate, and 18,000 asset files.
 * ASSET_RETAIN_BUILDS can raise the floor, never lower it below three.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generationFrom } from './lib/assetGeneration.mjs';
import {
  ASSETS_IGNORE_FILENAME,
  BUILD_STAMP_FILENAME,
  RETENTION_LEDGER_FILENAME,
  assetsIgnoreText,
} from './lib/assetsIgnore.mjs';
import { planAssetRetention, retentionStart, seedFilesFor, SEED_RESTORED_TREE_FLAG, ASSET_MIN_BUILDS, ASSET_RETENTION_HOURS, ASSET_MAX_FILES, STATIC_FILE_LIMIT } from './lib/assetRetention.mjs';
import { sourceTreeHash } from './lib/sourceTreeHash.mjs';

const RETAIN_BUILDS = Math.max(ASSET_MIN_BUILDS, Math.floor(Number(process.env.ASSET_RETAIN_BUILDS) || ASSET_MIN_BUILDS));

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const docsDir = path.join(root, 'docs');
const assetsDir = path.join(docsDir, 'assets');
// Every file this script writes into docs/ is named through lib/assetsIgnore.mjs,
// because anything written there is published by the Worker's asset upload
// unless it is listed in docs/.assetsignore (D271).
const ledgerPath = path.join(docsDir, RETENTION_LEDGER_FILENAME);
const ignorePath = path.join(docsDir, ASSETS_IGNORE_FILENAME);
const stampPath = path.join(docsDir, BUILD_STAMP_FILENAME);

function listAssetFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => {
        try {
          return fs.statSync(path.join(dir, f)).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function readLedgerBuilds(p) {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed?.builds) ? parsed.builds : [];
  } catch {
    return [];
  }
}

// 1. Snapshot the pre-build assets — they must survive Vite's emptyOutDir wipe.
const prevFiles = listAssetFiles(assetsDir);
const ledgerBuilds = readLedgerBuilds(ledgerPath);
// A deployment cache is saved only after shipping. An unstamped v2 record there
// means the post-deploy clock did not run; abort BEFORE Vite can discard it.
// Legacy entries retain their explicit one-time grace without inventing a time.
if (process.argv.includes(SEED_RESTORED_TREE_FLAG)
    && ledgerBuilds.some(b => b?.deployedAt === null && b.legacy !== true)) {
  throw new Error('[build] restored deployment ledger is unstamped; refusing to discard live history. Check the successful-deploy timestamp hook.');
}
// D529: docs/ is not committed, so what is on disk here is whatever the job
// restored (the production deploy) or nothing (every other job). Say which.
console.log(retentionStart({ prevFiles, ledgerBuilds }).line);

// …and the shell that references them, because it is what says which of those
// assets belong to the PREVIOUS generation rather than to one long dead. A
// local rebuild over a previous local build takes this path when its ledger is
// gone; seeding the whole tree there is what once made `docs/assets` grow
// monotonically. See lib/assetGeneration.mjs. (The production deploy restores
// assets and ledger but no shells, D529, so its seed comes from the flag.)
//
// EVERY shell, not just `docs/index.html`. The build prerenders ~34 route
// shells, and a route-specific one can name a chunk the root never does; a
// seed taken from `index.html` alone would drop those from the window and a
// client holding that route's shell would 404 them. The union of all of them
// is still a bounded generation.
function prevShellSources(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'assets') out.push(...prevShellSources(p));
    } else if (e.name.endsWith('.html')) {
      try { out.push(fs.readFileSync(p, 'utf8')); } catch { /* unreadable shell */ }
    }
  }
  return out;
}

const prevGenerationSet = new Set();
for (const html of prevShellSources(docsDir)) {
  const { reachable } = generationFrom({ indexHtml: html, assetsDir, availableFiles: prevFiles });
  for (const f of reachable) prevGenerationSet.add(f);
}
// No previous shell to read (a first build, or a docs/ without one) leaves this
// empty, and the seed falls back to prevFiles — what it always was.
const prevGeneration = [...prevGenerationSet];
if (prevFiles.length > 0) {
  console.log(
    `[build] previous generation: ${prevGeneration.length} of ${prevFiles.length} `
    + 'asset(s) reachable from a shell on disk',
  );
}
const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axal-assets-'));
const backupDocs = path.join(backupRoot, 'docs');
const backupDir = path.join(backupDocs, 'assets');
const hadDocs = fs.existsSync(docsDir);
if (hadDocs) fs.cpSync(docsDir, backupDocs, { recursive: true });

try {
  // 2. Build the SPA (Vite empties docs/ and writes the fresh, re-hashed build).
  console.log('[build] running vite build (docs/ will be regenerated) …');
  execSync('npm run build', {
    cwd: path.join(root, 'frontend'),
    stdio: 'inherit',
  });

  // 3. Plan retention over the fresh output and restore the hashes to keep.
  const newFiles = listAssetFiles(assetsDir);
  if (newFiles.length === 0) {
    console.error('[build] no assets produced by the build — aborting without touching retention.');
    throw new Error('[build] fresh assets are required');
  }

  // The production deploy passes SEED_RESTORED_TREE_FLAG (D252, D529): there the
  // seed is every asset it restored from the last deploy, because that is what
  // production is serving.
  const seedFiles = seedFilesFor({ argv: process.argv.slice(2), prevGeneration });
  if (seedFiles === null) {
    console.log(`[build] ${SEED_RESTORED_TREE_FLAG}: seeding all ${prevFiles.length} restored asset(s)`);
  }

  const plan = planAssetRetention({
    prevFiles,
    seedFiles,
    newFiles,
    ledgerBuilds,
    retainBuilds: RETAIN_BUILDS,
  });

  if (plan.capExceeded) {
    throw new Error(`[build] protected asset generations exceed the ${ASSET_MAX_FILES}-file cap; refusing deployment`);
  }
  if (plan.capPrunedBuilds) {
    console.warn(`[build] asset cap pruned ${plan.capPrunedBuilds} oldest complete build(s); the 72-hour window is shortened`);
  }
  let restored = 0;
  for (const f of plan.restore) {
    const src = path.join(backupDir, f);
    const dst = path.join(assetsDir, f);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      restored++;
    }
  }

  if (plan.missing.length > 0) {
    const sample = plan.missing.slice(0, 5).join(', ');
    console.warn(
      `[build] ${plan.missing.length} retained asset(s) are no longer on disk to ` +
        `restore (aged past the local history): ${sample}${plan.missing.length > 5 ? ' …' : ''}`,
    );
  }

  // 4. Persist the ledger; keep the snapshot until all build steps succeed.
  fs.writeFileSync(ledgerPath, `${JSON.stringify(plan.nextLedger, null, 2)}\n`);

  // 5. Bake per-route Open Graph metadata into the build.
  //
  // This MUST run after vite, because vite empties docs/ — anything written
  // before this point is deleted. Without it every route ships the same shell
  // `<head>`, so every shared link previews identically on WhatsApp, iMessage,
  // LinkedIn and Slack (crawlers do not execute the client-side usePageMeta).
  console.log('[build] prerendering per-route Open Graph metadata …');
  execSync('node scripts/prerender-og.mjs', { cwd: root, stdio: 'inherit' });

  // 6. Keep this script's own bookkeeping out of the Worker's asset upload (D271).
  //
  // Wrangler uploads every file under docs/, dotfiles included, unless
  // docs/.assetsignore names it, and it hides only /.assetsignore, /_redirects
  // and /_headers on its own. So until this step the retention ledger written in
  // step 4 and the stamp written in step 7 were served at /.asset-retention.json
  // and /.build-source on both hosts. The list, and the reason each file stays
  // private, live in lib/assetsIgnore.mjs.
  //
  // AFTER VITE, because Vite empties docs/ and anything written earlier is gone;
  // after the prerender for the same reason one step later. It names the stamp
  // before the stamp exists, which is fine: the file is read at upload time.
  //
  // `_headers` is deliberately NOT listed: wrangler already skips it and reads it
  // by its own path to set the static security headers (see lib/assetsIgnore.mjs).
  fs.writeFileSync(ignorePath, assetsIgnoreText());

  // D1361: reserve space for all non-asset output, including prerendered shells.
  function fileCount(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n
      + (e.isDirectory() ? fileCount(path.join(dir, e.name)) : e.isFile() ? 1 : 0), 0);
  }
  if (fileCount(docsDir) + 1 > STATIC_FILE_LIMIT) {
    throw new Error(`[build] static output exceeds the ${STATIC_FILE_LIMIT}-file safety limit; refusing deployment`);
  }

  // 7. Stamp docs/ with the source this build consumed — LAST, so a stamp only
  //    ever describes a build that finished.
  //
  // It records which frontend/src a docs/ was built from, so a build found on
  // disk can be traced to its source. It was the input to check-docs-fresh,
  // retired with the committed docs/ by D529; docs/.assetsignore keeps it off
  // both hosts (D271).
  fs.writeFileSync(stampPath, `${sourceTreeHash(path.join(root, 'frontend', 'src'))}\n`);

  console.log(
    `[build] done — ${newFiles.length} fresh asset(s); ${restored} prior hash(es) ` +
      `retained (window: ${ASSET_RETENTION_HOURS} hours, floor ${RETAIN_BUILDS} builds, ${plan.keep.length}/${ASSET_MAX_FILES} assets kept).`,
  );

} catch (error) {
  // A failed build never reached the deploy. Keep the last known output and
  // its real deployment ledger intact, so a retry cannot forget live hashes.
  fs.rmSync(docsDir, { recursive: true, force: true });
  if (hadDocs) fs.cpSync(backupDocs, docsDir, { recursive: true });
  throw error;
} finally {
  fs.rmSync(backupRoot, { recursive: true, force: true });
}
