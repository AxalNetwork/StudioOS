#!/usr/bin/env node
/**
 * Write `infra/branches/<code>.json` from what provisioning just created.
 *
 * WHY THIS IS A SCRIPT AND NOT A HEREDOC IN THE WORKFLOW. Two reasons, and the
 * first is the important one. A `run:` block that built JSON from dispatched
 * values would have to interpolate them, and `${{ }}` is substituted before
 * the shell parses the line — the shell-injection shape Semgrep caught on PR 3
 * and that `d1-migrate.yml` documents at length. Reading `process.env` instead
 * means a branch name containing a quote is a string, not syntax. The second:
 * the registry entry has a schema (`validateBranch`), and a script can run it
 * before writing rather than after someone notices.
 *
 * IT VALIDATES WHAT IT WRITES, against the same function the guard uses. A
 * file that passes here and fails `check-branch-config.mjs` two steps later
 * would mean two definitions of a valid entry; there is one.
 *
 * Inputs, all from the environment (the workflow's job-level `env:`):
 *   BRANCH, BRANCH_NAME, LICENCE_UID, TERRITORY,
 *   D1_JURISDICTION, LOCATION_HINT, DO_JURISDICTION  ('none' means unset)
 *   D1_ID, KV_TOKENS, KV_RATE_LIMITS                 (captured from wrangler)
 *   BRANCH_CREATED_AT                                (optional; for tests)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBranch, BRANCH_CODE_RE } from './lib/branchConfig.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const die = (msg) => { console.error(`✗ write-branch-registry: ${msg}`); process.exit(1); };

/** `none` and the empty string both mean "not requested". */
const opt = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== 'none' ? s : null;
};

export function buildEntry(env) {
  const code = String(env.BRANCH ?? '').trim();
  if (!BRANCH_CODE_RE.test(code)) die(`"${code}" is not a branch code (${BRANCH_CODE_RE})`);

  const territory = String(env.TERRITORY ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!territory.length) die('TERRITORY is empty — a branch holds at least one country');

  for (const key of ['D1_ID', 'KV_TOKENS', 'KV_RATE_LIMITS']) {
    if (!String(env[key] ?? '').trim()) {
      die(`${key} is empty — the create step did not report an id, so the registry would name nothing`);
    }
  }

  return {
    code,
    licence_uid: String(env.LICENCE_UID ?? '').trim(),
    name: String(env.BRANCH_NAME ?? '').trim(),
    hostname: `${code}.axal.vc`,
    territory,
    residency: {
      d1_jurisdiction: opt(env.D1_JURISDICTION),
      location_hint: opt(env.LOCATION_HINT),
      do_jurisdiction: opt(env.DO_JURISDICTION),
      // R2 follows D1: both are storage, and offering a branch EU storage for
      // its database but not its documents would be a residency claim that is
      // true of half the personal data.
      r2_jurisdiction: opt(env.D1_JURISDICTION),
    },
    ids: {
      d1: String(env.D1_ID).trim(),
      kv_tokens: String(env.KV_TOKENS).trim(),
      kv_rate_limits: String(env.KV_RATE_LIMITS).trim(),
    },
    // Not `live`. The Worker is not deployed when this file is written, and a
    // status that ran ahead of the deploy would make the registry a claim
    // rather than a record. The linking PR flips it.
    status: 'provisioning',
    created_at: String(env.BRANCH_CREATED_AT ?? new Date().toISOString()),
  };
}

/**
 * Write the entry, creating the file ONLY if it does not already exist.
 *
 * WHY THE `wx` FLAG AND NOT AN `existsSync` FIRST. This used to check and then
 * write, which CodeQL flagged as a file-system race and which is one:
 * `wx` asks the filesystem for the thing the pair only implied — create,
 * exclusively, or fail — in a single syscall with no window between the two.
 *
 * THE WINDOW IS SMALL AND THE CONSEQUENCE IS NOT. `infra/branches/<code>.json`
 * is the only source of truth for a deployment's ids (D105). The refusal
 * exists because a second provisioning run against a code that already has a
 * branch must stop, not overwrite: the entry it would replace names the D1
 * database and two KV namespaces of a LIVE subsidiary, and a registry that
 * quietly forgot them is a branch nobody can redeploy or back up.
 *
 * ONLY `EEXIST` BECOMES THE REFUSAL. Anything else — a read-only mount, a
 * full disk — is rethrown, because "already provisioned" is a specific claim
 * and reporting a permissions failure as one sends whoever reads the run log
 * to look for a branch that does not exist.
 *
 * Exported, and taking its directory, so a test can run it against a scratch
 * path without a git tree — the same reason `buildEntry` is separate from
 * `main`.
 */
export function writeEntry(dir, entry) {
  const path = join(dir, `${entry.code}.json`);
  try {
    // `recursive: true` is already idempotent, so there is no `existsSync`
    // ahead of it either: that guard was a second check-then-use pair buying
    // nothing. It is INSIDE the try so the helper has one error boundary —
    // a directory that cannot be created is the same class of failure as a
    // file that cannot be written, and both must keep their own reason.
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e?.code === 'EEXIST') {
      throw new Error(`${path} already exists — ${entry.code} is already provisioned`);
    }
    throw e;
  }
  return path;
}

function main() {
  const entry = buildEntry(process.env);
  const problems = validateBranch(entry);
  if (problems.length) {
    die(`the entry this would write is not valid:\n  - ${problems.join('\n  - ')}`);
  }
  try {
    writeEntry(join(ROOT, 'infra/branches'), entry);
  } catch (e) {
    die(e.message);
  }
  console.log(`✓ wrote infra/branches/${entry.code}.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
