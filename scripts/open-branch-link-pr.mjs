#!/usr/bin/env node
/**
 * Open the PR that gives HQ its binding to a freshly provisioned branch (D.7).
 *
 * WHY A PR AND NOT A PUSH. The committed `wrangler.toml` is the deployed
 * truth: the apex guards and `check-wrangler-binding-parity.mjs` read it, and
 * `documentation/operations/DEPLOY.md` treats it as reviewed. A workflow that
 * pushed straight to `main` would change what deploys without anyone reading
 * it — and this particular change adds a service binding, which is the one
 * thing that lets HQ reach another database. It goes through review like every
 * other change to that file.
 *
 * WHY BOTH TABLES. Wrangler v2 does not inherit into `[env.production]`, so a
 * binding present in one table and not the other is a binding that exists in
 * dev and vanishes in production. The parity guard already refuses that shape;
 * this writes both so it never has to.
 *
 * HQ GAINS THE BINDING ON ITS NEXT DEPLOY, not on this run. That is the
 * accepted cost recorded in F.11, and it is why `services/branches.ts` has a
 * `not_deployed` state: between this PR merging and HQ redeploying, HQ holds
 * a registry row for a branch it cannot yet call, and says so rather than
 * pretending the branch is down.
 *
 * Inputs from the environment: BRANCH, BRANCH_NAME, GH_TOKEN (for `gh`).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRANCH_CODE_RE } from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const die = (msg) => { console.error(`✗ open-branch-link-pr: ${msg}`); process.exit(1); };

/** `fr` → `BRANCH_FR`; `nordics-2` → `BRANCH_NORDICS_2`. */
export function bindingName(code) {
  return `BRANCH_${String(code).toUpperCase().replace(/-/g, '_')}`;
}

/**
 * Add one `[[services]]` block to BOTH tables of a wrangler.toml.
 *
 * Pure so a test can run it on a fixture without a git tree. Idempotent: a
 * config that already names this binding is returned unchanged, so a re-run
 * after a failed push does not stack duplicate blocks — which wrangler would
 * accept and which would make the parity guard's counts disagree.
 */
export function addServiceBinding(tomlSrc, code) {
  const binding = bindingName(code);
  if (tomlSrc.includes(`binding = "${binding}"`)) return tomlSrc;

  const block = (prefix) => [
    '',
    `# ${code}.axal.vc — added by branch-provision.yml. HQ calls this branch`,
    `# through \`env.${binding}\`; the branch calls back through its own \`HQ\`.`,
    `[[${prefix}services]]`,
    `binding = "${binding}"`,
    `service = "studioos-${code}"`,
    'entrypoint = "HqEntrypoint"',
    '',
  ].join('\n');

  // Appended to the end of each table's region rather than inserted at a
  // marker: `[[services]]` is an array-of-tables, so position within the file
  // does not matter, and a marker is one more thing that can be deleted.
  let out = tomlSrc;
  if (!/^\[env\.production\]/m.test(out)) {
    die('wrangler.toml has no [env.production] table — refusing to guess where the production block is');
  }
  const prodAt = out.search(/^\[env\.production\]/m);
  // The top-level table is everything before `[env.production]`; the
  // production table is everything after. One block into each.
  out = `${out.slice(0, prodAt).trimEnd()}\n${block('')}\n${out.slice(prodAt)}`;
  return `${out.trimEnd()}\n${block('env.production.')}`;
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function main() {
  const code = String(process.env.BRANCH ?? '').trim();
  if (!BRANCH_CODE_RE.test(code)) die(`"${code}" is not a branch code`);
  const name = String(process.env.BRANCH_NAME ?? '').trim() || code;

  const registry = join(ROOT, 'infra/branches', `${code}.json`);
  if (!existsSync(registry)) die(`infra/branches/${code}.json does not exist — nothing to link`);

  const tomlPath = join(ROOT, 'wrangler.toml');
  const before = readFileSync(tomlPath, 'utf8');
  const after = addServiceBinding(before, code);
  if (after === before) {
    console.log(`✓ wrangler.toml already binds ${bindingName(code)} — nothing to open`);
  }
  writeFileSync(tomlPath, after, 'utf8');

  const branchRef = `branch-link/${code}`;
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('checkout', '-B', branchRef);
  git('add', `infra/branches/${code}.json`, 'wrangler.toml');
  git('commit', '-m', `Link HQ to ${code}.axal.vc\n\nThe registry entry branch-provision.yml wrote, and HQ's ${bindingName(code)}\nservice binding in both tables of wrangler.toml. HQ can call this branch\nfrom its next deploy; until then services/branches.ts reports it as\nnot_deployed rather than unreachable.`);
  git('push', '-u', 'origin', branchRef, '--force-with-lease');

  const body = [
    `\`${code}.axal.vc\` has been provisioned by \`branch-provision.yml\`.`,
    '',
    'This PR carries the two things HQ needs and a workflow must not push directly:',
    '',
    `- \`infra/branches/${code}.json\` — the registry entry, the only source of truth for this deployment's ids.`,
    `- HQ's \`${bindingName(code)}\` service binding, in **both** tables of \`wrangler.toml\` (v2 does not inherit into \`[env.production]\`, and the parity guard refuses a binding present in one and not the other).`,
    '',
    `**HQ gains the binding on its next deploy, not on merge.** Until then \`services/branches.ts\` reports ${code} as \`not_deployed\` — HQ holds the registry row and has no way to call it yet — which is a different state from \`unreadable\` and renders differently.`,
    '',
    `Branch: **${name}**`,
  ].join('\n');

  execFileSync('gh', [
    'pr', 'create',
    '--title', `Link HQ to ${code}.axal.vc`,
    '--body', body,
    '--base', 'main',
    '--head', branchRef,
    '--draft',
  ], { cwd: ROOT, stdio: 'inherit' });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
