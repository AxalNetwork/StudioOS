#!/usr/bin/env node
/**
 * build-route-registry — writes `cloudflare-worker/src/routes/_registry.ts`,
 * the list of Worker route modules that mount themselves (#4105).
 *
 * A module under `cloudflare-worker/src/routes/` that exports
 * `mount: RouteMount | RouteMount[]` (`src/util/routeRegistry.ts`) is mounted
 * by the registry, so adding one is a new file and this script's output, with
 * no edit to `index.ts`. Workers cannot list a folder at runtime, and the
 * registry is read by `tsc`, the node tests and the static drift check as well
 * as by wrangler's bundler, so it is generated here and committed rather than
 * produced inside the wrangler build.
 *
 *   node scripts/build-route-registry.mjs           # check the descriptors, write the registry
 *   node scripts/build-route-registry.mjs --check   # exit 1 when anything is wrong or stale
 *
 * `cloudflare-worker/test/route_registry_4105.test.ts` (in `npm run
 * test:drift`) runs the same checks.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_REL, mountModules, registryProblems, renderRegistry } from './lib/routeRegistry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const stale = (p) => p.startsWith(`${REGISTRY_REL} is `);
const problems = registryProblems(ROOT);
const real = problems.filter((p) => !stale(p));

if (real.length || (CHECK && problems.length)) {
  console.error(`route registry: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (CHECK) {
  console.log(`${REGISTRY_REL} is current.`);
} else if (problems.length) {
  writeFileSync(resolve(ROOT, REGISTRY_REL), renderRegistry(mountModules(ROOT).map((m) => m.file)));
  console.log(`wrote ${REGISTRY_REL}`);
} else {
  console.log(`${REGISTRY_REL} is already current.`);
}
