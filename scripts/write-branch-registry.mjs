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
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

function main() {
  const entry = buildEntry(process.env);
  const problems = validateBranch(entry);
  if (problems.length) {
    die(`the entry this would write is not valid:\n  - ${problems.join('\n  - ')}`);
  }
  const dir = join(ROOT, 'infra/branches');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${entry.code}.json`);
  if (existsSync(path)) die(`${path} already exists — ${entry.code} is already provisioned`);
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
  console.log(`✓ wrote infra/branches/${entry.code}.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
