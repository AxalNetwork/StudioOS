#!/usr/bin/env node
/**
 * #6326: the schema-change skill's helper. `name` and `preflight` read the
 * disk and git only; `checks` also fetches origin/main (through the
 * immutability gate). It never calls the GitHub API, writes a file, commits,
 * pushes or touches a database.
 *
 *   name --issue N --slug some_slug   the new migration's path, by the current UTC minute (D4106, D5398)
 *   preflight [--base origin/main] [--issue N]
 *                                     the branch's new migrations (names, SQL) and added runtime DDL
 *   checks                            every schema guard in test:guards order, then the immutability gate
 *
 * The rules live in `lib/schemaChange.mjs`. Run from the repository root.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MIGRATIONS_DIR, SCHEMA_CHECKS, newMigrationName, nameFindings, changedBaseFindings, sqlFindings, runtimeDdlFindings, addedLines, summarise,
} from './lib/schemaChange.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });

function onDisk() {
  return readdirSync(resolve(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
}

function name() {
  const r = newMigrationName({ now: new Date(), issue: arg('issue'), slug: arg('slug'), existing: onDisk() });
  if (r.problem) { console.error(`✖ schema-change name: ${r.problem}`); process.exit(1); }
  console.log(r.path);
}

function preflight() {
  const base = arg('base', 'origin/main');
  try { git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); } catch {
    console.error(`✖ schema-change preflight: ${base} does not resolve. Run git fetch origin main first.`); process.exit(2);
  }
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const onBase = git(['ls-tree', '-r', '--name-only', mergeBase, '--', MIGRATIONS_DIR]).split('\n').filter(Boolean).map((p) => p.slice(MIGRATIONS_DIR.length));
  const baseSet = new Set(onBase);
  const added = onDisk().filter((f) => !baseSet.has(f));
  const findings = nameFindings({ added, onBase, now: new Date(), issue: arg('issue', null) });
  // Applied migrations edited, deleted or renamed, committed or not (D269); the CI gate sees commits only.
  findings.push(...changedBaseFindings(git(['diff', '--name-status', '--no-color', mergeBase, '--', MIGRATIONS_DIR]), onBase));
  for (const f of added) findings.push(...sqlFindings(f, readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')));
  // The Worker's added lines: committed and uncommitted changes since the merge base, plus untracked files.
  const diff = git(['diff', '-U0', '--no-color', mergeBase, '--', 'cloudflare-worker/src']);
  const lines = addedLines(diff);
  for (const f of git(['ls-files', '--others', '--exclude-standard', '--', 'cloudflare-worker/src']).split('\n').filter((p) => p.endsWith('.ts'))) {
    readFileSync(f, 'utf8').split('\n').forEach((text, i) => lines.push({ file: f, line: i + 1, text }));
  }
  findings.push(...runtimeDdlFindings(lines));
  console.log(`schema-change preflight against ${base} (merge base ${mergeBase.slice(0, 10)}): ${added.length} new migration(s)`);
  for (const f of added) console.log(`  + ${MIGRATIONS_DIR}${f}`);
  for (const f of findings) console.log(`${f.level === 'error' ? '✖' : '·'} ${f.file}: ${f.text}`);
  const errors = findings.filter((f) => f.level === 'error').length;
  console.log(errors ? `${errors} error(s); fix them before the guards.` : 'No errors. Notes (·) are for you to check by hand. Next: node scripts/schema-change.mjs checks');
  process.exit(errors ? 1 : 0);
}

function checks() {
  if (!existsSync('node_modules')) { console.error('✖ schema-change checks: no node_modules here; install or link them first.'); process.exit(2); }
  const gen = spawnSync('node', ['scripts/build-generated.mjs'], { stdio: 'ignore' });
  if (gen.status !== 0) { console.error('✖ schema-change checks: scripts/build-generated.mjs failed.'); process.exit(2); }
  const results = [];
  for (const c of SCHEMA_CHECKS) {
    const t = Date.now();
    const r = spawnSync('node', [...c.flags, `scripts/${c.script}`], { encoding: 'utf8', maxBuffer: 1 << 28 });
    results.push({ script: c.script, code: r.status ?? 1, ms: Date.now() - t });
    if (r.status !== 0) process.stderr.write(`\n--- ${c.script}\n${(r.stdout || '') + (r.stderr || '')}\n`);
  }
  const t = Date.now();
  const gate = spawnSync('node', ['scripts/migration-immutability-gate.mjs'], { encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: process.env.GITHUB_BASE_REF || 'main' } });
  results.push({ script: 'migration-immutability-gate.mjs', code: gate.status ?? 1, ms: Date.now() - t });
  if (gate.status !== 0) process.stderr.write(`\n--- migration-immutability-gate.mjs\n${(gate.stdout || '') + (gate.stderr || '')}\n`);
  const s = summarise(results);
  for (const l of s.lines) console.log(l);
  process.exit(s.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  const cmd = process.argv[2];
  if (cmd === 'name') name();
  else if (cmd === 'preflight') preflight();
  else if (cmd === 'checks') checks();
  else { console.error('usage: schema-change.mjs name --issue N --slug s | preflight [--base origin/main] [--issue N] | checks'); process.exit(2); }
}
