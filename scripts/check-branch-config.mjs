#!/usr/bin/env node
/**
 * Every branch registry entry renders a deployable Worker config.
 *
 * WHY THIS RUNS ON EVERY BUILD, not just when a branch is deployed. The
 * branch config is DERIVED from `wrangler.toml`'s `[env.production]` table
 * (`scripts/lib/branchConfig.mjs`), so the moment someone adds a binding to
 * HQ, every branch's config gains it — or fails here, in the PR that added
 * it, rather than at 2am in a provisioning run. The failure this prevents is
 * the one `wrangler.toml:405-422` already records once: a binding declared in
 * one table and not the other, and a Worker that boots without it.
 *
 * `infra/branches/_example.json` exists so this has something to render even
 * when no branch has been provisioned yet. A guard that only runs once a
 * branch exists would first run on the day it matters most.
 *
 * WHAT IT REFUSES, beyond "the renderer threw":
 *   · a route that is `axal.vc` or `app.axal.vc` — a custom domain belongs to
 *     ONE Worker, so deploying that config would move the apex off HQ
 *   · a D1 or KV id that is HQ's — isolation gone on a config that looks right
 *   · a missing Durable Object migration tag — a new script gets no DO
 *     bindings at all without it
 *   · a table HQ declares and the branch config does not
 *   · a var whose URL still points at HQ — every email link, magic link and
 *     OAuth callback on the branch reads one of those four
 *   · a committed `wrangler.branch.*.toml` — it is build output
 *
 * Exit 0 prints one line. Exit 1 lists every problem, so one run fixes them all.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateBranch, renderBranchConfig, checkRendered, hqIds,
} from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'infra/branches');
const errors = [];

const tomlSrc = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const ids = hqIds(tomlSrc);

if (!existsSync(REGISTRY)) {
  errors.push('infra/branches/ is missing — the branch registry is where a deployment is declared');
} else {
  const files = readdirSync(REGISTRY).filter((f) => f.endsWith('.json')).sort();
  if (!files.includes('_example.json')) {
    errors.push('infra/branches/_example.json is missing — this guard needs one entry to render even before a branch exists');
  }
  for (const file of files) {
    const rel = `infra/branches/${file}`;
    let entry;
    try { entry = JSON.parse(readFileSync(join(REGISTRY, file), 'utf8')); }
    catch (e) { errors.push(`${rel}: not valid JSON — ${e.message}`); continue; }

    const want = file.replace(/\.json$/, '').replace(/^_/, '');
    if (entry.code !== want) errors.push(`${rel}: code is "${entry.code}" but the filename says "${want}"`);

    for (const p of validateBranch(entry, ids)) errors.push(`${rel}: ${p}`);
    if (validateBranch(entry, ids).length) continue;

    let rendered;
    try { rendered = renderBranchConfig(tomlSrc, entry); }
    catch (e) { errors.push(`${rel}: the config could not be rendered — ${e.message}`); continue; }
    for (const p of checkRendered(tomlSrc, entry, rendered)) errors.push(`${rel}: ${p}`);
  }
}

// A generated config in the tree is build output; committing one gives a
// binding somewhere to go stale, which is what deriving it prevents.
try {
  const tracked = execFileSync('git', ['ls-files', 'wrangler.branch.*.toml'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (tracked) {
    for (const f of tracked.split('\n')) errors.push(`${f} is committed — generated branch configs are build output (see .gitignore)`);
  }
} catch { /* not a git checkout (a tarball build); the .gitignore entry still stands */ }

if (errors.length) {
  console.error('✗ check-branch-config: the branch registry does not render a deployable config\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\n  Fix the entry under infra/branches/, or teach scripts/lib/branchConfig.mjs the');
  console.error('  binding it does not know about — a table added to [env.production] needs a');
  console.error('  rename rule there and an IDENTITY entry in checkRendered().');
  process.exit(1);
}

const n = existsSync(REGISTRY) ? readdirSync(REGISTRY).filter((f) => f.endsWith('.json')).length : 0;
console.log(n === 1
  ? '✓ check-branch-config: 1 branch registry entry renders a deployable Worker config.'
  : `✓ check-branch-config: ${n} branch registry entries render a deployable Worker config.`);
