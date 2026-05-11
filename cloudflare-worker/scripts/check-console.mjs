#!/usr/bin/env node
/**
 * Epic 11 — fail the build if any `console.log(` call appears in
 * cloudflare-worker/src/. Production logs from `console.log` are noisy in
 * the Cloudflare dashboard and have leaked sensitive identifiers in past
 * incidents. `console.info`, `console.warn`, and `console.error` are
 * still allowed (those are what wrangler tail expects for structured
 * production output).
 *
 * Run via `npm run lint:no-console`. Wired into `npm run lint`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = new URL('../src/', import.meta.url).pathname;
const FORBIDDEN = /\bconsole\.log\s*\(/;

let bad = 0;
function walk(dir) {
  // CodeQL js/file-system-race: use a single readdir(withFileTypes) call so we
  // don't statSync() then readFileSync() the same path (TOCTOU). Wrap the
  // file read in try/catch so a concurrent rename/delete just skips the entry.
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { walk(p); continue; }
    if (!ent.isFile()) continue;
    if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
    let content;
    try { content = readFileSync(p, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Allow the marker in this enforcer's own description / comments.
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      if (FORBIDDEN.test(line)) {
        console.error(`${p}:${i + 1}: console.log is banned in worker prod source — use console.info / .warn / .error`);
        bad++;
      }
    });
  }
}

walk(SRC_ROOT);

if (bad > 0) {
  console.error(`\nFAIL — ${bad} console.log call(s) found. Replace with console.info / .warn / .error.`);
  process.exit(1);
}
console.log(`OK — no console.log in worker src/.`);
