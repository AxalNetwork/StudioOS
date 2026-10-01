/**
 * Which database `migrate-d1.mjs` is pointed at, decided in one place.
 *
 * The runner used to hold a three-way switch on flags with the database name
 * written as a literal in each arm. That was right while there was one
 * production database; a branch adds one per subsidiary, and a literal per
 * branch is not a thing anyone can keep correct.
 *
 * TWO FIELDS DO THE WORK, and the second is the one that was missing. `dbName`
 * is the positional argument `wrangler d1 execute` takes, and `config` is the
 * wrangler config that has to DECLARE that database — for HQ, the repo's
 * `wrangler.toml`; for a branch, its generated `wrangler.branch.<code>.toml`.
 * Passing HQ's config while naming a branch's database asks wrangler to
 * resolve a name its config has never heard of, which is an account lookup
 * that may or may not be enabled for the token in use. Naming the config that
 * declares the database removes that question rather than betting on it.
 *
 * Pure: no filesystem, no spawn. `scripts/lib/migrationTargets.test.mjs`.
 */

import { BRANCH_CODE_RE } from './branchConfig.mjs';

/** Paths are relative to `cloudflare-worker/`, which is where wrangler runs. */
export const HQ_CONFIG = '../wrangler.toml';

/** The config a branch's database is declared in, from the repo root. */
export const branchConfigPath = (code) => `../wrangler.branch.${code}.toml`;

/** The flag that selects a branch, and the code after it. */
export function branchFlagValue(argv) {
  const i = argv.indexOf('--branch');
  if (i === -1) return null;
  return argv[i + 1] ?? '';
}

/**
 * The target `argv` selects, or `null` when it selects none.
 *
 * Throws on `--branch` with a code that is not a code: a typo that fell
 * through to "no target" would print the generic usage text, and a typo that
 * fell through to the production arm would migrate production.
 */
export function resolveTarget(argv) {
  const has = (flag) => argv.includes(flag);

  const branch = branchFlagValue(argv);
  if (branch !== null) {
    if (!BRANCH_CODE_RE.test(branch)) {
      throw new Error(
        `--branch needs a branch code (${BRANCH_CODE_RE}); got ${JSON.stringify(branch)}`,
      );
    }
    if (has('--local') || has('--remote') || has('--preview')) {
      throw new Error('--branch selects its own database; do not combine it with --local, --remote or --preview.');
    }
    return {
      label: `branch ${branch}`,
      kind: 'branch',
      branch,
      dbName: `studioos-${branch}`,
      config: branchConfigPath(branch),
      flags: ['--remote'],
    };
  }
  if (has('--local')) {
    return { label: 'local', kind: 'local', dbName: 'studioos-db', config: HQ_CONFIG, flags: ['--local'] };
  }
  if (has('--preview')) {
    return {
      label: 'preview',
      kind: 'preview',
      dbName: 'studioos-db-preview',
      config: HQ_CONFIG,
      flags: ['--env', 'preview', '--remote'],
    };
  }
  if (has('--remote')) {
    return { label: 'remote (prod)', kind: 'production', dbName: 'studioos-db', config: HQ_CONFIG, flags: ['--remote'] };
  }
  return null;
}

/**
 * Why `--bootstrap` may not run against this target, or `null` when it may.
 *
 * WHAT THIS REPLACED, and why the old rule was the wrong shape. It read
 * `if (has('--remote')) fail(…)` — a check on the FLAG, not on the database.
 * That happens to protect production, but it says "bootstrap is a local
 * thing", which stopped being true the moment a branch existed: a freshly
 * created branch database is empty and remote, and applying the baseline to
 * it is exactly what provisioning does. Worse, the flag check is loose in the
 * direction that matters — a target whose own flags include `--remote` while
 * argv does not (the preview arm, and now the branch arm) slipped past it.
 *
 * So the rule now names the one thing bootstrap must never touch: a database
 * that already holds the platform. Emptiness is still checked separately and
 * for real, against the target itself (`bootstrapStateProblem`), because "is
 * this database empty" is a question only the database can answer.
 */
export function bootstrapRefusal(target) {
  if (!target) return 'no target selected';
  if (target.kind === 'production') {
    return 'bootstrap applies the whole baseline and re-writes the ledger; production is migrated forward, never bootstrapped';
  }
  return null;
}
