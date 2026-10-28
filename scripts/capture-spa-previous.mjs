#!/usr/bin/env node
/** Keep the restored previous entry's identity outside Vite's emptied docs/. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entriesFromLedger } from './lib/spaChunks.mjs';

try {
  const output = process.argv[2];
  if (!output) throw new Error('An output manifest path is required');
  const manifest = process.env.SMOKE_CACHE_RESTORED
    ? entriesFromLedger({
      ledger: JSON.parse(readFileSync('docs/.asset-retention.json', 'utf8')),
      generation: process.argv.includes('--previous-generation') ? 1 : 0,
      readAsset: file => readFileSync(join('docs/assets', file), 'utf8'),
    })
    : { entries: [], reason: 'cache-miss' };
  writeFileSync(output, JSON.stringify(manifest) + '\n');
  console.log(`[spa-live] Captured ${manifest.entries.length} previous entry chunk(s)${manifest.reason ? ` (${manifest.reason}; previous build cannot be verified)` : ''}.`);
} catch (error) {
  console.error('[spa-live] Cannot capture the restored previous build:', error.message);
  process.exitCode = 1;
}
