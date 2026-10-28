#!/usr/bin/env node
/** Keep build identities outside Vite's emptied docs/, without gating rollout. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entriesFromLedger, entryRefsFromHtml } from './lib/spaChunks.mjs';

const output = process.argv[2];
try {
  if (!output) throw new Error('An output manifest path is required');
  const manifest = process.env.SMOKE_CACHE_RESTORED
    ? entriesFromLedger({
      ledger: JSON.parse(readFileSync('docs/.asset-retention.json', 'utf8')),
      generation: process.argv.includes('--previous-generation') ? 1 : 0,
      readAsset: file => readFileSync(join('docs/assets', file), 'utf8'),
    })
    : { entries: [], reason: 'cache-miss' };
  if (!manifest.reason && !process.argv.includes('--previous-generation') && existsSync('docs/index.html')) {
    manifest.entries = [...new Set([...manifest.entries, ...entryRefsFromHtml(readFileSync('docs/index.html', 'utf8'))])];
  }
  writeFileSync(output, JSON.stringify(manifest) + '\n');
  console.log(`[spa-live] Captured ${manifest.entries.length} entry chunk(s)${manifest.reason ? ` (${manifest.reason}; previous build cannot be verified)` : ''}.`);
} catch {
  // Input failures belong to the post-deploy check, not the publication gate.
  // Do not print JSON parser excerpts or any cache-controlled content.
  console.error('[spa-live] Build input capture failed; the live smoke will report it.');
  try {
    if (!output) throw new Error('Missing output');
    writeFileSync(output, JSON.stringify({ entries: [], reason: 'capture-failed' }) + '\n');
  } catch { process.exitCode = 1; }
}
