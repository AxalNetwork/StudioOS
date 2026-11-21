#!/usr/bin/env node
/**
 * #7147 step 5 — write the staging (`[env.preview]`) resource ids that runbook
 * steps 1 and 2 printed into `wrangler.toml`, for a reviewed PR
 * (documentation/operations/STAGING.md, D7147-p3; rules in
 * `scripts/lib/stagingIds.mjs`).
 *
 *   node scripts/staging-write-ids.mjs --d1 <uuid> --kv-tokens <id> \
 *     --kv-rate-limits <id> --kv-oauth <id> [--workers-subdomain <sub>] [--dry-run]
 *
 * Refuses (exit 1, nothing written) a malformed id, a repeated KV id, an id
 * production uses, or a result the static isolation preflight rejects.
 * Calls no Cloudflare API and holds no credential.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePreviewIds } from './lib/stagingIds.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = resolve(ROOT, 'wrangler.toml');

try {
  const src = readFileSync(file, 'utf8');
  const { src: next, changed } = writePreviewIds(src, {
    d1: value('--d1'),
    tokens: value('--kv-tokens'),
    rateLimits: value('--kv-rate-limits'),
    oauth: value('--kv-oauth'),
    subdomain: value('--workers-subdomain') ?? null,
  });
  if (!changed) console.log('✓ staging-write-ids: [env.preview] already holds these ids; nothing to change.');
  else if (args.includes('--dry-run')) console.log('✓ staging-write-ids: the ids are valid and the result passes the isolation preflight (dry run, nothing written).');
  else {
    writeFileSync(file, next);
    console.log('✓ staging-write-ids: wrote the four [env.preview] ids. Run `node scripts/check-preview-isolation.mjs --static` and open the step-5 PR.');
  }
} catch (e) {
  console.error(`✗ staging-write-ids: ${e.message}. Nothing was written.`);
  process.exit(1);
}
