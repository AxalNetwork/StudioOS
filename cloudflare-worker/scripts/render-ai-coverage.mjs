#!/usr/bin/env node
/**
 * D1478 (#3721): writes documentation/architecture/AI_MODEL_COVERAGE.md from
 * `renderCoverage()` (cloudflare-worker/src/services/ai/coverage.ts). Run after
 * a catalogue, matrix, route or module-model change; the coverage test fails
 * until the committed file matches.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     cloudflare-worker/scripts/render-ai-coverage.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderCoverage } from '../src/services/ai/coverage.ts';

const out = fileURLToPath(new URL('../../documentation/architecture/AI_MODEL_COVERAGE.md', import.meta.url));
writeFileSync(out, renderCoverage());
console.log(`wrote ${out}`);
