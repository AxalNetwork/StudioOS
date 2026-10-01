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
 * Tunable: ASSET_RETAIN_BUILDS (default 3).
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
import { planAssetRetention, seedFilesFor, SEED_COMMITTED_TREE_FLAG } from './lib/assetRetention.mjs';
import { sourceTreeHash } from './lib/sourceTreeHash.mjs';

const RETAIN_BUILDS = Number(process.env.ASSET_RETAIN_BUILDS || 3);

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

// …and the shell that references them, because it is what says which of those
// assets belong to the PREVIOUS generation rather than to one long dead. The
// ledger is gitignored, so CI and every fresh clone take the no-ledger path on
// every run; seeding the whole committed tree there is what made `docs/assets`
// grow monotonically. See lib/assetGeneration.mjs.
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
    + 'asset(s) reachable from a committed shell',
  );
}
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axal-assets-'));
for (const f of prevFiles) {
  fs.copyFileSync(path.join(assetsDir, f), path.join(backupDir, f));
}

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
  fs.rmSync(backupDir, { recursive: true, force: true });
  process.exit(1);
}

// The production deploy passes SEED_COMMITTED_TREE_FLAG (D252): there the seed
// is every committed asset, because the generation production serves is the
// last deploy's, not necessarily the committed shells'.
const seedFiles = seedFilesFor({ argv: process.argv.slice(2), prevGeneration });
if (seedFiles === null) {
  console.log(`[build] ${SEED_COMMITTED_TREE_FLAG}: seeding all ${prevFiles.length} committed asset(s)`);
}

const plan = planAssetRetention({
  prevFiles,
  seedFiles,
  newFiles,
  ledgerBuilds,
  retainBuilds: RETAIN_BUILDS,
});

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

// 4. Persist the ledger and clean up the backup.
fs.writeFileSync(ledgerPath, `${JSON.stringify(plan.nextLedger, null, 2)}\n`);
fs.rmSync(backupDir, { recursive: true, force: true });

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

// 7. Stamp docs/ with the source this build consumed — LAST, so a stamp only
//    ever describes a build that finished.
//
// WHY A SEPARATE FILE RATHER THAN A KEY IN THE RETENTION LEDGER. The obvious
// home is `docs/.asset-retention.json`, which is already written on every
// build — but it is **gitignored** on purpose (see `.gitignore`: 45 KB that
// churns wholesale), so CI never sees it and a stamp inside it would answer
// nobody. This file is one line and changes only when the source does.
//
// WHAT IT IS FOR. `scripts/check-docs-fresh.mjs` asks whether the committed
// docs/ is the build of the current frontend/src. Until now it could only ask
// which commit was newer, and that proxy is wrong in both directions: commit
// docs/ without rebuilding and it says fresh forever, while a comment-only or
// type-only source edit emits a BYTE-IDENTICAL bundle — the minifier strips
// comments, tsc erases types — leaving nothing to `git add` and a gate its own
// printed fix could not satisfy, because `git commit` on an empty change
// refuses. #207's PR is where that surfaced (D103).
//
// It is a hash, so it is also the thing that gives that no-op build a diff to
// commit; the gate below it stays satisfiable either way.
fs.writeFileSync(stampPath, `${sourceTreeHash(path.join(root, 'frontend', 'src'))}\n`);

console.log(
  `[build] done — ${newFiles.length} fresh asset(s); ${restored} prior hash(es) ` +
    `retained (window: ${RETAIN_BUILDS} build(s), ${plan.keep.length} total kept).`,
);
