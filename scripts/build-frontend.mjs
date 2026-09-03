#!/usr/bin/env node
/**
 * Task #15 — SPA build wrapper with hashed-asset retention.
 *
 * Runs the Vite build and then restores a bounded window of PRIOR builds'
 * hashed `docs/assets/*` files. This keeps the deployed Worker able to serve
 * the previous builds' asset hashes during the window between a Worker deploy
 * and a client that still holds the previous `index.html` (an open tab, a
 * cached shell): without retention its old hashes 404 on the new Worker and
 * the page goes blank until a reload. The Cloudflare Pages mirror
 * (studioos-2p8.pages.dev, no production hostname) is built by this same
 * script and gets the same window. The original motive — GitHub Pages serving
 * the apex root `/` while `/assets/*` routed to the Worker (Task #15 carve) —
 * ended on 2026-09-01 (1d320dda9), when both hosts became Workers Custom
 * Domains served from the Worker's `[assets]` copy of `docs/`.
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
import { planAssetRetention } from './lib/assetRetention.mjs';

const RETAIN_BUILDS = Number(process.env.ASSET_RETAIN_BUILDS || 3);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const docsDir = path.join(root, 'docs');
const assetsDir = path.join(docsDir, 'assets');
const ledgerPath = path.join(docsDir, '.asset-retention.json');
const assetsIgnorePath = path.join(docsDir, '.assetsignore');

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

const plan = planAssetRetention({
  prevFiles,
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

// Wrangler's Worker Static Assets upload must not publish the Pages Advanced
// Mode entry point as a public asset. Vite empties docs/ on every build, so
// recreate this guard after all build output has been written.
fs.writeFileSync(assetsIgnorePath, '_worker.js\n');

console.log(
  `[build] done — ${newFiles.length} fresh asset(s); ${restored} prior hash(es) ` +
    `retained (window: ${RETAIN_BUILDS} build(s), ${plan.keep.length} total kept).`,
);
