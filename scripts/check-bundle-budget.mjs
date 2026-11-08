#!/usr/bin/env node
/**
 * #4573 (Performance P1) — the frontend shell's size budget.
 *
 * Fails when what every first visit must fetch before the app runs (the entry
 * module, its modulepreloads, the stylesheets index.html links, and whatever
 * the entry imports statically) grows past its budget. Measured from the
 * built `docs/` by `scripts/perf/bundle-baseline.mjs`; brotli at quality 11 is
 * this script's own estimate of what an edge serves, comparable build to
 * build.
 *
 * THE BUDGETS ARE THE BASELINE PLUS A LITTLE ROOM, NOT A TARGET. Measured at
 * the baseline commit (documentation/audits/PERFORMANCE_BASELINE_2026-11-06.md):
 * 486.5 KiB brotli over 86 files, the entry chunk 851.2 KiB raw. A PR that
 * moves code into the shell on purpose raises the number here and says why in
 * its body; a PR that makes the shell lighter lowers it, so the gain is kept.
 *
 * IT NEVER BUILDS. Like check-docs-assets-closure.mjs it reads `docs/`, which
 * is build output and not committed (D529): run `npm run build` first.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS, analyse, stem } from './perf/bundle-baseline.mjs';

export const BUDGET = Object.freeze({
  /** The shell's critical path, brotli bytes. */
  criticalBrotli: 500 * 1024,
  /** The files on it. */
  criticalFiles: 95,
  /** The entry chunk alone, raw bytes (what the browser parses before anything renders). */
  entryRaw: 900 * 1024,
});

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

/** The ways a measured shell breaks the budget, as sentences; [] when it holds. */
export function overBudget(critical, budget = BUDGET) {
  const out = [];
  if (critical.size.brotli > budget.criticalBrotli) out.push(`the critical path is ${kib(critical.size.brotli)} brotli, over its ${kib(budget.criticalBrotli)} budget`);
  if (critical.files > budget.criticalFiles) out.push(`the critical path is ${critical.files} files, over its budget of ${budget.criticalFiles}`);
  const entry = critical.largest.find((f) => f.file === critical.entry);
  if (entry && entry.raw > budget.entryRaw) out.push(`the entry chunk is ${kib(entry.raw)} raw, over its ${kib(budget.entryRaw)} budget`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(DOCS, 'index.html'))) {
    console.error('✖ check-bundle-budget: docs/index.html is missing.\n  docs/ is build output and is not committed (D529) — run `npm run build` from the repo root.');
    process.exit(1);
  }
  const { critical } = analyse(DOCS, { full: false });
  const problems = overBudget(critical);
  if (problems.length) {
    console.error(`✖ check-bundle-budget:\n  - ${problems.join('\n  - ')}\n  heaviest on the path: ${critical.largest.slice(0, 5).map((f) => `${stem(f.file)} ${kib(f.brotli)}`).join(', ')}`);
    process.exit(1);
  }
  console.log(`✓ check-bundle-budget: the shell is ${critical.files} files, ${kib(critical.size.brotli)} brotli (budget ${kib(BUDGET.criticalBrotli)}).`);
}
