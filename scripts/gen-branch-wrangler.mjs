#!/usr/bin/env node
/**
 * Write a branch Worker's `wrangler.branch.<code>.toml` from its registry entry.
 *
 *   node scripts/gen-branch-wrangler.mjs fr
 *   node scripts/gen-branch-wrangler.mjs fr --stdout   # render without writing
 *
 * The file lands at the REPO ROOT and is gitignored. Two reasons it is not
 * committed: `[assets] directory = "./docs"` resolves against the config's own
 * location, so the config must sit where `docs/` does; and a committed copy
 * would be a second place a binding could go stale, which is the thing
 * `scripts/lib/branchConfig.mjs` exists to prevent. `branch-provision.yml`
 * regenerates it on every deploy.
 *
 * All the thinking is in `scripts/lib/branchConfig.mjs`; this is the file half.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateBranch, renderBranchConfig, checkRendered, hqIds, BRANCH_CODE_RE,
} from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith('--'));
const toStdout = args.includes('--stdout');

const die = (msg) => { console.error(`✗ gen-branch-wrangler: ${msg}`); process.exit(1); };

if (!code) die('usage: node scripts/gen-branch-wrangler.mjs <code> [--stdout]');
// `_example.json` is the fixture the guard renders on every run; generating
// from it would produce a config for a branch that does not exist.
if (code.startsWith('_')) die(`${code} is a fixture, not a branch`);
if (!BRANCH_CODE_RE.test(code)) die(`"${code}" is not a branch code (${BRANCH_CODE_RE})`);

const entryPath = join(ROOT, 'infra/branches', `${code}.json`);
if (!existsSync(entryPath)) die(`no registry entry at infra/branches/${code}.json`);

let entry;
try { entry = JSON.parse(readFileSync(entryPath, 'utf8')); }
catch (e) { die(`infra/branches/${code}.json is not valid JSON — ${e.message}`); }

const tomlSrc = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
const problems = validateBranch(entry, hqIds(tomlSrc));
if (problems.length) die(`infra/branches/${code}.json\n  - ${problems.join('\n  - ')}`);
if (entry.status === 'example') die(`${code} is an example entry; it is never deployed`);

const rendered = renderBranchConfig(tomlSrc, entry);
const after = checkRendered(tomlSrc, entry, rendered);
// The generator checking its own output is not belt and braces: the guard
// derives what must be there from wrangler.toml, so this catches a binding
// added to HQ that the rename map does not cover — here, before a deploy.
if (after.length) die(`the rendered config is not deployable\n  - ${after.join('\n  - ')}`);

if (toStdout) { process.stdout.write(rendered); process.exit(0); }

const out = join(ROOT, `wrangler.branch.${code}.toml`);
writeFileSync(out, rendered);
console.log(`✓ gen-branch-wrangler: wrangler.branch.${code}.toml`);
console.log(`  worker studioos-${code} · https://${entry.hostname} · D1 studioos-${code}`);
console.log(`  deploy: npx wrangler deploy --config wrangler.branch.${code}.toml`);
