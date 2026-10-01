#!/usr/bin/env node
/**
 * D253 — which branches the push-to-main deploy redeploys.
 *
 * Prints one branch code per line: every `infra/branches/<code>.json` whose
 * status is `provisioning` or `live`. The deploy workflow's `branches` job
 * loops over this output after HQ ships, so a branch Worker runs main's code
 * instead of the code it was provisioned with (task 356).
 *
 * Left out, each for a reason:
 *   - a file whose name starts with `_`: a fixture (`_example.json`), which
 *     `gen-branch-wrangler.mjs` refuses by name;
 *   - status `example`: never deployed, and the generator refuses it too;
 *   - status `suspended`: a branch someone stopped on purpose. Redeploying it
 *     on every merge would undo that.
 *
 * `provisioning` IS kept. A branch that has been provisioned is still marked
 * `provisioning` until someone flips it to `live`, and nothing does that yet
 * (filed in D253), so filtering on `live` alone would redeploy nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDEPLOYED_STATUSES = new Set(['provisioning', 'live']);

/**
 * @param {Array<{file: string, entry: any}>} entries  registry files and their parsed JSON
 * @returns {string[]} the codes to redeploy, sorted
 */
export function deployableBranches(entries) {
  return entries
    .filter(({ file }) => file.endsWith('.json') && !file.startsWith('_'))
    .filter(({ entry }) => entry && REDEPLOYED_STATUSES.has(entry.status))
    .map(({ file }) => file.slice(0, -'.json'.length))
    .sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'branches');
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      // A registry file that does not parse is a failure, not a branch to skip:
      // check-branch-config would already have refused it.
      const entry = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      return { file, entry };
    });
  for (const code of deployableBranches(entries)) console.log(code);
}
