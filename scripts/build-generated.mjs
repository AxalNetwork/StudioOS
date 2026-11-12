#!/usr/bin/env node
/**
 * D5612 (#5612) — build the three generated modules that are not committed:
 *
 *   cloudflare-worker/src/routes/_registry.ts                       scripts/build-route-registry.mjs
 *   frontend/src/lib/apiModules.generated.js                        scripts/build-api-index.mjs
 *   cloudflare-worker/src/services/agents/skillLibrary.generated.ts scripts/build-skill-library.mjs
 *
 * They were committed until D5612, and every PR that added a route, an API
 * module or a skill rewrote a sorted list in one of them, so neighbouring PRs
 * conflicted. Now they are gitignored, like `docs/` (D529) and the routing
 * projections (D4103), and this script writes them before every build,
 * typecheck and test: `scripts/build-frontend.mjs` (build, deploy, PR
 * preview), the `predev`/`prebuild` and `predev`/`prelint` hooks of
 * `frontend/` and `cloudflare-worker/`, the root `pretest:*` hooks,
 * `scripts/test-drift-parts.mjs`, and an explicit step in each CI job that
 * runs `tsc`, `node --test`, `wrangler` or `vite` without one of those
 * (`frontend/test/generated_before_build_5612.test.mjs` holds that rule).
 *
 * Node built-ins only, and so are the three generators: it runs before
 * `npm ci`.
 *
 *   node scripts/build-generated.mjs           write all three
 *   node scripts/build-generated.mjs --check   each generator's --check: deterministic, untracked
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each generator and the file it writes, repo-relative. */
export const GENERATORS = Object.freeze([
  { script: 'scripts/build-route-registry.mjs', output: 'cloudflare-worker/src/routes/_registry.ts' },
  { script: 'scripts/build-api-index.mjs', output: 'frontend/src/lib/apiModules.generated.js' },
  { script: 'scripts/build-skill-library.mjs', output: 'cloudflare-worker/src/services/agents/skillLibrary.generated.ts' },
]);

/** Run every generator (with `--check` when `check`); the first non-zero exit status, else 0. */
export function buildGenerated({ check = false, root = ROOT } = {}) {
  for (const { script } of GENERATORS) {
    const r = spawnSync(process.execPath, [resolve(root, script), ...(check ? ['--check'] : [])], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(`build-generated: ${script}${check ? ' --check' : ''} exited ${r.status ?? r.signal}`);
      return r.status || 1;
    }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(buildGenerated({ check: process.argv.includes('--check') }));
}
