#!/usr/bin/env node
/**
 * Task #31 — CI guard: no Anthropic in production.
 *
 * Scans `cloudflare-worker/src/**\/*.ts` for references to Anthropic
 * (anthropic.com, claude-*, ANTHROPIC_API_KEY, etc.) and fails CI when
 * a non-allow-listed file contains one. Allow-listed files are:
 *
 *   - `cloudflare-worker/src/routes/assistant.ts` — the dashboard
 *     personal assistant; mounted only when ENABLE_ANTHROPIC_DEV=1
 *     and STAGE !== 'production' (gate lives in `src/index.ts`).
 *   - `cloudflare-worker/src/types.ts` — the `Env` type keeps the
 *     ANTHROPIC_* fields for backward compatibility with operator
 *     scripts; the worker never reads them in prod paths.
 *   - `cloudflare-worker/src/index.ts` — mounts the assistant route
 *     behind the dev-flag middleware.
 *
 * Inline override: any file containing the marker comment
 *   //  @anthropic-dev-only
 * is also allow-listed (use sparingly; the file must be unreachable
 * from production code paths).
 *
 * Run via `npm run test:drift`. Standalone: `node scripts/ci/no-anthropic-in-prod.mjs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOT = join(ROOT, 'cloudflare-worker', 'src');

const ALLOW_LIST = new Set([
  'cloudflare-worker/src/routes/assistant.ts',
  'cloudflare-worker/src/types.ts',
  'cloudflare-worker/src/index.ts',
]);

const MARKER = '@anthropic-dev-only';

// Strict grep-parity contract per Task #31 acceptance criteria. We flag
// ANY occurrence of these tokens — comments included — so the
// production worker source contains no residual Anthropic references:
//   - anthropic.com   (URL / hostname / SDK domain)
//   - claude-<id>     (model identifier, anywhere)
//   - ANTHROPIC       (env var, type field, comment, …)
const PATTERN = /anthropic\.com|claude-[a-z0-9-]+|ANTHROPIC/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (s.isFile() && p.endsWith('.ts')) yield p;
  }
}

const violations = [];
for (const file of walk(SCAN_ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const raw = readFileSync(file, 'utf8');
  if (ALLOW_LIST.has(rel)) continue;
  if (raw.includes(MARKER)) continue;
  if (!PATTERN.test(raw)) continue;
  const hits = raw
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => PATTERN.test(line))
    .slice(0, 5);
  violations.push({ file: rel, hits });
}

if (violations.length > 0) {
  console.error('\nno-anthropic-in-prod: Anthropic reference found in non-allow-listed file(s):\n');
  for (const v of violations) {
    console.error(`  ${v.file}`);
    for (const [ln, line] of v.hits) {
      console.error(`    ${ln}: ${line.trim().slice(0, 160)}`);
    }
  }
  console.error('\nTask #31: production must use Workers AI only. Move dev-only code under');
  console.error('`scripts/eval/`, add the file to ALLOW_LIST in this script, or add the');
  console.error('`// @anthropic-dev-only` marker comment if the file is genuinely dev-only.\n');
  process.exit(1);
}

console.log(`no-anthropic-in-prod: OK (scanned ${SCAN_ROOT.replace(ROOT + '/', '')}, allow-list=${ALLOW_LIST.size})`);
