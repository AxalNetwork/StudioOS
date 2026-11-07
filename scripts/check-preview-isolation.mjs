#!/usr/bin/env node
/**
 * #4566 — the preview isolation preflight (rules: `scripts/lib/previewIsolation.mjs`).
 *
 *   node scripts/check-preview-isolation.mjs --static
 *       CI (test:guards): wrangler.toml alone. Fails when preview DECLARES a
 *       production identity, an unknown binding kind, or production's agent
 *       switches are not off/manual. Placeholders are reported, not failed.
 *   node scripts/check-preview-isolation.mjs --observed <file.json> [--env preview]
 *       Before every hosted test run, with the owner's read-only observation
 *       (the runbook, documentation/operations/AGENT_EXECUTION_VALIDATION.md).
 *       Exits 0 only on `isolated`; `unverified` is exit 2, `unsafe` exit 1.
 *   --json   prints the matrix as JSON (the machine-readable isolation matrix).
 *
 * Reads files only. It calls no Cloudflare API, holds no credential and
 * changes nothing; the observation file is written by the owner's own
 * read-only commands and holds identifiers and secret NAMES only.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflight } from './lib/previewIsolation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const env = value('--env') || 'preview';
const isStatic = flag('--static');
const observedPath = value('--observed');
if (!isStatic && !observedPath) {
  console.error('✗ check-preview-isolation: pass --static (CI) or --observed <file.json> (a hosted run). Without evidence nothing is isolated.');
  process.exit(2);
}
let observed = null;
if (observedPath) {
  try { observed = JSON.parse(readFileSync(resolve(process.cwd(), observedPath), 'utf8')); }
  catch (e) { console.error(`✗ check-preview-isolation: the observation could not be read (${e.message}). Unverified.`); process.exit(2); }
}
const toml = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8');
const r = preflight(toml, { env, observed, static: isStatic });

if (flag('--json')) {
  // `observed_at` is the observation's own time; the fixture writer refuses one older than a day.
  process.stdout.write(`${JSON.stringify({ verdict: r.verdict, env: r.env, worker: r.worker, observed_at: observed?.taken_at ?? null, rows: r.rows, unsafe: r.unsafe, pending: r.pending }, null, 2)}\n`);
} else {
  const counts = {};
  for (const row of r.rows) counts[row.status] = (counts[row.status] || 0) + 1;
  const line = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ');
  if (r.unsafe.length) {
    console.error(`✗ check-preview-isolation: ${r.env} is UNSAFE (${line}).`);
    for (const u of r.unsafe) console.error(`  - ${u.kind} ${u.binding}${u.field ? `.${u.field}` : ''}: ${u.status}${u.detail ? ` (${u.detail})` : u.declared ? ` (${u.declared})` : ''}`);
  } else if (isStatic) {
    const ph = r.rows.filter((x) => x.status === 'placeholder').map((x) => x.binding);
    console.log(`✓ check-preview-isolation: ${r.env} declares no production identity (${line})${ph.length ? `; placeholders still to be provisioned: ${ph.join(', ')}` : ''}. A hosted run needs --observed.`);
  } else if (r.verdict === 'isolated') {
    console.log(`✓ check-preview-isolation: ${r.env} is isolated (${line}).`);
  } else {
    console.error(`✗ check-preview-isolation: ${r.env} is UNVERIFIED (${line}).`);
    for (const p of r.pending) console.error(`  - ${p.kind} ${p.binding}${p.field ? `.${p.field}` : ''}: ${p.status}`);
  }
}
process.exit(r.unsafe.length ? 1 : (isStatic || r.verdict === 'isolated') ? 0 : 2);
